/** Versioned note provenance and bounded repository lookup. */
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
export interface ReviewNote {
  id: number;
  commit_sha: string;
  document: unknown;
}
export type NoteLookupOutcome =
  | { kind: 'empty' }
  | { kind: 'matching'; repositories: { cwd: string; notes: ReviewNote[] }[] }
  | { kind: 'failure'; reason: string };
export type NoteReviewCheck = (scope: NoteReviewScope, logger: MemoLogger) => Promise<NoteLookupOutcome>;

export function reviewError(err: unknown): string {
  return (err instanceof Error ? err.message : 'could not read commit notes').slice(0, 512);
}

/** Validate the entire list before selecting any document. Malformed entries cannot mean empty. */
function decodeReviewNotes(envelope: unknown): ReviewNote[] {
  if (
    !isRecord(envelope) ||
    envelope.schema_version !== 1 ||
    envelope.operation !== 'list' ||
    Object.keys(envelope).some((key) => !['schema_version', 'operation', 'notes'].includes(key))
  )
    throw new Error('invalid versioned notes list envelope');
  return decodeReviewNoteArray(envelope.notes);
}
function decodeReviewNoteArray(value: unknown): ReviewNote[] {
  if (!Array.isArray(value)) throw new Error('invalid captured notes');
  const ids = new Set<number>();
  return value.map((note) => {
    if (
      !isRecord(note) ||
      Object.keys(note).length !== 3 ||
      !Number.isSafeInteger(note.id) ||
      typeof note.id !== 'number' ||
      note.id <= 0 ||
      typeof note.commit_sha !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(note.commit_sha) ||
      !Object.hasOwn(note, 'document') ||
      ids.has(note.id)
    )
      throw new Error('invalid captured note tuple');
    ids.add(note.id);
    return { id: note.id, commit_sha: note.commit_sha, document: note.document };
  });
}
function noteBelongsToSession(note: ReviewNote, scope: NoteReviewScope): boolean {
  if (scope.host === 'antigravity' || scope.host === 'opencode') return true;
  if (!isRecord(note.document)) return false;
  const doc = note.document;
  return (
    (doc.schemaVersion === 1 && doc.host === scope.host && doc.sessionId === scope.sessionId) ||
    (doc.kind === 'git-span/uncovered-commit' &&
      doc.schema_version === 1 &&
      doc.session_id === scope.sessionId &&
      (doc.host === undefined || doc.host === scope.host))
  );
}
function reviewRepositories(scope: NoteReviewScope): string[] {
  const repositories = new Set<string>();
  for (const directory of new Set([scope.cwd, ...(scope.workspacePaths ?? [])])) {
    if (!directory) continue;
    const root = resolveRepoRoot(directory);
    if (root) repositories.add(root);
    if (repositories.size > 32) throw new Error('review repository budget exceeded');
  }
  return [...repositories];
}

/** Read-only, bounded note selection. Failure never becomes an empty selection. */
export async function hasReviewNotes(
  scope: NoteReviewScope,
  logger: MemoLogger,
  io?: CommitNotesIO
): Promise<NoteLookupOutcome> {
  const deadline = performance.now() + 5_000;
  try {
    const repositories: { cwd: string; notes: ReviewNote[] }[] = [];
    for (const cwd of reviewRepositories(scope)) {
      if (performance.now() >= deadline) throw new Error('note lookup deadline exhausted');
      const resolved = resolveGitSpanCommand(['notes', 'list', '--format', 'json'], cwd);
      const command = {
        cwd,
        argv: resolved.argv,
        timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
        maxOutputBytes: 1_048_576
      };
      const result = await (io?.execute(command) ?? executeCommitNotes(resolved.executable, command));
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
        throw new Error('notes CLI unavailable, failed, or exceeded lookup bounds');
      const notes = decodeReviewNotes(JSON.parse(result.stdout)).filter((note) => noteBelongsToSession(note, scope));
      if (notes.length) repositories.push({ cwd, notes });
    }
    return repositories.length ? { kind: 'matching', repositories } : { kind: 'empty' };
  } catch (err) {
    logger.warn('git-span could not read commit notes', { err });
    return { kind: 'failure', reason: reviewError(err) };
  }
}
