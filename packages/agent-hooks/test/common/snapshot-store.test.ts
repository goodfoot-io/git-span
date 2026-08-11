/**
 * Acceptance checks for snapshot-store.ts (born in the card main-213 TDD
 * bootstrap; record shape rewritten to v2 tree-SHA records by card main-228).
 * The contract under test: record/index/tombstone/activity-entry shapes, the
 * store interface, the sweep, and the activity-log helpers. A v2 record
 * carries a tree SHA plus correlation/gap metadata — a few hundred bytes —
 * and consumption persists a {@link SnapshotPostState} (the post tree SHA),
 * never per-path file maps.
 *
 * The store is a real on-disk store (per the contract: records under
 * `sessionDir(sessionId)/snapshots/`, the presence index and activity log
 * under the repo's git common dir), so these fixtures exercise the disk layout
 * and permission rules the contract documents — not fakes. File locations are
 * discovered by scanning the contract's directories and matching parsed JSON
 * by session id + tool use id, so the fixtures never depend on the exact
 * sanitized filenames Phase 3 chooses; assertions pin the JSON shapes and
 * the filesystem behavior (0600 files, 0700 dirs, TTL sweep, O_EXCL
 * tombstones).
 *
 * Sweep determinism comes from the injected `sweep(now?)` and from record
 * `createdAt`/tombstone `consumedAt` fields — the TTL clock is the record's
 * own timestamps, not file mtimes, which are only used for activity-entry
 * windowing and unfinished-entry pruning (real `Date.now()` at write time,
 * backdated with `utimesSync` where a fixture needs an old mtime).
 *
 * The sweep-read margin (`SWEEP_READ_MARGIN_MS`) compares the REAL file mtime
 * against the injected sweep clock: a sweep whose injected `now` is within the
 * margin of the file's write instant skips the file. Fixtures that need the
 * sweep to ACT on a file therefore backdate the file's mtime past the margin
 * (`utimesSync`) whenever the file's own write was seconds ago — including
 * stale records whose `createdAt` is ancient: a stale record freshly written
 * is exactly the in-flight shape the margin protects, and its own sweep must
 * wait for the mtime to age. Removals rename to trash (never unlink in
 * place), so a sweep fixture asserts the path is gone and the trash file is
 * present, then emptied by a later sweep once the trash ages past
 * `TRASH_TTL_MS`.
 *
 * Session ids are unique per fixture and cleaned up in `afterEach` (the
 * memo-store.test.ts convention); every record carries a real temp-repo root
 * because `write` persists an index entry into the repo's git common dir.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { queueRoot, SESSION_BASE_DIR, sessionDir } from '../../src/common/agent-hooks-common.js';
import {
  DEFAULT_SNAPSHOT_BUDGETS,
  type SnapshotPostState,
  type SnapshotRecord
} from '../../src/common/snapshot-core.js';
import {
  type ActivityEntry,
  type ActivityFinishStamp,
  activityEntriesCovering,
  appendActivityEntry,
  createSnapshotStore,
  finishActivityEntry,
  SWEEP_READ_MARGIN_MS,
  TRASH_TTL_MS
} from '../../src/common/snapshot-store.js';
import type { CoreLogger } from '../../src/common/span-surface.js';
import { makeTempRepo } from '../helpers.js';

const TOOL_USE_ID = 'toolu_01snapshotstoretest';

/**
 * Margin between a fixture's real-now writes and the injected sweep/consult
 * clocks. This machine runs other agents' live git-span hooks against the same
 * session base dir; their real-now sweeps expire anything ancient mid-fixture.
 * Records must therefore be in-TTL relative to real now (concurrent sweeps
 * leave them alone) while expired relative to the injected clock (the sweep
 * assertion still fires). 60s is a generous bound on a fixture's wall duration.
 */
const CLOCK_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of a byte string — the activity log's path hash format. */
function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const createdSessions = new Set<string>();
const createdRepos = new Set<{ root: string; cleanup: () => void }>();

/** A unique session id, registered for afterEach cleanup. */
function newSession(): string {
  const id = `session-store-${process.pid}-${createdSessions.size}-${Date.now()}`;
  createdSessions.add(id);
  return id;
}

/** A temp repo, registered for afterEach cleanup. */
function newRepo(): { root: string; cleanup: () => void } {
  const r = makeTempRepo();
  createdRepos.add(r);
  return r;
}

afterEach(() => {
  for (const sid of createdSessions) {
    rmSync(sessionDir(sid), { recursive: true, force: true });
  }
  for (const r of createdRepos) {
    r.cleanup();
  }
});

// The write-time sweep walks every session dir in the shared base — including
// leftovers from test runs killed before their afterEach cleanup. Those dirs
// hold records whose temp repos no longer exist, and the sweep's gone-repo
// guards warn — breaking this file's no-warns assertions. Age-thresholded
// rename purge (never an in-place unlink: a close-after-unlink aborts Node on
// this fs while another worker reads the file): only dirs untouched for longer
// than any live run could plausibly be, so a parallel worker's live records
// are never touched. The trash root sits outside the base, so no sweep ever
// reads what lands there.
const STALE_SESSION_AGE_MS = 30 * 60 * 1000;
const STALE_SESSION_TRASH = join(dirname(SESSION_BASE_DIR), `stale-session-trash-${process.pid}`);
beforeAll(() => {
  mkdirSync(STALE_SESSION_TRASH, { recursive: true });
  for (const name of readdirSync(SESSION_BASE_DIR)) {
    const dir = join(SESSION_BASE_DIR, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(dir);
    } catch {
      continue; // vanished between readdir and stat — nothing to purge
    }
    if (!st.isDirectory() || Date.now() - st.mtimeMs < STALE_SESSION_AGE_MS) continue;
    try {
      renameSync(dir, join(STALE_SESSION_TRASH, `${name}-${Date.now()}`));
    } catch (err) {
      // Best-effort: another process may have removed the same stale dir
      // (e.g. the production pruneStaleSessions) between stat and rename.
      void err;
    }
  }
});
afterAll(() => {
  rmSync(STALE_SESSION_TRASH, { recursive: true, force: true });
});

