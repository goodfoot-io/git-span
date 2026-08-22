/**
 * Tests for the OpenCode JSONL logger (src/opencode/logger.ts): records one
 * JSON object per line when `OPENCODE_GIT_SPAN_LOG_FILE` is set (or a path is
 * injected), silent no-op otherwise, and never throws on an unwritable
 * destination.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpencodeLogger } from '../../src/opencode/logger.js';

const scratch = join(tmpdir(), `opencode-logger-test-${process.pid}.jsonl`);

afterEach(() => {
  rmSync(scratch, { force: true });
  delete process.env.OPENCODE_GIT_SPAN_LOG_FILE;
});

describe('createOpencodeLogger', () => {
  it('appends one JSON object per record when the env var names a file', () => {
    process.env.OPENCODE_GIT_SPAN_LOG_FILE = scratch;
    const logger = createOpencodeLogger();
    logger.warn('git-span advisor churn suppression', { droppedByPath: 2 });
    logger.info?.('resolved', { count: 1 });
    const lines = readFileSync(scratch, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(first).toMatchObject({ level: 'warn', message: 'git-span advisor churn suppression', droppedByPath: 2 });
    expect(typeof first.ts).toBe('string');
    expect((JSON.parse(lines[1]) as Record<string, unknown>).level).toBe('info');
  });

  it('an injected logFile overrides the env var; unset means silent no-op', () => {
    process.env.OPENCODE_GIT_SPAN_LOG_FILE = scratch;
    const silent = createOpencodeLogger({ logFile: '' });
    expect(silent.info).toBeUndefined();
    expect(() => silent.warn('dropped')).not.toThrow();
    expect(existsSync(scratch)).toBe(false);

    delete process.env.OPENCODE_GIT_SPAN_LOG_FILE;
    const unset = createOpencodeLogger();
    expect(unset.info).toBeUndefined();
    expect(() => unset.warn('dropped')).not.toThrow();
  });

  it('an unwritable destination degrades to silence instead of throwing', () => {
    const logger = createOpencodeLogger({ logFile: join(scratch, 'nested', 'missing.jsonl') });
    expect(() => logger.warn('no such directory')).not.toThrow();
  });

  it('satisfies the MemoLogger shape (warn required, info optional)', () => {
    expect(createOpencodeLogger()).toMatchObject({ warn: expect.any(Function) });
  });
});
