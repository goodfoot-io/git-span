/**
 * Skipped acceptance checks for snapshot-store.ts (Phase 2 of the card main-213
 * TDD bootstrap described in plans/snapshot-attribute.md). Phase 1 declared the
 * store contract — record/index/tombstone/activity-entry shapes, the store
 * interface, the sweep, and the activity-log helpers — as `Not Implemented`
 * stubs; this file writes the contract's acceptance checks against those
 * stubs. Every case here is `it.skip` — none are expected to run until Phase 3
 * implements and unskips them.
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
 * Session ids are unique per fixture and cleaned up in `afterEach` (the
 * memo-store.test.ts convention); every record carries a real temp-repo root
 * because `write` persists an index entry into the repo's git common dir.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { queueRoot, sessionDir } from '../../src/common/agent-hooks-common.js';
import { DEFAULT_SNAPSHOT_BUDGETS, type SnapshotFile, type SnapshotRecord } from '../../src/common/snapshot-core.js';
import {
  type ActivityEntry,
  type ActivityFinishStamp,
  activityEntriesCovering,
  appendActivityEntry,
  createSnapshotStore,
  finishActivityEntry
} from '../../src/common/snapshot-store.js';
import type { CoreLogger } from '../../src/common/span-surface.js';
import { makeTempRepo } from '../helpers.js';

const TOOL_USE_ID = 'toolu_01snapshotstoretest';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of a byte string — the record's byte/line hash format. */
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

/** A logger capturing warn calls for diagnostics assertions. */
function captureLogger(): { logger: CoreLogger; warns: string[] } {
  const warns: string[] = [];
  return { logger: { warn: (m) => warns.push(m), info: () => {} }, warns };
}

/** A pre-walk record with contract-shaped defaults; repoRoot must be a real repo. */
function record(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 1,
    sessionId: newSession(),
    toolUseId: TOOL_USE_ID,
    repoRoot: '/repo',
    createdAt: 1000,
    consumed: false,
    consumedAt: null,
    tier: 'explicit',
    gaps: [],
    files: {},
    ...overrides
  };
}

/** A snapshot file entry with contract-shaped defaults. */
function fileEntry(overrides: Partial<SnapshotFile> = {}): SnapshotFile {
  return { hash: 'pre-hash', size: 10, mtimeNs: 1_780_000_000_123_456_789n, capturedAt: 1000, lines: [], ...overrides };
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
  it.skip('write then find returns the record with every field intact (version, tier, gaps, files, agentId)', () => {
    const { logger, warns } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const rec = record({
      sessionId: sid,
      repoRoot: r.root,
      agentId: 'agent-a',
      tier: 'repo',
      gaps: ['pre-walk truncated at file-count budget'],
      files: { 'src/a.ts': fileEntry({ hash: 'h1' }), 'src/b.ts': fileEntry({ hash: 'h2', coarse: true }) }
    });
    expect(store.write(rec)).toBe(true);
    const found = store.find(sid, TOOL_USE_ID);
    expect(found).not.toBeNull();
    expect(found).toEqual(rec);
    expect(warns).toEqual([]);
  });

  it.skip('find on a never-written (session, tool use) returns null', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    expect(store.find(newSession(), 'toolu_00neverwritten')).toBeNull();
  });

  it.skip('consume persists the post state, marks consumed, stamps consumedAt, and updates the index entry', () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    const rec = record({ sessionId: sid, repoRoot: r.root, files: { 'src/a.ts': fileEntry({ hash: 'pre-hash' }) } });
    store.write(rec);
    const post: Record<string, SnapshotFile> = { 'src/a.ts': fileEntry({ hash: 'post-hash', capturedAt: 2000 }) };
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

  it.skip('a duplicate consume is a no-op — the O_EXCL tombstone means the first consumer wins', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    const first = store.consume(sid, TOOL_USE_ID, {});
    expect(first).not.toBeNull();
    // Duplicate delivery (a re-run PostToolUse, a failure-path replay).
    const second = store.consume(sid, TOOL_USE_ID, {});
    expect(second).toBeNull();
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
  });

  it.skip('tombstone then consume — the failure path claims the record first', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    expect(store.tombstone(sid, TOOL_USE_ID, 1500)).toBe(true);
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
    expect(store.consume(sid, TOOL_USE_ID, {})).toBeNull();
  });

  it.skip('a second tombstone is false — O_EXCL single-winner', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root }));
    expect(store.tombstone(sid, TOOL_USE_ID, 1500)).toBe(true);
    expect(store.tombstone(sid, TOOL_USE_ID, 1600)).toBe(false);
  });
});

