/**
 * Tests for the OpenCode after-hook touch adapter
 * (packages/agent-hooks/src/opencode/post-tool-use.ts): injection appends to
 * `output.output`, per-tool-id routing, forwarded-report ordering, and the
 * never-throw contract over garbage input.
 *
 * `runTouchHook`/`runTouchHooks` are mocked to record their calls and emit a
 * fixed block — the same seam the cross-adapter contract test uses — while the
 * adapter's routing, tracked-eligibility filtering, frame resolution, and
 * response mapping run against real temp repositories.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { TouchInput } from '../../src/common/touch-core.js';
import { createAfterHandler } from '../../src/opencode/post-tool-use.js';
import type { PatchPlanTouch } from '../../src/opencode/stash.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout, type TempSessionLayout } from '../session-layout-helpers.js';

const BLOCK = '\n<git-span>\ncheckout.tsx has implicit dependencies:\n</git-span>\n';

const { recorded } = vi.hoisted(() => ({ recorded: { calls: [] as TouchInput[] } }));

vi.mock('../../src/common/touch-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/common/touch-core.js')>();
  return {
    ...actual,
    runTouchHook: vi.fn(async (input: TouchInput) => {
      recorded.calls.push(input);
      return { additionalContext: BLOCK.trim(), treeModified: false };
    }),
    runTouchHooks: vi.fn(async (inputs: readonly TouchInput[]) => {
      for (const input of inputs) recorded.calls.push(input);
      return {
        outputs: inputs.map(() => ({ additionalContext: BLOCK.trim(), treeModified: false })),
        treeModified: false,
        diagnostics: {
          queryCount: inputs.length > 0 ? 1 : 0,
          scopeCount: inputs.length,
          selectedResultCount: 0,
          elapsedMs: 0,
          mutation: 'unchanged',
          failure: null
        }
      };
    })
  };
});

function inMemoryMemoFactory() {
  const store = new Map<string, Set<string>>();
  return () => ({
    getSurfaced: (sid: string) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid: string, names: string[], known: ReadonlySet<string>) => {
      store.set(sid, new Set([...known, ...names]));
    }
  });
}

function makeTrackedRepo(): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  writeFileSync(join(repo.root, 'f.ts'), 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n');
  execFileSync('git', ['add', 'f.ts'], { cwd: repo.root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], {
    cwd: repo.root,
    stdio: 'ignore'
  });
  return repo;
}

let sessionSeq = 0;

/** Scratch layouts created by {@link createHandler}, removed after the file. */
const temps: TempSessionLayout[] = [];
afterAll(() => {
  for (const temp of temps) temp.cleanup();
});

function createHandler(overrides: Record<string, unknown> = {}) {
  // A scratch layout keeps the shared planned-touch store OFF the developer's
  // live ~/.cache/git-span/session tree — taking a missing key writes a
  // duplicate-delivery marker, which must never land in production state.
  const temp = makeTempLayout();
  temps.push(temp);
  const state = {
    reports: new Map<string, string>(),
    patchPlans: new Map<string, readonly PatchPlanTouch[]>(),
    shellCwds: new Map<string, string>(),
    forgotten: [] as string[]
  };
  const handler = createAfterHandler({
    directory: '/repo-will-be-overridden',
    layout: temp.layout,
    memoFactory: inMemoryMemoFactory() as never,
    logger: { warn: () => undefined },
    takeReport: (sessionId: string, callId: string) => state.reports.get(`${sessionId}:${callId}`) ?? null,
    takePatchPlan: (sessionId: string, callId: string) => state.patchPlans.get(`${sessionId}:${callId}`) ?? null,
    peekShellCwd: (sessionId: string, callId: string) => state.shellCwds.get(`${sessionId}:${callId}`) ?? null,
    forgetCall: (sessionId: string, callId: string) => state.forgotten.push(`${sessionId}:${callId}`),
    ...overrides
  });
  return { handler, state };
}

