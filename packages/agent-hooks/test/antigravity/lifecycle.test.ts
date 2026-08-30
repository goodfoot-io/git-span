/**
 * Tests for the Antigravity lifecycle hooks
 * (packages/agent-hooks/src/antigravity/{pre-invocation,stop}.ts).
 *
 * PreInvocation fires a detached `git span context --warm` framed from the
 * first workspace root and fails open with none; Stop retires only the
 * call-scoped state — the surfaced-span memo must survive, since Antigravity's
 * Stop is a turn-like execution-loop boundary.
 */

import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { Logger } from '@goodfoot/agent-hooks';
import { afterAll, describe, expect, it, vi } from 'vitest';
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

  it('retires call-scoped state, keeps the memo, and never blocks the stop', async () => {
    const conv = 'agy-stop-conv';
    stashToolCall(layout, conv, 2, { name: 'run_command', args: {} });
    appendPendingInjection(layout, conv, 'undrained');
    writeFileSync(layout.memoFile(conv), '{"surfaced":[]}');

    const result = await createStopHandler(layout)(
      {
        ...base(conv, ['/repo']),
        executionNum: 1,
        terminationReason: 'model_stop',
        fullyIdle: true
      } as never,
      { logger } as never
    );

    // Anything but decision "continue" lets the agent stop; undefined prints {}.
    expect(result).toBeUndefined();
    expect(takeToolCall(layout, conv, 2)).toBeNull();
    expect(drainPendingInjections(layout, conv)).toEqual([]);
    expect(existsSync(layout.memoFile(conv))).toBe(true);
  });
});
