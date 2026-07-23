/**
 * Time-window co-edit signal.
 *
 * Per individual diff hunk edited at time T (anchored to the hunk's line
 * range, not the whole file), opens an unchained [T, T+6h] window and pairs
 * it with every other hunk edited inside that window — a file edit may fall
 * inside multiple overlapping windows.
 *
 * Stubbed in Stage 0 to prove the Signal contract (real RepoContext shape,
 * real return shape) is ergonomic before the six remaining signals and the
 * tree-sitter disqualifier are built against it. Implemented in Stage 1.
 */

import type { AnchorGroup, RepoContext, Signal } from '../types.js';

const timeWindowSignal: Signal = async (_ctx: RepoContext): Promise<AnchorGroup[]> => {
  throw new Error('Not Implemented');
};

export default timeWindowSignal;
