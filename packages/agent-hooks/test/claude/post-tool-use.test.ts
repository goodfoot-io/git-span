/**
 * Tests for the Claude PostToolUse touch hook
 * (packages/agent-hooks/src/claude/post-tool-use.ts).
 *
 * The adapter translates a Read/Edit/Write tool call into a TouchInput and drives
 * the shared runTouchHook core with injected executors and an in-memory memo.
 * These exercise the adapter's translation and fail-open wiring; the healing /
 * surfacing / cadence logic itself is covered by test/common/touch-core.test.ts.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/claude/post-tool-use.js';
import type { DriftPorcelainRow, PorcelainRow, PorcelainStatus } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  drift?: DriftPorcelainRow[];
  fixModified?: boolean;
  reject?: boolean;
}

function makeExecutors(opts: FakeOpts = {}): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
} {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
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
    drift: async (): Promise<DriftPorcelainRow[]> => {
      calls.drift += 1;
      if (opts.reject) boom();
      return opts.drift ?? [];
    },
    why: async (): Promise<string | null> => {
      calls.why += 1;
      if (opts.reject) boom();
      return WHY;
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
const WHY = 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';
function porcelainRow(): PorcelainRow {
  return { name: SPAN, path: 'app.ts', start: 1, end: 10 };
}
function driftRow(status: PorcelainStatus): DriftPorcelainRow {
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
  it('registers PostToolUse with matcher Read|Edit|Write|Bash', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('Read|Edit|Write|Bash');
  });
});

describe('claude post-tool-use touch signal', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('heals and folds a semantic directive on an Edit, on both output channels', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
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
    expect(ctx).toContain('— changed');
    expect(result.stdout.systemMessage).toContain(SPAN);
  });

  it('never invokes fix on a Read and surfaces nothing for positional-only drift', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('MOVED')] });
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

  it('scopes a Read to its offset/limit window, not surfacing a span anchored outside it', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    const { executors } = makeExecutors({ list: [{ name: SPAN, path: 'mod.rs', start: 371, end: 387 }] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: filePath, offset: 39, limit: 60 }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('surfaces a span anchored inside a Read offset/limit window', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    const { executors } = makeExecutors({ list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: filePath, offset: 39, limit: 60 }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
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
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
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

  it('surfaces a span covered by a Bash read idiom, without healing', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Bash',
      tool_input: { command: `sed -n '39,60p' ${filePath}` }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(0); // read path never heals
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  it('returns null for a Bash command with no recognized idiom (no executor calls)', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello && git status' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.list).toBe(0);
    expect(calls.fix).toBe(0);
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('a Bash heredoc append is scoped to the written body, not the whole file', async () => {
    const filePath = join(repo.root, 'out.txt');
    // Post-edit state: original two lines + appended three lines.
    writeFileSync(filePath, `${['orig1', 'orig2', 'alpha', 'beta', 'gamma'].join('\n')}\n`);
    const command = `cat >> ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'out.txt', start: 1, end: 2 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals
    // The span anchored at lines 1-2 (original content) is outside the
    // appended body at lines 3-5. With `written: span.body` the touch is
    // scoped to the append range and this span does not surface — proving
    // the body reached the touch core (a whole-file touch would surface it).
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('a Bash heredoc write with the body present surfaces a span inside the written lines', async () => {
    const filePath = join(repo.root, 'out2.txt');
    writeFileSync(filePath, `${['alpha', 'beta', 'gamma'].join('\n')}\n`);
    const command = `cat > ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors } = makeExecutors({
      list: [{ name: SPAN, path: 'out2.txt', start: 1, end: 2 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  it('a Bash heredoc > overwrite surfaces a span truncated beyond the new EOF (whole-file scope)', async () => {
    const filePath = join(repo.root, 'out3.txt');
    // Post-edit state: the heredoc wrote only 3 lines, down from 10.
    writeFileSync(filePath, `${['alpha', 'beta', 'gamma'].join('\n')}\n`);
    const command = `cat > ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'out3.txt', start: 8, end: 10 }],
      drift: [driftRow('DELETED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory());
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals
    // The span at lines 8-10 was beyond the new EOF (3 lines). With
    // `written: ''` (whole-file scope from `redirect: '>'`) the touch core
    // surfaces it as deleted — previously this was silent because the body
    // was not threaded into the touch.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });
});
