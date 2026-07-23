/**
 * Tests for src/rename-tracking.ts — resolving a group's anchors forward to
 * HEAD across renames, carrying the line range through intervening edits, and
 * dropping groups whose files were all deleted.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../src/prefilter.js';
import { resolveGroupsToHead } from '../src/rename-tracking.js';
import type { AnchorGroup } from '../src/types.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function revParse(cwd: string, rev: string): string {
  return execFileSync('git', ['-C', cwd, 'rev-parse', rev], { encoding: 'utf8' }).trim();
}

function initRepo(dir: string): void {
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture Builder']);
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('resolveGroupsToHead', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-rename-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('follows a rename and carries the line range through an upstream insertion', async () => {
    // Commit 1: foo.ts with 5 lines; anchor tracks lines 3-4 (c, d).
    write(repoRoot, 'foo.ts', 'a\nb\nc\nd\ne\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add foo.ts']);
    const c1 = revParse(repoRoot, 'HEAD');

    // Commit 2: rename foo.ts -> bar.ts and prepend 2 header lines, so the
    // tracked c/d lines shift from 3-4 to 5-6.
    fs.rmSync(path.join(repoRoot, 'foo.ts'));
    write(repoRoot, 'bar.ts', 'h1\nh2\na\nb\nc\nd\ne\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'rename foo.ts to bar.ts + header']);

    const group: AnchorGroup = {
      anchors: [
        { path: 'foo.ts', startLine: 3, endLine: 4 },
        { path: 'other.ts', startLine: 1, endLine: 1 }
      ],
      evidence: [{ signal: 'time-window-co-edit', strength: 0.8, commits: [c1] }],
      score: 0.8
    };
    // other.ts must exist at HEAD for its anchor to survive.
    write(repoRoot, 'other.ts', 'x\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add other.ts']);

    const ctx = createRepoContext(repoRoot);
    const [resolved] = await resolveGroupsToHead([group], ctx);

    const bar = resolved.anchors.find((a) => a.path === 'bar.ts');
    expect(bar).toBeDefined();
    expect(bar?.startLine).toBe(5);
    expect(bar?.endLine).toBe(6);
    // foo.ts is gone; only bar.ts (renamed) and other.ts remain.
    expect(resolved.anchors.map((a) => a.path).sort()).toEqual(['bar.ts', 'other.ts']);
  });

  it('drops an anchor whose file was deleted and never replaced, keeping surviving anchors', async () => {
    write(repoRoot, 'gone.ts', 'g1\ng2\n');
    write(repoRoot, 'keep.ts', 'k1\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add gone.ts and keep.ts']);
    const c1 = revParse(repoRoot, 'HEAD');

    fs.rmSync(path.join(repoRoot, 'gone.ts'));
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'delete gone.ts']);

    const group: AnchorGroup = {
      anchors: [{ path: 'gone.ts' }, { path: 'keep.ts' }],
      evidence: [{ signal: 'association-rules', strength: 0.9, commits: [c1] }],
      score: 0.9
    };

    const ctx = createRepoContext(repoRoot);
    const [resolved] = await resolveGroupsToHead([group], ctx);
    expect(resolved.anchors.map((a) => a.path)).toEqual(['keep.ts']);
  });

  it('drops a group entirely when all its files were deleted', async () => {
    write(repoRoot, 'a.ts', 'a\n');
    write(repoRoot, 'b.ts', 'b\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add a.ts and b.ts']);
    const c1 = revParse(repoRoot, 'HEAD');

    fs.rmSync(path.join(repoRoot, 'a.ts'));
    fs.rmSync(path.join(repoRoot, 'b.ts'));
    write(repoRoot, 'c.ts', 'c\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'delete a.ts and b.ts, add c.ts']);

    const group: AnchorGroup = {
      anchors: [{ path: 'a.ts' }, { path: 'b.ts' }],
      evidence: [{ signal: 'association-rules', strength: 0.9, commits: [c1] }],
      score: 0.9
    };

    const ctx = createRepoContext(repoRoot);
    expect(await resolveGroupsToHead([group], ctx)).toEqual([]);
  });

  it('leaves an unchanged range untouched', async () => {
    write(repoRoot, 'stable.ts', 'l1\nl2\nl3\nl4\n');
    write(repoRoot, 'peer.ts', 'p1\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add stable.ts and peer.ts']);
    const c1 = revParse(repoRoot, 'HEAD');

    // A later, unrelated commit so HEAD != c1 but stable.ts is untouched.
    write(repoRoot, 'unrelated.ts', 'u1\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add unrelated.ts']);

    const group: AnchorGroup = {
      anchors: [
        { path: 'stable.ts', startLine: 2, endLine: 3 },
        { path: 'peer.ts', startLine: 1, endLine: 1 }
      ],
      evidence: [{ signal: 'time-window-co-edit', strength: 0.8, commits: [c1] }],
      score: 0.8
    };

    const ctx = createRepoContext(repoRoot);
    const [resolved] = await resolveGroupsToHead([group], ctx);
    const stable = resolved.anchors.find((a) => a.path === 'stable.ts');
    expect(stable?.startLine).toBe(2);
    expect(stable?.endLine).toBe(3);
  });
});
