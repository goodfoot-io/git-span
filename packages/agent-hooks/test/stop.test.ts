/**
 * Tests for the Stop hook (packages/agent-hooks/src/stop.ts).
 *
 * Uses real filesystem (tmp dir) and injected executor fakes — no vi.mock.
 *
 * The SDK wraps hook output: stopOutput({ decision, reason }) returns
 * { _type: 'Stop', stdout: { decision, reason } }. A `null` handler return means
 * "no output" and is normalised to an empty stdout. Tests access .stdout fields.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAnchorSpecs,
  createStopHandler,
  type JournalEntry,
  journalPath,
  type ListBatchExecutor,
  type ListRenderExecutor,
  loadJournal,
  type StaleExecutor
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
// Base StopInput builder
// ---------------------------------------------------------------------------

function baseInput(sessionId: string, cwd = '/tmp'): Record<string, unknown> {
  return {
    hook_event_name: 'Stop' as const,
    session_id: sessionId,
    transcript_path: '/tmp/transcript.jsonl',
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
// No-op executors
// ---------------------------------------------------------------------------

const noopStale: StaleExecutor = () => '';
const noopListBatch: ListBatchExecutor = () => '';
const noopListRender: ListRenderExecutor = () => '';

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

describe('Stop hook: missing journal → silent exit', () => {
  const sid = `stop-test-missing-${Date.now()}`;

  it('returns empty stdout with no systemMessage', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    // Ensure no journal exists
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);

    const result = asResult(await handler(baseInput(sid) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(result.stdout.reason).toBeUndefined();
  });
});

describe('Stop hook: empty journal → silent exit', () => {
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

  it('returns empty stdout with no systemMessage', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    const result = asResult(await handler(baseInput(sid) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(result.stdout.reason).toBeUndefined();
  });
});

describe('Stop hook: empty status doc → silent exit, no systemMessage', () => {
  const sid = `stop-test-empty-doc-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Read', path: 'src/foo.ts', kind: 'whole', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('returns empty stdout when stale and list return nothing', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(result.stdout.reason).toBeUndefined();
  });
});

describe('Stop hook: stale pass finds one stale mesh', () => {
  const sid = `stop-test-stale-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-stale-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('produces a # Stale meshes section; entry seen only when write-coverage pass covers it', async () => {
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    // Write-coverage pass also covers the write range — marks entry seen
    const listBatch: ListBatchExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: listBatch,
      listRenderExecutor: render
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout.decision).toBe('block');
    expect(result.stdout.reason).toBeDefined();
    expect(typeof result.stdout.reason).toBe('string');
    const msg = result.stdout.reason as string;
    expect(msg).toContain('git-mesh-status-');

    // Read the written doc
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('# Stale meshes');
    // Write is covered by a current mesh via write-coverage pass → not uncovered
    expect(doc).not.toContain('# Uncovered writes');

    // Journal entries should be marked seen (by write-coverage pass, not stale pass)
    const updated = readJournalRaw(sid);
    expect(updated[0].seen).toBe(true);

    // Blocks to surface the review prompt
    expect(result.stdout.decision).toBe('block');
  });
});

describe('Stop hook: uncovered write entry', () => {
  const sid = `stop-test-uncovered-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-uncov-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/bar.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('produces a # Uncovered writes section when no mesh covers the write', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout.decision).toBe('block');
    expect(result.stdout.reason).toBeDefined();
    const msg = result.stdout.reason as string;
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('# Uncovered writes');
    expect(doc).toContain('src/bar.ts#L1-L10');
  });
});

describe('Stop hook: create entry → path-only filter line', () => {
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

  it('classifies create as uncovered when no mesh returns a row', async () => {
    const filtersSeen: string[] = [];
    const listBatch: ListBatchExecutor = (filterText) => {
      filtersSeen.push(filterText);
      return '';
    };

    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: listBatch,
      listRenderExecutor: noopListRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));

    // Filter text for the list batch should be path-only (no #L range)
    expect(filtersSeen[0]).toContain('src/new.ts');
    expect(filtersSeen[0]).not.toContain('#L');

    const msg = result.stdout.reason as string;
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('# Uncovered writes');
    expect(doc).toContain('- src/new.ts');
    expect(doc).not.toContain('#L');
  });

  it('classifies create as related when a mesh row is returned', async () => {
    const listBatch: ListBatchExecutor = () => 'my-mesh\tsrc/new.ts\t0-0\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/new.ts\n\nDesc.\n`;

    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: listBatch,
      listRenderExecutor: render
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    const msg = result.stdout.reason as string;
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('# Related meshes');
    expect(doc).not.toContain('# Uncovered writes');
  });
});

describe('Stop hook: idempotence', () => {
  const sid = `stop-test-idempotent-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-idem-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('produces identical doc on second run', async () => {
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });

    const r1 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    const docPath1 = (r1.stdout.reason as string).match(/\/[^\s]+\.md/)![0];
    const doc1 = fs.readFileSync(docPath1, 'utf8');

    const r2 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    const docPath2 = (r2.stdout.reason as string).match(/\/[^\s]+\.md/)![0];
    const doc2 = fs.readFileSync(docPath2, 'utf8');

    expect(doc1).toBe(doc2);
  });
});

describe('Stop hook: blocks to surface the review, but breaks the stop loop', () => {
  const sid = `stop-test-block-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-block-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/x.ts', kind: 'write', seen: false, start: 1, end: 5 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  const stale: StaleExecutor = () => 'a-slug\tsrc/x.ts\t1-10\n';
  const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/x.ts#L1-L10\n\nDesc.\n`;

  it('sets decision to block with the review prompt in reason when meshes are stale', async () => {
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });
    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout.decision).toBe('block');
    expect(result.stdout.reason).toContain('git-mesh-status-');
  });

  it('allows the stop (returns no output) when stop_hook_active is already true', async () => {
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });
    const input = { ...baseInput(sid, tmpRepo), stop_hook_active: true };
    const result = asResult(await handler(input as never, makeCtx() as never));
    expect(result.stdout).toEqual({});
    expect(result.stdout.decision).toBeUndefined();
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
});

// ---------------------------------------------------------------------------
// F2: Duplicate --- separators in multi-mesh sections
// ---------------------------------------------------------------------------

describe('Stop hook F2: multi-mesh section has exactly one --- between blocks', () => {
  const sid = `stop-test-f2-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-f2-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [
      { tool: 'Edit', path: 'src/a.ts', kind: 'write', seen: false, start: 1, end: 10 },
      { tool: 'Edit', path: 'src/b.ts', kind: 'write', seen: false, start: 1, end: 10 }
    ]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('produces exactly one --- between mesh blocks in # Stale meshes', async () => {
    // Simulate Rust render_blocks output: two blocks with trailing --- on first block
    const stale: StaleExecutor = () => 'mesh-a\tsrc/a.ts\t1-10\nmesh-b\tsrc/b.ts\t1-10\n';
    const render: ListRenderExecutor = (slugs) => {
      // Simulate what Rust render_blocks emits: blocks separated by \n---\n
      const blocks = slugs.map((s) => `## ${s}\n- Details for ${s}.`);
      return blocks.join('\n\n---\n\n');
    };

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    const msg = result.stdout.reason as string;
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');

    // Between mesh-a and mesh-b sections there should be exactly one ---
    // A double separator would appear as "---\n\n---"
    expect(doc).not.toMatch(/---[\s\n]+---/);
    // Should still contain exactly one separator between the two blocks
    const separatorCount = (doc.match(/^---$/gm) ?? []).length;
    expect(separatorCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F3: Stop hook resolves repo root via process.cwd() when input.cwd absent
// ---------------------------------------------------------------------------

describe('Stop hook F3: cwd-absent input falls back to process.cwd()', () => {
  const sid = `stop-test-f3-${Date.now()}`;

  beforeEach(() => {
    // Write journal with a relative path entry
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 5, end: 15 }]);
  });
  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('produces a status doc when cwd is absent but process.cwd() is a git repo', async () => {
    // process.cwd() in tests is the workspace root which is a git repo
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t1-20\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L1-L20\n\nDesc.\n`;

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });

    // Input without cwd field
    const inputNoCwd: Record<string, unknown> = {
      hook_event_name: 'Stop' as const,
      session_id: sid,
      transcript_path: '/tmp/transcript.jsonl',
      stop_reason: 'end_turn'
      // no cwd
    };

    const result = asResult(await handler(inputNoCwd as never, makeCtx() as never));
    // process.cwd() should be a git repo, so we expect a blocking review prompt
    expect(result.stdout.decision).toBe('block');
    expect(result.stdout.reason).toBeDefined();
    const msg = result.stdout.reason as string;
    expect(msg).toContain('git-mesh-status-');
  });
});

// ---------------------------------------------------------------------------
// F5: Write overlapping a drifted mesh still appears in # Uncovered writes
// ---------------------------------------------------------------------------

describe('Stop hook F5: write overlapping drifted mesh anchor appears in # Uncovered writes', () => {
  const sid = `stop-test-f5-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-f5-'));
    initGitRepo(tmpRepo);
    // A write at lines 10-20 in src/drift.ts
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/drift.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('appears in # Uncovered writes when stale overlaps but write-coverage returns nothing', async () => {
    // Stale pass: the same range is drifted (stale hit) — proves drift, not coverage
    const stale: StaleExecutor = () => 'drifted-mesh\tsrc/drift.ts\t5-25\n';
    const staleRender: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/drift.ts#L5-L25\n\nDrifted.\n`;

    // Write-coverage pass: no current mesh covers src/drift.ts L10-L20
    const listBatch: ListBatchExecutor = () => '';

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: listBatch,
      listRenderExecutor: staleRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout.decision).toBe('block');
    expect(result.stdout.reason).toBeDefined();
    const msg = result.stdout.reason as string;
    const docMatch = msg.match(/git-mesh-status-[^\s]+\.md/);
    expect(docMatch).not.toBeNull();
    const docPath = nodePath.join(os.tmpdir(), docMatch![0]);
    const doc = fs.readFileSync(docPath, 'utf8');

    // The write should appear in Uncovered writes, NOT be silently absorbed by the stale pass
    expect(doc).toContain('# Uncovered writes');
    expect(doc).toContain('src/drift.ts');
  });
});

describe('loadJournal: all-unparseable lines → null', () => {
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
