/**
 * mini-swe-agent SessionEnd hook — the Claude adapter's handler, re-registered
 * for this host.
 *
 * Per-session snapshot cleanup keys off nothing host-specific (just the
 * session_id on the envelope the bridge synthesizes), so this adapter
 * registers the Claude adapter's handler unchanged.
 */

import { sessionEndHook } from '@goodfoot/claude-code-hooks';
import { createHandler } from '../claude/session-end.js';

export default sessionEndHook({ timeout: 10_000 }, createHandler());
