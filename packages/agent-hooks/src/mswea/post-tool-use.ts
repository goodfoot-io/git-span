/**
 * mini-swe-agent PostToolUse touch hook — the Claude adapter's handler,
 * re-registered for this host.
 *
 * The heal + surface pipeline is host-agnostic: mini-swe-agent has no
 * Read/Edit/Write tools, so only the bash-command touch surface fires, which
 * the shared static-parse core already handles.
 */

import { postToolUseHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/post-tool-use.js';

export { createHandler };

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 10_000 }, createHandler());
