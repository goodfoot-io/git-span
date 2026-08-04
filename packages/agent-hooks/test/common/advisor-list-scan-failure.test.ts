/**
 * Reproduction: the default `list` executor must not swallow a hard `git span
 * list --porcelain` failure into an empty array.
 *
 * `computeUncoveredPaths` derives the covered set from `executors.list`, so an
 * empty result is indistinguishable from "nothing is covered" — a failed
 * coverage query is therefore converted into a maximal, confidently-wrong
 * "every changed path is uncovered" hold, and the related-spans section
 * vanishes. The sibling `drift` executor already distinguishes the two cases:
 * empty stdout plus a non-empty stderr on a non-zero exit means the scan never
 * completed, and it throws `AdvisorScanError` so `evaluateAdvisor` can fail open with
 * the distinguishable `scan-failed` warning.
 *
 * This exercises the real CLI (matching the pattern in porcelain-contract.test.ts)
 * with an argument git-span cannot resolve to a span, file, or glob — the exact
 * shape that produces exit 1 / empty stdout / error on stderr. The argument is
 * deliberately a path that exists in NO worktree: a bracketed path that is
 * merely *unresolvable-looking* would become resolvable the moment a CLI with
 * the literal-path fallback lands on PATH, and this test would quietly stop
 * exercising anything.
 *
 * Skipped in full when `git span` is not on PATH.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdvisorScanError, createDefaultAdvisorExecutors } from '../../src/common/advisor-core.js';

const hasGitSpan = (() => {
  try {
    execFileSync('git', ['span', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const suite = hasGitSpan ? describe : describe.skip;

/**
 * An argument no `git span list` can ever resolve — no span carries this name,
 * no file exists at this path, and no glob of it matches an anchor — so the
 * hard-failure shape it provokes does not depend on which CLI version is
 * installed.
 */
const MISSING_ARG = 'src/no-such-file-anywhere.ts';

suite('createDefaultAdvisorExecutors().list — hard CLI failure', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.realpathSync.native(
      fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'advisor-list-fail-'))
    );
    execFileSync('git', ['init', '-q', '-b', 'main', repoRoot], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });
    fs.mkdirSync(nodePath.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(nodePath.join(repoRoot, 'src/app.ts'), 'export const a = 1;\n', 'utf8');
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('sanity: the CLI query really does fail with empty stdout and an error on stderr', () => {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('git', ['span', 'list', '--porcelain', MISSING_ARG], {
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

  it('throws AdvisorScanError rather than reporting zero coverage', async () => {
    const executors = createDefaultAdvisorExecutors();
    await expect(executors.list(['src/app.ts', MISSING_ARG], repoRoot)).rejects.toBeInstanceOf(AdvisorScanError);
  });
});
