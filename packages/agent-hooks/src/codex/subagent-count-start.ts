/**
 * Codex SubagentStart hook: increments the per-session active-subagent counter
 * for every spawning subagent, regardless of type. This lets the Stop hook
 * detect that subagents are still in flight and suppress span-review dispatch
 * until they complete.
 *
 * Intentionally matcher-less so it fires for all agent_type values. The counter
 * kernel is shared with the Claude adapter.
 */

import { subagentStartHook, subagentStartOutput } from '@goodfoot/codex-hooks';
import { incrementSubagentCount } from '../common/agent-hooks-common.js';

export default subagentStartHook({}, (input, { logger }) => {
  incrementSubagentCount(input.session_id, logger);
  return subagentStartOutput({});
});
