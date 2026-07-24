/**
 * Raw path inclusion disqualifier.
 *
 * Literal substring search for one anchor's path or filename inside another
 * anchor's raw file content — catches non-code references (a markdown doc
 * naming a source file, a JSON config referencing a path) that the
 * tree-sitter disqualifier can't or won't parse.
 *
 * Framing: this is a *disqualifier*, not a corroborating signal, because a
 * literal reference means the relationship is already explicit/documented —
 * a markdown doc that names `format-currency.ts` by path has already made
 * that coupling visible to a human reader, so it isn't the kind of *hidden*,
 * implicit dependency this tool exists to surface. Finding a reference
 * therefore pushes the group's disqualifying strength up, not down.
 *
 * Content is read exclusively through `RepoContext.fileAt(path, 'HEAD')`,
 * never direct fs access, so the `.span/` exclusion guard (design decision 5)
 * always applies here too.
 *
 * Per design decision 7, the returned strength is clamped away from exactly 0
 * or 1 — even a confident match/non-match must never let this one
 * disqualifier saturate scoring's log-odds sum to ±Infinity.
 *
 * False-positive heuristic: a bare filename (no directory component in the
 * match candidate) only counts as a valid reference candidate when its stem
 * (the filename minus extension) is at least MIN_STEM_LENGTH characters and
 * not one of a small set of generic stems (`index`, `utils`, `config`, ...)
 * that appear constantly and incidentally across unrelated files' prose,
 * identifiers, and paths. A path fragment that includes a directory
 * component is always eligible regardless of the bare filename's length or
 * genericness, since the directory component itself makes it specific. Every
 * match must also land on a token boundary (no adjacent letter/digit/`_`) so
 * `user.ts` doesn't match inside `superuser.ts.bak`.
 */

import type { Anchor, AnchorGroup, Disqualifier, DisqualifierEvidence, RepoContext } from '../types.js';

const EVIDENCE_LABEL = 'raw-path-inclusion';

/** Kept away from exactly 0/1 per design decision 7. */
const EPSILON = 0.02;
const NO_MATCH_STRENGTH = EPSILON;
const MATCH_STRENGTH = 1 - EPSILON;

/** A bare filename match only counts when its stem is at least this long. */
const MIN_STEM_LENGTH = 4;

/** Generic filename stems that appear constantly and incidentally — never specific enough to disqualify on their own. */
const COMMON_STEMS = new Set([
  'index',
  'main',
  'app',
  'util',
  'utils',
  'type',
  'types',
  'common',
  'helper',
  'helpers',
  'constant',
  'constants',
  'config',
  'base',
  'core',
  'test',
  'tests',
  'mod',
  'lib',
  'setup'
]);

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

function stemOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx <= 0 ? filename : filename.slice(0, idx);
}

/**
 * Candidate substrings to search another anchor's content for, derived from
 * `anchor`'s path, filtered per the false-positive heuristic above.
 */
function referenceCandidates(anchor: Anchor): string[] {
  const name = basename(anchor.path);
  const hasDirectory = name !== anchor.path;
  const candidates: string[] = [];

  // A path fragment with a directory component is always specific enough,
  // regardless of the bare filename's length or genericness.
  if (hasDirectory) candidates.push(anchor.path);

  const stem = stemOf(name).toLowerCase();
  if (stem.length >= MIN_STEM_LENGTH && !COMMON_STEMS.has(stem)) candidates.push(name);

  return candidates;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/** True when `needle` occurs in `haystack` with no adjacent letter/digit/underscore on either side. */
function containsAsToken(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let fromIndex = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx === -1) return false;
    const before = idx > 0 ? haystack[idx - 1] : undefined;
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    fromIndex = idx + 1;
  }
}

/** First anchor encountered per distinct path, preserving `anchors`' original order (mirrors tree-sitter-reference.ts's `distinctAnchorPaths`). */
function distinctAnchorsByPath(anchors: Anchor[]): Map<string, Anchor> {
  const byPath = new Map<string, Anchor>();
  for (const anchor of anchors) {
    if (!byPath.has(anchor.path)) byPath.set(anchor.path, anchor);
  }
  return byPath;
}

interface Match {
  source: string;
  target: string;
  candidate: string;
}

/** True when `sourcePath`'s content (if read) contains a reference candidate derived from `targetPath`. */
function findMatch(sourcePath: string, targetPath: string, contents: ReadonlyMap<string, string | null>): Match | null {
  const content = contents.get(sourcePath);
  if (content === null || content === undefined) return null;

  for (const candidate of referenceCandidates({ path: targetPath })) {
    if (containsAsToken(content, candidate)) return { source: sourcePath, target: targetPath, candidate };
  }
  return null;
}

/**
 * Evaluates every internal edge (every unordered pair of distinct-path
 * anchors) of the candidate group exactly once, returning exactly one
 * `DisqualifierEvidence` per edge, always — a firing pair gets
 * `MATCH_STRENGTH`, a non-firing pair gets today's `NO_MATCH_STRENGTH` floor.
 * Never early-returns on the first firing pair (near-clique grouping plan,
 * "Per-edge disqualifiers — exact no-match floor semantics").
 */
const rawPathInclusionDisqualifier: Disqualifier = async (
  group: AnchorGroup,
  ctx: RepoContext
): Promise<DisqualifierEvidence[]> => {
  const anchorsByPath = distinctAnchorsByPath(group.anchors);
  const paths = [...anchorsByPath.keys()];

  if (paths.length < 2) {
    return [{ disqualifier: EVIDENCE_LABEL, strength: NO_MATCH_STRENGTH }];
  }

  const contents = new Map<string, string | null>();
  await Promise.all(
    paths.map(async (filePath) => {
      contents.set(filePath, await ctx.fileAt(filePath, 'HEAD'));
    })
  );

  const results: DisqualifierEvidence[] = [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const pathA = paths[i];
      const pathB = paths[j];
      const anchorA = anchorsByPath.get(pathA)!;
      const anchorB = anchorsByPath.get(pathB)!;

      const match = findMatch(pathA, pathB, contents) ?? findMatch(pathB, pathA, contents);

      if (match) {
        results.push({
          disqualifier: EVIDENCE_LABEL,
          strength: MATCH_STRENGTH,
          detail: `${match.source} references ${match.target} via literal substring "${match.candidate}"`,
          edge: { a: anchorA, b: anchorB }
        });
      } else {
        results.push({ disqualifier: EVIDENCE_LABEL, strength: NO_MATCH_STRENGTH, edge: { a: anchorA, b: anchorB } });
      }
    }
  }

  return results;
};

export default rawPathInclusionDisqualifier;
