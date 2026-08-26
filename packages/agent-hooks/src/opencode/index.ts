/**
 * OpenCode plugin entry — assembles the git-span adapter into the host's
 * `Hooks` shape (local structural types, no SDK dependency; the peer package
 * esbuild-bundles this module to `plugins-opencode/git-span/dist/index.js`
 * for bun/node ESM loading).
 *
 * Hooks assembled here:
 * - `tool.execute.before` — static planning first (bash planned touches,
 *   apply_patch range-fidelity plans), then the advisor (hold = throw, report
 *   kinds stash-and-forward). Each stage independently fail-open.
 * - `shell.env` — records the resolved per-call cwd (live-verified ordering:
 *   before → shell.env → after) so the touch pipeline frames on truth.
 * - `tool.execute.after` — appends forwarded reports and touch blocks to the
 *   tool result. Never throws.
 * - `event` — decision-8 lifecycle split (idle prunes call state, deleted
 *   cleans disk, created tracks).
 * - `dispose` — full sweep of every session this process tracked.
 *
 * Init runs {@link startContextWarmup} against the instance directory,
 * fail-open. Executors are adapter-scoped with tightened timeouts (5 s vs the
 * 10 s defaults): OpenCode loads plugins in-process with no per-hook timeout,
 * so a stalled scan would block the host loop — the plugin bounds its own
 * subprocesses instead (plan decision 11).
 */

