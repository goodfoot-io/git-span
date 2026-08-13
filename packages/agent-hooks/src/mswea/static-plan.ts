/** mini-swe-agent inherits the Claude static Bash PreToolUse planner. */

import { preToolUseHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/static-plan.js';

export { createHandler };

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
