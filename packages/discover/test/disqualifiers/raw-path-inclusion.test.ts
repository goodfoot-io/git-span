/**
 * Real (unskipped) tests for src/disqualifiers/raw-path-inclusion.ts.
 *
 * Uses real fixture repos (built directly here, plus the shared
 * single-commit-repo degenerate fixture) rather than fakes, since the
 * disqualifier reads through RepoContext's real git-backed fileAt accessor.
 *
 * Stage 3 converts this disqualifier from a whole-group, first-match
 * early-return to per-edge collection (near-clique grouping plan, "Per-edge
 * disqualifiers — exact no-match floor semantics"): every internal edge
 * (every unordered pair of distinct-path anchors) gets exactly one verdict,
 * always, tagged via `edge`.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import rawPathInclusionDisqualifier from '../../src/disqualifiers/raw-path-inclusion.js';
import { createRepoContext } from '../../src/prefilter.js';
import type { AnchorGroup, DisqualifierEvidence } from '../../src/types.js';
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

/** Finds the one evidence entry tagged with the unordered pair `{pathA, pathB}` — order-independent, since edge tagging order is an implementation detail. */
function evidenceFor(results: DisqualifierEvidence[], pathA: string, pathB: string): DisqualifierEvidence {
  const found = results.find((e) => {
    const edgePaths = [e.edge?.a.path, e.edge?.b.path].sort();
    return edgePaths[0] === [pathA, pathB].sort()[0] && edgePaths[1] === [pathA, pathB].sort()[1];
  });
  if (!found) throw new Error(`no evidence entry for edge {${pathA}, ${pathB}} among ${JSON.stringify(results)}`);
  return found;
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

    const results = await rawPathInclusionDisqualifier(group, ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'docs/currency.md', 'src/formatters/format-currency.ts');
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
    const results = await rawPathInclusionDisqualifier(group, ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'a.txt', 'b.txt');
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

    const results = await rawPathInclusionDisqualifier(group, ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'src/foo/index.ts', 'docs/glossary.md');
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.strength).toBeLessThan(0.1);
  });

  it('evaluates every internal edge of a 3+-anchor group exactly once, only the firing pair matching', async () => {
    // Three anchors -> three internal edges: (doc, formatter), (doc, unrelated), (formatter, unrelated).
    // Only (doc, formatter) has a literal reference; the other two must still
    // get their own floor-strength verdict, never omitted and never
    // contaminated by the one firing pair.
    writeAndCommit(
      repoRoot,
      {
        'docs/currency.md': 'See `src/formatters/format-currency.ts` for the implementation.\n',
        'src/formatters/format-currency.ts':
          'export function formatCurrency(cents: number): string {\n  return String(cents / 100);\n}\n',
        'src/unrelated.ts': 'export const nothingToDoWithAnyOfThis = 42;\n'
      },
      'Add currency formatter, its doc, and an unrelated file'
    );

    const ctx = createRepoContext(repoRoot);
    const group: AnchorGroup = {
      anchors: [
        { path: 'docs/currency.md' },
        { path: 'src/formatters/format-currency.ts' },
        { path: 'src/unrelated.ts' }
      ],
      evidence: [],
      score: 0
    };

    const results = await rawPathInclusionDisqualifier(group, ctx);
    expect(results).toHaveLength(3);
    expect(results.every((e) => e.edge !== undefined)).toBe(true);

    const firing = evidenceFor(results, 'docs/currency.md', 'src/formatters/format-currency.ts');
    expect(firing.strength).toBeGreaterThan(0.5);

    const docsVsUnrelated = evidenceFor(results, 'docs/currency.md', 'src/unrelated.ts');
    expect(docsVsUnrelated.strength).toBeGreaterThan(0);
    expect(docsVsUnrelated.strength).toBeLessThan(0.1);

    const formatterVsUnrelated = evidenceFor(results, 'src/formatters/format-currency.ts', 'src/unrelated.ts');
    expect(formatterVsUnrelated.strength).toBeGreaterThan(0);
    expect(formatterVsUnrelated.strength).toBeLessThan(0.1);
  });

  it('returns the legacy no-edge floor verdict for a <2-anchor group', async () => {
    const ctx = createRepoContext(buildSingleCommitRepo());
    const group: AnchorGroup = { anchors: [{ path: 'a.txt' }], evidence: [], score: 0 };
    const results = await rawPathInclusionDisqualifier(group, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].edge).toBeUndefined();
    expect(results[0].strength).toBeGreaterThan(0);
    expect(results[0].strength).toBeLessThan(0.1);
  });
});
