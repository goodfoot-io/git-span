/**
 * Antigravity PostInvocation drain — the delivery leg of the three-way
 * touch-attribution split and of the advisor's allow-with-report kinds.
 * Neither PreToolUse-allow nor PostToolUse carries a message channel, so
 * every rendered `<git-span>` block produced during the invocation waits in
 * the pending-injection stash; this handler drains them, in append order,
 * into one `ephemeralMessage` injected before the model's next step.
 *
 * `ephemeralMessage` over `userMessage` deliberately: the blocks are advisory
 * context (the other platforms deliver them as `additionalContext` /
 * system messages), not user speech, and ephemeral delivery keeps them out of
 * the durable transcript the same way.
 */

import {
  type HookContext,
  type PostInvocationInput,
  postInvocationHook,
  postInvocationOutput
} from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { drainPendingInjections } from './stash.js';

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PostInvocationInput, ctx: HookContext) => {
    try {
      const blocks = drainPendingInjections(layout, input.conversationId);
      if (blocks.length === 0) return undefined;
      return postInvocationOutput({ injectSteps: [{ ephemeralMessage: blocks.join('') }] });
    } catch (err) {
      ctx.logger.warn('git-span pending-injection drain failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postInvocationHook({ timeout: 10_000 }, createHandler());