/** A logger capturing warn calls for diagnostics assertions. */
function captureLogger(): { logger: CoreLogger; warns: string[] } {
  const warns: string[] = [];
  return { logger: { warn: (m) => warns.push(m), info: () => {} }, warns };
}

/**
 * A pre-walk record with contract-shaped defaults; repoRoot must be a real
 * repo. createdAt defaults to real now: a record that must survive subsequent
 * operations must be in-TTL (see CLOCK_MARGIN_MS) or a concurrent sweep cleans
 * it mid-fixture — sweep-assertion fixtures pass an explicit relative timestamp.
 */
function record(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 2,
    sessionId: newSession(),
    toolUseId: TOOL_USE_ID,
    repoRoot: '/repo',
    createdAt: Date.now(),
    consumed: false,
    consumedAt: null,
    treeSha: 'a'.repeat(40),
    gaps: [],
    ...overrides
  };
}

/** A post-side state with a distinct tree SHA — the consume payload. */
function postState(overrides: Partial<SnapshotPostState> = {}): SnapshotPostState {
  return { treeSha: 'b'.repeat(40), ...overrides };
}

/** Parse a JSON file, or null when absent/unreadable/malformed. */
function readJson(file: string | null): unknown {
  if (file === null) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Find the record file for (session, tool use) under the contract's layout. */
function findRecordFile(sessionId: string, toolUseId: string): string | null {
  const dir = join(sessionDir(sessionId), 'snapshots');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const data = readJson(join(dir, name)) as { sessionId?: unknown; toolUseId?: unknown };
    if (data !== null && data.sessionId === sessionId && data.toolUseId === toolUseId) {
      return join(dir, name);
    }
  }
  return null;
}

/** Find the index entry file for (session, tool use) under the contract's layout. */
function findIndexFile(repoRoot: string, sessionId: string, toolUseId: string): string | null {
  const dir = join(queueRoot(repoRoot), 'snapshot-index');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const data = readJson(join(dir, name)) as { sessionId?: unknown; toolUseId?: unknown };
    if (data !== null && data.sessionId === sessionId && data.toolUseId === toolUseId) {
      return join(dir, name);
    }
  }
  return null;
}

/** Find the activity entry file for (session, tool use) under the contract's layout. */
function findActivityFile(repoRoot: string, sessionId: string, toolUseId: string): string | null {
  const dir = join(queueRoot(repoRoot), 'activity-log');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const data = readJson(join(dir, name)) as { sessionId?: unknown; toolUseId?: unknown };
    if (data !== null && data.sessionId === sessionId && data.toolUseId === toolUseId) {
      return join(dir, name);
    }
  }
  return null;
}

/** Overwrite one JSON field of an on-disk state file (for version-mismatch fixtures). */
function overwriteJsonField(file: string, patch: Record<string, unknown>): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...data, ...patch }));
}

/** A minimal activity entry with contract-shaped defaults. */
function activityEntry(sessionId: string, toolUseId: string, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    sessionId,
    toolUseId,
    kind: 'Edit',
    startedAt: Date.now(),
    finishedAt: null,
    paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null }],
    ...overrides
  };
}

describe('createSnapshotStore — record round-trip', () => {
  it('write then find returns the record with every field intact (version, treeSha, gaps, agentId)', () => {
    const { logger, warns } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const rec = record({
      sessionId: sid,
      repoRoot: r.root,
      agentId: 'agent-a',
      gaps: ['write-tree degraded to stat-only: wall budget exhausted']
    });
    expect(store.write(rec)).toBe(true);
    const found = store.find(sid, TOOL_USE_ID);
    expect(found).not.toBeNull();
    expect(found).toEqual(rec);
    // The shared session base can hold other LIVE sessions' records in a
    // format this store rejects (this machine's deployed hooks write into
    // the same base), and the write-time sweep warns about those foreign
    // files. Only warns about this fixture's own state fail the round-trip.
    expect(warns.filter((m) => m.includes(sid) || m.includes(r.root))).toEqual([]);
  });

  it('find on a never-written (session, tool use) returns null', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    expect(store.find(newSession(), 'toolu_00neverwritten')).toBeNull();
  });

  it('consume persists the post state, marks consumed, stamps consumedAt, and updates the index entry', () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const rec = record({ sessionId: sid, repoRoot: r.root });
    store.write(rec);
    const post = postState();
    const consumed = store.consume(sid, TOOL_USE_ID, post);
    expect(consumed).not.toBeNull();
    expect(consumed?.consumed).toBe(true);
    expect(consumed?.consumedAt).not.toBeNull();
    expect(consumed?.post).toEqual(post);
    // The record file on disk carries the post state (the evidence survives).
    const onDisk = readJson(findRecordFile(sid, TOOL_USE_ID)) as { post?: unknown; consumed?: unknown };
    expect(onDisk?.post).toEqual(post);
    expect(onDisk?.consumed).toBe(true);
    // The index entry reflects the consumption.
    const entry = readJson(findIndexFile(r.root, sid, TOOL_USE_ID)) as {
      consumed?: unknown;
      consumedAt?: unknown;
    };
    expect(entry?.consumed).toBe(true);
    expect(entry?.consumedAt).not.toBeNull();
  });

  it('a duplicate consume is a no-op — the O_EXCL tombstone means the first consumer wins', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const first = store.consume(sid, TOOL_USE_ID, postState());
    expect(first).not.toBeNull();
    // Duplicate delivery (a re-run PostToolUse, a failure-path replay).
    const second = store.consume(sid, TOOL_USE_ID, postState());
    expect(second).toBeNull();
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
  });

  it('tombstone then consume — the failure path claims the record first', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    expect(store.tombstone(sid, TOOL_USE_ID, 1500)).toBe(true);
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
    expect(store.consume(sid, TOOL_USE_ID, postState())).toBeNull();
  });

  it('a second tombstone is false — O_EXCL single-winner', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    expect(store.tombstone(sid, TOOL_USE_ID, 1500)).toBe(true);
    expect(store.tombstone(sid, TOOL_USE_ID, 1600)).toBe(false);
  });
});

