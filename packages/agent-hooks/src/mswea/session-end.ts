/** mini-swe SessionEnd registration for shared memo/plan cleanup. */

import { sessionEndHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/session-end.js';

export default sessionEndHook({ timeout: 10_000 }, createHandler());
