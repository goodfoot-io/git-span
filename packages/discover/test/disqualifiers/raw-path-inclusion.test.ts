/**
 * Contract tests for src/disqualifiers/raw-path-inclusion.ts. Skipped in
 * Stage 0 — the module is a stub (throws "Not Implemented") whose job right
 * now is only to prove the Disqualifier contract is ergonomic. Unskipped
 * and filled in during Stage 1.
 */

import { describe, it } from 'vitest';
import rawPathInclusionDisqualifier from '../../src/disqualifiers/raw-path-inclusion.js';
import { createRepoContext } from '../../src/prefilter.js';
import type { AnchorGroup } from '../../src/types.js';
import { buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';

describe.skip('raw-path-inclusion disqualifier', () => {
  it('finds one anchor path referenced as a literal substring in another anchor file', async () => {
    // Real fixture + real substring-match assertions land in Stage 1.
  });

  it('is evidence-neutral, not disqualifying, when no reference is found', async () => {
    const ctx = createRepoContext(buildSingleCommitRepo());
    const group: AnchorGroup = {
      anchors: [{ path: 'a.txt' }, { path: 'b.txt' }],
      evidence: [],
      score: 0
    };
    const evidence = await rawPathInclusionDisqualifier(group, ctx);
    if (evidence.strength !== 0) throw new Error('expected zero disqualifying strength');
  });
});
