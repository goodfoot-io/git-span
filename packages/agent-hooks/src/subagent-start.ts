/**
 * SubagentStart hook: captures the agent id of each git-mesh:expert subagent
 * the moment it spawns and records it in the per-session marker.
 *
 * The Stop hook dispatches mesh review to a git-mesh:expert subagent but cannot
 * see the agent id the main loop mints when it spawns one — a Stop hook only
 * emits text instructions. This hook closes that gap: it observes the spawn,
 * writes the id where the Stop hook reads it, and so lets the next dispatch wake
 * the existing expert via SendMessage instead of spawning a duplicate.
 *
 * The matcher runs against `agent_type`; plugin agents are namespaced, so the
 * type is `git-mesh:expert`.
 */

import { subagentStartHook, subagentStartOutput } from '@goodfoot/claude-code-hooks';
import { recordExpertAgent } from './agent-hooks-common.js';

export default subagentStartHook({ matcher: 'git-mesh:expert' }, (input, { logger }) => {
  recordExpertAgent(input.session_id, input.agent_id, logger);
  logger.info('recorded git-mesh:expert subagent', {
    agentId: input.agent_id,
    agentType: input.agent_type
  });
  return subagentStartOutput({});
});
