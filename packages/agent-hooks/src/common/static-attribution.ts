/**
 * Public contracts for the layered static-intent attribution pipeline.
 *
 * Recognizers land incrementally, but the shared diagnostics, tracked-file
 * eligibility, and bounded pre-tool plan store are usable by every producer.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  isGitIgnored,
  isInsideSpanRoot,
  type LineRange,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot,
  sanitizeSessionId,
  toPosix
} from './agent-hooks-common.js';
import {
  type Operation,
  type ParseOptions,
  parseCommandDetailed,
  type ResolvedSpan,
  type SpanMatch
} from './parse-command.js';
import { argvOf, splitTopLevel } from './shell-split.js';

/** Stable machine-readable classifications for candidates the parser refuses. */
export const UNRESOLVED_REASON_CODES = [
  'dynamic-path',
  'dynamic-list',
  'glob-path',
  'command-substitution',
  'candidate-budget-exceeded',
  'unsupported-expression',
  'unsupported-syntax',
  'unsupported-dataflow',
  'unsupported-encoding',
  'binary-content',
  'missing-pre-state',
  'unreadable-pre-state',
  'evidence-mismatch',
  'history-operation',
  'generator-operation',
  'outside-repository',
  'ignored-path',
  'span-metadata-path',
  'untracked-path'
] as const;

export type UnresolvedReasonCode = (typeof UNRESOLVED_REASON_CODES)[number];

/** The bounded recognizer layer that produced or rejected a candidate. */
export type AttributionLayer = 'shell' | 'literal-loop' | 'pattern-substitution' | 'python' | 'node';

/** A resolved operation with the recognizer identity retained for diagnostics. */
export interface LayeredResolvedMatch {
  readonly status: 'resolved';
  readonly layer: AttributionLayer;
  readonly idiom: string;
  readonly span: ResolvedSpan;
}

/** A fail-closed candidate. `detail` is for logs; callers branch only on `reasonCode`. */
export interface UnresolvedAttribution {
  readonly status: 'unresolved';
  readonly layer: AttributionLayer;
  readonly idiom: string;
  readonly reasonCode: UnresolvedReasonCode;
  readonly fileArg?: string;
  readonly simpleCommandIndex?: number;
  readonly detail?: string;
}

/** Why post-tool attribution needs a small piece of pre-command state. */
export type PreStateRequirement = 'match-locations' | 'deleted-text' | 'pre-command-eof' | 'pre-tracked';

/** A candidate whose precision or eligibility must be captured before execution. */
export interface PreStateRequest {
  readonly absolutePath: string;
  readonly operation: Operation;
  readonly requirement: PreStateRequirement;
  readonly simpleCommandIndex: number;
}

/** One complete parse, including explicit refusals and pre-state needs. */
export interface LayeredParseResult {
  readonly resolved: readonly LayeredResolvedMatch[];
  readonly unresolved: readonly UnresolvedAttribution[];
  readonly preStateRequests: readonly PreStateRequest[];
}

export interface LayeredParseOptions extends ParseOptions {
  /** Safety budget applied before expansion; exceeding it rejects the whole bounded set. */
  readonly maxCandidates?: number;
  /** Ephemeral pre-command text lookup. File bodies are never persisted in a plan. */
  readonly readPreState?: (absolutePath: string) => string | null;
}

/** Default all-or-unresolved volume bound shared by parsing and execution. */
export const DEFAULT_MAX_ATTRIBUTION_CANDIDATES = 32;

interface LiteralSubstitution {
  readonly pattern: string;
  readonly replacement: string;
  readonly global: boolean;
}

interface PatternCommand {
  readonly kind: 'sed' | 'perl' | 'perl-zero';
  readonly script: string;
  readonly files: readonly string[];
  readonly backupSuffix?: string;
  readonly simpleCommandIndex: number;
}

const SHELL_EXPANSION = /(?:\$|`)/;
const GLOB_META = /[*?[\]]/;
const REGEX_META = /[.^$*+?()[\]{}|]/;

function unresolved(
  layer: AttributionLayer,
  idiom: string,
  reasonCode: UnresolvedReasonCode,
  detail: string,
  fileArg?: string,
  simpleCommandIndex = 0
): UnresolvedAttribution {
  return { status: 'unresolved', layer, idiom, reasonCode, detail, fileArg, simpleCommandIndex };
}

function classifyDynamicWord(word: string): UnresolvedReasonCode | null {
  if (word.includes('$(') || word.includes('`')) return 'command-substitution';
  if (SHELL_EXPANSION.test(word)) return 'dynamic-path';
  if (GLOB_META.test(word)) return 'glob-path';
  return null;
}

function decodeLiteralField(raw: string, delimiter: string, replacement: boolean): string | null {
  let value = '';
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '\\') {
      const next = raw[index + 1];
      if (next === undefined) return null;
      if (next === 'n') value += '\n';
      else if (next === delimiter || next === '\\' || (!replacement && REGEX_META.test(next))) value += next;
      else return null;
      index += 1;
      continue;
    }
    if ((!replacement && REGEX_META.test(character)) || (replacement && character === '&')) return null;
    value += character;
  }
  return value;
}

