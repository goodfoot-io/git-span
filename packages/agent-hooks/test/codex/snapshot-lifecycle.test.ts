/**
 * Acceptance checks for the Codex harness snapshot lifecycle (card
 * main-213): the same lifecycle as the Claude harness (card's plan), through
 * the committed codex adapter modules (src/codex/snapshot.ts,
 * src/codex/post-tool-use.ts, src/codex/stop.ts, src/codex/subagent-stop.ts)
 * — plus the platform asymmetry:
 *
 * - Codex's PreToolUse records `agent_id` when present, so SubagentStop can
 *   remove only the subagent's records.
 * - Codex has no PostToolUseFailure event. A failed call's record is never
 *   attributed and never silently discarded: it stays live as ambiguity
 *   evidence (a later call fails closed against it) and is reclaimed by the
 *   Stop/TTL cleanup — always-discard by construction.
 * - Stop removes the whole session's snapshot state; SubagentStop removes
 *   only the records carrying the subagent's agent_id.
 *
 * These fixtures run against the implemented adapters (Phase 3). Fixtures
 * that need the real `git span` CLI are gated with
 * `it.skipIf(!hasGitSpan)`, mirroring porcelain-contract.test.ts. The
 * ambiguity-table rows and the activity-log interleaving outcomes are shared
 * infrastructure covered in the Claude lifecycle file; this file mirrors the
 * essential concurrency cases and the never-flag / bounded-double /
 * unfinished ordering outcomes.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@goodfoot/codex-hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import activityLogHook from '../../src/codex/activity-log.js';
import { createHandler as createPostToolUseHandler, SNAPSHOT_POST_MATCHER } from '../../src/codex/post-tool-use.js';
import {
  createHandler as createSnapshotPreHook,
  resolveSnapshotBudgets,
  SNAPSHOT_PRE_MATCHER,
  walkSnapshotFiles
} from '../../src/codex/snapshot.js';
import stopHook from '../../src/codex/stop.js';
import subagentStopHook from '../../src/codex/subagent-stop.js';
import { queueRoot, sanitizeSessionId, sessionDir } from '../../src/common/agent-hooks-common.js';
import {
  applyAmbiguityRules,
  DEFAULT_SNAPSHOT_BUDGETS,
  recordHasPathCoverageGap,
  type SnapshotRecord
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
  CODEX_SESSION_IDS,
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
} from '../claude/snapshot-lifecycle-helpers.js';

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

function fileLines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `export const v${i + 1} = ${i + 1};`).join('\n')}\n`;
}

const P10 = fileLines(10);
const P10_FORMATTED = P10.replace('export const v3 = 3;', 'export const v3  = 3;').replace(
  'export const v4 = 4;',
  'export const v4 = 4; '
);
const P10_DIRTY = P10.replace('export const v1 = 1;', 'export const v1  = 1;');

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

/** Read the touch block out of a codex hook result, or null when there is none. */
function toResult(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const stdout = (raw as { stdout?: { hookSpecificOutput?: { additionalContext?: string } } }).stdout;
  return stdout?.hookSpecificOutput?.additionalContext ?? null;
}

function preInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-codex',
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
    session_id: 'sess-codex',
    transcript_path: '/tmp/transcript',
    cwd: '/repo',
    model: 'gpt-x',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: '' },
    tool_use_id: 'tu-bash-1',
    ...overrides
  };
}

function stopInput(sessionId: string): Record<string, unknown> {
  return {
    hook_event_name: 'Stop',
    session_id: sessionId,
    transcript_path: '/tmp/transcript',
    cwd: '/repo'
  };
}

function subagentStopInput(sessionId: string, agentId: string): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStop',
    session_id: sessionId,
    agent_id: agentId,
    transcript_path: '/tmp/transcript',
    cwd: '/repo'
  };
}