describe('file permissions and layout', () => {
  it('record files are 0600 and their directories 0700', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const file = findRecordFile(sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file !== null) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(statSync(join(sessionDir(sid), 'snapshots')).mode & 0o777).toBe(0o700);
    expect(statSync(sessionDir(sid)).mode & 0o777).toBe(0o700);
  });

  it('index files are 0600 and their directory 0700', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const file = findIndexFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file !== null) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(statSync(join(queueRoot(r.root), 'snapshot-index')).mode & 0o777).toBe(0o700);
  });

  it('activity entry files are 0600 and their directory 0700', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    const file = findActivityFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file !== null) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(statSync(join(queueRoot(r.root), 'activity-log')).mode & 0o777).toBe(0o700);
  });
});

describe('versioning — fail closed with a diagnostic', () => {
  it('a record file with an incompatible version is discarded: find returns null and the logger warns', () => {
    const { logger, warns } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const file = findRecordFile(sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    overwriteJsonField(file, { version: 99 });
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
    expect(warns.some((m) => /version/i.test(m))).toBe(true);
  });

  it('an index entry with an incompatible version is excluded from listRepoRecords and the logger warns', () => {
    const { logger, warns } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const file = findIndexFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    overwriteJsonField(file, { version: 99 });
    expect(store.listRepoRecords(r.root)).toEqual([]);
    expect(warns.some((m) => /version/i.test(m))).toBe(true);
  });

  it('activity entries are versionless — the version fail-closed applies to records only', () => {
    // The plan gives a version field to snapshot records only; activity
    // entries carry no version by design, so the on-disk shape is key-exact
    // (no version key) and the record version-mismatch fixtures above pin the
    // fail-closed warn. A foreign version field on an activity file is still
    // excluded from the consult — silently, because the consult has no logger.
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const file = findActivityFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    expect(readJson(file)).toEqual({
      sessionId: sid,
      toolUseId: TOOL_USE_ID,
      kind: 'Edit',
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
      paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: sha256Hex('b\n') }]
    });
    overwriteJsonField(file, { version: 99 });
    const now = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', now - 1000, now, DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });
});

describe('index entries (listRepoRecords)', () => {
  it('consumption is reflected in the index entry (consumed + consumedAt)', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    store.consume(sid, TOOL_USE_ID, postState());
    const entry = store.listRepoRecords(r.root)[0];
    expect(entry?.consumed).toBe(true);
    expect(entry?.consumedAt).not.toBeNull();
  });

  it('records from two sessions are both visible — the cross-session concurrency surface', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sidA = newSession();
    const sidB = newSession();
    // Both records are in-TTL: write() sweeps opportunistically, so a record
    // whose createdAt is ancient would be cleaned by the second write.
    store.write(record({ sessionId: sidA, repoRoot: r.root, toolUseId: 'toolu_01aaa', createdAt: Date.now() }));
    store.write(record({ sessionId: sidB, repoRoot: r.root, toolUseId: 'toolu_01bbb', createdAt: Date.now() }));
    const toolUseIds = store
      .listRepoRecords(r.root)
      .map((e) => e.toolUseId)
      .sort();
    expect(toolUseIds).toEqual(['toolu_01aaa', 'toolu_01bbb']);
  });
});

describe('storage cap — refuse without dropping evidence', () => {
  it('write refuses when the repo total would exceed maxStorageBytes, logs a diagnostic, and drops nothing', () => {
    const { logger, warns } = captureLogger();
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxStorageBytes: 1024 };
    const store = createSnapshotStore(logger, budgets);
    const r = newRepo();
    const sidA = newSession();
    const sidB = newSession();
    // Both records are in-TTL: write() sweeps opportunistically, so the cap
    // refusal must fire on the byte total with the sweep removing nothing —
    // never on a record the sweep already cleaned. A v2 record is a few
    // hundred bytes; the big one is inflated through its gap diagnostics.
    const small = record({
      sessionId: sidA,
      repoRoot: r.root,
      toolUseId: 'toolu_01small',
      createdAt: Date.now()
    });
    const big = record({
      sessionId: sidB,
      repoRoot: r.root,
      toolUseId: 'toolu_01big',
      createdAt: Date.now(),
      gaps: [`stat-only sweep failed: ${'x'.repeat(1024)}`]
    });
    expect(store.write(small)).toBe(true);
    // The second record alone would exceed the cap: refused, never drop-oldest.
    expect(store.write(big)).toBe(false);
    expect(warns.some((m) => /storage/i.test(m))).toBe(true);
    expect(store.find(sidA, 'toolu_01small')).not.toBeNull();
    expect(store.find(sidB, 'toolu_01big')).toBeNull();
  });
});

