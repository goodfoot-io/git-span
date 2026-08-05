/**
 * Harness-agnostic snapshot store (Phase 1 — contract and stubs).
 *
 * One home for snapshot state, per the plan: JSON records in the per-session
 * directory (`sessionDir(sessionId)/snapshots/`), a lightweight per-repo
 * presence index in the repo's git common dir, consumption tombstones, the
 * activity log, and the TTL/session-end sweep. The index exists only so
 * cross-session concurrency detection never has to enumerate other sessions'
 * record dirs — a record is deterministically addressable from its index entry
 * via `sessionDir(sessionId)`, and index entries are removed when the record
 * is removed.
 *
 * All files are written with 0600 permissions (dirs 0700); record, index,
 * tombstone, and activity-entry JSON each carry a `version` field whose
 * mismatch on read fails closed (discard + diagnostic) — stale or foreign
 * files are never parsed. Fail-open is not the store's default: records are
 * the evidence the concurrency rules depend on, so reads that find an
 * unreadable-but-present record surface the failure through the injected
 * logger rather than silently inventing an absent record.
 *
 * Every method whose behavior is real logic is a `Not Implemented` stub in
 * this phase; Phase 2 writes skipped checks against these signatures and
 * Phase 3 implements them. The record shape itself is declared in
 * snapshot-core.ts (its canonical home per the card's contract list) and
 * re-exported here so the store module reads self-contained.
 */

import {
  DEFAULT_SNAPSHOT_BUDGETS,
  type SnapshotBudgets,
  type SnapshotFile,
  type SnapshotRecord,
  type SnapshotTier
} from './snapshot-core.js';
import type { CoreLogger } from './span-surface.js';

export type { SnapshotFile, SnapshotRecord } from './snapshot-core.js';

// ---------------------------------------------------------------------------
// Index, tombstone, activity-log shapes
// ---------------------------------------------------------------------------

/**
 * One entry of the per-repo snapshot presence index
 * (`<git-common>/git-span/snapshot-index/<sanitized-session>__<sanitized-tool_use_id>.json`).
 * The path-coverage list lets the ambiguity check cheaply know which paths a
 * sibling record's pre walk covered: paths not listed could not have been
 * changed by that sibling's command, so they are not ambiguous. A record
 * carrying a coverage gap lists `'all'` — its coverage is unknowable, and the
 * ambiguity rules treat it as covering every path.
 */
export interface SnapshotIndexEntry {
  sessionId: string;
  toolUseId: string;
  /** The instant the record was written — the ambiguity table's tiebreaker order. */
  createdAt: number;
  consumed: boolean;
  consumedAt: number | null;
  tier: SnapshotTier;
  /** Repo-relative paths the record's pre walk covered, or 'all' when the walk was incomplete. */
  covered: string[] | 'all';
}

/**
 * The consumption tombstone — the plan's "consume twice, once" winner record.
 * Consumption is the only shared-state mutation; the tombstone is created
 * O_EXCL by the consuming PostToolUse, so the FIRST consumer wins and a
 * duplicate delivery (re-run PostToolUse, a failure-path replay) is a no-op.
 * Lives under the record's session dir next to the record itself.
 */
export interface SnapshotTombstone {
  version: 1;
  toolUseId: string;
  /** The instant the consuming PostToolUse finished (same clock as createdAt/finishedAt). */
  consumedAt: number;
}

/**
 * One path's pre/post hash stamps within an activity entry. `preHash` is read
 * by the activity pre-hook before the edit's write lands; `postHash` is
 * stamped by the end of that same edit's own touch. A failed pre-hook read
 * leaves `preHash` null; a failed touch leaves `postHash` null — and the
 * never-flag rule requires `finishedAt ≤ capturedAt(P)`, so a null stamp can
 * never resolve a boundary as clean.
 */
export interface ActivityPathStamp {
  /** Repo-relative path of the edited file. */
  path: string;
  /** The state the edit's write starts from; null when the pre-hook read failed. */
  preHash: string | null;
  /** The state the edit's touch read; null while the edit is in flight or its touch failed. */
  postHash: string | null;
}

/**
 * One path's completion stamp, applied by {@link finishActivityEntry} at the
 * end of the edit's own touch. Narrower than the full
 * {@link ActivityPathStamp}: `preHash` is written once by the pre-hook and is
 * not re-supplied.
 */
export interface ActivityFinishStamp {
  /** Repo-relative path of the edited file. */
  path: string;
  /** The state the edit's touch read; null when the touch failed. */
  postHash: string | null;
}

/**
 * One activity-log entry per (session, tool_use_id), written by the
 * PreToolUse activity adapter before the edit lands
 * (`<git-common>/git-span/activity-log/<sanitized-session>__<sanitized-tool_use_id>.json`)
 * — intent logged before the write, so an interleaved edit inside a Bash
 * snapshot window is resolvable even though its PostToolUse stamp arrives
 * after the Bash call's own comparison. A single apply_patch edits several
 * files, hence the per-path array.
 */
