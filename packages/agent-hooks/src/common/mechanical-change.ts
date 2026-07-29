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
 * layer short-circuits to mechanical without reading hunk content; a path that
 * is not manifest-shaped ({@link isClassifiablePath}) is refused before any
 * line rule runs; otherwise the content layer decides. Each of the three
 * content rules is additionally gated on a *context* predicate — a
 * version-adjacent line shape, a checksum field name, a timestamp field name —
 * because an ungated line rule masked semantic edits to buffer sizes,
 * timeouts, pinned date-versions, IP literals, and version comparisons. Every function here is a pure predicate over
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
    // No `---`/`+++` guard here, deliberately (finding 2). Those prefixes are
    // only file headers *outside* a hunk, and the `!hunk` check below already
    // discards everything outside a hunk. Testing the prefix first swallowed
    // real content: inside a hunk a removed line whose text begins with `--`
    // renders as `---…` and an added line beginning with `++` as `+++…`. Every
    // YAML/MDX frontmatter block ends with a bare `---`, and a hunk that
    // *deletes* one had that deletion erased — turning a 2-removed/1-added
    // pure-deletion hunk into a balanced 1/1 pair and manufacturing the very
    // balance the balanced-hunk rule exists to refuse.
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
 * minified/sourcemap output, and vendored segments — seeded from
 * `packages/discover/src/scan.ts`'s `NOISE_BASENAMES`, `NOISE_SUFFIXES`, and
 * `NOISE_SEGMENTS`. That module's `GENERATED_SEGMENTS` (`dist`, `build`,
 * `out`, `coverage`, `.next`) is deliberately **not** mirrored here; see
 * {@link NOISE_SEGMENTS} for why a segment name that can shadow a
 * hand-written file cannot be a suppression rule. Those values are copied
 * here rather than imported — `agent-hooks` must not take a dependency on
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

/**
 * Path suffixes that are noise regardless of location.
 *
 * Each entry must pass the same test as {@link NOISE_SEGMENTS} — "can this
 * name shadow a hand-written file?" — and a *suffix* passes it far more easily
 * than a segment does. Nobody hand-authors `bundle.min.js`, `bundle.js.map`,
 * or a `.tsbuildinfo` incremental-cache blob; those names are produced by a
 * tool or not at all. That is precisely the property `build`, `dist`, and
 * `out` lacked, and it is why they were cut while these stay.
 *
 * `.log` was dropped from this list. A tracked `test/fixtures/sample.log` is a
 * hand-authored fixture that can encode a real contract, so a `.log` suffix
 * fails the test — unlike the four below, it is a name a person plausibly
 * writes. Logs are therefore merely reported, which costs one sentence of
 * prompt.
 */
const NOISE_SUFFIXES = ['.tsbuildinfo', '.min.js', '.min.css', '.map'];

/**
 * Path segments that mark every file beneath them as noise.
 *
 * Deliberately narrow. The test each entry must pass is **"can this name
 * shadow a hand-written file?"** — a match here is unconditional,
 * content-blind silence, so a segment that a person might plausibly author
 * under cannot be listed. `node_modules` and `__pycache__` pass: nobody
 * hand-writes into either.
 *
 * The generated-output segments this list originally carried — `dist`,
 * `build`, `out`, `coverage`, `.next` — all **fail** that test and were
 * removed. `packages/extension/scripts/build/build-production.js` and its
 * `build-testing.js` sibling are tracked, hand-authored esbuild drivers
 * living under a `build` segment; suppressing them by segment name silenced
 * real edits with no content ever read, and an *added* file under such a
 * path was suppressed on first appearance because the short-circuit precedes
 * the `structural` guard. `.cache` and `__snapshots__` were dropped for the
 * same reason: a snapshot is a test fixture that can encode a real contract.
 *
 * These values came from `packages/discover/src/scan.ts`, where they answer
 * "is this file worth *indexing*". That is a different question from "can
 * this file carry an implicit dependency", and the lists did not survive the
 * move: here a match means permanent silence rather than a skipped scan.
 * Generated output under `dist/` is still caught by {@link NOISE_SUFFIXES}
 * when it is minified or a sourcemap — but only because the category layer
 * runs ahead of {@link isClassifiablePath}; while the gate came first, that
 * claim was false, since a `.map` was refused as non-manifest-shaped before
 * its suffix was ever tested. An unminified bundle is merely reported, which
 * costs one sentence of prompt.
 */
const NOISE_SEGMENTS = new Set(['node_modules', '__pycache__']);

export function isNeverSpannedPath(repoRelPath: string): boolean {
  const parts = repoRelPath.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_SUFFIXES.some((s) => repoRelPath.endsWith(s))) return true;
  if (parts.some((p) => NOISE_SEGMENTS.has(p))) return true;
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

/**
 * A dotted version triple, optionally `v`-prefixed, with optional prerelease
 * and build metadata. The trailing `(?!\.\d)` is a finding-1 narrowing: without
 * it the first three groups of a dotted quad (`192.168.2.1`) matched as a
 * semver, so an IP-address edit normalized to an unchanged line. The
 * {@link DOTTED_QUAD_RE} guard below is the primary defense; this lookahead
 * keeps the regex itself from claiming a token it does not own.
 */
