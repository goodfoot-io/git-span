/**
 * Claude Stop hook — thin SDK-bound entry point.
 *
 * Reads the per-session touch journal, writes a pre-commit record to the shared
 * queue, marks the journal entries seen, and returns null (the stop proceeds).
 * All of that logic lives in the harness-agnostic Stop/journal core in
 * [common/stop-core.ts](../common/stop-core.ts); this file only binds the Claude
 * SDK `stopHook` factory to `createStopHandler`. The Codex adapter binds the same
 * core to its own `stopHook`.
 */

import { stopHook } from '@goodfoot/claude-code-hooks';
import { createStopHandler } from '../common/stop-core.js';

const runStop = createStopHandler({});

export default stopHook({ timeout: 30_000 }, (input, ctx) =>
  runStop({ session_id: input.session_id, cwd: input.cwd, stop_hook_active: input.stop_hook_active }, ctx)
);