function readDelimitedField(
  source: string,
  start: number,
  delimiter: string
): { readonly raw: string; readonly next: number } | null {
  let raw = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      const next = source[index + 1];
      if (next === undefined) return null;
      raw += `${character}${next}`;
      index += 1;
      continue;
    }
    if (character === delimiter) return { raw, next: index + 1 };
    raw += character;
  }
  return null;
}

/** Parse only literal, line-count-preserving substitutions. */
function parseLiteralSubstitution(script: string): LiteralSubstitution | null {
  if (script.length < 4 || script[0] !== 's') return null;
  const delimiter = script[1];
  if (/\w|\s/.test(delimiter)) return null;
  const patternField = readDelimitedField(script, 2, delimiter);
  if (patternField === null) return null;
  const replacementField = readDelimitedField(script, patternField.next, delimiter);
  if (replacementField === null) return null;
  const flags = script.slice(replacementField.next);
  if (flags !== '' && flags !== 'g') return null;
  const pattern = decodeLiteralField(patternField.raw, delimiter, false);
  const replacement = decodeLiteralField(replacementField.raw, delimiter, true);
  if (pattern === null || pattern.length === 0 || replacement === null) return null;
  return { pattern, replacement, global: flags === 'g' };
}

/** Shared pre-state occurrence analysis for sed, Perl, and later embedded recognizers. */
export function literalOccurrenceRanges(content: string, literal: string): LineRange[] {
  if (literal.length === 0) return [];
  const ranges: LineRange[] = [];
  let cursor = 0;
  let scannedTo = 0;
  let currentLine = 1;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    for (let index = scannedTo; index < offset; index += 1) {
      if (content.charCodeAt(index) === 10) currentLine += 1;
    }
    const embeddedNewlines = literal.match(/\n/g)?.length ?? 0;
    const range = { start: currentLine, end: currentLine + embeddedNewlines };
    const previous = ranges[ranges.length - 1];
    if (previous === undefined || previous.start !== range.start || previous.end !== range.end) ranges.push(range);
    cursor = offset + Math.max(1, literal.length);
    scannedTo = offset;
  }
  return ranges;
}

function replaceLiteral(source: string, pattern: string, replacement: string, global: boolean): string {
  if (global) return source.split(pattern).join(replacement);
  const offset = source.indexOf(pattern);
  if (offset < 0) return source;
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + pattern.length)}`;
}

function expectedSubstitutionContent(
  content: string,
  substitution: LiteralSubstitution,
  kind: PatternCommand['kind'],
  addressLiteral: string | null
): string {
  if (kind === 'perl-zero') {
    return replaceLiteral(content, substitution.pattern, substitution.replacement, substitution.global);
  }
  return content
    .split(/(?<=\n)/)
    .map((line) => {
      if (addressLiteral !== null && !line.includes(addressLiteral)) return line;
      return replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global);
    })
    .join('');
}

function parsePatternCommand(command: string): PatternCommand | null {
  const argv = argvOf(command.trim());
  if (argv === null || argv.length < 2) return null;
  if (argv[0] === 'sed') {
    let inplace = false;
    let backupSuffix: string | undefined;
    let script: string | null = null;
    const files: string[] = [];
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '-i') {
        inplace = true;
        continue;
      }
      if (argument.startsWith('-i')) {
        inplace = true;
        backupSuffix = argument.slice(2);
        continue;
      }
      if (argument === '-e') {
        script = argv[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (argument.startsWith('-'))
        return inplace ? { kind: 'sed', script: '', files: [], backupSuffix, simpleCommandIndex: 0 } : null;
      if (script === null) script = argument;
      else files.push(argument);
    }
    return inplace && script !== null ? { kind: 'sed', script, files, backupSuffix, simpleCommandIndex: 0 } : null;
  }
  if (argv[0] !== 'perl') return null;
  let inplace = false;
  let zero = false;
  let script: string | null = null;
  const files: string[] = [];
  let unsupportedOption = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-e') {
      script = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) {
      const attachedScript = argument.match(/^-e(.+)$/)?.[1];
      if (attachedScript !== undefined) {
        script = attachedScript;
        continue;
      }
      if (argument === '-pi') inplace = true;
      else if (argument === '-0pi') {
        inplace = true;
        zero = true;
      } else {
        if (argument.includes('p') && argument.includes('i')) inplace = true;
        unsupportedOption = true;
      }
      continue;
    }
    files.push(argument);
  }
  if (unsupportedOption && inplace)
    return { kind: zero ? 'perl-zero' : 'perl', script: '', files: [], simpleCommandIndex: 0 };
  return inplace && script !== null
    ? { kind: zero ? 'perl-zero' : 'perl', script, files, simpleCommandIndex: 0 }
    : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function stableReason(match: Extract<SpanMatch, { status: 'unresolved' }>): UnresolvedReasonCode {
  if (match.fileArg.includes('$(') || match.fileArg.includes('`')) return 'command-substitution';
  if (SHELL_EXPANSION.test(match.fileArg)) return 'dynamic-path';
  if (GLOB_META.test(match.fileArg)) return 'glob-path';
  if (match.reason.includes('working directory')) return 'dynamic-path';
  return 'unsupported-expression';
}

