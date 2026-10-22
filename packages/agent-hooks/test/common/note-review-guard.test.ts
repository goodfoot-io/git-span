import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHandler as claudeStop } from '../../src/claude/stop.js';
import { createHandler as codexStop } from '../../src/codex/stop.js';
import { hasReviewNotes } from '../../src/common/review-lookup.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
const scope = { host: 'codex' as const, sessionId: 'session', cwd: temp.parent };
const logger = { warn: vi.fn() };
const input = { hook_event_name: 'Stop', cwd: temp.parent, session_id: 'session', stop_hook_active: false };
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
  it('cleans empty Codex stops but preserves state on lookup failure', async () => {
    const context = { logger } as never;
    const empty = vi.fn(async () => ({ kind: 'empty' as const }));
    expect(await claudeStop(empty)(input as never, context)).toBeNull();
    mkdirSync(temp.layout.dir('session'), { recursive: true });
    writeFileSync(temp.layout.memoFile('session'), '{}');
    const failedLookup = vi.fn(async () => ({ kind: 'failure' as const, reason: 'lookup timeout' }));
    const result = await codexStop(temp.layout, {}, failedLookup)(input as never, context);
    expect(result?.stdout).toMatchObject({ systemMessage: 'git-span could not read commit notes: lookup timeout' });
    expect(result?.stdout.decision).toBeUndefined();
    expect(existsSync(temp.layout.dir('session'))).toBe(true);
    expect(failedLookup).toHaveBeenCalledOnce();
    expect(await codexStop(temp.layout, {}, empty)(input as never, context)).toBeUndefined();
    expect(existsSync(temp.layout.dir('session'))).toBe(false);
  });
});
