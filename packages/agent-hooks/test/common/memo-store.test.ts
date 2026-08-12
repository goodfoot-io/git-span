/**
 * Tests for the session memo store's location and pruning behavior
 * (packages/agent-hooks/src/common/span-surface.ts's MemoStore, backed by the
 * SessionLayout and pruneStaleSessions in agent-hooks-common.ts).
 *
 * The store writes real files, but under a per-run layout on /tmp rather than
 * the live `~/.cache/git-span/session` base: these cases create, backdate and
 * prune whole session directories, and against the shared base that both
 * reaped other sessions' state and made the outcome depend on what those
 * sessions had left behind. The default location itself is pinned by
 * session-layout.test.ts, which is where that assertion belongs now that the
 * base is a value the caller supplies.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { pruneStaleSessions } from '../../src/common/agent-hooks-common.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { makeAbsentLayout, makeTempLayout } from '../session-layout-helpers.js';

const logger = { warn: () => {} };

const temp = makeTempLayout();
const layout = temp.layout;

// Each case owns the whole base: they create, backdate and prune session dirs
// wholesale, so leaving one behind would change the next case's prune.
afterEach(() => {
  fs.rmSync(layout.base, { recursive: true, force: true });
  fs.rmSync(layout.trashDir, { recursive: true, force: true });
});

afterAll(() => temp.cleanup());

let counter = 0;
function sid(label: string): string {
  counter += 1;
  return `memo-store-${label}-${counter}`;
}

describe('MemoStore location', () => {
  it('writes the memo under the layout it was constructed with', () => {
    const id = sid('location');
    const store = createDiskMemoStore(logger, layout);
    store.addSurfaced(id, ['some-span']);

    const dir = layout.dir(id);
    expect(dir.startsWith(layout.base)).toBe(true);
    expect(fs.existsSync(nodePath.join(dir, 'touch-memo.json'))).toBe(true);
    expect(fs.existsSync(layout.memoFile(id))).toBe(true);
  });

  it('creates the session directory 0700, whichever writer reaches it first', () => {
    // The memo store is one of three writers that can create a session dir.
    // Without an explicit mode it created 0755 and stayed there until an
    // unrelated snapshot-store tombstone write healed it, making the
    // permissions a function of arrival order.
    const id = sid('mode');
    createDiskMemoStore(logger, layout).addSurfaced(id, ['some-span']);
    expect(fs.statSync(layout.dir(id)).mode & 0o777).toBe(0o700);
  });

  it('round-trips surfaced names through the relocated store', () => {
    const id = sid('roundtrip');
    const store = createDiskMemoStore(logger, layout);
    expect([...store.getSurfaced(id)]).toEqual([]);

    store.addSurfaced(id, ['span-a', 'span-b']);
    const surfaced = store.getSurfaced(id);
    expect(surfaced.has('span-a')).toBe(true);
    expect(surfaced.has('span-b')).toBe(true);
  });
});

describe('pruneStaleSessions', () => {
  it('removes session directories older than 30 days but keeps newer ones', () => {
    const staleId = sid('stale');
    const freshId = sid('fresh');

    const staleDir = layout.dir(staleId);
    const freshDir = layout.dir(freshId);
    fs.mkdirSync(staleDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });

    const now = Date.now();
    const THIRTY_ONE_DAYS_AGO = now - 31 * 24 * 60 * 60 * 1000;
    const ONE_DAY_AGO = now - 24 * 60 * 60 * 1000;

    // Backdate the stale dir's mtime; leave the fresh dir at "just created".
    fs.utimesSync(staleDir, THIRTY_ONE_DAYS_AGO / 1000, THIRTY_ONE_DAYS_AGO / 1000);
    fs.utimesSync(freshDir, ONE_DAY_AGO / 1000, ONE_DAY_AGO / 1000);

    pruneStaleSessions(layout, now);

    expect(fs.existsSync(staleDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });

  it('renames a pruned dir into the trash root beside the base, never inside it', () => {
    // The trash root must stay a sibling: a dir trashed inside the base would
    // be re-enumerated by the sweep it was moved out of reach of.
    const id = sid('trash-sibling');
    const dir = layout.dir(id);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const old = (now - 31 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(dir, old, old);

    pruneStaleSessions(layout, now);

    expect(fs.existsSync(dir)).toBe(false);
    expect(layout.trashDir.startsWith(`${layout.base}/`)).toBe(false);
    expect(fs.readdirSync(layout.trashDir).some((name) => name.startsWith(id))).toBe(true);
  });

  it('keeps a session directory exactly at the boundary (not yet over 30 days)', () => {
    const id = sid('boundary');
    const dir = layout.dir(id);
    fs.mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const TWENTY_NINE_DAYS_AGO = now - 29 * 24 * 60 * 60 * 1000;
    fs.utimesSync(dir, TWENTY_NINE_DAYS_AGO / 1000, TWENTY_NINE_DAYS_AGO / 1000);

    pruneStaleSessions(layout, now);

    expect(fs.existsSync(dir)).toBe(true);
  });

  it('is a no-op (does not throw) when the session base dir does not exist yet', () => {
    // Against the shared base this case could never reach the ENOENT branch —
    // other tests had always created the directory first, as its own comment
    // conceded. A layout on a deliberately absent path exercises it for real.
    const absent = makeAbsentLayout();
    try {
      expect(fs.existsSync(absent.layout.base)).toBe(false);
      expect(() => pruneStaleSessions(absent.layout, Date.now())).not.toThrow();
      expect(fs.existsSync(absent.layout.base)).toBe(false);
    } finally {
      absent.cleanup();
    }
  });

  it('addSurfaced/getSurfaced opportunistically prune stale sessions as a side effect', () => {
    const staleId = sid('side-effect-stale');
    const staleDir = layout.dir(staleId);
    fs.mkdirSync(staleDir, { recursive: true });
    const THIRTY_ONE_DAYS_AGO = (Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(staleDir, THIRTY_ONE_DAYS_AGO, THIRTY_ONE_DAYS_AGO);

    const store = createDiskMemoStore(logger, layout);
    // Any store call opportunistically prunes; use a different, fresh session
    // id to trigger it without resurrecting the stale one via addSurfaced.
    store.getSurfaced(sid('trigger'));

    expect(fs.existsSync(staleDir)).toBe(false);
  });
});
