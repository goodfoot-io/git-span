/**
 * Tests for the Claude PreToolUse advisor hook
 * (packages/agent-hooks/src/claude/advisor.ts).
 *
 * The adapter translates a Bash tool call into the shared advisor-core pipeline
 * (parseGitCommand → resolveChangeset → evaluateAdvisor) with injected executors and
 * an in-memory memo, and translates the AdvisorResult into Claude's
 * permissionDecision output. These exercise the adapter's translation and
 * fail-open wiring; the debt-classification logic itself is covered by
 * test/common/advisor-core.test.ts.
 */

import { Logger } from '@goodfoot/claude-code-hooks';
import { describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/claude/advisor.js';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  AdvisorScanError,
  type GitExecutor
} from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';

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

/** One in-memory AdvisorMemoState reused across every memoFactory(cwd) call. */
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

describe('claude advisor hook registration', () => {
  it('registers PreToolUse with matcher Bash', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Bash');
  });
});

describe('claude advisor adapter', () => {
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

  it('denies a commit carrying semantic drift, with the checklist as the reason', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(SPAN);
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('To proceed anyway');
    // Single channel (main-341): the checklist travels only as
    // permissionDecisionReason — no systemMessage twin.
    expect(result.stdout.systemMessage).toBeUndefined();
    // The adapter passes harness `'claude'`, so the closing instruction names
    // Claude's forked-subagent vocabulary rather than the inline-instruction
    // prose a `'generic'` harness would render.
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Dispatch a forked subagent to bring the coupled files back into agreement'
    );
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Load the `git-span:reconcile` skill in the fork.'
    );
  });

  it('allows an identical retry after a semantic-drift deny (consider-once per debt-state digest)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());

    const first = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(first.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');

    const second = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(second.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('allows a clean commit (staged, covered, no drift)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('denies an uncovered-only commit once, then allows the retry (consider-once)', async () => {
    // Two staged files — a single-file changeset can never carry a cross-file
    // coupling and short-circuits to no uncovered paths.
    const git = fakeGit({ stagedPaths: async () => ['src/uncovered.ts', 'src/other.ts'] });
    const executors = fakeExecutors({ list: async () => [], drift: async () => [] });
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
      drift: async () => [driftRow('SPARSE_EXCLUDED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined(); // allowed, not denied
    expect(result.stdout.systemMessage).toContain('sparse excluded');
  });

  it('surfaces a scan failure as a transcript-visible systemMessage and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      drift: async () => {
        throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined(); // allowed, not denied
    expect(result.stdout.systemMessage).toContain('Permission denied');
    // The failed command's own stderr travels as a delimited artifact of the
    // systemMessage: `<git-span-error>` on its own line, the diagnostic
    // indented beneath it, the closing tag on its own line.
    expect(result.stdout.systemMessage).toContain(
      ['<git-span-error>', '  fatal: unable to read src/app.ts: Permission denied', '</git-span-error>'].join('\n')
    );
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
      drift: async () => [driftRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toContain(SPAN);
    expect(result.stdout.systemMessage).not.toContain('then retry');
  });

  it('`git status` never consumes the one-time hold credit, but marks the state as already-shown so a later `git commit` on the same debt passes instead of denying', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('CHANGED')]
    });
    const memoFactory = sharedMemoFactory();
    const handler = createHandler(git, executors, memoFactory);

    const status = toResult(await handler(preInput('git status') as never, { logger } as never));
    expect(status.stdout.hookSpecificOutput).toBeUndefined();

    // A hold only ever buys one reading of the report — the status preview
    // already explained this debt state in full, so the commit passes
    // silently instead of holding on a state the agent has already been shown.
    const commit = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));
    expect(commit.stdout.hookSpecificOutput).toBeUndefined();
    expect(commit.stdout.systemMessage).toBeUndefined();
  });

  it('allows `git status` silently when the changeset is clean', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput).toBeUndefined();
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});