import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../common/advisor-core.js';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { startContextWarmup } from '../common/context-warmup.js';
import type { MemoFactory, MemoLogger } from '../common/span-surface.js';
import type { TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { createAdvisorHandler } from './advisor.js';
import { createOpencodeLogger } from './logger.js';
import { createAfterHandler } from './post-tool-use.js';
import { createDisposeHandler, createEventHandler } from './session.js';
import { createOpencodeCallState } from './stash.js';
import { createStaticPlanHandler } from './static-plan.js';
import type {
  GitSpanOpencodeHooks,
  OpencodeAfterOutput,
  OpencodeBeforeOutput,
  OpencodeEvent,
  OpencodePluginInput,
  OpencodeShellEnvInput,
  OpencodeShellEnvOutput,
  OpencodeToolInput
} from './types.js';

export { resolveFrame } from '../common/agent-hooks-common.js';
export { GitSpanHoldError } from './advisor.js';
export { createOpencodeLogger, OPENCODE_LOG_FILE_ENV } from './logger.js';
export * from './types.js';

/** Injected surfaces for {@link assemblePlugin} — every field optional. */
export interface PluginDeps {
  directory?: string;
  layout?: SessionLayout;
  logger?: MemoLogger;
  git?: GitExecutor;
  executors?: AdvisorExecutors;
  touchExecutors?: TouchExecutors;
  memoFactory?: MemoFactory;
  advisorMemoFactory?: (cwd: string) => AdvisorMemoState;
}

/**
 * Build the full hooks object over injected dependencies. The default export
 * calls this with production defaults; tests call it with fakes and a scratch
 * layout, exactly like the twins' exported `createHandler`s.
 */
export function assemblePlugin(deps: PluginDeps = {}): GitSpanOpencodeHooks {
  const directory = deps.directory ?? process.cwd();
  const layout = deps.layout ?? DEFAULT_SESSION_LAYOUT;
  const logger = deps.logger ?? createOpencodeLogger();
  const sessions = new Set<string>();
  const callState = createOpencodeCallState();

  const planHandler = createStaticPlanHandler({
    directory,
    layout,
    logger,
    stashPatchPlan: (sessionId, callId, plan) => callState.stashPatchPlan(sessionId, callId, plan),
    trackPlannedCall: (sessionId, callId) => callState.trackPlannedCall(sessionId, callId)
  });
  const advisorHandler = createAdvisorHandler({
    directory,
    git: deps.git,
    executors: deps.executors,
    memoFactory: deps.advisorMemoFactory,
    logger,
    stashReport: (sessionId, callId, block) => callState.stashReport(sessionId, callId, block)
  });
  const afterHandler = createAfterHandler({
    directory,
    layout,
    executors: deps.touchExecutors,
    memoFactory: deps.memoFactory,
    logger,
    takeReport: (sessionId, callId) => callState.takeReport(sessionId, callId),
    takePatchPlan: (sessionId, callId) => callState.takePatchPlan(sessionId, callId),
    peekShellCwd: (sessionId, callId) => callState.peekShellCwd(sessionId, callId),
    forgetCall: (sessionId, callId) => callState.forgetCall(sessionId, callId)
  });
  const eventHandler = createEventHandler({
    layout,
    logger,
    sessions,
    pruneSession: (sessionId) => callState.pruneSession(sessionId),
    plannedCalls: (sessionId) => callState.plannedCalls(sessionId),
    forgetSession: (sessionId) => callState.pruneSession(sessionId)
  });
  const dispose = createDisposeHandler({
    layout,
    logger,
    sessions,
    clearAll: () => callState.clear()
  });

  return {
    dispose,
    // Default-destructured so a missing/undefined argument fails open like
    // every adapter body instead of rejecting on destructure.
    event: async ({ event }: { event?: OpencodeEvent } = {}) => {
      if (typeof event?.properties?.sessionID === 'string' && event.properties.sessionID.length > 0) {
        sessions.add(event.properties.sessionID);
      }
      await eventHandler({ event });
    },
    'tool.execute.before': async (input: OpencodeToolInput, output: OpencodeBeforeOutput) => {
      if (typeof input?.sessionID === 'string' && input.sessionID.length > 0) sessions.add(input.sessionID);
      // Planning first: a hold thrown by the advisor aborts execution, and a
      // planned record for a never-executed call is inert (pruned at idle or
      // discarded with the session). Each stage fails open independently — a
      // planning error must not stop the advisory, and neither may block the
      // tool call by accident.
      await planHandler(input, output);
      await advisorHandler(input, output);
    },
    'shell.env': async (input: OpencodeShellEnvInput, _output: OpencodeShellEnvOutput) => {
      try {
        // Skip when sessionID is absent/empty like the sibling guards: a
        // ''-keyed frame would sit outside every session.idle/deleted prune's
        // reach (decision 8 scopes pruning to real sessionIDs) and leak forever.
        if (
          typeof input?.sessionID === 'string' &&
          input.sessionID.length > 0 &&
          typeof input?.callID === 'string' &&
          input.callID.length > 0 &&
          typeof input.cwd === 'string'
        ) {
          callState.trackShellCwd(input.sessionID, input.callID, input.cwd);
        }
      } catch (err) {
        logger.warn('git-span opencode shell.env tracking failed open', { err });
      }
    },
    'tool.execute.after': async (input: OpencodeToolInput, output: OpencodeAfterOutput) => {
      await afterHandler(input, output);
    }
  };
}

/**
 * The plugin OpenCode loads: an async init receiving `{ directory }` and
 * returning the hooks object. Warm-up is fire-and-forget and fail-open; any
 * init error still resolves to a usable hooks object rather than rejecting
 * into the fail-closed host loader.
 */
export async function gitSpanOpencode(input: OpencodePluginInput = {}): Promise<GitSpanOpencodeHooks> {
  const directory = typeof input.directory === 'string' && input.directory.length > 0 ? input.directory : process.cwd();
  const logger = createOpencodeLogger();
  try {
    startContextWarmup(directory, (err) => logger.warn('git-span context warm-up child failed', { err }));
  } catch (err) {
    logger.warn('git-span context warm-up failed open', { err });
  }
  return assemblePlugin({ ...input, directory, logger });
}

/**
 * The module shape OpenCode's loader detects: a default-exported
 * `{ id?, server }` object whose `server` builds the hooks. Detection on the
 * `server` key short-circuits before the host inspects any other export, so
 * the helper re-exports above stay safe to keep.
 *
 * `id` keys hook attribution; it matches the npm package name so logs from a
 * path-installed copy read identically to an npm-installed one.
 */
const pluginModule: { id: string; server: typeof gitSpanOpencode } = {
  id: 'opencode-git-span',
  server: gitSpanOpencode
};

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default pluginModule;