describe('file permissions and layout', () => {
  it.skip('record files are 0600 and their directories 0700', () => {
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

  it.skip('index files are 0600 and their directory 0700', () => {
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

  it.skip('activity entry files are 0600 and their directory 0700', () => {
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
  it.skip('a record file with an incompatible version is discarded: find returns null and the logger warns', () => {
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

  it.skip('an index entry with an incompatible version is excluded from listRepoRecords and the logger warns', () => {
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

  it.skip('an activity entry with an incompatible version is excluded from the consult and the logger warns', () => {
    const { warns } = captureLogger();
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const file = findActivityFile(r.root, sid, TOOL_USE_ID);
    expect(file).not.toBeNull();
    if (file === null) return;
    overwriteJsonField(file, { version: 99 });
    const now = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', now - 1000, now, DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
    expect(warns.some((m) => /version/i.test(m))).toBe(true);
  });
});

describe('index entries (listRepoRecords)', () => {
  it.skip('covered lists the record files paths — the pre-walk coverage the ambiguity check reads', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(
      record({
        sessionId: sid,
        repoRoot: r.root,
        files: { 'src/a.ts': fileEntry(), 'src/b.ts': fileEntry() }
      })
    );
    const entries = store.listRepoRecords(r.root);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sessionId).toBe(sid);
    expect(entries[0]?.toolUseId).toBe(TOOL_USE_ID);
    expect([...(entries[0]?.covered ?? [])].sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it.skip("a record with a coverage gap lists 'all' — its coverage is unknowable", () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, gaps: ['pre-walk truncated'] }));
    expect(store.listRepoRecords(r.root)[0]?.covered).toBe('all');
  });

  it.skip('consumption is reflected in the index entry (consumed + consumedAt), tier preserved', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, tier: 'repo' }));
    store.consume(sid, TOOL_USE_ID, {});
    const entry = store.listRepoRecords(r.root)[0];
    expect(entry?.consumed).toBe(true);
    expect(entry?.consumedAt).not.toBeNull();
    expect(entry?.tier).toBe('repo');
  });

  it.skip('records from two sessions are both visible — the cross-session concurrency surface', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sidA = newSession();
    const sidB = newSession();
    store.write(record({ sessionId: sidA, repoRoot: r.root, toolUseId: 'toolu_01aaa' }));
    store.write(record({ sessionId: sidB, repoRoot: r.root, toolUseId: 'toolu_01bbb' }));
    const toolUseIds = store
      .listRepoRecords(r.root)
      .map((e) => e.toolUseId)
      .sort();
    expect(toolUseIds).toEqual(['toolu_01aaa', 'toolu_01bbb']);
  });
});

describe('storage cap — refuse without dropping evidence', () => {
  it.skip('write refuses when the repo total would exceed maxStorageBytes, logs a diagnostic, and drops nothing', () => {
    const { logger, warns } = captureLogger();
    const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS, maxStorageBytes: 400 };
    const store = createSnapshotStore(logger, budgets);
    const r = newRepo();
    const sidA = newSession();
    const sidB = newSession();
    const small = record({
      sessionId: sidA,
      repoRoot: r.root,
      toolUseId: 'toolu_01small',
      files: { 'src/a.ts': fileEntry({ hash: 'h1' }) }
    });
    const big = record({
      sessionId: sidB,
      repoRoot: r.root,
      toolUseId: 'toolu_01big',
      files: { 'src/a.ts': fileEntry({ hash: 'x'.repeat(512) }) }
    });
    expect(store.write(small)).toBe(true);
    // The second record alone would exceed the cap: refused, never drop-oldest.
    expect(store.write(big)).toBe(false);
    expect(warns.some((m) => /storage/i.test(m))).toBe(true);
    expect(store.find(sidA, 'toolu_01small')).not.toBeNull();
    expect(store.find(sidB, 'toolu_01big')).toBeNull();
  });
});

describe('TTL sweep', () => {
  it.skip('a record past recordTtlMs is removed; a live record survives (createdAt is the TTL clock)', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    const live = newSession();
    store.write(record({ sessionId: stale, repoRoot: r.root, createdAt: 1_000_000_000 }));
    store.write(record({ sessionId: live, repoRoot: r.root, createdAt: Date.now() }));
    const now = 1_000_000_000 + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    const result = store.sweep(now);
    expect(result.records).toBe(1);
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(live, TOOL_USE_ID)).not.toBeNull();
  });

  it.skip('an expired tombstone is removed; a fresh tombstone survives', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    const live = newSession();
    store.write(record({ sessionId: stale, repoRoot: r.root, createdAt: 1_000_000_000 }));
    store.tombstone(stale, TOOL_USE_ID, 1_000_000_000);
    store.write(record({ sessionId: live, repoRoot: r.root, createdAt: Date.now() }));
    store.tombstone(live, TOOL_USE_ID, Date.now());
    const now = 1_000_000_000 + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    const result = store.sweep(now);
    expect(result.tombstones).toBe(1);
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(live, TOOL_USE_ID)).toBe('tombstoned');
  });

  it.skip('an expired tombstoned record is removed once its own record TTL passes', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, createdAt: 1_000_000_000 }));
    store.consume(sid, TOOL_USE_ID, {});
    const now = 1_000_000_000 + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    store.sweep(now);
    expect(store.find(sid, TOOL_USE_ID)).toBeNull();
  });

  it.skip('an unfinished activity entry older than unfinishedEntryTtlMs is pruned; a fresh one survives', () => {
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
    const old = (Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs) / 1000;
    const staleFile = findActivityFile(r.root, stale, 'toolu_01stale');
    expect(staleFile).not.toBeNull();
    if (staleFile !== null) {
      utimesSync(staleFile, old, old);
    }
    const result = store.sweep(Date.now());
    expect(result.activityEntries).toBe(1);
    expect(findActivityFile(r.root, stale, 'toolu_01stale')).toBeNull();
    expect(findActivityFile(r.root, fresh, 'toolu_01fresh')).not.toBeNull();
  });

  it.skip('an orphaned index entry (record removed, entry left) is swept', () => {
    const { logger } = captureLogger();
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const anchor = newSession();
    const orphan = newSession();
    // The anchor record keeps the repo discoverable after the orphan's record
    // file is deleted by hand (the partial-cleanup failure the sweep is for).
    store.write(record({ sessionId: anchor, repoRoot: r.root, createdAt: Date.now(), toolUseId: 'toolu_01anchor' }));
    store.write(record({ sessionId: orphan, repoRoot: r.root, createdAt: 1_000_000_000, toolUseId: 'toolu_01orphan' }));
    const orphanFile = findRecordFile(orphan, 'toolu_01orphan');
    expect(orphanFile).not.toBeNull();
    if (orphanFile === null) return;
    rmSync(orphanFile, { force: true });
    const now = 1_000_000_000 + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
    const result = store.sweep(now);
    expect(result.indexEntries).toBe(1);
    const toolUseIds = store.listRepoRecords(r.root).map((e) => e.toolUseId);
    expect(toolUseIds).toEqual(['toolu_01anchor']);
  });

  it.skip('a fresh record, tombstone, and activity entry all survive a sweep', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const sid = newSession();
    store.write(record({ sessionId: sid, repoRoot: r.root, createdAt: Date.now() }));
    store.tombstone(sid, TOOL_USE_ID, Date.now());
    appendActivityEntry(r.root, activityEntry(sid, 'toolu_01activity'));
    const result = store.sweep(Date.now());
    expect(result).toEqual({ records: 0, tombstones: 0, activityEntries: 0, indexEntries: 0 });
    expect(store.find(sid, TOOL_USE_ID)).toBe('tombstoned');
    expect(findActivityFile(r.root, sid, 'toolu_01activity')).not.toBeNull();
  });

  it.skip('write runs the TTL sweep first — an expired record is cleaned by the next write', () => {
    const store = createSnapshotStore(captureLogger().logger, DEFAULT_SNAPSHOT_BUDGETS);
    const r = newRepo();
    const stale = newSession();
    store.write(
      record({ sessionId: stale, repoRoot: r.root, createdAt: Date.now() - 2 * DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs })
    );
    const fresh = newSession();
    store.write(record({ sessionId: fresh, repoRoot: r.root, createdAt: Date.now() }));
    expect(store.find(stale, TOOL_USE_ID)).toBeNull();
    expect(store.find(fresh, TOOL_USE_ID)).not.toBeNull();
  });
});

