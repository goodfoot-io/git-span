/**
 * Claude PostToolUseFailure hook — the failed-command snapshot comparison.
 *
 * Fires after a `Bash` tool call fails. The failure policy: whenever a record
 * exists, run the same comparison as PostToolUse and attribute — the diff is
 * the evidence; a failed command that mutated nothing yields no candidates,
 * while partial mutations from a failed-but-not-interrupted command are never
 * silently lost. `is_interrupt` is not a mutation report and gates nothing;
 * an interrupted command that cannot confirm its own window end is handled by
 * the concurrency rules, not by trusting the interrupt flag. A failure event
 * with no record discards with a `warn` — the loss is never silent.
 * Phase 1: thin handler — find the record via the `Not Implemented` store
 * stub, which fails open to that warn; Phase 3 fills the comparison.
 */

import { type HookContext, type PostToolUseFailureInput, postToolUseFailureHook } from '@goodfoot/claude-code-hooks';
import { createSnapshotStore, type SnapshotStore } from '../common/snapshot-store.js';
import type { CoreLogger } from '../common/span-surface.js';

export function createHandler(storeFactory: (logger: CoreLogger) => SnapshotStore = createSnapshotStore) {
  return async (input: PostToolUseFailureInput, ctx: HookContext) => {
    try {
      const store = storeFactory(ctx.logger);
      const found = store.find(input.session_id, input.tool_use_id);
      if (found === 'tombstoned') {
        // Already consumed (a duplicate delivery, or a failure-path replay) —
        // nothing to do.
        return null;
      }
      if (found === null) {
        // A failure with no record discards with a warn — the loss is never
        // silent.
        ctx.logger.warn('git-span: failed Bash call has no snapshot record; discarding', {
          toolUseId: input.tool_use_id
        });
        return null;
      }
      // Phase 3: run the same comparison as PostToolUse and attribute what the
      // diff shows — a failed command that mutated nothing yields no
      // candidates, while partial mutations from a failed-but-not-interrupted
      // command are never silently lost. is_interrupt is not a mutation report
      // and gates nothing.
      return null;
    } catch (err) {
      // Fail open: never let the failure handler abort the harness — the
      // failure hook must always succeed so the harness's own error handling
      // is never compounded.
      ctx.logger.warn('git-span post-tool-use-failure failed open on an uncaught error', { err });
      return null;
    }
  };
}

export default postToolUseFailureHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
