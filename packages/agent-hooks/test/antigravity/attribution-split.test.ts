/**
 * Tests for Antigravity's three-way touch-attribution split
 * (packages/agent-hooks/src/antigravity/{tool-call-stash,static-plan,post-tool-use,post-invocation}.ts).
 *
 * Antigravity's PostToolUse input carries only `stepIdx` and an optional
 * `error` — no tool name, args, or response — so attribution is split across
 * three handlers: PreToolUse stashes the tool call (and plans pre-state),
 * PostToolUse joins on `conversationId:stepIdx` and stashes rendered blocks,
 * and PostInvocation drains those blocks into one ephemeral message. The
 * tests drive the real handlers over real git repos and the real disk stash
 * on a temp layout, with injected touch executors and an in-memory memo.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/agent-hooks';
import { afterAll, describe, expect, it } from 'vitest';
import postInvocationHookEntry, {
  createHandler as createPostInvocationHandler
} from '../../src/antigravity/post-invocation.js';
import postToolUseHookEntry, {
  createHandler as createPostToolUseHandler
} from '../../src/antigravity/post-tool-use.js';
import { stashToolCall } from '../../src/antigravity/stash.js';
import staticPlanHookEntry, { createHandler as createStaticPlanHandler } from '../../src/antigravity/static-plan.js';
import toolCallStashHookEntry, {
  createHandler as createToolCallStashHandler
} from '../../src/antigravity/tool-call-stash.js';
import type { DriftPorcelainRow, PorcelainRow, PorcelainStatus } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fakes and payload builders
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  drift?: DriftPorcelainRow[];
}
function makeExecutors(opts: FakeOpts = {}): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
  fixPaths: string[];
} {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
  const fixPaths: string[] = [];
  const executors = contextExecutors({
    fix: async (filePath) => {
      calls.fix += 1;
      fixPaths.push(filePath);
      return { modified: false };
    },
    list: async (): Promise<PorcelainRow[]> => {
      calls.list += 1;
      return opts.list ?? [];
    },
    drift: async (): Promise<DriftPorcelainRow[]> => {
      calls.drift += 1;
      return opts.drift ?? [];
    },
    why: async (): Promise<string | null> => {
      calls.why += 1;
      return 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';
    }
  });
  return { executors, calls, fixPaths };
}

function inMemoryMemoFactory(): MemoFactory {
  const store = new Map<string, Set<string>>();
  return (_logger: MemoLogger): MemoStore => ({
    getSurfaced: (sid) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid, names, known) => {
      store.set(sid, new Set([...known, ...names]));
    }
  });
}

const SPAN = 'billing/checkout-request-flow';
function driftRow(status: PorcelainStatus, path: string): DriftPorcelainRow {
  return { name: SPAN, path, start: 1, end: 10, status };
}

let conversationSequence = 0;
function freshConversation(): string {
  return `agy-split-${conversationSequence++}`;
}

function base(conversationId: string, cwd: string): Record<string, unknown> {
  return {
    conversationId,
    workspacePaths: [cwd],
    transcriptPath: '/tmp/t',
    artifactDirectoryPath: '/tmp/a',
    modelName: 'model-x'
  };
}

function preInput(conversationId: string, cwd: string, stepIdx: number, commandLine: string): Record<string, unknown> {
  return {
    ...base(conversationId, cwd),
    stepIdx,
    toolCall: { name: 'run_command', args: { CommandLine: commandLine, Cwd: cwd } }
  };
}

function postInput(conversationId: string, cwd: string, stepIdx: number, error?: string): Record<string, unknown> {
  return { ...base(conversationId, cwd), stepIdx, ...(error === undefined ? {} : { error }) };
}

function invocationInput(conversationId: string, cwd: string): Record<string, unknown> {
  return { ...base(conversationId, cwd), invocationNum: 1, initialNumSteps: 0 };
}

function trackAll(root: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('antigravity split hook registrations', () => {
  it('the PreToolUse legs both match run_command; the join and drain register their own events', () => {
    expect(toolCallStashHookEntry.eventName).toBe('PreToolUse');
    expect(toolCallStashHookEntry.matcher).toBe('run_command');
    expect(staticPlanHookEntry.eventName).toBe('PreToolUse');
    expect(staticPlanHookEntry.matcher).toBe('run_command');
    expect(postToolUseHookEntry.eventName).toBe('PostToolUse');
    expect(postToolUseHookEntry.matcher).toBe('run_command');
    expect(postInvocationHookEntry.eventName).toBe('PostInvocation');
  });
});

describe('antigravity three-way attribution split', () => {
  it('stash → join → drain: a write touch surfaces as one ephemeral message on PostInvocation', async () => {
    const repo = makeTempRepo();
    try {
      const conv = freshConversation();
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'hello\n');
      trackAll(repo.root);
      const { executors, fixPaths } = makeExecutors({
        list: [{ name: SPAN, path: 'f.txt', start: 1, end: 10 }],
        drift: [driftRow('CHANGED', 'f.txt')]
      });

      await createToolCallStashHandler(layout)(
        preInput(conv, repo.root, 12, `echo hello > ${filePath}`) as never,
        { logger } as never
      );
      const joinResult = await createPostToolUseHandler(
        executors,
        inMemoryMemoFactory(),
        layout
      )(postInput(conv, repo.root, 12) as never, { logger } as never);

      // The join itself says nothing — PostToolUse has no message channel.
      expect(joinResult).toBeUndefined();
      expect(fixPaths).toEqual([filePath]);

      const drained = (await createPostInvocationHandler(layout)(
        invocationInput(conv, repo.root) as never,
        { logger } as never
      )) as { stdout: { injectSteps?: Array<{ ephemeralMessage?: string }> } };
      expect(drained.stdout.injectSteps).toHaveLength(1);
      expect(drained.stdout.injectSteps?.[0]?.ephemeralMessage).toContain(SPAN);

      // The drain consumed the stash: the next invocation injects nothing.
      const second = await createPostInvocationHandler(layout)(
        invocationInput(conv, repo.root) as never,
        { logger } as never
      );
      expect(second).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('a PostToolUse with no stashed tool call is a silent no-op', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors();
      const result = await createPostToolUseHandler(
        executors,
        inMemoryMemoFactory(),
        layout
      )(postInput(freshConversation(), repo.root, 3) as never, { logger } as never);
      expect(result).toBeUndefined();
      expect(calls.list).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('a stashed non-run_command call does not join', async () => {
    const repo = makeTempRepo();
    try {
      const conv = freshConversation();
      stashToolCall(layout, conv, 5, { name: 'write_to_file', args: { TargetFile: join(repo.root, 'a.ts') } });
      const { executors, calls } = makeExecutors();
      const result = await createPostToolUseHandler(
        executors,
        inMemoryMemoFactory(),
        layout
      )(postInput(conv, repo.root, 5) as never, { logger } as never);
      expect(result).toBeUndefined();
      expect(calls.list).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('the join consumes the stash: a replayed stepIdx no-ops', async () => {
    const repo = makeTempRepo();
    try {
      const conv = freshConversation();
      const filePath = join(repo.root, 'g.txt');
      writeFileSync(filePath, 'x\n');
      trackAll(repo.root);
      const { executors, calls } = makeExecutors();
      const handler = createPostToolUseHandler(executors, inMemoryMemoFactory(), layout);

      await createToolCallStashHandler(layout)(
        preInput(conv, repo.root, 8, `echo y > ${filePath}`) as never,
        { logger } as never
      );
      // Simulate the command actually running: the post-state must be
      // consistent with the redirect or the execution gate drops the touch.
      writeFileSync(filePath, 'y\n');
      await handler(postInput(conv, repo.root, 8) as never, { logger } as never);
      const listCallsAfterFirst = calls.list;
      expect(listCallsAfterFirst).toBeGreaterThan(0);

      await handler(postInput(conv, repo.root, 8) as never, { logger } as never);
      expect(calls.list).toBe(listCallsAfterFirst);
    } finally {
      repo.cleanup();
    }
  });

  it('an `error` on the join still routes through failure attribution (Claude failure-branch parity)', async () => {
    const repo = makeTempRepo();
    try {
      const conv = freshConversation();
      const filePath = join(repo.root, 'h.txt');
      writeFileSync(filePath, 'x\n');
      trackAll(repo.root);
      const { executors, fixPaths } = makeExecutors();

      await createToolCallStashHandler(layout)(
        preInput(conv, repo.root, 9, `echo y > ${filePath}`) as never,
        { logger } as never
      );
      // Post-state is consistent with the redirect: a failed compound command
      // can still have executed its write, so the failure framing
      // (`exitStatus: 1`) must not skip attribution — the layered driver
      // decides what a failed command still touched, exactly as the Claude
      // failure branch does.
      writeFileSync(filePath, 'y\n');
      const result = await createPostToolUseHandler(
        executors,
        inMemoryMemoFactory(),
        layout
      )(postInput(conv, repo.root, 9, 'exit status 1') as never, { logger } as never);

      expect(result).toBeUndefined();
      expect(fixPaths).toEqual([filePath]);
    } finally {
      repo.cleanup();
    }
  });

  it('static pre-plan joins across the split: a planned sed -i modify heals through the stashed call', async () => {
    const repo = makeTempRepo();
    try {
      const conv = freshConversation();
      const filePath = join(repo.root, 's.txt');
      writeFileSync(filePath, 'a\n');
      trackAll(repo.root);
      const command = `sed -i 's/a/b/' ${filePath}`;
      const { executors, fixPaths } = makeExecutors();

      await createStaticPlanHandler(layout)(preInput(conv, repo.root, 21, command) as never, { logger } as never);
      await createToolCallStashHandler(layout)(preInput(conv, repo.root, 21, command) as never, { logger } as never);
      writeFileSync(filePath, 'b\n');

      await createPostToolUseHandler(
        executors,
        inMemoryMemoFactory(),
        layout
      )(postInput(conv, repo.root, 21) as never, { logger } as never);
      expect(fixPaths).toEqual([filePath]);
    } finally {
      repo.cleanup();
    }
  });
});
