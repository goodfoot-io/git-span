import { execFileSync } from 'node:child_process';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
/**
 * Tests for the Antigravity lifecycle hooks
 * (packages/agent-hooks/src/antigravity/{pre-invocation,stop}.ts).
 *
 * PreInvocation fires a detached `git span context --warm` framed from the
 * first workspace root and fails open with none; Stop retires only the
 * call-scoped state — the surfaced-span memo must survive, since Antigravity's
 * Stop is a turn-like execution-loop boundary.
 */

import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@goodfoot/agent-hooks';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import preInvocationHookEntry, {
  createHandler as createPreInvocationHandler
} from '../../src/antigravity/pre-invocation.js';
import {
  appendPendingInjection,
  drainPendingInjections,
  stashToolCall,
  takeToolCall
} from '../../src/antigravity/stash.js';
import stopHookEntry, { createHandler as createStopHandler } from '../../src/antigravity/stop.js';
import type { WarmupSpawner } from '../../src/common/context-warmup.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

const logger = new Logger();

function base(conversationId: string, workspacePaths: string[]): Record<string, unknown> {
  return {
    conversationId,
    workspacePaths,
    transcriptPath: '/tmp/t',
    artifactDirectoryPath: '/tmp/a',
    modelName: 'model-x'
  };
}

