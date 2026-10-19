import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultTouchExecutors } from '../../src/common/touch-core.js';
import {
  addLineSpan,
  buildWorkspaceGitSpan,
  commitRepo,
  makeRealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

let pathDir: string;

/** A separate process releases the lock while the executor blocks Node's event loop. */
async function holdRecoveryLock(root: string) {
  const holder = spawn(
    'flock',
    ['-x', join(root, '.git/span/recovery-domain.lock'), 'sh', '-c', 'printf ready; sleep 2'],
    {
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  await Promise.race([
    once(holder.stdout, 'data'),
    once(holder, 'error').then(([error]) => Promise.reject(error)),
    once(holder, 'exit').then(([code]) =>
      Promise.reject(new Error(`lock holder exited before readiness: ${String(code)}`))
    )
  ]);
  return holder;
}

describe('real context executor recovery wait', () => {
  beforeAll(() => {
    pathDir = buildWorkspaceGitSpan().pathDir;
  }, 600_000);

  for (const repair of [false, true]) {
    it(`waits through a transient recovery lock for ${repair ? 'repair' : 'read'} within the hook deadline`, async () => {
      const repo = makeRealBundleRepo(pathDir);
      const saved = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_SPAN_LOCK_WAIT_SECS: process.env.GIT_SPAN_LOCK_WAIT_SECS
      };
      let holder: Awaited<ReturnType<typeof holdRecoveryLock>> | undefined;
      try {
        writeRepoFile(repo, 'file.txt', 'first\nsecond\n');
        commitRepo(repo, 'seed');
        addLineSpan(repo, 'bounded', 'file.txt', 1, 1, 'Keep context responsive.');
        commitRepo(repo, 'anchor');
        process.env.PATH = repo.env.PATH;
        process.env.HOME = repo.env.HOME;
        delete process.env.GIT_SPAN_LOCK_WAIT_SECS;
        holder = await holdRecoveryLock(repo.root);
        const request = { repoRoot: repo.root, addresses: ['file.txt#L1-L1'] };
        const result = await createDefaultTouchExecutors().context(
          repair
            ? { ...request, repair: true, operationId: '97c54cf3-0c01-41a1-ab52-b6168d40442f' }
            : { ...request, repair: false }
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.elapsedMs).toBeLessThan(4500);
        if (result.ok) {
          expect(result.document.spans.map((span) => span.name)).toEqual(['bounded']);
          expect(result.document.mutation.requested).toBe(repair);
        }
      } finally {
        holder?.kill();
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        repo.cleanup();
      }
    });
  }
});