const SEMVER_RE = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b(?!\.\d)/g;
const HEXISH_RE = /\b[0-9a-f]{32,}\b|\bsha(?:256|512)-[A-Za-z0-9+/=]{20,}\b|\b[0-9a-f]{7,40}\/[0-9a-f]{7,40}\b/g;
const CHECKSUM_FIELD_RE = /\b(checksum|integrity|resolution|hash|digest|sha\d*)\b/i;

/**
 * A dotted quad — an IPv4 address or netmask, never a version. Its presence on
 * either side of a pair disqualifies the semver rule outright.
 *
 * The trigger this closes is narrower than "an IP changed" (finding 1):
 * {@link SEMVER_RE} consumes only three octets, so an IP line normalized equal
 * only when the *final* octet was untouched. `192.168.1.1` → `192.168.2.1` was
 * suppressed; `192.168.1.1` → `10.0.4.27` was already flagged, its trailing
 * `.1`/`.27` surviving the mask and differing. Excluding the shape outright is
 * still the right rule — a dotted quad is not a version under any edit — but
 * only the third-octet case was ever silently lost.
 */
const DOTTED_QUAD_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

/**
 * The version-adjacent line shapes the semver rule is gated on (finding 1: the
 * accepted decision behind this rule was about *version pins*, but the code
 * implementing it masked any dotted triple anywhere, in any file — so
 * `if (v === "1.2.3")` → `"9.9.9"` read as churn). A pair qualifies only when
 * one of these holds, or the file sits at a manifest-shaped path:
 *
 * - the line names a version (`"version":`, `ARG SCCACHE_VERSION=`);
 * - the token sits in a *value* position after a `:` or a single `=`
 *   (`"git-span-linux-x64": "1.0.141"`, `foo@npm:1.0.141`). The lookbehind and
 *   lookahead exclude comparison operators (`===`, `!==`, `<=`), which are code,
 *   not declarations;
 * - the whole line is a bare version token (the `v1.0.140` man-page/VERSION-file
 *   form);
 * - the line is a roff macro (`.TH git-span 1 "git-span 1.0.140"`), where the
 *   version is positional and carries no adjacent key.
 */
