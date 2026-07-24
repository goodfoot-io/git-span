/**
 * Tests for src/disqualifiers/tree-sitter-reference.ts.
 *
 * Two obligations from the plan drive this suite (design decision 6):
 *  - a real cross-file-reference detection case (TypeScript import, Rust
 *    `use`) that disqualifies the group, and
 *  - a parse-failure case that is evidence-neutral — zero strength AND flagged
 *    inconclusive so the operator sees the parse failed, never miscounted as
 *    "no reference found" or used to disqualify.
 *
 * Stage 3 converts this disqualifier from a whole-group, first-match
 * early-return to per-edge collection (near-clique grouping plan, "Per-edge
 * disqualifiers — exact no-match floor semantics"): every internal edge
 * (every unordered pair of distinct-path anchors) gets exactly one verdict,
 * always, tagged via `edge`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import treeSitterReferenceDisqualifier from '../../src/disqualifiers/tree-sitter-reference.js';
import { createRepoContext } from '../../src/prefilter.js';
import type { Anchor, AnchorGroup, DisqualifierEvidence, RepoContext } from '../../src/types.js';
import { buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';
import { buildTreeSitterRepo, cleanupTreeSitterRepo } from '../fixtures/tree-sitter/build-repo.js';

function groupOf(...paths: string[]): AnchorGroup {
  const anchors: Anchor[] = paths.map((path) => ({ path }));
  return { anchors, evidence: [], score: 0 };
}

/** Finds the one evidence entry tagged with the unordered pair `{pathA, pathB}` — order-independent, since edge tagging order is an implementation detail. */
function evidenceFor(results: DisqualifierEvidence[], pathA: string, pathB: string): DisqualifierEvidence {
  const wanted = [pathA, pathB].sort();
  const found = results.find((e) => {
    const edgePaths = [e.edge?.a.path, e.edge?.b.path].sort();
    return edgePaths[0] === wanted[0] && edgePaths[1] === wanted[1];
  });
  if (!found) throw new Error(`no evidence entry for edge {${pathA}, ${pathB}} among ${JSON.stringify(results)}`);
  return found;
}

