/**
 * Acceptance checks for the Claude harness snapshot lifecycle (card
 * main-213): the full PreToolUse → PostToolUse / PostToolUseFailure →
 * SessionEnd flow through the committed adapter modules (src/claude/snapshot.ts,
 * src/claude/post-tool-use.ts, src/claude/post-tool-use-failure.ts,
 * src/claude/session-end.ts) and the shared store/activity-log contract.
 *
 * These fixtures run against the implemented adapters (Phase 3). Fixtures
 * that need the real `git span` CLI are gated with
 * `it.skipIf(!hasGitSpan)` so they fail visibly when the CLI is missing,
 * mirroring porcelain-contract.test.ts.
 *
 * The lifecycle contract, per the plan:
 *
 * - PreToolUse classifies the command and, when it decides a snapshot, walks
 *   and persists the record for (session_id, tool_use_id) — a write-only hook
 *   that never returns a signal, fails open without a record when
 *   uncorrelatable, and writes nothing for provably read-only commands.
 * - PostToolUse finds the record, compares pre vs post, resolves interleaved
 *   edits against the activity log, and touches through the observed-write
 *   scope list. Formatter runs, embedded scripts, generations, deletes, and
 *   renames are all attributed; a dirty baseline never surfaces; a duplicate
 *   delivery consumes exactly once; a record with no PostToolUse stays live as
 *   ambiguity evidence.
 * - PostToolUseFailure runs the same comparison whenever a record exists —
 *   `is_interrupt` gates nothing. Mutated-nothing failures produce no
 *   candidates but still close the window; record-less failures discard with a
 *   warn.
 * - Deleted paths surface through dead anchors: `git span list --porcelain`
 *   reaches them (exit 0), `git span drift` reports them as debt, and `--fix`
 *   leaves them alone for a human to reconcile.
 * - SessionEnd and the TTL sweep reclaim records, tombstones, activity
 *   entries, and index entries.
 * - The concurrency ambiguity table (8 rows) and the activity-log interleaving
 *   four outcomes (never-flag, skip, bounded-double, unfinished fail-closed)
 *   resolve deterministic orderings and racing duplicates.
 *
 * Clock fixtures use real `Date.now()` values (the activity-log consult reads
 * entry-file mtimes, which are real writes) except where a fake clock is the
 * point (the mtimeNs soundness checks drive compareSnapshot directly).
 */

import { execFileSync } from 'node:child_process';
import { renameSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandler as createPostToolUseHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as createFailureHandler } from '../../src/claude/post-tool-use-failure.js';
import sessionEndHook from '../../src/claude/session-end.js';
import { createHandler as createSnapshotPreHook } from '../../src/claude/snapshot.js';
import {
  isDebt,
  parseDriftPorcelain,
  parsePorcelain,
  queueRoot,
  sanitizeSessionId,
  sessionDir
} from '../../src/common/agent-hooks-common.js';
import {
  applyAmbiguityRules,
  classifyCommandForSnapshot,
  compareSnapshot,
  DEFAULT_SNAPSHOT_BUDGETS,
  type ReadFile,
  type SiblingSnapshot,
  type SnapshotFile,
  type SnapshotRecord,
  type StatFile
} from '../../src/common/snapshot-core.js';
import {
  type ActivityEntry,
  activityEntriesCovering,
  appendActivityEntry,
  createSnapshotStore
} from '../../src/common/snapshot-store.js';
import {
  addSpan,
  BASE_NOW,
  CLAUDE_SESSION_IDS,
  createMemoryMemoStore,
  createTestRepo,
  driftRow,
  flushPurgedSessions,
  gitAddCommit,
  makeExecutors,
  makeFile,
  makeRecord,
  porcelainRow,
  purgeSessions,
  SPAN_A,
  SPAN_B,
  sha256Hex,
  type TestRepo,
  writeFile
} from './snapshot-lifecycle-helpers.js';

// ---------------------------------------------------------------------------
// Git-span availability check
// ---------------------------------------------------------------------------

