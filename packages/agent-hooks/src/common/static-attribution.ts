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
  canonicalizePath,
  isInsideSpanRoot,
  type LineRange,
  pruneStaleSessionsThrottled,
  resolveRepoRoot,
  resolveSpanRoot,
  type SessionLayout,
  toPosix
} from './agent-hooks-common.js';
import {
  type Operation,
  type ParseOptions,
  parseCommandDetailed,
  type ResolvedSpan,
  type SpanMatch
} from './parse-command.js';
import { argvOf, type SplitResult, splitTopLevel } from './shell-split.js';

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

/**
 * Direct command words understood by at least one static layer. Commands
 * outside this set need the shell parser only when they carry shell control
 * or redirection syntax; a plain `cargo test`/`rg`/`git status`-style command
 * can return the empty parse without allocating the full shell grammar.
 */
const STATIC_INTENT_COMMANDS: ReadonlySet<string> = new Set([
  ':',
  'autopep8',
  'biome',
  'black',
  'bunx',
  'cat',
  'cd',
  'clang-format',
  'command',
  'cp',
  'deno',
  'doas',
  'dprint',
  'echo',
  'env',
  'eslint',
  'false',
  'git',
  'gofmt',
  'goimports',
  'head',
  'install',
  'isort',
  'make',
  'mv',
  'nice',
  'nl',
  'node',
  'nohup',
  'npm',
  'npx',
  'patch',
  'perl',
  'pnpm',
  'prettier',
  'printf',
  'rm',
  'ruff',
  'rustfmt',
  'sed',
  'shfmt',
  'sudo',
  'tail',
  'tee',
  'terraform',
  'time',
  'truncate',
  'true',
  'xargs',
  'yapf',
  'yarn'
]);

const SHELL_INTENT_SYNTAX = /[<>|;&\n(){}$`]/;
const STATICALLY_SILENT_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'add',
  'branch',
  'commit',
  'config',
  'diff',
  'fetch',
  'ls-files',
  'pull',
  'push',
  'remote',
  'rev-parse',
  'status',
  'tag',
  'worktree'
]);

/** Cheap negative sentinel; false means every recognizer is provably irrelevant. */
function canCarryStaticIntent(command: string): boolean {
  const trimmed = command.trimStart();
  if (trimmed.length === 0) return false;
  if (SHELL_INTENT_SYNTAX.test(trimmed)) return true;
  const firstWord = trimmed.match(/^[^\s]+/)?.[0] ?? '';
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(firstWord)) return true;
  if (/^python(?:3(?:\.\d+)?)?$/.test(firstWord)) return true;
  if (firstWord === 'git') {
    const subcommand =
      trimmed
        .slice(firstWord.length)
        .trimStart()
        .match(/^[^\s]+/)?.[0] ?? '';
    if (STATICALLY_SILENT_GIT_SUBCOMMANDS.has(subcommand)) return false;
  }
  return STATIC_INTENT_COMMANDS.has(firstWord);
}

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

function expandLiteralLoopVariable(
  body: string,
  variable: string,
  binding: string
): { readonly command: string; readonly replacements: number; readonly unsafeUnquoted: boolean } {
  let command = '';
  let quote: "'" | '"' | null = null;
  let replacements = 0;
  let unsafeUnquoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '\\' && quote !== "'") {
      command += character;
      if (index + 1 < body.length) command += body[++index];
      continue;
    }
    if (character === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      command += character;
      continue;
    }
    if (character === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      command += character;
      continue;
    }
    if (character !== '$' || quote === "'") {
      command += character;
      continue;
    }
    const braced = body.startsWith(`\${${variable}}`, index);
    const plain = body.startsWith(`$${variable}`, index);
    const suffix = body[index + variable.length + 1];
    if (!braced && (!plain || (suffix !== undefined && /[A-Za-z0-9_]/.test(suffix)))) {
      command += character;
      continue;
    }
    const length = braced ? variable.length + 3 : variable.length + 1;
    if (quote === null && /\s/.test(binding)) unsafeUnquoted = true;
    command +=
      quote === '"'
        ? binding.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')
        : shellQuote(binding);
    replacements += 1;
    index += length - 1;
  }
  return { command, replacements, unsafeUnquoted };
}

function stableReason(match: Extract<SpanMatch, { status: 'unresolved' }>): UnresolvedReasonCode {
  if (match.fileArg.includes('$(') || match.fileArg.includes('`')) return 'command-substitution';
  if (SHELL_EXPANSION.test(match.fileArg)) return 'dynamic-path';
  if (GLOB_META.test(match.fileArg)) return 'glob-path';
  if (match.reason.includes('working directory')) return 'dynamic-path';
  return 'unsupported-expression';
}

interface PythonProgram {
  readonly program?: string;
  readonly reason?: UnresolvedReasonCode;
  readonly detail?: string;
}

interface PythonPathBinding {
  readonly path: string;
  readonly depth: 0 | 1;
}

interface PythonTextBinding {
  readonly path: string;
}

interface PythonReplacement {
  readonly source: string;
  readonly pattern: string;
  readonly replacement: string;
  readonly count?: number;
}

interface PythonLineArray {
  readonly path: string;
  readonly edits: Map<number, string>;
}

interface PythonStructuredValue {
  readonly format: 'json' | 'toml' | 'yaml';
  readonly path: string;
  readonly keys: string[][];
}

/**
 * Shared recognizer state threaded through every Python statement machine:
 * one map per binding family, the accumulating resolved set, and the
 * deduplicated pre-state requests. Free functions over this context replace
 * per-parse closures so each machine stays directly testable.
 */
interface PythonRecognizerContext {
  readonly cwd: string;
  readonly options: LayeredParseOptions;
  readonly paths: Map<string, PythonPathBinding>;
  readonly texts: Map<string, PythonTextBinding>;
  readonly replacements: Map<string, PythonReplacement>;
  readonly anchors: Map<string, { source: string; literal: string }>;
  readonly lines: Map<string, PythonLineArray>;
  readonly structured: Map<string, PythonStructuredValue>;
  readonly countAssertions: Map<string, number>;
  readonly resolved: LayeredResolvedMatch[];
  readonly preStateRequests: PreStateRequest[];
}

export function createPythonContext(options: LayeredParseOptions): PythonRecognizerContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    options,
    paths: new Map(),
    texts: new Map(),
    replacements: new Map(),
    anchors: new Map(),
    lines: new Map(),
    structured: new Map(),
    countAssertions: new Map(),
    resolved: [],
    preStateRequests: []
  };
}

function rejectPython(
  reasonCode: UnresolvedReasonCode,
  detail: string,
  fileArg?: string,
  preStateRequests: readonly PreStateRequest[] = []
): LayeredParseResult {
  return {
    resolved: [],
    unresolved: [unresolved('python', 'python-edit', reasonCode, detail, fileArg)],
    preStateRequests
  };
}

/** Records one pre-state need; duplicates by (path, operation, requirement) are absorbed. */
function requestPythonPreState(
  ctx: PythonRecognizerContext,
  absolutePath: string,
  operation: Operation,
  requirement: PreStateRequirement
): void {
  if (
    !ctx.preStateRequests.some(
      (entry) =>
        entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
    )
  ) {
    ctx.preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
  }
}

/**
 * Reads the caller-supplied pre-state snapshot, first registering every
 * missing requirement against operation `'modify'` — Python range recovery
 * always rewrites in place. Returns the content, or a complete rejection
 * when it is missing or binary.
 */
function readPythonPreState(
  ctx: PythonRecognizerContext,
  absolutePath: string,
  requirements: readonly PreStateRequirement[]
): string | LayeredParseResult {
  for (const requirement of requirements) requestPythonPreState(ctx, absolutePath, 'modify', requirement);
  const content = ctx.options.readPreState?.(absolutePath) ?? null;
  if (content === null)
    return rejectPython(
      'missing-pre-state',
      'Python range recovery requires pre-command text',
      absolutePath,
      ctx.preStateRequests
    );
  if (content.includes('\0'))
    return rejectPython(
      'binary-content',
      'Python range recovery does not accept binary content',
      absolutePath,
      ctx.preStateRequests
    );
  return content;
}

function emitPythonReplace(
  ctx: PythonRecognizerContext,
  absolutePath: string,
  transformation: PythonReplacement
): LayeredParseResult | null {
  const read = ctx.texts.get(transformation.source);
  if (read === undefined || nodePath.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectPython('unsupported-dataflow', 'Python read and write paths are not provably identical', absolutePath);
  }
  const requirements: PreStateRequirement[] = ['match-locations'];
  if (
    transformation.replacement.length === 0 ||
    (transformation.pattern.match(/\n/g)?.length ?? 0) !== (transformation.replacement.match(/\n/g)?.length ?? 0)
  ) {
    requirements.push('deleted-text');
  }
  const content = readPythonPreState(ctx, absolutePath, requirements);
  if (typeof content !== 'string') return content;
  const assertion = ctx.countAssertions.get(`${transformation.source}\0${transformation.pattern}`);
  const occurrences = countLiteralOccurrences(content, transformation.pattern);
  if (assertion !== undefined && occurrences !== assertion) {
    return rejectPython(
      'evidence-mismatch',
      'Python count assertion does not match pre-state',
      absolutePath,
      ctx.preStateRequests
    );
  }
  const count = transformation.count ?? occurrences;
  const ranges = literalOccurrenceRanges(content, transformation.pattern).slice(0, count);
  if (ranges.length === 0) {
    return rejectPython(
      'evidence-mismatch',
      'Python replacement literal is absent from pre-state',
      absolutePath,
      ctx.preStateRequests
    );
  }
  let expected = content;
  if (transformation.count === undefined)
    expected = content.split(transformation.pattern).join(transformation.replacement);
  else {
    for (let index = 0; index < Math.min(transformation.count, occurrences); index += 1) {
      expected = replaceLiteral(expected, transformation.pattern, transformation.replacement, false);
    }
  }
  for (const range of ranges) {
    ctx.resolved.push({
      status: 'resolved',
      layer: 'python',
      idiom: 'python-replace',
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: range.start,
        lineEnd: range.end,
        expectedContent: expected,
        simpleCommandIndex: 0
      }
    });
  }
  return null;
}

const PYTHON_INTERPRETER = /^(?:python|python3(?:\.\d+)?)$/;
const PYTHON_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
const PYTHON_NAME_SOURCE = `[A-Za-z_][A-Za-z0-9_]*`;

const compiledPatternCache = new Map<string, RegExp>();

/** Compile a runtime-built recognizer pattern once per distinct source, so hot loops never recompile. */
function compileOnce(source: string, flags?: string): RegExp {
  const key = `${flags ?? ''}\0${source}`;
  let pattern = compiledPatternCache.get(key);
  if (pattern === undefined) {
    pattern = new RegExp(source, flags);
    compiledPatternCache.set(key, pattern);
  }
  return pattern;
}

