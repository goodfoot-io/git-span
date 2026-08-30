/**
 * Antigravity PreToolUse tool-call stash — the first leg of the three-way
 * touch-attribution split. Antigravity's PostToolUse input carries only
 * `stepIdx` and an optional `error` (no tool name, no args, no response), so
 * this handler records `toolCall{name,args}` on disk keyed
 * `conversationId:stepIdx`; the paired PostToolUse handler joins on its own
 * `stepIdx` to recover the identity and arguments the host withholds.
 *
 * The stash never gates anything: a failed write costs one join (that call's
 * attribution silently degrades to nothing), never the tool call itself.
 */

import {
  type HookContext,
  type PreToolUseInput,
  preToolUseHook,
  preToolUseOutput
} from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { stashToolCall } from './stash.js';

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    // Every path replies an explicit allow: the live host treats a `{}`
    // PreToolUse reply as a deny with an empty reason (CONTRACT.md marks
    // `decision` as required), so silence here would block the tool call.
    try {
      stashToolCall(layout, input.conversationId, input.stepIdx, input.toolCall);
      return preToolUseOutput({ decision: 'allow' });
    } catch (err) {
      ctx.logger.warn('git-span tool-call stash failed open; this call loses attribution', { err });
      return preToolUseOutput({ decision: 'allow' });
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default preToolUseHook({ matcher: 'run_command', timeout: 10_000 }, createHandler());
