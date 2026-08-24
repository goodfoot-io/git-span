/**
 * Integration oracle for CARD.md main-347: a `'report-only'` advisor evaluation
 * (the `status` preview) must leave the working tree byte-identical, while the
 * same drifted state evaluated in `'may-hold'` mode still runs the scoped
 * belt-and-braces heal.
 *
 * Before the mode gate, `evaluateAdvisor` ran `executors.fix` — a scoped
 * `git span drift <paths> --fix` — unconditionally before the mode branch, so
 * merely querying advisor status re-anchored `.span/**` documents. If no commit
 * followed, the worktree carried edits neither user nor implementing commit
 * asked for. Preview-time healing is not required to classify positionally-
 * drifted anchors: unhealed `MOVED`/`RESOLVED_PENDING_COMMIT` rows are never
 * debt (`isDebt()`), so classification works from read-only scans.
 *
 * This exercises the real CLI (matching the pattern in porcelain-contract.test.ts
 * and advisor-list-scan-failure.test.ts) against a temp repo whose span anchors
 * have positionally drifted: `git status --porcelain` must be unchanged by the
 * `'report-only'` run and must gain a `.span/` edit from the `'may-hold'` run —
 * the latter proves the fixture really would have dirtied the tree pre-gate.
 *
 * Skipped in full when `git span` is not on PATH.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AdvisorMemoState,
  createDefaultAdvisorExecutors,
  evaluateAdvisor
} from '../../src/common/advisor-core.js';

const hasGitSpan = (() => {
  // Bounded check: a broken/placeholder git-span binary must fail fast here
  // rather than hang or recurse (see git-span-fork-bomb incident report).
  const result = spawnSync('git', ['span', '--version'], { stdio: 'ignore', timeout: 5_000 });
  return result.status === 0;
})();

const suite = hasGitSpan ? describe : describe.skip;

const TARGET = 'src/app.ts';

/** An in-memory {@link AdvisorMemoState} — one Set of presented digests. */
function memoryMemoState(): AdvisorMemoState {
  const seen = new Set<string>();
  return {
    has: (digest) => seen.has(digest),
    record: (digest) => {
      seen.add(digest);
      return true;
    }
  };
}

suite('evaluateAdvisor — status previews leave the working tree byte-identical', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.realpathSync.native(
      fs.mkdtempSync(nodePath.join(fs.realpathSync.native('/tmp'), 'advisor-tree-clean-'))
    );
    execFileSync('git', ['init', '-q', '-b', 'main', repoRoot], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });

    const lines = `${Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n')}\n`;
    fs.mkdirSync(nodePath.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(nodePath.join(repoRoot, TARGET), lines, 'utf8');
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-qm', 'init'], { stdio: 'ignore' });

    // Anchor near the bottom of the file, then commit the span so `.span/**`
    // is tracked — only then can a heal show up as a worktree modification.
    execFileSync('git', ['span', 'add', 'probe/span', `${TARGET}#L8-L9`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    execFileSync('git', ['span', 'why', 'probe/span', 'probe span for the tree-cleanliness oracle'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-qm', 'add span'], { stdio: 'ignore' });

    // Positionally drift the anchors: four inserted lines push L8-L9 down. Left
    // unstaged, this is exactly what a `status` changeset scans.
    const drifted = `new1\nnew2\nnew3\nnew4\n${lines}`;
    fs.writeFileSync(nodePath.join(repoRoot, TARGET), drifted, 'utf8');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function gitStatusPorcelain(): string {
    return execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  it("a 'report-only' run with drifted anchors performs NO fix call and leaves git status empty of new edits", async () => {
    const before = gitStatusPorcelain();

    const result = await evaluateAdvisor(
      [TARGET],
      repoRoot,
      createDefaultAdvisorExecutors(),
      memoryMemoState(),
      'report-only'
    );

    // Classification works purely from the read-only scan: the positional drift
    // surfaces as MOVED rows, which are never debt, so nothing is reported.
    expect(result.decision).toBe('allow');

    const after = gitStatusPorcelain();
    // Byte-identical tree state: the preview healed nothing, staged nothing,
    // touched no `.span/**` document.
    expect(after).toBe(before);
    expect(after).not.toContain('.span/');
  });

  it("a 'may-hold' run over the identical state still heals — the fixture proves the tree would have been dirtied", async () => {
    const result = await evaluateAdvisor(
      [TARGET],
      repoRoot,
      createDefaultAdvisorExecutors(),
      memoryMemoState(),
      'may-hold'
    );
    expect(result.decision).toBe('allow');

    // The belt-and-braces heal re-anchored the span document: `.span/**` now
    // carries a worktree modification. This is the behavior the 'report-only'
    // gate must withhold from previews — asserted here so the fixture cannot
    // silently rot into exercising no heal at all.
    expect(gitStatusPorcelain()).toContain('.span/');
  });
});