const PYTHON_PATH_LITERAL_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(?:Path|pathlib\\.Path)\\((${PYTHON_STRING_SOURCE})\\)$`
);
const PYTHON_STRING_BINDING_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
const PYTHON_NAME_ALIAS_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})$`);
const PYTHON_TEXT_READ_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(([^)]*)\\)$`
);
const PYTHON_REPLACE_BINDING_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
const PYTHON_COUNT_ASSERT_PATTERN = new RegExp(
  `^assert\\s+(${PYTHON_NAME_SOURCE})\\.count\\((${PYTHON_STRING_SOURCE})\\)\\s*==\\s*(\\d+)$`
);
const PYTHON_INDEX_ANCHOR_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.index\\((${PYTHON_STRING_SOURCE})\\)$`
);
const PYTHON_LINE_ARRAY_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\.splitlines\\(\\)$`
);
const PYTHON_LINE_EDIT_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\[(\\d+)\\]\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
const PYTHON_STRUCTURED_LOAD_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(json|tomllib|yaml)\\.(?:loads|safe_load)\\((${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\)$`
);
const PYTHON_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})((?:\\[${PYTHON_STRING_SOURCE}\\])+?)\\s*=\\s*(?:True|False|None|-?\\d+(?:\\.\\d+)?|${PYTHON_STRING_SOURCE})$`
);
const PYTHON_STRUCTURED_KEY_SCAN_PATTERN = new RegExp(`\\[(${PYTHON_STRING_SOURCE})\\]`, 'g');
const PYTHON_APPEND_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.open\\((${PYTHON_STRING_SOURCE})\\)\\.write\\((${PYTHON_STRING_SOURCE})\\)$`
);
const PYTHON_WRITE_TARGET_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\.write_text\\((.+)\\)$`);
const PYTHON_DIRECT_REPLACE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
const PYTHON_ANCHOR_SLICE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\[:(${PYTHON_NAME_SOURCE})\\]\\s*\\+\\s*(${PYTHON_STRING_SOURCE})\\s*\\+\\s*\\1\\[\\2\\s*\\+\\s*(\\d+):\\]$`
);
const PYTHON_LINE_JOIN_PATTERN = new RegExp(
  `^(${PYTHON_STRING_SOURCE})\\.join\\((${PYTHON_NAME_SOURCE})\\)(?:\\s*\\+\\s*(${PYTHON_STRING_SOURCE}))?$`
);

/** Decode the deliberately small common subset of Python string literals used by authoring commands. */
function decodePythonString(raw: string): string | null {
  if (raw.length < 2 || (raw[0] !== "'" && raw[0] !== '"') || raw.at(-1) !== raw[0]) return null;
  let value = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== '\\') {
      if (character === raw[0]) return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined || index + 1 >= raw.length - 1) return null;
    if (escaped === 'n') value += '\n';
    else if (escaped === 'r') value += '\r';
    else if (escaped === 't') value += '\t';
    else if (escaped === '\\' || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}

/**
 * Recognize only a literal `-c` payload or a quoted heredoc. The shell parser
 * is intentionally not asked to interpret an embedded program and no program
 * is ever imported or executed.
 */
function extractPythonProgram(command: string): PythonProgram | null {
  const trimmed = command.trim();
  const interpreter = trimmed.match(/^(python(?:3(?:\.\d+)?)?)\b/)?.[1];
  if (interpreter === undefined || !PYTHON_INTERPRETER.test(interpreter)) return null;

  if (trimmed.includes('<<')) {
    const heredoc = trimmed.match(
      /^(?:python|python3(?:\.\d+)?)\s+-\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: 'unsupported-syntax',
        detail: 'Python heredocs require a quoted literal delimiter and a complete body'
      };
    }
    return { program: heredoc[3] };
  }

  const argv = argvOf(trimmed);
  if (argv === null || argv[0] !== interpreter || argv[1] !== '-c' || argv[2] === undefined) {
    return {
      reason: 'unsupported-syntax',
      detail: 'only literal Python -c programs and quoted heredocs are supported'
    };
  }
  if (argv[2].includes('$(') || argv[2].includes('`') || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: 'unsupported-syntax', detail: 'the Python program is shell-derived rather than literal' };
  }
  return { program: argv[2] };
}

/** Split Python's allowlisted flat statement form without interpreting strings or nested expressions. */
function splitPythonStatements(program: string): readonly string[] | null {
  const statements: string[] = [];
  let statement = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  let comment = false;
  for (const character of program) {
    if (comment) {
      if (character === '\n') {
        comment = false;
        if (depth === 0 && statement.trim() !== '') {
          statements.push(statement.trim());
          statement = '';
        }
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === '\n' || character === ';') && depth === 0) {
      if (statement.trim() !== '') statements.push(statement.trim());
      statement = '';
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (statement.trim() !== '') statements.push(statement.trim());
  return statements;
}

function pythonLineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (content.charCodeAt(index) === 10) line += 1;
  return line;
}

function countLiteralOccurrences(content: string, literal: string): number {
  if (literal.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    count += 1;
    cursor = offset + literal.length;
  }
  return count;
}

function structuredKeyRanges(content: string, format: PythonStructuredValue['format'], key: string): LineRange[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern =
    format === 'json'
      ? compileOnce(`^[ \\t]*["']${escaped}["'][ \\t]*:`, 'm')
      : format === 'toml'
        ? compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*=`, 'm')
        : compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*:`, 'm');
  const ranges: LineRange[] = [];
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (pattern.test(line)) {
      const number = pythonLineAtOffset(content, offset);
      ranges.push({ start: number, end: number });
    }
    offset += line.length;
  }
  return ranges;
}

/**
 * Fallbacks for statements no machine claims: dynamic runtime input is
 * rejected as such, write-shaped statements as outside the dataflow
 * allowlist, everything else as unknown syntax.
 */
function consumeUnmatchedPython(statement: string): LayeredParseResult {
  if (/sys\.argv|os\.(?:environ|getenv)|input\s*\(/.test(statement)) {
    return rejectPython('dynamic-path', 'Python target depends on runtime input');
  }
  return rejectPython(
    /(?:\.write|open\s*\(|Path\s*\()/.test(statement) ? 'unsupported-dataflow' : 'unsupported-syntax',
    'Python statement is outside the bounded lexical/dataflow allowlist'
  );
}

/**
 * One pass of the Python statement machines over a single statement, in
 * fixed left-to-right order: binding recognizers first (path/string/alias
 * hops with their depth flags, text reads, replacement bindings, count
 * assertions, index anchors, line arrays and edits, structured loads and
 * key assignments), then the append machine, then the write-target sink.
 * Returns `undefined` when the statement was consumed, the complete
 * rejection when it must fail the whole program, or `'unmatched'` when no
 * machine claims it and the caller applies the dynamic-input and allowlist
 * fallbacks.
 */
function consumePythonStatement(
  statement: string,
  ctx: PythonRecognizerContext
): LayeredParseResult | 'unmatched' | undefined {
  let match = statement.match(PYTHON_PATH_LITERAL_PATTERN);
  if (match !== null) {
    const path = decodePythonString(match[2]);
    if (path === null) return rejectPython('unsupported-syntax', 'Python path literal uses an unsupported escape');
    ctx.paths.set(match[1], { path, depth: 0 });
    return undefined;
  }
  match = statement.match(PYTHON_STRING_BINDING_PATTERN);
  if (match !== null) {
    const path = decodePythonString(match[2]);
    if (path === null) return rejectPython('unsupported-syntax', 'Python string literal uses an unsupported escape');
    ctx.paths.set(match[1], { path, depth: 0 });
    return undefined;
  }
  match = statement.match(PYTHON_NAME_ALIAS_PATTERN);
  if (match !== null) {
    const source = ctx.paths.get(match[2]);
    if (source === undefined || source.depth !== 0) {
      return rejectPython('unsupported-dataflow', 'Python path aliases are limited to one literal hop');
    }
    ctx.paths.set(match[1], { path: source.path, depth: 1 });
    return undefined;
  }

  match = statement.match(PYTHON_TEXT_READ_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[2]);
    if (binding === undefined) return rejectPython('dynamic-path', 'Python read target is not a literal path binding');
    if (match[3].trim() !== '' && !/^encoding\s*=\s*['"]utf-?8['"]$/.test(match[3].trim())) {
      return rejectPython(
        'unsupported-encoding',
        'only default or UTF-8 Python text reads are supported',
        binding.path
      );
    }
    ctx.texts.set(match[1], { path: binding.path });
    return undefined;
  }

  match = statement.match(PYTHON_REPLACE_BINDING_PATTERN);
  if (match !== null) {
    if (!ctx.texts.has(match[2]))
      return rejectPython('unsupported-dataflow', 'Python replace source is not a direct text read');
    const pattern = decodePythonString(match[3]);
    const replacement = decodePythonString(match[4]);
    const count = match[5] === undefined ? undefined : Number.parseInt(match[5], 10);
    if (pattern === null || pattern.length === 0 || replacement === null || count === 0) {
      return rejectPython(
        'unsupported-expression',
        'Python replace requires non-empty literal input and a positive count'
      );
    }
    ctx.replacements.set(match[1], { source: match[2], pattern, replacement, count });
    return undefined;
  }

  match = statement.match(PYTHON_COUNT_ASSERT_PATTERN);
  if (match !== null) {
    const literal = decodePythonString(match[2]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[1])) {
      return rejectPython('unsupported-dataflow', 'Python count assertion is not tied to a direct text read');
    }
    ctx.countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
    return undefined;
  }

  match = statement.match(PYTHON_INDEX_ANCHOR_PATTERN);
  if (match !== null) {
    const literal = decodePythonString(match[3]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[2])) {
      return rejectPython('unsupported-dataflow', 'Python index anchor is not tied to a direct text read');
    }
    ctx.anchors.set(match[1], { source: match[2], literal });
    return undefined;
  }

  match = statement.match(PYTHON_LINE_ARRAY_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[2]);
    if (binding === undefined) return rejectPython('dynamic-path', 'Python line-array target is not literal');
    ctx.lines.set(match[1], { path: binding.path, edits: new Map() });
    return undefined;
  }
  match = statement.match(PYTHON_LINE_EDIT_PATTERN);
  if (match !== null) {
    const array = ctx.lines.get(match[1]);
    const value = decodePythonString(match[3]);
    if (array === undefined || value === null)
      return rejectPython('unsupported-dataflow', 'line edit is not a bounded literal array edit');
    array.edits.set(Number.parseInt(match[2], 10), value);
    return undefined;
  }

  match = statement.match(PYTHON_STRUCTURED_LOAD_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[3]);
    if (binding === undefined) return rejectPython('dynamic-path', 'structured Python load target is not literal');
    const format = match[2] === 'tomllib' ? 'toml' : (match[2] as 'json' | 'yaml');
    ctx.structured.set(match[1], { format, path: binding.path, keys: [] });
    return undefined;
  }
  match = statement.match(PYTHON_STRUCTURED_ASSIGN_PATTERN);
  if (match !== null && ctx.structured.has(match[1])) {
    const keys = [...match[2].matchAll(PYTHON_STRUCTURED_KEY_SCAN_PATTERN)].map((key) => decodePythonString(key[1]));
    if (keys.length === 0 || keys.some((key) => key === null)) {
      return rejectPython('unsupported-expression', 'structured Python mutation requires literal string keys');
    }
    ctx.structured.get(match[1])!.keys.push(keys as string[]);
    return undefined;
  }

  match = statement.match(PYTHON_APPEND_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[1]);
    const mode = decodePythonString(match[2]);
    const written = decodePythonString(match[3]);
    if (binding === undefined) return rejectPython('dynamic-path', 'Python append target is not literal');
    if (mode !== 'a' || written === null)
      return rejectPython('unsupported-expression', 'only literal text append mode is supported');
    const absolutePath = nodePath.resolve(ctx.cwd, binding.path);
    requestPythonPreState(ctx, absolutePath, 'append', 'pre-command-eof');
    const content = ctx.options.readPreState?.(absolutePath) ?? null;
    if (content === null)
      return rejectPython(
        'missing-pre-state',
        'Python append range requires pre-command text',
        absolutePath,
        ctx.preStateRequests
      );
    if (content.includes('\0'))
      return rejectPython(
        'binary-content',
        'Python append does not accept binary content',
        absolutePath,
        ctx.preStateRequests
      );
    const line = pythonLineAtOffset(content, content.length);
    ctx.resolved.push({
      status: 'resolved',
      layer: 'python',
      idiom: 'python-append',
      span: {
        operation: 'append',
        absolutePath,
        lineStart: line,
        lineEnd: line,
        written,
        expectedContent: `${content}${written}`,
        simpleCommandIndex: 0
      }
    });
    return undefined;
  }

  match = statement.match(PYTHON_WRITE_TARGET_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[1]);
    if (binding === undefined) return rejectPython('dynamic-path', 'Python write target is not literal');
    const absolutePath = nodePath.resolve(ctx.cwd, binding.path);
    return resolvePythonWriteSink(ctx, match[2].trim(), absolutePath);
  }

  return 'unmatched';
}

