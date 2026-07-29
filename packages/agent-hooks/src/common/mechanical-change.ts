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
 * Not implemented in this phase — Phase 3 ports the prototype parser.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  void text;
  throw new Error('Not Implemented');
}

// ---------------------------------------------------------------------------
// Category layer
// ---------------------------------------------------------------------------

/**
 * Whether `repoRelPath` matches the path-shape denylist that is never
 * expected to carry a hand-authored implicit dependency — lockfiles,
 * generated output, vendored/noise segments — seeded from
 * `packages/discover/src/scan.ts`'s `NOISE_BASENAMES`, `NOISE_SUFFIXES`,
 * `NOISE_SEGMENTS`, and `GENERATED_SEGMENTS` rather than reinvented.
 * Glob-shaped rules reuse {@link compilePattern}, the same matcher
 * `advisor-ignore.ts` already uses. Distinct from the user-owned
 * `.span/.advisorignore` (see {@link file://./advisor-ignore.ts}), which this
 * layer neither reads nor overrides.
 *
 * Not implemented in this phase — Phase 3 ports the prototype's denylist.
 */
export function isNeverSpannedPath(repoRelPath: string): boolean {
  void repoRelPath;
  throw new Error('Not Implemented');
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
 * Not implemented in this phase — Phase 3 ports the prototype's rules
 * verbatim.
 */
export function isMechanicalDiff(file: FileDiff): MechanicalVerdict {
  void file;
  throw new Error('Not Implemented');
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
 * Not implemented in this phase — Phase 3 wires the composition per the
 * card's flowchart.
 */
export function classifyMechanical(file: FileDiff): MechanicalVerdict {
  void file;
  throw new Error('Not Implemented');
}