describe('tree-sitter-reference disqualifier', () => {
  let repoDir: string;
  let ctx: RepoContext;

  beforeAll(() => {
    repoDir = buildTreeSitterRepo();
    ctx = createRepoContext(repoDir);
  });

  afterAll(() => {
    cleanupTreeSitterRepo(repoDir);
  });

  it('disqualifies a group whose files are connected by a TypeScript import', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('importer.ts', 'helper.ts'), ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'importer.ts', 'helper.ts');
    expect(evidence.disqualifier).toBe('tree-sitter-reference');
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.inconclusive).toBeFalsy();
    expect(evidence.detail).toContain('importer.ts -> helper.ts');
  });

  it('disqualifies a group whose files are connected by a Rust `use`', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('main.rs', 'widget.rs'), ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'main.rs', 'widget.rs');
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.inconclusive).toBeFalsy();
    expect(evidence.detail).toContain('main.rs -> widget.rs');
  });

  it('is evidence-neutral (zero strength, not inconclusive) when two parseable files reference nothing', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('alpha.ts', 'beta.ts'), ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'alpha.ts', 'beta.ts');
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBeFalsy();
  });

  // The parse-failure obligation: a file that cannot be parsed contributes
  // zero evidence in EITHER direction — not disqualifying, not corroborating.
  it('contributes zero evidence and flags inconclusive when an anchor is an unparseable .ts (syntax error)', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('broken.ts', 'alpha.ts'), ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'broken.ts', 'alpha.ts');
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBe(true);
    expect(evidence.detail).toContain('parse_failed');
    expect(evidence.detail).toContain('broken.ts');
  });

  it('contributes zero evidence and flags inconclusive for unsupported-language anchors (.md / binary)', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('notes.md', 'blob.bin'), ctx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'notes.md', 'blob.bin');
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBe(true);
    expect(evidence.detail).toContain('parse_failed');
  });

  it('never lets a parse failure masquerade as a found reference (mixed parseable + unparseable, no real link)', async () => {
    // broken.ts fails to parse; alpha.ts parses but imports nothing. The
    // disqualifier must not invent a reference — strength stays 0.
    const results = await treeSitterReferenceDisqualifier(groupOf('broken.ts', 'alpha.ts', 'beta.ts'), ctx);
    expect(results).toHaveLength(3);
    for (const evidence of results) {
      expect(evidence.strength).toBe(0);
    }
  });

  it('evaluates every internal edge of a 3-anchor group exactly once, only the referencing pair firing', async () => {
    // importer.ts -> helper.ts is a real reference; alpha.ts and beta.ts are
    // unrelated to either. Every one of the three pairs must get its own
    // verdict — the one firing edge must not contaminate the other two, and
    // the two non-firing edges must not be omitted.
    const results = await treeSitterReferenceDisqualifier(groupOf('importer.ts', 'helper.ts', 'alpha.ts'), ctx);
    expect(results).toHaveLength(3);
    expect(results.every((e) => e.edge !== undefined)).toBe(true);

    const firing = evidenceFor(results, 'importer.ts', 'helper.ts');
    expect(firing.strength).toBeGreaterThan(0);
    expect(firing.inconclusive).toBeFalsy();
    expect(firing.detail).toContain('importer.ts -> helper.ts');

    const importerVsAlpha = evidenceFor(results, 'importer.ts', 'alpha.ts');
    expect(importerVsAlpha.strength).toBe(0);
    expect(importerVsAlpha.inconclusive).toBeFalsy();

    const helperVsAlpha = evidenceFor(results, 'helper.ts', 'alpha.ts');
    expect(helperVsAlpha.strength).toBe(0);
    expect(helperVsAlpha.inconclusive).toBeFalsy();
  });

  it('flags only the edges touching an unparseable anchor as inconclusive, in a 3-anchor group', async () => {
    // broken.ts fails to parse; alpha.ts and beta.ts both parse cleanly and
    // reference nothing. The (alpha, beta) edge must be a clean floor
    // verdict, not inconclusive — a parse failure elsewhere in the group
    // must never leak into an edge that doesn't involve the failed anchor.
    const results = await treeSitterReferenceDisqualifier(groupOf('broken.ts', 'alpha.ts', 'beta.ts'), ctx);
    expect(results).toHaveLength(3);

    const brokenVsAlpha = evidenceFor(results, 'broken.ts', 'alpha.ts');
    expect(brokenVsAlpha.strength).toBe(0);
    expect(brokenVsAlpha.inconclusive).toBe(true);

    const brokenVsBeta = evidenceFor(results, 'broken.ts', 'beta.ts');
    expect(brokenVsBeta.strength).toBe(0);
    expect(brokenVsBeta.inconclusive).toBe(true);

    const alphaVsBeta = evidenceFor(results, 'alpha.ts', 'beta.ts');
    expect(alphaVsBeta.strength).toBe(0);
    expect(alphaVsBeta.inconclusive).toBeFalsy();
  });

  it('is evidence-neutral for a single-file group (nothing to connect)', async () => {
    const results = await treeSitterReferenceDisqualifier(groupOf('importer.ts'), ctx);
    expect(results).toHaveLength(1);
    expect(results[0].edge).toBeUndefined();
    expect(results[0].strength).toBe(0);
    expect(results[0].inconclusive).toBeFalsy();
  });

  it('does not throw on a degenerate repo with only unsupported files', async () => {
    const degenerateCtx = createRepoContext(buildSingleCommitRepo());
    const results = await treeSitterReferenceDisqualifier(groupOf('a.txt', 'b.txt'), degenerateCtx);
    expect(results).toHaveLength(1);
    const evidence = evidenceFor(results, 'a.txt', 'b.txt');
    expect(evidence.strength).toBe(0);
    expect(Number.isNaN(evidence.strength)).toBe(false);
    expect(evidence.inconclusive).toBe(true);
  });
});
