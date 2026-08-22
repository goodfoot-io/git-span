/**
 * OpenCode after-hook touch adapter — the twin of
 * [codex/post-tool-use.ts](../codex/post-tool-use.ts) and
 * [claude/post-tool-use.ts](../claude/post-tool-use.ts).
 *
 * Fires by exact tool id (`bash`/`read`/`edit`/`write`/`apply_patch`; the
 * experimental code-mode `execute` tool is excluded — accepted v1 gap) and
 * appends any `<git-span>` blocks to `output.output`, the injection channel
 * live-verified to reach the model verbatim. Because the host fires this hook
 * only after successful execution (spike S2), reaching this handler IS the
 * tool's success proof — there is no extra response-classification gate like
 * Codex's apply_patch prefix check, and a failed tool call never arrives here
 * at all (documented degraded parity).
 *
 * - `bash` — decision-10 response mapping ({@link toBashResponse}) into
 *   {@link runLayeredBashTouches}; effective frame is the `shell.env`-tracked
 *   cwd for the callID (live-verified ordering before → shell.env → after),
 *   falling back to the resolved `workdir`/init directory.
 * - `read` / `edit` / `write` — structured touches translated like Claude's,
 *   filtered through the post-command tracked index first.
 * - `apply_patch` — pre-parsed plans (range fidelity from pre-edit content)
 *   consumed first, fresh {@link parseApplyPatch} fallback for unplanned files.
 *
 * Never throws: the whole body is fail-open, because an uncaught after-hook
 * error would block an already-executed tool call on the fail-closed host.
 */

import { parseApplyPatch } from '../codex/apply-patch.js';
import {
  abspathAgainst,
  canonicalizePath,
  DEFAULT_SESSION_LAYOUT,
  type SessionLayout
} from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, runLayeredBashTouches } from '../common/bash-attribution.js';
import { createDiskMemoStore, type MemoFactory, type MemoLogger } from '../common/span-surface.js';
import { filterTrackedEligibility } from '../common/static-attribution.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  runTouchHooks,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { resolveFrame } from './advisor.js';
import {
  narrowApplyPatchText,
  narrowBashArgs,
  narrowEditArgs,
  narrowReadArgs,
  narrowWriteArgs,
  toBashResponse
} from './narrows.js';
import type { PatchPlanTouch } from './stash.js';
import type { OpencodeAfterOutput, OpencodeToolInput } from './types.js';

interface PatchCandidate {
  absolutePath: string;
  operation: 'create-overwrite' | 'modify' | 'delete';
  ranges: readonly { start: number; end: number }[];
  preTrackedDelete: boolean;
}

/** Translate a stashed pre-parsed plan into touch-pipeline candidates. */
function stashedPlanCandidates(plan: readonly PatchPlanTouch[]): PatchCandidate[] {
  return plan.map((touch) => ({
    absolutePath: touch.absolutePath,
    operation: touch.operation,
    ranges: touch.ranges,
    preTrackedDelete: touch.preTrackedDelete
  }));
}

async function runPatchTouches(
  patchText: string,
  cwd: string,
  sessionId: string,
  stashed: readonly PatchPlanTouch[] | null,
  executors: TouchExecutors,
  memo: ReturnType<MemoFactory>,
  invocationId: string | null
): Promise<string[]> {
  const planned = stashed !== null ? stashedPlanCandidates(stashed) : [];
  const plannedPaths = new Set(planned.map(({ absolutePath }) => absolutePath));
  const noRangeRecovery = (): null => null;
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
  const batch = await runTouchHooks(touches, executors, memo, invocationId);
  return batch.outputs.flatMap((output) => (output.additionalContext === null ? [] : [output.additionalContext]));
}

export interface AfterHandlerDeps {
  directory: string;
  layout?: SessionLayout;
  executors?: TouchExecutors;
  memoFactory?: MemoFactory;
  logger?: MemoLogger;
}