/** Parse explicit authoring intent through deterministic and bounded recognizers. */
export function parseCommandLayered(command: string, options: LayeredParseOptions = {}): LayeredParseResult {
  const cwd = options.cwd ?? process.cwd();
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('maxCandidates must be a positive safe integer');
  }

  const loop = command
    .trim()
    .match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]*?)\s*;\s*do\s+([\s\S]*?)\s*;\s*done\s*$/);
  if (loop !== null) {
    const [, variable, listSource, body] = loop;
    if (body.includes('for ') || body.includes('while ') || body.includes('until ')) {
      return {
        resolved: [],
        unresolved: [
          unresolved('literal-loop', 'literal-list-loop', 'unsupported-syntax', 'nested loop bodies are not supported')
        ],
        preStateRequests: []
      };
    }
    if (listSource.includes('$(') || listSource.includes('`')) {
      return {
        resolved: [],
        unresolved: [
          unresolved('literal-loop', 'literal-list-loop', 'command-substitution', 'loop list uses command substitution')
        ],
        preStateRequests: []
      };
    }
    if (GLOB_META.test(listSource)) {
      return {
        resolved: [],
        unresolved: [unresolved('literal-loop', 'literal-list-loop', 'glob-path', 'loop list uses glob expansion')],
        preStateRequests: []
      };
    }
    if (SHELL_EXPANSION.test(listSource)) {
      return {
        resolved: [],
        unresolved: [
          unresolved('literal-loop', 'literal-list-loop', 'dynamic-list', 'loop list is not a literal list')
        ],
        preStateRequests: []
      };
    }
    const bindings = argvOf(listSource);
    if (bindings === null || bindings.length === 0) {
      return {
        resolved: [],
        unresolved: [
          unresolved('literal-loop', 'literal-list-loop', 'unsupported-syntax', 'loop list cannot be tokenized')
        ],
        preStateRequests: []
      };
    }
    if (bindings.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'literal-loop',
            'literal-list-loop',
            'candidate-budget-exceeded',
            `literal list has ${bindings.length} bindings; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    const variablePattern = new RegExp(`\\$\\{${variable}\\}|\\$${variable}(?![A-Za-z0-9_])`, 'g');
    if (!variablePattern.test(body)) {
      return {
        resolved: [],
        unresolved: [
          unresolved('literal-loop', 'literal-list-loop', 'unsupported-dataflow', 'loop variable is not used directly')
        ],
        preStateRequests: []
      };
    }
    const resolved: LayeredResolvedMatch[] = [];
    const unresolvedMatches: UnresolvedAttribution[] = [];
    const preStateRequests: PreStateRequest[] = [];
    for (const binding of bindings) {
      const dynamic = classifyDynamicWord(binding);
      if (dynamic !== null) {
        return {
          resolved: [],
          unresolved: [
            unresolved('literal-loop', 'literal-list-loop', dynamic, 'loop binding is not literal', binding)
          ],
          preStateRequests: []
        };
      }
      const braced = `\\$\\{${variable}\\}`;
      const plain = `\\$${variable}(?![A-Za-z0-9_])`;
      const expanded = body
        .replace(new RegExp(`"(?:${braced}|${plain})"`, 'g'), shellQuote(binding))
        .replace(variablePattern, shellQuote(binding));
      const result = parseCommandLayered(expanded, { ...options, maxCandidates });
      resolved.push(...result.resolved.map((match) => ({ ...match, layer: 'literal-loop' as const })));
      unresolvedMatches.push(...result.unresolved.map((match) => ({ ...match, layer: 'literal-loop' as const })));
      preStateRequests.push(...result.preStateRequests);
    }
    if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests: [] };
    if (resolved.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'literal-loop',
            'literal-list-loop',
            'candidate-budget-exceeded',
            `literal expansion produced ${resolved.length} candidates; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    for (const match of resolved) {
      if (match.span.operation !== 'modify') continue;
      if (preStateRequests.some((request) => request.absolutePath === match.span.absolutePath)) continue;
      preStateRequests.push({
        absolutePath: match.span.absolutePath,
        operation: match.span.operation,
        requirement: 'match-locations',
        simpleCommandIndex: match.span.simpleCommandIndex
      });
    }
    return { resolved, unresolved: [], preStateRequests };
  }

  const split = splitTopLevel(command);
  const hasPatternStage = split.stages.some((stage) => parsePatternCommand(stage.text) !== null);
  const hasPipeline = split.stages.some((stage) => stage.precededBy === 'pipe');
  if (split.malformed === undefined && split.stages.length > 1 && hasPatternStage && !hasPipeline) {
    if (split.stages.some((stage) => argvOf(stage.text)?.[0] === 'cd')) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'pattern-substitution',
            'compound-command',
            'dynamic-path',
            'a directory-changing compound cannot safely resolve substitution targets'
          )
        ],
        preStateRequests: []
      };
    }
    const resolved: LayeredResolvedMatch[] = [];
    const unresolvedMatches: UnresolvedAttribution[] = [];
    const preStateRequests: PreStateRequest[] = [];
    for (let index = 0; index < split.stages.length; index += 1) {
      const stage = split.stages[index];
      const child = parseCommandLayered(stage.text, options);
      const join: ResolvedSpan['join'] =
        stage.precededBy === 'and' ? '&&' : stage.precededBy === 'or' ? '||' : undefined;
      resolved.push(
        ...child.resolved.map((match) => ({
          ...match,
          span: { ...match.span, simpleCommandIndex: index, join }
        }))
      );
      unresolvedMatches.push(...child.unresolved.map((match) => ({ ...match, simpleCommandIndex: index })));
      preStateRequests.push(...child.preStateRequests.map((request) => ({ ...request, simpleCommandIndex: index })));
    }
    if (resolved.length > maxCandidates) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'shell',
            'compound-command',
            'candidate-budget-exceeded',
            `compound produced ${resolved.length} candidates; the limit is ${maxCandidates}`
          )
        ],
        preStateRequests: []
      };
    }
    return { resolved, unresolved: unresolvedMatches, preStateRequests };
  }
  const patternCommand =
    split.malformed === undefined && split.stages.length === 1 ? parsePatternCommand(split.stages[0].text) : null;
  if (patternCommand !== null) {
    const numericMatch = patternCommand.kind === 'sed' ? patternCommand.script.match(/^(\d+)(?:,(\d+))?s\W/) : null;
    const numericSed = numericMatch !== null;
    if (numericMatch !== null) {
      if (patternCommand.files.length === 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'shell',
              'sed-inplace',
              'unsupported-syntax',
              'numeric in-place substitution has no file operand'
            )
          ],
          preStateRequests: []
        };
      }
      const start = Number.parseInt(numericMatch[1], 10);
      const end = Number.parseInt(numericMatch[2] ?? numericMatch[1], 10);
      const resolved: LayeredResolvedMatch[] = [];
      const unresolvedMatches: UnresolvedAttribution[] = [];
      for (const file of patternCommand.files) {
        const reason = classifyDynamicWord(file);
        if (reason !== null) {
          unresolvedMatches.push(unresolved('shell', 'sed-inplace', reason, 'target path is dynamic', file));
          continue;
        }
        resolved.push({
          status: 'resolved',
          layer: 'shell',
          idiom: 'sed-inplace',
          span: {
            operation: 'modify',
            absolutePath: nodePath.resolve(cwd, file),
            lineStart: start,
            lineEnd: end,
            simpleCommandIndex: patternCommand.simpleCommandIndex
          }
        });
        if (patternCommand.backupSuffix !== undefined && patternCommand.backupSuffix !== '') {
          resolved.push({
            status: 'resolved',
            layer: 'shell',
            idiom: 'sed-inplace',
            span: {
              operation: 'create-overwrite',
              absolutePath: `${nodePath.resolve(cwd, file)}${patternCommand.backupSuffix}`,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
      }
      if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests: [] };
      if (resolved.length > maxCandidates) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'shell',
              'sed-inplace',
              'candidate-budget-exceeded',
              `numeric substitution produced ${resolved.length} candidates; the limit is ${maxCandidates}`
            )
          ],
          preStateRequests: []
        };
      }
      return { resolved, unresolved: [], preStateRequests: [] };
    }
    if (!numericSed) {
      let addressLiteral: string | null = null;
      let substitutionSource = patternCommand.script;
      if (patternCommand.kind === 'sed' && substitutionSource.startsWith('/')) {
        const address = readDelimitedField(substitutionSource, 1, '/');
        if (address === null) substitutionSource = '';
        else {
          addressLiteral = decodeLiteralField(address.raw, '/', false);
          if (addressLiteral === '') addressLiteral = null;
          substitutionSource = substitutionSource.slice(address.next);
        }
      }
      const substitution = parseLiteralSubstitution(substitutionSource);
      const patternNewlines = substitution?.pattern.match(/\n/g)?.length ?? 0;
      const replacementNewlines = substitution?.replacement.match(/\n/g)?.length ?? 0;
      if (
        substitution === null ||
        patternNewlines !== replacementNewlines ||
        (patternCommand.kind !== 'perl-zero' && patternNewlines > 0)
      ) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              'unsupported-expression',
              'only literal line-count-preserving substitutions are supported'
            )
          ],
          preStateRequests: []
        };
      }
      if (patternCommand.files.length === 0) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              'unsupported-syntax',
              'in-place substitution has no literal file operand'
            )
          ],
          preStateRequests: []
        };
      }
      if (addressLiteral === null && patternCommand.kind === 'sed' && patternCommand.script.startsWith('/')) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'pattern-substitution',
              'sed-inplace',
              'unsupported-expression',
              'sed address is not a literal pattern'
            )
          ],
          preStateRequests: []
        };
      }
      const resolved: LayeredResolvedMatch[] = [];
      const unresolvedMatches: UnresolvedAttribution[] = [];
      const preStateRequests: PreStateRequest[] = [];
      for (const file of patternCommand.files) {
        const reason = classifyDynamicWord(file);
        if (reason !== null) {
          unresolvedMatches.push(
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              reason,
              'target path is dynamic',
              file
            )
          );
          continue;
        }
        const absolutePath = nodePath.resolve(cwd, file);
        preStateRequests.push({
          absolutePath,
          operation: 'modify',
          requirement: 'match-locations',
          simpleCommandIndex: patternCommand.simpleCommandIndex
        });
        if (patternCommand.kind === 'perl-zero') {
          preStateRequests.push({
            absolutePath,
            operation: 'modify',
            requirement: 'deleted-text',
            simpleCommandIndex: patternCommand.simpleCommandIndex
          });
        }
        const content = options.readPreState?.(absolutePath) ?? null;
        if (content === null) {
          unresolvedMatches.push(
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              'missing-pre-state',
              'literal substitution range requires pre-command text',
              absolutePath
            )
          );
          continue;
        }
        if (content.includes('\0')) {
          unresolvedMatches.push(
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              'binary-content',
              'substitution range recovery does not accept NUL-delimited content',
              absolutePath
            )
          );
          continue;
        }
        let ranges = literalOccurrenceRanges(content, substitution.pattern);
        if (addressLiteral !== null) {
          const addressedLines = new Set(literalOccurrenceRanges(content, addressLiteral).map(({ start }) => start));
          ranges = ranges.filter(({ start, end }) => start === end && addressedLines.has(start));
        }
        if (patternCommand.kind === 'perl' && ranges.length > 1) {
          ranges = [{ start: ranges[0].start, end: ranges[ranges.length - 1].end }];
        } else if (patternCommand.kind === 'perl-zero' && !substitution.global) {
          ranges = ranges.slice(0, 1);
        }
        const expectedContent = expectedSubstitutionContent(content, substitution, patternCommand.kind, addressLiteral);
        for (const range of ranges) {
          resolved.push({
            status: 'resolved',
            layer: 'pattern-substitution',
            idiom: patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
            span: {
              operation: 'modify',
              absolutePath,
              lineStart: range.start,
              lineEnd: range.end,
              expectedContent,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
        if (patternCommand.backupSuffix !== undefined && patternCommand.backupSuffix !== '') {
          resolved.push({
            status: 'resolved',
            layer: 'pattern-substitution',
            idiom: 'sed-inplace',
            span: {
              operation: 'create-overwrite',
              absolutePath: `${absolutePath}${patternCommand.backupSuffix}`,
              simpleCommandIndex: patternCommand.simpleCommandIndex
            }
          });
        }
      }
      if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests };
      if (resolved.length > maxCandidates) {
        return {
          resolved: [],
          unresolved: [
            unresolved(
              'pattern-substitution',
              patternCommand.kind === 'sed' ? 'sed-inplace' : 'perl-inplace',
              'candidate-budget-exceeded',
              `substitution produced ${resolved.length} candidates; the limit is ${maxCandidates}`
            )
          ],
          preStateRequests: []
        };
      }
      return { resolved, unresolved: [], preStateRequests };
    }
  }

  const argv = argvOf(command.trim());
  if (argv !== null) {
    if (argv[0] === 'git' && ['rebase', 'merge', 'cherry-pick', 'reset'].includes(argv[1] ?? '')) {
      return {
        resolved: [],
        unresolved: [
          unresolved('shell', 'history-operation', 'history-operation', 'history-changing commands have no file intent')
        ],
        preStateRequests: []
      };
    }
    if (
      ['yarn', 'npm', 'pnpm', 'make'].includes(argv[0]) &&
      /(?:generate|build|install)/.test(argv.slice(1).join(' '))
    ) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'shell',
            'generator-operation',
            'generator-operation',
            'generators have no bounded static output set'
          )
        ],
        preStateRequests: []
      };
    }
  }

  const detailed = parseCommandDetailed(command, options);
  const resolved = detailed.flatMap<LayeredResolvedMatch>((match) =>
    match.status === 'resolved' ? [{ status: 'resolved', layer: 'shell', idiom: match.idiom, span: match.span }] : []
  );
  const unresolvedMatches = detailed.flatMap<UnresolvedAttribution>((match) =>
    match.status === 'unresolved'
      ? [unresolved('shell', match.idiom, stableReason(match), match.reason, match.fileArg)]
      : []
  );
  if (resolved.length > maxCandidates) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          'shell',
          'deterministic-shell',
          'candidate-budget-exceeded',
          `command produced ${resolved.length} candidates; the limit is ${maxCandidates}`
        )
      ],
      preStateRequests: []
    };
  }
  return { resolved, unresolved: unresolvedMatches, preStateRequests: [] };
}

