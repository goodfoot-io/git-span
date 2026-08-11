/**
 * mini-swe-agent PostToolUseFailure hook — the Claude adapter's handler,
 * re-registered for this host.
 *
 * The failed-command snapshot comparison is host-agnostic: it keys off the
 * same wire envelope (tool_response with the exit status) the mini-swe-agent
 * bridge synthesizes.
 */

import { postToolUseFailureHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/post-tool-use-failure.js';

export default postToolUseFailureHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
