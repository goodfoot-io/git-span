import { resolveRepoRoot } from './agent-hooks-common.js';
import type { CommitNotesIO } from './commit-io.js';
import { executeCommitNotes } from './commit-native-io.js';
import { resolveGitSpanCommand } from './git-span-command.js';
import { isRecord } from './guards.js';
import type { MemoLogger } from './span-surface.js';

export interface NoteReviewScope {
  host: 'claude' | 'codex' | 'opencode' | 'antigravity';
  sessionId: string;
  cwd: string;
  workspacePaths?: readonly string[];
}

/** Shared instructions with the host's installed skill name. */
export function reviewNotesPrompt(scope: NoteReviewScope): string {
  const skill = scope.host === 'claude' || scope.host === 'codex' ? 'git-span:review-notes' : 'review-notes';
  return [
    'Dispatch a forked subagent with this prompt:',
    `"Load the ${skill} skill then follow the instructions to document implicit couplings and specifications using \`git-span\`. Message agents if you identify code quality issues."`,
    'Wait for the subagent and include any blockers in your final response.'
  ].join('\n');
}

/** The host's continuation flag prevents repeated review. */
export async function reviewNotesStopReason(
  input: { stop_hook_active: boolean; session_id: string; cwd: string },
  host: 'claude' | 'codex',
  logger: MemoLogger,
  check: NoteReviewCheck = hasReviewNotes
): Promise<string | undefined> {
  if (input.stop_hook_active) return undefined;
  const scope = { host, sessionId: input.session_id, cwd: input.cwd };
  return (await check(scope, logger)) ? reviewNotesPrompt(scope) : undefined;
}

/** The notes envelope is inspected; only session identity fields of note documents are read. */
export type NoteReviewCheck = (scope: NoteReviewScope, logger: MemoLogger) => Promise<boolean>;

/**
 * Claude and Codex commit hooks tag notes with the session identity, so a note belongs to the session when its
 * document carries that identity. Antigravity and OpenCode write no session-tagged notes, so any note triggers review.
 */
function noteBelongsToSession(note: unknown, scope: NoteReviewScope): boolean {
  if (scope.host === 'antigravity' || scope.host === 'opencode') return true;
  if (!isRecord(note) || !isRecord(note.document)) return false;
  const document = note.document;
  if (document.session_id === scope.sessionId) return true;
  return document.host === scope.host && document.sessionId === scope.sessionId;
}

/** Request review only when a note for this session (any note, on Antigravity and OpenCode) is confirmed; any lookup failure skips review. */
export async function hasReviewNotes(scope: NoteReviewScope, logger: MemoLogger, io?: CommitNotesIO): Promise<boolean> {
  const deadline = performance.now() + 5_000;
  const repositories = new Set<string>();
  try {
    for (const directory of new Set([scope.cwd, ...(scope.workspacePaths ?? [])])) {
      if (!directory) continue;
      if (performance.now() >= deadline) throw new Error('note lookup deadline exhausted');
      const repository = resolveRepoRoot(directory);
      if (!repository || repositories.has(repository)) continue;
      repositories.add(repository);
      const resolved = resolveGitSpanCommand(['notes', 'list', '--format', 'json'], repository);
      const command = {
        cwd: repository,
        argv: resolved.argv,
        timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
        maxOutputBytes: 1_048_576
      };
      const result = await (io?.execute(command) ?? executeCommitNotes(resolved.executable, command));
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
        throw new Error('notes CLI unavailable, failed, or exceeded lookup bounds');
      const envelope: unknown = JSON.parse(result.stdout);
      if (!isRecord(envelope) || !Array.isArray(envelope.notes)) throw new Error('invalid notes list response');
      if (envelope.notes.some((note) => noteBelongsToSession(note, scope))) return true;
    }
    return false;
  } catch (err) {
    logger.warn('git-span notes lookup failed; skipping note review', { err });
    return false;
  }
}
