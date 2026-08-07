/**
 * Acceptance checks for the Claude harness snapshot lifecycle (card
 * main-213; mechanism rewritten to tree-SHA snapshots by card main-228): the
 * full PreToolUse → PostToolUse / PostToolUseFailure → SessionEnd flow
 * through the committed adapter modules (src/claude/snapshot.ts,
 * src/claude/post-tool-use.ts, src/claude/post-tool-use-failure.ts,
 * src/claude/session-end.ts) and the shared store/harness/activity-log
 * contract.
 *
 * Fixtures that need the real `git span` CLI are gated with
 * `it.skipIf(!hasGitSpan)` so they fail visibly when the CLI is missing,
 * mirroring porcelain-contract.test.ts.
 *
 * The lifecycle contract, per the plan:
 *
 * - PreToolUse classifies the command and, when it decides a snapshot, takes
 *   the private write-tree capture and persists the tree-SHA record for
 *   (session_id, tool_use_id) — a write-only hook that never returns a
 *   signal, fails open without a record when uncorrelatable, and writes
 *   nothing for provably read-only commands.
 * - PostToolUse finds the record, captures the post side in the same mode,
 *   compares tree against tree, resolves interleaved edits against the
 *   activity log, and touches through the observed-write scope list.
 *   Formatter runs, embedded scripts, generations, deletes, and renames are
 *   all attributed; a dirty baseline never surfaces; a duplicate delivery
 *   consumes exactly once; a record with no PostToolUse stays live as
 *   ambiguity evidence.
 * - PostToolUseFailure runs the same comparison whenever a record exists —
 *   `is_interrupt` gates nothing. Mutated-nothing failures produce no
 *   candidates but still close the window; record-less failures discard with a
 *   warn.
 * - Deleted paths surface through dead anchors: `git span list --porcelain`
 *   reaches them (exit 0), `git span drift` reports them as debt, and `--fix`
 *   leaves them alone for a human to reconcile.
 * - SessionEnd and the TTL sweep reclaim records, tombstones, per-call
 *   capture artifacts, activity entries, and index entries.
 * - The concurrency ambiguity table (8 rows) and the activity-log interleaving
 *   four outcomes (never-flag, skip, bounded-double, unfinished fail-closed)
 *   resolve deterministic orderings and racing duplicates.
 *
 * Clock fixtures use real `Date.now()` values (the pre capture stamps
 * createdAt with the real clock, and the activity-log consult reads
 * entry-file mtimes, which are real writes); interleaving entry stamps are
 * computed relative to the captured record's own createdAt.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  type AmbiguityBaseline,
  applyAmbiguityRules,
  classifyCommandForSnapshot,
  DEFAULT_SNAPSHOT_BUDGETS,
  recordHasPathCoverageGap,
  type SiblingSnapshot,
  type SnapshotRecord
} from '../../src/common/snapshot-core.js';
import { resolveSnapshotBudgets } from '../../src/common/snapshot-harness.js';
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

/**
 * A sibling's per-path view for the ambiguity table fixtures. In v2 the
 * harness derives these hashes on demand from the sibling's recorded tree
 * SHAs (hashTreePath over its private object dir) — the fixtures hand the
 * table the same derived shape directly.
 */
