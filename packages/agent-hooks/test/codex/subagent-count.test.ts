/**
 * Tests for the Codex matcher-less SubagentStart / SubagentStop counter hooks
 * (packages/agent-hooks/src/codex/subagent-count-{start,stop}.ts).
 *
 * The counter kernel is shared with the Claude adapter; these tests confirm the
 * Codex entry points wire `input.session_id` into increment/decrement correctly.
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/codex-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import startHook from '../../src/codex/subagent-count-start.js';
import stopHook from '../../src/codex/subagent-count-stop.js';
import { incrementSubagentCount, readSubagentCount, subagentCountPath } from '../../src/common/agent-hooks-common.js';

const logger = new Logger();

function startInput(sessionId: string, agentType: string, agentId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStart' as const,
    session_id: sessionId,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    model: 'gpt-x',
    permission_mode: 'default',
    agent_id: agentId,
    agent_type: agentType,
    turn_id: 'turn-1'
  };
}

function stopInput(sessionId: string, agentType: string, agentId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStop' as const,
    session_id: sessionId,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    model: 'gpt-x',
    permission_mode: 'default',
    agent_id: agentId,
    agent_transcript_path: '/tmp/agent.jsonl',
    agent_type: agentType,
    last_assistant_message: null,
    stop_hook_active: false,
    turn_id: 'turn-1'
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
  const id = `codex-count-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}

describe('codex subagent-count-start hook', () => {
  it('registers a SubagentStart hook', () => {
    expect(startHook.hookEventName).toBe('SubagentStart');
  });

  it('increments the counter for an arbitrary agent type', async () => {
    const id = sid('start');
    await startHook(startInput(id, 'some-type', 'agent-1') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('accumulates across multiple spawns', async () => {
    const id = sid('multi');
    await startHook(startInput(id, 'a', 'agent-1') as never, { logger } as never);
    await startHook(startInput(id, 'b', 'agent-2') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(2);
  });
});

describe('codex subagent-count-stop hook', () => {
  it('registers a SubagentStop hook', () => {
    expect(stopHook.hookEventName).toBe('SubagentStop');
  });

  it('decrements the counter on stop', async () => {
    const id = sid('stop');
    incrementSubagentCount(id, logger);
    incrementSubagentCount(id, logger);
    await stopHook(stopInput(id, 'some-type', 'agent-1') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(1);
  });

  it('floors at zero when no counter file exists', async () => {
    const id = sid('floor');
    await stopHook(stopInput(id, 'some-type', 'agent-x') as never, { logger } as never);
    expect(readSubagentCount(id)).toBe(0);
  });
});