describe('opencode after hook — injection appends', () => {
  it('appends a read-touch block to output.output with exactly one separating newline', async () => {
    const repo = makeTrackedRepo();
    try {
      const { handler } = createHandler({ directory: repo.root });
      const output: { output?: string; metadata?: unknown } = { output: 'file contents', metadata: {} };
      await handler({ tool: 'read', sessionID: 's', callID: 'c', args: { filePath: join(repo.root, 'f.ts') } }, output);
      expect(recorded.calls).toEqual([
        expect.objectContaining({ kind: 'read', filePath: join(repo.root, 'f.ts'), cwd: repo.root })
      ]);
      // The mocked core returns the block without its leading newline; the
      // adapter normalizes exactly one separating newline onto the result.
      expect(output.output).toBe(`file contents${BLOCK.trimEnd()}`);
    } finally {
      repo.cleanup();
    }
  });

  it('translates edit/write into write touches carrying the written content and appends their blocks', async () => {
    const repo = makeTrackedRepo();
    try {
      recorded.calls.length = 0;
      const { handler } = createHandler({ directory: repo.root });
      const output: { output?: string } = {};
      await handler(
        {
          tool: 'edit',
          sessionID: 's',
          callID: 'c',
          args: { filePath: join(repo.root, 'f.ts'), oldString: 'x = 1', newString: 'x = 2' }
        },
        output
      );
      expect(recorded.calls[0]).toMatchObject({
        kind: 'write',
        written: 'x = 2',
        targetState: 'exists',
        filePath: join(repo.root, 'f.ts')
      });
      // A write tool call to the tracked file (full-content replacement).
      await handler(
        { tool: 'write', sessionID: 's', callID: 'c2', args: { content: 'body', filePath: join(repo.root, 'f.ts') } },
        {}
      );
      expect(recorded.calls[1]).toMatchObject({ kind: 'write', written: 'body' });
      // Both blocks appended onto the (initially absent) output channel.
      expect(output.output).toContain('<git-span>');
    } finally {
      repo.cleanup();
    }
  });

  it('a forwarded report is appended ahead of touch blocks (stash-and-forward order)', async () => {
    const repo = makeTrackedRepo();
    try {
      recorded.calls.length = 0;
      const sessionId = `fwd-${sessionSeq++}`;
      const reports = new Map([[`${sessionId}:c`, '<git-span>STATUS PREVIEW</git-span>']]);
      const { handler } = createHandler({
        directory: repo.root,
        takeReport: (sid: string, callId: string) => reports.get(`${sid}:${callId}`) ?? null
      });
      const output: { output?: string; metadata?: unknown } = { metadata: { output: '', exit: 0 } };
      await handler(
        { tool: 'bash', sessionID: sessionId, callID: 'c', args: { command: "sed -n '1,2p' f.ts" } },
        output
      );
      expect(recorded.calls.length).toBeGreaterThanOrEqual(1);
      expect(output.output).toContain('STATUS PREVIEW');
      const text = output.output ?? '';
      expect(text.indexOf('STATUS PREVIEW')).toBeLessThan(text.indexOf('<git-span>', text.indexOf('STATUS PREVIEW')));
    } finally {
      repo.cleanup();
    }
  });

  it('a bash call whose mapped response is interrupted still forwards a stashed report', async () => {
    const reports = new Map([['s:c', '<git-span>SCAN FAILED</git-span>']]);
    const { handler } = createHandler({
      takeReport: (sessionId: string, callId: string) => reports.get(`${sessionId}:${callId}`) ?? null
    });
    const output: { output?: string; metadata?: unknown } = { output: '', metadata: { output: '', exit: null } };
    await handler({ tool: 'bash', sessionID: 's', callID: 'c', args: { command: 'git commit -m x' } }, output);
    expect(output.output).toBe('\n<git-span>SCAN FAILED</git-span>');
  });

  it('a consumed report lands even when a later stage throws — reports are never swallowed', async () => {
    const repo = makeTrackedRepo();
    try {
      const sessionId = 'swallow';
      const reports = new Map([[`${sessionId}:c`, '<git-span>ENV ADVISORY</git-span>']]);
      const { handler } = createHandler({
        directory: repo.root,
        takeReport: (sid: string, callId: string) => reports.get(`${sid}:${callId}`) ?? null,
        // Any thrower positioned after the consumption point stands in for the
        // evaluated composition (planned-touch take on degraded ids): the
        // already-consumed advisory must survive it.
        memoFactory: (() => {
          throw new Error('memo exploded');
        }) as never
      });
      const output: { output?: string; metadata?: unknown } = {
        output: 'result text',
        metadata: { output: '', exit: 0 }
      };
      await expect(
        handler({ tool: 'bash', sessionID: sessionId, callID: 'c', args: { command: 'echo hi' } }, output)
      ).resolves.toBeUndefined();
      expect(output.output).toContain('ENV ADVISORY');
      expect((output.output ?? '').startsWith('result text')).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('never throws on garbage input shapes', async () => {
    const { handler } = createHandler();
    await expect(handler(undefined as never, undefined as never)).resolves.toBeUndefined();
    await expect(handler({} as never, {} as never)).resolves.toBeUndefined();
    await expect(
      handler({ tool: 'bash', args: { command: 42 } } as never, { output: 5 } as never)
    ).resolves.toBeUndefined();
    await expect(handler({ tool: 'read', args: null } as never, { output: 'x' } as never)).resolves.toBeUndefined();
  });

  it('an executor that throws fails open without throwing out of the hook', async () => {
    const repo = makeTrackedRepo();
    try {
      recorded.calls.length = 0;
      const { handler } = createHandler({
        directory: repo.root,
        executors: {
          context: () => {
            throw new Error('spawn git ENOENT');
          }
        } as never
      });
      await expect(
        handler({ tool: 'read', sessionID: 's', callID: 'c', args: { filePath: join(repo.root, 'f.ts') } }, {})
      ).resolves.toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});
