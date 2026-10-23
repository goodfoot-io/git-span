/** Read-only, complete pending-inspection reports independent of ordinary touch delivery. */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import { renderFullSpanContext } from './full-span-context.js';
import { resolveGitSpanCommand } from './git-span-command.js';
import { splitTopLevel, tokenize } from './shell-split.js';
import { type ContextDocument, decodeContextDocument } from './touch-core.js';

/** One supported literal invocation; native code owns all subcommand argument semantics. */
export interface PendingInspection {
  cwd: string;
  command: 'status' | 'diff';
  args: string[];
}

/** Unsupported candidate inspections consume ordinary diff attribution without claiming completeness. */
export type PendingInspectionParse =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'inspection'; inspection: PendingInspection };

/** Native empty success remains distinct from collection, schema, and execution errors. */
export type PendingContextResult = { ok: true; document: ContextDocument } | { ok: false; reason: string };

/** Thin native adapter; tests may supply real fixture documents without replacing host internals. */
export type PendingContextExecutor = (inspection: PendingInspection) => Promise<PendingContextResult>;

/** Reject expansion where Bash evaluates it, including partially quoted words. */
function hasExpansion(text: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (character === '\\') {
      if (text[index + 1] === '\n' || text[index + 1] === '\r') return true;
      index++;
      continue;
    }
    if (character === quote) {
      quote = null;
      continue;
    }
    if (quote === null && (character === "'" || character === '"')) {
      if (text[index + 1] === character) return true;
      quote = character;
      continue;
    }
    if (character === '$' || character === '`') return true;
    if (quote === null && character !== undefined && '*?[]{}~&;|<>'.includes(character)) return true;
  }
  return false;
}

/** Identify candidate commands without confusing literal mentions inside echo or other programs. */
function candidate(text: string): boolean {
  const words = tokenize(text)?.map((token) => token.text) ?? [];
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index++;
  if (words[index] === 'env') index++;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index++;
  if (words[index] !== 'git') return false;
  index++;
  for (; index < words.length; index++) {
    const word = words[index];
    if (
      word === '-C' ||
      word === '-c' ||
      word === '--git-dir' ||
      word === '--work-tree' ||
      word === '--config-env' ||
      word === '--exec-path' ||
      word === '--namespace' ||
      word === '--super-prefix'
    ) {
      index++;
      continue;
    }
    if (word?.startsWith('-') === true) continue;
    return word === 'status' || word === 'diff';
  }
  return false;
}

/** Recognize one literal Git command, preserving Git pathspecs and repeated literal -C options. */
export function parsePendingInspection(command: string, cwd: string): PendingInspectionParse {
  const split = splitTopLevel(command);
  if (!split.stages.some((stage) => candidate(stage.text))) return { kind: 'none' };
  const unsupported = (reason: string): PendingInspectionParse => ({ kind: 'unsupported', reason });
  if (Buffer.byteLength(command) > 64 * 1024) return unsupported('command exceeds the pending-inspection size limit');
  const stage = split.stages[0];
  if (
    split.malformed !== undefined ||
    split.stages.length !== 1 ||
    stage === undefined ||
    stage.precededBy !== 'start' ||
    stage.heredoc === true
  )
    return unsupported('pending inspections require one literal simple Git command');
  const tokens = tokenize(stage.text);
  if (tokens === null || tokens.some((token) => token.isRedirect) || hasExpansion(command))
    return unsupported('shell expansion and redirection are unsupported for pending inspections');
  const words = tokens.map((token) => token.text);
  if (words[0] !== 'git' || !isAbsolute(cwd)) return unsupported('pending inspection execution context is unavailable');
  let effectiveCwd = cwd;
  let index = 1;
  for (; index < words.length; index++) {
    const word = words[index];
    if (word === '--no-pager' || word === '-P') continue;
    if (word === '-C' || word?.startsWith('-C') === true) {
      const target = word === '-C' ? words[++index] : word.slice(2);
      if (target === undefined) return unsupported('missing Git -C directory');
      if (target !== '') {
        try {
          effectiveCwd = realpathSync.native(
            isAbsolute(target) ? target : `${realpathSync.native(effectiveCwd)}${sep}${target}`
          );
        } catch {
          return unsupported('Git -C directory is unavailable');
        }
      }
      continue;
    }
    break;
  }
  const builtin = words[index];
  if (builtin !== 'status' && builtin !== 'diff') return unsupported('unsupported Git global options or command form');
  return { kind: 'inspection', inspection: { cwd: effectiveCwd, command: builtin, args: words.slice(index + 1) } };
}

/** Render every selected relationship completely, or refuse a report exceeding its byte bound. */
export function renderPendingContext(document: ContextDocument, maxBytes = 256 * 1024): string | null {
  return renderFullSpanContext(document.spans, maxBytes);
}

/** Invoke pending-context directly through the resolved CLI with bounded read-only collection. */
export function createDefaultPendingContextExecutor(timeoutMs = 30_000): PendingContextExecutor {
  return async (inspection) => {
    try {
      const command = resolveGitSpanCommand(
        ['pending-context', inspection.command, '--', ...inspection.args],
        inspection.cwd
      );
      const stdout = execFileSync(command.executable, command.argv, {
        cwd: inspection.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024 + 1,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      });
      const document = decodeContextDocument(stdout);
      if (
        document.scopes.length !== 0 ||
        document.spans.some((span) => span.overlaps.length !== 0) ||
        Object.values(document.mutation).some((value) => value !== false && value !== 0)
      )
        throw new Error('pending context returned non-selection scopes or mutation evidence');
      return { ok: true, document };
    } catch (error) {
      const stderr = error !== null && typeof error === 'object' && 'stderr' in error ? error.stderr : undefined;
      const detail =
        typeof stderr === 'string' ? stderr.trim() : Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : '';
      return { ok: false, reason: detail || (error instanceof Error ? error.message : String(error)) };
    }
  };
}
