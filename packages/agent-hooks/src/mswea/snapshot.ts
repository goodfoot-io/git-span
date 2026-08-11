/**
 * mini-swe-agent PreToolUse snapshot hook — the Claude adapter's handler,
 * re-registered for this host.
 *
 * The snapshot decision + write-tree capture is host-agnostic: it keys off
 * the same wire envelope (session_id/tool_use_id/cwd) the mini-swe-agent
 * bridge synthesizes, so this adapter registers the Claude adapter's handler
 * unchanged.
 */

import { preToolUseHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/snapshot.js';

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
