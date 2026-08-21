/** Fire-and-forget context-service warm-up shared by interactive harnesses. */

import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';

export type WarmupSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => Pick<ChildProcess, 'on' | 'unref'>;

/**
 * Start a detached context client. The client owns cold-start and generation
 * work after the hook exits; the session-start critical path only pays spawn.
 */
export function startContextWarmup(
  cwd: string,
  onError: (error: Error) => void,
  spawnProcess: WarmupSpawner = spawn
): void {
  const child = spawnProcess('git', ['span', 'context', '--warm'], {
    cwd,
    detached: true,
    env: {
      ...process.env,
      GIT_SPAN_DISABLE_UPDATE_CHECK: '1',
      GIT_SPAN_LOCK_WAIT_SECS: '1'
    },
    stdio: 'ignore'
  });
  child.on('error', onError);
  child.unref();
}
