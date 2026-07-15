/**
 * Codex Stop hook — thin SDK-bound entry point.
 *
 * Binds the harness-agnostic Stop/journal core (shared with the Claude adapter)
 * to the Codex `stopHook` factory. Reads `session_id`/`cwd`/`stop_hook_active`,
 * drains the per-session touch journal into a `PreCommitRecord`, marks the
 * entries seen, and returns `undefined` — the SDK renders that as valid empty
 * JSON, satisfying Codex's "exit 0 must emit JSON" rule.
 *
 * The core returns `null` (its "no output" value); Codex's `StopResult` is
 * `StopOutput | undefined`, so we coerce `null → undefined` at the boundary.
 * The timeout is milliseconds in the handler config (the CLI converts to the
 * `30` seconds emitted in `hooks.json`) — see the timeout-units spike note.
 */

import { stopHook } from '@goodfoot/codex-hooks';
import { createStopHandler } from '../common/stop-core.js';

const runStop = createStopHandler({});

export default stopHook(
  { timeout: 30_000 },
  (input, ctx) =>
    runStop({ session_id: input.session_id, cwd: input.cwd, stop_hook_active: input.stop_hook_active }, ctx) ??
    undefined
);
