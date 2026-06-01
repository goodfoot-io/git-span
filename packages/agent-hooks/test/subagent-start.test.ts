/**
 * Tests for the SubagentStart hook (packages/agent-hooks/src/subagent-start.ts).
 *
 * The hook records the agent id of a spawning git-mesh:expert subagent so the
 * Stop hook can later wake it via SendMessage instead of spawning a duplicate.
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { expertAgentMarkerPath, readExpertAgentId } from '../src/agent-hooks-common.js';
import hook from '../src/subagent-start.js';

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

describe('SubagentStart hook: records git-mesh:expert agent id', () => {
  const sids: string[] = [];
  afterEach(() => {
    for (const sid of sids) {
      const p = expertAgentMarkerPath(sid);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    sids.length = 0;
  });

  it('writes the agent id when a git-mesh:expert spawns', async () => {
    const sid = `subagent-start-match-${Date.now()}`;
    sids.push(sid);
    await hook(input(sid, 'git-mesh:expert', 'agent-xyz789') as never, { logger } as never);
    expect(readExpertAgentId(sid)).toBe('agent-xyz789');
  });

  it('latest spawn wins', async () => {
    const sid = `subagent-start-latest-${Date.now()}`;
    sids.push(sid);
    await hook(input(sid, 'git-mesh:expert', 'agent-first') as never, { logger } as never);
    await hook(input(sid, 'git-mesh:expert', 'agent-second') as never, { logger } as never);
    expect(readExpertAgentId(sid)).toBe('agent-second');
  });

  // Filtering to the git-mesh:expert agent_type is the dispatcher's job via the
  // hooks.json `matcher` field; the handler itself runs unconditionally when
  // invoked, so there is no handler-level non-match case to test here.
});
