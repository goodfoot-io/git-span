/**
 * Tests for the matcher-less SubagentStart counter hook
 * (packages/agent-hooks/src/subagent-count-start.ts).
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { readSubagentCount, subagentCountPath } from '../src/agent-hooks-common.js';
import hook from '../src/subagent-count-start.js';

const logger = new Logger();

function input(sessionId: string, agentType: string, agentId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStart' as const,
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
  const id = `count-start-${label}-${Date.now()}`;
  sids.push(id);
  return id;
}

describe('subagent-count-start hook', () => {
  it('increments the counter for a git-span:expert agent', async () => {
    const id = sid('expert');
    await hook(input(id, 'git-span:expert', 'agent-abc') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('increments the counter for an arbitrary agent type', async () => {
    const id = sid('other');
    await hook(input(id, 'some-other-type', 'agent-xyz') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('accumulates across multiple spawns', async () => {
    const id = sid('multi');
    await hook(input(id, 'git-span:expert', 'agent-1') as never, { logger } as never);
    await hook(input(id, 'some-type', 'agent-2') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(2);
  });

  it('returns a valid subagentStartOutput', async () => {
    const id = sid('output');
    const result = await hook(input(id, 'git-span:expert', 'agent-x') as never, { logger } as never);
    // SDK wraps output: { _type, stdout }. Returning {} means no block/deny.
    expect(result).toBeDefined();
  });
});
