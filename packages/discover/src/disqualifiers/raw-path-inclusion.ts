/**
 * Raw path inclusion disqualifier.
 *
 * Literal substring search for one anchor's path or filename inside another
 * anchor's raw file content — catches non-code references (a markdown doc
 * naming a source file, a JSON config referencing a path) that the
 * tree-sitter disqualifier can't or won't parse.
 *
 * Stubbed in Stage 0 to prove the Disqualifier contract (real RepoContext
 * shape, real return shape) is ergonomic before the tree-sitter disqualifier
 * is built against it. Implemented in Stage 1.
 */

import type { AnchorGroup, Disqualifier, DisqualifierEvidence, RepoContext } from '../types.js';

const rawPathInclusionDisqualifier: Disqualifier = async (
  _group: AnchorGroup,
  _ctx: RepoContext
): Promise<DisqualifierEvidence> => {
  throw new Error('Not Implemented');
};

export default rawPathInclusionDisqualifier;
