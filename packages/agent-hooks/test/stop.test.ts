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
import { expertAgentMarkerPath, recordExpertAgent } from '../src/agent-hooks-common.js';
import {
  buildAnchorSpecs,
  createStopHandler,
  type JournalEntry,
  journalPath,
  type ListBatchExecutor,
  type ListRenderExecutor,
  loadJournal,
  type StaleExecutor,
  type StaleRenderExecutor
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

  it('produces a # Stale meshes section and marks the stale-fed entry seen', async () => {
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    // Write-coverage pass also covers the write range — entry is reported.
    const listBatch: ListBatchExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;
    // The stale section renders the whole mesh via `git mesh stale <slug>`:
    // every anchor, the drift reason, and the why.
    const staleRender: StaleRenderExecutor = (slugs) =>
      `## ${slugs[0]}\n- src/foo.ts#L5-L25 — changed in the working tree\n- src/helper.ts#L1-L8\n\nFoo subsystem why.`;

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: listBatch,
      listRenderExecutor: render,
      staleRenderExecutor: staleRender
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
    // The whole mesh is rendered: the drifted anchor with its reason, the other
    // anchor, and the why — not just the touched/drifted file.
    expect(doc).toContain('- src/foo.ts#L5-L25 — changed in the working tree');
    expect(doc).toContain('- src/helper.ts#L1-L8');
    expect(doc).toContain('Foo subsystem why.');
    // Write is covered by a current mesh via write-coverage pass → not uncovered
    expect(doc).not.toContain('# Uncovered writes');

    // The reported entry is marked seen so it is not re-dispatched next run.
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

  it('does not re-dispatch on a second run once entries are marked seen', async () => {
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });

    // First run surfaces the review and marks the fed entries seen.
    const r1 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(r1.stdout.decision).toBe('block');
    expect(r1.stdout.reason).toContain('git-mesh-status-');

    // Second run, same journal and no new touches: every entry is now seen, so
    // no section is assembled and nothing is dispatched.
    const r2 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(r2.stdout.decision).not.toBe('block');
    expect(r2.stdout.reason).toBeUndefined();
  });
});

describe('Stop hook: non-write touch surfacing a stale anchor does not loop', () => {
  const sid = `stop-test-noloop-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-noloop-'));
    initGitRepo(tmpRepo);
    // A whole-file READ touch — not a write, and `whole` kind never "feeds" a
    // ranged stale row. Under the old per-entry marking it stayed unseen and
    // re-fired the block on every Stop.
    writeJournalRaw(sid, [{ tool: 'Read', path: 'src/foo.ts', kind: 'whole', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('marks the read seen and does not re-dispatch on the second run', async () => {
    // The file the read touched has a stale ranged anchor.
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const staleRender: StaleRenderExecutor = (slugs) =>
      `## ${slugs[0]}\n- src/foo.ts#L5-L25 — changed in the working tree\n\nWhy.`;
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender,
      staleRenderExecutor: staleRender
    });

    const r1 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(r1.stdout.decision).toBe('block');
    expect(readJournalRaw(sid)[0].seen).toBe(true);

    // Same journal, no new touches: must not block again.
    const r2 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(r2.stdout.decision).not.toBe('block');
    expect(r2.stdout.reason).toBeUndefined();
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
    const stale: StaleExecutor = () => 'mesh-a\tsrc/a.ts\t1-10\nmesh-b\tsrc/b.ts\t1-10\n';
    // Simulate `git mesh stale mesh-a mesh-b` (Rust render_blocks): two blocks
    // separated by \n---\n. The hook must re-join them with a single separator.
    const staleRender: StaleRenderExecutor = (slugs) =>
      slugs.map((s) => `## ${s}\n- Details for ${s}.`).join('\n\n---\n\n');

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender,
      staleRenderExecutor: staleRender
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

// ---------------------------------------------------------------------------
// Stale section renders the whole mesh — all anchors, drift reasons, and the why
// ---------------------------------------------------------------------------

describe('Stop hook: stale section renders the whole mesh like `git mesh stale`', () => {
  const sid = `stop-test-stale-names-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-stale-names-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('renders every anchor (touched or not), the drift reason, and the why', async () => {
    // Porcelain detection fires on the touched anchor only…
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    // …but the render shows the whole mesh: the drifted touched anchor, a
    // fresh untouched anchor, a whole-file anchor, and the why.
    const staleRender: StaleRenderExecutor = (slugs) =>
      `## ${slugs[0]}\n- src/foo.ts#L5-L25 — changed in the working tree\n- src/untouched.ts#L1-L8\n- src/whole.ts\n\nThe my-slug subsystem why.`;
    // listRenderExecutor must NOT be consulted for the stale section; throw if it is.
    const render: ListRenderExecutor = () => {
      throw new Error('listRenderExecutor should not be called for the stale section');
    };

    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render,
      staleRenderExecutor: staleRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    const msg = result.stdout.reason as string;
    const docPath = nodePath.join(os.tmpdir(), msg.match(/git-mesh-status-[^\s]+\.md/)![0]);
    const doc = fs.readFileSync(docPath, 'utf8');

    // Isolate the `# Stale meshes` section (up to the next top-level header).
    const staleSection = doc.split('# Stale meshes')[1].split(/\n# /)[0];
    expect(staleSection).toContain('## my-slug');
    // The drifted anchor carries its reason …
    expect(staleSection).toContain('- src/foo.ts#L5-L25 — changed in the working tree');
    // … the untouched and whole-file anchors are present …
    expect(staleSection).toContain('- src/untouched.ts#L1-L8');
    expect(staleSection).toContain('- src/whole.ts');
    expect(staleSection).not.toContain('src/whole.ts#L');
    // … and the why is included.
    expect(staleSection).toContain('The my-slug subsystem why.');
  });
});

