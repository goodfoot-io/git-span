import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hasReviewNotes } from '../../src/common/review-lookup.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
afterAll(() => temp.cleanup());
const scope = { host: 'codex' as const, sessionId: 'session', cwd: temp.parent };
const logger = { warn: vi.fn() };
const sha = 'a'.repeat(40);
const document = { schemaVersion: 1, host: 'codex', sessionId: 'session' };
function io(envelope: unknown, overrides = {}) {
  return {
    execute: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stderr: '',
      stdout: JSON.stringify(envelope),
      ...overrides
    }))
  };
}

describe('review lookup outcomes', () => {
  it('distinguishes a matching captured note from an empty selection', async () => {
    const note = { id: 1, commit_sha: sha, document };
    expect(await hasReviewNotes(scope, logger, io({ schema_version: 1, operation: 'list', notes: [note] }))).toEqual({
      kind: 'matching',
      repositories: [{ cwd: temp.parent, notes: [note] }]
    });
    expect(await hasReviewNotes(scope, logger, io({ schema_version: 1, operation: 'list', notes: [] }))).toEqual({
      kind: 'empty'
    });
  });
  it.each([
    { notes: [] },
    { schema_version: 2, operation: 'list', notes: [] },
    { schema_version: 1, operation: 'remove', notes: [] },
    { schema_version: 1, operation: 'list', notes: [{ id: 1, document }] },
    { schema_version: 1, operation: 'list', notes: [{ id: 0, commit_sha: sha, document }] },
    { schema_version: 1, operation: 'list', notes: [{ id: 1, commit_sha: 'HEAD', document }] },
    {
      schema_version: 1,
      operation: 'list',
      notes: [
        { id: 1, commit_sha: sha, document },
        { id: 1, commit_sha: sha, document }
      ]
    }
  ])('never turns a malformed envelope into an empty selection: %j', async (envelope) => {
    expect(await hasReviewNotes(scope, logger, io(envelope))).toMatchObject({
      kind: 'failure',
      reason: expect.any(String)
    });
  });
  it.each([{ timedOut: true }, { outputExceeded: true }, { signal: 'SIGTERM' }, { exitCode: 1 }])(
    'retains visible failure on bounded CLI failure %j',
    async (overrides) => {
      expect(
        await hasReviewNotes(scope, logger, io({ schema_version: 1, operation: 'list', notes: [] }, overrides))
      ).toMatchObject({ kind: 'failure' });
    }
  );
  it('does not call a CLI outside a repository', async () => {
    const outside = makeTempLayout();
    try {
      const execute = io({});
      expect(await hasReviewNotes({ ...scope, cwd: outside.parent }, logger, execute)).toEqual({ kind: 'empty' });
      expect(execute.execute).not.toHaveBeenCalled();
    } finally {
      outside.cleanup();
    }
  });
});