const VERSION_CONTEXT_RES = [
  /version/i,
  /(?<![=!<>+\-*/&|])[:=](?!=)\s*["'`]?v?\d+\.\d+\.\d+/,
  /^\s*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*$/,
  /^\.[A-Za-z]{1,3}\s/
];

/** Basenames whose entire purpose is to declare versions and pinned dependencies. */
const MANIFEST_BASENAMES = new Set([
  'package.json',
  'Cargo.toml',
  'marketplace.json',
  'plugin.json',
  'pyproject.toml',
  'composer.json',
  'go.mod'
]);

/**
 * Field names that make a number or date on the line a *timestamp* rather than
 * merely a number. Finding 1: `TIMESTAMP_RE`'s epoch-integer and bare
 * `YYYY-MM-DD` alternatives were applied with no field guard at all, so
 * `MAX_BYTES = 1073741824`, `timeoutMs: 1000000000`, `TTL = 1000000000000`, and
 * a pinned `apiVersion: '2024-01-01'` all normalized to unchanged lines. Those
 * alternatives now exist only behind this gate — the way `CHECKSUM_FIELD_RE`
 * already gates the checksum rule — so a bare integer or date on a line that
 * does not name a time is never masked. The optional `Ms`/`_ms` tail admits
 * millisecond variants (`builtAtMs`).
 */
const TIMESTAMP_FIELD_RE =
  /\b(timestamps?|generated|generated_?at|built|built_?at|build_?time|date|datetime|time|created_?at|updated_?at|modified|last_?modified|expires|expires_?at|expiry|epoch|mtime|ctime|iat|exp|nbf)(?:Ms|MS|_ms)?\b/i;

const TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{10,13}\b/g;

function normalize(line: string, re: RegExp): string {
  return line.replace(re, ' ');
}

/** Whether a semver token on this line sits in a version-declaring context. */
function isVersionContext(line: string): boolean {
  return VERSION_CONTEXT_RES.some((re) => re.test(line));
}

/** Whether `repoRelPath`'s basename is a manifest — a file whose job is declaring versions. */
function isManifestPath(repoRelPath: string): boolean {
  const parts = repoRelPath.split('/');
  return MANIFEST_BASENAMES.has(parts[parts.length - 1] ?? '');
}

/**
 * Whether this removed/added line pair is a mechanical rewrite under one of the
 * three rules. `manifestPath` relaxes the semver rule's line-shape gate: in a
 * manifest every dotted triple is a version by construction.
 */
function pairIsMechanical(removed: string, added: string, manifestPath: boolean): boolean {
  if (removed === added) return false;
  if (
    !DOTTED_QUAD_RE.test(removed) &&
    !DOTTED_QUAD_RE.test(added) &&
    (manifestPath || isVersionContext(removed)) &&
    normalize(removed, SEMVER_RE) === normalize(added, SEMVER_RE)
  ) {
    return true;
  }
  if (CHECKSUM_FIELD_RE.test(removed) && normalize(removed, HEXISH_RE) === normalize(added, HEXISH_RE)) {
    return true;
  }
  if (TIMESTAMP_FIELD_RE.test(removed) && normalize(removed, TIMESTAMP_RE) === normalize(added, TIMESTAMP_RE)) {
    return true;
  }
  return false;
}

export function isMechanicalDiff(file: FileDiff): MechanicalVerdict {
  if (file.binary) return { mechanical: false, reason: 'binary file' };
  if (file.structural) return { mechanical: false, reason: 'structural change (rename/add/delete)' };
  if (file.hunks.length === 0) return { mechanical: false, reason: 'no hunks' };

  const manifestPath = isManifestPath(file.path);
  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h] as Hunk;
    if (hunk.removed.length !== hunk.added.length || hunk.removed.length === 0) {
      return { mechanical: false, reason: `hunk ${h + 1}: unbalanced removed/added counts` };
    }
    for (let i = 0; i < hunk.removed.length; i++) {
      if (!pairIsMechanical(hunk.removed[i] as string, hunk.added[i] as string, manifestPath)) {
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
/**
 * Basenames the content layer is permitted to classify: files whose whole job
 * is declaring versions, pins, and checksums.
 *
 * This is an **allowlist, deliberately**, and it is the structural form of the
 * property finding 1 showed the rules did not have.
 *
 * It gives up no measured recall: `notes/validation-results.md` locates the
 * classifier's entire measured value in the 242 manifest, `Cargo.toml`,
 * `plugin.json`, `marketplace.json`, and man-page files, and gating by path is a
 * no-op on all three canonical commits (`79030d00`, `ad902127`, `d61155ba`) —
 * every source-extension file in them was already flagged or already
 * span-covered. The sweep's headline "zero source-extension files suppressed"
 * result is *not* the justification: that was a property of the commits swept
 * (all of them already churn), not a guarantee the rules enforced.
 *
 * The first repair drafted here was the
 * mirror image, a denylist of source extensions, and it fails open: any
 * extension nobody enumerated (`.kt`, `.tf`, `.proto`) would still be handed to
 * the line rules, so the failure mode was silent suppression in an unlisted
 * language. Inverting it costs nothing the card wanted — nothing asks for a
 * `.ts` or `.rs` body to be classified at all — and makes an unrecognized path
 * simply never suppressed.
 */
const CLASSIFIABLE_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'Cargo.toml',
  'Cargo.lock',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'plugin.json',
  'marketplace.json',
  'pyproject.toml',
  'composer.json',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'flake.lock',
  'go.mod',
  'go.sum'
]);

/** A roff man page (`man/git-span.1`) — generated from the CLI, version in its `.TH` header. */
const MAN_PAGE_RE = /\.[1-9]$/;

/**
 * Whether the content layer may classify `repoRelPath` at all: a manifest,
 * lockfile, man page, or Dockerfile. Anything else — including every source and
 * prose file — is refused before a single line rule runs, so an unenumerated
 * file type can only ever stay flagged.
 *
 * `Dockerfile` is here for the accepted decision plans/initial.md records: the
 * `ARG SCCACHE_VERSION` bump in `e4fb3baf` is the intended reading of "obvious
 * version bump".
 */
export function isClassifiablePath(repoRelPath: string): boolean {
  const parts = repoRelPath.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (CLASSIFIABLE_BASENAMES.has(base)) return true;
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return true;
  return MAN_PAGE_RE.test(base);
}

export function classifyMechanical(file: FileDiff): MechanicalVerdict {
  // Category layer first, then the fail-closed gate, then content.
  //
  // The gate briefly sat ahead of *both* layers, on the reasoning that a
  // path-shape short-circuit is unconditional content-blind silence and so
  // must be the more guarded of the two. That was the right instinct applied
  // to the wrong list: it was true only while {@link NOISE_SEGMENTS} still
  // carried `build`, `dist`, and `out`, which let a hand-authored esbuild
  // driver like `packages/extension/scripts/build/build-production.js` be
  // silenced by a segment name. Narrowing that list to names nobody authors
  // under removed the hazard at its source, and the two fixes turned out to
  // be alternatives rather than complements — keeping both left the gate
  // refusing `.min.js` and `.map` before {@link NOISE_SUFFIXES} was ever
  // consulted, so three of the four categories CARD.md assigns to this layer
  // silently stopped suppressing.
  //
  // Ordering therefore encodes a standing constraint: the category layer runs
  // first *because* every remaining entry in it is a name that cannot shadow
  // hand-written source. Adding an entry that can — any of the generated-output
  // segments, or a suffix like `.log` a person might author — reintroduces
  // content-blind silence here with nothing downstream to catch it.
  if (isNeverSpannedPath(file.path)) return { mechanical: true };
  if (!isClassifiablePath(file.path)) {
    return { mechanical: false, reason: 'not a manifest-shaped path: the classifier does not apply' };
  }
  return isMechanicalDiff(file);
}
