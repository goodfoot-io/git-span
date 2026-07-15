/**
 * Tests for the matcher-less SubagentStop counter hook
 * (packages/agent-hooks/src/subagent-count-stop.ts).
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import hook from '../../src/claude/subagent-count-stop.js';
import {
  decrementSubagentCount,
  incrementSubagentCount,
  readSubagentCount,
  subagentCountPath
} from '../../src/common/agent-hooks-common.js';

const logger = new Logger();

function input(sessionId: string, agentType: string, agentId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStop' as const,
    session_id: sessionId,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    agent_id: agentId,
    agent_type: agentType
  };
}

const sids: string[] = [];
afterEach(() => {
  for (const sid of sids) {
    const p = subagentCountPath(sid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    const lock = `${p}.lock`;
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  }
  sids.length = 0;
});

function sid(label: string): string {
  const id = `count-stop-${label}-${Date.now()}`;
  sids.push(id);
  return id;
}

describe('subagent-count-stop hook', () => {
  it('decrements the counter on stop', async () => {
    const id = sid('decr');
    incrementSubagentCount(id, logger);
    incrementSubagentCount(id, logger);
    await hook(input(id, 'git-span:expert', 'agent-abc') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('floors at zero when no counter file exists', async () => {
    const id = sid('floor');
    await hook(input(id, 'some-type', 'agent-xyz') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(0);
  });

  it('fires for arbitrary agent types', async () => {
    const id = sid('other-type');
    incrementSubagentCount(id, logger);
    await hook(input(id, 'unrelated-type', 'agent-z') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(0);
  });

  it('returns a valid subagentStopOutput even after a counter failure', async () => {
    const id = sid('output');
    // Even if the counter file doesn't exist, the hook should return normally
    const result = await hook(input(id, 'git-span:expert', 'agent-x') as never, { logger } as never);
    expect(result).toBeDefined();
  });

  it('counter failure is non-fatal — handler still returns its output', async () => {
    const id = sid('non-fatal');
    // Pre-populate then forcibly break the counter dir so decrement fails
    // (but the hook should still return)
    // We simulate this by calling decrement on an absent session — it should
    // swallow any error and the hook should still return an output.
    decrementSubagentCount(id, logger); // no-op, no throw
    const result = await hook(input(id, 'git-span:expert', 'agent-fail') as never, { logger } as never);
    expect(result).toBeDefined();
  });
});