/** Aggregate counters emitted once per tool invocation and never sent to the model. */
export interface AttributionDiagnostics {
  readonly resolvedReads: number;
  readonly resolvedWrites: number;
  readonly unresolvedByIdiom: Readonly<Record<string, number>>;
  readonly unresolvedByReason: Readonly<Partial<Record<UnresolvedReasonCode, number>>>;
  readonly scopeDrops: number;
  readonly trackedDrops: number;
  readonly executionGateDrops: number;
  readonly parserLatencyMs: number;
  readonly touchLatencyMs: number;
  readonly subprocessCount: number;
  readonly dependencyContextSurfaced: boolean;
}

/** Create the zero-valued diagnostic accumulator for one invocation. */
export function createAttributionDiagnostics(): AttributionDiagnostics {
  return {
    resolvedReads: 0,
    resolvedWrites: 0,
    unresolvedByIdiom: {},
    unresolvedByReason: {},
    scopeDrops: 0,
    trackedDrops: 0,
    executionGateDrops: 0,
    parserLatencyMs: 0,
    touchLatencyMs: 0,
    subprocessCount: 0,
    dependencyContextSurfaced: false
  };
}

/** Bounded evidence sufficient to verify a planned range without retaining a file body. */
export type PreStateEvidence =
  | {
      readonly kind: 'literal-occurrences';
      readonly literal: string;
      readonly ranges: readonly LineRange[];
      readonly expectedCount: number;
    }
  | {
      readonly kind: 'anchor';
      readonly literal: string;
      readonly line: number;
    }
  | {
      readonly kind: 'eof';
      readonly line: number;
      readonly byteLength: number;
    }
  | {
      readonly kind: 'content-digest';
      readonly algorithm: 'sha256';
      readonly digest: string;
      readonly range: LineRange;
    }
  | {
      readonly kind: 'tracked';
      readonly tracked: true;
    };