/** Extract and split a Python -c/heredoc program into budget-checked statements. `'unrecognized'` means the command is not a Python invocation in this layer's shapes at all - the caller returns null so the dispatcher can try other layers - distinct from `'rejected'`, which is a complete fail-closed verdict. */
function preparePythonStatements(
  command: string
):
  | { readonly kind: 'unrecognized' }
  | { readonly kind: 'rejected'; readonly result: LayeredParseResult }
  | { readonly kind: 'ready'; readonly statements: readonly string[] } {
  const extracted = extractPythonProgram(command);
  if (extracted === null) return { kind: 'unrecognized' };
  if (extracted.program === undefined) {
    return {
      kind: 'rejected',
      result: rejectPython(
        extracted.reason ?? 'unsupported-syntax',
        extracted.detail ?? 'unsupported Python invocation'
      )
    };
  }
  const statements = splitPythonStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return {
      kind: 'rejected',
      result: rejectPython('unsupported-syntax', 'the Python program is incomplete or cannot be tokenized')
    };
  }
  if (statements.length > 64) {
    return {
      kind: 'rejected',
      result: rejectPython('candidate-budget-exceeded', 'the Python program exceeds the statement budget')
    };
  }
  return { kind: 'ready', statements };
}

/** Run the per-statement machines in order; returns the terminal rejection, or null when all consumed. */
function runPythonStatements(statements: readonly string[], ctx: PythonRecognizerContext): LayeredParseResult | null {
  for (const statement of statements) {
    if (
      /^(?:from\s+pathlib\s+import\s+Path|import\s+(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys)(?:\s*,\s*(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys))*)$/.test(
        statement
      )
    ) {
      continue;
    }
    if (/^(?:for|while|if|def|class|with|try)\b/.test(statement)) {
      return rejectPython('unsupported-dataflow', 'control flow is outside the bounded Python recognizer');
    }
    const verdict = consumePythonStatement(statement, ctx);
    if (verdict === undefined) continue;
    return verdict === 'unmatched' ? consumeUnmatchedPython(statement) : verdict;
  }
  return null;
}

function parsePythonAttribution(command: string, options: LayeredParseOptions): LayeredParseResult | null {
  const prepared = preparePythonStatements(command);
  if (prepared.kind === 'unrecognized') return null;
  if (prepared.kind === 'rejected') return prepared.result;

  const ctx = createPythonContext(options);
  const rejected = runPythonStatements(prepared.statements, ctx);
  if (rejected !== null) return rejected;

  if (ctx.resolved.length === 0)
    return rejectPython('unsupported-dataflow', 'Python program has no supported authoring sink');
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  const overBudget = rejectOverBudget(ctx.resolved, 'python', 'python-edit', 'Python program', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved: ctx.resolved, unresolved: [], preStateRequests: ctx.preStateRequests };
}

interface NodeProgram {
  readonly program?: string;
  readonly reason?: UnresolvedReasonCode;
  readonly detail?: string;
}

interface NodePathBinding {
  readonly path: string;
  readonly depth: 0 | 1;
}

interface NodeTextBinding {
  readonly path: string;
}

interface NodeReplacement {
  readonly source: string;
  readonly pattern: string;
  readonly replacement: string;
  readonly global: boolean;
}

interface NodeStructuredValue {
  readonly path: string;
  readonly keys: string[][];
}

const NODE_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
const NODE_NAME_SOURCE = `[A-Za-z_$][A-Za-z0-9_$]*`;

const NODE_FS_MEMBER_PATTERN = new RegExp(`^(${NODE_NAME_SOURCE})\\.(readFileSync|writeFileSync|appendFileSync)$`);
const NODE_REQUIRE_FS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*require\\((['"])(?:node:)?fs\\2\\)$`
);
const NODE_STRING_DECL_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_STRING_SOURCE})$`
);
const NODE_NAME_ALIAS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_NAME_SOURCE})$`
);
const NODE_GENERIC_DECL_PATTERN = new RegExp(`^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(.+)$`);
const NODE_REPLACE_CALL_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})\\.(replace|replaceAll)\\((${NODE_STRING_SOURCE})\\s*,\\s*(${NODE_STRING_SOURCE})\\)$`
);
const NODE_JSON_PARSE_PATTERN = new RegExp(`^JSON\\.parse\\((${NODE_NAME_SOURCE})\\)$`);
const NODE_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})((?:(?:\\.${NODE_NAME_SOURCE})|(?:\\[${NODE_STRING_SOURCE}\\]))+)\\s*=\\s*(.+)$`
);
const NODE_KEY_SEGMENT_SCAN_PATTERN = new RegExp(`\\.(${NODE_NAME_SOURCE})|\\[(${NODE_STRING_SOURCE})\\]`, 'g');
const NODE_COUNT_GUARD_PATTERN = new RegExp(
  `^if\\s*\\(\\s*(${NODE_NAME_SOURCE})\\.split\\((${NODE_STRING_SOURCE})\\)\\.length\\s*-\\s*1\\s*!==?\\s*(\\d+)\\s*\\)\\s*throw\\b.+$`
);

/** Decode the small, unambiguous subset of JavaScript string literals used by authoring one-liners. */
function decodeNodeString(raw: string): string | null {
  if (raw.length < 2 || (raw[0] !== "'" && raw[0] !== '"') || raw.at(-1) !== raw[0]) return null;
  let value = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== '\\') {
      if (character === raw[0] || character === '\n' || character === '\r') return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined || index + 1 >= raw.length - 1) return null;
    if (escaped === 'n') value += '\n';
    else if (escaped === 'r') value += '\r';
    else if (escaped === 't') value += '\t';
    else if (escaped === 'b') value += '\b';
    else if (escaped === 'f') value += '\f';
    else if (escaped === 'v') value += '\v';
    else if (escaped === '0') value += '\0';
    else if (escaped === '\\' || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}

/**
 * Extract a literal Node program without evaluating shell or JavaScript. Other
 * Node invocations are left to the ordinary shell classifier.
 */
function extractNodeProgram(command: string): NodeProgram | null {
  const trimmed = command.trim();
  if (!/^node\b/.test(trimmed)) return null;

  if (trimmed.includes('<<')) {
    const heredoc = trimmed.match(
      /^node(?:\s+-)?\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: 'unsupported-syntax',
        detail: 'Node heredocs require a quoted literal delimiter and a complete body'
      };
    }
    return { program: heredoc[3] };
  }

  const argv = argvOf(trimmed);
  if (argv === null) {
    return /^node\s+-e(?:\s|$)/.test(trimmed)
      ? { reason: 'unsupported-syntax', detail: 'the literal Node -e program cannot be tokenized' }
      : null;
  }
  if (argv[0] !== 'node' || argv[1] !== '-e') return null;
  if (argv[2] === undefined) return { reason: 'unsupported-syntax', detail: 'Node -e requires a literal program' };
  if (argv[2].includes('$(') || argv[2].includes('`') || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: 'unsupported-syntax', detail: 'the Node program is shell-derived rather than literal' };
  }
  return { program: argv[2] };
}

/** Split the allowlisted flat JavaScript statement form without executing or fully parsing it. */
function splitNodeStatements(program: string): readonly string[] | null {
  if (program.includes('`')) return null;
  const statements: string[] = [];
  let statement = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < program.length; index += 1) {
    const character = program[index];
    const next = program[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        if (depth === 0 && statement.trim() !== '') {
          statements.push(statement.trim());
          statement = '';
        }
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === ';' || character === '\n') && depth === 0) {
      if (statement.trim() !== '') statements.push(statement.trim());
      statement = '';
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0 || blockComment) return null;
  if (statement.trim() !== '') statements.push(statement.trim());
  return statements;
}