describe('v1 leftovers — upgrade reclamation', () => {
  /**
   * Plant an on-disk v1 record the way the deployed per-line-hash hooks wrote
   * them: version 1, tier/files fields, a multi-KB body. The file mtimes are
   * backdated past the sweep-read margin so the very next real-now sweep may
   * read them (a just-planted file would be skipped as in-flight).
   */
  function plantV1Record(sid: string, toolUseId: string, repoRoot: string): { recordPath: string } {
    const dir = join(sessionDir(sid), 'snapshots');
    mkdirSync(dir, { recursive: true });
    const recordPath = join(dir, `${toolUseId}.json`);
    writeFileSync(
      recordPath,
      JSON.stringify({
        version: 1,
        sessionId: sid,
        toolUseId,
        repoRoot,
        createdAt: Date.now(),
        consumed: false,
        consumedAt: null,
        tier: 'full',
        gaps: [],
        files: [{ path: 'src/app.ts', size: 4096, lineHashes: Array.from({ length: 64 }, () => sha256Hex('line')) }],
        post: null
      })
    );
    const aged = (Date.now() - SWEEP_READ_MARGIN_MS - 1000) / 1000;
    utimesSync(recordPath, aged, aged);
    return { recordPath };
  }

  /** Plant a v1 index entry under the repo's snapshot-index, mtime past the margin. */
  function plantV1IndexEntry(repoRoot: string, sid: string, toolUseId: string): string {
    const dir = join(queueRoot(repoRoot), 'snapshot-index');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sid}__${toolUseId}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sessionId: sid,
        toolUseId,
        createdAt: Date.now(),
        consumed: false,
        consumedAt: null,
        tier: 'full'
      })
    );
    const aged = (Date.now() - SWEEP_READ_MARGIN_MS - 1000) / 1000;
    utimesSync(file, aged, aged);
    return file;
  }

  it('a v1 record filling the cap is reaped by the write-time sweep and the freed cap admits the first v2 write', () => {
    // The upgrade deadlock this pins: unconsumed multi-MB v1 records near the
    // cap mean the first v2 write is refused, the repo is never discovered,
    // and nothing ever frees the cap — the fail-closed read never yields a
    // createdAt for the TTL pass. The sweep must reclaim incompatible-version
    // record files (and their index entries) so the write that triggered the
    // sweep succeeds.
    const { logger } = captureLogger();
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxStorageBytes: 1024 };
    const store = createSnapshotStore(logger, budgets);
    const r = newRepo();
    const v1Sid = newSession();
    const { recordPath } = plantV1Record(v1Sid, 'toolu_01v1leftover', r.root);
    plantV1IndexEntry(r.root, v1Sid, 'toolu_01v1leftover');
    // The planted record alone exceeds the 1 KiB cap: without the reap this
    // write is refused (its own index entry sums the v1 body into the total).
    const v2Sid = newSession();
    expect(store.write(record({ sessionId: v2Sid, repoRoot: r.root, createdAt: Date.now() }))).toBe(true);
    expect(readJson(recordPath)).toBeNull();
    expect(findIndexFile(r.root, v1Sid, 'toolu_01v1leftover')).toBeNull();
    expect(store.find(v2Sid, TOOL_USE_ID)).not.toBeNull();
  });

  it("a stale v1 index entry with no record is cleaned on the repo's first v2 write", () => {
    // Orphan-index sweeping used to discover repos only from readable v2
    // records — a repo holding nothing but v1 index entries was never
    // visited. The write path now seeds the sweep with its own target repo,
    // so the entries fall to the orphan pass on the first write.
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const goneSid = newSession();
    plantV1IndexEntry(r.root, goneSid, 'toolu_01v1orphan');
    const sid = newSession();
    expect(store.write(record({ sessionId: sid, repoRoot: r.root, createdAt: Date.now() }))).toBe(true);
    expect(findIndexFile(r.root, goneSid, 'toolu_01v1orphan')).toBeNull();
    expect(store.listRepoRecords(r.root).map((e) => e.toolUseId)).toEqual([TOOL_USE_ID]);
  });

  it('whole-session cleanup removes v1 leftovers; agent-scoped cleanup leaves them', () => {
    // An unreadable/incompatible record belongs to no agent this code can
    // attribute, so a SubagentStop (agentId given) must not delete the parent
    // session's leftovers — only SessionEnd/Stop reaps them.
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const { recordPath } = plantV1Record(sid, 'toolu_01v1session', r.root);
    store.removeSession(sid, 'agent-1234');
    expect(readJson(recordPath)).not.toBeNull();
    store.removeSession(sid);
    expect(readJson(recordPath)).toBeNull();
  });
});

