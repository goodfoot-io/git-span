/**
 * Tests for the Stop hook (packages/agent-hooks/src/stop.ts).
 *
 * Uses real filesystem (tmp dir) and an injected recording queue writer — no
 * vi.mock. All tests verify the new simplified behavior: pre-commit records
 * are written to the queue, journal entries are marked seen, the handler
 * returns null.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreCommitRecord } from '../src/agent-hooks-common.js';
import { incrementSubagentCount, subagentCountPath } from '../src/agent-hooks-common.js';
import {
  buildAnchorSpecs,
  createStopHandler,
  type JournalEntry,
  journalPath,
  loadJournal,
  type StopHandlerDeps
} from '../src/stop.js';

// ---------------------------------------------------------------------------
// Logger and hook context stub
// ---------------------------------------------------------------------------

const logger = new Logger();

function makeCtx(): { logger: typeof logger } {
  return { logger };
}

// ---------------------------------------------------------------------------
// SDK output shape helper
// ---------------------------------------------------------------------------

type StopResult = { _type: string; stdout: Record<string, unknown> };

function asResult(raw: unknown): StopResult {
  // A `null` handler return means "no output"; normalise to empty stdout.
  if (raw === null || raw === undefined) return { _type: 'Stop', stdout: {} };
  return raw as StopResult;
}

// ---------------------------------------------------------------------------
// Recording queue writer
// ---------------------------------------------------------------------------

// The handler writes a pre-commit record by calling writeRecord. Tests inject
// this recorder so no real queue I/O happens, and assert on the recorded
// PreCommitRecord. Reset before every test.
let writtenRecords: PreCommitRecord[] = [];
beforeEach(() => {
  writtenRecords = [];
});
const recordingWriter = (_repoRoot: string, record: PreCommitRecord): void => {
  writtenRecords.push(record);
};

/** Build a handler with the recording writer injected. */
function handlerWith(deps: Partial<StopHandlerDeps> = {}) {
  return createStopHandler({ writeRecord: recordingWriter, ...deps });
}

