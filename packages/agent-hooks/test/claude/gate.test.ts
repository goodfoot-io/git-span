/**
 * Tests for the Claude PreToolUse gate hook
 * (packages/agent-hooks/src/claude/gate.ts).
 *
 * The adapter translates a Bash tool call into the shared gate-core pipeline
 * (parseGitCommand → resolveChangeset → evaluateGate) with injected executors and
 * an in-memory memo, and translates the GateResult into Claude's
 * permissionDecision output. These exercise the adapter's translation and
 * fail-open wiring; the debt-classification logic itself is covered by
 * test/common/gate-core.test.ts.
 */

import { Logger } from '@goodfoot/claude-code-hooks';
import { describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/claude/gate.js';
import type { PorcelainRow, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import { type GateExecutors, type GateMemoState, GateScanError, type GitExecutor } from '../../src/common/gate-core.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeGit(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    stagedPaths: async () => [],
    trackedModifiedPaths: async () => [],
    outgoingPaths: async () => [],
    pathspecPaths: async () => [],
    ...overrides
  };
}

function fakeExecutors(overrides: Partial<GateExecutors> = {}): GateExecutors {
  return {
    fix: async () => {},
    list: async (): Promise<PorcelainRow[]> => [],
    stale: async (): Promise<StalePorcelainRow[]> => [],
    listBlocks: async (): Promise<string> => '',
    ...overrides
  };
}

/** One in-memory GateMemoState reused across every memoFactory(cwd) call. */
function sharedMemoFactory(): (cwd: string) => GateMemoState {
  const digests = new Set<string>();
  const state: GateMemoState = {
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
function staleRow(status: StalePorcelainRow['status'], path = 'src/app.ts'): StalePorcelainRow {
  return { name: SPAN, path, start: 1, end: 10, status };
}

function preInput(command: string): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'sess-1',
    transcript_path: '/tmp/t',
    cwd: '/repo',
    tool_use_id: 'tu-1',
    tool_name: 'Bash',
    tool_input: { command }
  };
}

interface HookResult {
  stdout: {
    systemMessage?: string;
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claude gate hook registration', () => {
  it('registers PreToolUse with matcher Bash', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Bash');
  });
});

describe('claude gate adapter', () => {
  it('allows a non-git command silently (no changeset resolution)', async () => {
    let resolved = false;
    const git = fakeGit({
      stagedPaths: async () => {
        resolved = true;
        return ['src/app.ts'];
      }
    });
    const handler = createHandler(git, fakeExecutors(), sharedMemoFactory());
    const result = toResult(await handler(preInput('ls -la') as never, { logger } as never));

    expect(resolved).toBe(false);
    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('denies a commit carrying semantic staleness, with the checklist as the reason', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      stale: async () => [staleRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(SPAN);
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('To proceed anyway');
    expect(result.stdout.systemMessage).toContain(SPAN);
  });

  it('allows an identical retry after a semantic-staleness deny (consider-once per debt-state digest)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      stale: async () => [staleRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());

    const first = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(first.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');

    const second = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(second.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('allows a clean commit (staged, covered, no drift)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('denies an uncovered-only commit once, then allows the retry (consider-once)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/uncovered.ts'] });
    const executors = fakeExecutors({ list: async () => [], stale: async () => [] });
    const memoFactory = sharedMemoFactory();
    const handler = createHandler(git, executors, memoFactory);

    const first = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(first.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(first.stdout.hookSpecificOutput?.permissionDecisionReason).toContain('src/uncovered.ts');

    const second = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(second.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('surfaces an environmental condition as a transcript-visible systemMessage and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      stale: async () => [staleRow('SPARSE_EXCLUDED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined(); // allowed, not denied
    expect(result.stdout.systemMessage).toContain('sparse excluded');
  });

  it('surfaces a scan failure as a transcript-visible systemMessage and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      stale: async () => {
        throw new GateScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined(); // allowed, not denied
    expect(result.stdout.systemMessage).toContain('Permission denied');
  });

  it('fails open (allow) when a dependency throws an uncaught error', async () => {
    const git = fakeGit({
      stagedPaths: async () => {
        throw new Error('spawn git ENOENT');
      }
    });
    const handler = createHandler(git, fakeExecutors(), sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('never denies `git status` even with real span debt — surfaces the checklist as an advisory systemMessage instead', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      stale: async () => [staleRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toContain(SPAN);
    expect(result.stdout.systemMessage).not.toContain('then retry');
  });

  it('`git status` never consumes the consider-once credit a later `git commit` with the same debt depends on', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      stale: async () => [staleRow('CHANGED')]
    });
    const memoFactory = sharedMemoFactory();
    const handler = createHandler(git, executors, memoFactory);

    const status = toResult(await handler(preInput('git status') as never, { logger } as never));
    expect(status.stdout.hookSpecificOutput).toBeUndefined();

    const commit = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(commit.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows `git status` silently when the changeset is clean', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});
