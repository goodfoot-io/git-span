/**
 * Tests for src/disqualifiers/tree-sitter-reference.ts.
 *
 * Two obligations from the plan drive this suite (design decision 6):
 *  - a real cross-file-reference detection case (TypeScript import, Rust
 *    `use`) that disqualifies the group, and
 *  - a parse-failure case that is evidence-neutral — zero strength AND flagged
 *    inconclusive so the operator sees the parse failed, never miscounted as
 *    "no reference found" or used to disqualify.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import treeSitterReferenceDisqualifier from '../../src/disqualifiers/tree-sitter-reference.js';
import { createRepoContext } from '../../src/prefilter.js';
import type { Anchor, AnchorGroup, RepoContext } from '../../src/types.js';
import { buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';
import { buildTreeSitterRepo, cleanupTreeSitterRepo } from '../fixtures/tree-sitter/build-repo.js';

function groupOf(...paths: string[]): AnchorGroup {
  const anchors: Anchor[] = paths.map((path) => ({ path }));
  return { anchors, evidence: [], score: 0 };
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
    const evidence = await treeSitterReferenceDisqualifier(groupOf('importer.ts', 'helper.ts'), ctx);
    expect(evidence.disqualifier).toBe('tree-sitter-reference');
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.inconclusive).toBeFalsy();
    expect(evidence.detail).toContain('importer.ts -> helper.ts');
  });

  it('disqualifies a group whose files are connected by a Rust `use`', async () => {
    const evidence = await treeSitterReferenceDisqualifier(groupOf('main.rs', 'widget.rs'), ctx);
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.inconclusive).toBeFalsy();
    expect(evidence.detail).toContain('main.rs -> widget.rs');
  });

  it('is evidence-neutral (zero strength, not inconclusive) when two parseable files reference nothing', async () => {
    const evidence = await treeSitterReferenceDisqualifier(groupOf('alpha.ts', 'beta.ts'), ctx);
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBeFalsy();
  });

  // The parse-failure obligation: a file that cannot be parsed contributes
  // zero evidence in EITHER direction — not disqualifying, not corroborating.
  it('contributes zero evidence and flags inconclusive when an anchor is an unparseable .ts (syntax error)', async () => {
    const evidence = await treeSitterReferenceDisqualifier(groupOf('broken.ts', 'alpha.ts'), ctx);
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBe(true);
    expect(evidence.detail).toContain('parse_failed');
    expect(evidence.detail).toContain('broken.ts');
  });

  it('contributes zero evidence and flags inconclusive for unsupported-language anchors (.md / binary)', async () => {
    const evidence = await treeSitterReferenceDisqualifier(groupOf('notes.md', 'blob.bin'), ctx);
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBe(true);
    expect(evidence.detail).toContain('parse_failed');
  });

  it('never lets a parse failure masquerade as a found reference (mixed parseable + unparseable, no real link)', async () => {
    // broken.ts fails to parse; alpha.ts parses but imports nothing. The
    // disqualifier must not invent a reference — strength stays 0.
    const evidence = await treeSitterReferenceDisqualifier(groupOf('broken.ts', 'alpha.ts', 'beta.ts'), ctx);
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBe(true);
  });

  it('is evidence-neutral for a single-file group (nothing to connect)', async () => {
    const evidence = await treeSitterReferenceDisqualifier(groupOf('importer.ts'), ctx);
    expect(evidence.strength).toBe(0);
    expect(evidence.inconclusive).toBeFalsy();
  });

  it('does not throw on a degenerate repo with only unsupported files', async () => {
    const degenerateCtx = createRepoContext(buildSingleCommitRepo());
    const evidence = await treeSitterReferenceDisqualifier(groupOf('a.txt', 'b.txt'), degenerateCtx);
    expect(evidence.strength).toBe(0);
    expect(Number.isNaN(evidence.strength)).toBe(false);
    expect(evidence.inconclusive).toBe(true);
  });
});
