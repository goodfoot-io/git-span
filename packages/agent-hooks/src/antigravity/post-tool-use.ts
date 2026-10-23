/**
 * Antigravity PostToolUse attribution join — the second leg of the three-way
 * touch-attribution split. The input carries only `stepIdx` and an optional
 * `error` string, so the handler joins against the tool-call stash the
 * PreToolUse leg wrote, re-narrows the replayed call, and drives the shared
 * layered Bash attribution over it.
 *
 * Two accepted parity gaps versus the other platforms, both from the missing
 * `tool_response`: on success the response is `undefined` (no interruption
 * flag, no exit code, no response-derived reads — attribution rests on the
 * command-derived evidence; literal pending inspections collect current native
 * evidence independently), and when `error` is present the call routes
 * through {@link failureBashResponse}, which defaults the missing response to
 * `exitStatus: 1` — the same conservative failure framing the Claude failure
 * branch uses. Inferred failure codes never qualify a pending inspection as
 * an observed diff exit 1; dedicated pending reports are success-only here.
 *
 * PostToolUse has no message channel at all (`{}` is the only legal reply),
 * so rendered `<git-span>` blocks — the silent re-anchoring notices included —
 * go to the pending-injection stash for the PostInvocation drain; the handler
 * itself always returns `undefined` and the transport prints `{}`.
 */

import { type HookContext, type PostToolUseInput, postToolUseHook } from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import {
  createDefaultPlannedTouchStore,
  failureBashResponse,
  runLayeredBashTouches
} from '../common/bash-attribution.js';
import { firstWriteGuidance } from '../common/first-write-guidance.js';
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowRunCommand, resolveCallCwd } from './run-command.js';
import { appendPendingInjection, takeToolCall } from './stash.js';

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    try {
      const stashed = takeToolCall(layout, input.conversationId, input.stepIdx);
      if (stashed === null) return undefined;
      const call = narrowRunCommand(stashed);
      if (call === null) return undefined;
      const memo = memoFactory(ctx.logger, layout);
      const blocks = await runLayeredBashTouches(
        call.command,
        resolveCallCwd(call, input.workspacePaths),
        input.conversationId,
        String(input.stepIdx),
        // `error` present means the command failed; frame it the way the
        // Claude failure branch does. On success there is no response at all —
        // the accepted degraded parity documented in the module header.
        input.error === undefined ? undefined : failureBashResponse({ tool_response: undefined }),
        executors,
        memo,
        ctx.logger,
        createDefaultPlannedTouchStore(layout),
        { successful: input.error === undefined, onWrite: () => firstWriteGuidance(input.conversationId, memo, true) }
      );
      for (const block of blocks) {
        appendPendingInjection(layout, input.conversationId, block);
      }
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span touch attribution failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseHook({ matcher: 'run_command', timeout: 40_000 }, createHandler());
