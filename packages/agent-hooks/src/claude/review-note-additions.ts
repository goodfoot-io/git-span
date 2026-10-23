/** Durable Claude Stop checkpoints for newly added notes about material commits. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { SessionLayout } from '../common/agent-hooks-common.js';
import { executeCommitNotes } from '../common/commit-native-io.js';
import { inspectCommitSpanMetadata } from '../common/commit-span-metadata.js';
import { errnoCode, isRecord } from '../common/guards.js';
import { hasReviewNotes, type NoteReviewCheck } from '../common/review-lookup.js';

const MAX_STATE_BYTES = 1_048_576;

function readCheckpoint(path: string): Map<string, number> {
  let raw: unknown;
  try {
    if (statSync(path).size > MAX_STATE_BYTES) throw new Error('note checkpoint exceeds size budget');
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return new Map();
    throw err;
  }
  if (!isRecord(raw) || raw.schemaVersion !== 1 || Object.keys(raw).length !== 2 || !Array.isArray(raw.repositories))
    throw new Error('invalid note checkpoint');
  const checkpoint = new Map<string, number>();
  for (const entry of raw.repositories) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 2 ||
      typeof entry.commonDirectory !== 'string' ||
      !isAbsolute(entry.commonDirectory) ||
      typeof entry.id !== 'number' ||
      !Number.isSafeInteger(entry.id) ||
      entry.id < 1 ||
      checkpoint.has(entry.commonDirectory)
    )
      throw new Error('invalid note checkpoint repository');
    checkpoint.set(entry.commonDirectory, entry.id);
  }
  return checkpoint;
}

function writeCheckpoint(directory: string, path: string, checkpoint: Map<string, number>): void {
  const data = JSON.stringify({
    schemaVersion: 1,
    repositories: [...checkpoint].map(([commonDirectory, id]) => ({ commonDirectory, id }))
  });
  if (Buffer.byteLength(data) > MAX_STATE_BYTES) throw new Error('note checkpoint exceeds size budget');
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** A failed lookup or commit inspection never advances the durable checkpoint. */
export function checkClaudeNoteAdditions(
  layout: SessionLayout,
  check: NoteReviewCheck = hasReviewNotes
): NoteReviewCheck {
  return async (scope, logger) => {
    const deadline = performance.now() + 8_000;
    const outcome = await check(scope, logger);
    if (outcome.kind === 'failure') return outcome;
    const directory = layout.dir(scope.sessionId);
    const path = join(directory, 'review-notes-stop.json');
    const checkpoint = readCheckpoint(path);
    if (outcome.kind === 'empty') return outcome;
    const git = async (cwd: string, argv: string[]): Promise<string> => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error('note commit inspection deadline exhausted');
      const result = await executeCommitNotes('git', { cwd, argv, timeoutMs: remaining, maxOutputBytes: 1_048_576 });
      if (result.signal !== null || result.timedOut || result.outputExceeded || result.exitCode !== 0)
        throw new Error('note commit inspection unavailable, failed, or exceeded bounds');
      return result.stdout;
    };
    const repositories = [];
    for (const repository of outcome.repositories) {
      // Notes IDs belong to the shared store, not an individual linked worktree.
      const commonDirectory = realpathSync(
        (await git(repository.cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trimEnd()
      );
      const previous = checkpoint.get(commonDirectory) ?? 0;
      const added = repository.notes.filter((note) => note.id > previous);
      if (!added.length) continue;
      const material = new Set<string>();
      for (const sha of new Set(added.map((note) => note.commit_sha))) {
        if ((await inspectCommitSpanMetadata('git', repository.cwd, sha, deadline)) === 'material') material.add(sha);
      }
      const notes = added.filter((note) => material.has(note.commit_sha));
      if (notes.length) repositories.push({ cwd: repository.cwd, notes });
      checkpoint.set(commonDirectory, Math.max(previous, ...added.map((note) => note.id)));
    }
    writeCheckpoint(directory, path, checkpoint);
    return repositories.length ? { kind: 'matching', repositories } : { kind: 'empty' };
  };
}
