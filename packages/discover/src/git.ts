/**
 * Git subprocess adapter — the only module that spawns processes.
 *
 * The scan and history builders take a {@link GitRunner} parameter so that
 * everything downstream stays pure and testable; production wiring injects
 * {@link defaultGitRunner}.
 *
 * @summary Default GitRunner implementation over execFileSync.
 */

import { execFileSync } from 'node:child_process';
import type { GitRunner } from './types.js';

/**
 * Run `git <args>` in `cwd` and return stdout decoded as UTF-8.
 *
 * Fails closed: a non-zero exit or spawn failure throws (with git's stderr
 * attached by Node), never returning partial output.
 *
 * @param args - Arguments passed directly to git (no shell involved).
 * @param cwd - Directory to run in (the repository root).
 * @returns Complete stdout of the git invocation.
 */
export const defaultGitRunner: GitRunner = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