/** Split a call's arguments at top-level commas, retaining literal source text. */
function splitNodeArguments(source: string): readonly string[] | null {
  const arguments_: string[] = [];
  let argument = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  for (const character of source) {
    if (quote !== null) {
      argument += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      argument += character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (character === ',' && depth === 0) {
      arguments_.push(argument.trim());
      argument = '';
      continue;
    }
    argument += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (argument.trim() !== '' || arguments_.length > 0) arguments_.push(argument.trim());
  return arguments_;
}

/**
 * Anchor-slice sink: rewrites exactly the one literal-anchored occurrence,
 * requiring the replacement to preserve the anchor's length.
 * Returns `undefined` when consumed, a complete rejection on dataflow or
 * evidence failure, `'unmatched'` when the shape does not apply.
 */

function emitPythonAnchorSlice(
  ctx: PythonRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | 'unmatched' | undefined {
  const slice = expression.match(PYTHON_ANCHOR_SLICE_PATTERN);
  if (slice === null) return 'unmatched';
  const anchor = ctx.anchors.get(slice[2]);
  const read = ctx.texts.get(slice[1]);
  const replacementText = decodePythonString(slice[3]);
  if (
    anchor === undefined ||
    read === undefined ||
    anchor.source !== slice[1] ||
    replacementText === null ||
    Number.parseInt(slice[4], 10) !== anchor.literal.length ||
    nodePath.resolve(ctx.cwd, read.path) !== absolutePath
  ) {
    return rejectPython(
      'unsupported-dataflow',
      'Python slice reconstruction is not tied to one literal anchor',
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ['match-locations', 'deleted-text']);
  if (typeof content !== 'string') return content;
  const offset = content.indexOf(anchor.literal);
  if (offset < 0)
    return rejectPython(
      'evidence-mismatch',
      'Python slice anchor is absent from pre-state',
      absolutePath,
      ctx.preStateRequests
    );
  const range = literalOccurrenceRanges(content, anchor.literal)[0];
  ctx.resolved.push({
    status: 'resolved',
    layer: 'python',
    idiom: 'python-anchor-slice',
    span: {
      operation: 'modify',
      absolutePath,
      lineStart: range.start,
      lineEnd: range.end,
      expectedContent: `${content.slice(0, offset)}${replacementText}${content.slice(offset + anchor.literal.length)}`,
      simpleCommandIndex: 0
    }
  });
  return undefined;
}

/**
 * Line-array sink: joins the edited array with a literal newline and writes
 * back only provably same-path arrays with at least one bounded edit.
 * Tri-state like the other sinks.
 */

function emitPythonLineJoin(
  ctx: PythonRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | 'unmatched' | undefined {
  const lineJoin = expression.match(PYTHON_LINE_JOIN_PATTERN);
  if (lineJoin === null) return 'unmatched';
  const delimiter = decodePythonString(lineJoin[1]);
  const array = ctx.lines.get(lineJoin[2]);
  const suffix = lineJoin[3] === undefined ? '' : decodePythonString(lineJoin[3]);
  if (delimiter !== '\n' || array === undefined || suffix === null || (suffix !== '' && suffix !== '\n')) {
    return rejectPython('unsupported-expression', 'line-array writes require a literal newline join', absolutePath);
  }
  if (nodePath.resolve(ctx.cwd, array.path) !== absolutePath || array.edits.size === 0) {
    return rejectPython(
      'unsupported-dataflow',
      'line-array read and write paths are not provably identical',
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ['deleted-text']);
  if (typeof content !== 'string') return content;
  if (content.includes('\r'))
    return rejectPython('unsupported-encoding', 'line-array edits require LF text', absolutePath, ctx.preStateRequests);
  const sourceLines = content.split('\n');
  if (sourceLines.at(-1) === '') sourceLines.pop();
  for (const [index, value] of array.edits) {
    if (index >= sourceLines.length)
      return rejectPython(
        'evidence-mismatch',
        'line-array index is outside pre-state',
        absolutePath,
        ctx.preStateRequests
      );
    sourceLines[index] = value;
  }
  const expectedContent = `${sourceLines.join('\n')}${suffix}`;
  for (const index of array.edits.keys()) {
    ctx.resolved.push({
      status: 'resolved',
      layer: 'python',
      idiom: 'python-line-array',
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: index + 1,
        lineEnd: index + 1,
        expectedContent,
        simpleCommandIndex: 0
      }
    });
  }
  return undefined;
}

/**
 * Structured-dump sink: json/toml/yaml dumps of a loaded-and-key-mutated
 * value back onto its own load path. Tri-state like the other sinks.
 */

function emitPythonStructuredDump(
  ctx: PythonRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | 'unmatched' | undefined {
  const structuredSink = expression.match(/^(json|tomli_w|toml|yaml)\.(dumps|safe_dump)\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
  if (structuredSink === null) return 'unmatched';
  const value = ctx.structured.get(structuredSink[3]);
  const sinkFormat = structuredSink[1] === 'json' ? 'json' : structuredSink[1] === 'yaml' ? 'yaml' : 'toml';
  if (
    value === undefined ||
    value.format !== sinkFormat ||
    nodePath.resolve(ctx.cwd, value.path) !== absolutePath ||
    value.keys.length === 0
  ) {
    return rejectPython(
      'unsupported-dataflow',
      'structured read, literal-key mutation, and write are not linked',
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ['match-locations']);
  if (typeof content !== 'string') return content;
  for (const keyPath of value.keys) {
    const key = keyPath.at(-1)!;
    const ranges = structuredKeyRanges(content, value.format, key);
    if (ranges.length !== 1) {
      return rejectPython(
        'unsupported-expression',
        'structured literal key is absent or ambiguous in pre-state',
        absolutePath,
        ctx.preStateRequests
      );
    }
    ctx.resolved.push({
      status: 'resolved',
      layer: 'python',
      idiom: `python-${value.format}`,
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: ranges[0].start,
        lineEnd: ranges[0].end,
        simpleCommandIndex: 0
      }
    });
  }
  return undefined;
}

/**
 * The Python write-target sink chain, in fixed order: literal overwrite,
 * then inline-or-named literal replacement ([emitPythonReplace]), then the
 * anchor-slice, line-array, and structured-dump shapes. Every span push
 * happens here; nothing else in the recognizer resolves writes.
 * Returns `undefined` when some sink consumed the expression, or the
 * final allowlist rejection when none matched.
 */
export function resolvePythonWriteSink(
  ctx: PythonRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | undefined {
  const literal = decodePythonString(expression);
  if (literal !== null) {
    ctx.resolved.push({
      status: 'resolved',
      layer: 'python',
      idiom: 'python-write',
      span: {
        operation: 'create-overwrite',
        absolutePath,
        written: literal,
        expectedContent: literal,
        simpleCommandIndex: 0
      }
    });
    return undefined;
  }
  const directReplace = expression.match(PYTHON_DIRECT_REPLACE_PATTERN);
  const replacement =
    directReplace === null
      ? ctx.replacements.get(expression)
      : {
          source: directReplace[1],
          pattern: decodePythonString(directReplace[2]) ?? '',
          replacement: decodePythonString(directReplace[3]) ?? '',
          count: directReplace[4] === undefined ? undefined : Number.parseInt(directReplace[4], 10)
        };
  if (replacement !== undefined) {
    const rejected = emitPythonReplace(ctx, absolutePath, replacement);
    if (rejected !== null) return rejected;
    return undefined;
  }
  for (const sink of [emitPythonAnchorSlice, emitPythonLineJoin, emitPythonStructuredDump]) {
    const outcome = sink(ctx, expression, absolutePath);
    if (outcome !== 'unmatched') return outcome;
  }
  return rejectPython('unsupported-dataflow', 'Python write expression is outside the bounded allowlist', absolutePath);
}

/**
 * Shared recognizer state threaded through every Node statement machine:
 * the fs require tables, one map per binding family, the accumulating
 * resolved set, and the deduplicated pre-state requests. Free functions
 * over this context replace per-parse closures so each machine stays
 * directly testable.
 */
interface NodeRecognizerContext {
  readonly cwd: string;
  readonly options: LayeredParseOptions;
  readonly fsNamespaces: Set<string>;
  readonly fsFunctions: Map<string, 'readFileSync' | 'writeFileSync' | 'appendFileSync'>;
  readonly paths: Map<string, NodePathBinding>;
  readonly texts: Map<string, NodeTextBinding>;
  readonly replacements: Map<string, NodeReplacement>;
  readonly structured: Map<string, NodeStructuredValue>;
  readonly countAssertions: Map<string, number>;
  readonly resolved: LayeredResolvedMatch[];
  readonly preStateRequests: PreStateRequest[];
}

export function createNodeContext(options: LayeredParseOptions): NodeRecognizerContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    options,
    fsNamespaces: new Set(),
    fsFunctions: new Map(),
    paths: new Map(),
    texts: new Map(),
    replacements: new Map(),
    structured: new Map(),
    countAssertions: new Map(),
    resolved: [],
    preStateRequests: []
  };
}

function rejectNode(
  reasonCode: UnresolvedReasonCode,
  detail: string,
  fileArg?: string,
  preStateRequests: readonly PreStateRequest[] = []
): LayeredParseResult {
  return {
    resolved: [],
    unresolved: [unresolved('node', 'node-edit', reasonCode, detail, fileArg)],
    preStateRequests
  };
}

/** Records one pre-state need; duplicates by (path, operation, requirement) are absorbed. */
function requestNodePreState(
  ctx: NodeRecognizerContext,
  absolutePath: string,
  operation: Operation,
  requirement: PreStateRequirement
): void {
  if (
    !ctx.preStateRequests.some(
      (entry) =>
        entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
    )
  ) {
    ctx.preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
  }
}

/**
 * Reads the caller-supplied pre-state snapshot, registering each missing
 * requirement against the caller's operation — Node recovery spans carry
 * the operation of the sink that requested them. Returns the content, or a
 * complete rejection when it is missing or binary.
 */
function readNodePreState(
  ctx: NodeRecognizerContext,
  absolutePath: string,
  operation: Operation,
  requirements: readonly PreStateRequirement[]
): string | LayeredParseResult {
  for (const requirement of requirements) requestNodePreState(ctx, absolutePath, operation, requirement);
  const content = ctx.options.readPreState?.(absolutePath) ?? null;
  if (content === null)
    return rejectNode(
      'missing-pre-state',
      'Node range recovery requires pre-command text',
      absolutePath,
      ctx.preStateRequests
    );
  if (content.includes('\0'))
    return rejectNode(
      'binary-content',
      'Node range recovery does not accept binary content',
      absolutePath,
      ctx.preStateRequests
    );
  return content;
}

/** Resolves an argument expression to a literal path or one-hop alias binding. */
function nodeResolvePathExpression(ctx: NodeRecognizerContext, expression: string): NodePathBinding | null {
  const literal = decodeNodeString(expression.trim());
  if (literal !== null) return { path: literal, depth: 0 };
  return ctx.paths.get(expression.trim()) ?? null;
}

/** Resolves a callee expression to one of the three allowlisted sync fs methods. */
function nodeFsMethod(
  ctx: NodeRecognizerContext,
  callee: string
): 'readFileSync' | 'writeFileSync' | 'appendFileSync' | null {
  const bare = ctx.fsFunctions.get(callee);
  if (bare !== undefined) return bare;
  const member = callee.match(NODE_FS_MEMBER_PATTERN);
  if (member !== null && ctx.fsNamespaces.has(member[1])) {
    return member[2] as 'readFileSync' | 'writeFileSync' | 'appendFileSync';
  }
  const required = callee.match(/^require\((['"])(?:node:)?fs\1\)\.(readFileSync|writeFileSync|appendFileSync)$/);
  return (required?.[2] as 'readFileSync' | 'writeFileSync' | 'appendFileSync' | undefined) ?? null;
}

/** Parses an fs call shape into method + split arguments, or null when not an allowlisted call. */
function nodeParseCall(
  ctx: NodeRecognizerContext,
  expression: string
): { readonly method: ReturnType<typeof nodeFsMethod>; readonly args: readonly string[] } | null {
  const call =
    expression
      .trim()
      .match(/^(require\((['"])(?:node:)?fs\2\)\.(?:readFileSync|writeFileSync|appendFileSync))\(([\s\S]*)\)$/) ??
    expression.trim().match(/^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(([\s\S]*)\)$/);
  if (call === null) return null;
  const method = nodeFsMethod(ctx, call[1].trim());
  if (method === null) return null;
  const args = splitNodeArguments(call.length === 4 ? call[3] : call[2]);
  return args === null ? null : { method, args };
}

/**
 * The Node replacement sink: rewrites literal occurrences on the provably
 * identical read path. Requests match-locations only — unlike Python, no
 * deleted-text derivation even when the newline count changes.
 */
function emitNodeReplacement(
  ctx: NodeRecognizerContext,
  absolutePath: string,
  replacement: NodeReplacement
): LayeredParseResult | null {
  const read = ctx.texts.get(replacement.source);
  if (read === undefined || nodePath.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectNode(
      'unsupported-dataflow',
      'Node replacement read and write paths are not provably identical',
      absolutePath
    );
  }
  const content = readNodePreState(ctx, absolutePath, 'modify', ['match-locations']);
  if (typeof content !== 'string') return content;
  const occurrences = countLiteralOccurrences(content, replacement.pattern);
  const assertion = ctx.countAssertions.get(`${replacement.source}\0${replacement.pattern}`);
  if (assertion !== undefined && occurrences !== assertion) {
    return rejectNode(
      'evidence-mismatch',
      'Node count assertion does not match pre-state',
      absolutePath,
      ctx.preStateRequests
    );
  }
  const ranges = literalOccurrenceRanges(content, replacement.pattern);
  if (ranges.length === 0) {
    return rejectNode(
      'evidence-mismatch',
      'Node replacement literal is absent from pre-state',
      absolutePath,
      ctx.preStateRequests
    );
  }
  const affected = replacement.global ? ranges : ranges.slice(0, 1);
  const expectedContent = replaceLiteral(content, replacement.pattern, replacement.replacement, replacement.global);
  for (const range of affected) {
    ctx.resolved.push({
      status: 'resolved',
      layer: 'node',
      idiom: 'node-replace',
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: range.start,
        lineEnd: range.end,
        expectedContent,
        simpleCommandIndex: 0
      }
    });
  }
  return null;
}

/**
 * One pass of the Node statement machines over a single statement, in
 * fixed left-to-right order: fs require tables, path/string bindings with
 * their alias-depth flags, generic declarations (text reads, replacements,
 * structured loads), structured key assignments, count guards, and the
 * append/write call machines. Returns `undefined` when the statement was
 * consumed, the complete rejection when it fails the program, or
 * `'unmatched'` when no machine claims it.
 */
function consumeNodeStatement(
  statement: string,
  ctx: NodeRecognizerContext
): LayeredParseResult | 'unmatched' | undefined {
  let match = statement.match(NODE_REQUIRE_FS_PATTERN);
  if (match !== null) {
    ctx.fsNamespaces.add(match[1]);
    return undefined;
  }
  match = statement.match(/^const\s+\{([^}]+)\}\s*=\s*require\((['"])(?:node:)?fs\2\)$/);
  if (match !== null) {
    for (const entry of match[1].split(',')) {
      const binding = entry
        .trim()
        .match(/^(readFileSync|writeFileSync|appendFileSync)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/);
      if (binding === null)
        return rejectNode('unsupported-syntax', 'Node fs destructuring contains an unsupported binding');
      ctx.fsFunctions.set(binding[2] ?? binding[1], binding[1] as 'readFileSync' | 'writeFileSync' | 'appendFileSync');
    }
    return undefined;
  }

  match = statement.match(NODE_STRING_DECL_PATTERN);
  if (match !== null) {
    const path = decodeNodeString(match[2]);
    if (path === null) return rejectNode('unsupported-syntax', 'Node string literal uses an unsupported escape');
    ctx.paths.set(match[1], { path, depth: 0 });
    return undefined;
  }
  match = statement.match(NODE_NAME_ALIAS_PATTERN);
  if (match !== null) {
    const source = ctx.paths.get(match[2]);
    if (source === undefined || source.depth !== 0) {
      return rejectNode('unsupported-dataflow', 'Node path aliases are limited to one literal hop');
    }
    ctx.paths.set(match[1], { path: source.path, depth: 1 });
    return undefined;
  }

  match = statement.match(NODE_GENERIC_DECL_PATTERN);
  if (match !== null) {
    const name = match[1];
    const expression = match[2].trim();
    const call = nodeParseCall(ctx, expression);
    if (call?.method === 'readFileSync') {
      const binding = call.args[0] === undefined ? null : nodeResolvePathExpression(ctx, call.args[0]);
      if (binding === null) return rejectNode('dynamic-path', 'Node read target is not a literal path binding');
      const encoding = call.args[1] === undefined ? null : decodeNodeString(call.args[1]);
      if (encoding !== 'utf8' && encoding !== 'utf-8') {
        return rejectNode('unsupported-encoding', 'Node text reads require an explicit UTF-8 encoding', binding.path);
      }
      if (call.args.length !== 2)
        return rejectNode('unsupported-syntax', 'Node readFileSync call has unsupported arguments');
      ctx.texts.set(name, { path: binding.path });
      return undefined;
    }

    const replacement = expression.match(NODE_REPLACE_CALL_PATTERN);
    if (replacement !== null) {
      if (!ctx.texts.has(replacement[1]))
        return rejectNode('unsupported-dataflow', 'Node replace source is not a direct text read');
      const pattern = decodeNodeString(replacement[3]);
      const replacementText = decodeNodeString(replacement[4]);
      if (pattern === null || pattern.length === 0 || replacementText === null || replacementText.includes('$')) {
        return rejectNode('unsupported-expression', 'Node replace requires non-empty literal input');
      }
      ctx.replacements.set(name, {
        source: replacement[1],
        pattern,
        replacement: replacementText,
        global: replacement[2] === 'replaceAll'
      });
      return undefined;
    }

    const parsedJson = expression.match(NODE_JSON_PARSE_PATTERN);
    if (parsedJson !== null) {
      const text = ctx.texts.get(parsedJson[1]);
      if (text === undefined) return rejectNode('unsupported-dataflow', 'JSON.parse source is not a direct text read');
      ctx.structured.set(name, { path: text.path, keys: [] });
      return undefined;
    }
    const directJson = expression.match(/^JSON\.parse\((.+)\)$/);
    if (directJson !== null) {
      const read = nodeParseCall(ctx, directJson[1]);
      if (read?.method !== 'readFileSync' || read.args[0] === undefined) {
        return rejectNode('unsupported-dataflow', 'JSON.parse source is not a direct Node text read');
      }
      const binding = nodeResolvePathExpression(ctx, read.args[0]);
      const encoding = read.args[1] === undefined ? null : decodeNodeString(read.args[1]);
      if (binding === null) return rejectNode('dynamic-path', 'Node JSON target is not a literal path binding');
      if (encoding !== 'utf8' && encoding !== 'utf-8') {
        return rejectNode('unsupported-encoding', 'Node JSON reads require an explicit UTF-8 encoding', binding.path);
      }
      ctx.structured.set(name, { path: binding.path, keys: [] });
      return undefined;
    }
    return rejectNode('unsupported-dataflow', 'Node variable initializer is outside the bounded allowlist');
  }

  match = statement.match(NODE_STRUCTURED_ASSIGN_PATTERN);
  if (match !== null && ctx.structured.has(match[1])) {
    const keySegments = [...match[2].matchAll(NODE_KEY_SEGMENT_SCAN_PATTERN)];
    const keys = keySegments.map((segment) => segment[1] ?? decodeNodeString(segment[2]));
    if (keys.length === 0 || keys.some((key) => key === null)) {
      return rejectNode('unsupported-expression', 'structured Node mutation requires literal property keys');
    }
    if (!/^(?:true|false|null|-?\d+(?:\.\d+)?|(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))$/.test(match[3].trim())) {
      return rejectNode('unsupported-expression', 'structured Node mutation requires a literal value');
    }
    ctx.structured.get(match[1])!.keys.push(keys as string[]);
    return undefined;
  }

  match = statement.match(NODE_COUNT_GUARD_PATTERN);
  if (match !== null) {
    const literal = decodeNodeString(match[2]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[1])) {
      return rejectNode('unsupported-dataflow', 'Node count guard is not tied to a direct text read');
    }
    ctx.countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
    return undefined;
  }

  const call = nodeParseCall(ctx, statement);
  if (call?.method === 'appendFileSync') {
    const binding = call.args[0] === undefined ? null : nodeResolvePathExpression(ctx, call.args[0]);
    if (binding === null) return rejectNode('dynamic-path', 'Node append target is not a literal path binding');
    const written = call.args[1] === undefined ? null : decodeNodeString(call.args[1]);
    const encoding = call.args[2] === undefined ? 'utf8' : decodeNodeString(call.args[2]);
    if (written === null)
      return rejectNode('unsupported-expression', 'Node append content must be literal', binding.path);
    if (encoding !== 'utf8' && encoding !== 'utf-8') {
      return rejectNode('unsupported-encoding', 'Node append requires default or UTF-8 encoding', binding.path);
    }
    if (call.args.length < 2 || call.args.length > 3)
      return rejectNode('unsupported-syntax', 'Node appendFileSync call has unsupported arguments', binding.path);
    const absolutePath = nodePath.resolve(ctx.cwd, binding.path);
    const content = readNodePreState(ctx, absolutePath, 'append', ['pre-command-eof']);
    if (typeof content !== 'string') return content;
    const line = pythonLineAtOffset(content, content.length);
    ctx.resolved.push({
      status: 'resolved',
      layer: 'node',
      idiom: 'node-append',
      span: {
        operation: 'append',
        absolutePath,
        lineStart: line,
        lineEnd: line,
        written,
        expectedContent: `${content}${written}`,
        simpleCommandIndex: 0
      }
    });
    return undefined;
  }
  if (call?.method === 'writeFileSync') {
    const binding = call.args[0] === undefined ? null : nodeResolvePathExpression(ctx, call.args[0]);
    if (binding === null) return rejectNode('dynamic-path', 'Node write target is not a literal path binding');
    if (call.args.length < 2 || call.args.length > 3)
      return rejectNode('unsupported-syntax', 'Node writeFileSync call has unsupported arguments', binding.path);
    const encoding = call.args[2] === undefined ? 'utf8' : decodeNodeString(call.args[2]);
    if (encoding !== 'utf8' && encoding !== 'utf-8') {
      return rejectNode('unsupported-encoding', 'Node write requires default or UTF-8 encoding', binding.path);
    }
    const absolutePath = nodePath.resolve(ctx.cwd, binding.path);
    return resolveNodeWriteSink(ctx, call.args[1], absolutePath);
  }
  return 'unmatched';
}

/**
 * Fallbacks for statements no Node machine claims: async fs APIs and
 * promise plumbing are rejected as such; everything else by allowlist
 * shape.
 */
function consumeUnmatchedNode(statement: string): LayeredParseResult {
  if (/\b(?:readFile|writeFile|appendFile)\s*\(/.test(statement) || /\bPromise\b|\.then\s*\(/.test(statement)) {
    return rejectNode('unsupported-dataflow', 'asynchronous Node filesystem APIs are outside the bounded recognizer');
  }
  return rejectNode(
    /(?:writeFile|appendFile|readFile|require\s*\()/.test(statement) ? 'unsupported-dataflow' : 'unsupported-syntax',
    'Node statement is outside the bounded lexical/dataflow allowlist'
  );
}

/** Extract and split a Node -e/heredoc program into budget-checked statements. `'unrecognized'` means the command is not a Node invocation in this layer's shapes - the caller returns null for the dispatcher to try other layers - distinct from `'rejected'`, a complete fail-closed verdict. */
function prepareNodeStatements(
  command: string
):
  | { readonly kind: 'unrecognized' }
  | { readonly kind: 'rejected'; readonly result: LayeredParseResult }
  | { readonly kind: 'ready'; readonly statements: readonly string[] } {
  const extracted = extractNodeProgram(command);
  if (extracted === null) return { kind: 'unrecognized' };
  if (extracted.program === undefined) {
    return {
      kind: 'rejected',
      result: rejectNode(extracted.reason ?? 'unsupported-syntax', extracted.detail ?? 'unsupported Node invocation')
    };
  }
  if (/\b(?:process\.(?:argv|env)|require\s*\(\s*[^'"]|import\s*\()/.test(extracted.program)) {
    return {
      kind: 'rejected',
      result: rejectNode('dynamic-path', 'Node target depends on runtime input or a computed import')
    };
  }
  const statements = splitNodeStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return {
      kind: 'rejected',
      result: rejectNode('unsupported-syntax', 'the Node program is incomplete or cannot be tokenized')
    };
  }
  if (statements.length > 64) {
    return {
      kind: 'rejected',
      result: rejectNode('candidate-budget-exceeded', 'the Node program exceeds the statement budget')
    };
  }
  return { kind: 'ready', statements };
}

/** Run the per-statement machines in order; returns the terminal rejection, or null when all consumed. */
function runNodeStatements(statements: readonly string[], ctx: NodeRecognizerContext): LayeredParseResult | null {
  for (const statement of statements) {
    if (/^['"]use strict['"]$/.test(statement)) continue;
    if (/^(?:for|while|do|switch|function|class|async|await|try|with|import)\b/.test(statement)) {
      return rejectNode(
        'unsupported-dataflow',
        'control flow, asynchronous code, and imports are outside the Node recognizer'
      );
    }
    const verdict = consumeNodeStatement(statement, ctx);
    if (verdict === undefined) continue;
    return verdict === 'unmatched' ? consumeUnmatchedNode(statement) : verdict;
  }
  return null;
}

function parseNodeAttribution(command: string, options: LayeredParseOptions): LayeredParseResult | null {
  const prepared = prepareNodeStatements(command);
  if (prepared.kind === 'unrecognized') return null;
  if (prepared.kind === 'rejected') return prepared.result;

  const ctx = createNodeContext(options);
  const rejected = runNodeStatements(prepared.statements, ctx);
  if (rejected !== null) return rejected;

  if (ctx.resolved.length === 0)
    return rejectNode('unsupported-dataflow', 'Node program has no supported authoring sink');
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  const overBudget = rejectOverBudget(ctx.resolved, 'node', 'node-edit', 'Node program', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved: ctx.resolved, unresolved: [], preStateRequests: ctx.preStateRequests };
}

/** Parse explicit authoring intent through deterministic and bounded recognizers. */
/**
 * The Node write-target sink chain, in fixed order: literal overwrite,
 * then inline-or-named literal replacement ([emitNodeReplacement]), then
 * the structured dump. Returns `undefined` when some sink consumed the
 * expression, or the final allowlist rejection when none matched.
 */
export function resolveNodeWriteSink(
  ctx: NodeRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | undefined {
  const literal = decodeNodeString(expression);
  if (literal !== null) {
    ctx.resolved.push({
      status: 'resolved',
      layer: 'node',
      idiom: 'node-write',
      span: {
        operation: 'create-overwrite',
        absolutePath,
        written: literal,
        expectedContent: literal,
        simpleCommandIndex: 0
      }
    });
    return undefined;
  }
  const directReplacement = expression.match(NODE_REPLACE_CALL_PATTERN);
  const replacement =
    directReplacement === null
      ? ctx.replacements.get(expression)
      : {
          source: directReplacement[1],
          pattern: decodeNodeString(directReplacement[3]) ?? '',
          replacement: decodeNodeString(directReplacement[4]) ?? '',
          global: directReplacement[2] === 'replaceAll'
        };
  if (replacement !== undefined) {
    if (replacement.pattern.length === 0 || replacement.replacement.includes('$')) {
      return rejectNode('unsupported-expression', 'Node replace requires non-empty literal input', absolutePath);
    }
    const rejected = emitNodeReplacement(ctx, absolutePath, replacement);
    if (rejected !== null) return rejected;
    return undefined;
  }
  const dumped = emitNodeStructuredDump(ctx, expression, absolutePath);
  if (dumped !== 'unmatched') return dumped;
  return rejectNode('unsupported-dataflow', 'Node write expression is outside the bounded allowlist', absolutePath);
}

/**
 * The Node structured-dump sink: JSON.stringify of a loaded-and-key-mutated
 * value back onto its own read path. Tri-state like the Python sinks.
 */
function emitNodeStructuredDump(
  ctx: NodeRecognizerContext,
  expression: string,
  absolutePath: string
): LayeredParseResult | 'unmatched' | undefined {
  const serialized = expression.match(/^JSON\.stringify\(([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*null\s*,\s*\d+)?\)$/);
  if (serialized === null) return 'unmatched';
  const value = ctx.structured.get(serialized[1]);
  if (value === undefined || nodePath.resolve(ctx.cwd, value.path) !== absolutePath || value.keys.length === 0) {
    return rejectNode(
      'unsupported-dataflow',
      'JSON read, literal-key mutation, and write are not linked',
      absolutePath
    );
  }
  const content = readNodePreState(ctx, absolutePath, 'modify', ['match-locations']);
  if (typeof content !== 'string') return content;
  for (const keyPath of value.keys) {
    const key = keyPath.at(-1)!;
    const ranges = structuredKeyRanges(content, 'json', key);
    if (ranges.length !== 1) {
      return rejectNode(
        'unsupported-expression',
        'structured literal key is absent or ambiguous in pre-state',
        absolutePath,
        ctx.preStateRequests
      );
    }
    ctx.resolved.push({
      status: 'resolved',
      layer: 'node',
      idiom: 'node-json',
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: ranges[0].start,
        lineEnd: ranges[0].end,
        simpleCommandIndex: 0
      }
    });
  }
  return undefined;
}

/**
 * The numeric-sed machine: an in-place substitution addressed by literal line
 * numbers (`3s/…/…/`, `3,5s/…/…/`). Resolves each file operand to one modify
 * span over the addressed range with expected post-state content; binary or
 * unreadable pre-state resolves without expected content and therefore
 * without a match-locations request. Every path returns a complete
 * [LayeredParseResult].
 */
export function resolveNumericSed(
  patternCommand: PatternCommand,
  numericMatch: RegExpMatchArray,
  options: LayeredParseOptions,
  cwd: string,
  maxCandidates: number
): LayeredParseResult {
  if (patternCommand.files.length === 0) {
    return {
      resolved: [],
      unresolved: [
        unresolved('shell', 'sed-inplace', 'unsupported-syntax', 'numeric in-place substitution has no file operand')
      ],
      preStateRequests: []
    };
  }
  const start = Number.parseInt(numericMatch[1], 10);
  const end = Number.parseInt(numericMatch[2] ?? numericMatch[1], 10);
  const substitution = parseLiteralSubstitution(patternCommand.script.slice(numericMatch[0].indexOf('s')));
  if (substitution === null) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          'pattern-substitution',
          'sed-inplace',
          'unsupported-expression',
          'numeric substitutions require a literal pattern and replacement for post-state verification'
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
      unresolvedMatches.push(unresolved('shell', 'sed-inplace', reason, 'target path is dynamic', file));
      continue;
    }
    const absolutePath = nodePath.resolve(cwd, file);
    const content = options.readPreState?.(absolutePath) ?? null;
    const expectedContent =
      content === null || content.includes('\0')
        ? undefined
        : content
            .split(/(?<=\n)/)
            .map((line, index) =>
              index + 1 >= start && index + 1 <= end
                ? replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global)
                : line
            )
            .join('');
    resolved.push({
      status: 'resolved',
      layer: 'shell',
      idiom: 'sed-inplace',
      span: {
        operation: 'modify',
        absolutePath,
        lineStart: start,
        lineEnd: end,
        expectedContent,
        simpleCommandIndex: patternCommand.simpleCommandIndex
      }
    });
    if (expectedContent !== undefined) {
      preStateRequests.push({
        absolutePath,
        operation: 'modify',
        requirement: 'match-locations',
        simpleCommandIndex: patternCommand.simpleCommandIndex
      });
    }
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
  const overBudget = rejectOverBudget(resolved, 'shell', 'sed-inplace', 'numeric substitution', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: [], preStateRequests };
}

/**
 * The pattern-substitution machine for sed-addressed, perl, and perl-zero
 * in-place substitutions: parses the substitution (and a literal sed
 * address when present), then resolves each file operand against its
 * pre-state text into bounded modify spans. Every path returns a complete
 * [LayeredParseResult].
 */
/**
 * The per-kind result idiom shared by every pattern-substitution verdict.
 */
function patternIdiom(kind: PatternCommand['kind']): string {
  return kind === 'sed' ? 'sed-inplace' : 'perl-inplace';
}

/**
 * Parse the sed address prefix and the literal substitution expression, then
 * apply the shape validations shared by all three kinds. Returns either the
 * ready inputs or a complete fail-closed rejection.
 */
function preparePatternSubstitution(patternCommand: PatternCommand):
  | { readonly kind: 'rejected'; readonly result: LayeredParseResult }
  | {
      readonly kind: 'ready';
      readonly idiom: string;
      readonly addressLiteral: string | null;
      readonly substitution: LiteralSubstitution;
    } {
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
      kind: 'rejected',
      result: {
        resolved: [],
        unresolved: [
          unresolved(
            'pattern-substitution',
            patternIdiom(patternCommand.kind),
            'unsupported-expression',
            'only literal line-count-preserving substitutions are supported'
          )
        ],
        preStateRequests: []
      }
    };
  }
  if (patternCommand.files.length === 0) {
    return {
      kind: 'rejected',
      result: {
        resolved: [],
        unresolved: [
          unresolved(
            'pattern-substitution',
            patternIdiom(patternCommand.kind),
            'unsupported-syntax',
            'in-place substitution has no literal file operand'
          )
        ],
        preStateRequests: []
      }
    };
  }
  if (addressLiteral === null && patternCommand.kind === 'sed' && patternCommand.script.startsWith('/')) {
    return {
      kind: 'rejected',
      result: {
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
      }
    };
  }
  return { kind: 'ready', idiom: patternIdiom(patternCommand.kind), addressLiteral, substitution };
}

/**
 * Substitute one file operand: classify the path, request pre-state needs,
 * filter occurrence ranges by address / perl collapse / perl-zero arity, and
 * push resolved spans plus any backup copy. Appends to the caller's
 * accumulating sets exactly as the original inline loop did.
 */
function substituteOneFile(
  patternCommand: PatternCommand,
  idiom: string,
  addressLiteral: string | null,
  substitution: LiteralSubstitution,
  file: string,
  options: LayeredParseOptions,
  cwd: string,
  resolved: LayeredResolvedMatch[],
  unresolvedMatches: UnresolvedAttribution[],
  preStateRequests: PreStateRequest[]
): void {
  const reason = classifyDynamicWord(file);
  if (reason !== null) {
    unresolvedMatches.push(unresolved('pattern-substitution', idiom, reason, 'target path is dynamic', file));
    return;
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
        idiom,
        'missing-pre-state',
        'literal substitution range requires pre-command text',
        absolutePath
      )
    );
    return;
  }
  if (content.includes('\0')) {
    unresolvedMatches.push(
      unresolved(
        'pattern-substitution',
        idiom,
        'binary-content',
        'substitution range recovery does not accept NUL-delimited content',
        absolutePath
      )
    );
    return;
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
      idiom,
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

export function resolvePatternSubstitution(
  patternCommand: PatternCommand,
  options: LayeredParseOptions,
  cwd: string,
  maxCandidates: number
): LayeredParseResult {
  const prepared = preparePatternSubstitution(patternCommand);
  if (prepared.kind === 'rejected') return prepared.result;
  const { idiom, addressLiteral, substitution } = prepared;
  const resolved: LayeredResolvedMatch[] = [];
  const unresolvedMatches: UnresolvedAttribution[] = [];
  const preStateRequests: PreStateRequest[] = [];
  for (const file of patternCommand.files) {
    substituteOneFile(
      patternCommand,
      idiom,
      addressLiteral,
      substitution,
      file,
      options,
      cwd,
      resolved,
      unresolvedMatches,
      preStateRequests
    );
  }
  if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests };
  const overBudget = rejectOverBudget(resolved, 'pattern-substitution', idiom, 'substitution', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: [], preStateRequests };
}

/**
 * The shared candidate-budget tail: under the limit this declines (null) so
 * the caller proceeds, over the limit it produces the layer's
 * budget-exceeded rejection. `noun` names the producer in the detail string,
 * preserving each call site's exact wording.
 */
function rejectOverBudget(
  resolved: LayeredResolvedMatch[],
  layer: AttributionLayer,
  idiom: string,
  noun: string,
  maxCandidates: number
): LayeredParseResult | null {
  if (resolved.length <= maxCandidates) return null;
  return {
    resolved: [],
    unresolved: [
      unresolved(
        layer,
        idiom,
        'candidate-budget-exceeded',
        `${noun} produced ${resolved.length} candidates; the limit is ${maxCandidates}`
      )
    ],
    preStateRequests: []
  };
}

/**
 * The literal-list loop machine: `for <var> in <literal list>; do <body>;
 * done` expanded binding-by-binding through the stage recursor. Declines
 * nested loop bodies, dynamic or globbing lists, untokenizable lists, and
 * non-literal bindings fail-closed; each recursion forwards
 * `{...options, maxCandidates}` explicitly so the budget set at the
 * [parseCommandLayered] entry survives body expansion. When any binding is
 * unresolved the whole loop refuses (all-or-nothing); otherwise resolved
 * modify spans gain a match-locations pre-state request per touched file.
 */
export function parseLiteralListLoop(
  variable: string,
  listSource: string,
  body: string,
  options: LayeredParseOptions,
  maxCandidates: number,
  parse: (command: string, nextOptions: LayeredParseOptions) => LayeredParseResult
): LayeredParseResult {
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
      unresolved: [unresolved('literal-loop', 'literal-list-loop', 'dynamic-list', 'loop list is not a literal list')],
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
  const resolved: LayeredResolvedMatch[] = [];
  const unresolvedMatches: UnresolvedAttribution[] = [];
  const preStateRequests: PreStateRequest[] = [];
  for (const binding of bindings) {
    const dynamic = classifyDynamicWord(binding);
    if (dynamic !== null) {
      return {
        resolved: [],
        unresolved: [unresolved('literal-loop', 'literal-list-loop', dynamic, 'loop binding is not literal', binding)],
        preStateRequests: []
      };
    }
    const expanded = expandLiteralLoopVariable(body, variable, binding);
    if (expanded.unsafeUnquoted) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'literal-loop',
            'literal-list-loop',
            'unsupported-dataflow',
            'unquoted loop expansion would perform shell field splitting'
          )
        ],
        preStateRequests: []
      };
    }
    if (expanded.replacements === 0) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            'literal-loop',
            'literal-list-loop',
            'unsupported-dataflow',
            'loop variable is not used in an expandable shell context'
          )
        ],
        preStateRequests: []
      };
    }
    const result = parse(expanded.command, { ...options, maxCandidates });
    resolved.push(...result.resolved.map((match) => ({ ...match, layer: 'literal-loop' as const })));
    unresolvedMatches.push(...result.unresolved.map((match) => ({ ...match, layer: 'literal-loop' as const })));
    preStateRequests.push(...result.preStateRequests);
  }
  if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests: [] };
  const overBudget = rejectOverBudget(
    resolved,
    'literal-loop',
    'literal-list-loop',
    'literal expansion',
    maxCandidates
  );
  if (overBudget !== null) return overBudget;
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

/**
 * The compound-stage machine: a top-level multi-stage command (`&&`, `||`,
 * `;`, `|`, newlines) parsed stage-by-stage with per-stage
 * `simpleCommandIndex` and gating-operator bookkeeping. Declines (returns
 * `null`) unless the split is well-formed, has more than one stage, and
 * either carries no pipeline or hosts a layered-recognizable pipeline stage;
 * a directory-changing compound declines outright because substitution
 * targets cannot be resolved safely across a `cd`. In a pipeline, shell
 * stages keep only their resolved reads; layered stages contribute reads
 * after them and every write, reconciled in place so read-before-write
 * attribution order is preserved. Stage recursion receives the caller's
 * [options] object unchanged — `maxCandidates` forwarding stays at the
 * [parseCommandLayered] entry alone.
 */
export function parseCompoundStages(
  command: string,
  split: SplitResult,
  options: LayeredParseOptions,
  maxCandidates: number,
  parse: (command: string, nextOptions: LayeredParseOptions) => LayeredParseResult
): LayeredParseResult | null {
  const hasPipeline = split.stages.some((stage) => stage.precededBy === 'pipe');
  const hasLayeredPipelineStage = split.stages.some((stage) => {
    const stageText = stage.text.trimStart();
    return /^(?:python(?:3(?:\.\d+)?)?|node|for)\b/.test(stageText) || parsePatternCommand(stage.text) !== null;
  });
  if (!(split.malformed === undefined && split.stages.length > 1 && (!hasPipeline || hasLayeredPipelineStage))) {
    return null;
  }
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
    const child = parse(stage.text, options);
    const join: ResolvedSpan['join'] = stage.precededBy === 'and' ? '&&' : stage.precededBy === 'or' ? '||' : undefined;
    resolved.push(
      ...child.resolved.map((match) => ({
        ...match,
        span: { ...match.span, simpleCommandIndex: index, join }
      }))
    );
    unresolvedMatches.push(...child.unresolved.map((match) => ({ ...match, simpleCommandIndex: index })));
    preStateRequests.push(...child.preStateRequests.map((request) => ({ ...request, simpleCommandIndex: index })));
  }
  if (hasPipeline) {
    const pipelineDetailed = parseCommandDetailed(command, options);
    const pipelineReads = pipelineDetailed.flatMap<LayeredResolvedMatch>((match) =>
      match.status === 'resolved' && match.span.operation === 'read'
        ? [{ status: 'resolved', layer: 'shell', idiom: match.idiom, span: match.span }]
        : []
    );
    const pipelineUnresolved = pipelineDetailed.flatMap<UnresolvedAttribution>((match) =>
      match.status === 'unresolved'
        ? [unresolved('shell', match.idiom, stableReason(match), match.reason, match.fileArg)]
        : []
    );
    const layeredReads = resolved.filter(({ layer, span }) => layer !== 'shell' && span.operation === 'read');
    const writes = resolved.filter(({ span }) => span.operation !== 'read');
    resolved.splice(0, resolved.length, ...pipelineReads, ...layeredReads, ...writes);
    const layeredUnresolved = unresolvedMatches.filter(({ layer }) => layer !== 'shell');
    unresolvedMatches.splice(0, unresolvedMatches.length, ...pipelineUnresolved, ...layeredUnresolved);
  }
  const overBudget = rejectOverBudget(resolved, 'shell', 'compound-command', 'compound', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: unresolvedMatches, preStateRequests };
}

/**
 * History-changing and generator commands have no bounded file intent; they
 * refuse outright before the shell fallback runs.
 */
function historyOrGeneratorRefusal(argv: readonly string[]): LayeredParseResult | null {
  if (argv[0] === 'git' && ['rebase', 'merge', 'cherry-pick', 'reset'].includes(argv[1] ?? '')) {
    return {
      resolved: [],
      unresolved: [
        unresolved('shell', 'history-operation', 'history-operation', 'history-changing commands have no file intent')
      ],
      preStateRequests: []
    };
  }
  if (['yarn', 'npm', 'pnpm', 'make'].includes(argv[0]) && /(?:generate|build|install)/.test(argv.slice(1).join(' '))) {
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
  return null;
}

/**
 * The interpreter sentinel: cheap prefix tests precede the bounded Python and
 * Node lexical/dataflow recognizers, keeping ordinary Bash commands on the
 * existing fast path. Returns null when neither interpreter leads.
 */
function parseInterpreterAttribution(command: string, options: LayeredParseOptions): LayeredParseResult | null {
  const trimmed = command.trimStart();
  if (/^python(?:3(?:\.\d+)?)?\b/.test(trimmed)) {
    const python = parsePythonAttribution(command, options);
    if (python !== null) return python;
  }
  if (/^node\b/.test(trimmed)) {
    const node = parseNodeAttribution(command, options);
    if (node !== null) return node;
  }
  return null;
}

/** The deterministic shell fallback for commands no layered machine claims. */
function parseShellFallback(command: string, options: LayeredParseOptions, maxCandidates: number): LayeredParseResult {
  const detailed = parseCommandDetailed(command, options);
  const resolved = detailed.flatMap<LayeredResolvedMatch>((match) =>
    match.status === 'resolved' ? [{ status: 'resolved', layer: 'shell', idiom: match.idiom, span: match.span }] : []
  );
  const unresolvedMatches = detailed.flatMap<UnresolvedAttribution>((match) =>
    match.status === 'unresolved'
      ? [unresolved('shell', match.idiom, stableReason(match), match.reason, match.fileArg)]
      : []
  );
  const overBudget = rejectOverBudget(resolved, 'shell', 'deterministic-shell', 'command', maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: unresolvedMatches, preStateRequests: [] };
}

/**
 * The layered scheduler: entry budget validation, then interpreter sentinels,
 * the literal-list loop and compound-stage machines, the pattern stage
 * (numeric sed before general substitution), history/generator refusals, and
 * finally the deterministic shell fallback.
 */
export function parseCommandLayered(command: string, options: LayeredParseOptions = {}): LayeredParseResult {
  const cwd = options.cwd ?? process.cwd();
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('maxCandidates must be a positive safe integer');
  }

  if (!canCarryStaticIntent(command)) return { resolved: [], unresolved: [], preStateRequests: [] };

  const interpreted = parseInterpreterAttribution(command, options);
  if (interpreted !== null) return interpreted;

  const loop = command
    .trim()
    .match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]*?)\s*;\s*do\s+([\s\S]*?)\s*;\s*done\s*$/);
  if (loop !== null)
    return parseLiteralListLoop(loop[1], loop[2], loop[3], options, maxCandidates, parseCommandLayered);

  const split = splitTopLevel(command);
  const compound = parseCompoundStages(command, split, options, maxCandidates, parseCommandLayered);
  if (compound !== null) return compound;
  const patternCommand =
    split.malformed === undefined && split.stages.length === 1 ? parsePatternCommand(split.stages[0].text) : null;
  if (patternCommand !== null) {
    const numericMatch = patternCommand.kind === 'sed' ? patternCommand.script.match(/^(\d+)(?:,(\d+))?s\W/) : null;
    if (numericMatch !== null) return resolveNumericSed(patternCommand, numericMatch, options, cwd, maxCandidates);
    return resolvePatternSubstitution(patternCommand, options, cwd, maxCandidates);
  }

  const argv = argvOf(command.trim());
  if (argv !== null) {
    const refusal = historyOrGeneratorRefusal(argv);
    if (refusal !== null) return refusal;
  }
  return parseShellFallback(command, options, maxCandidates);
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
  readonly ignoreQueryCount: number;
  readonly trackedQueryCount: number;
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
    ignoreQueryCount: 0,
    trackedQueryCount: 0,
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

/** Production limits for one content-minimal pre-tool attribution plan. */
export const DEFAULT_PLANNED_TOUCH_BUDGETS: PlannedTouchBudgets = Object.freeze({
  maxTouchesPerRecord: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxRangesPerTouch: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxEvidenceBytes: 16 * 1024,
  maxRecordBytes: 64 * 1024
});

export interface PlannedTouchStore {
  /** Atomically replace the record for its session/tool-use key. */
  put(record: PlannedTouchRecord): void;
  /** Atomically consume the record; repeated consumption returns null. */
  consume(sessionId: string, toolUseId: string): PlannedTouchRecord | null;
  /** Claim a key while distinguishing a first delivery with no plan from a duplicate delivery. */
  take(
    sessionId: string,
    toolUseId: string
  ):
    | { readonly status: 'record'; readonly record: PlannedTouchRecord }
    | { readonly status: 'missing' }
    | { readonly status: 'consumed' };
  /** Idempotently discard any pending record for failure or interruption cleanup. */
  discard(sessionId: string, toolUseId: string): void;
}

/** Create the bounded disk-backed planned-touch store under a session layout. */
export function createPlannedTouchStore(layout: SessionLayout, budgets: PlannedTouchBudgets): PlannedTouchStore {
  validateBudgets(budgets);
  if (layout.base.length === 0) throw new Error('planned-touch base directory must not be empty');

  const recordPaths = (sessionId: string, toolUseId: string): { dir: string; record: string; consumed: string } => {
    if (sessionId.length === 0 || toolUseId.length === 0) {
      throw new Error('planned-touch session and tool-use ids must not be empty');
    }
    return {
      dir: layout.plannedTouchesDir(sessionId),
      record: layout.plannedTouchRecordFile(sessionId, toolUseId),
      consumed: layout.plannedTouchConsumedFile(sessionId, toolUseId)
    };
  };

  const makeRestrictiveDir = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(layout.base, 0o700);
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

  const take = (
    sessionId: string,
    toolUseId: string
  ):
    | { readonly status: 'record'; readonly record: PlannedTouchRecord }
    | { readonly status: 'missing' }
    | { readonly status: 'consumed' } => {
    pruneStaleSessionsThrottled(layout);
    const paths = recordPaths(sessionId, toolUseId);
    makeRestrictiveDir(paths.dir);
    if (!claim(paths.consumed)) return { status: 'consumed' };

    let raw: string;
    try {
      raw = fs.readFileSync(paths.record, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
      throw error;
    } finally {
      fs.rmSync(paths.record, { force: true });
    }

    try {
      const record = normalizePlannedTouchRecord(JSON.parse(raw) as PlannedTouchRecord, budgets);
      return { status: 'record', record };
    } catch {
      return { status: 'missing' };
    }
  };

  return {
    put(record) {
      pruneStaleSessionsThrottled(layout);
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
      const result = take(sessionId, toolUseId);
      return result.status === 'record' ? result.record : null;
    },
    take,
    discard(sessionId, toolUseId) {
      pruneStaleSessionsThrottled(layout);
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
  | 'untracked-path'
  | 'eligibility-query-failed';

export type TrackedEligibilityErrorKind = 'ignored-files-query-failed' | 'tracked-files-query-failed';

/** An operational query failure that caused eligibility to fail closed. */
export interface TrackedEligibilityError {
  readonly kind: TrackedEligibilityErrorKind;
  readonly repoRoot: string;
  readonly message: string;
}

export interface TrackedEligibilityDrop<T> {
  readonly candidate: TrackedEligibilityCandidate<T>;
  readonly reason: TrackedEligibilityDropReason;
}

export interface TrackedEligibilityResult<T> {
  readonly eligible: readonly TrackedEligibilityCandidate<T>[];
  readonly dropped: readonly TrackedEligibilityDrop<T>[];
  readonly errors: readonly TrackedEligibilityError[];
  /** Number of batched ignore queries; at most one per resolved repository. */
  readonly ignoreQueryCount: number;
  /** Number of batched index-membership queries; at most one per resolved repository. */
  readonly trackedQueryCount: number;
}

/** Executes one NUL-delimited tracked-membership query for a repository. */
export type TrackedFilesQuery = (repoRoot: string, repoRelativePaths: readonly string[]) => ReadonlySet<string>;

/** Executes one NUL-delimited ignore query for the invocation's candidate set. */
export type IgnoredFilesQuery = (repoRoot: string, repoRelativePaths: readonly string[]) => ReadonlySet<string>;

export interface TrackedEligibilityOptions {
  readonly cwd: string;
  readonly queryTrackedFiles?: TrackedFilesQuery;
  readonly queryIgnoredFiles?: IgnoredFilesQuery;
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

/** Query ignore rules once for the complete candidate set. */
export const queryIgnoredFiles: IgnoredFilesQuery = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return new Set();
  const input = `${repoRelativePaths.join('\0')}\0`;
  let stdout: string;
  try {
    stdout = execFileSync('git', ['-C', repoRoot, 'check-ignore', '--no-index', '-z', '--stdin'], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    if (failure.status !== 1) throw error;
    stdout = typeof failure.stdout === 'string' ? failure.stdout : '';
  }
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
  const errors: TrackedEligibilityError[] = [];
  if (candidates.length === 0) return { eligible, dropped, errors, ignoreQueryCount: 0, trackedQueryCount: 0 };
  const cwdRepoRoot = resolveRepoRoot(options.cwd);
  if (cwdRepoRoot === null) {
    return {
      eligible,
      dropped: candidates.map((candidate) => ({ candidate, reason: 'outside-repository' })),
      errors,
      ignoreQueryCount: 0,
      trackedQueryCount: 0
    };
  }

  const inScope: Array<{ candidate: TrackedEligibilityCandidate<T>; repoRoot: string; repoRelativePath: string }> = [];
  const spanRoot = resolveSpanRoot(cwdRepoRoot);
  for (const candidate of candidates) {
    const canonicalPath = canonicalizePath(candidate.absolutePath);
    const relativePath = nodePath.relative(cwdRepoRoot, canonicalPath);
    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${nodePath.sep}`) ||
      nodePath.isAbsolute(relativePath)
    ) {
      dropped.push({ candidate, reason: 'outside-repository' });
      continue;
    }
    const repoRelativePath = toPosix(relativePath);
    if (isInsideSpanRoot(repoRelativePath, spanRoot)) {
      dropped.push({ candidate, reason: 'span-metadata-path' });
      continue;
    }
    inScope.push({ candidate, repoRoot: cwdRepoRoot, repoRelativePath });
  }

  const ignoreQuery = options.queryIgnoredFiles ?? queryIgnoredFiles;
  let ignoreQueryCount = 0;
  let ignored: ReadonlySet<string>;
  try {
    const ignorePaths = [...new Set(inScope.map(({ repoRelativePath }) => repoRelativePath))];
    if (ignorePaths.length > 0) ignoreQueryCount += 1;
    ignored = ignoreQuery(cwdRepoRoot, ignorePaths);
  } catch (error) {
    errors.push({
      kind: 'ignored-files-query-failed',
      repoRoot: cwdRepoRoot,
      message: error instanceof Error ? error.message : String(error)
    });
    dropped.push(...inScope.map(({ candidate }) => ({ candidate, reason: 'eligibility-query-failed' as const })));
    const candidateOrder = new Map(candidates.map((candidate, index) => [candidate, index]));
    dropped.sort(
      (left, right) => (candidateOrder.get(left.candidate) ?? 0) - (candidateOrder.get(right.candidate) ?? 0)
    );
    return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount: 0 };
  }
  const normalizedIgnored = new Set([...ignored].map(toPosix));
  const eligibleForMembership = inScope.filter(({ candidate, repoRelativePath }) => {
    if (!normalizedIgnored.has(repoRelativePath)) return true;
    dropped.push({ candidate, reason: 'ignored-path' });
    return false;
  });

  const byRepo = new Map<string, typeof inScope>();
  for (const scoped of eligibleForMembership) {
    const group = byRepo.get(scoped.repoRoot) ?? [];
    group.push(scoped);
    byRepo.set(scoped.repoRoot, group);
  }

  let trackedQueryCount = 0;
  const query = options.queryTrackedFiles ?? queryTrackedFiles;
  for (const [repoRoot, group] of byRepo) {
    const paths = [...new Set(group.map(({ repoRelativePath }) => repoRelativePath))];
    let tracked: ReadonlySet<string>;
    trackedQueryCount += 1;
    try {
      tracked = query(repoRoot, paths);
    } catch (error) {
      errors.push({
        kind: 'tracked-files-query-failed',
        repoRoot,
        message: error instanceof Error ? error.message : String(error)
      });
      dropped.push(...group.map(({ candidate }) => ({ candidate, reason: 'eligibility-query-failed' as const })));
      continue;
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
  return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount };
}
