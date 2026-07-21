/**
 * Tests for the Codex PreToolUse gate hook
 * (packages/agent-hooks/src/codex/gate.ts).
 *
 * The adapter narrows Codex's `unknown` shell tool_input into a command string,
 * drives the shared gate-core pipeline with injected executors and an in-memory
 * memo, and translates the GateResult into Codex's permissionDecision output
 * (the hard-deny path this build ships). The debt-classification logic itself is
 * covered by test/common/gate-core.test.ts.
 */

import { Logger } from '@goodfoot/codex-hooks';
import { describe, expect, it } from 'vitest';
import hook, { createHandler, extractShellCommand } from '../../src/codex/gate.js';
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
    ...overrides
  };
}

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

describe('codex gate hook registration', () => {
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

describe('codex gate adapter', () => {
  it('allows a non-git command silently', async () => {
    const handler = createHandler(fakeGit(), fakeExecutors(), sharedMemoFactory());
    const result = toResult(await handler(preInput('ls -la') as never, { logger } as never));
    expect(result.stdout.hookSpecificOutput).toBeUndefined();
  });

  it('hard-denies a commit carrying semantic staleness (README-documented path)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [staleRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(SPAN);
    expect(result.stdout.systemMessage).toContain(SPAN);
  });

  it('with hard-deny disabled, a semantic-staleness deny becomes a loud allow: additionalContext + systemMessage carry the warning and no permissionDecision is set', async () => {
    // Exercises the CARD.md-documented fallback branch (CODEX_GATE_HARD_DENY =
    // false): when deny is not trusted to block live, the same checklist is
    // surfaced as a loud warning and the command is allowed through, with the CI
    // recipe as Codex's enforcement backstop. Nothing must set a deny decision.
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [staleRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), false);
    const result = toResult(await handler(preInput(['bash', '-lc', 'git commit -m x']) as never, { logger } as never));

    // Allowed through — the fallback cannot block.
    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    // But loudly, transcript-visibly: both surfaces carry the warning + checklist.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('could not block');
    expect(result.stdout.systemMessage).toContain(SPAN);
    expect(result.stdout.systemMessage).toContain('could not block');
  });

  it('allows an identical retry after a semantic-staleness deny (consider-once per debt-state digest)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [staleRow('CHANGED')] });
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
      stale: async () => [staleRow('LFS_NOT_FETCHED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.stdout.systemMessage).toContain('LFS_NOT_FETCHED');
  });

  it('surfaces a scan failure as additionalContext + systemMessage and allows (fail-open)', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      stale: async () => {
        throw new GateScanError('fatal: unable to read src/app.ts: Permission denied');
      }
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('Permission denied');
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
  });
});
