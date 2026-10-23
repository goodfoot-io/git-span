/** OpenCode V2 setup: register domain hooks and subscribe to session lifecycle events. */

import type { PluginInput, PluginModule } from '@goodfoot/agent-hooks/opencode';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { startContextWarmup } from '../common/context-warmup.js';
import { isRecord } from '../common/guards.js';
import type { MemoFactory, MemoLogger } from '../common/span-surface.js';
import type { TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
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
  OpencodeShellEnvInput,
  OpencodeShellEnvOutput,
  OpencodeToolInput
} from './types.js';

export { resolveFrame } from '../common/agent-hooks-common.js';
export { createOpencodeLogger, OPENCODE_LOG_FILE_ENV } from './logger.js';
export * from './types.js';

/** Injected surfaces for {@link assemblePlugin} — every field optional. */
export interface PluginDeps {
  directory?: string;
  layout?: SessionLayout;
  logger?: MemoLogger;
  touchExecutors?: TouchExecutors;
  memoFactory?: MemoFactory;
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
  const afterHandler = createAfterHandler({
    directory,
    layout,
    executors: deps.touchExecutors,
    memoFactory: deps.memoFactory,
    logger,
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
    forgetSession: (sessionId) => {
      callState.pruneSession(sessionId);
    }
  });
  const dispose = createDisposeHandler({
    layout,
    logger,
    sessions,
    clearAll: () => {
      callState.clear();
    }
  });

  return {
    dispose,
    // Default-destructured so a missing/undefined argument fails open like
    // every adapter body instead of rejecting on destructure.
    event: async ({ event }: { event?: OpencodeEvent } = {}) => {
      if (typeof event?.properties?.sessionID === 'string' && event.properties.sessionID.length > 0) {
        sessions.add(event.properties.sessionID);
      }
      if (event?.type === 'session.created' && typeof event.properties?.info?.id === 'string')
        sessions.add(event.properties.info.id);
      await eventHandler({ event });
    },
    'tool.execute.before': async (input: OpencodeToolInput, output: OpencodeBeforeOutput) => {
      if (typeof input?.sessionID === 'string' && input.sessionID.length > 0) sessions.add(input.sessionID);
      await planHandler(input, output);
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

/** Register the native V2 adapter and return its asynchronous cleanup. */
export async function gitSpanOpencode(ctx: PluginInput) {
  const directory = ctx.location.directory;
  const logger = createOpencodeLogger();
  startContextWarmup(directory, (err) => logger.warn('git-span context warm-up failed', { err }));
  const hooks = assemblePlugin({ directory, logger });
  const registrations: { dispose(): Promise<void> }[] = [];
  registrations.push(
    await ctx.tool.hook('execute.before', async (event) => {
      const output: OpencodeBeforeOutput = { args: event.input };
      await hooks['tool.execute.before']?.({ tool: event.tool, sessionID: event.sessionID, callID: event.id }, output);
      event.input = output.args;
    })
  );
  registrations.push(
    await ctx.tool.hook('execute.after', async (event) => {
      if (event.status !== 'completed') return;
      const content = event.result.content;
      const text =
        typeof content === 'string'
          ? content
          : (content ?? [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
      const output: OpencodeAfterOutput = { output: text, metadata: event.result.metadata };
      await hooks['tool.execute.after']?.(
        { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
        output
      );
      const suffix = output.output?.slice(text.length);
      if (suffix)
        event.result = {
          ...event.result,
          content: typeof content === 'string' ? output.output : [...(content ?? []), { type: 'text', text: suffix }]
        };
    })
  );
  const controller = new AbortController();
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.location && event.location.directory !== directory) continue;
        const data: unknown = event.data;
        if (!isRecord(data) || typeof data.sessionID !== 'string') continue;
        if (event.type === 'session.status' && isRecord(data.status) && data.status.type === 'idle') {
          await hooks.event?.({ event: { type: 'session.idle', properties: { sessionID: data.sessionID } } });
        } else if (event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
          await hooks.event?.({ event: { type: 'session.error', properties: { sessionID: data.sessionID } } });
        } else if (event.type === 'session.created' || event.type === 'session.deleted') {
          await hooks.event?.({ event: { type: event.type, properties: { info: { id: data.sessionID } } } });
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) logger.warn('git-span OpenCode event subscription failed', { err });
    }
  })();
  return async () => {
    controller.abort();
    await Promise.all(registrations.map((registration) => registration.dispose()));
    await events;
    await hooks.dispose?.();
  };
}

const pluginModule: PluginModule = { id: 'opencode-git-span', setup: gitSpanOpencode };

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default pluginModule;
