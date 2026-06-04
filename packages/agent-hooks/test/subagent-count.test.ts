/**
 * Tests for the subagent counter operations in agent-hooks-common.ts:
 * subagentCountPath, incrementSubagentCount, decrementSubagentCount,
 * readSubagentCount.
 *
 * All checks start as it.skip and are unskipped incrementally as the
 * implementation lands (Phase 3).
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decrementSubagentCount,
  incrementSubagentCount,
  readSubagentCount,
  subagentCountPath
} from '../src/agent-hooks-common.js';

const logger = new Logger();

// Clean up count files after each test.
const sids: string[] = [];
afterEach(() => {
  for (const sid of sids) {
    const p = subagentCountPath(sid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    // Also remove the lock file if left behind.
    const lock = `${p}.lock`;
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  }
  sids.length = 0;
});

function sid(label: string): string {
  const id = `subagent-count-${label}-${Date.now()}`;
  sids.push(id);
  return id;
}

describe('readSubagentCount', () => {
  it('returns 0 when the count file is absent', () => {
    const id = sid('read-absent');
    expect(readSubagentCount(id)).toBe(0);
  });

  it('returns 0 for an empty count file', () => {
    const id = sid('read-empty');
    const p = subagentCountPath(id);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, '', 'utf8');
    expect(readSubagentCount(id)).toBe(0);
  });

  it('returns 0 for a garbage count file', () => {
    const id = sid('read-garbage');
    const p = subagentCountPath(id);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not-a-number', 'utf8');
    expect(readSubagentCount(id)).toBe(0);
  });

  it('returns 0 for a negative value in the count file', () => {
    const id = sid('read-negative');
    const p = subagentCountPath(id);
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, '-3', 'utf8');
    expect(readSubagentCount(id)).toBe(0);
  });

  it('reflects the written value after increment', () => {
    const id = sid('read-reflects');
    incrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(1);
  });
});

describe('incrementSubagentCount', () => {
  it('starts from 0 when the file is absent (increment-from-absent → 1)', () => {
    const id = sid('incr-absent');
    incrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('sequential increments accumulate', () => {
    const id = sid('incr-seq');
    incrementSubagentCount(id, logger);
    incrementSubagentCount(id, logger);
    incrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(3);
  });
});

describe('decrementSubagentCount', () => {
  it('decrement-from-absent yields 0 (no file created)', () => {
    const id = sid('decr-absent');
    decrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(0);
  });

  it('floors at zero (decrement below zero is clamped)', () => {
    const id = sid('decr-floor');
    // Count starts absent (0). Decrement should not go negative.
    decrementSubagentCount(id, logger);
    decrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(0);
  });

  it('decrement after increment yields 0', () => {
    const id = sid('decr-after-incr');
    incrementSubagentCount(id, logger);
    decrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(0);
  });

  it('multiple increments then decrement by one', () => {
    const id = sid('decr-partial');
    incrementSubagentCount(id, logger);
    incrementSubagentCount(id, logger);
    decrementSubagentCount(id, logger);
    expect(readSubagentCount(id)).toBe(1);
  });
});

describe('concurrent correctness', () => {
  it('N parallel increments settle to N (lock prevents races)', async () => {
    const id = sid('concurrent');
    const N = 8;
    await Promise.all(Array.from({ length: N }, () => Promise.resolve(incrementSubagentCount(id, logger))));
    expect(readSubagentCount(id)).toBe(N);
  });
});
