/**
 * Tests for the Claude PostToolUse touch hook
 * (packages/agent-hooks/src/claude/post-tool-use.ts).
 *
 * The adapter translates a Read/Edit/Write tool call into a TouchInput and drives
 * the shared runTouchHook core with injected executors and an in-memory memo.
 * These exercise the adapter's translation and fail-open wiring; the healing /
 * surfacing / cadence logic itself is covered by test/common/touch-core.test.ts.
 */

import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/claude/post-tool-use.js';
import type { PorcelainRow, PorcelainStatus, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  stale?: StalePorcelainRow[];
  fixModified?: boolean;
  reject?: boolean;
}

function makeExecutors(opts: FakeOpts = {}): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; stale: number };
} {
  const calls = { fix: 0, list: 0, stale: 0 };
  const boom = () => {
    throw new Error('spawn git ENOENT');
  };
  const executors: TouchExecutors = {
    fix: async (): Promise<TouchFixResult> => {
      calls.fix += 1;
      if (opts.reject) boom();
      return { modified: opts.fixModified ?? false };
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
  return { name: SPAN, path: 'app.ts', start: 1, end: 10 };
}
function staleRow(status: PorcelainStatus): StalePorcelainRow {
  return { name: SPAN, path: 'app.ts', start: 1, end: 10, status };
}

function postInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: 'sess-1',
    transcript_path: '/tmp/t',
    cwd: '/tmp',
    tool_use_id: 'tu-1',
    tool_name: 'Read',
    tool_input: {},
    tool_response: {},
    ...overrides
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

describe('claude post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher Read|Edit|Write', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('Read|Edit|Write');
  });
});

describe('claude post-tool-use touch signal', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('heals and folds a semantic directive on an Edit, on both output channels', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: join(repo.root, 'app.ts'), old_string: 'a', new_string: 'export const app = 1;\n' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals the tree
    const ctx = result.stdout.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain(SPAN);
    expect(ctx).toContain('CHANGED');
    expect(result.stdout.systemMessage).toContain(SPAN);
  });

  it('never invokes fix on a Read and surfaces nothing for positional-only drift', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('MOVED')] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: join(repo.root, 'app.ts') }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(0); // read path never heals
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('fails open (empty output, no throw) when every executor rejects', async () => {
    const { executors } = makeExecutors({ reject: true });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: join(repo.root, 'app.ts'), content: 'export const app = 1;\n' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('does not run the touch core for an out-of-repo cwd', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], stale: [staleRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: '/',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/some.ts' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.list).toBe(0);
    expect(calls.fix).toBe(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});