describe('removeSession', () => {
  it.skip("removes the session's records, tombstones, activity entries, and index entries", () => {
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

  it.skip("with agentId, only that agent's records are removed", () => {
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
  it.skip('appendActivityEntry writes the entry with startedAt, paths, and pre hashes atomically', () => {
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

  it.skip('a failed pre-hook read leaves preHash null (the never-flag rule needs the stamp)', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, TOOL_USE_ID, { paths: [{ path: 'src/a.ts', preHash: null, postHash: null }] })
    );
    const onDisk = readJson(findActivityFile(r.root, sid, TOOL_USE_ID)) as { paths?: unknown };
    expect(onDisk?.paths).toEqual([{ path: 'src/a.ts', preHash: null, postHash: null }]);
  });

  it.skip('finishActivityEntry stamps postHash and finishedAt, preserving the pre hash; a failed touch leaves postHash null', () => {
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

  it.skip('an entry finished before the window is returned by activityEntriesCovering', () => {
    const r = newRepo();
    const sid = newSession();
    appendActivityEntry(
      r.root,
      activityEntry(sid, TOOL_USE_ID, { paths: [{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: null }] })
    );
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const windowStart = Date.now();
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries.map((e) => e.toolUseId)).toEqual([TOOL_USE_ID]);
    expect(entries[0]?.paths).toEqual([{ path: 'src/a.ts', preHash: sha256Hex('a\n'), postHash: sha256Hex('b\n') }]);
  });

  it.skip('an entry finished after the window is excluded (finishedAt > windowStart)', () => {
    const r = newRepo();
    const sid = newSession();
    // windowStart is read BEFORE the entry is finished, so finishedAt is
    // strictly after it even when the wall clock has only one millisecond of
    // resolution.
    const windowStart = Date.now() - 1;
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    finishActivityEntry(r.root, sid, TOOL_USE_ID, [{ path: 'src/a.ts', postHash: sha256Hex('b\n') }]);
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it.skip('an unfinished entry is never returned — the never-flag rule cannot resolve a boundary as clean', () => {
    const r = newRepo();
    const sid = newSession();
    const windowStart = Date.now() - 1;
    appendActivityEntry(r.root, activityEntry(sid, TOOL_USE_ID));
    const entries = activityEntriesCovering(r.root, 'src/a.ts', windowStart, Date.now(), DEFAULT_SNAPSHOT_BUDGETS);
    expect(entries).toEqual([]);
  });

  it.skip('an entry covering a different path is not returned', () => {
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

  it.skip('an entry whose file mtime predates windowStart − unfinishedEntryTtlMs is not consulted', () => {
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

  it.skip('among several in-window entries, only the path- and window-matching one is returned', () => {
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
