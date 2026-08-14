/** Codex PreToolUse planner that preserves apply_patch hunk ranges. */

import * as fs from 'node:fs';
import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import {
  abspathAgainst,
  DEFAULT_SESSION_LAYOUT,
  relativeToRepo,
  resolveRepoRoot,
  type SessionLayout
} from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore } from '../common/bash-attribution.js';
import { filterTrackedEligibility, type PlannedTouch } from '../common/static-attribution.js';
import { parseApplyPatch } from './apply-patch.js';
import { narrowApplyPatchCommand } from './post-tool-use.js';

function readPreEdit(cwd: string, path: string): string | null {
  try {
    return fs.readFileSync(abspathAgainst(cwd, path), 'utf8');
  } catch {
    return null;
  }
}

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return undefined;
      const command = narrowApplyPatchCommand(input.tool_input);
      if (command === null) return undefined;
      const cwd = input.cwd ?? '';
      const repoRoot = resolveRepoRoot(cwd);
      if (repoRoot === null) return undefined;
      const anchors = parseApplyPatch(command, (path) => readPreEdit(cwd, path));
      if (anchors.length === 0) {
        ctx.logger.warn('git-span apply_patch pre-plan resolved no anchors', { toolUseId: input.tool_use_id });
        return undefined;
      }
      const tracked = filterTrackedEligibility(
        anchors.map((anchor) => ({ absolutePath: abspathAgainst(cwd, anchor.path), value: anchor })),
        { cwd }
      );
      const touches: PlannedTouch[] = tracked.eligible.map(({ absolutePath, value: anchor }) => ({
        repoRelativePath: relativeToRepo(repoRoot, absolutePath),
        operation: anchor.absent ? 'delete' : anchor.kind === 'create' ? 'create-overwrite' : 'modify',
        ranges: anchor.range === undefined ? [] : [anchor.range],
        simpleCommandIndex: 0,
        ...(anchor.absent ? { evidence: { kind: 'tracked' as const, tracked: true as const } } : {})
      }));
      if (touches.length === 0) return undefined;
      createDefaultPlannedTouchStore(layout).put({
        version: 1,
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        repoRoot,
        createdAtMs: Date.now(),
        touches
      });
      ctx.logger.info?.('git-span apply_patch pre-plan', {
        planned: touches.length,
        trackedDrops: tracked.dropped.length,
        ignoreQueryCount: tracked.ignoreQueryCount,
        trackedQueryCount: tracked.trackedQueryCount,
        eligibilityErrors: tracked.errors
      });
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span apply_patch pre-plan failed closed for attribution', { err });
      return undefined;
    }
  };
}

export const APPLY_PATCH_PLAN_MATCHER = 'apply_patch';

export default preToolUseHook({ matcher: 'apply_patch', timeout: 10_000 }, createHandler());
