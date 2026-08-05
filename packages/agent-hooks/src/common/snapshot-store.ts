/**
 * Harness-agnostic snapshot store.
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
 * All files are written with 0600 permissions (dirs 0700); record and index
 * JSON each carry a `version` field whose mismatch on read fails closed
 * (discard + diagnostic) — stale or foreign files are never parsed. Activity
 * entries carry no version (their shape is pinned key-exact by the fixtures);
 * the consult accepts a version that is undefined or 1 and skips anything
 * else. Fail-open is not the store's default: records are the evidence the
 * concurrency rules depend on, so reads that find an unreadable-but-present
 * record surface the failure through the injected logger rather than silently
 * inventing an absent record.
 *
 * Bigint serialization: `SnapshotFile.mtimeNs` is a bigint in memory but JSON
 * has no bigint, so record writes stringify it via a replacer and record
 * reads revive it via a reviver applied to that key only. Consumers that read
 * record files directly (fixture assertions) see the string form.
 *
 * The sweep runs opportunistically on every write (the crash-recovery
 * backstop — a silent crash self-heals on the next snapshot). Records expire
 * on `recordTtlMs` from their own `createdAt`; tombstones expire on the same
 * clock from their `consumedAt`; unfinished activity entries are pruned by
 * file mtime once they outlive `unfinishedEntryTtlMs`, and finished activity
 * entries by file mtime once they outlive `recordTtlMs` — a crashed session's
 * end hook never runs, so the record TTL is the crash-recovery backstop for
 * the whole store surface; index entries whose record file is gone are
 * removed. Expiring a record removes its tombstone and index entry with it (a
 * tombstoned pair counts under whichever of the two expired first — tombstone
 * files are processed before record files so a pair expired together counts
 * as a tombstone removal).
 *
 * The sweep's passes read files that other sessions' processes are writing,
 * and on the session filesystem (virtiofs) a read landing on a file being
 * rename-overed or unlinked aborts the whole hook process (node-on-virtiofs
 * `uv_fs_close` assertion — confirmed, not theoretical). Two guards bound
 * that surface: every sweep read skips files whose mtime is within
 * {@link SWEEP_READ_MARGIN_MS} of the sweep's clock (another process is still
 * finishing them; the sweep only targets stale state, so deferring costs
 * nothing), and removals rename the file to a trash name in the same
 * directory instead of unlinking it in place — the unlink happens after
 * {@link TRASH_TTL_MS} in the trash pass, long after any concurrent reader
 * closed. Correctness reads of stable own-session files (find/consume, the
 * consult, readIndexEntries) are intentionally not margined — they must see
 * in-flight state.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { queueRoot, SESSION_BASE_DIR, sanitizeSessionId, sessionDir } from './agent-hooks-common.js';
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
 */
