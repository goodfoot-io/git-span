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
    `"Load ${skill}. Check the notes for items relevant to this session. If any exist, follow the skill instructions to review them, remove completed notes, and report unresolved items."`,
    `Review scope: ${JSON.stringify(scope)}`,
    'Include other repositories used in this session in the review scope.',
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

/** The notes envelope is inspected; note documents remain opaque to the hook. */
export type NoteReviewCheck = (scope: NoteReviewScope, logger: MemoLogger) => Promise<boolean>;

/** Suppress review only after every known repository has been confirmed empty. */
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
      if (envelope.notes.length > 0) return true;
    }
    return false;
  } catch (err) {
    logger.warn('git-span could not confirm empty notes; requesting review', { err });
    return true;
  }
}