describe('TTL sweep', () => {
  it('a record past recordTtlMs is removed; a live record survives (createdAt is the TTL clock)', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    const live = newSession();
    // The stale record's createdAt is TTL-minus-margin relative to real now:
    // expired only relative to the injected sweep clock below, so concurrent
    // real-now sweeps (this machine's live hooks share the session base) leave
    // it alone until the explicit sweep. It is written last so the explicit
    // sweep is the first in-process pass that sees it.
    const staleCreatedAt = Date.now() - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + CLOCK_MARGIN_MS;
    store.write(record({ sessionId: live, repoRoot: r.root, createdAt: Date.now() }));
    store.write(record({ sessionId: stale, repoRoot: r.root, createdAt: staleCreatedAt }));
    const sweepNow = staleCreatedAt + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    const result = store.sweep(sweepNow);
    // Foreign v1 leftovers in the shared base land in foreignRecords, never
    // here, so the TTL count stays exact.
    expect(result.records).toBe(1);
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(live, TOOL_USE_ID)).not.toBeNull();
  });

  it('an expired tombstone is removed; a fresh tombstone survives', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    const live = newSession();
    // The stale pair's timestamps are TTL-minus-margin relative to real now:
    // expired only relative to the injected sweep clock below, so concurrent
    // real-now sweeps (this machine's live hooks share the session base) leave
    // it alone until the explicit sweep. The fresh pair is written first so
    // the explicit sweep is the first in-process pass that sees the stale pair.
    const staleAt = Date.now() - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + CLOCK_MARGIN_MS;
    store.write(record({ sessionId: live, repoRoot: r.root, createdAt: Date.now() }));
    store.tombstone(live, TOOL_USE_ID, Date.now());
    store.write(record({ sessionId: stale, repoRoot: r.root, createdAt: staleAt }));
    store.tombstone(stale, TOOL_USE_ID, staleAt);
    const sweepNow = staleAt + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    const result = store.sweep(sweepNow);
    expect(result.tombstones).toBe(1);
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(live, TOOL_USE_ID)).toBe('tombstoned');
  });

  it('an expired tombstoned record is removed once its own record TTL passes', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    // TTL-minus-margin relative to real now: expired only relative to the
    // injected sweep clock below (real now + CLOCK_MARGIN_MS + 1), so
    // concurrent real-now sweeps leave it alone. The tombstone (consumedAt =
    // real now) stays in-TTL at that clock, so the RECORD pass — not the
    // tombstone pass — is the one that claims the pair. The files' mtimes
    // (real write instants) are well past the sweep-read margin at the
    // injected clock, so the margin does not defer the removal.
    const createdAt = Date.now() - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + CLOCK_MARGIN_MS;
    store.write(record({ sessionId: sid, repoRoot: r.root, createdAt }));
    store.consume(sid, TOOL_USE_ID, postState());
    const now = Date.now() + CLOCK_MARGIN_MS + 1;
    store.sweep(now);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
  });

  it('an unfinished activity entry older than unfinishedEntryTtlMs is pruned; a fresh one survives', () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    // A record anchors the repo so the sweep can discover its activity log.
    const anchor = newSession();
    store.write(record({ sessionId: anchor, repoRoot: r.root, createdAt: Date.now() }));
    const stale = newSession();
    const fresh = newSession();
    appendActivityEntry(r.root, activityEntry(stale, 'toolu_01stale'));
    appendActivityEntry(r.root, activityEntry(fresh, 'toolu_01fresh'));
    // The stale mtime is old relative to the injected sweep clock below but
    // within TTL relative to real now, so concurrent real-now sweeps leave it
    // for the explicit sweep to prune.
    const sweepNow = Date.now() + CLOCK_MARGIN_MS;
    const old = (sweepNow - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 1000) / 1000;
    const staleFile = findActivityFile(r.root, stale, 'toolu_01stale');
    expect(staleFile).not.toBeNull();
    if (staleFile !== null) {
      utimesSync(staleFile, old, old);
    }
    const result = store.sweep(sweepNow);
    expect(result.activityEntries).toBe(1);
    expect(findActivityFile(r.root, stale, 'toolu_01stale')).toBeNull();
    expect(findActivityFile(r.root, fresh, 'toolu_01fresh')).not.toBeNull();
  });

  it('a finished activity entry older than recordTtlMs is pruned; a fresh finished entry survives', () => {
    // A crashed session's end hook never runs, so its finished entries would
    // leak forever — the record TTL is their backstop, and the prune can never
    // remove an entry the consult would still read (the consult window is
    // bounded by the far shorter unfinishedEntryTtlMs).
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    // A record anchors the repo so the sweep can discover its activity log.
    const anchor = newSession();
    store.write(record({ sessionId: anchor, repoRoot: r.root, createdAt: Date.now() }));
    const stale = newSession();
    const fresh = newSession();
    appendActivityEntry(r.root, activityEntry(stale, 'toolu_01stale'));
    finishActivityEntry(r.root, stale, 'toolu_01stale', [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    appendActivityEntry(r.root, activityEntry(fresh, 'toolu_01fresh'));
    finishActivityEntry(r.root, fresh, 'toolu_01fresh', [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    // The stale mtime is old relative to the injected sweep clock below but
    // within TTL relative to real now, so concurrent real-now sweeps leave it
    // for the explicit sweep to prune.
    const sweepNow = Date.now() + CLOCK_MARGIN_MS;
    const old = (sweepNow - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs - 1000) / 1000;
    const staleFile = findActivityFile(r.root, stale, 'toolu_01stale');
    expect(staleFile).not.toBeNull();
    if (staleFile !== null) {
      utimesSync(staleFile, old, old);
    }
    const result = store.sweep(sweepNow);
    expect(result.activityEntries).toBe(1);
    expect(findActivityFile(r.root, stale, 'toolu_01stale')).toBeNull();
    expect(findActivityFile(r.root, fresh, 'toolu_01fresh')).not.toBeNull();
  });

  it('an orphaned index entry (record removed, entry left) is swept', () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const anchor = newSession();
    const orphan = newSession();
    // The anchor record keeps the repo discoverable after the orphan's record
    // file is deleted by hand (the partial-cleanup failure the sweep is for).
    // The orphan record is in-TTL: the manual delete below simulates the
    // partial cleanup, so a concurrent real-now sweep must not clean it first.
    store.write(record({ sessionId: anchor, repoRoot: r.root, createdAt: Date.now(), toolUseId: 'toolu_01anchor' }));
    store.write(record({ sessionId: orphan, repoRoot: r.root, createdAt: Date.now(), toolUseId: 'toolu_01orphan' }));
    const orphanFile = findRecordFile(orphan, 'toolu_01orphan');
    expect(orphanFile).not.toBeNull();
    if (orphanFile === null) return;
    rmSync(orphanFile, { force: true });
    // Both remaining files were written just now; the sweep-read margin would
    // skip them at any real-now-adjacent sweep clock, so backdate their
    // mtimes past the margin — the anchor record must be READ (repo
    // discovery) and the orphan index must be READ (the orphan check). The
    // anchor stays in-TTL (createdAt is real now), so concurrent real-now
    // sweeps leave it alone; a concurrent sweep trashing the orphan index
    // first is the pre-existing partial-cleanup race this fixture models.
    const anchorFile = findRecordFile(anchor, 'toolu_01anchor');
    expect(anchorFile).not.toBeNull();
    if (anchorFile === null) return;
    const orphanIndex = findIndexFile(r.root, orphan, 'toolu_01orphan');
    expect(orphanIndex).not.toBeNull();
    if (orphanIndex === null) return;
    const old = (Date.now() - 10_000) / 1000;
    utimesSync(anchorFile, old, old);
    utimesSync(orphanIndex, old, old);
    const now = Date.now() + 1000;
    const result = store.sweep(now);
    expect(result.indexEntries).toBe(1);
    const toolUseIds = store.listRepoRecords(r.root).map((e) => e.toolUseId);
    expect(toolUseIds).toEqual(['toolu_01anchor']);
  });

  it('a fresh record, tombstone, and activity entry all survive a sweep', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, createdAt: Date.now() }));
    store.tombstone(sid, TOOL_USE_ID, Date.now());
    appendActivityEntry(r.root, activityEntry(sid, 'toolu_01activity'));
    const result = store.sweep(Date.now());
    // foreignRecords is any-number: live deployed hooks on this machine may
    // drop v1 records into the shared base mid-run, and the sweep reaps them.
    expect(result).toEqual({
      records: 0,
      tombstones: 0,
      activityEntries: 0,
      indexEntries: 0,
      foreignRecords: expect.any(Number)
    });
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
    expect(findActivityFile(r.root, sid, 'toolu_01activity')).not.toBeNull();
  });

  it('write runs the TTL sweep first — an expired record is cleaned by the next write', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    store.write(
      record({ sessionId: stale, repoRoot: r.root, createdAt: Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs })
    );
    // Backdate the stale record's mtime past the sweep-read margin: it was
    // written seconds ago, and the margin must not defer the very removal
    // this fixture pins (a stale record freshly written is the in-flight
    // shape the margin protects).
    const staleFile = findRecordFile(stale, TOOL_USE_ID);
    expect(staleFile).not.toBeNull();
    if (staleFile !== null) {
      const old = (Date.now() - 10_000) / 1000;
      utimesSync(staleFile, old, old);
    }
    const fresh = newSession();
    store.write(record({ sessionId: fresh, repoRoot: r.root, createdAt: Date.now() }));
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(fresh, TOOL_USE_ID)).not.toBeNull();
  });

  it('a record whose repoRoot is a deleted directory does not make write throw', () => {
    const { logger, warns } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const s = newRepo();
    const sidA = newSession();
    const sidB = newSession();
    const sidC = newSession();
    // Record A anchors the gone repo R: its session dir and record file stay in
    // the session base while R's directory is deleted underneath (the
    // production case — a hook's temp repo cleaned up mid-flight). The sweep
    // that runs on every write resolves R's git common dir via a subprocess
    // that now fails; each git-dependent phase must warn and continue, and
    // write must keep returning true for the live repo S.
    expect(store.write(record({ sessionId: sidA, repoRoot: r.root, createdAt: Date.now() }))).toBe(true);
    // Backdate record A's mtime past the sweep-read margin: the sweep must
    // READ it to discover the gone repo R and hit the git-subprocess failure
    // the fixture pins — a fresh record would be margin-skipped, deferring
    // the discovery and the warn.
    const aFile = findRecordFile(sidA, TOOL_USE_ID);
    expect(aFile).not.toBeNull();
    if (aFile !== null) {
      const old = (Date.now() - 10_000) / 1000;
      utimesSync(aFile, old, old);
    }
    rmSync(r.root, { recursive: true, force: true });
    expect(store.write(record({ sessionId: sidB, repoRoot: s.root, createdAt: Date.now() }))).toBe(true);
    expect(store.write(record({ sessionId: sidC, repoRoot: s.root, createdAt: Date.now() }))).toBe(true);
    expect(findRecordFile(sidC, TOOL_USE_ID)).not.toBeNull();
    expect(warns.join('\n')).toContain(r.root);
  });
});