describe('antigravity pre-invocation warm-up', () => {
  beforeEach(() => vi.stubEnv('PATH', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('registers PreInvocation', () => {
    expect(preInvocationHookEntry.eventName).toBe('PreInvocation');
  });

  it('spawns a detached warm-up framed from the first workspace root', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();
    const spawner = vi.fn(() => child) as unknown as WarmupSpawner;

    const result = await createPreInvocationHandler(spawner)(
      { ...base('agy-warm', ['/repo', '/other']), invocationNum: 1, initialNumSteps: 0 } as never,
      { logger } as never
    );

    expect(result).toBeUndefined();
    expect(spawner).toHaveBeenCalledWith(
      'git',
      ['span', 'context', '--warm'],
      expect.objectContaining({ cwd: '/repo', detached: true, stdio: 'ignore' })
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('fails open with no workspace paths: nothing is spawned', async () => {
    const spawner = vi.fn() as unknown as WarmupSpawner;
    const result = await createPreInvocationHandler(spawner)(
      { ...base('agy-warm-empty', []), invocationNum: 1, initialNumSteps: 0 } as never,
      { logger } as never
    );
    expect(result).toBeUndefined();
    expect(spawner).not.toHaveBeenCalled();
  });
});

describe('antigravity stop cleanup', () => {
  it('registers Stop', () => {
    expect(stopHookEntry.eventName).toBe('Stop');
  });

  it('requests review once, then retires call-scoped state and keeps the memo', async () => {
    const conv = 'agy-stop-conv';
    stashToolCall(layout, conv, 2, { name: 'run_command', args: {} });
    appendPendingInjection(layout, conv, 'undrained');
    writeFileSync(layout.memoFile(conv), '{"surfaced":[]}');

    const input = {
      ...base(conv, ['/repo']),
      executionNum: 1,
      terminationReason: 'model_stop',
      fullyIdle: true
    };
    const result = await createStopHandler(layout, async () => ({ kind: 'matching', repositories: [] }))(
      input as never,
      { logger }
    );
    expect(result?.stdout.decision).toBe('continue');
    expect(result?.stdout.reason).toContain('Load the review-notes skill');
    expect(result?.stdout.reason).toContain('forked subagent');
    expect(existsSync(layout.memoFile(conv))).toBe(true);

    // A new handler models the next one-shot hook process; cleanup leaves its guard intact.
    expect(
      await createStopHandler(layout, async () => ({ kind: 'matching', repositories: [] }))(
        { ...input, executionNum: 2 } as never,
        { logger }
      )
    ).toBeUndefined();
    expect(takeToolCall(layout, conv, 2)).toBeNull();
    expect(drainPendingInjections(layout, conv)).toEqual([]);
    expect(existsSync(layout.memoFile(conv))).toBe(true);
    expect(
      await createStopHandler(layout, async () => ({ kind: 'matching', repositories: [] }))(
        { ...input, executionNum: 3 } as never,
        { logger }
      )
    ).toBeUndefined();
  });

  it('skips empty notes, cleans call state, and leaves the review guard unclaimed', async () => {
    const conv = 'empty-notes';
    stashToolCall(layout, conv, 2, { name: 'run_command', args: {} });
    const input = { ...base(conv, ['/repo']), executionNum: 1, terminationReason: 'model_stop', fullyIdle: true };
    expect(
      await createStopHandler(layout, async () => ({ kind: 'empty' }))(input as never, { logger })
    ).toBeUndefined();
    expect(takeToolCall(layout, conv, 2)).toBeNull();
    expect(existsSync(join(layout.dir(conv), 'antigravity-note-review-requested'))).toBe(false);
    expect(
      (
        await createStopHandler(layout, async () => ({ kind: 'matching', repositories: [] }))(input as never, {
          logger
        })
      )?.stdout.decision
    ).toBe('continue');
  });

  it('reports lookup failure without forcing another invocation or consuming its guard', async () => {
    const conv = 'lookup-failure';
    const input = { ...base(conv, ['/repo']), executionNum: 1, terminationReason: 'model_stop', fullyIdle: true };
    const check = vi.fn(async () => ({ kind: 'failure' as const, reason: 'notes timeout' }));
    const handler = createStopHandler(layout, check);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await handler(input as never, { logger });
      expect(result?.stdout.reason).toBe('git-span could not read commit notes: notes timeout');
      expect(result?.stdout.decision).not.toBe('continue');
    }
    expect(existsSync(join(layout.dir(conv), 'antigravity-note-review-requested'))).toBe(false);
  });

  it.each([
    { terminationReason: 'error', fullyIdle: true },
    { terminationReason: 'max_steps_exceeded', fullyIdle: true },
    { terminationReason: 'model_stop', fullyIdle: false },
    { terminationReason: 'model_stop', fullyIdle: true, error: 'cancelled' }
  ])('does not resume an abnormal or busy stop: %j', async (state) => {
    const input = { ...base(`skip-${JSON.stringify(state)}`, ['/repo']), executionNum: 1, ...state };
    expect(
      await createStopHandler(layout, async () => ({ kind: 'matching', repositories: [] }))(input as never, { logger })
    ).toBeUndefined();
  });

  it('the emitted hook guard survives separate processes', () => {
    const input = {
      ...base('agy-emitted-review', [temp.parent]),
      executionNum: 1,
      terminationReason: 'model_stop',
      fullyIdle: true
    };
    execFileSync('git', ['init', '-q', temp.parent]);
    execFileSync('git', [
      '-C',
      temp.parent,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'fixture'
    ]);
    const command = resolveGitSpanCommand(['notes', 'add', 'HEAD', '--format', 'json'], temp.parent);
    execFileSync(command.executable, command.argv, {
      cwd: temp.parent,
      input: JSON.stringify({ session_id: 'agy-emitted-review' })
    });
    const bundle = resolve('../../plugins-antigravity/git-span/bin/stop.mjs');
    const run = () =>
      spawnSync(process.execPath, [bundle], {
        input: JSON.stringify(input),
        encoding: 'utf8',
        env: { ...process.env, HOME: temp.parent }
      });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(JSON.parse(first.stdout)).toMatchObject({
      decision: 'continue',
      reason: expect.stringContaining('Load the review-notes skill')
    });
    for (let i = 0; i < 2; i++) {
      const continuation = run();
      expect(continuation.status).toBe(0);
      expect(continuation.stderr).toBe('');
      expect(JSON.parse(continuation.stdout)).toEqual({});
    }
  });
});
