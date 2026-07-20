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
import type { GateExecutors, GateMemoState, GitExecutor } from '../../src/common/gate-core.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeGit(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    stagedPaths: async () => [],
    trackedModifiedPaths: async () => [],
    outgoingPaths: async () => [],
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

  it('bypasses with a transcript-visible systemMessage under GIT_SPAN_GATE=skip', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({ list: async () => [porcelainRow()], stale: async () => [staleRow('CHANGED')] });
    const handler = createHandler(git, executors, sharedMemoFactory(), { GIT_SPAN_GATE: 'skip' });
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.systemMessage).toContain('GIT_SPAN_GATE=skip');
    expect(result.stdout.hookSpecificOutput).toBeUndefined();
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
