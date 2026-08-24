/**
 * Tests for the Codex PreToolUse advisor hook
 * (packages/agent-hooks/src/codex/advisor.ts).
 *
 * The adapter narrows Codex's `unknown` shell tool_input into a command string,
 * drives the shared advisor-core pipeline with injected executors and an in-memory
 * memo, and translates the AdvisorResult into Codex's permissionDecision output
 * (the hard-deny path this build ships). The debt-classification logic itself is
 * covered by test/common/advisor-core.test.ts.
 */

import { Logger } from '@goodfoot/codex-hooks';
import { describe, expect, it } from 'vitest';
import hook, { createHandler, extractShellCommand } from '../../src/codex/advisor.js';
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

function preInput(command: unknown): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'codex-sess',
    cwd: '/repo',
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t',
    tool_name: 'shell',
    tool_input: { command },
    tool_use_id: 'tu-1',
    turn_id: 'turn-1'
  };
}

interface HookResult {
  stdout: {
    systemMessage?: string;
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
  };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('codex advisor hook registration', () => {
  it('registers PreToolUse and matches the plausible shell tool names', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Bash|shell|exec|local_shell');
  });
});

describe('extractShellCommand', () => {
  it('returns a bare command string as-is', () => {
    expect(extractShellCommand({ command: 'git commit -m "wip"' })).toBe('git commit -m "wip"');
  });
  it('extracts the script from a `bash -lc <script>` argv', () => {
    expect(extractShellCommand({ command: ['bash', '-lc', 'git push'] })).toBe('git push');
  });
  it('space-joins a direct argv', () => {
    expect(extractShellCommand({ command: ['git', 'commit', '-m', 'wip'] })).toBe('git commit -m wip');
  });
  it('returns null when no command text is recoverable', () => {
    expect(extractShellCommand({})).toBeNull();
    expect(extractShellCommand(null)).toBeNull();
    expect(extractShellCommand({ command: '' })).toBeNull();
  });
});

describe('codex advisor adapter', () => {
  it('allows a non-git command silently', async () => {
    const handler = createHandler(fakeGit(), fakeExecutors(), sharedMemoFactory());
    const result = toResult(await handler(preInput('ls -la') as never, { logger } as never));
    expect(result.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('hard-denies a commit carrying semantic drift (README-documented path)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(SPAN);
    // Single channel (main-341): the checklist travels only as
    // permissionDecisionReason — no systemMessage twin.
    expect(result.stdout.systemMessage).toBeUndefined();
    // The adapter passes harness `'codex'`, so the closing instruction names
    // Codex's forked-subagent vocabulary rather than the inline-instruction
    // prose a `'generic'` harness would render.
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`'
    );
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Load the `git-span:reconcile` skill in the fork.'
    );
  });

  it('with hard-deny disabled, a semantic-drift deny becomes a loud allow: additionalContext carries the warning and no permissionDecision is set', async () => {
    // Exercises the CARD.md-documented fallback branch (CODEX_ADVISOR_HARD_DENY =
    // false): when deny is not trusted to block live, the same checklist is
    // surfaced as a loud warning and the command is allowed through, with the CI
    // recipe as Codex's enforcement backstop. Nothing must set a deny decision.
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), false);
    const result = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));

    // Allowed through — the fallback cannot block.
    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    // But loudly, and on one channel only (main-341): the context surface
    // carries the warning + checklist, with no systemMessage twin.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('Could not block');
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('allows an identical retry after a semantic-drift deny (consider-once per debt-state digest)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory());

    const first = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));
    expect(first.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');

    const second = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));
    expect(second.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('surfaces an environmental condition as additional context and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('LFS_NOT_FETCHED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('lfs not fetched');
  });

  it('surfaces a scan failure as additionalContext and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      drift: async () => {
        throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    const block = [
      '<git-span-error>',
      '  fatal: unable to read src/app.ts: Permission denied',
      '</git-span-error>'
    ].join('\n');
    // Single delivery channel (main-341): the wrapped `additionalContext`
    // carries the tagged block, and no `systemMessage` twin is emitted.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('Permission denied');
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('<git-span>');
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(block);
    expect(result.stdout.systemMessage).toBeUndefined();
    // The wrap is applied exactly once: the outer `<git-span>` tag appears
    // once — the inner `<git-span-error>` block cannot trip the
    // no-double-wrap guard, so it is not wrapped again.
    expect(result.stdout.hookSpecificOutput?.additionalContext?.match(/<git-span>/g)).toHaveLength(1);
    expect(result.stdout.hookSpecificOutput?.additionalContext?.match(/<git-span-error>/g)).toHaveLength(1);
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
  });

  it('never denies `git status` even with real span debt — surfaces the checklist as additionalContext instead', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    expect(result.stdout.hookSpecificOutput?.additionalContext).not.toContain('then retry');
    // Single channel (main-341): no systemMessage twin.
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('`git status` never consumes the one-time hold credit, but marks the state as already-shown so a later `git commit` on the same debt passes instead of denying', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], drift: async () => [driftRow('CHANGED')] });
    const memoFactory = sharedMemoFactory();
    const handler = createHandler(git, executors, memoFactory);

    const status = toResult(await handler(preInput('git status') as never, { logger } as never));
    expect(status.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();

    // A hold only ever buys one reading of the report — the status preview
    // already explained this debt state in full, so the commit passes
    // silently instead of holding on a state the agent has already been shown.
    const commit = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));
    expect(commit.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
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