// ---------------------------------------------------------------------------
// Dispatch message names only the sections the doc contains
// ---------------------------------------------------------------------------

describe('Stop hook: dispatch message is specific to the situation', () => {
  const sid = `stop-test-msg-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-msg-'));
    initGitRepo(tmpRepo);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('does not mention stale meshes when only uncovered writes exist', async () => {
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/bar.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });

    const msg = (
      asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string
    ).toLowerCase();
    expect(msg).toContain('uncovered writes');
    expect(msg).not.toContain('stale mesh');
    expect(msg).not.toContain('related mesh');
    // The resolver subagent runs on the haiku model.
    expect(msg).toContain('haiku model');
  });

  it('mentions only stale meshes when the write is covered (no uncovered, no related-without-write)', async () => {
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    // Write-coverage pass covers the write → covered (related), so the message
    // mentions stale and related, but never uncovered writes.
    const listBatch: ListBatchExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;
    const staleRender: StaleRenderExecutor = (slugs) =>
      `## ${slugs[0]}\n- src/foo.ts#L5-L25 — changed in the working tree\n\nWhy.`;
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: listBatch,
      listRenderExecutor: render,
      staleRenderExecutor: staleRender
    });

    const msg = (
      asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string
    ).toLowerCase();
    expect(msg).toContain('stale mesh');
    expect(msg).not.toContain('uncovered writes');
  });
});

// ---------------------------------------------------------------------------
// Dispatch wakes an existing git-mesh:expert via SendMessage when one is recorded
// ---------------------------------------------------------------------------

describe('Stop hook: dispatch targets a prior git-mesh:expert when recorded', () => {
  const sid = `stop-test-wake-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-wake-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/bar.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
    const mPath = expertAgentMarkerPath(sid);
    if (fs.existsSync(mPath)) fs.unlinkSync(mPath);
  });

  it('spawns a fresh git-mesh:expert when no prior agent is recorded', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    const msg = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string;
    expect(msg).toContain('Spawn a background git-mesh:expert subagent on the haiku model');
    expect(msg).not.toContain('SendMessage');
  });

  it('wakes the recorded agent via SendMessage instead of spawning', async () => {
    recordExpertAgent(sid, 'agent-abc123');
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    const msg = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string;
    expect(msg).toContain('Use SendMessage to wake the git-mesh:expert subagent (agent agent-abc123)');
    expect(msg).not.toContain('Spawn a background');
    // Still names the work present and the new status doc.
    expect(msg).toContain('git-mesh-status-');
    expect(msg.toLowerCase()).toContain('uncovered writes');
    // The preamble was removed.
    expect(msg).not.toContain('A new mesh status doc is ready');
  });
});

describe('Stop hook: status doc carries the transcript pointer', () => {
  const sid = `stop-test-transcript-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-transcript-'));
    initGitRepo(tmpRepo);
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/bar.ts', kind: 'write', seen: false, start: 1, end: 10 }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('includes a # Transcript section naming the transcript path from the input', async () => {
    const handler = createStopHandler({
      staleExecutor: noopStale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });
    const input = { ...baseInput(sid, tmpRepo), transcript_path: '/tmp/my-transcript.jsonl' };
    const msg = asResult(await handler(input as never, makeCtx() as never)).stdout.reason as string;
    const docPath = nodePath.join(os.tmpdir(), msg.match(/git-mesh-status-[^\s]+\.md/)![0]);
    const doc = fs.readFileSync(docPath, 'utf8');
    expect(doc).toContain('# Transcript');
    expect(doc).toContain('/tmp/my-transcript.jsonl');
  });
});

// ---------------------------------------------------------------------------
// Each Stop call writes a uniquely named status doc
// ---------------------------------------------------------------------------

describe('Stop hook: status doc filename is unique per call', () => {
  const sid = `stop-test-unique-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-unique-'));
    initGitRepo(tmpRepo);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('two dispatching calls reference two different filenames', async () => {
    const stale: StaleExecutor = () => 'my-slug\tsrc/foo.ts\t5-25\n';
    const render: ListRenderExecutor = (slugs) => `## ${slugs[0]}\n- src/foo.ts#L5-L25\n\nDesc.\n`;
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: render
    });

    // Each run needs a fresh unreported entry, so rewrite the journal between runs.
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
    const m1 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string;
    writeJournalRaw(sid, [{ tool: 'Edit', path: 'src/foo.ts', kind: 'write', seen: false, start: 10, end: 20 }]);
    const m2 = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never)).stdout.reason as string;

    const f1 = m1.match(/git-mesh-status-[^\s]+\.md/)![0];
    const f2 = m2.match(/git-mesh-status-[^\s]+\.md/)![0];
    expect(f1).not.toBe(f2);
  });
});

