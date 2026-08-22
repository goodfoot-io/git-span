/**
 * Call-scoped in-memory state for the OpenCode adapter, keyed
 * `${sessionID}:${callID}`.
 *
 * Three kinds of state live here, all of which must die with their call or
 * session (plan decision 8 — `session.idle` is a turn boundary that prunes
 * call-scoped state, never the surfaced-span memo):
 *
 * - **report blocks** — environmental/scan-failed/`git status` advisory
 *   checklists rendered in the before-hook and stashed for the paired after
 *   hook to append post-execution (decision 3's stash-and-forward). Consumed
 *   on read; an entry whose tool call failed (after never fires) expires at
 *   the next prune.
 * - **patch plans** — `apply_patch` anchors parsed against pre-edit content
 *   before execution (range fidelity), consumed by the paired after hook.
 * - **shell cwd frames** — the resolved per-call cwd the `shell.env` handler
 *   records by callID (live-verified ordering: before → shell.env → after),
 *   consumed by the bash touch pipeline as its authoritative frame.
 *
 * A per-session index of calls with planned bash touches lets idle pruning
 * discard the disk-backed records without touching any other session. Pure
 * in-memory Maps: process-local by design, bun/node-safe.
 */

/** A pre-parsed apply_patch candidate, ready for the touch pipeline. */
export interface PatchPlanTouch {
  absolutePath: string;
  operation: 'create-overwrite' | 'modify' | 'delete';
  ranges: readonly { start: number; end: number }[];
  preTrackedDelete: boolean;
}

interface CallEntry {
  report?: string;
  patchPlan?: PatchPlanTouch[];
  shellCwd?: string;
}

export interface OpencodeCallState {
  /** Stash a rendered report block for the paired after hook (replaces any prior). */
  stashReport(sessionId: string, callId: string, block: string): void;
  /** Consume-on-read the stashed report block, if any. */
  takeReport(sessionId: string, callId: string): string | null;
  /** Record a pre-parsed patch plan for the paired after hook (replaces any prior). */
  stashPatchPlan(sessionId: string, callId: string, plan: readonly PatchPlanTouch[]): void;
  /** Consume-on-read the stashed patch plan, if any. */
  takePatchPlan(sessionId: string, callId: string): PatchPlanTouch[] | null;
  /** Record the resolved per-call cwd from the `shell.env` handler. */
  trackShellCwd(sessionId: string, callId: string, cwd: string): void;
  /** The most recent shell cwd recorded for this exact call, if still tracked. */
  peekShellCwd(sessionId: string, callId: string): string | null;
  /** Mark a call as carrying a planned bash touch record (for idle pruning). */
  trackPlannedCall(sessionId: string, callId: string): void;
  /** Every live `${sessionId}:${callId}` key marked as bash-planned for a session. */
  plannedCalls(sessionId: string): string[];
  /** Drop one call's entry and its planned-call marking (post-consumption tidy-up). */
  forgetCall(sessionId: string, callId: string): void;
  /**
   * Prune every call-scoped entry and planned-call marking for a session —
   * the `session.idle` turn boundary. Never touches cross-session state.
   */
  pruneSession(sessionId: string): void;
  /** Dispose-time full sweep of every session this process has tracked. */
  clear(): void;
}

function key(sessionId: string, callId: string): string {
  return `${sessionId}:${callId}`;
}

export function createOpencodeCallState(): OpencodeCallState {
  const entries = new Map<string, CallEntry>();
  // sessionId -> keys registered in `entries` for that session, so pruning
  // never has to scan or prefix-match across unrelated sessions.
  const bySession = new Map<string, Set<string>>();
  const planned = new Set<string>();

  function entryFor(k: string): CallEntry {
    let entry = entries.get(k);
    if (entry === undefined) {
      entry = {};
      entries.set(k, entry);
    }
    return entry;
  }

  function indexOfSession(sessionId: string): Set<string> {
    let set = bySession.get(sessionId);
    if (set === undefined) {
      set = new Set<string>();
      bySession.set(sessionId, set);
    }
    return set;
  }

  function dropKey(k: string): void {
    entries.delete(k);
    planned.delete(k);
  }

  return {
    stashReport(sessionId, callId, block) {
      const k = key(sessionId, callId);
      entryFor(k).report = block;
      indexOfSession(sessionId).add(k);
    },
    takeReport(sessionId, callId) {
      const k = key(sessionId, callId);
      const entry = entries.get(k);
      const report = entry?.report;
      if (entry !== undefined) delete entry.report;
      return typeof report === 'string' ? report : null;
    },
    stashPatchPlan(sessionId, callId, plan) {
      const k = key(sessionId, callId);
      entryFor(k).patchPlan = [...plan];
      indexOfSession(sessionId).add(k);
    },
    takePatchPlan(sessionId, callId) {
      const k = key(sessionId, callId);
      const entry = entries.get(k);
      const plan = entry?.patchPlan;
      if (entry !== undefined) delete entry.patchPlan;
      return Array.isArray(plan) ? plan : null;
    },
    trackShellCwd(sessionId, callId, cwd) {
      const k = key(sessionId, callId);
      entryFor(k).shellCwd = cwd;
      indexOfSession(sessionId).add(k);
    },
    peekShellCwd(sessionId, callId) {
      const cwd = entries.get(key(sessionId, callId))?.shellCwd;
      return typeof cwd === 'string' ? cwd : null;
    },
    trackPlannedCall(sessionId, callId) {
      const k = key(sessionId, callId);
      planned.add(k);
      indexOfSession(sessionId).add(k);
    },
    plannedCalls(sessionId) {
      const set = bySession.get(sessionId);
      if (set === undefined) return [];
      return [...set].filter((k) => planned.has(k));
    },
    forgetCall(sessionId, callId) {
      dropKey(key(sessionId, callId));
    },
    pruneSession(sessionId) {
      const set = bySession.get(sessionId);
      if (set === undefined) return;
      for (const k of set) dropKey(k);
      bySession.delete(sessionId);
    },
    clear() {
      entries.clear();
      bySession.clear();
      planned.clear();
    }
  };
}
