/**
 * OpenCode session lifecycle — decision 8: `session.idle` is a TURN boundary,
 * not a session end (live-verified: idle fires after each completed prompt,
 * `dispose` only at exit). Idle therefore prunes ONLY call-scoped state
 * (stashed reports, patch plans, shell cwd frames, and pending bash
 * planned-touch records for that session) and never the surfaced-span memo on
 * disk, or identical spans would re-inject every turn.
 *
 * `session.deleted` runs the full {@link cleanupSessionState} sweep (memo +
 * plans under the session layout) plus the in-memory call state, and untracks
 * the session. `dispose()` backstops every session this process ever saw —
 * the host fires it once at shutdown.
 *
 * Fail-open throughout: lifecycle cleanup must never reject into the host's
 * fail-closed event dispatch.
 */

import { cleanupSessionState, DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore } from '../common/bash-attribution.js';
import type { MemoLogger } from '../common/span-surface.js';

export interface LifecycleHandlerDeps {
  layout?: SessionLayout;
  logger?: MemoLogger;
  /** Sessions this process has seen; owned by the assembled plugin. */
  sessions: Set<string>;
}

export function createEventHandler(
  deps: LifecycleHandlerDeps & {
    pruneSession(sessionId: string): void;
    plannedCalls(sessionId: string): string[];
    forgetSession(sessionId: string): void;
  }
) {
  const layout = deps.layout ?? DEFAULT_SESSION_LAYOUT;
  const logger = deps.logger ?? { warn: () => undefined };
  return async (context: { event?: { type?: string; properties?: { sessionID?: string } } }): Promise<void> => {
    try {
      const type = context?.event?.type;
      const sessionId = context?.event?.properties?.sessionID;
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      if (type === 'session.created') {
        deps.sessions.add(sessionId);
        return;
      }
      if (type === 'session.idle') {
        // Turn boundary: drop only call-scoped state. The disk-backed bash
        // planned touches are discarded through their store; the surfaced-span
        // memo file is deliberately untouched.
        const store = createDefaultPlannedTouchStore(layout);
        for (const k of deps.plannedCalls(sessionId)) {
          const callId = k.slice(sessionId.length + 1);
          try {
            store.discard(sessionId, callId);
          } catch (err) {
            logger.warn('git-span opencode idle discard failed open', { err });
          }
        }
        deps.pruneSession(sessionId);
        return;
      }
      if (type === 'session.deleted') {
        // Real session end: full sweep of per-session disk state plus memory.
        try {
          cleanupSessionState(layout, sessionId);
        } catch (err) {
          logger.warn('git-span opencode session-deleted cleanup failed open', { err });
        }
        deps.forgetSession(sessionId);
        deps.sessions.delete(sessionId);
        return;
      }
    } catch (err) {
      logger.warn('git-span opencode event handling failed open', { err });
    }
  };
}

export function createDisposeHandler(deps: LifecycleHandlerDeps & { clearAll(): void }) {
  const layout = deps.layout ?? DEFAULT_SESSION_LAYOUT;
  const logger = deps.logger ?? { warn: () => undefined };
  return async (): Promise<void> => {
    for (const sessionId of [...deps.sessions]) {
      try {
        cleanupSessionState(layout, sessionId);
      } catch (err) {
        logger.warn('git-span opencode dispose sweep failed open', { err, sessionId });
      }
    }
    deps.clearAll();
    deps.sessions.clear();
  };
}
