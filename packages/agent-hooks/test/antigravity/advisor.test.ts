/**
 * Tests for the Antigravity PreToolUse advisor hook
 * (packages/agent-hooks/src/antigravity/advisor.ts).
 *
 * The adapter narrows the live-verified `run_command` args shape
 * (`{ CommandLine, Cwd }`), drives the shared advisor-core pipeline with
 * injected executors and an in-memory memo, and translates a hold into
 * Antigravity's `{"decision":"deny","reason":…}` PreToolUse reply. Report-only
 * kinds have no allow-with-message channel on this event, so they land in the
 * pending-injection stash for the PostInvocation drain — asserted here
 * through the real disk stash on a temp layout. The debt-classification logic
 * itself is covered by test/common/advisor-core.test.ts.
 */

import { Logger } from '@goodfoot/agent-hooks';
import { afterAll, describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/antigravity/advisor.js';
import { drainPendingInjections } from '../../src/antigravity/stash.js';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  AdvisorScanError,
  type GitExecutor
} from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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

const SPAN = 'billing/checkout-request-flow';
function porcelainRow(path = 'src/app.ts'): PorcelainRow {
  return { name: SPAN, path, start: 1, end: 10 };
}
function driftRow(status: DriftPorcelainRow['status'], path = 'src/app.ts'): DriftPorcelainRow {
  return { name: SPAN, path, start: 1, end: 10, status };
}

let conversationSequence = 0;
function preInput(commandLine: string, conversationId = `agy-adv-${conversationSequence++}`): Record<string, unknown> {
  return {
    conversationId,
    workspacePaths: ['/repo'],
    transcriptPath: '/tmp/t',
    artifactDirectoryPath: '/tmp/a',
    modelName: 'model-x',
    stepIdx: 4,
    toolCall: { name: 'run_command', args: { CommandLine: commandLine, Cwd: '/repo' } }
  };
}

interface HookResult {
  stdout: { decision?: string; reason?: string };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('antigravity advisor hook registration', () => {
  it('registers PreToolUse with matcher run_command', () => {
    expect(hook.eventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('run_command');
  });
});

describe('antigravity advisor adapter', () => {
  it('allows a non-git command silently', async () => {
    const handler = createHandler(fakeGit(), fakeExecutors(), sharedMemoFactory(), layout);
    const result = await handler(preInput('ls -la') as never, { logger } as never);
    expect(result).toBeUndefined();
  });

  it('allows silently when the tool call is not run_command', async () => {
    const handler = createHandler(fakeGit(), fakeExecutors(), sharedMemoFactory(), layout);
    const input = {
      ...preInput('git commit -m x'),
      toolCall: { name: 'write_to_file', args: { TargetFile: '/repo/a.ts' } }
    };
    expect(await handler(input as never, { logger } as never)).toBeUndefined();
  });

  it('denies a commit carrying semantic drift with the checklist as the reason', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), layout);
    const result = toResult(await handler(preInput('git commit -m x') as never, { logger } as never));

    expect(result.stdout.decision).toBe('deny');
    expect(result.stdout.reason).toContain(SPAN);
    // Harness 'generic': the closing must not name another platform's
    // subagent-dispatch vocabulary — Antigravity's own is not pinned anywhere.
    expect(result.stdout.reason).not.toContain('spawn_agent');
    expect(result.stdout.reason).not.toContain('subagent_type');
  });

  it('allows an identical retry after a semantic-drift deny (consider-once per debt-state digest)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), layout);
    const conv = 'agy-adv-retry';

    const first = toResult(await handler(preInput('git commit -m x', conv) as never, { logger } as never));
    expect(first.stdout.decision).toBe('deny');

    const second = await handler(preInput('git commit -m x', conv) as never, { logger } as never);
    expect(second).toBeUndefined();
  });

  it('surfaces an environmental condition by stashing a wrapped block for the PostInvocation drain and allows', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('LFS_NOT_FETCHED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory(), layout);
    const conv = 'agy-adv-env';
    const result = await handler(preInput('git commit -m "wip"', conv) as never, { logger } as never);

    expect(result).toBeUndefined();
    const blocks = drainPendingInjections(layout, conv);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('lfs not fetched');
    expect(blocks[0]?.match(/<git-span>/g)).toHaveLength(1);
  });

  it('surfaces a scan failure by stashing the wrapped error block and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      drift: async () => {
        throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const handler = createHandler(git, executors, sharedMemoFactory(), layout);
    const conv = 'agy-adv-scan';
    const result = await handler(preInput('git commit -m "wip"', conv) as never, { logger } as never);

    expect(result).toBeUndefined();
    const blocks = drainPendingInjections(layout, conv);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('Permission denied');
    expect(blocks[0]).toContain('<git-span-error>');
    expect(blocks[0]?.match(/<git-span>/g)).toHaveLength(1);
  });

  it('never denies `git status` even with real span debt — the checklist is stashed for injection instead', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), layout);
    const conv = 'agy-adv-status';
    const result = await handler(preInput('git status', conv) as never, { logger } as never);

    expect(result).toBeUndefined();
    const blocks = drainPendingInjections(layout, conv);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain(SPAN);
    expect(blocks[0]).not.toContain('then retry');
  });

  it('fails open (allow) when a dependency throws an uncaught error', async () => {
    const git = fakeGit({
      stagedPaths: async () => {
        throw new Error('spawn git ENOENT');
      }
    });
    const handler = createHandler(git, fakeExecutors(), sharedMemoFactory(), layout);
    const conv = 'agy-adv-boom';
    const result = await handler(preInput('git commit -m "wip"', conv) as never, { logger } as never);
    expect(result).toBeUndefined();
    expect(drainPendingInjections(layout, conv)).toEqual([]);
  });
});
