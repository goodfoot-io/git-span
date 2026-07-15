/**
 * SubagentStop hook: decrements the per-session active-subagent counter when
 * any subagent finishes. Floors at zero. Paired with subagent-count-start.ts.
 *
 * Intentionally matcher-less so it fires for all agent_type values.
 */

import { subagentStopHook, subagentStopOutput } from '@goodfoot/claude-code-hooks';
import { decrementSubagentCount } from '../common/agent-hooks-common.js';

export default subagentStopHook({}, (input, { logger }) => {
  decrementSubagentCount(input.session_id, logger);
  return subagentStopOutput({});
});
