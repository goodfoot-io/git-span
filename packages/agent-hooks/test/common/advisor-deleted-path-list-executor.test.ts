/**
 * Reproduction: a status changeset carrying a deleted tracked path must not
 * abort the advisor's implicit-dependency scan into the "could not run"
 * advisory.
 *
 * A routine `rm` of a tracked file (staged or not) makes `git diff --name-only`
 * list it — a deletion is a working-tree modification — so the status changeset
 * resolved by {@link resolveChangeset} carries a path that no longer exists on
 * disk. The coverage queries `git span drift <paths>` and
 * `git span list --porcelain <paths>` fail hard on such a path (exit 1, empty
 * stdout, an error on stderr naming the deleted path), and the executors
 * convert that shape into an {@link AdvisorScanError}; {@link evaluateAdvisor}
 * then fails open with the `scan-failed` "could not run" advisory instead of
 * scanning quietly over the surviving paths. A deleted path has no content
 * whose implicit dependencies could be documented, so it should never reach
 * the scan in the first place.
 *
 * The invariant under test is the observable contract of the advisor's own
 * changeset flow: a status changeset containing a deleted tracked path must
 * not abort the coverage scan. The fix that satisfies it belongs upstream of
 * both scan queries — {@link resolveChangeset} drops paths absent from the
 * working tree before the changeset reaches evaluation — so the test drives
 * the real pipeline end to end: a real temp repo, the real `GitExecutor` (so
 * the deleted path actually enters the changeset), and the real `git span`
 * CLI. The fixture pairs the deletion with a surviving modified file, because
 * a lone deletion would reproduce nothing — the coverage scan short-circuits
 * on changesets of fewer than two paths.
 *
 * Skipped in full when `git span` is not on PATH.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AdvisorMemoState,
  createDefaultAdvisorExecutors,
  createDefaultGitExecutor,
  evaluateAdvisor,
  resolveChangeset
} from '../../src/common/advisor-core.js';

const hasGitSpan = (() => {
  try {
    execFileSync('git', ['span', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const suite = hasGitSpan ? describe : describe.skip;

/** An in-memory AdvisorMemoState — report-only evaluation never reads or writes it. */
function createMemoryAdvisorMemoState(): AdvisorMemoState {
  const digests = new Set<string>();
  return {
    has(digest: string): boolean {
      return digests.has(digest);
    },
    record(digest: string): boolean {
      digests.add(digest);
      return true;
    }
  };
}

suite('status changeset containing a deleted tracked path does not abort the coverage scan', () => {
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

  it('does not abort the coverage scan when the status changeset carries a deleted tracked path', async () => {
    // The real pipeline: resolveChangeset feeds the status changeset straight
    // into the report-only evaluation, exactly as the status adapter does.
    const changeset = await resolveChangeset('status', false, repoRoot, createDefaultGitExecutor());
    // Fixture sanity (true before and after a fix): the surviving change is
    // what the scan must proceed over. On the current code the changeset also
    // carries `src/app.ts` — the deleted path — which aborts the scan below.
    expect(changeset.paths).toContain('src/util.ts');

    const result = await evaluateAdvisor(
      changeset.paths,
      repoRoot,
      createDefaultAdvisorExecutors(),
      createMemoryAdvisorMemoState(),
      'report-only'
    );
    // The deleted path has no content whose implicit dependencies could be
    // documented — the scan must proceed over the surviving paths, never
    // abort with the "could not run" advisory.
    expect(result.kind).not.toBe('scan-failed');
  });
});
