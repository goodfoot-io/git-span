/**
 * Contract tests for src/signals/time-window.ts. Skipped in Stage 0 — the
 * module is a stub (throws "Not Implemented") whose job right now is only
 * to prove the Signal contract is ergonomic. Unskipped and filled in during
 * Stage 1.
 */

import { describe, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import timeWindowSignal from '../../src/signals/time-window.js';
import { buildNoTagsRepo, buildShallowCloneRepo, buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';

describe.skip('time-window signal', () => {
  it('pairs hunks edited within a 6h window into an AnchorGroup', async () => {
    // Real fixture + real time-window assertions land in Stage 1.
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await timeWindowSignal(ctx);
    // Design decision 9: degenerate repos degrade to an empty report, never a crash.
    if (groups.length !== 0) throw new Error('expected an empty AnchorGroup[]');
  });
});
