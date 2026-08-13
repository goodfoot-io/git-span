/**
 * mini-swe-agent PostToolUseFailure hook — the Claude adapter's handler,
 * re-registered for this host.
 *
 * The failed-command static attribution path is host-agnostic: it keys off
 * the same wire envelope the mini-swe-agent bridge synthesizes.
 */

import { postToolUseFailureHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/post-tool-use-failure.js';

export { createHandler };

export default postToolUseFailureHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
