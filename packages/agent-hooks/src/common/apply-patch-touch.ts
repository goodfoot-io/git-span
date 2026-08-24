/**
 * Shared `apply_patch` → touch translation driver — the patch sibling of
 * [bash-touch.ts](./bash-touch.ts). Both post-execution adapters (Codex
 * PostToolUse, OpenCode after hook) consume this single implementation so
 * candidate-eligibility semantics — the `targetState`/`postState.realDelete`
 * fields the write gate trusts — cannot drift between the twin runtimes
 * again (main-343).
 *
 * Each adapter retrieves its own pre-parsed plan (Codex: the disk-backed
 * planned-touch store; OpenCode: the call-scoped in-memory stash), translates
 * it into {@link PatchCandidate}s, and passes the result here. The driver owns
 * everything past retrieval: merging planned candidates with a fresh fallback
 * parse (a planned path wins; its ranges came from pre-edit content), tracked
 * -file eligibility filtering, re-admitting pre-tracked deletes the filter
 * would drop, fanning each surviving candidate out over its line ranges
 * (empty → one whole-file touch), and running the touch hooks.
 */

import { parseApplyPatch } from '../codex/apply-patch.js';
import { abspathAgainst } from './agent-hooks-common.js';
import type { CoreLogger, MemoFactory } from './span-surface.js';
import { filterTrackedEligibility } from './static-attribution.js';
import { runTouchHooks, type TouchExecutors, type TouchInput } from './touch-core.js';

/** One file a patch plans to change, in the touch pipeline's vocabulary. */
export interface PatchCandidate {
  absolutePath: string;
  operation: 'create-overwrite' | 'modify' | 'delete';
  ranges: readonly { start: number; end: number }[];
  preTrackedDelete: boolean;
}

/** The fallback parse never recovers ranges — only a retrieved plan can. */
const noRangeRecovery = (): null => null;

/**
 * Attribute an executed `apply_patch` call: merge the adapter-retrieved plan
 * with a fresh whole-file fallback parse of the patch text, gate every
 * candidate on tracked-file eligibility (pre-tracked deletes excepted), and
 * run the resulting touches. Returns the non-null `additionalContext` blocks
 * for the adapter to join.
 */
export async function runApplyPatchTouches(
  patchText: string,
  cwd: string,
  sessionId: string,
  planned: readonly PatchCandidate[],
  executors: TouchExecutors,
  memo: ReturnType<MemoFactory>,
  invocationId: string | null,
  logger: CoreLogger
): Promise<string[]> {
  const plannedPaths = new Set(planned.map(({ absolutePath }) => absolutePath));
  const fallback: PatchCandidate[] = parseApplyPatch(patchText, noRangeRecovery)
    .map(
      (anchor): PatchCandidate => ({
        absolutePath: abspathAgainst(cwd, anchor.path),
        operation: anchor.absent ? 'delete' : anchor.kind === 'create' ? 'create-overwrite' : 'modify',
        ranges: anchor.range === undefined ? [] : [anchor.range],
        preTrackedDelete: false
      })
    )
    .filter(({ absolutePath }) => !plannedPaths.has(absolutePath));
  const candidates = [...planned, ...fallback];
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.absolutePath, value })),
    { cwd }
  );
  const eligible = new Set(tracked.eligible.map(({ value }) => value));
  for (const candidate of candidates) if (candidate.preTrackedDelete) eligible.add(candidate);

  const touches: TouchInput[] = [];
  for (const candidate of candidates) {
    if (!eligible.has(candidate)) continue;
    const ranges = candidate.ranges.length === 0 ? [undefined] : candidate.ranges;
    for (const range of ranges) {
      touches.push({
        kind: 'write',
        sessionId,
        cwd,
        filePath: candidate.absolutePath,
        ...(invocationId === null ? {} : { invocationId }),
        written: '',
        range,
        targetState: candidate.operation === 'delete' ? 'absent' : 'exists',
        ...(candidate.operation === 'delete' ? { postState: { realDelete: true } } : {})
      });
    }
  }
  const batch = await runTouchHooks(touches, executors, memo, invocationId, undefined, logger);
  return batch.outputs.flatMap((output) => (output.additionalContext === null ? [] : [output.additionalContext]));
}