const hasGitSpan = (() => {
  try {
    execFileSync('git', ['span', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Shared fixture content
// ---------------------------------------------------------------------------

/** A deterministic N-line TS file body. */
function fileLines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `export const v${i + 1} = ${i + 1};`).join('\n')}\n`;
}

const P10 = fileLines(10);
/** The formatter's effect on P10: lines 3-4 reflowed. */
const P10_FORMATTED = P10.replace('export const v3 = 3;', 'export const v3  = 3;').replace(
  'export const v4 = 4;',
  'export const v4 = 4; '
);
/**
 * A failed formatter's partial write on P10: lines 1-3 rewritten with
 * different values, then death. The mutation is semantic, not whitespace:
 * the real CLI's `--fix` heals whitespace-only drift (re-anchoring and
 * reporting RESOLVED_PENDING_COMMIT, which is never debt), so a whitespace
 * partial write would surface nothing through the real pipeline; semantic
 * change stays CHANGED debt and must surface.
 */
const P10_PARTIAL = P10.replace('export const v1 = 1;', 'export const v1 = 100;')
  .replace('export const v2 = 2;', 'export const v2 = 20;')
  .replace('export const v3 = 3;', 'export const v3 = 30;');
/** P10 dirtied before a call runs. */
const P10_DIRTY = P10.replace('export const v1 = 1;', 'export const v1  = 1;');
const P30 = fileLines(30);
/** P30 with lines 1-2 dirtied before a call runs. */
const P30_DIRTY = P30.replace('export const v1 = 1;', 'export const v1  = 1;').replace(
  'export const v2 = 2;',
  'export const v2 = 2; '
);
/** P30_DIRTY with lines 20-21 reflowed by the call itself. */
const P30_DIRTY_FORMATTED = P30_DIRTY.replace('export const v20 = 20;', 'export const v20  = 20;').replace(
  'export const v21 = 21;',
  'export const v21 = 21; '
);
const GEN_TS = 'export const generated = 1;\n';
const GEN_TS_FORMATTED = 'export const generated = 2;\n';

// ---------------------------------------------------------------------------
// Fakes and input builders
// ---------------------------------------------------------------------------

/** A logger that collects warn+info messages — the interleaving notes are info. */
function noteCapturingLogger(): { logger: Logger; notes: string[] } {
  const notes: string[] = [];
  const capture = new Logger();
  capture.on('warn', (event) => notes.push(event.message));
  capture.on('info', (event) => notes.push(event.message));
  return { logger: capture, notes };
}

/** Read the touch block out of a hook result, or null when there is none. */
function toResult(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  // The SDK nests the hook output under stdout: the result is
  // { _type, stdout: { systemMessage?, hookSpecificOutput: { hookEventName,
  // additionalContext } } }.
  const stdout = (raw as { stdout?: { hookSpecificOutput?: { additionalContext?: string | null } } }).stdout;
  return stdout?.hookSpecificOutput?.additionalContext ?? null;
}

function preInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-lifecycle',
    transcript_path: '/tmp/transcript',
    cwd: '/repo',
    tool_use_id: 'tu-bash-1',
    tool_name: 'Bash',
    tool_input: { command: '' },
    ...overrides
  };
}

function postInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'sess-lifecycle',
    transcript_path: '/tmp/transcript',
    cwd: '/repo',
    tool_use_id: 'tu-bash-1',
    tool_name: 'Bash',
    tool_input: { command: '' },
    ...overrides
  };
}

function failureInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUseFailure',
    session_id: 'sess-lifecycle',
    transcript_path: '/tmp/transcript',
    cwd: '/repo',
    tool_use_id: 'tu-bash-1',
    tool_name: 'Bash',
    tool_input: { command: '' },
    error: { type: 'error', message: 'Bash exited with code 1' },
    duration_ms: 120,
    ...overrides
  };
}

function sessionEndInput(sessionId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SessionEnd',
    session_id: sessionId,
    transcript_path: '/tmp/transcript',
    cwd: '/repo',
    reason: 'other'
  };
}

/** A sibling record view built from the sibling's own record — fidelity over looseness. */
function siblingFrom(record: SnapshotRecord, path: string, overrides: Partial<SiblingSnapshot> = {}): SiblingSnapshot {
  return {
    sessionId: record.sessionId,
    toolUseId: record.toolUseId,
    createdAt: record.createdAt,
    consumed: record.consumed,
    consumedAt: record.consumedAt,
    coverageGap: record.gaps.length > 0,
    pre: record.files[path] ?? null,
    post: record.post?.[path] ?? null,
    ...overrides
  };
}

/** Run a body against a fresh real repo, always cleaning up. */
async function withRepo<T>(fn: (repo: TestRepo) => Promise<T>): Promise<T> {
  const repo = createTestRepo();
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
}

// ---------------------------------------------------------------------------
// The lifecycle acceptance checks
// ---------------------------------------------------------------------------

describe('claude harness snapshot lifecycle', () => {
  // The store persists tombstones for `recordTtlMs` after consumption; a
  // previously consumed (session, tool_use_id) would fail every call closed
  // on a re-run. The fixture's ids are fixed and unique per test, so purge
  // the claude file's own session dirs before the run (see the helpers'
  // rationale). Only this file's ids: the codex file runs in a parallel fork
  // over the same shared session base, and a union purge would delete its
  // live records mid-test.
  beforeAll(() => purgeSessions(CLAUDE_SESSION_IDS));
  // The records/tombstones this run writes must not outlive it either: the
  // core suite's write-time sweep walks every record in the shared session
  // base and warns per repo whose temp dir is already gone, so a fixture
  // record left behind (repo cleaned at test end, record persisting until
  // the next run's beforeAll) fails the core file's no-warns assertions
  // when the files run in parallel. Purge after every test — again scoped
  // to this file's ids, mirroring snapshot-store.test.ts's afterEach
  // cleanup convention. The purge *renames* the dirs out of the base rather
  // than unlinking them: other workers' sweeps read shared-base record
  // files, and a close-after-unlink crashes Node on this fs (see the
  // helpers' rationale). The renamed dirs sit in a per-worker trash root
  // outside the base and are emptied once, at the end of the file.
  afterEach(() => purgeSessions(CLAUDE_SESSION_IDS));
  afterAll(flushPurgedSessions);

  describe('A. PreToolUse — the write-only pre walk', () => {
    it('writes a pre-walk record for an opaque command, correlated by (session_id, tool_use_id)', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-pre-record';
        const tuId = 'tu-pre-record-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const pre = createSnapshotPreHook();
        const logger = new Logger();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const result = await pre(input as never, { logger });
        // The pre hook is write-only: its only observable effect is the record.
        expect(result).toBeNull();
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record).toMatchObject({
          sessionId,
          toolUseId: tuId,
          repoRoot: repo.root,
          consumed: false,
          consumedAt: null,
          tier: 'repo'
        });
        // The pre walk captured the file the opaque command can write.
        expect(record.files['src/app.ts']).toBeDefined();
      });
    });

    it('writes no record for a provably read-only command, and the classifier agrees', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-pre-readonly';
        const tuId = 'tu-pre-readonly-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const pre = createSnapshotPreHook();
        const logger = new Logger();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'git status' }
        });
        expect(await pre(input as never, { logger })).toBeNull();
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBeNull();
        // The SAME classifier runs at PostToolUse: both sides agree that no
        // snapshot should exist, so no missing-record warning can ever fire
        // for a read-only call.
        const plan = classifyCommandForSnapshot('git status', repo.root);
        expect(plan.decision.kind).toBe('no-snapshot');
        expect(plan.decision.reason).toBe('read-only');
      });
    });

    it('fails open with no record when session_id or tool_use_id is absent — uncorrelatable events are skipped', async () => {
      const pre = createSnapshotPreHook();
      const logger = new Logger();
      const base = preInput({ cwd: '/tmp', tool_input: { command: 'npx prettier --write /tmp/x.ts' } });
      const noSession = await pre({ ...base, session_id: undefined } as never, { logger });
      const noToolUse = await pre({ ...base, tool_use_id: undefined } as never, { logger });
      expect(noSession).toBeNull();
      expect(noToolUse).toBeNull();
    });
  });

  describe('B. PostToolUse — comparison, attribution, consumption', () => {
    it('attributes a formatter run to exact post-state ranges — the canonical opaque command', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-formatter';
        const tuId = 'tu-formatter-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(input as never, { logger });
        // The formatter's effect: lines 3-4 reflowed, nothing else.
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        const { executors, calls } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts')
              ? [
                  porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 }),
                  porcelainRow({ name: SPAN_B, path: 'src/app.ts', start: 8, end: 10 })
                ]
              : [],
          drift: () => [
            driftRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 }),
            driftRow({ name: SPAN_B, path: 'src/app.ts', start: 8, end: 10 })
          ]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // The observed ranges come from the comparison: lines 3-4 changed,
        // lines 8-10 did not — only the span inside the changed range
        // surfaces. A whole-file scope would have surfaced both.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).not.toContain('## billing/payment-created-flow');
        expect(calls.fix).toBe(1);
        // PostToolUse consumes the record — the window closes.
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('attributes an embedded-script write — the script is opaque, the file is captured', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-script';
        const tuId = 'tu-script-1';
        writeFile(repo.root, 'src/gen.ts', GEN_TS);
        gitAddCommit(repo.root, 'add gen.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'python3 scripts/gen.py' }
        });
        await pre(input as never, { logger });
        // The script rewrote the file it owns.
        writeFile(repo.root, 'src/gen.ts', GEN_TS_FORMATTED);
        const { executors } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/gen.ts')
              ? [porcelainRow({ name: SPAN_A, path: 'src/gen.ts', start: 1, end: 5 })]
              : [],
          drift: () => [driftRow({ name: SPAN_A, path: 'src/gen.ts', start: 1, end: 5 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        expect(toResult(raw)).toContain('## billing/checkout-request-flow');
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('batches a multi-file generation into one heal pass, one repo-wide drift, joined blocks', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-generated';
        const tuId = 'tu-generated-1';
        writeFile(repo.root, 'src/a.ts', '// a\n');
        gitAddCommit(repo.root, 'add a.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'make generate' }
        });
        await pre(input as never, { logger });
        // `make generate` rewrote src/a.ts and created src/b.ts.
        writeFile(repo.root, 'src/a.ts', '// a generated\n');
        writeFile(repo.root, 'src/b.ts', '// b generated\n');
        const { executors, calls, driftArgs, fixPaths } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/a.ts')
              ? [porcelainRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })]
              : [porcelainRow({ name: SPAN_B, path: 'src/b.ts', start: 1, end: 5 })],
          drift: () => [
            driftRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 }),
            driftRow({ name: SPAN_B, path: 'src/b.ts', start: 1, end: 5 })
          ]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // One scoped heal pass per attributed path (each fix scoped to its
        // own filePath), one repo-wide drift, per-path list — never a single
        // unscoped fix for the whole batch.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).toContain('## billing/payment-created-flow');
        expect(calls.fix).toBe(2);
        expect(fixPaths).toHaveLength(2);
        expect(fixPaths).toContain(`${repo.root}/src/a.ts`);
        expect(fixPaths).toContain(`${repo.root}/src/b.ts`);
        expect(calls.drift).toBe(1);
        expect(driftArgs).toEqual([[]]);
        expect(calls.list).toBe(2);
      });
    });

    it('keeps an unconsumed record live as ambiguity evidence when PostToolUse never arrives', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-absent';
        const tuId = 'tu-absent-1';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        writeFile(repo.root, 'src/app.ts', P10);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: BASE_NOW,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        // No PostToolUse ever fires for this call — the record must stay live
        // and unconsumed so a later call's ambiguity check can read it.
        const found = store.find(sessionId, tuId);
        expect(found).not.toBeNull();
        expect(found).not.toBe('tombstoned');
        if (found === null || found === 'tombstoned') throw new Error('record missing');
        expect(found.consumed).toBe(false);
        expect(found.consumedAt).toBeNull();
        const entry = store.listRepoRecords(repo.root).find((e) => e.toolUseId === tuId);
        expect(entry).toMatchObject({ sessionId, toolUseId: tuId, consumed: false, consumedAt: null });
      });
    });

    it('treats a duplicate PostToolUse delivery as a no-op — exactly one attribution', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-duplicate';
        const tuId = 'tu-dup-1';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        writeFile(repo.root, 'src/app.ts', P10);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: BASE_NOW,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        const { executors, calls } = makeExecutors({
          rows: () => [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })],
          drift: () => [driftRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const first = toResult(await handler(input as never, { logger }));
        const second = toResult(await handler(input as never, { logger }));
        expect(first).toContain('## billing/checkout-request-flow');
        expect(second).toBeNull();
        // The second delivery found the tombstone and never reached the touch.
        expect(calls.list).toBe(1);
      });
    });

    it('never surfaces pre-existing dirty state on an untouched path', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-dirty';
        const tuId = 'tu-dirty-1';
        writeFile(repo.root, 'src/app.ts', P10);
        writeFile(repo.root, 'src/other.ts', P10);
        gitAddCommit(repo.root, 'add files');
        // Someone dirtied src/app.ts before this call; the call touches
        // src/other.ts, an already-formatted file — a no-op formatter run.
        writeFile(repo.root, 'src/app.ts', P10_DIRTY);
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/other.ts' }
        });
        await pre(input as never, { logger });
        const { executors, calls } = makeExecutors({
          rows: () => [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        // Pre and post agree on every walked path: no changed paths, no scopes,
        // no touch — the dirty src/app.ts is part of the baseline, never a
        // candidate, even though the fake rows would surface it if asked.
        expect(toResult(raw)).toBeNull();
        expect(calls.fix).toBe(0);
        expect(calls.drift).toBe(0);
        expect(calls.list).toBe(0);
      });
    });

    it('attributes only the newly edited range of a path that was already dirty', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-dirty2';
        const tuId = 'tu-dirty2-1';
        writeFile(repo.root, 'src/app.ts', P30);
        gitAddCommit(repo.root, 'add app.ts');
        // Lines 1-2 were already dirtied in the working tree before this call.
        writeFile(repo.root, 'src/app.ts', P30_DIRTY);
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(input as never, { logger });
        // The formatter reflowed lines 20-21 on top of the dirty baseline.
        writeFile(repo.root, 'src/app.ts', P30_DIRTY_FORMATTED);
        const { executors } = makeExecutors({
          rows: () => [
            porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 20, end: 25 }),
            porcelainRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 5 })
          ],
          drift: () => [
            driftRow({ name: SPAN_A, path: 'src/app.ts', start: 20, end: 25 }),
            driftRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 5 })
          ]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // The snapshot's baseline is the dirty state — the comparison sees only
        // the call's own delta (lines 20-21), and the span covering the
        // pre-existing dirt never surfaces.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).not.toContain('## billing/payment-created-flow');
      });
    });
  });

  describe('C. PostToolUseFailure — the failure policy', () => {
    /**
     * The shared failed-command scenario: a real repo with a real span, a
     * pre-walk record for an opaque formatter call, and a partial write left
     * behind by the failed command. Returns the failure handler's touch block.
     */
    async function failureCompareFixture(
      sessionId: string,
      tuId: string,
      inputOverrides: Record<string, unknown>
    ): Promise<string | null> {
      const repo = createTestRepo();
      try {
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(input as never, { logger });
        // The command failed mid-write: lines 1-3 were rewritten, then the
        // process died. The failure policy compares and attributes the partial
        // mutation — it is never silently lost.
        writeFile(repo.root, 'src/app.ts', P10_PARTIAL);
        const failure = createFailureHandler(); // default store — real executors at Phase 3
        const raw = await failure(
          failureInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/app.ts' },
            ...inputOverrides
          }) as never,
          { logger }
        );
        return toResult(raw);
      } finally {
        repo.cleanup();
      }
    }

    it.skipIf(!hasGitSpan)('a plain-error failure still compares and attributes the partial mutation', async () => {
      const block = await failureCompareFixture('sess-lifecycle-failure-plain', 'tu-failure-plain', {});
      expect(block).toContain('## billing/checkout-request-flow');
    });

    it.skipIf(!hasGitSpan)('an is_interrupt: true failure compares and attributes identically', async () => {
      // is_interrupt is not a mutation report and gates nothing — an
      // interrupted command that cannot confirm its own window end is handled
      // by the concurrency rules, not by trusting the interrupt flag.
      const block = await failureCompareFixture('sess-lifecycle-failure-interrupt', 'tu-failure-interrupt', {
        is_interrupt: true
      });
      expect(block).toContain('## billing/checkout-request-flow');
    });

    it.skipIf(!hasGitSpan)('an is_interrupt: false failure compares and attributes identically', async () => {
      const block = await failureCompareFixture('sess-lifecycle-failure-nointerrupt', 'tu-failure-nointerrupt', {
        is_interrupt: false
      });
      expect(block).toContain('## billing/checkout-request-flow');
    });

    it('closes the record window for a failure that mutated nothing — no candidates, no warn', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-failure-none';
        const tuId = 'tu-failure-none';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(input as never, { logger });
        const { logger: capLogger, notes } = noteCapturingLogger();
        const failure = createFailureHandler();
        const raw = await failure(
          failureInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger: capLogger }
        );
        expect(toResult(raw)).toBeNull();
        // The window is closed so a later call's ambiguity check sees the
        // failure; closing a record that existed is not a silent loss.
        expect(createSnapshotStore(capLogger).find(sessionId, tuId)).toBe('tombstoned');
        expect(notes.some((n) => n.includes('discard'))).toBe(false);
      });
    });

    it('discards a failure with no record, with a warn — the loss is never silent', async () => {
      const failure = createFailureHandler();
      const { logger, notes } = noteCapturingLogger();
      const raw = await failure(
        failureInput({
          session_id: 'sess-lifecycle-failure-norecord',
          tool_use_id: 'tu-failure-norecord',
          cwd: '/tmp',
          tool_input: { command: 'npx prettier --write /tmp/x.ts' }
        }) as never,
        { logger }
      );
      expect(toResult(raw)).toBeNull();
      expect(notes.some((n) => n.includes('discard'))).toBe(true);
    });
  });

  describe('D. span-death surfacing — deleted paths reach dead anchors', () => {
    it.skipIf(!hasGitSpan)(
      'per-path list in bare repo-relative form reaches a deleted-but-anchored path — exit 0',
      async () => {
        const repo = createTestRepo();
        try {
          writeFile(repo.root, 'src/app.ts', P10);
          gitAddCommit(repo.root, 'add app.ts');
          addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
          rmSync(join(repo.root, 'src/app.ts'));
          // A deleted file still returns its anchors: list reaches the dead
          // anchor with exit 0, which is why the touch pipeline can surface it.
          const rows = parsePorcelain(
            execFileSync('git', ['span', 'list', '--porcelain', 'src/app.ts'], { cwd: repo.root, encoding: 'utf8' })
          );
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ name: SPAN_A, path: 'src/app.ts', start: 1, end: 5 });
        } finally {
          repo.cleanup();
        }
      }
    );

    it.skipIf(!hasGitSpan)('repo-wide drift reports the deleted anchor as CHANGED debt', async () => {
      const repo = createTestRepo();
      try {
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
        rmSync(join(repo.root, 'src/app.ts'));
        let out = '';
        try {
          execFileSync('git', ['span', 'drift', '--format', 'porcelain'], { cwd: repo.root, encoding: 'utf8' });
        } catch (err) {
          // Drift exits 1 whenever there is debt — the stdout still carries the
          // porcelain rows; the executors rely on that.
          out = (err as { stdout?: string }).stdout ?? '';
        }
        const row = parseDriftPorcelain(out).find((r) => r.name === SPAN_A);
        expect(row).toBeDefined();
        if (row) {
          expect(row.status).toBe('CHANGED');
          expect(isDebt(row.status)).toBe(true);
        }
      } finally {
        repo.cleanup();
      }
    });

    it.skipIf(!hasGitSpan)('drift --fix leaves the deleted anchor in place — debt persists, exit 1', async () => {
      const repo = createTestRepo();
      try {
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
        rmSync(join(repo.root, 'src/app.ts'));
        let exitCode = 0;
        let human = '';
        try {
          human = execFileSync('git', ['span', 'drift', '--fix'], {
            cwd: repo.root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
          });
        } catch (err) {
          const e = err as { status?: number; stdout?: string };
          exitCode = e.status ?? -1;
          human = e.stdout ?? '';
        }
        expect(exitCode).toBe(1);
        expect(human).toContain('Reconciled 0');
        // The anchor is untouched — a dead anchor is a decision for a human,
        // not a --fix side effect.
        const rows = parsePorcelain(
          execFileSync('git', ['span', 'list', '--porcelain', 'src/app.ts'], { cwd: repo.root, encoding: 'utf8' })
        );
        expect(rows).toHaveLength(1);
        let driftOut = '';
        try {
          execFileSync('git', ['span', 'drift', '--format', 'porcelain'], { cwd: repo.root, encoding: 'utf8' });
        } catch (err) {
          driftOut = (err as { stdout?: string }).stdout ?? '';
        }
        const after = parseDriftPorcelain(driftOut).find((r) => r.name === SPAN_A);
        expect(after).toBeDefined();
        if (after) expect(isDebt(after.status)).toBe(true);
      } finally {
        repo.cleanup();
      }
    });

    it.skipIf(!hasGitSpan)(
      'the delete touch surfaces the span through the real pipeline — dead anchor, exit codes ignored',
      async () => {
        await withRepo(async (repo) => {
          const sessionId = 'sess-lifecycle-delete';
          const tuId = 'tu-delete-1';
          writeFile(repo.root, 'src/app.ts', P10);
          gitAddCommit(repo.root, 'add app.ts');
          addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
          const logger = new Logger();
          const pre = createSnapshotPreHook();
          const input = preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'rm src/app.ts' }
          });
          await pre(input as never, { logger });
          rmSync(join(repo.root, 'src/app.ts'));
          // Default executors: the real CLI, whose exit codes the touch pipeline
          // ignores because the stdout still carries the useful rows.
          const handler = createPostToolUseHandler();
          const raw = await handler(input as never, { logger });
          const block = toResult(raw);
          // The deletion is invisible to static parsing (rm has no read idiom);
          // only the snapshot comparison sees it.
          expect(block).toContain('## billing/checkout-request-flow');
          // The touch block renders anchors as `path #L1-L5` (canonical per
          // advisor-core.test.ts); the span may move past the dead anchor, so
          // only the space form is asserted.
          expect(block).toContain('src/app.ts #L1-L5');
        });
      }
    );

    it.skipIf(!hasGitSpan)('a rename surfaces the old path as a delete and leaves the new path alone', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-rename';
        const tuId = 'tu-rename-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        addSpan(repo.root, SPAN_A, 'src/app.ts#L1-L5');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'mv src/app.ts src/app2.ts' }
        });
        await pre(input as never, { logger });
        renameSync(join(repo.root, 'src/app.ts'), join(repo.root, 'src/app2.ts'));
        const handler = createPostToolUseHandler();
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // The rename pairs as delete+create: the span lives on the old path,
        // and the dead anchor is the debt a human reconciles.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).toContain('src/app.ts #L1-L5');
        // The new path carries nothing — the CLI resolves the existing file
        // path to zero spans and exits 0 with "No spans match the filters."
        // (the path-mismatch exit 1 is only for paths absent from the tree),
        // so the executor sees an empty row set.
        const newPathList = execFileSync('git', ['span', 'list', '--porcelain', 'src/app2.ts'], {
          cwd: repo.root,
          encoding: 'utf8'
        });
        expect(newPathList).not.toContain(SPAN_A);
      });
    });
  });

  describe('E. cleanup — SessionEnd and the TTL sweep', () => {
    it("removes the session's records, tombstones, activity entries, and index entries at SessionEnd", async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const sessionId = 'sess-lifecycle-end';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: 'tu-end-1',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/app.ts': makeFile() }
          })
        );
        expect(store.tombstone(sessionId, 'tu-end-1', now)).toBe(true);
        appendActivityEntry(repo.root, {
          sessionId,
          toolUseId: 'tu-end-edit',
          kind: 'Edit',
          startedAt: now - 1000,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: 'pre-h', postHash: null }]
        });
        const raw = await sessionEndHook(sessionEndInput(sessionId) as never, { logger });
        expect(raw).toBeNull();
        // find returns null, not 'tombstoned' — the tombstone went with the record.
        expect(store.find(sessionId, 'tu-end-1')).toBeNull();
        expect(store.listRepoRecords(repo.root)).toHaveLength(0);
        expect(
          activityEntriesCovering(repo.root, 'src/app.ts', now - 2000, now, DEFAULT_SNAPSHOT_BUDGETS)
        ).toHaveLength(0);
      });
    });

    it('the TTL sweep removes an expired record and leaves a live one in place', async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        // The stale record is TTL-minus-margin relative to real now: every
        // store.write runs the TTL sweep first, so a record already past TTL
        // at write time would be cleaned by the write itself and never reach
        // the explicit sweep below. The margin keeps it in-TTL at write; the
        // injected future clock then expires it (mirrors snapshot-store.test.ts).
        const CLOCK_MARGIN_MS = 60_000;
        const staleCreatedAt = now - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + CLOCK_MARGIN_MS;
        store.write(
          makeRecord({
            sessionId: 'sess-lifecycle-ttl-old',
            toolUseId: 'tu-ttl-old',
            repoRoot: repo.root,
            createdAt: staleCreatedAt,
            files: { 'src/app.ts': makeFile() }
          })
        );
        store.write(
          makeRecord({
            sessionId: 'sess-lifecycle-ttl-live',
            toolUseId: 'tu-ttl-live',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/app.ts': makeFile() }
          })
        );
        const sweepNow = staleCreatedAt + DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs + 1;
        expect(store.sweep(sweepNow).records).toBe(1);
        expect(store.find('sess-lifecycle-ttl-old', 'tu-ttl-old')).toBeNull();
        expect(store.find('sess-lifecycle-ttl-live', 'tu-ttl-live')).not.toBeNull();
      });
    });

    it('the sweep prunes an unfinished activity entry older than the short TTL', async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        // pruneStaleActivity only visits repos named by readable records — a
        // repo with no records is invisible to the activity prune, so anchor
        // this repo with a live record before the sweep.
        store.write(
          makeRecord({
            sessionId: 'sess-lifecycle-ttl-edit',
            toolUseId: 'tu-edit-anchor',
            repoRoot: repo.root,
            createdAt: now,
            files: {}
          })
        );
        // The sweep-read margin skips files written within the last 5s, and
        // pruneStaleActivity only visits repos named by readable records — so
        // age the anchor record's file past the margin (its createdAt stays
        // in-TTL and live) or the repo is invisible to the activity prune.
        const anchorFile = join(
          sessionDir('sess-lifecycle-ttl-edit'),
          'snapshots',
          `${sanitizeSessionId('tu-edit-anchor')}.json`
        );
        utimesSync(anchorFile, (now - 60_000) / 1000, (now - 60_000) / 1000);
        appendActivityEntry(repo.root, {
          sessionId: 'sess-lifecycle-ttl-edit',
          toolUseId: 'tu-edit-stale',
          kind: 'Edit',
          startedAt: now - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 1000,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: 'pre-h', postHash: null }]
        });
        // The store's prune is entry-file-mtime-based: a just-appended entry
        // reads as fresh, so age the file past the unfinished-entry TTL
        // (utimesSync takes seconds).
        const stale = join(
          queueRoot(repo.root),
          'activity-log',
          `${sanitizeSessionId('sess-lifecycle-ttl-edit')}__${sanitizeSessionId('tu-edit-stale')}.json`
        );
        const oldSeconds = (now - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 60_000) / 1000;
        utimesSync(stale, oldSeconds, oldSeconds);
        expect(store.sweep(now)).toEqual({ records: 0, tombstones: 0, activityEntries: 1, indexEntries: 0 });
      });
    });
  });

  describe('F. concurrency — the ambiguity table', () => {
    it('decides every row of the table deterministically', () => {
      const PATH = 'src/app.ts';
      const fileA = makeFile({ hash: 'a'.repeat(64) });
      const fileB = makeFile({ hash: 'b'.repeat(64) });
      const mine = makeRecord({ createdAt: 200, files: { [PATH]: fileA } });
      // (mine created at T1=200; the table is read top-down per sibling.)
      const rows: { label: string; sibling: SiblingSnapshot; ambiguous: boolean }[] = [
        {
          label: 'unconsumed, created after mine',
          sibling: siblingFrom(mine, PATH, { createdAt: 300, consumed: false }),
          ambiguous: true
        },
        {
          label: 'unconsumed, created before mine',
          sibling: siblingFrom(mine, PATH, { createdAt: 100, consumed: false }),
          ambiguous: true
        },
        {
          label: 'consumed, created after mine, post(P) != pre(P)',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 300,
            consumed: true,
            consumedAt: 500,
            pre: fileA,
            post: fileB
          }),
          ambiguous: true
        },
        {
          label: 'consumed, created after mine, post(P) == pre(P) — it never changed P',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 300,
            consumed: true,
            consumedAt: 500,
            pre: fileA,
            post: fileA
          }),
          ambiguous: false
        },
        {
          label: 'consumed, created before mine, pre(P) == post(P)',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 100,
            consumed: true,
            consumedAt: 250,
            pre: fileA,
            post: fileA
          }),
          ambiguous: false
        },
        {
          label: 'consumed, created before mine, post(P) == my pre(P)',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 100,
            consumed: true,
            consumedAt: 250,
            pre: fileB,
            post: fileA
          }),
          ambiguous: false
        },
        {
          label: 'consumed, created before mine, whole window ended before my baseline',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 100,
            consumed: true,
            consumedAt: 150,
            pre: fileA,
            post: fileB
          }),
          ambiguous: false
        },
        {
          label: 'consumed, created before mine, window overlaps my baseline',
          sibling: siblingFrom(mine, PATH, {
            createdAt: 100,
            consumed: true,
            consumedAt: 350,
            pre: fileA,
            post: fileB
          }),
          ambiguous: true
        }
      ];
      for (const row of rows) {
        const first = applyAmbiguityRules(mine, [row.sibling], PATH);
        const second = applyAmbiguityRules(mine, [row.sibling], PATH);
        // Fully deterministic: every consumer of the entangled path evaluates
        // the same sibling set in the same order and reaches the same verdict.
        expect(first).toEqual(second);
        expect(first.ambiguous).toBe(row.ambiguous);
        if (first.ambiguous) {
          expect(first.siblingToolUseId).toBe(row.sibling.toolUseId);
          expect(first.reason.length).toBeGreaterThan(0);
        }
      }
    });

    it('same-state same-file: both calls fail closed with deterministic diagnostics (older completes first)', () => {
      const PATH = 'src/app.ts';
      const fileA = makeFile({ hash: 'a'.repeat(64) });
      const fileB = makeFile({ hash: 'b'.repeat(64) });
      // Two opaque calls on the same file, same pre state; call A starts first.
      const a = makeRecord({ sessionId: 'sess-a', toolUseId: 'call-a', createdAt: 100, files: { [PATH]: fileA } });
      const b = makeRecord({ sessionId: 'sess-b', toolUseId: 'call-b', createdAt: 300, files: { [PATH]: fileA } });
      // B evaluates first: A is still live, its write window has not provably
      // ended → B's path is ambiguous and drops with a diagnostic.
      const bFirst = applyAmbiguityRules(b, [siblingFrom(a, PATH, { consumed: false })], PATH);
      expect(bFirst.ambiguous).toBe(true);
      // A completes first: its consume writes post(P)=fileB and stamps
      // consumedAt past B's baseline. B re-evaluates: consumed, created before
      // mine, pre(P) != post(P), window overlaps my baseline → still ambiguous.
      const aConsumed = siblingFrom(a, PATH, { consumed: true, consumedAt: 400, pre: fileA, post: fileB });
      expect(applyAmbiguityRules(b, [aConsumed], PATH).ambiguous).toBe(true);
      // A, evaluating its own path later, sees B still live → ambiguous too.
      const aSelf = applyAmbiguityRules(a, [siblingFrom(b, PATH, { consumed: false })], PATH);
      expect(aSelf.ambiguous).toBe(true);
      // The failure is loud and specific, never silent and never misattributed.
      if (!bFirst.ambiguous) throw new Error('expected ambiguous');
      expect(bFirst.siblingToolUseId).toBe('call-a');
    });

    it('disjoint writes completed in reverse order: the earlier-completing call fails closed, the later-completing one attributes its own paths', () => {
      const fileA = makeFile({ hash: 'a'.repeat(64) });
      const fileB = makeFile({ hash: 'b'.repeat(64) });
      const fileC = makeFile({ hash: 'c'.repeat(64) });
      // Both tier-2 records cover the whole repo, so each call's path is
      // covered by the other's record — the ambiguity check sees both paths.
      const a = makeRecord({
        sessionId: 'sess-a',
        toolUseId: 'call-a',
        createdAt: 100,
        files: { 'src/a.ts': fileA, 'src/b.ts': fileC }
      });
      const b = makeRecord({
        sessionId: 'sess-b',
        toolUseId: 'call-b',
        createdAt: 300,
        files: { 'src/a.ts': fileC, 'src/b.ts': fileB }
      });
      // B completes first, while A is still live. Evaluating src/b.ts, B sees
      // A's unprovably-ended window → ambiguous: B drops its own real change
      // with a diagnostic rather than risk attributing a race.
      expect(applyAmbiguityRules(b, [siblingFrom(a, 'src/b.ts', { consumed: false })], 'src/b.ts').ambiguous).toBe(
        true
      );
      // When A completes and evaluates src/a.ts, B is consumed with post(P) =
      // pre(P) for that path — B provably never changed it → not ambiguous,
      // and A attributes its own path.
      const bConsumed = siblingFrom(b, 'src/a.ts', { consumed: true, consumedAt: 350, pre: fileC, post: fileC });
      expect(applyAmbiguityRules(a, [bConsumed], 'src/a.ts').ambiguous).toBe(false);
    });

    it('a sequential third-party writer between two opaque calls never makes the second call ambiguous', async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const fileA = makeFile({ hash: 'a'.repeat(64) });
        const fileB = makeFile({ hash: 'b'.repeat(64) });
        // Call A ran, an Edit ran, then call B ran — strictly sequential.
        const a = makeRecord({
          sessionId: 'sess-a',
          toolUseId: 'call-a',
          createdAt: now - 4000,
          files: { 'src/app.ts': fileA }
        });
        const b = makeRecord({
          sessionId: 'sess-b',
          toolUseId: 'call-b',
          createdAt: now - 2000,
          files: { 'src/app.ts': fileB }
        });
        // A is consumed with pre != post, but its whole window ended before
        // B's baseline (consumedAt <= B.createdAt) → B is not ambiguous. A
        // naive post-vs-my-pre test would flag this; the table does not.
        const aConsumed = siblingFrom(a, 'src/app.ts', {
          consumed: true,
          consumedAt: now - 3500,
          pre: fileA,
          post: fileB
        });
        expect(applyAmbiguityRules(b, [aConsumed], 'src/app.ts').ambiguous).toBe(false);
        // The Edit's activity entry finished before B's window start — the
        // boundary check consults it and never flags it.
        const entry: ActivityEntry = {
          sessionId: 'sess-edit',
          toolUseId: 'tu-edit-seq',
          kind: 'Edit',
          startedAt: now - 5000,
          finishedAt: now - 3000,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex('v1'), postHash: sha256Hex('v2') }]
        };
        appendActivityEntry(repo.root, entry);
        // The consult's `now` must be the consult time, not the fixture's
        // earlier `now`: the entry file's mtime is (append time, now+ε), and
        // a stale now would put that mtime past the `now + 1` window top and
        // drop the just-written entry as future-clock.
        const consulted = activityEntriesCovering(
          repo.root,
          'src/app.ts',
          now - 2500,
          Date.now(),
          DEFAULT_SNAPSHOT_BUDGETS
        );
        expect(consulted).toEqual([entry]);
      });
    });

    it('a gapped unconsumed sibling covers every path — truncated records fail closed', () => {
      const PATH = 'src/app.ts';
      const mine = makeRecord({ createdAt: 200, files: { [PATH]: makeFile({ hash: 'a'.repeat(64) }) } });
      const gapped = siblingFrom(mine, PATH, { coverageGap: true, consumed: false });
      const verdict = applyAmbiguityRules(mine, [gapped], PATH);
      expect(verdict.ambiguous).toBe(true);
      if (!verdict.ambiguous) throw new Error('expected ambiguous');
      // The gapped sibling's coverage is unknowable, so it covers this path
      // even though its record never listed it — the "truncated sibling
      // becomes invisible" hole stays closed.
      expect(verdict.siblingToolUseId).toBe(gapped.toolUseId);
    });
  });

  describe('G. the activity-log interleaving boundary', () => {
    /**
     * The shared interleaving scenario: a real repo with a committed file P, a
     * stored pre record for an opaque Bash call, the post state on disk, and
     * an activity entry appended by the fixture. Drives the real post handler
     * with fake executors so the outcome is the boundary check's, not the
     * CLI's.
     */
    async function runInterleaved(
      sessionId: string,
      tuId: string,
      opts: { v1: string; v2: string; entry: ActivityEntry; afterAppend?: (repoRoot: string) => void }
    ): Promise<{ block: string | null; notes: string[] }> {
      const repo = createTestRepo();
      try {
        const { v1, v2, entry, afterAppend } = opts;
        const now = Date.now();
        writeFile(repo.root, 'src/app.ts', v2);
        const store = createSnapshotStore(new Logger());
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: now - 1000,
            files: {
              'src/app.ts': makeFile({
                hash: sha256Hex(v1),
                size: v1.length,
                mtimeNs: BigInt(BASE_NOW) * 1_000_000n + 3n,
                capturedAt: now - 2000
              })
            }
          })
        );
        appendActivityEntry(repo.root, entry);
        if (afterAppend) afterAppend(repo.root);
        const { executors } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts') ? [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })] : [],
          drift: () => [driftRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const { logger, notes } = noteCapturingLogger();
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const raw = await handler(input as never, { logger });
        return { block: toResult(raw), notes };
      } finally {
        repo.cleanup();
      }
    }

    it("never flags an entry fully stamped before the path's per-file capturedAt — sequential edits keep attributing", async () => {
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-neverflag',
        toolUseId: 'tu-edit-prior',
        kind: 'Edit',
        startedAt: now - 5000,
        finishedAt: now - 3000,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex('v0'), postHash: sha256Hex(v1) }]
      };
      const consulted: ActivityEntry[][] = [];
      const { block, notes } = await runInterleaved('sess-interleave-neverflag', 'tu-bash-neverflag', {
        v1,
        v2,
        entry,
        // The consult's windowStart precedes the pre-read (now-2500 vs
        // capturedAt now-2000): the entry's mtime is in-window and its
        // finishedAt (now-3000) precedes the window start, so the consult
        // returns it — and the stamp comparison then never-flags it. The
        // `now` param is Date.now() at consult time: the entry file was just
        // appended (mtime now+ε), and a stale now would drop it as future
        // clock past the window top.
        afterAppend: (repoRoot) => {
          consulted.push(
            activityEntriesCovering(repoRoot, 'src/app.ts', now - 2500, Date.now(), DEFAULT_SNAPSHOT_BUDGETS)
          );
        }
      });
      expect(consulted).toEqual([[entry]]);
      // The edit wrote and touched before P's baseline — its change is baked
      // into my pre and can never contaminate my post-diff.
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(false);
    });

    it('judges the walk-tail sub-window against the per-file capturedAt, never the record-wide createdAt — equal baselines skip', async () => {
      // The edit's write lands after P's pre-read (capturedAt) yet its whole
      // lifecycle ends before the record is written (createdAt): a check
      // against the record-wide createdAt would never-flag it (finishedAt <=
      // createdAt); the per-file capturedAt keeps it evaluated. Its baselines
      // equal mine (the edit read v1, my pre, and its touch read v2, the
      // current state) → skip: the edit's change is attributed by the edit's
      // touch, never silently to me.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-walktail',
        toolUseId: 'tu-edit-walktail',
        kind: 'Edit',
        startedAt: now - 2500,
        finishedAt: now - 1500, // between capturedAt (now-2000) and createdAt (now-1000)
        paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: sha256Hex(v2) }]
      };
      const { block, notes } = await runInterleaved('sess-interleave-walktail', 'tu-bash-walktail', { v1, v2, entry });
      expect(block).toBeNull();
      expect(notes.some((n) => n.includes('covered-by-edit'))).toBe(true);
    });

    it('the walk-tail sub-window with unequal baselines bounded-doubles', async () => {
      // Same timing as above, but the edit read the state AFTER the Bash call
      // wrote it: preHash != my pre → skip is impossible, and the call
      // attributes its own residual with the absorbed-double note — the
      // edit's segment is absorbed, nothing is dropped.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const v3 = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-walktail-unequal',
        toolUseId: 'tu-edit-walktail-u',
        kind: 'Edit',
        startedAt: now - 1800,
        finishedAt: now - 1500,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex(v2), postHash: sha256Hex(v3) }]
      };
      const { block, notes } = await runInterleaved('sess-interleave-walktail-unequal', 'tu-bash-walktail-u', {
        v1,
        v2: v3,
        entry
      });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(true);
    });

    it('Bash-first ordering: the Bash residual attributes via bounded-double, the edit segment absorbed', async () => {
      // Bash writes v1 → v2, then an Edit reads v2, writes v3, and completes
      // before the Bash compare: the edit's pre-hook predates nothing — it
      // read the post-Bash state, so preHash != my pre. The Bash call's
      // residual (v1 → v3) attributes with the diagnostic; the edit's segment
      // is absorbed; nothing is dropped.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v3 = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-bashfirst',
        toolUseId: 'tu-edit-bashfirst',
        kind: 'Edit',
        startedAt: now - 800,
        finishedAt: now - 500,
        paths: [
          {
            path: 'src/app.ts',
            preHash: sha256Hex('export const a = 1;\nexport const b = 2;\n'),
            postHash: sha256Hex(v3)
          }
        ]
      };
      const { block, notes } = await runInterleaved('sess-interleave-bashfirst', 'tu-bash-bashfirst', {
        v1,
        v2: v3,
        entry
      });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(true);
    });

    it('a failed pre-hook read (no preHash) makes skip impossible — bounded-double, the fail-safe direction', async () => {
      // The edit's pre-hook could not read P (preHash null): the never-flag
      // rule needs both stamps, so the boundary can never resolve as clean —
      // the call attributes its residual with the diagnostic. Failing toward
      // the double is the safe direction: the edit's touch may still have read
      // the state its write started from.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-prefail',
        toolUseId: 'tu-edit-prefail',
        kind: 'Edit',
        startedAt: now - 1800,
        finishedAt: now - 1500,
        paths: [{ path: 'src/app.ts', preHash: null, postHash: sha256Hex(v2) }]
      };
      const { block, notes } = await runInterleaved('sess-interleave-prefail', 'tu-bash-prefail', { v1, v2, entry });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(true);
    });

    it('an unfinished entry fails closed — its write may still land', async () => {
      // The edit's entry is in flight (finishedAt null): its write may land at
      // any moment, so P drops with the interleaved-tool diagnostic — the
      // attribution that never fires is the attribution that never lies.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-unfinished',
        toolUseId: 'tu-edit-unfinished',
        kind: 'Edit',
        startedAt: now - 500,
        finishedAt: null,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: null }]
      };
      const { block, notes } = await runInterleaved('sess-interleave-unfinished', 'tu-bash-unfinished', {
        v1,
        v2,
        entry
      });
      expect(block).toBeNull();
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(true);
    });

    it('an unfinished entry older than the short TTL is pruned — a capture after the prune attributes cleanly', async () => {
      // The stale unfinished entry is swept away; the same call re-run after
      // the sweep finds no interleaved edit and attributes normally.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-interleave-ttlprune',
        toolUseId: 'tu-edit-ttlprune',
        kind: 'Edit',
        startedAt: now - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 60_000,
        finishedAt: null,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: null }]
      };
      const pruned: number[] = [];
      const { block, notes } = await runInterleaved('sess-interleave-ttlprune', 'tu-bash-ttlprune', {
        v1,
        v2,
        entry,
        afterAppend: (repoRoot) => {
          // Age the just-appended entry file past the unfinished-entry TTL —
          // the prune is file-mtime-based (utimesSync takes seconds).
          const stale = join(
            queueRoot(repoRoot),
            'activity-log',
            `${sanitizeSessionId('sess-interleave-ttlprune')}__${sanitizeSessionId('tu-edit-ttlprune')}.json`
          );
          const oldSeconds = (now - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 60_000) / 1000;
          utimesSync(stale, oldSeconds, oldSeconds);
          // The sweep-read margin skips files written within the last 5s, and
          // the activity prune only visits repos named by readable records —
          // age the pre-walk record's file past the margin too, or the repo
          // is invisible to the prune (its createdAt stays in-TTL and live).
          const preFile = join(
            sessionDir('sess-interleave-ttlprune'),
            'snapshots',
            `${sanitizeSessionId('tu-bash-ttlprune')}.json`
          );
          utimesSync(preFile, (now - 60_000) / 1000, (now - 60_000) / 1000);
          pruned.push(createSnapshotStore(new Logger()).sweep(now).activityEntries);
        }
      });
      expect(pruned).toEqual([1]);
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(false);
    });

    it('a duplicate PostToolUse racing the O_EXCL tombstone yields exactly one attribution', async () => {
      // Two deliveries of the same PostToolUse race: both compare, but only
      // one can create the consumption tombstone (O_EXCL) — the winner
      // attributes, the loser finds the tombstone and no-ops. The record is
      // consumed exactly once no matter which delivery wins the race.
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const repo = createTestRepo();
      try {
        writeFile(repo.root, 'src/app.ts', v2);
        createSnapshotStore(new Logger()).write(
          makeRecord({
            sessionId: 'sess-interleave-race',
            toolUseId: 'tu-bash-race',
            repoRoot: repo.root,
            createdAt: now - 1000,
            files: {
              'src/app.ts': makeFile({
                hash: sha256Hex(v1),
                size: v1.length,
                mtimeNs: BigInt(BASE_NOW) * 1_000_000n + 4n,
                capturedAt: now - 2000
              })
            }
          })
        );
        const { executors, calls } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts') ? [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })] : [],
          drift: () => [driftRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const logger = new Logger();
        const input = postInput({
          session_id: 'sess-interleave-race',
          cwd: repo.root,
          tool_use_id: 'tu-bash-race',
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const [rawA, rawB] = await Promise.all([
          handler(input as never, { logger }),
          handler(input as never, { logger })
        ]);
        const blocks = [toResult(rawA), toResult(rawB)].filter((b) => b !== null);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toContain('## billing/checkout-request-flow');
        expect(calls.list).toBe(1);
      } finally {
        repo.cleanup();
      }
    });

    it('the mtimeNs filter is sound: a same-size, same-coarse-mtime change is re-hashed and caught', () => {
      // The (size, mtimeNs) pair is the post-side cheap filter — but only when
      // the recorded mtime carries a non-zero sub-second part. On a
      // second-granularity clock a same-second write does not advance mtime,
      // so a matching pair with a zero sub-second part must re-read the file:
      // the change is caught, never skipped.
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const b = 2;\n';
      const coarse = BigInt(BASE_NOW) * 1_000_000n; // zero sub-second part — a coarse clock
      const record = makeRecord({
        repoRoot: '/repo',
        files: {
          'src/app.ts': makeFile({ hash: sha256Hex(v1), size: v1.length, mtimeNs: coarse, capturedAt: BASE_NOW })
        }
      });
      const post = new Map<string, SnapshotFile>([
        ['src/app.ts', makeFile({ hash: sha256Hex(v2), size: v2.length, mtimeNs: coarse, capturedAt: BASE_NOW })]
      ]);
      let reads = 0;
      const stat: StatFile = () => ({ size: v1.length, mtimeNs: coarse });
      const read: ReadFile = () => {
        reads += 1;
        return Buffer.from(v2, 'utf8');
      };
      const result = compareSnapshot({
        record,
        post,
        postGaps: [],
        budgets: DEFAULT_SNAPSHOT_BUDGETS,
        stat,
        read,
        wallStart: BASE_NOW,
        wallClock: () => BASE_NOW
      });
      expect(result.attributions.get('src/app.ts')?.kind).toBe('changed');
      expect(reads).toBe(1);
    });

    it('the mtimeNs skip is sound on a fine clock — no re-read on a true no-op', () => {
      // With a non-zero sub-second part, a matching (size, mtimeNs) pair
      // proves non-change: the file is not re-read (the injected read throws
      // if it is), and the path is not attributed.
      const v1 = 'export const a = 1;\n';
      const fine = BigInt(BASE_NOW) * 1_000_000n + 1n; // non-zero sub-second part — a fine clock
      const record = makeRecord({
        repoRoot: '/repo',
        files: { 'src/app.ts': makeFile({ hash: sha256Hex(v1), size: v1.length, mtimeNs: fine, capturedAt: BASE_NOW }) }
      });
      let reads = 0;
      const stat: StatFile = () => ({ size: v1.length, mtimeNs: fine });
      const read: ReadFile = () => {
        reads += 1;
        throw new Error('unexpected read: the cheap filter must have skipped');
      };
      const result = compareSnapshot({
        record,
        post: new Map<string, SnapshotFile>(),
        postGaps: [],
        budgets: DEFAULT_SNAPSHOT_BUDGETS,
        stat,
        read,
        wallStart: BASE_NOW,
        wallClock: () => BASE_NOW
      });
      expect(result.attributions.has('src/app.ts')).toBe(false);
      expect(reads).toBe(0);
    });
  });

  describe('H. wave-A hardening — cost floor, deferral notes, visible diagnostics', () => {
    it('a heavily fragmented generation exceeds the diff cost floor: whole-file fallback, record still consumed', async () => {
      // A full 300-line reorder displaces every line — the exact-regime diff
      // exceeds its 256-edit cost floor. The compare must not abort with an
      // unconsumed record: whole-file scope plus a diagnostic, exactly like a
      // zero-hunk collision, and the window closes normally.
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-costfloor';
        const tuId = 'tu-costfloor-1';
        const preContent = fileLines(300);
        const postContent = `${preContent.trimEnd().split('\n').reverse().join('\n')}\n`;
        writeFile(repo.root, 'src/gen.ts', preContent);
        gitAddCommit(repo.root, 'add gen.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'python3 scripts/gen.py' }
        });
        await pre(input as never, { logger });
        writeFile(repo.root, 'src/gen.ts', postContent);
        const { executors, calls } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/gen.ts')
              ? [porcelainRow({ name: SPAN_A, path: 'src/gen.ts', start: 1, end: 300 })]
              : [],
          drift: () => [driftRow({ name: SPAN_A, path: 'src/gen.ts', start: 1, end: 300 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // Whole-file scope surfaces the span across the whole reordered file.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(calls.fix).toBe(1);
        // The belt-and-braces contract: the record is consumed with a gap,
        // never left live to poison a later sibling's ambiguity read.
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('an unconsumed orphan sibling defers attribution with a transcript-visible note; removing the orphan lets the next capture attribute', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-defer';
        const tuId = 'tu-defer-1';
        const orphanSession = 'sess-lifecycle-orphan';
        const orphanTu = 'tu-orphan-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        // Both calls captured src/app.ts at the same pre state; the orphan's
        // PostToolUse never arrives, so its write window has not provably
        // ended and mine must fail closed (the existing live-record contract).
        store.write(
          makeRecord({
            sessionId: orphanSession,
            toolUseId: orphanTu,
            repoRoot: repo.root,
            createdAt: BASE_NOW - 1000,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: BASE_NOW,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        const { executors, calls } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts')
              ? [porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 1, end: 10 })]
              : [],
          drift: () => [driftRow({ name: SPAN_A, path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        // The deferral is transcript-visible: the model loop sees WHY the
        // path produced no attribution — a logger-only warn is invisible to it.
        expect(block).toContain('attribution deferred: src/app.ts');
        expect(block).toContain(`unconsumed sibling ${orphanTu}`);
        expect(block).toContain(`(session ${orphanSession})`);
        expect(block).not.toContain('## billing/checkout-request-flow');
        expect(calls.fix).toBe(0);
        // The orphan is removed (session teardown); a fresh capture of the
        // same call now attributes cleanly.
        purgeSessions([orphanSession, sessionId]);
        flushPurgedSessions();
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: BASE_NOW,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        const raw2 = await handler(input as never, { logger });
        const block2 = toResult(raw2);
        expect(block2).toContain('## billing/checkout-request-flow');
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('a decided-but-recordless PostToolUse surfaces a transcript-visible note alongside the static fallback', async () => {
      // The pre-walk failed open (or never ran): the Post side must explain
      // the missing snapshot attribution in the transcript, not just warn on
      // a logger the model loop never reads. The static path still runs.
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-norecord';
        const tuId = 'tu-norecord-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const { executors } = makeExecutors();
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const raw = await handler(input as never, { logger });
        const block = toResult(raw);
        expect(block).toContain('snapshot record unavailable');
        expect(block).toContain('were not snapshot-attributed');
      });
    });

    it('post-side wall-budget exhaustion is transcript-visible: the note appears, no git-span block is produced', async () => {
      // A zero-second wall budget with a post walk that cannot complete in a
      // single millisecond (40 files of ~800 KiB force real hashing time):
      // the compare exhausts before the first scope, nothing is attributed,
      // and the block explains itself instead of silently disappearing.
      const saved = process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
      process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = '0';
      try {
        await withRepo(async (repo) => {
          const sessionId = 'sess-lifecycle-budget';
          const tuId = 'tu-budget-1';
          const payload = 'x'.repeat(800 * 1024);
          for (let i = 0; i < 40; i += 1) writeFile(repo.root, `src/gen${i}.ts`, payload);
          gitAddCommit(repo.root, 'add generated sources');
          const logger = new Logger();
          const pre = createSnapshotPreHook();
          const input = preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'python3 scripts/gen.py' }
          });
          await pre(input as never, { logger });
          // One byte flips in the first file — a real write to attribute.
          writeFile(repo.root, 'src/gen0.ts', `${payload}y`);
          const { executors, calls } = makeExecutors();
          const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
          const raw = await handler(input as never, { logger });
          const block = toResult(raw);
          expect(block).toContain('post-side wall budget was exhausted before any file could be attributed');
          expect(block).not.toContain('## billing');
          expect(calls.fix).toBe(0);
          // Fail-closed: the window still closes with the record consumed.
          expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
        });
      } finally {
        if (saved === undefined) delete process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
        else process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = saved;
      }
    });
  });
});
