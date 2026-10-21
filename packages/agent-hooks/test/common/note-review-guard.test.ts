import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHandler as claudeStop } from '../../src/claude/stop.js';
import { createHandler as codexStop } from '../../src/codex/stop.js';
import type { CommitNotesResult } from '../../src/common/commit-io.js';
import { hasReviewNotes } from '../../src/common/review-notes-stop.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
execFileSync('git', ['init', '-q', temp.parent]);
const scope = { host: 'codex' as const, sessionId: 'session', cwd: temp.parent };
const logger = { warn: vi.fn() };
const input = { hook_event_name: 'Stop', cwd: temp.parent, session_id: 'session', stop_hook_active: false } as never;
afterAll(() => temp.cleanup());

function io(stdout: string, overrides: Partial<CommitNotesResult> = {}) {
  return {
    execute: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stderr: '',
      stdout,
      ...overrides
    }))
  };
}

describe('note-review presence guard', () => {
  it('confirms empty lists and checks each repository only once', async () => {
    const execute = io('{"notes":[]}');
    expect(await hasReviewNotes({ ...scope, workspacePaths: [temp.parent, temp.parent] }, logger, execute)).toBe(false);
    expect(execute.execute).toHaveBeenCalledOnce();
    expect(execute.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: temp.parent,
        argv: expect.arrayContaining(['notes', 'list', '--format', 'json']),
        maxOutputBytes: 1_048_576
      })
    );
  });

  it.each([
    '{"schemaVersion":1,"host":"codex","sessionId":"session","transcriptLocator":"t"}',
    '{"kind":"git-span/uncovered-commit","schema_version":1,"session_id":"session"}'
  ])('requests review for a note belonging to this session: %s', async (document) => {
    expect(await hasReviewNotes(scope, logger, io(`{"notes":[{"id":1,"document":${document}}]}`))).toBe(true);
  });

  it.each([
    '42',
    '"text"',
    '{"arbitrary":true}',
    '{"schemaVersion":1,"host":"codex","sessionId":"other"}',
    '{"schemaVersion":1,"host":"claude","sessionId":"session"}',
    '{"kind":"git-span/uncovered-commit","schema_version":1,"session_id":"other"}',
    '{"kind":"git-span/uncovered-commit","schema_version":1}'
  ])('does not request review for a note outside this session: %s', async (document) => {
    expect(await hasReviewNotes(scope, logger, io(`{"notes":[{"id":1,"document":${document}}]}`))).toBe(false);
  });

  it.each(['antigravity', 'opencode'] as const)(
    'requests review on %s for any note, regardless of session',
    async (host) => {
      const hostScope = { ...scope, host };
      for (const document of [
        '42',
        '{"arbitrary":true}',
        '{"schemaVersion":1,"host":"codex","sessionId":"other"}',
        '{"kind":"git-span/uncovered-commit","schema_version":1,"session_id":"other"}'
      ])
        expect(await hasReviewNotes(hostScope, logger, io(`{"notes":[{"id":1,"document":${document}}]}`))).toBe(true);
    }
  );

  it.each(['antigravity', 'opencode'] as const)('does not request review on %s without notes', async (host) => {
    expect(await hasReviewNotes({ ...scope, host }, logger, io('{"notes":[]}'))).toBe(false);
  });

  it.each(['claude', 'codex', 'antigravity', 'opencode'] as const)(
    'skips review and warns on %s when the notes lookup fails',
    async (host) => {
      const warn = vi.fn();
      expect(await hasReviewNotes({ ...scope, host }, { warn }, io('not json'))).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    }
  );

  it('includes other workspace repositories', async () => {
    const other = join(temp.parent, 'other');
    mkdirSync(other);
    execFileSync('git', ['init', '-q', other]);
    const execute = io('{"notes":[]}');
    execute.execute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stderr: '',
      stdout: '{"notes":[]}'
    });
    execute.execute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stderr: '',
      stdout: '{"notes":[{"id":2,"document":{"session_id":"session"}}]}'
    });
    expect(await hasReviewNotes({ ...scope, workspacePaths: [other] }, logger, execute)).toBe(true);
    expect(execute.execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    io('not json'),
    io('{}'),
    io('{"notes":[]}', { exitCode: 1 }),
    io('{"notes":[]}', { timedOut: true }),
    io('{"notes":[]}', { outputExceeded: true })
  ])('skips review and warns when the notes lookup fails', async (execute) => {
    const warn = vi.fn();
    expect(await hasReviewNotes(scope, { warn }, execute)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('silently skips non-repository sessions', async () => {
    const nonrepo = makeTempLayout();
    try {
      const execute = io('{"notes":[{"id":1,"document":{"session_id":"session"}}]}');
      expect(await hasReviewNotes({ ...scope, cwd: nonrepo.parent }, logger, execute)).toBe(false);
      expect(execute.execute).not.toHaveBeenCalled();
    } finally {
      nonrepo.cleanup();
    }
  });

  it('allows Claude and Codex empty stops and retires Codex session state', async () => {
    const check = vi.fn(async () => false);
    const context = { logger } as never;
    expect(await claudeStop(check)(input, context)).toBeNull();
    mkdirSync(temp.layout.dir('session'), { recursive: true });
    writeFileSync(temp.layout.memoFile('session'), '{}');
    expect(await codexStop(temp.layout, {}, check)(input, context)).toBeUndefined();
    expect(existsSync(temp.layout.dir('session'))).toBe(false);
  });

  it('does not probe notes again during a Claude or Codex continuation', async () => {
    const check = vi.fn(async () => true);
    const continuation = { ...scope, session_id: 'session', stop_hook_active: true } as never;
    const context = { logger } as never;
    expect(await claudeStop(check)(continuation, context)).toBeNull();
    expect(await codexStop(temp.layout, {}, check)(continuation, context)).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });
});
