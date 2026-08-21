import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startContextWarmup, type WarmupSpawner } from '../../src/common/context-warmup.js';

describe('context service session-start warm-up', () => {
  it('detaches a silent context client with stable service-affecting environment', () => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();
    const spawnProcess = vi.fn(() => child) as unknown as WarmupSpawner;
    const onError = vi.fn();

    startContextWarmup('/repo', onError, spawnProcess);

    expect(spawnProcess).toHaveBeenCalledWith(
      'git',
      ['span', 'context', '--warm'],
      expect.objectContaining({
        cwd: '/repo',
        detached: true,
        env: expect.objectContaining({
          GIT_SPAN_DISABLE_UPDATE_CHECK: '1',
          GIT_SPAN_LOCK_WAIT_SECS: '1'
        }),
        stdio: 'ignore'
      })
    );
    expect(child.unref).toHaveBeenCalledOnce();

    const error = new Error('spawn failed');
    child.emit('error', error);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