function siblingView(overrides: Partial<SiblingSnapshot> = {}): SiblingSnapshot {
  return {
    sessionId: 'sess-lifecycle',
    toolUseId: 'tu-bash-1',
    createdAt: 200,
    consumed: false,
    consumedAt: null,
    coverageGap: false,
    pre: null,
    post: null,
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
          version: 2,
          sessionId,
          toolUseId: tuId,
          repoRoot: repo.root,
          consumed: false,
          consumedAt: null
        });
        // The capture is one private write-tree over the whole repo: the
        // record persists only the tree SHA (never a per-path map), and a
        // non-degraded capture carries no stat-only evidence.
        expect(record.treeSha).toMatch(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
        expect(record.statOnly).toBeUndefined();
        expect(record.gaps).toEqual([]);
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
        store.write(makeRecord({ sessionId, toolUseId: tuId, repoRoot: repo.root, createdAt: BASE_NOW }));
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
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const pre = createSnapshotPreHook();
        await pre(
          preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger }
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
        // "Reconciled" is withheld while drift remains — nothing was
        // reconciled — so the CLI prints the "Updated ... remain drifted"
        // form instead (packages/git-span/src/cli/drift_output.rs).
        expect(human).toContain('anchor remains drifted');
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
        store.write(makeRecord({ sessionId, toolUseId: 'tu-end-1', repoRoot: repo.root, createdAt: now }));
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
            createdAt: staleCreatedAt
          })
        );
        store.write(
          makeRecord({
            sessionId: 'sess-lifecycle-ttl-live',
            toolUseId: 'tu-ttl-live',
            repoRoot: repo.root,
            createdAt: now
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
            createdAt: now
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
      const fileA = { hash: 'a'.repeat(64) };
      const fileB = { hash: 'b'.repeat(64) };
      const mine: AmbiguityBaseline = { createdAt: 200, preHash: fileA.hash };
      // (mine created at T1=200; the table is read top-down per sibling.)
      const rows: { label: string; sibling: SiblingSnapshot; ambiguous: boolean }[] = [
        {
          label: 'unconsumed, created after mine',
          sibling: siblingView({ createdAt: 300, consumed: false }),
          ambiguous: true
        },
        {
          label: 'unconsumed, created before mine',
          sibling: siblingView({ createdAt: 100, consumed: false }),
          ambiguous: true
        },
        {
          label: 'consumed, created after mine, post(P) != pre(P)',
          sibling: siblingView({
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
          sibling: siblingView({
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
          sibling: siblingView({
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
          sibling: siblingView({
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
          sibling: siblingView({
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
          sibling: siblingView({
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
      const fileA = { hash: 'a'.repeat(64) };
      const fileB = { hash: 'b'.repeat(64) };
      // Two opaque calls on the same file, same pre state; call A starts first.
      const a: AmbiguityBaseline = { createdAt: 100, preHash: fileA.hash };
      const b: AmbiguityBaseline = { createdAt: 300, preHash: fileA.hash };
      const siblingA = (overrides: Partial<SiblingSnapshot>): SiblingSnapshot =>
        siblingView({ sessionId: 'sess-a', toolUseId: 'call-a', createdAt: 100, pre: fileA, ...overrides });
      // B evaluates first: A is still live, its write window has not provably
      // ended → B's path is ambiguous and drops with a diagnostic.
      const bFirst = applyAmbiguityRules(b, [siblingA({ consumed: false })], PATH);
      expect(bFirst.ambiguous).toBe(true);
      // A completes first: its consume writes post(P)=fileB and stamps
      // consumedAt past B's baseline. B re-evaluates: consumed, created before
      // mine, pre(P) != post(P), window overlaps my baseline → still ambiguous.
      const aConsumed = siblingA({ consumed: true, consumedAt: 400, post: fileB });
      expect(applyAmbiguityRules(b, [aConsumed], PATH).ambiguous).toBe(true);
      // A, evaluating its own path later, sees B still live → ambiguous too.
      const aSelf = applyAmbiguityRules(
        a,
        [siblingView({ sessionId: 'sess-b', toolUseId: 'call-b', createdAt: 300, consumed: false, pre: fileA })],
        PATH
      );
      expect(aSelf.ambiguous).toBe(true);
      // The failure is loud and specific, never silent and never misattributed.
      if (!bFirst.ambiguous) throw new Error('expected ambiguous');
      expect(bFirst.siblingToolUseId).toBe('call-a');
    });

    it('disjoint writes completed in reverse order: the earlier-completing call fails closed, the later-completing one attributes its own paths', () => {
      const fileB = { hash: 'b'.repeat(64) };
      const fileC = { hash: 'c'.repeat(64) };
      // Both write-tree captures cover the whole repo, so each call's path is
      // covered by the other's record — the ambiguity check sees both paths.
      // (A's pre for src/b.ts is fileC; B's pre for src/a.ts is fileC too.)
      const a: AmbiguityBaseline = { createdAt: 100, preHash: 'a'.repeat(64) };
      const b: AmbiguityBaseline = { createdAt: 300, preHash: fileB.hash };
      // B completes first, while A is still live. Evaluating src/b.ts, B sees
      // A's unprovably-ended window → ambiguous: B drops its own real change
      // with a diagnostic rather than risk attributing a race.
      expect(
        applyAmbiguityRules(
          b,
          [siblingView({ sessionId: 'sess-a', toolUseId: 'call-a', createdAt: 100, consumed: false, pre: fileC })],
          'src/b.ts'
        ).ambiguous
      ).toBe(true);
      // When A completes and evaluates src/a.ts, B is consumed with post(P) =
      // pre(P) for that path — B provably never changed it → not ambiguous,
      // and A attributes its own path.
      const bConsumed = siblingView({
        sessionId: 'sess-b',
        toolUseId: 'call-b',
        createdAt: 300,
        consumed: true,
        consumedAt: 350,
        pre: fileC,
        post: fileC
      });
      expect(applyAmbiguityRules(a, [bConsumed], 'src/a.ts').ambiguous).toBe(false);
    });

    it('a sequential third-party writer between two opaque calls never makes the second call ambiguous', async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const fileA = { hash: 'a'.repeat(64) };
        const fileB = { hash: 'b'.repeat(64) };
        // Call A ran, an Edit ran, then call B ran — strictly sequential.
        const b: AmbiguityBaseline = { createdAt: now - 2000, preHash: fileB.hash };
        // A is consumed with pre != post, but its whole window ended before
        // B's baseline (consumedAt <= B.createdAt) → B is not ambiguous. A
        // naive post-vs-my-pre test would flag this; the table does not.
        const aConsumed = siblingView({
          sessionId: 'sess-a',
          toolUseId: 'call-a',
          createdAt: now - 4000,
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
      const mine: AmbiguityBaseline = { createdAt: 200, preHash: 'a'.repeat(64) };
      const gapped = siblingView({ toolUseId: 'tu-gapped-sibling', coverageGap: true, consumed: false });
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
     * The shared interleaving scenario: a real repo with a committed file P at
     * v1, a REAL pre capture for an opaque Bash call (the write-tree record —
     * its createdAt is the baseline every entry stamp is computed against),
     * the post state on disk, and an activity entry appended by the fixture.
     * Drives the real post handler with fake executors so the outcome is the
     * boundary check's, not the CLI's. The entry is built from the record's
     * own createdAt because the capture stamps it with the real clock.
     */
    async function runInterleaved(
      sessionId: string,
      tuId: string,
      opts: {
        v1: string;
        v2: string;
        entry: (recordCreatedAt: number) => ActivityEntry;
        afterAppend?: (repoRoot: string, recordCreatedAt: number) => void;
      }
    ): Promise<{ block: string | null; notes: string[] }> {
      const repo = createTestRepo();
      try {
        const { v1, v2, entry, afterAppend } = opts;
        writeFile(repo.root, 'src/app.ts', v1);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await createSnapshotPreHook()(input as never, { logger });
        const found = createSnapshotStore(logger).find(sessionId, tuId);
        if (found === null || found === 'tombstoned') throw new Error('pre capture failed');
        writeFile(repo.root, 'src/app.ts', v2);
        appendActivityEntry(repo.root, entry(found.createdAt));
        if (afterAppend) afterAppend(repo.root, found.createdAt);
        // The consult's window top is the handler's own Date.now(): give the
        // clock a beat so an entry stamped `createdAt + 1` is provably in the
        // past by the time the handler compares.
        await new Promise((resolve) => setTimeout(resolve, 10));
        const { executors } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts') ? [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })] : [],
          drift: () => [driftRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const { logger: capLogger, notes } = noteCapturingLogger();
        const raw = await handler(input as never, { logger: capLogger });
        return { block: toResult(raw), notes };
      } finally {
        repo.cleanup();
      }
    }

    it("never flags an entry fully stamped before the record's createdAt — sequential edits keep attributing", async () => {
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const { block, notes } = await runInterleaved('sess-interleave-neverflag', 'tu-bash-neverflag', {
        v1,
        v2,
        // The edit's whole lifecycle ended before my capture wrote the record
        // (finishedAt ≤ createdAt): its change is baked into my pre tree and
        // can never contaminate my post-diff — attribute without a note.
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-neverflag',
          toolUseId: 'tu-edit-prior',
          kind: 'Edit',
          startedAt: createdAt - 5000,
          finishedAt: createdAt - 3000,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex('v0'), postHash: sha256Hex(v1) }]
        })
      });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(false);
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(false);
    });

    it('an in-window edit whose baselines equal mine skips — covered-by-edit, never silently attributed to me', async () => {
      // The edit finished after my capture wrote the record, so the boundary
      // must evaluate it. Its baselines equal mine (the edit read v1, my pre,
      // and its touch read v2, the current state) → skip: the edit's change
      // is attributed by the edit's own touch, never silently to me. (v1 of
      // the mechanism kept a per-file capturedAt sub-window here; the v2
      // capture is one atomic write-tree, so the record's createdAt is the
      // only baseline instant.)
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const { block, notes } = await runInterleaved('sess-interleave-walktail', 'tu-bash-walktail', {
        v1,
        v2,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-walktail',
          toolUseId: 'tu-edit-walktail',
          kind: 'Edit',
          startedAt: createdAt - 500,
          finishedAt: createdAt + 1,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: sha256Hex(v2) }]
        })
      });
      expect(block).toBeNull();
      expect(notes.some((n) => n.includes('covered-by-edit'))).toBe(true);
    });

    it('an in-window edit with unequal baselines bounded-doubles', async () => {
      // The edit read the state AFTER the Bash call wrote it: preHash != my
      // pre → skip is impossible, and the call attributes its own residual
      // with the absorbed-double note — the edit's segment is absorbed,
      // nothing is dropped.
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const v3 = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
      const { block, notes } = await runInterleaved('sess-interleave-walktail-unequal', 'tu-bash-walktail-u', {
        v1,
        v2: v3,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-walktail-unequal',
          toolUseId: 'tu-edit-walktail-u',
          kind: 'Edit',
          startedAt: createdAt - 300,
          finishedAt: createdAt + 1,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(v2), postHash: sha256Hex(v3) }]
        })
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
      const v1 = 'export const a = 1;\n';
      const v3 = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
      const { block, notes } = await runInterleaved('sess-interleave-bashfirst', 'tu-bash-bashfirst', {
        v1,
        v2: v3,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-bashfirst',
          toolUseId: 'tu-edit-bashfirst',
          kind: 'Edit',
          startedAt: createdAt - 100,
          finishedAt: createdAt + 2,
          paths: [
            {
              path: 'src/app.ts',
              preHash: sha256Hex('export const a = 1;\nexport const b = 2;\n'),
              postHash: sha256Hex(v3)
            }
          ]
        })
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
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const { block, notes } = await runInterleaved('sess-interleave-prefail', 'tu-bash-prefail', {
        v1,
        v2,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-prefail',
          toolUseId: 'tu-edit-prefail',
          kind: 'Edit',
          startedAt: createdAt - 300,
          finishedAt: createdAt + 1,
          paths: [{ path: 'src/app.ts', preHash: null, postHash: sha256Hex(v2) }]
        })
      });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(true);
    });

    it('an unfinished entry fails closed — its write may still land', async () => {
      // The edit's entry is in flight (finishedAt null): its write may land at
      // any moment, so P drops with the interleaved-tool diagnostic — the
      // attribution that never fires is the attribution that never lies.
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const { block, notes } = await runInterleaved('sess-interleave-unfinished', 'tu-bash-unfinished', {
        v1,
        v2,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-unfinished',
          toolUseId: 'tu-edit-unfinished',
          kind: 'Edit',
          startedAt: createdAt - 500,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: null }]
        })
      });
      expect(block).toBeNull();
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(true);
    });

    it('an unfinished entry older than the short TTL is pruned — a capture after the prune attributes cleanly', async () => {
      // The stale unfinished entry is swept away; the same call re-run after
      // the sweep finds no interleaved edit and attributes normally.
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const pruned: number[] = [];
      const { block, notes } = await runInterleaved('sess-interleave-ttlprune', 'tu-bash-ttlprune', {
        v1,
        v2,
        entry: (createdAt) => ({
          sessionId: 'sess-interleave-ttlprune',
          toolUseId: 'tu-edit-ttlprune',
          kind: 'Edit',
          startedAt: createdAt - DEFAULT_SNAPSHOT_BUDGETS.unfinishedEntryTtlMs - 60_000,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: null }]
        }),
        afterAppend: (repoRoot) => {
          const now = Date.now();
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
          // age the pre-capture record's file past the margin too, or the repo
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
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const repo = createTestRepo();
      try {
        writeFile(repo.root, 'src/app.ts', v1);
        gitAddCommit(repo.root, 'add app.ts');
        const preLogger = new Logger();
        await createSnapshotPreHook()(
          preInput({
            session_id: 'sess-interleave-race',
            cwd: repo.root,
            tool_use_id: 'tu-bash-race',
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger: preLogger }
        );
        writeFile(repo.root, 'src/app.ts', v2);
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
  });

  describe('H. wave-A hardening — cost floor, deferral notes, visible diagnostics', () => {
    it('a heavily fragmented generation attributes through real git hunks, record still consumed', async () => {
      // A full 300-line reorder displaces every line. The v1 exact-regime
      // Myers walk needed a cost floor here; git's own diff has no such
      // cliff — the `-U0` hunks simply cover the whole displaced body, the
      // observed ranges intersect the span row, and the window closes
      // normally with the record consumed.
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
        // The hunk-derived ranges cover the reordered body and surface the span.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(calls.fix).toBe(1);
        // The belt-and-braces contract: the record is consumed, never left
        // live to poison a later sibling's ambiguity read.
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
        const pre = createSnapshotPreHook();
        // Both calls captured src/app.ts at the same pre state; the orphan's
        // PostToolUse never arrives, so its write window has not provably
        // ended and mine must fail closed (the existing live-record contract).
        const orphanInput = preInput({
          session_id: orphanSession,
          cwd: repo.root,
          tool_use_id: orphanTu,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(orphanInput as never, { logger });
        const myInput = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        await pre(myInput as never, { logger });
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
        writeFile(repo.root, 'src/app.ts', P10);
        await pre(myInput as never, { logger });
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
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

    it('a decided-but-recordless call in a repo-less cwd stays silent — the note cannot fire where no record could ever have been created', async () => {
      // Round-3 finding: the no-record note fired whenever the classifier
      // decided 'snapshot' and the find returned no record, with no
      // repo-existence gate — in a repo-less cwd the pre-walk can never have
      // created a record, so the note ("...the static spans below are the
      // only attribution") was guaranteed spurious there. The note now fires
      // only when the post-time repo root exists; a repo-less cwd falls
      // through silently, per the "silence is the correct steady state"
      // contract.
      const repolessCwd = mkdtempSync(join(tmpdir(), 'agent-hooks-repoless-'));
      try {
        const sessionId = 'sess-lifecycle-repoless';
        const tuId = 'tu-repoless-1';
        const { logger, notes } = noteCapturingLogger();
        const { executors } = makeExecutors();
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const input = postInput({
          session_id: sessionId,
          cwd: repolessCwd,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const raw = await handler(input as never, { logger });
        expect(toResult(raw)).toBeNull();
        expect(notes.some((n) => n.includes('snapshot decided but no record exists'))).toBe(false);
      } finally {
        rmSync(repolessCwd, { recursive: true, force: true });
      }
    });

    it('a zero post-side wall degrades the post capture under a pre-side tree: the degrade note appears, nothing is attributed', async () => {
      // A zero-second wall budget clamps every post-side git call to a 1ms
      // timeout: the post write-tree cannot complete, the capture degrades,
      // and a stat-only post under a pre-side tree is not comparable
      // evidence — nothing is attributed, and the block explains itself
      // instead of silently disappearing.
      const saved = process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
      process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = '0';
      try {
        await withRepo(async (repo) => {
          const sessionId = 'sess-lifecycle-budget';
          const tuId = 'tu-budget-1';
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
          // A real write that would attribute under a normal budget — dropped
          // here, with the note explaining why.
          writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
          const { executors, calls } = makeExecutors();
          const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
          const raw = await handler(input as never, { logger });
          const block = toResult(raw);
          expect(block).toContain('degraded to stat-only under a pre-side tree');
          expect(block).not.toContain('## billing');
          expect(calls.fix).toBe(0);
          // Fail-closed: the window still closes with the record consumed,
          // and the degrade's path-coverage gap warns later siblings.
          expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
        });
      } finally {
        if (saved === undefined) delete process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
        else process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = saved;
      }
    });

    // ---------------------------------------------------------------------
    // I. wave-E coverage-gap family
    // ---------------------------------------------------------------------

    it('a sibling that hits the touched-files cap persists its cut gap — the consumed-after consult fails closed, never clean', async () => {
      // The sibling's compare cut a changed path at the touched-files cap, so
      // that path was never attributed. The handler persists the compare-phase
      // gap onto the record before consuming (coverage-unknowable for any
      // consumer that cannot derive the path's post state), and the sibling's
      // post TREE still carries the path's true end state — so my
      // consumed-after consult reads post!=pre and defers rather than
      // absorbing the sibling's write as my own.
      const saved = process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES;
      process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES = '1';
      try {
        await withRepo(async (repo) => {
          const sessionId = 'sess-lifecycle-capcut';
          const siblingTu = 'tu-capcut-sibling';
          const myTu = 'tu-capcut-mine';
          const command = 'python3 scripts/gen.py';
          writeFile(repo.root, 'src/a.ts', P10);
          writeFile(repo.root, 'src/b.ts', P10);
          gitAddCommit(repo.root, 'add sources');
          const logger = new Logger();
          const pre = createSnapshotPreHook();
          // My capture first: my baseline predates the sibling's window.
          const myInput = preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: myTu,
            tool_input: { command }
          });
          await pre(myInput as never, { logger });
          // The sibling's window: both files change; the cap of 1 cuts b.ts
          // (walk order is sorted, so src/a.ts attributes first).
          const siblingInput = preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: siblingTu,
            tool_input: { command }
          });
          await pre(siblingInput as never, { logger });
          writeFile(repo.root, 'src/a.ts', `${P10}y`);
          writeFile(repo.root, 'src/b.ts', `${P10}z`);
          await createPostToolUseHandler(makeExecutors().executors, () => createMemoryMemoStore())(
            siblingInput as never,
            {
              logger
            }
          );
          // The cut gap is persisted onto the consumed record — the exact
          // evidence a later consult needs.
          const persistedPath = join(sessionDir(sessionId), 'snapshots', `${sanitizeSessionId(siblingTu)}.json`);
          const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as SnapshotRecord;
          expect(persisted.consumed).toBe(true);
          expect(persisted.gaps.some((g) => g.includes('touched-files cap'))).toBe(true);
          expect(recordHasPathCoverageGap(persisted)).toBe(true);
          // My window: I edit b.ts on top of the sibling's write. My own
          // compare must not self-cut, so raise the cap back above the tree.
          process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES = '100';
          writeFile(repo.root, 'src/b.ts', `${P10}z\nmy edit`);
          const { executors, calls } = makeExecutors();
          const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
          const raw = await handler(myInput as never, { logger });
          const block = toResult(raw);
          // a.ts: the sibling changed it in a window overlapping mine.
          expect(block).toContain('attribution deferred: src/a.ts');
          // b.ts: cap-cut with a persisted gap — end state unknowable, never
          // "consumed without changing P". No phantom absorption.
          expect(block).toContain('attribution deferred: src/b.ts');
          expect(block).toContain('unknowable');
          expect(calls.fix).toBe(0);
        });
      } finally {
        if (saved === undefined) delete process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES;
        else process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES = saved;
      }
    });

    it('a sibling whose walk excluded a binary file is NOT coverage-gapped — the consult stays clean and attribution proceeds', async () => {
      // The deferral storm: an ANY-gap consult would make every sibling in a
      // repo with a binary/oversize file coverage-unknowable, deferring my
      // edit of a provably-untouched path. The exclusion is consistent
      // pre/post, so it must not open the family — the consumed-after row
      // keeps reading post(P)=null as clean.
      await withRepo(async (repo) => {
        const sessionId = 'sess-lifecycle-binary';
        const siblingTu = 'tu-binary-sibling';
        const myTu = 'tu-binary-mine';
        const command = 'python3 scripts/gen.py';
        writeFile(repo.root, 'src/app.ts', P10);
        writeFile(repo.root, 'assets/logo.bin', 'PNG\x00\x01\x02');
        gitAddCommit(repo.root, 'add sources');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        // My capture first; the sibling's window comes after.
        const myInput = preInput({ session_id: sessionId, cwd: repo.root, tool_use_id: myTu, tool_input: { command } });
        await pre(myInput as never, { logger });
        // The sibling changes nothing: its consume carries no post entries
        // and its record carries ONLY the exclusion diagnostic.
        const siblingInput = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: siblingTu,
          tool_input: { command }
        });
        await pre(siblingInput as never, { logger });
        await createPostToolUseHandler(makeExecutors().executors, () => createMemoryMemoStore())(
          siblingInput as never,
          {
            logger
          }
        );
        const persistedPath = join(sessionDir(sessionId), 'snapshots', `${sanitizeSessionId(siblingTu)}.json`);
        const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as SnapshotRecord;
        expect(persisted.gaps).toEqual(['binary file excluded: assets/logo.bin']);
        expect(recordHasPathCoverageGap(persisted)).toBe(false);
        // My window: I edit the untouched app.ts and create a new file. The
        // sibling's post(P)=null reads clean, and my own exclusion gap does
        // not drop the create candidate. (The edit stays inside lines 1-10 so
        // the default executor row intersects the observed range.)
        writeFile(repo.root, 'src/app.ts', P10.replace('export const v1 = 1;', 'export const v1 = 1; // touched'));
        writeFile(repo.root, 'src/new.ts', 'export const fresh = 1;\n');
        const { executors, calls } = makeExecutors();
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(myInput as never, { logger });
        const block = toResult(raw);
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).not.toContain('attribution deferred');
        expect(calls.fix).toBe(2);
      });
    });

    it('a malformed env override does not shadow a valid config key', async () => {
      await withRepo(async (repo) => {
        execFileSync('git', ['-C', repo.root, 'config', 'git-span.snapshot-max-total-bytes', '4096'], {
          stdio: 'ignore'
        });
        const saved = process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES;
        try {
          // The env value cannot parse, so it must fall through to the config
          // layer — a bad override never silently reverts the budget to the
          // default while a valid git-span.snapshot-* key sits in the repo.
          process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES = '500MB';
          expect(resolveSnapshotBudgets(repo.root).maxTotalBytes).toBe(4096);
        } finally {
          if (saved === undefined) delete process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES;
          else process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES = saved;
        }
      });
    });

    it('partial post-side wall exhaustion is transcript-visible: the partway note appears alongside the block', async () => {
      // The zero-scope variant is pinned above; this pins the PARTIAL note —
      // some paths attributed, then the wall struck. The wall clock starts at
      // handler entry, before the post walk, so a fixed wall could never be
      // robust across machines. Instead the fixture calibrates against THIS
      // repo: wall = real walk (walkSnapshotFiles) + 1.5 real per-path costs
      // (the compare's re-read+hash of one file). The first changed path
      // always attributes (walk < wall) and the third check always exhausts
      // (walk + 2 paths > wall) — k ∈ {1, 2} on any machine, never zero
      // scopes and never all three, with half a path of slack each way
      // against measurement noise.
      const savedWall = process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
      const savedPreWall = process.env.GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS;
      const savedBytes = process.env.GIT_SPAN_SNAPSHOT_MAX_BYTES_PER_FILE;
      const savedTotal = process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES;
      // The 32 MiB payloads would otherwise be excluded as oversize, and the
      // 96 MiB tree would blow the 64 MiB total-bytes cap — the walk must see
      // every file, or the fixture's path count changes.
      process.env.GIT_SPAN_SNAPSHOT_MAX_BYTES_PER_FILE = String(35 * 1024 * 1024);
      process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES = String(128 * 1024 * 1024);
      // The pre-side wall must never truncate the pre walk.
      process.env.GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS = '30';
      try {
        await withRepo(async (repo) => {
          const sessionId = 'sess-lifecycle-partialbudget';
          const tuId = 'tu-partialbudget-1';
          const payload = 'x'.repeat(32 * 1024 * 1024);
          // src/app.ts sorts first, so the first changed path (the one the
          // default executor rows match) is always the one attributed.
          for (let i = 0; i < 3; i += 1) writeFile(repo.root, i === 0 ? 'src/app.ts' : `src/gen${i}.ts`, payload);
          gitAddCommit(repo.root, 'add generated sources');
          const logger = new Logger();
          const pre = createSnapshotPreHook();
          const budgets = resolveSnapshotBudgets(repo.root);
          // Calibration: one warm-up pass (JIT + page cache), then the real
          // walk and one real per-path re-read+hash — the exact work the
          // compare does per changed path, measured at the steady state the
          // handler's walk will run at.
          walkSnapshotFiles(repo.root, [], budgets, Date.now(), logger);
          const calStart = process.hrtime.bigint();
          walkSnapshotFiles(repo.root, [], budgets, Date.now(), logger);
          const walkMs = Number(process.hrtime.bigint() - calStart) / 1_000_000;
          const warmOne = readFileSync(join(repo.root, 'src/app.ts'));
          createHash('sha256').update(warmOne).digest();
          const pathStart = process.hrtime.bigint();
          const one = readFileSync(join(repo.root, 'src/app.ts'));
          createHash('sha256').update(one).digest();
          const pathMs = Number(process.hrtime.bigint() - pathStart) / 1_000_000;
          process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = String((walkMs + 1.5 * pathMs) / 1000);
          const input = preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'python3 scripts/gen.py' }
          });
          await pre(input as never, { logger });
          for (let i = 0; i < 3; i += 1) writeFile(repo.root, i === 0 ? 'src/app.ts' : `src/gen${i}.ts`, `${payload}y`);
          const { executors } = makeExecutors();
          const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
          const raw = await handler(input as never, { logger });
          const block = toResult(raw);
          expect(block).toContain('post-side wall budget was exhausted partway');
          expect(block).toContain('## billing/checkout-request-flow');
        });
      } finally {
        if (savedWall === undefined) delete process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS;
        else process.env.GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS = savedWall;
        if (savedPreWall === undefined) delete process.env.GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS;
        else process.env.GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS = savedPreWall;
        if (savedBytes === undefined) delete process.env.GIT_SPAN_SNAPSHOT_MAX_BYTES_PER_FILE;
        else process.env.GIT_SPAN_SNAPSHOT_MAX_BYTES_PER_FILE = savedBytes;
        if (savedTotal === undefined) delete process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES;
        else process.env.GIT_SPAN_SNAPSHOT_MAX_TOTAL_BYTES = savedTotal;
      }
    });
  });
});