/** A sibling record view built from the sibling's own record. */
function siblingFrom(
  record: SnapshotRecord,
  path: string
): {
  sessionId: string;
  toolUseId: string;
  createdAt: number;
  consumed: boolean;
  consumedAt: number | null;
  coverageGap: boolean;
  pre: import('../../src/common/snapshot-core.js').SnapshotFile | null;
  post: import('../../src/common/snapshot-core.js').SnapshotFile | null;
} {
  return {
    sessionId: record.sessionId,
    toolUseId: record.toolUseId,
    createdAt: record.createdAt,
    consumed: record.consumed,
    consumedAt: record.consumedAt,
    // The handler's derivation, mirrored: kind-based, never ANY-gap.
    coverageGap: recordHasPathCoverageGap(record),
    pre: record.files[path] ?? null,
    post: record.post?.[path] ?? null
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

describe('codex harness snapshot lifecycle', () => {
  // The store persists tombstones for `recordTtlMs` after consumption; a
  // previously consumed (session, tool_use_id) would fail every call closed
  // on a re-run. The fixture's ids are fixed and unique per test, so purge
  // the codex file's own session dirs before the run (see the helpers'
  // rationale). Only this file's ids: the claude file runs in a parallel
  // fork over the same shared session base, and a union purge would delete
  // its live records mid-test.
  beforeAll(() => purgeSessions(CODEX_SESSION_IDS));
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
  afterEach(() => purgeSessions(CODEX_SESSION_IDS));
  afterAll(flushPurgedSessions);

  describe('A. PreToolUse — the write-only pre walk', () => {
    it('writes a pre-walk record carrying agent_id when present, correlated by (session_id, tool_use_id)', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-pre-record';
        const tuId = 'tu-codex-pre-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const pre = createSnapshotPreHook();
        const logger = new Logger();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          agent_id: 'sub-1',
          tool_name: 'Bash',
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const result = await pre(input as never, { logger } as never);
        expect(result).toBeUndefined(); // the pre hook is write-only
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record).toMatchObject({
          sessionId,
          toolUseId: tuId,
          agentId: 'sub-1',
          repoRoot: repo.root,
          consumed: false,
          tier: 'repo'
        });
        expect(record.files['src/app.ts']).toBeDefined();
      });
    });

    it('writes no record for a provably read-only command', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-pre-readonly';
        const tuId = 'tu-codex-pre-2';
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
        expect(await pre(input as never, { logger } as never)).toBeUndefined();
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBeNull();
      });
    });

    it('fails open with no record when session_id or tool_use_id is absent', async () => {
      const pre = createSnapshotPreHook();
      const logger = new Logger();
      const base = preInput({ cwd: '/tmp', tool_input: { command: 'npx prettier --write /tmp/x.ts' } });
      const noSession = await pre({ ...base, session_id: undefined } as never, { logger } as never);
      const noToolUse = await pre({ ...base, tool_use_id: undefined } as never, { logger } as never);
      expect(noSession).toBeUndefined();
      expect(noToolUse).toBeUndefined();
    });

    it('recovers the command from the classic exec_command envelope and snapshots it', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-pre-envelope';
        const tuId = 'tu-codex-pre-3';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const pre = createSnapshotPreHook();
        const logger = new Logger();
        // Codex ≤0.130 delivers exec_command as tool_input.arguments — a JSON
        // string of { cmd, workdir }.
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_name: 'exec_command',
          tool_input: { arguments: JSON.stringify({ cmd: 'npx prettier --write src/app.ts', workdir: repo.root }) }
        });
        expect(await pre(input as never, { logger } as never)).toBeUndefined();
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record.files['src/app.ts']).toBeDefined();
      });
    });
  });

  describe('B. PostToolUse — comparison, attribution, consumption', () => {
    it('attributes a formatter run to exact post-state ranges', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-formatter';
        const tuId = 'tu-codex-formatter-1';
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
        await pre(input as never, { logger } as never);
        // The formatter's effect: lines 3-4 reflowed, nothing else.
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        const { executors } = makeExecutors({
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
        const raw = await handler(
          postInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_name: 'Bash',
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger } as never
        );
        const block = toResult(raw);
        // Only the span inside the changed range surfaces; a whole-file scope
        // would have surfaced both.
        expect(block).toContain('## billing/checkout-request-flow');
        expect(block).not.toContain('## billing/payment-created-flow');
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('treats a duplicate PostToolUse delivery as a no-op — exactly one attribution', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-duplicate';
        const tuId = 'tu-codex-dup-1';
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
        const first = toResult(await handler(input as never, { logger } as never));
        const second = toResult(await handler(input as never, { logger } as never));
        expect(first).toContain('## billing/checkout-request-flow');
        expect(second).toBeNull();
        expect(calls.list).toBe(1);
      });
    });

    it('never surfaces pre-existing dirty state on an untouched path', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-dirty';
        const tuId = 'tu-codex-dirty-1';
        writeFile(repo.root, 'src/app.ts', P10);
        writeFile(repo.root, 'src/other.ts', P10);
        gitAddCommit(repo.root, 'add files');
        writeFile(repo.root, 'src/app.ts', P10_DIRTY);
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/other.ts' }
        });
        await pre(input as never, { logger } as never);
        const { executors, calls } = makeExecutors({
          rows: () => [porcelainRow({ path: 'src/app.ts', start: 1, end: 10 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(
          postInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/other.ts' }
          }) as never,
          { logger } as never
        );
        expect(toResult(raw)).toBeNull();
        expect(calls.fix).toBe(0);
        expect(calls.drift).toBe(0);
        expect(calls.list).toBe(0);
      });
    });

    it.skipIf(!hasGitSpan)(
      'a delete surfaces the span through the real pipeline — dead anchor, exit codes ignored',
      async () => {
        await withRepo(async (repo) => {
          const sessionId = 'sess-codex-delete';
          const tuId = 'tu-codex-delete-1';
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
          await pre(input as never, { logger } as never);
          rmSync(join(repo.root, 'src/app.ts'));
          const handler = createPostToolUseHandler(); // default executors — the real CLI
          const raw = await handler(
            postInput({
              session_id: sessionId,
              cwd: repo.root,
              tool_use_id: tuId,
              tool_input: { command: 'rm src/app.ts' }
            }) as never,
            { logger } as never
          );
          const block = toResult(raw);
          expect(block).toContain('## billing/checkout-request-flow');
          // The touch block renders anchors as `path #L1-L5` (canonical per
          // advisor-core.test.ts).
          expect(block).toContain('src/app.ts #L1-L5');
        });
      }
    );

    it.skipIf(!hasGitSpan)('a rename surfaces the old path as a delete and leaves the new path alone', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-rename';
        const tuId = 'tu-codex-rename-1';
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
        await pre(input as never, { logger } as never);
        renameSync(join(repo.root, 'src/app.ts'), join(repo.root, 'src/app2.ts'));
        const handler = createPostToolUseHandler();
        const raw = await handler(
          postInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'mv src/app.ts src/app2.ts' }
          }) as never,
          { logger } as never
        );
        const block = toResult(raw);
        // The rename pairs as delete+create: the span lives on the old path.
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

  describe('C. the platform asymmetry — Codex has no PostToolUseFailure', () => {
    it('exports no post-tool-use-failure module — the hook cannot fire on this harness', async () => {
      // The plan scopes the failure comparator to the Claude harness: Codex
      // delivers no PostToolUseFailure event, so there is no codex adapter
      // module to import. The specifier is computed so TypeScript does not
      // resolve it at compile time — at run time the import must reject.
      const failureModule = `../../src/codex/${'post-tool-use'}-failure.js`;
      await expect(import(failureModule)).rejects.toThrow();
    });

    it('a failed call with no failure hook leaves its record live — evidence, never silently discarded', async () => {
      // Codex has no PostToolUseFailure event: the record from a failed call
      // is never consumed and never attributed. The loss is fail-closed by
      // construction — the live record is ambiguity evidence, and a later
      // call touching the same path sees the unprovably-ended window and
      // fails closed rather than mis-attribute.
      await withRepo(async (repo) => {
        const now = Date.now();
        const sessionId = 'sess-codex-failed';
        const tuId = 'tu-codex-failed-1';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        writeFile(repo.root, 'src/app.ts', P10);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/app.ts': makeFile({ hash: sha256Hex(P10), size: P10.length }) }
          })
        );
        const found = store.find(sessionId, tuId);
        expect(found).not.toBeNull();
        expect(found).not.toBe('tombstoned');
        if (found === null || found === 'tombstoned') throw new Error('record missing');
        expect(found.consumed).toBe(false);
        const later = makeRecord({
          sessionId: 'sess-codex-later',
          toolUseId: 'tu-codex-later-1',
          createdAt: now + 1000,
          files: { 'src/app.ts': makeFile({ hash: 'd'.repeat(64) }) }
        });
        expect(applyAmbiguityRules(later, [siblingFrom(found, 'src/app.ts')], 'src/app.ts').ambiguous).toBe(true);
      });
    });

    it("the failed call's record is reclaimed by the Stop hook", async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const sessionId = 'sess-codex-stop';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: 'tu-codex-failed-1',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/app.ts': makeFile() }
          })
        );
        expect(store.tombstone(sessionId, 'tu-codex-failed-1', now)).toBe(true);
        appendActivityEntry(repo.root, {
          sessionId,
          toolUseId: 'tu-codex-edit-1',
          kind: 'Edit',
          startedAt: now - 1000,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: 'pre-h', postHash: null }]
        });
        const raw = await stopHook(stopInput(sessionId) as never, { logger } as never);
        expect(raw).toBeUndefined();
        // find returns null, not 'tombstoned' — the tombstone went with the record.
        expect(store.find(sessionId, 'tu-codex-failed-1')).toBeNull();
        expect(store.listRepoRecords(repo.root)).toHaveLength(0);
        expect(
          activityEntriesCovering(repo.root, 'src/app.ts', now - 2000, now, DEFAULT_SNAPSHOT_BUDGETS)
        ).toHaveLength(0);
      });
    });

    it("the failed call's record is reclaimed by the TTL sweep", async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        store.write(
          makeRecord({
            sessionId: 'sess-codex-ttl',
            toolUseId: 'tu-codex-failed-1',
            repoRoot: repo.root,
            createdAt: now - DEFAULT_SNAPSHOT_BUDGETS.recordTtlMs - 1000,
            files: { 'src/app.ts': makeFile() }
          })
        );
        // The record's createdAt is already TTL-expired, but the sweep-read
        // margin skips files written within the last 5s — age the file itself
        // past the margin so the TTL pass reads it (utimesSync takes seconds).
        const recFile = join(
          sessionDir('sess-codex-ttl'),
          'snapshots',
          `${sanitizeSessionId('tu-codex-failed-1')}.json`
        );
        utimesSync(recFile, (now - 60_000) / 1000, (now - 60_000) / 1000);
        expect(store.sweep(now).records).toBe(1);
        expect(store.find('sess-codex-ttl', 'tu-codex-failed-1')).toBeNull();
      });
    });
  });

  describe('D. SubagentStop — per-subagent cleanup', () => {
    it("removes only the subagent's records; the main session's records stay for Stop", async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const sessionId = 'sess-codex-subagent';
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        store.write(
          makeRecord({
            sessionId,
            toolUseId: 'tu-sub-1',
            agentId: 'sub-1',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/sub.ts': makeFile() }
          })
        );
        store.write(
          makeRecord({
            sessionId,
            toolUseId: 'tu-sub-2',
            agentId: 'sub-1',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/sub2.ts': makeFile() }
          })
        );
        store.write(
          makeRecord({
            sessionId,
            toolUseId: 'tu-main-1',
            repoRoot: repo.root,
            createdAt: now,
            files: { 'src/app.ts': makeFile() }
          })
        );
        // The activity-log side of the same split (round-3 finding: a subagent
        // stop used to delete the MAIN session's activity entries too — a
        // subagent shares the parent's session_id, so the removeSession
        // activity pass had to carry the agent filter). Entries go through the
        // real appendActivityEntry path; the subagent's entry carries the
        // agent_id the codex activity pre-hook records, the main session's
        // entry records none.
        const subEntryFile = join(
          queueRoot(repo.root),
          'activity-log',
          `${sanitizeSessionId(sessionId)}__${sanitizeSessionId('tu-sub-activity-1')}.json`
        );
        const mainEntryFile = join(
          queueRoot(repo.root),
          'activity-log',
          `${sanitizeSessionId(sessionId)}__${sanitizeSessionId('tu-main-activity-1')}.json`
        );
        appendActivityEntry(repo.root, {
          sessionId,
          toolUseId: 'tu-sub-activity-1',
          kind: 'apply_patch',
          startedAt: now,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(P10), postHash: null }],
          agentId: 'sub-1'
        });
        appendActivityEntry(repo.root, {
          sessionId,
          toolUseId: 'tu-main-activity-1',
          kind: 'apply_patch',
          startedAt: now,
          finishedAt: null,
          paths: [{ path: 'src/app.ts', preHash: sha256Hex(P10), postHash: null }]
        });
        const raw = await subagentStopHook(subagentStopInput(sessionId, 'sub-1') as never, { logger } as never);
        expect(raw).toBeUndefined();
        expect(store.find(sessionId, 'tu-sub-1')).toBeNull();
        expect(store.find(sessionId, 'tu-sub-2')).toBeNull();
        // The main session's records are left for the Stop hook.
        expect(store.find(sessionId, 'tu-main-1')).not.toBeNull();
        expect(store.listRepoRecords(repo.root).filter((e) => e.sessionId === sessionId)).toHaveLength(1);
        // The subagent's activity entry is removed; the main session's entry —
        // same session_id, no agent_id — survives for the Stop hook.
        expect(existsSync(subEntryFile)).toBe(false);
        expect(existsSync(mainEntryFile)).toBe(true);
      });
    });
  });

  describe('E. concurrency — the essential ambiguity mirrors', () => {
    it('same-state same-file: both calls fail closed with deterministic diagnostics (older completes first)', () => {
      const PATH = 'src/app.ts';
      const fileA = makeFile({ hash: 'a'.repeat(64) });
      const fileB = makeFile({ hash: 'b'.repeat(64) });
      const a = makeRecord({ sessionId: 'sess-a', toolUseId: 'call-a', createdAt: 100, files: { [PATH]: fileA } });
      const b = makeRecord({ sessionId: 'sess-b', toolUseId: 'call-b', createdAt: 300, files: { [PATH]: fileA } });
      // B evaluates first: A is still live → ambiguous.
      const bFirst = applyAmbiguityRules(b, [siblingFrom(a, PATH)], PATH);
      expect(bFirst.ambiguous).toBe(true);
      // A completes first with a real change; B re-evaluates: consumed, created
      // before mine, window overlaps my baseline → still ambiguous.
      const aConsumed = { ...siblingFrom(a, PATH), consumed: true, consumedAt: 400, pre: fileA, post: fileB };
      expect(applyAmbiguityRules(b, [aConsumed], PATH).ambiguous).toBe(true);
      // A, evaluating its own path later, sees B still live → ambiguous too.
      expect(applyAmbiguityRules(a, [siblingFrom(b, PATH)], PATH).ambiguous).toBe(true);
      if (!bFirst.ambiguous) throw new Error('expected ambiguous');
      expect(bFirst.siblingToolUseId).toBe('call-a');
    });

    it('disjoint writes completed in reverse order: the earlier-completing call fails closed, the later-completing one attributes its own paths', () => {
      const fileA = makeFile({ hash: 'a'.repeat(64) });
      const fileB = makeFile({ hash: 'b'.repeat(64) });
      const fileC = makeFile({ hash: 'c'.repeat(64) });
      // Both tier-2 records cover the whole repo.
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
      expect(applyAmbiguityRules(b, [siblingFrom(a, 'src/b.ts')], 'src/b.ts').ambiguous).toBe(true);
      const bConsumed = { ...siblingFrom(b, 'src/a.ts'), consumed: true, consumedAt: 350, pre: fileC, post: fileC };
      expect(applyAmbiguityRules(a, [bConsumed], 'src/a.ts').ambiguous).toBe(false);
    });

    it('a duplicate PostToolUse racing the O_EXCL tombstone yields exactly one attribution', async () => {
      await withRepo(async (repo) => {
        const now = Date.now();
        const sessionId = 'sess-codex-race';
        const tuId = 'tu-codex-race-1';
        const logger = new Logger();
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        createSnapshotStore(logger).write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: now - 1000,
            files: {
              'src/app.ts': makeFile({
                hash: sha256Hex(P10),
                size: P10.length,
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
        const input = postInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const [rawA, rawB] = await Promise.all([
          handler(input as never, { logger } as never),
          handler(input as never, { logger } as never)
        ]);
        const blocks = [toResult(rawA), toResult(rawB)].filter((b) => b !== null);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toContain('## billing/checkout-request-flow');
        expect(calls.list).toBe(1);
      });
    });
  });

  describe('F. the activity-log interleaving mirrors', () => {
    /**
     * The shared interleaving scenario: a real repo with a committed file P, a
     * stored pre record for an opaque shell call, the post state on disk, and
     * an activity entry appended by the fixture. Drives the real codex post
     * handler with fake executors so the outcome is the boundary check's.
     */
    async function runInterleaved(
      sessionId: string,
      tuId: string,
      opts: { v1: string; v2: string; entry: ActivityEntry }
    ): Promise<{ block: string | null; notes: string[] }> {
      const repo = createTestRepo();
      try {
        const { v1, v2, entry } = opts;
        const now = Date.now();
        writeFile(repo.root, 'src/app.ts', v2);
        createSnapshotStore(new Logger()).write(
          makeRecord({
            sessionId,
            toolUseId: tuId,
            repoRoot: repo.root,
            createdAt: now - 1000,
            files: {
              'src/app.ts': makeFile({
                hash: sha256Hex(v1),
                size: v1.length,
                mtimeNs: BigInt(BASE_NOW) * 1_000_000n + 5n,
                capturedAt: now - 2000
              })
            }
          })
        );
        appendActivityEntry(repo.root, entry);
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
        const raw = await handler(input as never, { logger } as never);
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
        sessionId: 'sess-codex-interleave-neverflag',
        toolUseId: 'tu-edit-prior',
        kind: 'Edit',
        startedAt: now - 5000,
        finishedAt: now - 3000,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex('v0'), postHash: sha256Hex(v1) }]
      };
      const { block, notes } = await runInterleaved('sess-codex-interleave-neverflag', 'tu-bash-neverflag', {
        v1,
        v2,
        entry
      });
      // The edit wrote and touched before P's baseline — its change is baked
      // into my pre and can never contaminate my post-diff.
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(false);
    });

    it('Bash-first ordering: the Bash residual attributes via bounded-double, the edit segment absorbed', async () => {
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v3 = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-codex-interleave-bashfirst',
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
      const { block, notes } = await runInterleaved('sess-codex-interleave-bashfirst', 'tu-bash-bashfirst', {
        v1,
        v2: v3,
        entry
      });
      expect(block).toContain('## billing/checkout-request-flow');
      expect(notes.some((n) => n.includes('absorbed-double'))).toBe(true);
    });

    it('an unfinished entry fails closed — its write may still land', async () => {
      const now = Date.now();
      const v1 = 'export const a = 1;\n';
      const v2 = 'export const a = 1;\nexport const b = 2;\n';
      const entry: ActivityEntry = {
        sessionId: 'sess-codex-interleave-unfinished',
        toolUseId: 'tu-edit-unfinished',
        kind: 'Edit',
        startedAt: now - 500,
        finishedAt: null,
        paths: [{ path: 'src/app.ts', preHash: sha256Hex(v1), postHash: null }]
      };
      const { block, notes } = await runInterleaved('sess-codex-interleave-unfinished', 'tu-bash-unfinished', {
        v1,
        v2,
        entry
      });
      expect(block).toBeNull();
      expect(notes.some((n) => n.includes('interleaved-tool'))).toBe(true);
    });
  });

  describe('G. matcher family, config subsection form, exclusion visibility', () => {
    // These fixtures use their own session ids; purge them after each test
    // like the rest of the file so no record outlives the run.
    const WAVE_C_SESSIONS = ['sess-codex-shell-spelled', 'sess-codex-binary-excluded', 'sess-codex-oversize-excluded'];
    afterEach(() => purgeSessions(WAVE_C_SESSIONS));

    it('every tool name the pre matcher registers is consumable post-side — pre ⊆ post', () => {
      const pre = SNAPSHOT_PRE_MATCHER.split('|');
      const post = SNAPSHOT_POST_MATCHER.split('|');
      for (const name of pre) {
        expect(post, `pre matcher registers ${name}, missing from the post matcher`).toContain(name);
      }
    });

    it('a shell-spelled call snapshots pre and attributes post end-to-end', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-shell-spelled';
        const tuId = 'tu-codex-shell-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        await pre(
          preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_name: 'shell',
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger } as never
        );
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record.files['src/app.ts']).toBeDefined();
        // The formatter's effect: lines 3-4 reflowed, nothing else.
        writeFile(repo.root, 'src/app.ts', P10_FORMATTED);
        const { executors } = makeExecutors({
          rows: (filePath) =>
            filePath.endsWith('/src/app.ts')
              ? [porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 })]
              : [],
          drift: () => [driftRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 })]
        });
        const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
        const raw = await handler(
          postInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_name: 'shell',
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger } as never
        );
        expect(toResult(raw)).toContain('## billing/checkout-request-flow');
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('git config git-span.snapshot.max-files — the git subsection form resolves like the dash form', async () => {
      await withRepo(async (repo) => {
        execFileSync('git', ['-C', repo.root, 'config', 'git-span.snapshot.max-files', '2'], { stdio: 'ignore' });
        const budgets = resolveSnapshotBudgets(repo.root);
        expect(budgets.maxFiles).toBe(2);
        // The other budgets are untouched — the subsection key maps onto the
        // same key space as the dash form.
        expect(budgets.maxTotalBytes).toBe(DEFAULT_SNAPSHOT_BUDGETS.maxTotalBytes);
      });
    });

    it('the dash form git-span.snapshot-max-total-bytes keeps resolving', async () => {
      await withRepo(async (repo) => {
        execFileSync('git', ['-C', repo.root, 'config', 'git-span.snapshot-max-total-bytes', '4096'], {
          stdio: 'ignore'
        });
        expect(resolveSnapshotBudgets(repo.root).maxTotalBytes).toBe(4096);
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

    it('a binary file excluded from the pre walk is named in the record gaps, never silent', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-binary-excluded';
        const tuId = 'tu-codex-binary-1';
        writeFile(repo.root, 'src/app.ts', P10);
        writeFile(repo.root, 'src/app.bin', '\x00\x01\x02binary');
        gitAddCommit(repo.root, 'add files');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        await pre(
          preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger } as never
        );
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record.files['src/app.ts']).toBeDefined();
        expect(record.files['src/app.bin']).toBeUndefined();
        expect(record.gaps).toContain('binary file excluded: src/app.bin');
      });
    });

    it('an oversize file excluded from the pre walk is named in the record gaps, never silent', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-oversize-excluded';
        const tuId = 'tu-codex-oversize-1';
        writeFile(repo.root, 'src/app.ts', P10);
        writeFile(repo.root, 'src/big.txt', 'x'.repeat(DEFAULT_SNAPSHOT_BUDGETS.maxBytesPerFile + 1));
        gitAddCommit(repo.root, 'add files');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        await pre(
          preInput({
            session_id: sessionId,
            cwd: repo.root,
            tool_use_id: tuId,
            tool_input: { command: 'npx prettier --write src/app.ts' }
          }) as never,
          { logger } as never
        );
        const record = createSnapshotStore(logger).find(sessionId, tuId);
        expect(record).not.toBeNull();
        expect(record).not.toBe('tombstoned');
        if (record === null || record === 'tombstoned') throw new Error('record missing');
        expect(record.files['src/big.txt']).toBeUndefined();
        expect(record.gaps).toContain('oversize file excluded: src/big.txt');
      });
    });
  });

  describe('H. wave-A hardening mirrors — deferral notes, record-less diagnostics, degenerate apply_patch', () => {
    it('an unconsumed orphan sibling defers attribution with a transcript-visible note; removing the orphan lets the next capture attribute', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-defer';
        const tuId = 'tu-codex-defer-1';
        const orphanSession = 'sess-codex-orphan';
        const orphanTu = 'tu-codex-orphan-1';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const logger = new Logger();
        const store = createSnapshotStore(logger);
        // Both calls captured src/app.ts at the same pre state; the orphan's
        // PostToolUse never arrives (Codex has no failure event either), so
        // its write window has not provably ended and mine must fail closed.
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
        const raw = await handler(input as never, { logger } as never);
        const block = toResult(raw);
        // The deferral is transcript-visible — the model loop sees WHY the
        // path produced no attribution, never a silent drop.
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
        const raw2 = await handler(input as never, { logger } as never);
        const block2 = toResult(raw2);
        expect(block2).toContain('## billing/checkout-request-flow');
        expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
      });
    });

    it('a decided-but-recordless PostToolUse surfaces a transcript-visible note alongside the static fallback', async () => {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-norecord';
        const tuId = 'tu-codex-norecord-1';
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
        const raw = await handler(input as never, { logger } as never);
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
        const sessionId = 'sess-codex-repoless';
        const tuId = 'tu-codex-repoless-1';
        const { logger, notes } = noteCapturingLogger();
        const handler = createPostToolUseHandler(makeExecutors().executors, () => createMemoryMemoStore());
        const input = postInput({
          session_id: sessionId,
          cwd: repolessCwd,
          tool_use_id: tuId,
          tool_input: { command: 'npx prettier --write src/app.ts' }
        });
        const raw = await handler(input as never, { logger } as never);
        expect(toResult(raw)).toBeNull();
        expect(notes.some((n) => n.includes('snapshot decided but no record exists'))).toBe(false);
      } finally {
        rmSync(repolessCwd, { recursive: true, force: true });
      }
    });

    it('a write-classified apply_patch that parses to zero anchors warns naming the call and creates no activity entry', async () => {
      // Degenerate apply_patch: the content is not a patch at all, so no path
      // could be bounded by an activity entry. The entry is not created — an
      // entry with no paths would imply coverage it cannot have — and the
      // blind spot is named on the logger, never silent.
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-applypatch';
        const tuId = 'tu-applypatch-zero';
        writeFile(repo.root, 'src/app.ts', P10);
        gitAddCommit(repo.root, 'add app.ts');
        const { logger, notes } = noteCapturingLogger();
        const input = preInput({
          session_id: sessionId,
          cwd: repo.root,
          tool_use_id: tuId,
          tool_name: 'apply_patch',
          tool_input: { command: 'not an apply patch at all' }
        });
        const result = await activityLogHook(input as never, { logger } as never);
        expect(result).toBeUndefined();
        expect(notes.some((n) => n.includes('apply_patch') && n.includes(tuId) && n.includes('zero anchors'))).toBe(
          true
        );
        const activityFile = join(
          queueRoot(repo.root),
          'activity-log',
          `${sanitizeSessionId(sessionId)}__${sanitizeSessionId(tuId)}.json`
        );
        expect(existsSync(activityFile)).toBe(false);
      });
    });
  });

  describe('H. the envelope workdir frame — cross-repo writes attribute in the workdir repo', () => {
    it('a classic exec_command envelope with a workdir into a second repo records and attributes the write there', async () => {
      // Round-3 finding: the snapshot surface used to be anchored at the hook
      // cwd on BOTH sides while the static co-run threaded the envelope's
      // workdir — a Bash call writing in another repo via the workdir
      // compared empty, consumed clean, and returned null with NO note
      // (silent attribution loss). The pre side must classify, resolve, and
      // walk at the same effectiveCwd rule the post side already uses, so the
      // record's repoRoot is the workdir repo and the post compare (which
      // runs at the record's repoRoot) attributes the change there.
      await withRepo(async (primary) => {
        const secondary = createTestRepo();
        try {
          const sessionId = 'sess-codex-workdir';
          const tuId = 'tu-codex-workdir-1';
          // Both repos commit the same baseline; the hook cwd stays in the
          // primary repo and the envelope's workdir points into the second.
          writeFile(primary.root, 'src/app.ts', P10);
          gitAddCommit(primary.root, 'add app.ts');
          writeFile(secondary.root, 'src/app.ts', P10);
          gitAddCommit(secondary.root, 'add app.ts');
          const logger = new Logger();
          const pre = createSnapshotPreHook();
          const preInputArgs = {
            session_id: sessionId,
            cwd: primary.root,
            tool_use_id: tuId,
            tool_name: 'exec_command',
            tool_input: {
              arguments: JSON.stringify({ cmd: 'npx prettier --write src/app.ts', workdir: secondary.root })
            }
          };
          await pre(preInput(preInputArgs) as never, { logger } as never);
          // The record is anchored at the workdir repo, not the hook cwd.
          const record = createSnapshotStore(logger).find(sessionId, tuId);
          expect(record).not.toBeNull();
          expect(record).not.toBe('tombstoned');
          if (record === null || record === 'tombstoned') throw new Error('record missing');
          expect(record.repoRoot).toBe(secondary.root);
          expect(record.files['src/app.ts']).toBeDefined();
          // The formatter's effect lands in the workdir repo; the primary
          // repo is untouched.
          writeFile(secondary.root, 'src/app.ts', P10_FORMATTED);
          const { executors } = makeExecutors({
            rows: (filePath) =>
              filePath.endsWith('/src/app.ts')
                ? [porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 })]
                : [],
            drift: () => [driftRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 })]
          });
          const handler = createPostToolUseHandler(executors, () => createMemoryMemoStore());
          const raw = await handler(postInput(preInputArgs) as never, { logger } as never);
          // The comparison found the change and attributed it — the touch ran
          // with the workdir repo's file and produced the span block.
          expect(toResult(raw)).toContain('## billing/checkout-request-flow');
          expect(createSnapshotStore(logger).find(sessionId, tuId)).toBe('tombstoned');
        } finally {
          secondary.cleanup();
        }
      });
    });
  });
});

