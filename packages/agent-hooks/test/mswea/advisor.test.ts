/**
 * Tests for the mini-swe-agent PreToolUse advisor hook
 * (packages/agent-hooks/src/mswea/advisor.ts).
 *
 * The mswea adapter re-registers the Claude adapter's handler with the
 * `'mswea'` harness: its agent has only the bash tool, so the closing
 * instruction must be the inline prose the model can carry out — never the
 * forked-subagent tasking of the `'claude'` default — and its skill guidance
 * travels as the machine-readable placeholder plus the structured
 * `hookSpecificOutput.skillRef` field that the Python bridge substitutes
 * (main-332), never as a Claude Code skill name. The adapter-level
 * translation itself is covered by test/claude/advisor.test.ts; these pin the
 * registration, the harness choice, and the protocol field's presence.
 */

import { Logger } from '@goodfoot/claude-code-hooks';
import { describe, expect, it } from 'vitest';
import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../../src/common/advisor-core.js';
import { GIT_SPAN_SKILL_REF, skillRefToken } from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore } from '../../src/common/bash-attribution.js';
import hook, { createHandler } from '../../src/mswea/advisor.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes (mirrored from test/claude/advisor.test.ts)
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
    hookSpecificOutput?: {
      permissionDecision?: string;
      permissionDecisionReason?: string;
      skillRef?: string;
    };
  };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mswea advisor hook registration', () => {
  it('registers PreToolUse with matcher Bash, like the Claude adapter', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Bash');
  });
});

describe('mswea advisor adapter', () => {
  it('denies a commit carrying semantic drift with the inline instruction', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
    const executors = fakeExecutors({
      list: async () => [porcelainRow()],
      drift: async () => [driftRow('CHANGED')]
    });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Bring the coupled files back into agreement'
    );
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain('then reconcile:');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('forked subagent');
    // Drift closings name no skill at all — no placeholder, no ref field.
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('{{skill-ref:');
    expect(result.stdout.hookSpecificOutput?.skillRef).toBeUndefined();
  });

  it('denies an uncovered-only commit with the inline instruction and the skill-ref field', async () => {
    const git = fakeGit({ stagedPaths: async () => ['src/uncovered.ts', 'src/other.ts'] });
    const executors = fakeExecutors({ list: async () => [], drift: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(
      'Determine if these files carry implicit dependencies, then use `git span` to document them:'
    );
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('Dispatch a forked subagent');
    // main-332 protocol: placeholder line + structured field, never prose.
    expect(result.stdout.hookSpecificOutput?.skillRef).toBe(GIT_SPAN_SKILL_REF);
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).toContain(skillRefToken(GIT_SPAN_SKILL_REF));
    expect(result.stdout.hookSpecificOutput?.permissionDecisionReason).not.toContain('Load the `git-span');
  });

  it('surfaces a status advisory as systemMessage with the skill-ref field alongside', async () => {
    const git = fakeGit({
      stagedPaths: async () => [],
      trackedModifiedPaths: async () => ['src/uncovered.ts', 'src/other.ts']
    });
    const executors = fakeExecutors({ list: async () => [], drift: async () => [] });
    const handler = createHandler(git, executors, sharedMemoFactory());
    const result = toResult(await handler(preInput('git status --short') as never, { logger } as never));

    expect(result.stdout.systemMessage).toContain(skillRefToken(GIT_SPAN_SKILL_REF));
    expect(result.stdout.hookSpecificOutput?.skillRef).toBe(GIT_SPAN_SKILL_REF);
    expect(result.stdout.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('discards a pending static plan when the advisor denies the command', async () => {
    const temp = makeTempLayout();
    try {
      const store = createDefaultPlannedTouchStore(temp.layout);
      store.put({
        version: 1,
        sessionId: 'sess-1',
        toolUseId: 'tu-1',
        repoRoot: '/repo',
        createdAtMs: Date.now(),
        touches: [
          {
            repoRelativePath: 'src/app.ts',
            operation: 'modify',
            ranges: [{ start: 1, end: 1 }],
            simpleCommandIndex: 0
          }
        ]
      });
      const git = fakeGit({ stagedPaths: async () => ['src/app.ts'] });
      const executors = fakeExecutors({
        list: async () => [porcelainRow()],
        drift: async () => [driftRow('CHANGED')]
      });

      const handler = createHandler(git, executors, sharedMemoFactory(), temp.layout);
      const result = toResult(await handler(preInput('git commit -m "wip"') as never, { logger } as never));

      expect(result.stdout.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(store.take('sess-1', 'tu-1')).toEqual({ status: 'consumed' });
    } finally {
      temp.cleanup();
    }
  });
});
