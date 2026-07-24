/**
 * Golden fixture test for n-ary recovery (must-have 6, near-clique-grouping
 * plan Stage 5). This is the actual CI gate: a synthetic repo with known
 * multi-file commit history and a known ground-truth n-ary group, driven
 * through the *real*, unmocked signal layer (association-rules' genuine
 * co-change counting), so a future signal or threshold change that silently
 * breaks n-ary recovery is caught mechanically rather than by re-running
 * scratchpad scripts. Unlike `test/pipeline.test.ts`'s Stage 4 describe
 * block (which injects the signal layer via `signalOverride` to pin exact
 * scoring-edge-case behavior), this file exercises the whole pipeline
 * end-to-end on real git history, the same synthetic-repo pattern
 * (`git()`/`write()` helpers, disposable `mkdtempSync` repos) established by
 * `test/pipeline.test.ts` and `test/repo-context.test.ts`.
 *
 * The evaluation script's live `.span/**` recovery run (`scripts/
 * evaluate-recovery.mts`) is reporting-only and NOT wired into this suite —
 * this file is the fixed, non-drifting ground truth CI actually gates on.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discover } from '../src/cli.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const pathsOf = (g: { anchors: { path: string }[] }): Set<string> => new Set(g.anchors.map((a) => a.path));

describe('n-ary recovery golden test (synthetic fixture, real signals)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-n-ary-recovery-'));
    git(repoRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'fixture@example.com']);
    git(repoRoot, ['config', 'user.name', 'Fixture Builder']);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('recovers a known 3-file coupling from real repeated co-change history, excluding an unrelated file', async () => {
    // moduleAlpha/Beta/Gamma are always touched together across every commit
    // that touches any of them — real association-rules evidence (no
    // injected signal), with commit count comfortably above
    // MIN_COOCCURRENCE_COUNT and support/confidence both 1.0. moduleZulu is a
    // wholly unrelated file with its own separate history, never co-touched
    // with the triangle — it must never be swept into the reported group.
    write(repoRoot, 'moduleAlpha.ts', 'export const alpha = 1;\n');
    write(repoRoot, 'moduleBeta.ts', 'export const beta = 1;\n');
    write(repoRoot, 'moduleGamma.ts', 'export const gamma = 1;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add the alpha/beta/gamma triangle']);

    write(repoRoot, 'moduleAlpha.ts', 'export const alpha = 2;\n');
    write(repoRoot, 'moduleBeta.ts', 'export const beta = 2;\n');
    write(repoRoot, 'moduleGamma.ts', 'export const gamma = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'touch alpha/beta/gamma together again']);

    write(repoRoot, 'moduleZulu.ts', 'export const zulu = 1;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add an unrelated file with its own history']);

    const groups = await discover(repoRoot);

    const triangle = groups.filter(
      (g) => pathsOf(g).has('moduleAlpha.ts') && pathsOf(g).has('moduleBeta.ts') && pathsOf(g).has('moduleGamma.ts')
    );
    expect(triangle).toHaveLength(1);
    expect(pathsOf(triangle[0])).toEqual(new Set(['moduleAlpha.ts', 'moduleBeta.ts', 'moduleGamma.ts']));

    // moduleZulu never appears in any reported group.
    expect(groups.some((g) => pathsOf(g).has('moduleZulu.ts'))).toBe(false);
  });

  it('recovers a known 4-file full-clique coupling from real repeated co-change history', async () => {
    // A four-file group (papa/quebec/romeo/sierra) always changed together
    // — real evidence on all C(4,2)=6 internal pairs, so the whole clique
    // should survive as one reported group (0 missing edges), not fragment
    // into smaller subsets (subset suppression per cli.ts).
    const files = ['modulePapa.ts', 'moduleQuebec.ts', 'moduleRomeo.ts', 'moduleSierra.ts'];
    for (const version of [1, 2]) {
      for (const file of files) write(repoRoot, file, `export const value = ${version};\n`);
      git(repoRoot, ['add', '-A']);
      git(repoRoot, ['commit', '--quiet', '-m', `touch the full clique together (v${version})`]);
    }

    const groups = await discover(repoRoot);

    const clique = groups.filter((g) => files.every((f) => pathsOf(g).has(f)));
    expect(clique).toHaveLength(1);
    expect(pathsOf(clique[0])).toEqual(new Set(files));

    // No stray subset (e.g. a 2- or 3-file fragment of the same clique) leaked through.
    expect(groups.filter((g) => [...pathsOf(g)].some((p) => files.includes(p)))).toHaveLength(1);
  });
});
