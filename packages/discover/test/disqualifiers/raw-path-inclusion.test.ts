/**
 * Real (unskipped) tests for src/disqualifiers/raw-path-inclusion.ts.
 *
 * Uses real fixture repos (built directly here, plus the shared
 * single-commit-repo degenerate fixture) rather than fakes, since the
 * disqualifier reads through RepoContext's real git-backed fileAt accessor.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import rawPathInclusionDisqualifier from '../../src/disqualifiers/raw-path-inclusion.js';
import { createRepoContext } from '../../src/prefilter.js';
import type { AnchorGroup } from '../../src/types.js';
import { buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture Builder']);
}

function writeAndCommit(dir: string, files: Record<string, string>, message: string): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', message]);
}

describe('raw-path-inclusion disqualifier', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-raw-path-inclusion-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('finds one anchor path referenced as a literal substring in another anchor file', async () => {
    writeAndCommit(
      repoRoot,
      {
        'docs/currency.md': [
          '# Currency formatting',
          '',
          'See `src/formatters/format-currency.ts` for the implementation.',
          ''
        ].join('\n'),
        'src/formatters/format-currency.ts':
          'export function formatCurrency(cents: number): string {\n  return String(cents / 100);\n}\n'
      },
      'Add currency formatter and its doc'
    );

    const ctx = createRepoContext(repoRoot);
    const group: AnchorGroup = {
      anchors: [{ path: 'docs/currency.md' }, { path: 'src/formatters/format-currency.ts' }],
      evidence: [],
      score: 0
    };

    const evidence = await rawPathInclusionDisqualifier(group, ctx);
    expect(evidence.disqualifier).toBe('raw-path-inclusion');
    expect(evidence.strength).toBeGreaterThan(0.5);
    expect(evidence.strength).toBeLessThan(1);
    expect(evidence.detail).toContain('docs/currency.md');
    expect(evidence.detail).toContain('src/formatters/format-currency.ts');
  });

  it('is evidence-neutral (near-zero, not exactly zero), when no reference is found', async () => {
    const ctx = createRepoContext(buildSingleCommitRepo());
    const group: AnchorGroup = {
      anchors: [{ path: 'a.txt' }, { path: 'b.txt' }],
      evidence: [],
      score: 0
    };
    const evidence = await rawPathInclusionDisqualifier(group, ctx);
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.strength).toBeLessThan(0.1);
  });

  it('does not disqualify on a trivially short/common bare filename appearing incidentally', async () => {
    writeAndCommit(
      repoRoot,
      {
        'src/foo/index.ts': 'export default function foo() { return 1; }\n',
        'docs/glossary.md': ['# Glossary', '', 'An index is a data structure used to speed up lookups.', ''].join('\n')
      },
      'Add a common-stem file and an unrelated doc mentioning "index"'
    );

    const ctx = createRepoContext(repoRoot);
    const group: AnchorGroup = {
      anchors: [{ path: 'src/foo/index.ts' }, { path: 'docs/glossary.md' }],
      evidence: [],
      score: 0
    };

    const evidence = await rawPathInclusionDisqualifier(group, ctx);
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.strength).toBeLessThan(0.1);
  });
});
