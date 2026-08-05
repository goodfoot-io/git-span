/**
 * Skipped acceptance checks for the Codex harness snapshot lifecycle (card
 * main-213, Phase 2): the same lifecycle as the Claude harness (card's plan),
 * through the committed codex adapter modules (src/codex/snapshot.ts,
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
 * Phase 1 shipped the contract surfaces as `Not Implemented` stubs — none of
 * these tests run today (`describe.skip`); Phase 3 implements the stubs and
 * unskips them one by one. Fixtures that need the real `git span` CLI are
 * additionally gated with `it.skipIf(!hasGitSpan)`, mirroring
 * porcelain-contract.test.ts. The ambiguity-table rows and the activity-log
 * interleaving outcomes are shared infrastructure covered in the Claude
 * lifecycle file; this file mirrors the essential concurrency cases and the
 * never-flag / bounded-double / unfinished ordering outcomes.
 */

import { execFileSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/codex-hooks';
import { describe, expect, it } from 'vitest';
import { createHandler as createPostToolUseHandler } from '../../src/codex/post-tool-use.js';
import { createHandler as createSnapshotPreHook } from '../../src/codex/snapshot.js';
import stopHook from '../../src/codex/stop.js';
import subagentStopHook from '../../src/codex/subagent-stop.js';
import { applyAmbiguityRules, DEFAULT_SNAPSHOT_BUDGETS, type SnapshotRecord } from '../../src/common/snapshot-core.js';
import {
  type ActivityEntry,
  activityEntriesCovering,
  appendActivityEntry,
  createSnapshotStore
} from '../../src/common/snapshot-store.js';
import {
  addSpan,
  BASE_NOW,
  createMemoryMemoStore,
  createTestRepo,
  driftRow,
  gitAddCommit,
  makeExecutors,
  makeFile,
  makeRecord,
  porcelainRow,
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
    coverageGap: record.gaps.length > 0,
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
// Skipped acceptance checks
// ---------------------------------------------------------------------------

describe.skip('codex harness snapshot lifecycle (Phase 2 — skipped)', () => {
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
          expect(block).toContain('src/app.ts#L1-L5');
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
        expect(block).toContain('src/app.ts#L1-L5');
        // The new path carries nothing — the CLI fails the path match and the
        // executor fail-opens to an empty row set.
        expect(() =>
          execFileSync('git', ['span', 'list', '--porcelain', 'src/app2.ts'], { cwd: repo.root, encoding: 'utf8' })
        ).toThrow();
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
        const raw = await subagentStopHook(subagentStopInput(sessionId, 'sub-1') as never, { logger } as never);
        expect(raw).toBeUndefined();
        expect(store.find(sessionId, 'tu-sub-1')).toBeNull();
        expect(store.find(sessionId, 'tu-sub-2')).toBeNull();
        // The main session's records are left for the Stop hook.
        expect(store.find(sessionId, 'tu-main-1')).not.toBeNull();
        expect(store.listRepoRecords(repo.root).filter((e) => e.sessionId === sessionId)).toHaveLength(1);
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
});
