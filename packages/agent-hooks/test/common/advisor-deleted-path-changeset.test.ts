/**
 * Reproduction: a deleted tracked path must not abort the advisor's
 * implicit-dependency scan into the "could not run" advisory.
 *
 * A routine `rm` of a tracked file (staged or not) makes `git diff --name-only`
 * list it — a deletion is a working-tree modification — so the status changeset
 * resolved by {@link resolveChangeset} carries a path that no longer exists on
 * disk. The coverage query `git span list --porcelain <paths>` fails hard on
 * such a path (exit 1, empty stdout, an error on stderr naming the deleted
 * path), and the `list` executor converts that shape into an
 * {@link AdvisorScanError}; `evaluateAdvisor` then fails open with the
 * `scan-failed` "could not run" advisory instead of scanning quietly over the
 * surviving paths. A deleted path has no content whose implicit dependencies
 * could be documented, so it should never enter the changeset in the first
 * place.
 *
 * This exercises the real pipeline end to end — a real temp repo, the real
 * `GitExecutor` (so the deleted path actually enters the changeset), and the
 * real `git span` CLI (matching the pattern in advisor-list-scan-failure.test.ts).
 * The deleted path is deliberately the bug shape: a path present in the index
 * but not in the working tree. A lone deletion would reproduce nothing — the
 * coverage scan short-circuits on changesets of fewer than two paths — so the
 * fixture pairs the deletion with a surviving modified file, the paths the
 * scan must proceed over.
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

suite('status changeset containing a deleted tracked path', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.realpathSync.native(
      fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'advisor-deleted-path-'))
    );
    execFileSync('git', ['init', '-q', '-b', 'main', repoRoot], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });
    fs.mkdirSync(nodePath.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(nodePath.join(repoRoot, 'src/app.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(nodePath.join(repoRoot, 'src/other.ts'), 'export const b = 2;\n', 'utf8');
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('sanity: the coverage query really does fail on the deleted path with empty stdout and an error on stderr', () => {
    fs.rmSync(nodePath.join(repoRoot, 'src/app.ts'));
    fs.appendFileSync(nodePath.join(repoRoot, 'src/other.ts'), 'export const b2 = 3;\n', 'utf8');
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('git', ['span', 'list', '--porcelain', 'src/app.ts', 'src/other.ts'], {
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

  it('resolves the status changeset over the surviving paths without a scan-failed outcome', async () => {
    fs.rmSync(nodePath.join(repoRoot, 'src/app.ts'));
    fs.appendFileSync(nodePath.join(repoRoot, 'src/other.ts'), 'export const b2 = 3;\n', 'utf8');

    // The real pipeline: resolveChangeset feeds the status changeset straight
    // into the report-only evaluation, exactly as the status adapter does.
    const changeset = await resolveChangeset('status', false, repoRoot, createDefaultGitExecutor());
    // Fixture sanity (true before and after a fix): the surviving change is
    // what the scan must proceed over. On the current code the changeset also
    // carries `src/app.ts`, which aborts the scan below.
    expect(changeset.paths).toContain('src/other.ts');

    const result = await evaluateAdvisor(
      changeset.paths,
      repoRoot,
      createDefaultAdvisorExecutors(),
      createMemoryAdvisorMemoState(),
      'report-only'
    );
    // The deleted path has no content whose implicit dependencies could be
    // documented — the scan must proceed over the surviving paths, never abort
    // with the "could not run" advisory.
    expect(result.kind).not.toBe('scan-failed');
  });
});