describe('codex harness snapshot lifecycle — wave-E coverage-gap family', () => {
  it('a sibling that hits the touched-files cap persists its cut gap — the consumed-after consult fails closed, never clean', async () => {
    // The phantom-attribution scenario: the sibling's compare cut a changed
    // path at the touched-files cap, so its consume carried no post entry
    // for it. Without a persisted gap, my consumed-after consult would read
    // post(P)=null as "consumed without changing P" and my attribution
    // would absorb the sibling's write. The handler persists compare-phase
    // gaps before consuming, so the cap-cut path reads coverage-unknowable.
    const saved = process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES;
    process.env.GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES = '1';
    try {
      await withRepo(async (repo) => {
        const sessionId = 'sess-codex-capcut';
        const siblingTu = 'tu-capcut-sibling';
        const myTu = 'tu-capcut-mine';
        const command = 'python3 scripts/gen.py';
        writeFile(repo.root, 'src/a.ts', P10);
        writeFile(repo.root, 'src/b.ts', P10);
        gitAddCommit(repo.root, 'add sources');
        const logger = new Logger();
        const pre = createSnapshotPreHook();
        // My capture first: my baseline predates the sibling's window.
        const myInput = preInput({ session_id: sessionId, cwd: repo.root, tool_use_id: myTu, tool_input: { command } });
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
      const sessionId = 'sess-codex-binary';
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
      await createPostToolUseHandler(makeExecutors().executors, () => createMemoryMemoStore())(siblingInput as never, {
        logger
      });
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
        const sessionId = 'sess-codex-partialbudget';
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