// ---------------------------------------------------------------------------
// Resolved-pending-commit: a stale anchor whose only drift is an uncommitted
// edit to its own source file, with the `.mesh` re-anchor already staged, must
// not re-dispatch. The resolver is forbidden from committing the source, so the
// drift can never clear and re-firing loops forever.
// ---------------------------------------------------------------------------

/**
 * Build a real mesh repo in the resolved-pending-commit state:
 *   - source file committed, mesh committed (baseline clean)
 *   - source edited so the anchored lines shift down (uncommitted)
 *   - mesh re-anchored to the new range and STAGED (source still uncommitted)
 * This is exactly the loop body the Stop hook re-fires on.
 */
function makePendingCommitRepo(): string {
  const cp = require('node:child_process');
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-pending-'));
  const git = (...args: string[]) => cp.execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const mesh = (...args: string[]) => cp.execFileSync('git', ['mesh', ...args], { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(nodePath.join(root, 'app.js'), 'line1\nline2\nhandler\nbody\nend\n');
  git('add', 'app.js');
  git('commit', '-qm', 'init');
  mesh('add', 'demo/h', 'app.js#L3-L5');
  mesh('why', 'demo/h', '-m', 'handler contract');
  git('add', '.mesh');
  git('commit', '-qm', 'mesh');
  // Shift the anchored lines down with an uncommitted edit.
  fs.writeFileSync(nodePath.join(root, 'app.js'), 'pre1\npre2\nline1\nline2\nhandler\nbody\nend\n');
  // Re-anchor to the new range and stage the mesh — source stays uncommitted.
  mesh('remove', 'demo/h', 'app.js#L3-L5');
  mesh('add', 'demo/h', 'app.js#L5-L7');
  git('add', '.mesh');
  return root;
}

describe('Stop hook: resolved-pending-commit stale anchor does not re-dispatch', () => {
  const sid = `stop-test-pending-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = makePendingCommitRepo();
    // A fresh, unreported READ touch on the anchored file — the kind the
    // resolver subagent generates every round when it re-reads the source to
    // re-anchor. (A read does not feed the uncovered-writes pass, so the stale
    // pass is the only thing that can re-fire the block.)
    writeJournalRaw(sid, [{ tool: 'Read', path: 'app.js', kind: 'whole', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('does not block when the drift is an uncommitted source edit with a staged re-anchor', async () => {
    // git mesh stale reports the drifted anchor — this is what wakes the hook.
    const stale: StaleExecutor = () => 'demo/h\tapp.js\t5-7\n';
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    // The drift cannot be cleared until the source commits — an action the
    // resolver is forbidden to take — so the hook must NOT re-dispatch.
    expect(result.stdout.decision).not.toBe('block');
    expect(result.stdout.reason).toBeUndefined();
  });
});

describe('Stop hook: uncommitted source with no staged re-anchor still dispatches once', () => {
  const sid = `stop-test-firstfire-${Date.now()}`;
  let tmpRepo: string;

  beforeEach(() => {
    const cp = require('node:child_process');
    tmpRepo = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stop-test-firstfire-'));
    const git = (...args: string[]) => cp.execFileSync('git', args, { cwd: tmpRepo, stdio: 'ignore' });
    const mesh = (...args: string[]) => cp.execFileSync('git', ['mesh', ...args], { cwd: tmpRepo, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'test@test.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(nodePath.join(tmpRepo, 'app.js'), 'line1\nline2\nhandler\nbody\nend\n');
    git('add', 'app.js');
    git('commit', '-qm', 'init');
    mesh('add', 'demo/h', 'app.js#L3-L5');
    mesh('why', 'demo/h', '-m', 'handler contract');
    git('add', '.mesh');
    git('commit', '-qm', 'mesh');
    // Source edited (uncommitted) but the mesh has NOT been re-anchored/staged.
    fs.writeFileSync(nodePath.join(tmpRepo, 'app.js'), 'pre1\npre2\nline1\nline2\nhandler\nbody\nend\n');
    writeJournalRaw(sid, [{ tool: 'Read', path: 'app.js', kind: 'whole', seen: false }]);
  });
  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('blocks so the resolver can perform the re-anchor (no staged .mesh yet)', async () => {
    const stale: StaleExecutor = () => 'demo/h\tapp.js\t3-5\n';
    const handler = createStopHandler({
      staleExecutor: stale,
      listBatchExecutor: noopListBatch,
      listRenderExecutor: noopListRender
    });

    const result = asResult(await handler(baseInput(sid, tmpRepo) as never, makeCtx() as never));
    expect(result.stdout.decision).toBe('block');
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
