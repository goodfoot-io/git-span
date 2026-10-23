import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hasReviewNotes } from '../../src/common/review-lookup.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
const scope = { host: 'codex' as const, sessionId: 'session', cwd: temp.parent };
const logger = { warn: vi.fn() };
afterAll(() => temp.cleanup());
function io(documents: unknown[]) {
  return {
    execute: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stderr: '',
      stdout: JSON.stringify({
        schema_version: 1,
        operation: 'list',
        notes: documents.map((document, i) => ({ id: i + 1, commit_sha: 'a'.repeat(40), document }))
      })
    }))
  };
}
describe('note-review selection and host visibility', () => {
  it.each([
    { schemaVersion: 1, host: 'codex', sessionId: 'session', transcriptLocator: 't' },
    { kind: 'git-span/uncovered-commit', schema_version: 1, session_id: 'session' }
  ])('selects recognized session provenance %j', async (document) => {
    expect(await hasReviewNotes(scope, logger, io([document]))).toMatchObject({ kind: 'matching' });
  });
  it.each([
    42,
    'text',
    { arbitrary: true },
    { session_id: 'session' },
    { schemaVersion: 1, host: 'codex', sessionId: 'other' },
    { schemaVersion: 1, host: 'claude', sessionId: 'session' },
    { kind: 'git-span/uncovered-commit', schema_version: 1 },
    { kind: 'git-span/uncovered-commit', schema_version: 1, session_id: 'session', host: 'claude' }
  ])('leaves unrelated or unrecognized documents alone %j', async (document) => {
    expect(await hasReviewNotes(scope, logger, io([document]))).toEqual({ kind: 'empty' });
  });
  it.each(['antigravity', 'opencode'] as const)('retains repository-wide note scope on %s', async (host) => {
    expect(await hasReviewNotes({ ...scope, host }, logger, io([42]))).toMatchObject({ kind: 'matching' });
  });
  it('checks each distinct supplied repository once', async () => {
    const other = join(temp.parent, 'other');
    mkdirSync(other);
    execFileSync('git', ['init', '-q', other]);
    const execute = io([]);
    expect(await hasReviewNotes({ ...scope, workspacePaths: [other, temp.parent, other] }, logger, execute)).toEqual({
      kind: 'empty'
    });
    expect(execute.execute).toHaveBeenCalledTimes(2);
    expect(execute.execute).toHaveBeenCalledWith(expect.objectContaining({ maxOutputBytes: 1_048_576 }));
  });
});