describe('sweep-read margin and trash removal (fuse-abort hardening)', () => {
  it('a record written within the sweep-read margin is skipped even when TTL-expired; it is swept once its mtime ages past the margin', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    // TTL-expired relative to real now AND to both injected clocks, but the
    // FILE was written just now: the margin, not the TTL clock, is the only
    // thing keeping it until its mtime ages. (The consume rewrite is the
    // real-world shape — a record rewritten shortly before its TTL passes.)
    // Concurrent real-now sweeps cannot remove it either: their clocks sit
    // within the margin of its mtime, so they skip it too.
    store.write(
      record({
        sessionId: sid,
        repoRoot: r.root,
        createdAt: Date.now() - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs - SWEEP_READ_MARGIN_MS - 1000
      })
    );
    const withinMargin = Date.now() + SWEEP_READ_MARGIN_MS - 1000;
    expect(store.sweep(withinMargin).records).toBe(0);
    expect(store.find(sid, TOOL_USE_ID)).not.toBeNull();
    const pastMargin = Date.now() + SWEEP_READ_MARGIN_MS + 1000;
    expect(store.sweep(pastMargin).records).toBe(1);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
  });

  it('a tombstone written within the sweep-read margin is skipped even when expired; it is swept once its mtime ages past the margin', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const ancient = Date.now() - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs - SWEEP_READ_MARGIN_MS - 1000;
    store.write(record({ sessionId: sid, repoRoot: r.root, createdAt: ancient }));
    expect(store.tombstone(sid, TOOL_USE_ID, ancient)).toBe(true);
    const withinMargin = Date.now() + SWEEP_READ_MARGIN_MS - 1000;
    expect(store.sweep(withinMargin).tombstones).toBe(0);
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
    const pastMargin = Date.now() + SWEEP_READ_MARGIN_MS + 1000;
    expect(store.sweep(pastMargin).tombstones).toBe(1);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
  });

  it('an unfinished activity entry written within the sweep-read margin is skipped even when its TTL has passed; it is pruned once its mtime ages past the margin', () => {
    // The margin and the prune condition are disjoint at production TTLs (a
    // file cannot be simultaneously in-margin and TTL-expired), so the margin
    // never changes a production prune decision — it only protects the read
    // from landing mid-write. A tiny TTL makes the overlap reachable so the
    // read-skip is observable: the entry's mtime is inside the margin while
    // already past the TTL.
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, unfinishedEntryTtlMs: 1000 };
    const store = createSnapshotStore(captureLogger().logger, budgets);
    const r = newRepo();
    const anchor = newSession();
    store.write(record({ sessionId: anchor, repoRoot: r.root, createdAt: Date.now(), toolUseId: 'toolu_01anchor' }));
    // Backdate the anchor record past the margin so the sweep's record pass
    // reads it and discovers the repo — the entry below is in-margin, so the
    // margin on the activity file itself is what the assertions exercise.
    const anchorFile = findRecordFile(anchor, 'toolu_01anchor');
    expect(anchorFile).not.toBeNull();
    if (anchorFile === null) return;
    const old = (Date.now() - 10_000) / 1000;
    utimesSync(anchorFile, old, old);
    const sid = newSession();
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    const withinMargin = Date.now() + SWEEP_READ_MARGIN_MS - 1000;
    expect(store.sweep(withinMargin).activityEntries).toBe(0);
    expect(findActivityFile(r.root, sid, TOOL_USE_ID)).not.toBeNull();
    const pastMargin = Date.now() + SWEEP_READ_MARGIN_MS + 1000;
    expect(store.sweep(pastMargin).activityEntries).toBe(1);
    expect(findActivityFile(r.root, sid, TOOL_USE_ID)).toBeNull();
  });

  it('sweep removals rename to a trash name instead of unlinking in place; the trash is emptied once it ages past the trash TTL', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(
      record({ sessionId: sid, repoRoot: r.root, createdAt: Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs })
    );
    // Backdate past the margin so the sweep acts on it (see the margin
    // fixtures); the removal must rename to trash, never unlink in place.
    const file = findRecordFile(sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    const old = (Date.now() - 10_000) / 1000;
    utimesSync(file, old, old);
    const now = Date.now() + SWEEP_READ_MARGIN_MS + 1000;
    expect(store.sweep(now).records).toBe(1);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
    // The record path is gone but a trash file remains — not unlinked under
    // any concurrent reader.
    const dir = join(sessionDir(sid), 'snapshots');
    expect(readdirSync(dir).some((n) => n.startsWith('.') && n.includes('.trash-'))).toBe(true);
    // The store stamps the trash's mtime to the rename instant at trashFile
    // time (a bare rename would keep this file's backdated write mtime); once
    // that stamped mtime ages past the trash TTL a later sweep unlinks it.
    const later = Date.now() + TRASH_TTL_MS + SWEEP_READ_MARGIN_MS + 1000;
    store.sweep(later);
    expect(readdirSync(dir).some((n) => n.startsWith('.') && n.includes('.trash-'))).toBe(false);
  });

  it('the trash TTL is measured from the rename instant, not the record write: a 24h-old record is trashed with a fresh mtime, then emptied by a later sweep', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    // A record whose createdAt AND file mtime are 24h old — the sweep's
    // primary population. Without the rename-instant mtime stamp, the same
    // pass that trashes it would read the trash as 24h-expired and unlink it
    // ~0 ms after the rename, in the same sweep, defeating the keepalive.
    store.write(
      record({ sessionId: sid, repoRoot: r.root, createdAt: Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs })
    );
    const file = findRecordFile(sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    const old = (Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs) / 1000;
    utimesSync(file, old, old);
    // The stamp is compared against the sweep-start timestamp, not the assert
    // time: on a slow filesystem the readdir/stat between the sweep and the
    // assertion can take longer than a second, which would race a
    // wall-clock margin. The stamp lands between sweep start and the
    // CLOCK_MARGIN window either way; the backdated write mtime sits two
    // record-TTLs behind sweep start.
    const sweepStarted = Date.now();
    const now = Date.now() + SWEEP_READ_MARGIN_MS + 1000;
    expect(store.sweep(now).records).toBe(1);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
    const dir = join(sessionDir(sid), 'snapshots');
    const trashName = readdirSync(dir).find((n) => n.startsWith('.') && n.includes('.trash-'));
    expect(trashName).toBeDefined();
    // The trash's mtime is the rename instant (real now from inside the
    // sweep), so the 60s keepalive applies to the sweep's own removals — the
    // trash survives this pass and the inode stays alive for any reader that
    // opened the record before the rename. The sweep-start slack covers
    // coarse-mtime filesystems (second-granularity stamp truncation).
    if (trashName !== undefined) {
      const mtimeMs = statSync(join(dir, trashName)).mtimeMs;
      expect(mtimeMs).toBeGreaterThanOrEqual(sweepStarted - SWEEP_READ_MARGIN_MS);
      expect(mtimeMs).toBeLessThan(sweepStarted + CLOCK_MARGIN_MS);
    }
    // Once the stamped mtime ages past the trash TTL, a later sweep empties it.
    const later = Date.now() + TRASH_TTL_MS + SWEEP_READ_MARGIN_MS + 1000;
    store.sweep(later);
    expect(readdirSync(dir).some((n) => n.startsWith('.') && n.includes('.trash-'))).toBe(false);
  });

  it('removeSession renames removals to trash (never unlinks in place); a later sweep empties it', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    store.removeSession(sid);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
    const dir = join(sessionDir(sid), 'snapshots');
    expect(readdirSync(dir).some((n) => n.startsWith('.') && n.includes('.trash-'))).toBe(true);
    // The session-dir trash is emptied by a later sweep; the activity-dir
    // trash waits for the sweep to re-discover the repo from a record (the
    // reposFromRecords discovery deferral — benign, retention over removal).
    const later = Date.now() + TRASH_TTL_MS + SWEEP_READ_MARGIN_MS + 1000;
    store.sweep(later);
    expect(readdirSync(dir).some((n) => n.startsWith('.') && n.includes('.trash-'))).toBe(false);
  });
});