export function createAfterHandler(
  deps: AfterHandlerDeps & {
    takeReport(sessionId: string, callId: string): string | null;
    takePatchPlan(sessionId: string, callId: string): readonly PatchPlanTouch[] | null;
    peekShellCwd(sessionId: string, callId: string): string | null;
    forgetCall(sessionId: string, callId: string): void;
  }
) {
  const layout = deps.layout ?? DEFAULT_SESSION_LAYOUT;
  const executors = deps.executors ?? createDefaultTouchExecutors();
  const memoFactory = deps.memoFactory ?? createDiskMemoStore;
  const logger = deps.logger ?? { warn: () => undefined };
  return async (input: OpencodeToolInput, output: OpencodeAfterOutput): Promise<void> => {
    try {
      const sessionId = typeof input?.sessionID === 'string' ? input.sessionID : '';
      const callId = typeof input?.callID === 'string' ? input.callID : '';
      const args = (input?.args ?? {}) as Record<string, unknown>;
      // Forwarded report-kind checklist stashed by the before hook (decision 3):
      // appended ahead of any touch blocks so the report reads first.
      const forwarded = deps.takeReport(sessionId, callId);
      let blocks: string[] = [];

      if (input?.tool === 'bash') {
        const narrowed = narrowBashArgs(args);
        if (narrowed !== null) {
          const shellCwd = deps.peekShellCwd(sessionId, callId);
          const workdir = typeof args.workdir === 'string' ? args.workdir : undefined;
          const effectiveCwd = shellCwd ?? resolveFrame(workdir, deps.directory);
          const mapped = toBashResponse(output?.output, output?.metadata);
          blocks = await runLayeredBashTouches(
            narrowed.command,
            effectiveCwd,
            sessionId,
            callId.length > 0 ? callId : undefined,
            mapped,
            executors,
            memoFactory(logger, layout),
            logger,
            createDefaultPlannedTouchStore(layout)
          );
        }
        deps.forgetCall(sessionId, callId);
      } else if (input?.tool === 'read') {
        const narrowed = narrowReadArgs(args);
        if (narrowed !== null) {
          const cwd = deps.directory;
          const filePath = canonicalizePath(abspathAgainst(cwd, narrowed.filePath));
          const memo = memoFactory(logger, layout);
          const touch: TouchInput = {
            kind: 'read',
            sessionId,
            cwd,
            filePath,
            ...(callId.length > 0 ? { invocationId: `${sessionId}:${callId}` } : {}),
            ...(narrowed.offset === undefined ? {} : { offset: narrowed.offset }),
            ...(narrowed.limit === undefined ? {} : { limit: narrowed.limit })
          };
          if (postTracked(touch, cwd)) {
            const result = await runTouchHook(touch, executors, memo);
            if (result.additionalContext !== null) blocks = [result.additionalContext];
          }
        }
      } else if (input?.tool === 'edit' || input?.tool === 'write') {
        const narrowed = input.tool === 'edit' ? narrowEditArgs(args) : narrowWriteArgs(args);
        if (narrowed !== null) {
          const cwd = deps.directory;
          const filePath = canonicalizePath(abspathAgainst(cwd, narrowed.filePath));
          const memo = memoFactory(logger, layout);
          const touch: TouchInput = {
            kind: 'write',
            sessionId,
            cwd,
            filePath,
            ...(callId.length > 0 ? { invocationId: `${sessionId}:${callId}` } : {}),
            written: narrowed.written,
            targetState: 'exists'
          };
          if (postTracked(touch, cwd)) {
            const result = await runTouchHook(touch, executors, memo);
            if (result.additionalContext !== null) blocks = [result.additionalContext];
          }
        }
      } else if (input?.tool === 'apply_patch') {
        const patchText = narrowApplyPatchText(args);
        if (patchText !== null) {
          const cwd = deps.directory;
          const stashed = deps.takePatchPlan(sessionId, callId);
          blocks = await runPatchTouches(
            patchText,
            cwd,
            sessionId,
            stashed,
            executors,
            memoFactory(logger, layout),
            callId.length > 0 ? `${sessionId}:${callId}` : null
          );
        }
        deps.forgetCall(sessionId, callId);
      }

      // Every appended part sits on its own line after the tool result text:
      // strip leading newlines and re-add exactly one, whether the part came
      // from the core's renderer (already `\n`-prefixed) or a stashed report.
      const combined = [...(forwarded === null ? [] : [forwarded]), ...blocks]
        .map((part) => `\n${part.replace(/^\n+/, '')}`)
        .join('');
      if (combined.length > 0 && output !== null && typeof output === 'object') {
        output.output = (typeof output.output === 'string' ? output.output : '') + combined;
      }
    } catch (err) {
      logger.warn('git-span opencode touch hook failed open on an uncaught error', { err });
    }
  };
}

function postTracked(touch: TouchInput, cwd: string): boolean {
  return filterTrackedEligibility([{ absolutePath: touch.filePath, value: touch }], { cwd }).eligible.length > 0;
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();
