/**
 * Full-pipeline integration test (Stage 2): a real fixture repo run through
 * all 7 signals → grouping → scoring pass 1 → both disqualifiers → scoring
 * pass 2 → rename-tracking → JSON + markdown output.
 *
 * Asserts the two end-to-end guarantees the card requires: the `.span/`
 * directory is never touched, and anchors are emitted in `path#Lstart-Lend`
 * shape (whole-file anchors as bare `path`).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discover } from '../src/cli.js';
import { toJson, toMarkdown } from '../src/output.js';

function git(cwd: string, args: string[], isoDate?: string): void {
  const env = isoDate ? { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } : process.env;
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore', env });
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Recursively snapshot relative-path → content for every file under `root`. */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    const abs = path.join(entry.parentPath ?? root, entry.name);
    if (entry.isFile()) out.set(path.relative(root, abs), fs.readFileSync(abs, 'utf8'));
  }
  return out;
}

const T0 = '2024-03-01T00:00:00+00:00';
const T0_1M = '2024-03-01T00:01:00+00:00';
const T0_2M = '2024-03-01T00:02:00+00:00';
const T0_3M = '2024-03-01T00:03:00+00:00';

describe('full pipeline', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-pipeline-'));
    git(repoRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'fixture@example.com']);
    git(repoRoot, ['config', 'user.name', 'Fixture Builder']);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('mines a fixture repo end-to-end, leaving .span/ untouched and emitting path#Lstart-Lend anchors', async () => {
    // A pre-existing .span/ record — the pipeline must never read or write it.
    write(repoRoot, '.span/records/legacy.json', '{"anchor":"do-not-touch"}\n');

    // alpha.ts and beta.ts are created in separate, close-in-time commits
    // (time-window/same-author-session evidence, range-anchored), then
    // touched together in the same commit twice more (association-rules
    // evidence — a real repeated co-change, not mere temporal coincidence).
    // After the pass-1/pass-2 threshold recalibration (this card), no single
    // circumstantial signal — however strong — clears the bar alone; a
    // fixture needs genuine multi-signal corroboration to produce a
    // surviving group, same as it would on a real repository.
    write(repoRoot, 'alpha.ts', 'const alpha = 1;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add alpha.ts and a span record'], T0);

    write(repoRoot, 'beta.ts', 'const beta = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add beta.ts'], T0_1M);

    write(repoRoot, 'gamma.ts', 'const gamma = 3;\n');
    write(repoRoot, 'alpha.ts', 'const alpha = 1;\nconst alphaAgain = 1;\n');
    write(repoRoot, 'beta.ts', 'const beta = 2;\nconst betaAgain = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add gamma.ts, touch alpha.ts and beta.ts together'], T0_2M);

    write(repoRoot, 'alpha.ts', 'const alpha = 1;\nconst alphaAgain = 1;\nconst alphaThird = 1;\n');
    write(repoRoot, 'beta.ts', 'const beta = 2;\nconst betaAgain = 2;\nconst betaThird = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'touch alpha.ts and beta.ts together again'], T0_3M);

    const spanBefore = snapshotTree(path.join(repoRoot, '.span'));
    expect(spanBefore.size).toBeGreaterThan(0);

    const groups = await discover(repoRoot);

    // The pipeline produced a non-empty report from local history alone.
    expect(groups.length).toBeGreaterThan(0);

    // .span/ guard: contents byte-identical, and git sees no working-tree changes.
    const spanAfter = snapshotTree(path.join(repoRoot, '.span'));
    expect(spanAfter).toEqual(spanBefore);
    const status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status.trim()).toBe('');
    expect(status).not.toContain('.span');

    // Anchor shape: every anchor is either `path` or `path#Lstart-Lend`.
    const anchorPattern = /^[^#]+(#L\d+-L\d+)?$/;
    const allAnchors = groups.flatMap((g) =>
      g.anchors.map((a) => (a.startLine !== undefined ? `${a.path}#L${a.startLine}-L${a.endLine}` : a.path))
    );
    for (const anchor of allAnchors) expect(anchor).toMatch(anchorPattern);

    // At least one range-anchored candidate survived to output.
    const hasRangeAnchor = groups.some((g) => g.anchors.some((a) => a.startLine !== undefined));
    expect(hasRangeAnchor).toBe(true);

    // No emitted anchor references a .span/ path.
    for (const anchor of allAnchors) expect(anchor.startsWith('.span')).toBe(false);

    // Both renderers succeed on the real output.
    const json = JSON.parse(toJson(groups));
    expect(Array.isArray(json.groups)).toBe(true);
    expect(json.groups[0].anchors.every((a: string) => anchorPattern.test(a))).toBe(true);
    expect(toMarkdown(groups)).toContain('# Implicit dependency candidates');
  });

  it('degrades to an empty groups result for a zero-commit repo instead of throwing', async () => {
    // repoRoot from beforeEach is `git init`'d but has zero commits — the
    // natural boundary case a fresh, unused project would hit (finding 1).
    await expect(discover(repoRoot)).resolves.toEqual([]);
  });
});