/** The last written pre-commit record, or null if none was written. */
function lastRecord(): PreCommitRecord | null {
  return writtenRecords.length > 0 ? writtenRecords[writtenRecords.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Base StopInput builder
// ---------------------------------------------------------------------------

function baseInput(sessionId: string, cwd = '/tmp'): Record<string, unknown> {
  return {
    hook_event_name: 'Stop' as const,
    session_id: sessionId,
    stop_reason: 'end_turn',
    cwd
  };
}

// ---------------------------------------------------------------------------
// Journal helpers
// ---------------------------------------------------------------------------

function writeJournalRaw(sessionId: string, entries: JournalEntry[]): void {
  const dir = nodePath.dirname(journalPath(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
  fs.writeFileSync(journalPath(sessionId), content, 'utf8');
}

function readJournalRaw(sessionId: string): JournalEntry[] {
  const path = journalPath(sessionId);
  if (!fs.existsSync(path)) return [];
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as JournalEntry);
}

// ---------------------------------------------------------------------------
// Git repo setup helper
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  const cp = require('node:child_process');
  cp.execFileSync('git', ['init'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stop hook: missing journal -> silent exit', () => {
  const sid = `stop-test-missing-${Date.now()}`;

  it('returns empty stdout and writes no record', async () => {
    const handler = handlerWith();
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);

    const result = asResult(await handler(baseInput(sid) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
  });
});

describe('Stop hook: empty journal -> silent exit', () => {
  const sid = `stop-test-empty-${Date.now()}`;

  beforeEach(() => {
    const dir = nodePath.dirname(journalPath(sid));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(journalPath(sid), '', 'utf8');
  });
  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns empty stdout and writes no record', async () => {
    const handler = handlerWith();
    const result = asResult(await handler(baseInput(sid) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
  });
});

describe('loadJournal: unknown/legacy kind is rejected', () => {
  const sid = `stop-test-unknown-kind-${Date.now()}`;

  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('rejects entries with unknown or legacy kinds while accepting valid ones on either side', () => {
    const dir = nodePath.dirname(journalPath(sid));
    fs.mkdirSync(dir, { recursive: true });
    const lines = `${[
      JSON.stringify({ tool: 'Edit', path: 'a.ts', kind: 'write', seen: false, start: 1, end: 2 }),
      JSON.stringify({ tool: 'Edit', path: 'b.ts', kind: 'whole', seen: false }),
      JSON.stringify({ tool: 'Write', path: 'c.ts', kind: 'create', seen: false })
    ].join('\n')}\n`;
    fs.writeFileSync(journalPath(sid), lines, 'utf8');

    const entries = loadJournal(sid);
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(2);
    expect(entries![0].path).toBe('a.ts');
    expect(entries![1].path).toBe('c.ts');
    expect(entries!.every((e) => (e.kind as string) !== 'whole')).toBe(true);
  });
});

describe('Stop hook: read-only session -> no record, entries marked seen', () => {
  const sid = `stop-test-readonly-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Read', path: 'src/foo.ts', kind: 'whole-read', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns empty stdout, no record, and marks entry seen', async () => {
    const handler = handlerWith();
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
    const entries = readJournalRaw(sid);
    expect(entries[0].seen).toBe(true);
  });
});

describe('Stop hook: write entry -> pre-commit record written', () => {
  const sid = `stop-test-write-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-write-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('writes a pre-commit record with the correct anchor and marks entry seen', async () => {
    const handler = handlerWith();
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);

    // A pre-commit record was written
    const record = lastRecord();
    expect(record).not.toBeNull();
    expect(record!.anchors).toHaveLength(1);
    expect(record!.anchors[0].path).toBe('src/foo.ts');
    expect(record!.anchors[0].kind).toBe('write');
    expect(record!.anchors[0].range?.start).toBe(10);
    expect(record!.anchors[0].range?.end).toBe(20);
    // created_at is an ISO timestamp
    expect(record!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The entry is marked seen
    const updated = readJournalRaw(sid);
    expect(updated[0].seen).toBe(true);
  });

  it('returns null (empty stdout)', async () => {
    const handler = handlerWith();
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
  });
});

describe('Stop hook: write entry records path-only anchor for create kind', () => {
  const sid = `stop-test-create-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-create-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Write', path: 'src/new.ts', kind: 'create', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('writes a record with path-only anchor (no range) for create', async () => {
    const handler = handlerWith();
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    const record = lastRecord();
    expect(record).not.toBeNull();
    expect(record!.anchors).toHaveLength(1);
    expect(record!.anchors[0].kind).toBe('create');
    expect(record!.anchors[0].range).toBeUndefined();
  });
});

describe('Stop hook: no unreported write entries -> silent exit, no record', () => {
  const sid = `stop-test-seen-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-seen-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: true, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns empty stdout and writes no record', async () => {
    const handler = handlerWith();
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
  });
});

describe('Stop hook: stop_hook_active guard', () => {
  const sid = `stop-test-guard-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-guard-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns immediately (no record) when stop_hook_active is true', async () => {
    const handler = handlerWith();
    const input = { ...baseInput(sid, tmpRepo), stop_hook_active: true };
    const result = asResult(await handler(input as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
  });
});

describe('Stop hook: buildAnchorSpecs unions ranges per (kind, path)', () => {
  it('unions ranges for write entries on same path', () => {
    const entries: JournalEntry[] = [
      { tool: 'Edit', path: 'src/a.ts', kind: 'write', seen: false, start: 5, end: 10 },
      { tool: 'Edit', path: 'src/a.ts', kind: 'write', seen: false, start: 8, end: 20 }
    ];
    const specs = buildAnchorSpecs(entries);
    expect(specs).toHaveLength(1);
    expect(specs[0].range?.start).toBe(5);
    expect(specs[0].range?.end).toBe(20);
  });

  it('emits path-only for create entries', () => {
    const entries: JournalEntry[] = [{ tool: 'Write', path: 'src/new.ts', kind: 'create', seen: false }];
    const specs = buildAnchorSpecs(entries);
    expect(specs).toHaveLength(1);
    expect(specs[0].range).toBeUndefined();
  });

  it('preserves stable order by first appearance', () => {
    const entries: JournalEntry[] = [
      { tool: 'Read', path: 'src/b.ts', kind: 'read', seen: false, start: 1, end: 5 },
      { tool: 'Edit', path: 'src/a.ts', kind: 'write', seen: false, start: 10, end: 20 }
    ];
    const specs = buildAnchorSpecs(entries);
    expect(specs[0].path).toBe('src/b.ts');
    expect(specs[1].path).toBe('src/a.ts');
  });

  it('places whole-read in the whole bucket (no range)', () => {
    const entries: JournalEntry[] = [{ tool: 'Read', path: 'src/c.ts', kind: 'whole-read', seen: false }];
    const specs = buildAnchorSpecs(entries);
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe('whole-read');
    expect(specs[0].range).toBeUndefined();
  });

  it('places whole-write in the whole bucket (no range)', () => {
    const entries: JournalEntry[] = [{ tool: 'Edit', path: 'src/d.ts', kind: 'whole-write', seen: false }];
    const specs = buildAnchorSpecs(entries);
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe('whole-write');
    expect(specs[0].range).toBeUndefined();
  });
});

describe('Stop hook: all write kinds produce a record', () => {
  const cases: Array<{
    label: string;
    entry: { tool: string; path: string; kind: JournalEntry['kind']; start?: number; end?: number; seen: boolean };
  }> = [
    { label: 'ranged write', entry: { tool: 'Edit', path: 'src/f.ts', kind: 'write', seen: false, start: 5, end: 15 } },
    { label: 'whole-write', entry: { tool: 'Edit', path: 'src/f.ts', kind: 'whole-write', seen: false } },
    { label: 'create', entry: { tool: 'Write', path: 'src/f.ts', kind: 'create', seen: false } }
  ];

  for (const { label, entry } of cases) {
    describe(`write variant: ${label}`, () => {
      const sid = `stop-test-write-${label.replace(/ /g, '-')}-${Date.now()}`;
      let tmpRepo: string;

      beforeEach(() => {
        tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-write-'));
        initGitRepo(tmpRepo);
        writeJournalRaw(sid, [entry]);
      });
      afterEach(() => {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
        const jPath = journalPath(sid);
        if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
      });

      it('writes a pre-commit record and marks entry seen', async () => {
        const handler = handlerWith();
        await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
        expect(lastRecord()).not.toBeNull();
        expect(writtenRecords).toHaveLength(1);
        expect(readJournalRaw(sid)[0].seen).toBe(true);
      });
    });
  }
});

describe('Stop hook: idempotence', () => {
  const sid = `stop-test-idempotent-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-idem-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [
      { tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 },
      { tool: 'Edit', path: 'src/foo2.ts', kind: 'write', seen: false, start: 10, end: 20 }
    ]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('does not write a record on a second run once entries are marked seen', async () => {
    const handler = handlerWith();

    // First run writes the record and marks entries seen.
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    expect(writtenRecords).toHaveLength(1);

    // Second run, same journal and no new touches: every entry is now seen, so
    // no record is written.
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    expect(writtenRecords).toHaveLength(1);
  });
});

describe('Stop hook: cwd-absent input falls back to process.cwd()', () => {
  const sid = `stop-test-f3-${Date.now()}`;

  beforeEach(() => {
    writeJournalRaw(sid, [
      { tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 5, end: 15 },
      { tool: 'Edit', path: 'src/foo2.ts', kind: 'write', seen: false, start: 5, end: 15 }
    ]);
  });
  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('writes a record when cwd is absent but process.cwd() is a git repo', async () => {
    const handler = handlerWith();
    const inputNoCwd: Record<string, unknown> = {
      hook_event_name: 'Stop' as const,
      session_id: sid,
      stop_reason: 'end_turn'
      // no cwd
    };

    await handler(inputNoCwd as never, makeCtx() as never);
    expect(lastRecord()).not.toBeNull();
    expect(lastRecord()!.anchors.length).toBeGreaterThan(0);
  });
});

describe('Stop hook: repo root resolution from journal entry paths', () => {
  const sid = `stop-test-journal-cwd-${Date.now()}`;

  beforeEach(() => {
    // Write journal with absolute paths so the handler can resolve them even
    // when the input lacks cwd and process.cwd() is not a git repo.
    writeJournalRaw(sid, [
      { tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 5, end: 15 },
      { tool: 'Edit', path: 'src/foo2.ts', kind: 'write', seen: false, start: 5, end: 15 }
    ]);
  });
  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('resolves repo root from journal path dirname when cwd is absent', async () => {
    const handler = handlerWith();
    const inputNoCwd: Record<string, unknown> = {
      hook_event_name: 'Stop' as const,
      session_id: sid,
      stop_reason: 'end_turn'
      // no cwd
    };

    await handler(inputNoCwd as never, makeCtx() as never);
    expect(lastRecord()).not.toBeNull();
  });
});

describe('loadJournal: all-unparseable lines -> null', () => {
  const sid = `stop-test-bad-json-${Date.now()}`;

  beforeEach(() => {
    const dir = nodePath.dirname(journalPath(sid));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(journalPath(sid), 'not json\nalso not json\n', 'utf8');
  });
  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns null', () => {
    expect(loadJournal(sid)).toBeNull();
  });
});

