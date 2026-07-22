/**
 * Tests for the Codex PostToolUse touch hook
 * (packages/agent-hooks/src/codex/post-tool-use.ts).
 *
 * The adapter narrows the confirmed apply_patch envelope into per-file anchors
 * and drives the shared runTouchHook core (whole-file scoped — Codex never
 * recovers a post-edit range) with injected executors and an in-memory memo. It
 * preserves the success-classification belt: a confirmed rejection suppresses
 * the touch, an unrecognized shape proceeds with a warning.
 *
 * Success fixtures are built by {@link printSummary}, mirroring Codex's real
 * `print_summary` (header `Success. Updated the following files:` then
 * `A/M/D <path>` lines) rather than pasting the literal the detector checks for.
 */

import { Logger } from '@goodfoot/codex-hooks';
import { describe, expect, it } from 'vitest';
import hook, { classifyApplyPatchResponse, createHandler } from '../../src/codex/post-tool-use.js';
import type { PorcelainRow, PorcelainStatus, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

function printSummary(paths: { added?: string[]; modified?: string[]; deleted?: string[] }): string {
  const lines = ['Success. Updated the following files:'];
  for (const p of paths.added ?? []) lines.push(`A ${p}`);
  for (const p of paths.modified ?? []) lines.push(`M ${p}`);
  for (const p of paths.deleted ?? []) lines.push(`D ${p}`);
  return `${lines.join('\n')}\n`;
}

const SUCCESS_RESPONSE = printSummary({ modified: ['foo.ts'] });
const FAILURE_RESPONSE = 'apply_patch verification failed: context not found in foo.ts';

/** Update `foo.ts` (block beta/gamma/delta). */
function updateEnvelope(path = 'foo.ts'): string {
  return [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@',
    ' beta',
    '-gamma',
    '+GAMMA',
    ' delta',
    '*** End Patch'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  stale?: StalePorcelainRow[];
  reject?: boolean;
}
function makeExecutors(opts: FakeOpts = {}): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; stale: number; why: number };
} {
  const calls = { fix: 0, list: 0, stale: 0, why: 0 };
  const boom = () => {
    throw new Error('spawn git ENOENT');
  };
  const executors: TouchExecutors = {
    fix: async (): Promise<TouchFixResult> => {
      calls.fix += 1;
      if (opts.reject) boom();
      return { modified: false };
    },
    list: async (): Promise<PorcelainRow[]> => {
      calls.list += 1;
      if (opts.reject) boom();
      return opts.list ?? [];
    },
    stale: async (): Promise<StalePorcelainRow[]> => {
      calls.stale += 1;
      if (opts.reject) boom();
      return opts.stale ?? [];
    },
    why: async (): Promise<string | null> => {
      calls.why += 1;
      if (opts.reject) boom();
      return 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';
    }
  };
  return { executors, calls };
}

function inMemoryMemoFactory(): MemoFactory {
  const store = new Map<string, Set<string>>();
  return (_logger: MemoLogger): MemoStore => ({
    getSurfaced: (sid) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid, names) => {
      const s = store.get(sid) ?? new Set<string>();
      for (const n of names) s.add(n);
      store.set(sid, s);
    }
  });
}

const SPAN = 'billing/checkout-request-flow';
function porcelainRow(): PorcelainRow {
  return { name: SPAN, path: 'foo.ts', start: 1, end: 10 };
}
function staleRow(status: PorcelainStatus): StalePorcelainRow {
  return { name: SPAN, path: 'foo.ts', start: 1, end: 10, status };
}

function warnCapturingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const capture = new Logger();
  capture.on('warn', (event) => warnings.push(event.message));
  return { logger: capture, warnings };
}

function postInput(cwd: string, command: unknown, toolResponse: unknown = SUCCESS_RESPONSE): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: 'codex-sess',
    cwd,
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t',
    tool_name: 'apply_patch',
    tool_input: { command },
    tool_response: toolResponse,
    tool_use_id: 'tu-1',
    turn_id: 'turn-1'
  };
}

interface HookResult {
  stdout: { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('codex post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher apply_patch', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('apply_patch');
  });
});

describe('classifyApplyPatchResponse', () => {
  it('classifies a bare-string success as success', () => {
    expect(classifyApplyPatchResponse(SUCCESS_RESPONSE)).toBe('success');
    expect(classifyApplyPatchResponse({ output: SUCCESS_RESPONSE })).toBe('success');
  });
  it('classifies recovered-but-headerless text as failure', () => {
    expect(classifyApplyPatchResponse(FAILURE_RESPONSE)).toBe('failure');
    expect(classifyApplyPatchResponse('')).toBe('failure');
  });
  it('classifies an unrecoverable shape as unknown', () => {
    expect(classifyApplyPatchResponse({})).toBe('unknown');
    expect(classifyApplyPatchResponse(null)).toBe('unknown');
  });
});

describe('codex post-tool-use touch signal', () => {
  it('heals and surfaces a semantic directive on a confirmed apply', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, updateEnvelope()) as never, { logger } as never));

      expect(calls.fix).toBe(1);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
      expect(result.stdout.systemMessage).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('suppresses the touch entirely on a confirmed rejection (no executor calls, no warn)', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(
        await handler(postInput(repo.root, updateEnvelope(), FAILURE_RESPONSE) as never, { logger: capture } as never)
      );

      expect(calls.fix).toBe(0);
      expect(calls.list).toBe(0);
      expect(warnings).toHaveLength(0);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('runs the touch (and warns) when the tool_response shape is unrecognized', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler(executors, inMemoryMemoFactory());
      await handler(postInput(repo.root, updateEnvelope(), { exitCode: 0 }) as never, { logger: capture } as never);

      expect(calls.fix).toBe(1);
      expect(warnings.some((m) => m.includes('unrecognized'))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open (empty output, no throw) when every executor rejects', async () => {
    const repo = makeTempRepo();
    try {
      const { executors } = makeExecutors({ reject: true });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, updateEnvelope()) as never, { logger } as never));
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(result.stdout.systemMessage).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('surfaces nothing for a non-apply_patch tool_input', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, undefined) as never, { logger } as never));
      // narrowApplyPatchCommand rejects a missing command → no touch.
      expect(calls.fix).toBe(0);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});