/** A single tracked repository-relative operation retained across a tool call. */
export interface PlannedTouch {
  readonly repoRelativePath: string;
  readonly operation: Operation;
  readonly ranges: readonly LineRange[];
  readonly simpleCommandIndex: number;
  readonly evidence?: PreStateEvidence;
}

/** Content-minimal, versioned record keyed by session and tool-use id. */
export interface PlannedTouchRecord {
  readonly version: 1;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly repoRoot: string;
  readonly createdAtMs: number;
  readonly touches: readonly PlannedTouch[];
}

/** Hard limits checked before a record is written; over-budget writes fail closed. */
export interface PlannedTouchBudgets {
  readonly maxTouchesPerRecord: number;
  readonly maxRangesPerTouch: number;
  readonly maxEvidenceBytes: number;
  readonly maxRecordBytes: number;
}

export interface PlannedTouchStore {
  /** Atomically replace the record for its session/tool-use key. */
  put(record: PlannedTouchRecord): void;
  /** Atomically consume the record; repeated consumption returns null. */
  consume(sessionId: string, toolUseId: string): PlannedTouchRecord | null;
  /** Idempotently discard any pending record for failure or interruption cleanup. */
  discard(sessionId: string, toolUseId: string): void;
}

/** Create the bounded disk-backed planned-touch store rooted at `baseDir`. */
export function createPlannedTouchStore(baseDir: string, budgets: PlannedTouchBudgets): PlannedTouchStore {
  validateBudgets(budgets);
  if (baseDir.length === 0) throw new Error('planned-touch base directory must not be empty');

  const recordPaths = (sessionId: string, toolUseId: string): { dir: string; record: string; consumed: string } => {
    if (sessionId.length === 0 || toolUseId.length === 0) {
      throw new Error('planned-touch session and tool-use ids must not be empty');
    }
    const dir = nodePath.join(baseDir, sanitizeSessionId(sessionId), 'planned-touches');
    const stem = sanitizeSessionId(toolUseId);
    return {
      dir,
      record: nodePath.join(dir, `${stem}.json`),
      consumed: nodePath.join(dir, `${stem}.consumed`)
    };
  };

  const makeRestrictiveDir = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(baseDir, 0o700);
    fs.chmodSync(nodePath.dirname(dir), 0o700);
    fs.chmodSync(dir, 0o700);
  };

  const claim = (consumed: string): boolean => {
    try {
      fs.writeFileSync(consumed, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };

  return {
    put(record) {
      const normalized = normalizePlannedTouchRecord(record, budgets);
      const paths = recordPaths(normalized.sessionId, normalized.toolUseId);
      makeRestrictiveDir(paths.dir);
      if (fs.existsSync(paths.consumed)) {
        throw new Error('planned-touch record has already been consumed or discarded');
      }

      const encoded = JSON.stringify(normalized);
      const tmp = nodePath.join(
        paths.dir,
        `.${nodePath.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs.writeFileSync(tmp, encoded, { encoding: 'utf8', mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, paths.record);
      } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
    },
    consume(sessionId, toolUseId) {
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      if (!claim(paths.consumed)) return null;

      let raw: string;
      try {
        raw = fs.readFileSync(paths.record, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      } finally {
        fs.rmSync(paths.record, { force: true });
      }

      try {
        return normalizePlannedTouchRecord(JSON.parse(raw) as PlannedTouchRecord, budgets);
      } catch {
        return null;
      }
    },
    discard(sessionId, toolUseId) {
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      claim(paths.consumed);
      fs.rmSync(paths.record, { force: true });
    }
  };
}

const OPERATIONS: ReadonlySet<Operation> = new Set([
  'read',
  'create-overwrite',
  'append',
  'modify',
  'rename-copy',
  'truncate',
  'delete'
]);

function validateBudgets(budgets: PlannedTouchBudgets): void {
  for (const [name, value] of [
    ['maxTouchesPerRecord', budgets.maxTouchesPerRecord],
    ['maxRangesPerTouch', budgets.maxRangesPerTouch],
    ['maxEvidenceBytes', budgets.maxEvidenceBytes],
    ['maxRecordBytes', budgets.maxRecordBytes]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`planned-touch ${name} must be a non-negative integer`);
  }
}

function validRange(value: unknown): value is LineRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as Partial<LineRange>;
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    (range.start as number) >= 1 &&
    (range.end as number) >= (range.start as number)
  );
}

function normalizeEvidence(value: PreStateEvidence | undefined): PreStateEvidence | undefined {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'literal-occurrences':
      if (
        typeof value.literal !== 'string' ||
        !Array.isArray(value.ranges) ||
        !value.ranges.every(validRange) ||
        !Number.isSafeInteger(value.expectedCount) ||
        value.expectedCount < 0
      ) {
        throw new Error('invalid literal-occurrences evidence');
      }
      return {
        kind: value.kind,
        literal: value.literal,
        ranges: value.ranges.map(({ start, end }) => ({ start, end })),
        expectedCount: value.expectedCount
      };
    case 'anchor':
      if (typeof value.literal !== 'string' || !Number.isSafeInteger(value.line) || value.line < 1) {
        throw new Error('invalid anchor evidence');
      }
      return { kind: value.kind, literal: value.literal, line: value.line };
    case 'eof':
      if (
        !Number.isSafeInteger(value.line) ||
        value.line < 0 ||
        !Number.isSafeInteger(value.byteLength) ||
        value.byteLength < 0
      ) {
        throw new Error('invalid eof evidence');
      }
      return { kind: value.kind, line: value.line, byteLength: value.byteLength };
    case 'content-digest':
      if (value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value.digest) || !validRange(value.range)) {
        throw new Error('invalid content-digest evidence');
      }
      return {
        kind: value.kind,
        algorithm: value.algorithm,
        digest: value.digest,
        range: { start: value.range.start, end: value.range.end }
      };
    case 'tracked':
      if (value.tracked !== true) throw new Error('invalid tracked evidence');
      return { kind: value.kind, tracked: true };
    default:
      throw new Error('invalid planned-touch evidence kind');
  }
}

function normalizePlannedTouchRecord(record: PlannedTouchRecord, budgets: PlannedTouchBudgets): PlannedTouchRecord {
  if (
    typeof record !== 'object' ||
    record === null ||
    record.version !== 1 ||
    typeof record.sessionId !== 'string' ||
    record.sessionId.length === 0 ||
    typeof record.toolUseId !== 'string' ||
    record.toolUseId.length === 0 ||
    typeof record.repoRoot !== 'string' ||
    record.repoRoot.length === 0 ||
    !Number.isFinite(record.createdAtMs) ||
    record.createdAtMs < 0 ||
    !Array.isArray(record.touches)
  ) {
    throw new Error('invalid planned-touch record');
  }
  const repoRoot = toPosix(record.repoRoot);
  if (!nodePath.isAbsolute(record.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
    throw new Error('planned-touch repository root must be absolute');
  }
  if (record.touches.length > budgets.maxTouchesPerRecord) {
    throw new Error('planned-touch record exceeds touch budget');
  }

  let evidenceBytes = 0;
  const touches = record.touches.map((touch): PlannedTouch => {
    if (typeof touch !== 'object' || touch === null) throw new Error('invalid planned touch');
    const repoRelativePath = toPosix(touch.repoRelativePath);
    if (
      repoRelativePath.length === 0 ||
      repoRelativePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(repoRelativePath) ||
      repoRelativePath.split('/').some((part) => part === '..')
    ) {
      throw new Error('planned-touch path must be repository-relative');
    }
    if (!OPERATIONS.has(touch.operation)) throw new Error('invalid planned-touch operation');
    if (!Array.isArray(touch.ranges) || touch.ranges.length > budgets.maxRangesPerTouch) {
      throw new Error('planned touch exceeds range budget');
    }
    if (!touch.ranges.every(validRange)) throw new Error('invalid planned-touch range');
    if (!Number.isSafeInteger(touch.simpleCommandIndex) || touch.simpleCommandIndex < 0) {
      throw new Error('invalid planned-touch command index');
    }
    const evidence = normalizeEvidence(touch.evidence);
    if (evidence !== undefined) evidenceBytes += Buffer.byteLength(JSON.stringify(evidence));
    return {
      repoRelativePath,
      operation: touch.operation,
      ranges: touch.ranges.map((range: LineRange) => ({ start: range.start, end: range.end })),
      simpleCommandIndex: touch.simpleCommandIndex,
      ...(evidence === undefined ? {} : { evidence })
    };
  });
  if (evidenceBytes > budgets.maxEvidenceBytes) throw new Error('planned-touch record exceeds evidence budget');

  const normalized: PlannedTouchRecord = {
    version: 1,
    sessionId: record.sessionId,
    toolUseId: record.toolUseId,
    repoRoot,
    createdAtMs: record.createdAtMs,
    touches
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > budgets.maxRecordBytes) {
    throw new Error('planned-touch record exceeds byte budget');
  }
  return normalized;
}

/** A path candidate supplied by any command-, response-, or structured-tool producer. */
export interface TrackedEligibilityCandidate<T> {
  readonly absolutePath: string;
  readonly value: T;
}

export type TrackedEligibilityDropReason =
  | 'outside-repository'
  | 'ignored-path'
  | 'span-metadata-path'
  | 'untracked-path';

export interface TrackedEligibilityDrop<T> {
  readonly candidate: TrackedEligibilityCandidate<T>;
  readonly reason: TrackedEligibilityDropReason;
}

export interface TrackedEligibilityResult<T> {
  readonly eligible: readonly TrackedEligibilityCandidate<T>[];
  readonly dropped: readonly TrackedEligibilityDrop<T>[];
  /** Number of `git ls-files` calls; at most one per resolved repository. */
  readonly subprocessCount: number;
}

/** Executes one NUL-delimited tracked-membership query for a repository. */
export type TrackedFilesQuery = (repoRoot: string, repoRelativePaths: readonly string[]) => ReadonlySet<string>;

export interface TrackedEligibilityOptions {
  readonly cwd: string;
  readonly queryTrackedFiles?: TrackedFilesQuery;
}

/** Query the index without consulting the working tree or untracked files. */
export const queryTrackedFiles: TrackedFilesQuery = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return new Set();
  const stdout = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--cached', '--', ...repoRelativePaths], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return new Set(
    stdout
      .split('\0')
      .filter((path) => path.length > 0)
      .map(toPosix)
  );
};

/** Filter all candidates in repository batches, preserving their original payloads and order. */
export function filterTrackedEligibility<T>(
  candidates: readonly TrackedEligibilityCandidate<T>[],
  options: TrackedEligibilityOptions
): TrackedEligibilityResult<T> {
  const eligible: TrackedEligibilityCandidate<T>[] = [];
  const dropped: TrackedEligibilityDrop<T>[] = [];
  const cwdRepoRoot = resolveRepoRoot(options.cwd);
  if (cwdRepoRoot === null) {
    return {
      eligible,
      dropped: candidates.map((candidate) => ({ candidate, reason: 'outside-repository' })),
      subprocessCount: 0
    };
  }

  const repoByDirectory = new Map<string, string | null>();
  const inScope: Array<{ candidate: TrackedEligibilityCandidate<T>; repoRoot: string; repoRelativePath: string }> = [];
  const spanRoot = resolveSpanRoot(cwdRepoRoot);
  for (const candidate of candidates) {
    const directory = toPosix(nodePath.dirname(candidate.absolutePath));
    let fileRepoRoot = repoByDirectory.get(directory);
    if (fileRepoRoot === undefined) {
      fileRepoRoot = resolveRepoRoot(directory);
      repoByDirectory.set(directory, fileRepoRoot);
    }
    if (fileRepoRoot !== cwdRepoRoot) {
      dropped.push({ candidate, reason: 'outside-repository' });
      continue;
    }
    const repoRelativePath = relativeToRepo(cwdRepoRoot, candidate.absolutePath);
    if (isGitIgnored(cwdRepoRoot, repoRelativePath)) {
      dropped.push({ candidate, reason: 'ignored-path' });
      continue;
    }
    if (isInsideSpanRoot(repoRelativePath, spanRoot)) {
      dropped.push({ candidate, reason: 'span-metadata-path' });
      continue;
    }
    inScope.push({ candidate, repoRoot: cwdRepoRoot, repoRelativePath });
  }

  const byRepo = new Map<string, typeof inScope>();
  for (const scoped of inScope) {
    const group = byRepo.get(scoped.repoRoot) ?? [];
    group.push(scoped);
    byRepo.set(scoped.repoRoot, group);
  }

  let subprocessCount = 0;
  const query = options.queryTrackedFiles ?? queryTrackedFiles;
  for (const [repoRoot, group] of byRepo) {
    const paths = [...new Set(group.map(({ repoRelativePath }) => repoRelativePath))];
    let tracked: ReadonlySet<string>;
    subprocessCount += 1;
    try {
      tracked = query(repoRoot, paths);
    } catch {
      tracked = new Set();
    }
    const normalizedTracked = new Set([...tracked].map(toPosix));
    for (const scoped of group) {
      if (normalizedTracked.has(scoped.repoRelativePath)) eligible.push(scoped.candidate);
      else dropped.push({ candidate: scoped.candidate, reason: 'untracked-path' });
    }
  }

  const candidateOrder = new Map(candidates.map((candidate, index) => [candidate, index]));
  eligible.sort((left, right) => (candidateOrder.get(left) ?? 0) - (candidateOrder.get(right) ?? 0));
  dropped.sort((left, right) => (candidateOrder.get(left.candidate) ?? 0) - (candidateOrder.get(right.candidate) ?? 0));
  return { eligible, dropped, subprocessCount };
}