describe('removeSession', () => {
  it("removes the session's records, tombstones, activity entries, and index entries", () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const other = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    store.tombstone(sid, TOOL_USE_ID, Date.now());
    appendActivityEntry(r.root, activityEntry(sid, 'toolu_01activity'));
    store.write(record({ sessionId: other, repoRoot: r.root, toolUseId: 'toolu_01other' }));
    store.removeSession(sid);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
    expect(findActivityFile(r.root, sid, 'toolu_01activity')).toBeNull();
    expect(store.listRepoRecords(r.root).map((e) => e.toolUseId)).toEqual(['toolu_01other']);
  });

  it("with agentId, only that agent's records are removed", () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, agentId: 'agent-a', toolUseId: 'toolu_01aaa' }));
    store.write(record({ sessionId: sid, repoRoot: r.root, agentId: 'agent-b', toolUseId: 'toolu_01bbb' }));
    store.removeSession(sid, 'agent-a');
    expect(store.find(sid, 'toolu_01aaa')).toBeNull();
    expect(store.find(sid, 'toolu_01bbb')).not.toBeNull();
    expect(store.listRepoRecords(r.root).map((e) => e.toolUseId)).toEqual(['toolu_01bbb']);
  });
});

describe('activity log', () => {
  it('appendActivityEntry writes the entry with startedAt, paths, and pre hashes atomically', () => {
    const r = newRepo();
    const sid = newSession();
    const entry = activityEntry(sid, TOOL_USE_ID, {
      kind: 'apply_patch',
      paths: [
        { path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null },
        { path: 'src/b.ts', preHash: sha256Hex('b\n'), postHash: null }
      ]
    });
    appendActivityEntry(r.root, entry);
    const onDisk = readJson(findActivityFile(r.root, sid, TOOL_USE_ID));
    expect(onDisk).toEqual(entry);
  });

  it('a failed pre-hook read leaves preHash null (the never-flag rule needs the stamp)', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, TOOL_USE_ID, { paths: [{ path: 'src/a.ts', preHash: null, postHash: null }] })
    );
    const onDisk = readJson(findActivityFile(r.root, sid, TOOL_USE_ID)) as { paths?: unknown };
    expect(onDisk?.paths).toEqual([{ path: 'src/a.ts', preHash: null, postHash: null }]);
  });

  it('finishActivityEntry stamps postHash and finishedAt, preserving the pre hash; a failed touch leaves postHash null', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, 'toolu_01edit', { paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null }] })
    );
    const stamps: ActivityFinishStamp[] = [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }];
    finishActivityEntry(r.root, sid, 'toolu_01edit', stamps);
    const onDisk = readJson(findActivityFile(r.root, sid, 'toolu_01edit')) as {
      finishedAt?: unknown;
      paths?: unknown;
    };
    expect(onDisk?.finishedAt).not.toBeNull();
    expect(onDisk?.paths).toEqual([{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: sha256Hex('b\n') }]);
    // The failed-touch variant: postHash stays null, finishedAt still stamped.
    appendActivityEntry(
      r.root,
      activityEntry(sid, 'toolu_01failed', { paths: [{ path: 'src/c.ts', preHash: sha256Hex('c\n'), postHash: null }] })
    );
    finishActivityEntry(r.root, sid, 'toolu_01failed', [{ path: 'src/c.ts', postHash: null }]);
    const failed = readJson(findActivityFile(r.root, sid, 'toolu_01failed')) as { paths?: unknown };
    expect(failed?.paths).toEqual([{ path: 'src/c.ts', preHash: sha256Hex('c\n'), postHash: null }]);
  });

  it('an entry finished before the window is returned by activityEntriesCovering', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, TOOL_USE_ID, { paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null }] })
    );
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    // The finish and the consult land in the same instant — the entry's mtime
    // (sub-ms) can read up to 1 ms in the future relative to the caller's
    // integer-ms now, and the consult must still return it (snapshot-store.ts
    // tolerates that slack in the future-mtime bound).
    const windowStart = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries.map((e) => e.toolUseId)).toEqual([TOOL_USE_ID]);
    expect(entries[0]?.paths).toEqual([{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: sha256Hex('b\n') }]);
  });

  it('an entry finished after the window is excluded (finishedAt > windowStart)', () => {
    const r = newRepo();
    const sid = newSession();
    // windowStart is read BEFORE the entry is finished, so finishedAt is
    // strictly after it; the margin keeps that order under backward sandbox
    // clock steps.
    const windowStart = Date.now() - CLOCK_MARGIN_MS;
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it('an unfinished entry is never returned — the never-flag rule cannot resolve a boundary as clean', () => {
    const r = newRepo();
    const sid = newSession();
    const windowStart = Date.now() - 1;
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it('an entry covering a different path is not returned', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, TOOL_USE_ID, { paths: [{ path: 'src/other.ts', preHash: sha256Hex('o\n'), postHash: null }] })
    );
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/other.ts', postHash: sha256Hex('o\n') }]);
    const windowStart = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it('an entry whose file mtime predates windowStart − unfinishedEntryTtlMs is not consulted', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const file = findActivityFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    const old = (Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs) / 1000;
    utimesSync(file, old, old);
    const windowStart = Date.now() - 60_000;
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it('among several in-window entries, only the path- and window-matching one is returned', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, 'toolu_01match', { paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null }] })
    );
    appendActivityEntry(
      r.root,
      activityEntry(sid, 'toolu_01other', { paths: [{ path: 'src/b.ts', preHash: sha256Hex('b\n'), postHash: null }] })
    );
    finishActivityEntry(r.root, sid, 'toolu_01match', [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    finishActivityEntry(r.root, sid, 'toolu_01other', [{ path: 'src/b.ts', postHash: sha256Hex('b\n') }]);
    const windowStart = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries.map((e) => e.toolUseId)).toEqual(['toolu_01match']);
  });
});
