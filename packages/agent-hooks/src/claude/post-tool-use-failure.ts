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
 *
 * The comparison is the shared {@link snapshotBashBranch} from the common
 * snapshot harness — no classifier gate (the failure policy compares
 * whenever a record exists, whatever the command), no static-parse co-run (a
 * failed command's static idioms are not reliable evidence), and the
 * consumption rules are identical: a mutated-nothing failure still closes the
 * record window, and a duplicate delivery finds the tombstone and no-ops.
 * Fail-open is load-bearing: the failure hook must always succeed so the
 * harness's own error handling is never compounded.
 */

import {
  type HookContext,
  type PostToolUseFailureInput,
  postToolUseFailureHook,
  postToolUseFailureOutput
} from '@goodfoot/claude-code-hooks';
import { resolveRepoRoot } from '../common/agent-hooks-common.js';
import { resolveSnapshotBudgets, snapshotBashBranch } from '../common/snapshot-harness.js';
import { createSnapshotStore, type SnapshotStore } from '../common/snapshot-store.js';
import { type CoreLogger, createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';

/** Narrow a failed `Bash` tool_input to its `command` string. */
function narrowCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string' && command.length > 0) return command;
  }
  return null;
}

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  storeFactory: (logger: CoreLogger, repoRoot: string | null) => SnapshotStore = (logger, repoRoot) =>
    createSnapshotStore(logger, resolveSnapshotBudgets(repoRoot))
) {
  return async (input: PostToolUseFailureInput, ctx: HookContext) => {
    try {
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      // Same budget resolution as the pre side (env → repo config → defaults);
      // a repo-less cwd resolves null and skips the config layer only.
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      const outcome = await snapshotBashBranch(
        storeFactory(ctx.logger, repoRoot),
        input.session_id,
        input.tool_use_id,
        input.cwd ?? '',
        executors,
        memoFactory(ctx.logger),
        ctx.logger,
        resolveSnapshotBudgets(repoRoot)
      );
      if (outcome.kind === 'no-record') {
        // A failure with no record discards with a warn — the loss is never
        // silent.
        ctx.logger.warn('git-span: failed Bash call has no snapshot record; discarding', {
          toolUseId: input.tool_use_id
        });
        return null;
      }
      if (outcome.kind === 'tombstoned') {
        // Already consumed (a duplicate delivery, or a failure-path replay) —
        // nothing to do.
        return null;
      }
      // The comparison found no mutation worth surfacing — the record window
      // is still closed by the consume inside the branch.
      if (outcome.additionalContext === null) return null;
      return postToolUseFailureOutput({
        hookSpecificOutput: { additionalContext: outcome.additionalContext }
      });
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
