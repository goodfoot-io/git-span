/**
 * Tests for the OpenCode advisor before-handler
 * (packages/agent-hooks/src/opencode/advisor.ts): throw-to-hold semantics
 * (decision 1), the memo-driven bare-retry pass, report-kind stash-and-forward
 * (decision 3), frame resolution (decision 4), and whole-body fail-open.
 *
 * The debt-classification logic itself lives in advisor-core and is covered by
 * test/common/advisor-core.test.ts; these tests pin the OpenCode translation:
 * a hold THROWS with the wrapped checklist, environmental/scan-failed/status
 * reports are stashed for the after hook, and nothing but a hold ever rejects.
 */

import { describe, expect, it } from 'vitest';
import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../../src/common/advisor-core.js';
import { AdvisorScanError } from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { createAdvisorHandler, GitSpanHoldError, resolveFrame } from '../../src/opencode/advisor.js';

const SPAN = 'billing/checkout-request-flow';

function fakeGit(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    stagedPaths: async () => [],
    trackedModifiedPaths: async () => [],
    outgoingPaths: async () => ({ paths: [], base: '@{u}' }),
    pathspecPaths: async () => [],
    changedHunks: async () => [],
    ...overrides
  };
}

function fakeExecutors(overrides: Partial<AdvisorExecutors> = {}): AdvisorExecutors {
  return {
    fix: async () => {},
    list: async (): Promise<PorcelainRow[]> => [],
    drift: async (): Promise<DriftPorcelainRow[]> => [],
    listBlocks: async (): Promise<string> => '',
    ...overrides
  };
}

function sharedMemoFactory(): (cwd: string) => AdvisorMemoState {
  const digests = new Set<string>();
  const state: AdvisorMemoState = {
    has: (d) => digests.has(d),
    record: (d) => {
      digests.add(d);
      return true;
    }
  };
  return () => state;
}

function createHandler(
  overrides: { git?: GitExecutor; executors?: AdvisorExecutors; memoFactory?: (cwd: string) => AdvisorMemoState } = {}
) {
  const stashed: { sessionId: string; callId: string; block: string }[] = [];
  const handler = createAdvisorHandler({
    directory: '/repo',
    git: overrides.git ?? fakeGit(),
    executors: overrides.executors ?? fakeExecutors(),
    memoFactory: overrides.memoFactory ?? sharedMemoFactory(),
    stashReport: (sessionId, callId, block) => stashed.push({ sessionId, callId, block })
  });
  return { handler, stashed };
}

function bashInput(command: unknown, workdir?: string) {
  return [
    { tool: 'bash', sessionID: 'sess', callID: 'call-1' },
    { args: { command, ...(workdir === undefined ? {} : { workdir }) } }
  ] as const;
}

describe('opencode advisor — throw-to-hold', () => {
  it('a commit carrying semantic drift throws with the wrapped checklist as the error text', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const { handler } = createHandler({ git, executors });

    const err = await handler(...bashInput('git commit -m x')).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(err).toBeInstanceOf(GitSpanHoldError);
    const message = (err as Error).message;
    expect(message).toContain('<git-span>');
    expect(message).toContain(SPAN);
    // Harness 'opencode': Task-tool dispatch vocabulary, bare skill names.
    expect(message).toContain('Dispatch a subagent with the `task` tool');
    expect(message).toContain('Load the `reconcile` skill via the skill tool in the subagent.');
    expect(message).not.toContain('git-span:reconcile');
  });

  it('an identical bare retry passes silently — the memo recorded the debt state on the hold', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const { handler } = createHandler({ git, executors });

    const first = await handler(...bashInput('git commit -m x')).then(
      () => 'resolved',
      (err: unknown) => (err instanceof GitSpanHoldError ? 'held' : 'other')
    );
    expect(first).toBe('held');

    let secondThrew = false;
    try {
      await handler(...bashInput('git commit -m x'));
    } catch {
      secondThrew = true;
    }
    expect(secondThrew).toBe(false);
  });

  it('never touches non-bash tools or non-git commands', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const { handler, stashed } = createHandler({ git, executors });

    await expect(handler({ tool: 'edit', sessionID: 's', callID: 'c' }, { args: {} })).resolves.toBeUndefined();
    await expect(handler(...bashInput('ls -la'))).resolves.toBeUndefined();
    await expect(handler(...bashInput(null))).resolves.toBeUndefined();
    expect(stashed).toEqual([]);
  });
});

describe('opencode advisor — report kinds stash-and-forward', () => {
  it('stashes an environmental advisory for the after hook and allows', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('LFS_NOT_FETCHED')]
    });
    const { handler, stashed } = createHandler({ git, executors });

    await expect(handler(...bashInput('git commit -m x'))).resolves.toBeUndefined();
    expect(stashed).toHaveLength(1);
    expect(stashed[0]).toMatchObject({ sessionId: 'sess', callId: 'call-1' });
    expect(stashed[0].block).toContain('<git-span>');
  });

  it('stashes a scan-failed warning (fail-open, visible)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      drift: async () => {
        throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const { handler, stashed } = createHandler({ git, executors });

    await expect(handler(...bashInput('git commit -m x'))).resolves.toBeUndefined();
    expect(stashed).toHaveLength(1);
    expect(stashed[0].block).toContain('Permission denied');
    expect(stashed[0].block).toContain('<git-span-error>');
  });

  it('stashes a report-only status preview without retry phrasing', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const { handler, stashed } = createHandler({ git, executors });

    await expect(handler(...bashInput('git status'))).resolves.toBeUndefined();
    expect(stashed).toHaveLength(1);
    expect(stashed[0].block).toContain(SPAN);
    expect(stashed[0].block).not.toContain('Then retry.');
  });
});

describe('opencode advisor — fail-open', () => {
  it('garbage input shapes never reject', async () => {
    const { handler } = createHandler();
    await expect(handler({} as never, {} as never)).resolves.toBeUndefined();
    await expect(handler(undefined as never, undefined as never)).resolves.toBeUndefined();
    await expect(handler(...bashInput({ nested: true }))).resolves.toBeUndefined();
    await expect(handler(...bashInput('git commit -m x'))).resolves.toBeUndefined(); // clean changeset → silent
  });

  it('a dependency that throws resolves to allow — never blocks the tool call', async () => {
    const git = fakeGit({
      stagedPaths: async () => {
        throw new Error('spawn git ENOENT');
      }
    });
    const { handler, stashed } = createHandler({ git });
    await expect(handler(...bashInput('git commit -m x'))).resolves.toBeUndefined();
    expect(stashed).toEqual([]);
  });
});

describe('resolveFrame (decision 4)', () => {
  it('resolves relative workdir against the init directory; absolute passes through; template junk falls back', () => {
    expect(resolveFrame('sub', '/init')).toBe('/init/sub');
    expect(resolveFrame('/abs/repo', '/init')).toBe('/abs/repo');
    expect(resolveFrame(undefined, '/init')).toBe('/init');
    expect(resolveFrame('', '/init')).toBe('/init');
    expect(resolveFrame('${HOME}/x', '/init')).toBe('/init');
    expect(resolveFrame('`cwd`', '/init')).toBe('/init');
  });
});

function porcelainRow(path = 'src/app.ts'): PorcelainRow {
  return { name: SPAN, path, start: 1, end: 10 };
}
function driftRow(status: DriftPorcelainRow['status'], path = 'src/app.ts'): DriftPorcelainRow {
  return { name: SPAN, path, start: 1, end: 10, status };
}
