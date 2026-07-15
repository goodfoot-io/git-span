/**
 * Tests for the Codex PreToolUse hook (packages/agent-hooks/src/codex/pre-tool-use.ts).
 *
 * Mirrors the DI fake-executor style of test/claude/pre-tool-use.test.ts: a fake
 * `SpanExecutor` records calls and returns canned porcelain, an in-memory memo
 * dedupes, and an injected `readPreEditFile` supplies pre-edit content so the
 * apply_patch parser recovers a line range. These exercise Job B (surface only)
 * for an apply_patch envelope; no real `git span` is invoked.
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/codex-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadPreEditFile } from '../../src/codex/apply-patch.js';
import hook, { createHandler } from '../../src/codex/pre-tool-use.js';
import type { HookIgnoreLoader } from '../../src/common/span-ignore.js';
import type { MemoFactory, MemoLogger, MemoStore, SpanExecutor, StaleExecutor } from '../../src/common/span-surface.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes (mirrors the Claude DI test helpers)
// ---------------------------------------------------------------------------

interface ExecutorCall {
  args: string[];
  cwd: string;
}

function createFakeExecutor(): {
  executor: SpanExecutor;
  calls: ExecutorCall[];
  setResponse: (key: string, stdout: string) => void;
} {
  const calls: ExecutorCall[] = [];
  const responses = new Map<string, string>();
  const executor: SpanExecutor = (args, cwd) => {
    calls.push({ args, cwd });
    return responses.get(args.join(' ')) ?? '';
  };
  return { executor, calls, setResponse: (key, stdout) => responses.set(key, stdout) };
}

function createMemoryMemoFactory(): { memoFactory: MemoFactory; store: Map<string, Set<string>> } {
  const store = new Map<string, Set<string>>();
  const memoFactory: MemoFactory = (_logger: MemoLogger): MemoStore => ({
    getSurfaced(sessionId) {
      return new Set(store.get(sessionId) ?? []);
    },
    addSurfaced(sessionId, names) {
      const existing = store.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      store.set(sessionId, existing);
    }
  });
  return { memoFactory, store };
}

const noDrift: StaleExecutor = () => '';
const noRules: HookIgnoreLoader = () => [];

// Pre-edit content of foo.ts; the envelope below updates line 3 (gamma).
const PRE_EDIT = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';
const readPreEdit: ReadPreEditFile = () => PRE_EDIT;

/** An apply_patch envelope updating `foo.ts` line 3 (block beta/gamma/delta → lines 2-4). */
function envelope(path = 'foo.ts'): string {
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

function porcelainLine(name: string, path: string, start: number, end: number): string {
  return `${name}\t${path}\t${start}-${end}`;
}

interface HookResult {
  stdout: { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
}

function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

function preInput(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'codex-sess',
    transcript_path: '/tmp/t',
    model: 'gpt-x',
    permission_mode: 'default',
    tool_name: 'apply_patch',
    tool_use_id: 'tu-1',
    turn_id: 'turn-1',
    ...overrides
  };
}

describe('codex pre-tool-use hook registration', () => {
  it('registers PreToolUse with matcher apply_patch', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('apply_patch');
  });
});

describe('codex pre-tool-use surfacing', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('surfaces spans overlapping the apply_patch target range', async () => {
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse('--porcelain foo.ts', porcelainLine('billing/checkout', 'foo.ts', 2, 4));
    setResponse('billing/checkout', 'billing/checkout span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory, noRules, noDrift, readPreEdit);

    const input = preInput({ cwd: repo.root, tool_input: { command: envelope() } });
    const result = toResult(await handler(input as never, { logger }));

    expect(calls[0].args).toEqual(['--porcelain', 'foo.ts']);
    expect(calls[1].args).toEqual(['billing/checkout']);
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('billing/checkout span output');
    expect(result.stdout.systemMessage).toContain('billing/checkout span output');
  });

  it('surfaces via the real reader when process.cwd differs from the payload cwd', async () => {
    // No injected reader: createHandler falls back to defaultReadPreEditFile,
    // which must resolve the hunk path against the payload cwd — not the hook
    // process's process.cwd(). This drives the genuine filesystem read.
    const { executor, setResponse } = createFakeExecutor();
    setResponse('--porcelain foo.ts', porcelainLine('billing/checkout', 'foo.ts', 2, 4));
    setResponse('billing/checkout', 'billing/checkout span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory, noRules, noDrift);

    // Genuine pre-edit content lives in the payload-cwd repo …
    fs.writeFileSync(join(repo.root, 'foo.ts'), PRE_EDIT);
    // … but the hook runs from an unrelated working directory.
    const foreign = makeTempRepo();
    const savedCwd = process.cwd();
    process.chdir(foreign.root);
    try {
      const input = preInput({ cwd: repo.root, tool_input: { command: envelope() } });
      const result = toResult(await handler(input as never, { logger }));
      expect(result.stdout.systemMessage).toContain('billing/checkout span output');
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('billing/checkout span output');
    } finally {
      process.chdir(savedCwd);
      foreign.cleanup();
    }
  });

  it('dedupes a span already surfaced this session', async () => {
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse('--porcelain foo.ts', porcelainLine('billing/checkout', 'foo.ts', 2, 4));
    setResponse('billing/checkout', 'billing/checkout span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory, noRules, noDrift, readPreEdit);

    const input = preInput({ cwd: repo.root, tool_input: { command: envelope() } });

    const first = toResult(await handler(input as never, { logger }));
    expect(first.stdout.systemMessage).toContain('billing/checkout span output');

    const callsBefore = calls.length;
    const second = toResult(await handler(input as never, { logger }));
    // Second call: span already in memo → no render call, no output.
    expect(second.stdout.systemMessage).toBeUndefined();
    expect(calls.length).toBe(callsBefore + 1); // only the porcelain filter call
  });

  it('non-intersecting span is not surfaced', async () => {
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse('--porcelain foo.ts', porcelainLine('far/span', 'foo.ts', 40, 50));
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory, noRules, noDrift, readPreEdit);

    const input = preInput({ cwd: repo.root, tool_input: { command: envelope() } });
    const result = toResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(1); // only the porcelain filter call
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('non-apply_patch tool_input surfaces nothing', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory, noRules, noDrift, readPreEdit);

    const input = preInput({ cwd: repo.root, tool_input: { notCommand: 'x' } });
    const result = toResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});
