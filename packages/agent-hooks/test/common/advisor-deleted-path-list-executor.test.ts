/**
 * Reproduction: the `list` executor must not classify a deleted tracked path
 * in the changeset as a scan infrastructure failure.
 *
 * A routine `rm` of a tracked file (staged or not) makes `git diff --name-only`
 * list it — a deletion is a working-tree modification — so the changeset handed
 * to the coverage scan carries a path that no longer exists on disk. The
 * coverage query `git span list --porcelain <paths>` fails hard on such a path
 * (exit 1, empty stdout, an error on stderr naming the deleted path), and the
 * `list` executor converts that shape into `AdvisorScanError`
 * (`advisor-core.ts`, ~L2393-L2399), which `evaluateAdvisor` surfaces as the
 * `scan-failed` "could not run" advisory on every status-kind check — instead
 * of the scan proceeding quietly over the surviving paths.
 *
 * The invariant under test: a deleted path never aborts the coverage scan. A
 * path absent from the working tree can never be covered by a span — it has no
 * content whose implicit dependencies could be documented — so it should
 * contribute zero coverage (an empty result for the missing paths), not abort
 * the read for the rest of the changeset.
 *
 * The test drives `executors.list` directly rather than the full
 * `evaluateAdvisor` flow because the full flow runs the `drift` executor
 * first, and `git span drift` fails hard on the same deleted-path shape — an
 * `evaluateAdvisor`-level test aborts in `drift` before the `list` executor
 * ever runs, so it cannot discriminate this hypothesis: that the defect is in
 * the `list` executor's failure classification. The changeset itself is built
 * the way the advisor builds it — a real `git diff --name-only` read over a
 * fixture whose tracked `src/app.ts` was `rm`'d while `src/util.ts` was
 * edited. A lone deletion would reproduce nothing — the coverage scan
 * short-circuits on changesets of fewer than two paths — so the fixture pairs
 * the deletion with the surviving path the scan must proceed over.
 *
 * Skipped in full when `git span` is not on PATH.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAdvisorExecutors } from '../../src/common/advisor-core.js';

const hasGitSpan = (() => {
  try {
    execFileSync('git', ['span', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const suite = hasGitSpan ? describe : describe.skip;

suite('createDefaultAdvisorExecutors().list — deleted tracked path in the changeset', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.realpathSync.native(
      fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'advisor-deleted-list-'))
    );
    execFileSync('git', ['init', '-q', '-b', 'main', repoRoot], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });
    fs.mkdirSync(nodePath.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(nodePath.join(repoRoot, 'src/app.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(nodePath.join(repoRoot, 'src/util.ts'), 'export const b = 2;\n', 'utf8');
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'ignore' });
    // A routine `rm` of a tracked file: gone from the working tree, staged or
    // not, so `git diff --name-only` lists it and git-span's path resolution
    // cannot find it.
    fs.rmSync(nodePath.join(repoRoot, 'src/app.ts'));
    // A second changed path, so the changeset is not a lone deletion (which
    // `computeUncoveredPaths` short-circuits before any scan).
    fs.writeFileSync(nodePath.join(repoRoot, 'src/util.ts'), 'export const b = 3;\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  /** The real changeset read the advisor itself uses for a status check. */
  function changedPaths(): string[] {
    return execFileSync('git', ['-C', repoRoot, 'diff', '--name-only'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  it('sanity: the deleted path is in the changeset, and the CLI query over the pair fails hard on it', () => {
    const changed = changedPaths();
    expect(changed).toContain('src/app.ts');
    expect(changed).toContain('src/util.ts');

    // The surviving path alone resolves cleanly — the deleted path is the sole
    // cause of the hard failure.
    expect(() =>
      execFileSync('git', ['span', 'list', '--porcelain', 'src/util.ts'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    ).not.toThrow();

    // The pair — the deleted path among them — exits non-zero with empty
    // stdout and an error on stderr, the exact shape the `list` executor reads
    // as a scan infrastructure failure.
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('git', ['span', 'list', '--porcelain', ...changed], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? -1;
      stdout = typeof e.stdout === 'string' ? e.stdout : '';
      stderr = typeof e.stderr === 'string' ? e.stderr : '';
    }
    expect(exitCode).not.toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr.trim().length).toBeGreaterThan(0);
  });

  it('treats the deleted path as zero coverage instead of aborting the coverage read', async () => {
    const executors = createDefaultAdvisorExecutors();
    // The changeset the advisor would scan: the deleted path plus the survivor.
    const changed = changedPaths();
    expect(changed).toContain('src/app.ts');
    expect(changed).toContain('src/util.ts');
    // The deleted path cannot be covered by any span — it has no file and no
    // anchor — so the batch must resolve (empty here: no spans exist in the
    // fixture) rather than reject with `AdvisorScanError` and abort the scan
    // for the rest of the changeset.
    await expect(executors.list(changed, repoRoot)).resolves.toEqual([]);
  });
});
