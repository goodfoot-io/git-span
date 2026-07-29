/**
 * Mechanical-churn classifier for the advisor's uncovered-writes check.
 *
 * Suppresses files whose only changes are the kind of rote, dependency-free
 * edits a release-bump or lockfile-refresh commit makes — a semver token
 * rewritten in twenty manifests, a checksum recomputed, a timestamp bumped —
 * so the advisor's "these files carry implicit dependencies" list contains only
 * the one or two files in a changeset that actually carry a real edit. This
 * module is a pure, self-contained predicate library, modeled structurally
 * on {@link file://./advisor-ignore.ts}: no I/O, no subprocess, fail-open on
 * every uncertain input. The subprocess half — reading the diff content
 * these functions classify — lives on {@link GitExecutor} in
 * `advisor-core.ts`, the same place the advisor's other subprocess reads live.
 *
 * Two layers behind one predicate ({@link classifyMechanical}), per the
 * card's flowchart:
 *
 * - **Category layer** ({@link isNeverSpannedPath}) — a path-shape denylist
 *   seeded from `packages/discover/src/scan.ts`'s noise/generated segment
 *   lists, reusing {@link compilePattern} the way `advisor-ignore.ts` does. A
 *   lockfile matches this layer regardless of its diff content: it carries
 *   no implicit dependency worth a span even when a real dependency was
 *   added, so it is suppressed by path shape alone rather than risking a
 *   content-layer false negative on a file that should never be spanned in
 *   the first place.
 * - **Content layer** ({@link isMechanicalDiff}) — a file qualifies only
 *   when it is non-binary, non-structural (no rename/mode-change/add/
 *   delete), has at least one hunk, and *every* hunk has balanced
 *   removed/added line counts with each pair matching one of the three
 *   rules: a semver rewrite, a checksum/integrity/hash field rewrite, or a
 *   timestamp rewrite. Balanced hunk counts are what keeps real edits out —
 *   a semantic change almost never rewrites exactly N lines into exactly N
 *   lines differing only in a version token.
 *
 * {@link classifyMechanical} composes the two: a path matching the category
 * layer short-circuits to mechanical without reading hunk content; otherwise
 * the content layer decides. Every function here is a pure predicate over
 * its input — fail toward reporting means an *uncertain* verdict (parse
 * failure, empty diff read, classifier not reached) must never suppress a
 * path; that fail-open behavior is the caller's responsibility, since this
 * module never throws on bad input except where explicitly documented.
 */

// ---------------------------------------------------------------------------
// Diff shapes
// ---------------------------------------------------------------------------

/**
 * One `-U0` unified-diff hunk: the lines it removed and the lines it added,
 * stripped of their leading `-`/`+` markers. Context lines (present only
 * with non-zero context, which the `-U0` production read never requests)
 * are not represented — a hunk is purely its removed/added pair.
 */
export interface Hunk {
  removed: string[];
  added: string[];
}

/**
 * One file's parsed diff: its repo-relative path, its hunks, and the two
 * structural flags that short-circuit classification before any hunk
 * content is inspected. `binary` is true for a `Binary files a/… and b/…
 * differ` diff (or a `GIT binary patch` body) — no hunk content to
 * classify. `structural` is true for a rename, mode-only change, add, or
 * delete — none of which a line-level mechanical rule should ever
 * "balance" its way past.
 */
