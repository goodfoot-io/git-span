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

const rawPathInclusionDisqualifier: Disqualifier = async (
  group: AnchorGroup,
  ctx: RepoContext
): Promise<DisqualifierEvidence> => {
  const { anchors } = group;
  if (anchors.length < 2) {
    return { disqualifier: EVIDENCE_LABEL, strength: NO_MATCH_STRENGTH };
  }

  for (const source of anchors) {
    const content = await ctx.fileAt(source.path, 'HEAD');
    if (content === null) continue;

    for (const target of anchors) {
      if (target.path === source.path) continue;

      for (const candidate of referenceCandidates(target)) {
        if (containsAsToken(content, candidate)) {
          return {
            disqualifier: EVIDENCE_LABEL,
            strength: MATCH_STRENGTH,
            detail: `${source.path} references ${target.path} via literal substring "${candidate}"`
          };
        }
      }
    }
  }

  return { disqualifier: EVIDENCE_LABEL, strength: NO_MATCH_STRENGTH };
};

export default rawPathInclusionDisqualifier;