export interface ActivityEntry {
  sessionId: string;
  toolUseId: string;
  /** The tool kind ('Edit' | 'Write' | 'apply_patch'). */
  kind: string;
  /** The instant the activity pre-hook created the entry. */
  startedAt: number;
  /** The instant the edit's own touch stamped completion; null while the edit is in flight. */
  finishedAt: number | null;
  /** One stamp per edited path. */
  paths: ActivityPathStamp[];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** What the sweep removed, for diagnostics. */
export interface SweepResult {
  records: number;
  tombstones: number;
  activityEntries: number;
  indexEntries: number;
}

/**
 * The snapshot store: record and index persistence, consumption with
 * tombstones, cross-session index reads, and the TTL/session-end sweep.
 * Created per hook invocation (no cross-hook state to share); the budgets are
 * fixed at creation and drive the storage cap, the TTLs, and the walk budgets
 * the sweep honors.
 */
export interface SnapshotStore {
  /**
   * Persist a new pre-walk record and its index entry (the PreToolUse
   * snapshot hook's only write). Refuses (returns false, logged with a
   * diagnostic) when the record would exceed `budgets.maxStorageBytes`
   * across the repo — never drop-oldest, because deleting records would
   * silently destroy the ambiguity evidence. Opportunistically runs the
   * TTL sweep first, like pruneStaleSessions.
   */
  write(record: SnapshotRecord): boolean;

  /**
   * Find a live record. Returns the record, `'tombstoned'` when a tombstone
   * exists (an already-consumed call — duplicate PostToolUse delivery, a
   * failure-path replay), or null when neither exists. A version mismatch or
   * unreadable-but-present record fails closed: logged, treated as absent.
   */
  find(sessionId: string, toolUseId: string): SnapshotRecord | 'tombstoned' | null;

  /**
   * Consume a record: persist the post state, mark `consumed`, stamp
   * `consumedAt` (the ambiguity table's window-overlap rows read it), create
   * the tombstone O_EXCL, and update the index entry. Returns the consumed
   * record on success; null when the tombstone already exists (lost race —
   * the first consumer won).
   */
  consume(sessionId: string, toolUseId: string, post: Record<string, SnapshotFile>): SnapshotRecord | null;

  /**
   * Create the consumption tombstone O_EXCL (the failure path's consumption
   * record — a failed command that mutated nothing still consumes its record
   * so later ambiguity checks see the closed window). True when created;
   * false when a tombstone already exists.
   */
  tombstone(sessionId: string, toolUseId: string, consumedAt: number): boolean;

  /** The repo's index entries, for the cross-session concurrency check. */
  listRepoRecords(repoRoot: string): SnapshotIndexEntry[];

  /**
   * TTL sweep (records `recordTtlMs`, unfinished activity entries
   * `unfinishedEntryTtlMs`, tombstones and orphaned index entries): the
   * crash-recovery backstop, run opportunistically on each snapshot write.
   */
  sweep(now?: number): SweepResult;

  /**
   * Remove a session's snapshot state — records, tombstones, activity
   * entries, and the index entries (repos read from the records) — the
   * SessionEnd/Stop/SubagentStop cleanup. When `agentId` is given, only
   * records carrying that agent id are removed.
   */
  removeSession(sessionId: string, agentId?: string): void;
}

/**
 * Create the disk-backed snapshot store. Throws `Not Implemented` in Phase 1;
 * Phase 3 implements it with the layout and permission rules documented above.
 */
export function createSnapshotStore(
  _logger: CoreLogger,
  _budgets: SnapshotBudgets = DEFAULT_SNAPSHOT_BUDGETS
): SnapshotStore {
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * Create one activity entry for an Edit/Write/apply_patch pre-hook: read and
 * hash every target path, then write the entry file atomically with
 * `startedAt` and all preHashes together — intent logged before the edit's
 * write lands. Throws `Not Implemented` in Phase 1.
 */
export function appendActivityEntry(_repoRoot: string, _entry: ActivityEntry): void {
  throw new Error('Not Implemented');
}

/**
 * Stamp an entry's completion at the end of the edit's own touch: set each
 * path's `postHash` (the state its touch read) and `finishedAt`. A failed
 * touch leaves `postHash` null; the never-flag rule (`finishedAt ≤
 * capturedAt(P)`) then resolves the boundary as clean. Throws `Not
 * Implemented` in Phase 1.
 */
export function finishActivityEntry(
  _repoRoot: string,
  _sessionId: string,
  _toolUseId: string,
  _stamps: ActivityFinishStamp[]
): void {
  throw new Error('Not Implemented');
}

/**
 * Consult the activity log for one path: entries whose file mtime falls in
 * `[windowStart − budgets.unfinishedEntryTtlMs, now]` (the consult reads only
 * entries active in the window, bounding per-compare cost by in-window entry
 * volume rather than the 24h entry volume), that carry the path in their
 * `paths` array with `finishedAt ≤ windowStart` — the finished-before-window
 * set the interleaved-edit boundary check works from. Throws `Not
 * Implemented` in Phase 1.
 */
export function activityEntriesCovering(
  _repoRoot: string,
  _path: string,
  _windowStart: number,
  _now: number,
  _budgets: SnapshotBudgets
): ActivityEntry[] {
  throw new Error('Not Implemented');
}