export interface FileDiff {
  path: string;
  hunks: Hunk[];
  binary: boolean;
  structural: boolean;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * The result of classifying one {@link FileDiff}. `mechanical: true` means
 * every hunk matched a mechanical rule and the file is safe to suppress
 * from the uncovered-writes list. `mechanical: false` always carries a
 * `reason` — enough diagnostic detail to explain the rejection (e.g. "binary
 * file", "structural change (rename/add/delete)", "no hunks", "hunk 2:
 * unbalanced removed/added counts", "hunk 1: no rule matched") — so a
 * rejection is never a silent guess.
 */
export type MechanicalVerdict = { mechanical: true } | { mechanical: false; reason: string };

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

/**
 * Parse `git diff -U0`-formatted text into one {@link FileDiff} per file.
 * Recognizes multi-file diffs, binary file markers, renames, mode-only
 * changes, adds/deletes, and `-U0` hunk headers (`@@ -a,b +c,d @@`).
 *
 * Ported verbatim from the validated prototype
 * (`att-b40d4ca0…_classify.ts`), which swept 1132 commits producing the
 * measured numbers plans/initial.md cites.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: Hunk | null = null;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flushHunk();
      if (current) files.push(current);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const path = m ? (m[2] as string) : line.slice(11);
      current = { path, hunks: [], binary: false, structural: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      continue;
    }
    if (
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode')
    ) {
      current.structural = true;
      continue;
    }
    if (line.startsWith('index ')) continue;
    if (line.startsWith('@@')) {
      flushHunk();
      hunk = { removed: [], added: [] };
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (!hunk) continue;
    if (line.startsWith('-')) hunk.removed.push(line.slice(1));
    else if (line.startsWith('+')) hunk.added.push(line.slice(1));
  }
  flushHunk();
  if (current) files.push(current);
  return files;
}

// ---------------------------------------------------------------------------
// Category layer
// ---------------------------------------------------------------------------

/**
 * Whether `repoRelPath` matches the path-shape denylist that is never
 * expected to carry a hand-authored implicit dependency — lockfiles,
 * generated output, vendored/noise segments — seeded from
 * `packages/discover/src/scan.ts`'s `NOISE_BASENAMES`, `NOISE_SUFFIXES`,
 * `NOISE_SEGMENTS`, and `GENERATED_SEGMENTS`. Those values are copied here
 * rather than imported — `agent-hooks` must not take a dependency on
 * `discover` — and none of them are glob-shaped (basenames, suffixes, and
 * bare path segments), so there is nothing here for {@link compilePattern}
 * (from `span-ignore.ts`, reused by `advisor-ignore.ts` for its glob-shaped
 * `.advisorignore` rules) to compile. Distinct from the user-owned
 * `.span/.advisorignore` (see {@link file://./advisor-ignore.ts}), which this
 * layer neither reads nor overrides.
 */

/** Basenames that are noise regardless of location: lockfiles and junk. */
const NOISE_BASENAMES = new Set([
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  'composer.lock',
  'Gemfile.lock',
  'flake.lock',
  '.DS_Store'
]);

/** Path suffixes that are noise regardless of location. */
const NOISE_SUFFIXES = ['.log', '.tsbuildinfo', '.min.js', '.min.css', '.map'];

/** Path segments that mark every file beneath them as noise. */
const NOISE_SEGMENTS = new Set(['node_modules', '__pycache__', '.cache', '__snapshots__']);

/** Path segments that mark every file beneath them as generated output. */
const GENERATED_SEGMENTS = new Set(['dist', 'build', 'out', 'coverage', '.next']);

export function isNeverSpannedPath(repoRelPath: string): boolean {
  const parts = repoRelPath.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_SUFFIXES.some((s) => repoRelPath.endsWith(s))) return true;
  if (parts.some((p) => NOISE_SEGMENTS.has(p) || GENERATED_SEGMENTS.has(p))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Content layer
// ---------------------------------------------------------------------------

/**
 * Whether `file`'s diff content is entirely mechanical: non-binary,
 * non-structural, at least one hunk, and every hunk's removed/added lines
 * balanced in count with each pair matching a semver, checksum, or
 * timestamp rewrite rule (see this module's doc comment for the three
 * rules). Any hunk that fails to match — an unbalanced pair, a pair
 * matching no rule — rejects the whole file: mechanical classification is
 * all-or-nothing per file, never partial.
 *
 * Ported verbatim from the validated prototype (`att-b40d4ca0…_classify.ts`).
 */

const SEMVER_RE = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g;
const HEXISH_RE = /\b[0-9a-f]{32,}\b|\bsha(?:256|512)-[A-Za-z0-9+/=]{20,}\b|\b[0-9a-f]{7,40}\/[0-9a-f]{7,40}\b/g;
const CHECKSUM_FIELD_RE = /\b(checksum|integrity|resolution|hash|digest|sha\d*)\b/i;
const TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{10,13}\b/g;

function normalize(line: string, re: RegExp): string {
  return line.replace(re, ' ');
}

/** Whether this removed/added line pair is a mechanical rewrite under one of the three rules. */
function pairIsMechanical(removed: string, added: string): boolean {
  if (removed === added) return false;
  if (normalize(removed, SEMVER_RE) === normalize(added, SEMVER_RE)) return true;
  if (CHECKSUM_FIELD_RE.test(removed) && normalize(removed, HEXISH_RE) === normalize(added, HEXISH_RE)) {
    return true;
  }
  if (normalize(removed, TIMESTAMP_RE) === normalize(added, TIMESTAMP_RE)) return true;
  return false;
}

export function isMechanicalDiff(file: FileDiff): MechanicalVerdict {
  if (file.binary) return { mechanical: false, reason: 'binary file' };
  if (file.structural) return { mechanical: false, reason: 'structural change (rename/add/delete)' };
  if (file.hunks.length === 0) return { mechanical: false, reason: 'no hunks' };

  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h] as Hunk;
    if (hunk.removed.length !== hunk.added.length || hunk.removed.length === 0) {
      return { mechanical: false, reason: `hunk ${h + 1}: unbalanced removed/added counts` };
    }
    for (let i = 0; i < hunk.removed.length; i++) {
      if (!pairIsMechanical(hunk.removed[i] as string, hunk.added[i] as string)) {
        return { mechanical: false, reason: `hunk ${h + 1}: no rule matched` };
      }
    }
  }
  return { mechanical: true };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * The two-layer classifier the advisor calls per uncovered file: the category
 * layer ({@link isNeverSpannedPath}) short-circuits to mechanical by path
 * shape alone; otherwise the content layer ({@link isMechanicalDiff})
 * decides from the hunk content. This is the single entry point
 * `advisor-core.ts` invokes — callers should not call the two layers directly.
 *
 */
export function classifyMechanical(file: FileDiff): MechanicalVerdict {
  if (isNeverSpannedPath(file.path)) return { mechanical: true };
  return isMechanicalDiff(file);
}