export interface SnapshotIndexEntry {
  sessionId: string;
  toolUseId: string;
  /** The instant the record was written — the ambiguity table's tiebreaker order. */
  createdAt: number;
  consumed: boolean;
  consumedAt: number | null;
  tier: SnapshotTier;
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
  /**
   * The subagent that created the entry, when the harness supplied an
   * `agent_id` (Codex subagents share the parent session's `session_id`, so
   * {@link SnapshotStore.removeSession} must filter the activity pass by
   * this to keep a subagent stop from deleting the main session's entries).
   * Absent for main-session entries and for the Claude harness, whose inputs
   * carry no agent_id.
   */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// File layout helpers
// ---------------------------------------------------------------------------

const SNAPSHOTS_DIR = 'snapshots';
const SNAPSHOT_INDEX_DIR = 'snapshot-index';
const ACTIVITY_LOG_DIR = 'activity-log';
const TOMBSTONE_SUFFIX = '.tombstone.json';

function snapshotsDir(sessionId: string): string {
  return join(sessionDir(sessionId), SNAPSHOTS_DIR);
}

function recordFile(sessionId: string, toolUseId: string): string {
  return join(snapshotsDir(sessionId), `${sanitizeSessionId(toolUseId)}.json`);
}

function tombstoneFile(sessionId: string, toolUseId: string): string {
  return join(snapshotsDir(sessionId), `${sanitizeSessionId(toolUseId)}${TOMBSTONE_SUFFIX}`);
}

function indexDir(repoRoot: string): string {
  return join(queueRoot(repoRoot), SNAPSHOT_INDEX_DIR);
}

function indexFile(repoRoot: string, sessionId: string, toolUseId: string): string {
  return join(indexDir(repoRoot), `${sanitizeSessionId(sessionId)}__${sanitizeSessionId(toolUseId)}.json`);
}

function activityDir(repoRoot: string): string {
  return join(queueRoot(repoRoot), ACTIVITY_LOG_DIR);
}

function activityFile(repoRoot: string, sessionId: string, toolUseId: string): string {
  return join(activityDir(repoRoot), `${sanitizeSessionId(sessionId)}__${sanitizeSessionId(toolUseId)}.json`);
}

// ---------------------------------------------------------------------------
// Sweep-read margin and trash removal
// ---------------------------------------------------------------------------

/**
 * The sweep's cross-session read margin. The sweep's cleanup passes read files
 * that other sessions' processes write; on this session's filesystem (virtiofs)
 * a `readFileSync` landing on a file being rename-overed or unlinked aborts the
 * hook process (node-on-virtiofs `uv_fs_close` assertion). A file whose mtime
 * is within this window of the sweep's clock is skipped — another process is
 * still creating or finishing it — because the sweep only targets stale state
 * (TTL-expired or orphaned), deferring a fresh file costs nothing: the sweep
 * runs on every snapshot write and the file is reconsidered seconds later.
 */
export const SWEEP_READ_MARGIN_MS = 5_000;

/**
 * Trash retention. Removals rename the state file to a trash name in the same
 * directory instead of unlinking it in place, and the trash pass unlinks
 * trashed files once their mtime — stamped to the rename instant by
 * {@link trashFile}, so the TTL is genuinely measured from the rename — is
 * older than this. The rename keeps the inode alive for any fd another
 * process already opened (the abort above is close-after-unlink; a
 * rename-away leaves the inode present), and the retention is far longer than
 * any hook-process read can hold an fd, so the trash-pass unlink never lands
 * under a reader.
 */
export const TRASH_TTL_MS = 60_000;

const TRASH_MARKER = '.trash-';

/**
 * Whether `name` is a trash name. Trash names never match the passes' filters
 * (they do not end in `.json`), so trashed state is never parsed as data.
 */
function isTrashName(name: string): boolean {
  return name.startsWith('.') && name.includes(TRASH_MARKER);
}

/**
 * Remove a state file without unlinking it in place: rename it to a trash name
 * in the same directory (same fs — rename cannot fail on EXDEV), where the
 * trash pass unlinks it after TRASH_TTL_MS. The trash file's mtime is stamped
 * to the rename instant — a bare rename preserves the inode's mtime (the
 * original write instant), so a TTL-expired file trashed by the sweep would
 * read as TTL-expired trash and be unlinked ~0 ms after the rename, in the
 * same pass, defeating the keepalive entirely (the sweep's primary population
 * is exactly that: 24h-old records). `'absent'` (already removed by a
 * concurrent sweep) and `'failed'` (the rename could not run) are
 * distinguished so callers can keep their warn-on-failure diagnostics without
 * warning on benign double-removal.
 */
function trashFile(file: string): 'trashed' | 'absent' | 'failed' {
  try {
    const trashPath = join(dirname(file), `.${basename(file)}${TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`);
    renameSync(file, trashPath);
    // Stamp the rename instant (best-effort: a concurrent removal racing the
    // rename leaves the original mtime — the trash then expires early, not
    // late, and only in a race that removes the file anyway; the rename
    // itself succeeded, so the removal stands).
    try {
      const now = Date.now() / 1000;
      utimesSync(trashPath, now, now);
    } catch (err) {
      void err;
    }
    return 'trashed';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'failed';
  }
}

/**
 * Whether `file`'s mtime is within SWEEP_READ_MARGIN_MS of `now` — i.e. some
 * process is likely still writing or finishing it, and reading it could land
 * on a rename-over or unlink. Absent files are never recent (nothing to read).
 */
function isRecentlyWritten(file: string, now: number): boolean {
  try {
    return statSync(file).mtimeMs > now - SWEEP_READ_MARGIN_MS;
  } catch {
    return false;
  }
}

/** Unlink trashed state files in `dir` whose mtime aged past TRASH_TTL_MS. */
function emptyTrash(dir: string, now: number): void {
  for (const name of listDir(dir)) {
    if (!isTrashName(name)) continue;
    const file = join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < now - TRASH_TTL_MS) rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------------------
// JSON I/O
// ---------------------------------------------------------------------------

/** JSON.stringify replacer: serialize bigint mtimeNs as a string. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Reviver applied to record files. The mtimeNs field of every
 * SnapshotFile is serialized as a string; revive exactly those values. The
 * reviver runs on every key of the document, so the conversion is keyed on
 * 'mtimeNs' — no other field ever holds a serialized bigint.
 */
function recordReviver(key: string, value: unknown): unknown {
  if (key === 'mtimeNs' && typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Read and parse a JSON file; null when absent or malformed. */
function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Atomically write a JSON file: tmp file in the same directory + rename.
 * Directories are created 0700 (recursive mkdir applies the mode only to the
 * final directory, so the parent is chmodded explicitly); files are 0600.
 *
 * Exported for the harness adapters' record-gap append: the gap rewrite is a
 * read-modify-write over a potentially multi-MB record, and a non-atomic
 * in-place write could expose a torn file to a concurrent sibling read —
 * the same rename discipline every other store write already uses.
 */
export function writeJsonAtomic(
  file: string,
  data: unknown,
  replacer?: (key: string, value: unknown) => unknown
): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  chmodSync(dirname(dir), 0o700);
  const tmp = join(
    dir,
    `.${basename(file)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    writeFileSync(tmp, JSON.stringify(data, replacer), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Size of a file; 0 when absent (an orphaned index entry contributes nothing). */
function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Record / index / tombstone / activity reads
// ---------------------------------------------------------------------------

/** Read a record file with the fail-closed rules; null when absent/unreadable/unversioned. */
function readRecordFile(file: string, logger: CoreLogger): SnapshotRecord | null {
  if (!existsSync(file)) return null; // absent is the normal find miss — silent
  const data = readJsonFile(file);
  if (data === null) {
    logger.warn(`snapshot store: unreadable record file ${file}, treated as absent`);
    return null;
  }
  if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== 1) {
    logger.warn(`snapshot store: incompatible record version in ${file}, treated as absent`);
    return null;
  }
  return JSON.parse(JSON.stringify(data, bigintReplacer), recordReviver) as SnapshotRecord;
}

/** Whether a tombstone exists for (session, tool use) — the consumed marker. */
function tombstoneExists(sessionId: string, toolUseId: string): boolean {
  try {
    statSync(tombstoneFile(sessionId, toolUseId));
    return true;
  } catch {
    return false;
  }
}

/** Read a tombstone file with the fail-closed rules; null when absent/unreadable/unversioned. */
function readTombstoneFile(file: string, logger: CoreLogger): SnapshotTombstone | null {
  const data = readJsonFile(file);
  if (data === null) return null;
  if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== 1) {
    logger.warn(`snapshot store: incompatible tombstone version in ${file}, treated as absent`);
    return null;
  }
  return data as SnapshotTombstone;
}

/** The repo's index entries (version undefined or 1; others fail closed). */
function readIndexEntries(repoRoot: string, logger: CoreLogger): SnapshotIndexEntry[] {
  const out: SnapshotIndexEntry[] = [];
  for (const name of listDir(indexDir(repoRoot))) {
    if (!name.endsWith('.json')) continue;
    const data = readJsonFile(join(indexDir(repoRoot), name));
    if (data === null || typeof data !== 'object' || data === null) continue;
    const version = (data as { version?: unknown }).version;
    if (version !== undefined && version !== 1) {
      logger.warn(`snapshot store: incompatible index version in ${name}, excluded`);
      continue;
    }
    out.push(data as SnapshotIndexEntry);
  }
  return out;
}

/** Read an activity entry with the fail-closed rules; null when absent/unreadable/foreign. */
function readActivityEntry(file: string): ActivityEntry | null {
  const data = readJsonFile(file);
  if (data === null || typeof data !== 'object' || data === null) return null;
  const version = (data as { version?: unknown }).version;
  if (version !== undefined && version !== 1) return null;
  return data as ActivityEntry;
}

/** The derived record path for a tool use id, from its on-disk file name. */
function recordPathFromTombstoneName(dir: string, tombstoneName: string): string {
  return join(dir, `${tombstoneName.slice(0, -TOMBSTONE_SUFFIX.length)}.json`);
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
   * `unfinishedEntryTtlMs`, finished activity entries `recordTtlMs`,
   * tombstones and orphaned index entries): the crash-recovery backstop, run
   * opportunistically on each snapshot write.
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
 * Create the disk-backed snapshot store with the layout and permission rules
 * documented above.
 */
export function createSnapshotStore(
  logger: CoreLogger,
  budgets: SnapshotBudgets = DEFAULT_SNAPSHOT_BUDGETS
): SnapshotStore {
  /** Total on-disk bytes of the repo's record files (via its index entries). */
  function repoRecordBytes(repoRoot: string): number {
    let total = 0;
    for (const entry of readIndexEntries(repoRoot, logger)) {
      const file = recordFile(entry.sessionId, entry.toolUseId);
      total += fileSize(file);
    }
    return total;
  }

  function writeIndexEntry(repoRoot: string, entry: SnapshotIndexEntry): void {
    writeJsonAtomic(indexFile(repoRoot, entry.sessionId, entry.toolUseId), { ...entry, version: 1 });
  }

  function removeIndexEntry(repoRoot: string, sessionId: string, toolUseId: string): void {
    // The index lives under the repo's git common dir, resolved by a git
    // subprocess that can fail (repo dir gone, spawn pressure under load).
    // Index cleanup is opportunistic bookkeeping — a failure must warn and
    // continue, never take down the sweep or removeSession. Removal goes
    // through the trash rename (never an in-place unlink) for the same reason
    // as the sweep's other removals: an in-place unlink can abort a concurrent
    // reader of the index (the correctness reads readIndexEntries is exempt
    // from the sweep-read margin).
    if (trashFile(indexFile(repoRoot, sessionId, toolUseId)) === 'failed') {
      logger.warn(`snapshot store: index entry cleanup failed for ${repoRoot}`);
    }
  }

  function writeRecord(record: SnapshotRecord): void {
    writeJsonAtomic(recordFile(record.sessionId, record.toolUseId), record, bigintReplacer);
  }

  /**
   * Repos with readable records anywhere — the activity-log discovery surface.
   * Reads other sessions' records, so the sweep-read margin applies (another
   * process may be mid-consume on one of them); a deferred record's repo is
   * discovered by a later cleanup, and its activity entries then age into the
   * TTL prune — retention is never wrong attribution.
   *
   * Accepted residual: a repo whose last record TTL-expires is never visited
   * again — activity dirs live in per-repo git common dirs and there is no
   * enumeration path for them (repos are discovered only from live records).
   * A crashed session's finished entries in such a repo therefore outlive
   * their own 24h prune. This is accepted: the entries are tiny files, and
   * cleanup is best-effort exactly as for records in a repo deleted outright.
   */
  function reposFromRecords(): Set<string> {
    const repos = new Set<string>();
    for (const sessionName of listDir(SESSION_BASE_DIR)) {
      const dir = snapshotsDir(sessionName);
      for (const name of listDir(dir)) {
        if (!name.endsWith('.json') || name.endsWith(TOMBSTONE_SUFFIX)) continue;
        const file = join(dir, name);
        if (isRecentlyWritten(file, Date.now())) continue;
        const rec = readRecordFile(file, logger);
        if (rec !== null) repos.add(rec.repoRoot);
      }
    }
    return repos;
  }

  /**
   * Prune activity entries whose file mtime outlived their TTL: unfinished
   * entries the short `unfinishedEntryTtlMs` (their finish may still land, so
   * only genuinely-abandoned in-flight entries go), finished entries the
   * record TTL `recordTtlMs` — a crashed session's end hook never runs, so
   * its finished entries would otherwise leak forever. The prune can never
   * remove an entry the consult ({@link activityEntriesCovering}) would still
   * read: the consult window is bounded by `unfinishedEntryTtlMs`, far
   * shorter than the 24h record TTL.
   */
  function pruneStaleActivity(now: number, repos: Set<string>): number {
    let removed = 0;
    for (const repo of repos) {
      // The activity log lives under the repo's git common dir, resolved by a
      // git subprocess; a gone repo (or spawn failure) must skip that repo and
      // continue, never abort the sweep.
      try {
        for (const name of listDir(activityDir(repo))) {
          if (!name.endsWith('.json')) continue;
          const file = join(activityDir(repo), name);
          // The activity log is shared across sessions — another process may
          // be finishing an entry right now, so the sweep-read margin applies
          // before the read (the entry's own mtime still decides the TTL).
          if (isRecentlyWritten(file, now)) continue;
          const entry = readActivityEntry(file);
          if (entry === null) continue;
          let mtimeMs: number;
          try {
            mtimeMs = statSync(file).mtimeMs;
          } catch {
            continue;
          }
          const ttlMs = entry.finishedAt !== null ? budgets.recordTtlMs : budgets.unfinishedEntryTtlMs;
          if (mtimeMs < now - ttlMs) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger.warn(`snapshot store: activity prune skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }

  /** Remove index entries whose record file is gone — the partial-cleanup failure. */
  function sweepOrphanIndexes(_now: number, repos: Set<string>): number {
    let removed = 0;
    for (const repo of repos) {
      // Same git-common-dir subprocess caveat as pruneStaleActivity: a gone
      // repo must skip, not abort the sweep.
      try {
        for (const name of listDir(indexDir(repo))) {
          if (!name.endsWith('.json')) continue;
          const file = join(indexDir(repo), name);
          // The index is written by other sessions' writes/consumes — the
          // sweep-read margin applies before either read here.
          if (isRecentlyWritten(file, _now)) continue;
          const data = readJsonFile(file);
          if (data === null || typeof data !== 'object' || data === null) continue;
          const version = (data as { version?: unknown }).version;
          if (version !== undefined && version !== 1) continue;
          const entry = data as SnapshotIndexEntry;
          const recFile = recordFile(entry.sessionId, entry.toolUseId);
          if (!isRecentlyWritten(recFile, _now) && readRecordFile(recFile, logger) === null) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger.warn(`snapshot store: orphan-index sweep skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }

  return {
    write(record: SnapshotRecord): boolean {
      const swept = this.sweep();
      const removed = swept.records + swept.tombstones + swept.activityEntries + swept.indexEntries;
      if (removed > 0) {
        // The TTL sweep is the crash-recovery backstop; report what it removed
        // so cleanup is observable (the plan's sweep-counts report), never the
        // contents of what it removed.
        logger.info?.('git-span snapshot sweep removed expired state', {
          records: swept.records,
          tombstones: swept.tombstones,
          activityEntries: swept.activityEntries,
          indexEntries: swept.indexEntries
        });
      }
      const repo = record.repoRoot;
      const json = JSON.stringify(record, bigintReplacer);
      const total = repoRecordBytes(repo) + Buffer.byteLength(json, 'utf8');
      if (total > budgets.maxStorageBytes) {
        logger.warn(
          `snapshot store: refusing to persist ${record.toolUseId}: repo storage ${total} bytes exceeds ` +
            `maxStorageBytes ${budgets.maxStorageBytes}; nothing was dropped`
        );
        return false;
      }
      writeRecord(record);
      writeIndexEntry(repo, {
        sessionId: record.sessionId,
        toolUseId: record.toolUseId,
        createdAt: record.createdAt,
        consumed: false,
        consumedAt: null,
        tier: record.tier
      });
      return true;
    },

    find(sessionId: string, toolUseId: string): SnapshotRecord | 'tombstoned' | null {
      if (tombstoneExists(sessionId, toolUseId)) return 'tombstoned';
      return readRecordFile(recordFile(sessionId, toolUseId), logger);
    },

    consume(sessionId: string, toolUseId: string, post: Record<string, SnapshotFile>): SnapshotRecord | null {
      if (tombstoneExists(sessionId, toolUseId)) return null;
      const rec = readRecordFile(recordFile(sessionId, toolUseId), logger);
      if (rec === null) return null;
      const consumedAt = Date.now();
      if (!this.tombstone(sessionId, toolUseId, consumedAt)) return null;
      const consumed: SnapshotRecord = { ...rec, post, consumed: true, consumedAt };
      writeRecord(consumed);
      const indexData = readJsonFile(indexFile(rec.repoRoot, sessionId, toolUseId)) as
        | (SnapshotIndexEntry & { version?: unknown })
        | null;
      if (indexData !== null && typeof indexData === 'object') {
        writeIndexEntry(rec.repoRoot, {
          sessionId,
          toolUseId,
          createdAt: indexData.createdAt,
          consumed: true,
          consumedAt,
          tier: indexData.tier
        });
      }
      return consumed;
    },

    tombstone(sessionId: string, toolUseId: string, consumedAt: number): boolean {
      const file = tombstoneFile(sessionId, toolUseId);
      const dir = dirname(file);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      chmodSync(dirname(dir), 0o700);
      try {
        writeFileSync(file, JSON.stringify({ version: 1, toolUseId, consumedAt }), { flag: 'wx', mode: 0o600 });
        return true;
      } catch {
        return false;
      }
    },

    listRepoRecords(repoRoot: string): SnapshotIndexEntry[] {
      return readIndexEntries(repoRoot, logger);
    },

    sweep(now: number = Date.now()): SweepResult {
      const result: SweepResult = { records: 0, tombstones: 0, activityEntries: 0, indexEntries: 0 };
      const repos = new Set<string>();
      for (const sessionName of listDir(SESSION_BASE_DIR)) {
        const dir = snapshotsDir(sessionName);
        const names = listDir(dir);
        // Tombstone files first: a pair expired together counts as a
        // tombstone removal, so the record branch below must not see a
        // record whose tombstone already claimed the pair.
        for (const name of names) {
          if (!name.endsWith(TOMBSTONE_SUFFIX)) continue;
          const file = join(dir, name);
          // Another session's process may be finishing this tombstone (or the
          // record the pass reads below) right now — the sweep-read margin
          // skips in-flight files; the sweep only targets stale state.
          if (isRecentlyWritten(file, now)) continue;
          const t = readTombstoneFile(file, logger);
          if (t === null) continue;
          if (now - t.consumedAt > budgets.recordTtlMs) {
            const recordPath = recordPathFromTombstoneName(dir, name);
            const rec = isRecentlyWritten(recordPath, now) ? null : readRecordFile(recordPath, logger);
            trashFile(recordPath);
            trashFile(file);
            if (rec !== null) removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
            result.tombstones += 1;
          }
        }
        for (const name of names) {
          if (!name.endsWith('.json') || name.endsWith(TOMBSTONE_SUFFIX)) continue;
          const file = join(dir, name);
          if (isRecentlyWritten(file, now)) continue;
          const rec = readRecordFile(file, logger);
          if (rec === null) continue;
          repos.add(rec.repoRoot);
          if (now - rec.createdAt > budgets.recordTtlMs) {
            trashFile(file);
            trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
            removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
            result.records += 1;
          }
        }
        emptyTrash(dir, now);
      }
      result.activityEntries = pruneStaleActivity(now, repos);
      result.indexEntries = sweepOrphanIndexes(now, repos);
      for (const repo of repos) {
        // Same git-common-dir subprocess caveat as the activity and index
        // passes: a gone repo must skip, not abort the sweep.
        try {
          emptyTrash(activityDir(repo), now);
          emptyTrash(indexDir(repo), now);
        } catch (e) {
          logger.warn(`snapshot store: trash pass skipped ${repo}: ${String(e)}`);
        }
      }
      return result;
    },

    removeSession(sessionId: string, agentId?: string): void {
      const dir = snapshotsDir(sessionId);
      const repos = new Set<string>();
      let recordsRemoved = 0;
      // The session's own records are stable during its end (no other process
      // writes them), so these reads carry no sweep-read margin — but their
      // removal goes through the trash rename, never an in-place unlink: the
      // unlink is what can abort another session's concurrent read.
      for (const name of listDir(dir)) {
        if (!name.endsWith('.json') || name.endsWith(TOMBSTONE_SUFFIX)) continue;
        const rec = readRecordFile(join(dir, name), logger);
        if (rec === null) continue;
        if (agentId !== undefined && rec.agentId !== agentId) continue;
        repos.add(rec.repoRoot);
        trashFile(join(dir, name));
        trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
        removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
        recordsRemoved += 1;
      }
      // Activity entries live under repos, and the session's own records may
      // already have been TTL-swept (the sweep runs on every write), so the
      // repos are discovered from all readable records on disk, not just the
      // ones this call removed. The session dir itself is shared with the
      // memo store and is never removed here.
      for (const repo of reposFromRecords()) repos.add(repo);
      let activityRemoved = 0;
      for (const repo of repos) {
        // The activity log lives under the repo's git common dir, resolved by
        // a git subprocess; a gone repo must skip, never abort the removal.
        try {
          for (const name of listDir(activityDir(repo))) {
            if (!name.endsWith('.json')) continue;
            const entry = readActivityEntry(join(activityDir(repo), name));
            // Subagents share the parent session's session_id, so a
            // SubagentStop (agentId present) must remove only that agent's
            // entries — the main session's activity entries survive. Without
            // an agentId (SessionEnd/Stop) every session entry is removed,
            // exactly as before.
            if (
              entry !== null &&
              entry.sessionId === sessionId &&
              (agentId === undefined || entry.agentId === agentId)
            ) {
              trashFile(join(activityDir(repo), name));
              activityRemoved += 1;
            }
          }
        } catch (e) {
          logger.warn(`snapshot store: activity cleanup skipped ${repo}: ${String(e)}`);
        }
      }
      // Session-end cleanup is the plan's primary removal trigger; report what
      // it removed so a session's snapshot state never disappears silently.
      if (recordsRemoved + activityRemoved > 0) {
        logger.info?.('git-span session cleanup removed snapshot state', {
          sessionId,
          agentId: agentId ?? null,
          records: recordsRemoved,
          activityEntries: activityRemoved
        });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * Create one activity entry for an Edit/Write/apply_patch pre-hook: read and
 * hash every target path, then write the entry file atomically with
 * `startedAt` and all preHashes together — intent logged before the edit's
 * write lands. The entry is written exactly as given (no version field).
 */
export function appendActivityEntry(repoRoot: string, entry: ActivityEntry): void {
  writeJsonAtomic(activityFile(repoRoot, entry.sessionId, entry.toolUseId), entry);
}

/**
 * Stamp an entry's completion at the end of the edit's own touch: set each
 * path's `postHash` (the state its touch read) and `finishedAt`. A failed
 * touch leaves `postHash` null; the never-flag rule (`finishedAt ≤
 * capturedAt(P)`) then resolves the boundary as clean.
 */
export function finishActivityEntry(
  repoRoot: string,
  sessionId: string,
  toolUseId: string,
  stamps: ActivityFinishStamp[]
): void {
  const file = activityFile(repoRoot, sessionId, toolUseId);
  const entry = readActivityEntry(file);
  if (entry === null) return;
  for (const stamp of stamps) {
    const path = entry.paths.find((p) => p.path === stamp.path);
    if (path !== undefined) path.postHash = stamp.postHash;
  }
  entry.finishedAt = Date.now();
  writeJsonAtomic(file, entry);
}

/**
 * Consult the activity log for one path: entries whose file mtime falls in
 * `[windowStart − budgets.unfinishedEntryTtlMs, now]` (the consult reads only
 * entries active in the window, bounding per-compare cost by in-window entry
 * volume rather than the 24h entry volume), that carry the path in their
 * `paths` array with `finishedAt ≤ windowStart` — the finished-before-window
 * set the interleaved-edit boundary check works from.
 */
export function activityEntriesCovering(
  repoRoot: string,
  path: string,
  windowStart: number,
  now: number,
  budgets: SnapshotBudgets
): ActivityEntry[] {
  const earliest = windowStart - budgets.unfinishedEntryTtlMs;
  const out: ActivityEntry[] = [];
  for (const name of listDir(activityDir(repoRoot))) {
    if (!name.endsWith('.json')) continue;
    const file = join(activityDir(repoRoot), name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    // statSync mtimeMs carries sub-ms precision while Date.now() is integer
    // ms: an entry whose finish-write landed in the same integer millisecond
    // as `now` reads 0..1 ms in the future. Tolerate that slack — excluding a
    // completed entry silently reopens the interleaved-edit window the consult
    // guards. Entries genuinely more than 1 ms future (clock skew) stay excluded.
    if (mtimeMs < earliest || mtimeMs > now + 1) continue;
    const entry = readActivityEntry(file);
    if (entry === null || entry.finishedAt === null || entry.finishedAt > windowStart) continue;
    if (!entry.paths.some((p) => p.path === path)) continue;
    out.push(entry);
  }
  out.sort((a, b) => a.startedAt - b.startedAt || (a.toolUseId < b.toolUseId ? -1 : a.toolUseId > b.toolUseId ? 1 : 0));
  return out;
}