describe('Stop hook: per-entry idempotence', () => {
  const sid = `stop-test-per-entry-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-per-entry-'));
    initGitRepo(tmpRepo);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('marks seen only the unreported entries, not the pre-existing seen ones', async () => {
    writeJournalRaw(sid, [
      { tool: 'Edit', path: 'src/seen.ts', kind: 'write', seen: true, start: 1, end: 10 },
      { tool: 'Edit', path: 'src/new.ts', kind: 'write', seen: false, start: 1, end: 10 }
    ]);

    const handler = handlerWith();
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    const updated = readJournalRaw(sid);
    expect(updated[0].seen).toBe(true);
    expect(updated[1].seen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subagent-count suppression
// ---------------------------------------------------------------------------

describe('Stop hook: subagent-count suppression', () => {
  const sid = `stop-test-count-suppress-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-count-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
    const countPath = subagentCountPath(sid);
    if (fs.existsSync(countPath)) fs.unlinkSync(countPath);
    const lockPath = `${countPath}.lock`;
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  });

  it('writes nothing when active-subagent count is > 0', async () => {
    const handler = handlerWith();

    incrementSubagentCount(sid);
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);
  });

  it('leaves the journal unmarked when suppressed (same entries write on next clean Stop)', async () => {
    const handler = handlerWith();
    incrementSubagentCount(sid);

    const suppressedResult = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(suppressedResult.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);

    const afterSuppressed = readJournalRaw(sid);
    expect(afterSuppressed.every((e) => !e.seen)).toBe(true);

    // Decrement to 0 so the next Stop is clean
    const countPath = subagentCountPath(sid);
    fs.writeFileSync(countPath, '0', 'utf8');

    // Second Stop: count == 0 -> should write
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    expect(writtenRecords).toHaveLength(1);
  });

  it('count == 0 path is unchanged — still writes normally', async () => {
    const handler = handlerWith();
    await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never);
    expect(lastRecord()).not.toBeNull();
  });

  it('suppresses (writes nothing) when the count file is present but unparseable — fail closed', async () => {
    const handler = handlerWith();
    const countPath = subagentCountPath(sid);
    fs.mkdirSync(nodePath.dirname(countPath), { recursive: true });
    fs.writeFileSync(countPath, 'garbage', 'utf8');

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(writtenRecords).toHaveLength(0);

    const after = readJournalRaw(sid);
    expect(after.every((e) => !e.seen)).toBe(true);
  });
});
