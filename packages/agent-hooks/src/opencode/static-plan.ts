/**
 * OpenCode before-hook static planner — the twin of
 * [codex/static-plan.ts](../codex/static-plan.ts) and
 * [codex/apply-patch-plan.ts](../codex/apply-patch-plan.ts), collapsed into
 * one handler because OpenCode exposes a single `tool.execute.before` slot.
 *
 * Records planned touches BEFORE execution, keyed by callID:
 * - `bash` — the same shared planning entry the Codex static-plan path uses
 *   ({@link planBashTouches} over the disk-backed planned-touch store), so
 *   deletes/substitution ranges/pre-command EOF evidence survive until
 *   `runLayeredBashTouches` consumes them on the success path.
 * - `apply_patch` — {@link parseApplyPatch} against pre-edit content (the
 *   range-fidelity trick from the Codex planner), stashed in-memory for the
 *   paired after hook. In-memory by design: a patch plan only ever needs to
 *   outlive its own tool call, so nothing lands on disk to leak.
 *
 * OpenCode's experimental code-mode `execute` tool is deliberately not
 * planned (accepted v1 gap). Whole-body fail-open: planning is attribution
 * bookkeeping, and its failure must never block a tool call.
 */

import * as fs from 'node:fs';
import { parseApplyPatch } from '../codex/apply-patch.js';
import {
  abspathAgainst,
  DEFAULT_SESSION_LAYOUT,
  resolveRepoRoot,
  type SessionLayout
} from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import type { MemoLogger } from '../common/span-surface.js';
import { filterTrackedEligibility } from '../common/static-attribution.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { resolveFrame } from './advisor.js';
import { narrowApplyPatchText, narrowBashArgs } from './narrows.js';
import type { PatchPlanTouch } from './stash.js';
import type { OpencodeBeforeOutput, OpencodeToolInput } from './types.js';

function readPreEdit(cwd: string, path: string): string | null {
  try {
    return fs.readFileSync(abspathAgainst(cwd, path), 'utf8');
  } catch {
    return null;
  }
}

export interface StaticPlanHandlerDeps {
  directory: string;
  layout?: SessionLayout;
  logger?: MemoLogger;
}

export function createStaticPlanHandler(
  deps: StaticPlanHandlerDeps & {
    stashPatchPlan(sessionId: string, callId: string, plan: readonly PatchPlanTouch[]): void;
    trackPlannedCall(sessionId: string, callId: string): void;
  }
) {
  const layout = deps.layout ?? DEFAULT_SESSION_LAYOUT;
  const logger = deps.logger ?? { warn: () => undefined };
  return async (input: OpencodeToolInput, output: OpencodeBeforeOutput): Promise<void> => {
    try {
      const sessionId = typeof input?.sessionID === 'string' ? input.sessionID : '';
      const callId = typeof input?.callID === 'string' ? input.callID : '';
      const args = (output?.args ?? {}) as Record<string, unknown>;
      const workdir = typeof args.workdir === 'string' ? args.workdir : undefined;

      if (input?.tool === 'bash') {
        const narrowed = narrowBashArgs(args);
        if (narrowed === null || callId.length === 0) return;
        const frame = resolveFrame(workdir, deps.directory);
        planBashTouches(narrowed.command, frame, sessionId, callId, logger, createDefaultPlannedTouchStore(layout));
        deps.trackPlannedCall(sessionId, callId);
        return;
      }

      if (input?.tool === 'apply_patch') {
        const patchText = narrowApplyPatchText(args);
        if (patchText === null || callId.length === 0) return;
        const cwd = resolveFrame(workdir, deps.directory);
        const repoRoot = resolveRepoRoot(cwd);
        if (repoRoot === null) return;
        const anchors = parseApplyPatch(patchText, (path) => readPreEdit(cwd, path));
        if (anchors.length === 0) {
          logger.warn('git-span apply_patch pre-plan resolved no anchors', { callId });
          return;
        }
        const tracked = filterTrackedEligibility(
          anchors.map((anchor) => ({ absolutePath: abspathAgainst(cwd, anchor.path), value: anchor })),
          { cwd }
        );
        // Stashed in the pre-parsed absolute-path shape the after hook's touch
        // pipeline consumes; range fidelity comes from reading pre-edit content
        // above, before the patch applies.
        const planTouches: PatchPlanTouch[] = tracked.eligible.map(({ absolutePath, value: anchor }) => ({
          absolutePath,
          operation: anchor.absent ? 'delete' : anchor.kind === 'create' ? 'create-overwrite' : 'modify',
          ranges: anchor.range === undefined ? [] : [anchor.range],
          preTrackedDelete: anchor.absent === true
        }));
        // Mirror the Codex planner's log shape so both twins' hook logs read alike.
        logger.info?.('git-span apply_patch pre-plan', {
          planned: planTouches.length,
          trackedDrops: tracked.dropped.length,
          ignoreQueryCount: tracked.ignoreQueryCount,
          trackedQueryCount: tracked.trackedQueryCount,
          eligibilityErrors: tracked.errors
        });
        if (planTouches.length > 0) deps.stashPatchPlan(sessionId, callId, planTouches);
      }
    } catch (err) {
      logger.warn('git-span opencode pre-plan failed open on an uncaught error', { err });
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();
