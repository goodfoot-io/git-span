/** Durable Claude Stop checkpoints for newly added notes about material commits. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isInsideSpanRoot, type SessionLayout } from '../common/agent-hooks-common.js';
import { executeCommitNotes } from '../common/commit-native-io.js';
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
      typeof entry.cwd !== 'string' ||
      !isAbsolute(entry.cwd) ||
      typeof entry.id !== 'number' ||
      !Number.isSafeInteger(entry.id) ||
      entry.id < 1 ||
      checkpoint.has(entry.cwd)
    )
      throw new Error('invalid note checkpoint repository');
    checkpoint.set(entry.cwd, entry.id);
  }
  return checkpoint;
}

function writeCheckpoint(directory: string, path: string, checkpoint: Map<string, number>): void {
  const data = JSON.stringify({
    schemaVersion: 1,
    repositories: [...checkpoint].map(([cwd, id]) => ({ cwd, id }))
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
    const git = async (cwd: string, argv: string[], missingConfig = false): Promise<string> => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error('note commit inspection deadline exhausted');
      const result = await executeCommitNotes('git', { cwd, argv, timeoutMs: remaining, maxOutputBytes: 1_048_576 });
      if (
        result.signal !== null ||
        result.timedOut ||
        result.outputExceeded ||
        (result.exitCode !== 0 && !(missingConfig && result.exitCode === 1))
      )
        throw new Error('note commit inspection unavailable, failed, or exceeded bounds');
      return result.stdout;
    };
    const repositories = [];
    for (const repository of outcome.repositories) {
      const previous = checkpoint.get(repository.cwd) ?? 0;
      const added = repository.notes.filter((note) => note.id > previous);
      if (!added.length) continue;
      const configured =
        process.env.GIT_SPAN_DIR?.trim() ||
        (await git(repository.cwd, ['config', '--get', 'git-span.dir'], true)).trim() ||
        '.span';
      const root = relative(repository.cwd, resolve(repository.cwd, configured)).split('\\').join('/');
      const material = new Set<string>();
      for (const sha of new Set(added.map((note) => note.commit_sha))) {
        const output = await git(repository.cwd, [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-z',
          '-r',
          '--root',
          '-m',
          '--no-renames',
          sha,
          '--'
        ]);
        if (output && !output.endsWith('\0')) throw new Error('invalid note commit path output');
        const paths = output.split('\0').filter(Boolean);
        if (
          paths.some(
            (changed) =>
              !['.span', '.spans', root].some((metadata) => metadata === '' || isInsideSpanRoot(changed, metadata))
          )
        )
          material.add(sha);
      }
      const notes = added.filter((note) => material.has(note.commit_sha));
      if (notes.length) repositories.push({ cwd: repository.cwd, notes });
      checkpoint.set(repository.cwd, Math.max(previous, ...added.map((note) => note.id)));
    }
    writeCheckpoint(directory, path, checkpoint);
    return repositories.length ? { kind: 'matching', repositories } : { kind: 'empty' };
  };
}
