import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultGitRunner } from '../../src/common/snapshot-harness.js';
import { makeTempRepo } from '../helpers.js';

/**
 * defaultGitRunner's environment contract: ambient repo-location GIT_*
 * overrides must never repoint a snapshot call, while the harness's own
 * per-call env still merges on top.
 */
describe('defaultGitRunner — ambient GIT_* location overrides are stripped (main-228)', () => {
  const saved = new Map<string, string | undefined>();
  const setAmbient = (key: string, value: string): void => {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    process.env[key] = value;
  };
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it('an inherited GIT_DIR does not repoint the call — the repo resolves from cwd', () => {
    const repo = makeTempRepo();
    const other = makeTempRepo();
    try {
      const otherGitDir = execFileSync('git', ['-C', other.root, 'rev-parse', '--absolute-git-dir'])
        .toString('utf8')
        .trim();
      // Without the strip, every git call in this process would silently
      // operate on `other` — captures, compares, and cat-file reads alike.
      setAmbient('GIT_DIR', otherGitDir);
      setAmbient('GIT_WORK_TREE', other.root);
      setAmbient('GIT_OBJECT_DIRECTORY', `${otherGitDir}/objects`);
      const resolved = defaultGitRunner(['rev-parse', '--absolute-git-dir'], { cwd: repo.root })
        .toString('utf8')
        .trim();
      expect(resolved).not.toBe(otherGitDir);
      expect(resolved.startsWith(repo.root)).toBe(true);
    } finally {
      repo.cleanup();
      other.cleanup();
    }
  });

  it("the caller's per-call env still merges on top — the private capture overrides ride through", () => {
    const repo = makeTempRepo();
    try {
      // A bogus caller-supplied GIT_DIR must WIN (and break the call):
      // proof the strip removes only ambient state, never the harness's own
      // per-call GIT_INDEX_FILE/GIT_OBJECT_DIRECTORY plumbing.
      expect(() =>
        defaultGitRunner(['rev-parse', '--absolute-git-dir'], {
          cwd: repo.root,
          env: { GIT_DIR: `${repo.root}/definitely-not-a-git-dir` }
        })
      ).toThrow();
    } finally {
      repo.cleanup();
    }
  });
});
