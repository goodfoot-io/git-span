/**
 * Shared box-drawing tree renderer for a span's anchor list, used by every
 * call site that today prints a flat `- path#Lstart-Lend` bullet run
 * (`touch-core.ts`'s `anchorBullets`, and `advisor-core.ts`'s
 * `annotateBlocks`/`groupCoveringByName`). Anchors that share a directory
 * prefix collapse into one tree instead of being reconstructed by eye from a
 * flat list — the motivating case is parity anchors under parallel
 * `public/claude/...`/`public/codex/...` trees.
 *
 * This module is a pure presentation transform: it never computes drift
 * status or decides which anchors are surfaced. Callers precompute each row's
 * `suffix` (e.g. ` — changed`) exactly as they do today, and only the *shape*
 * of the printed list changes.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * How a single anchor's line range is known. `range` and `whole-file` are the
 * two shapes every anchor takes today; `truncated` is a defensive third shape
 * reachable only from re-parsing the CLI's flat human-format text (a `#L`
 * fragment that doesn't cleanly match `#Lstart-Lend`).
 *
 * Verified invariant: the structured-data call sites can never produce
 * `truncated`. `parsePorcelain` (agent-hooks-common.ts) `continue`s past any
 * row missing a valid range, so an incomplete `PorcelainRow` can never be
 * constructed; the Rust CLI's own porcelain writer always emits a range
 * column (`0-0` for whole-file). `truncated` is reachable only from
 * `annotateBlocks`' flat-text parsing of `blocksText` in a later phase.
 */
export type RangeLabel = { kind: 'range'; start: number; end: number } | { kind: 'whole-file' } | { kind: 'truncated' };

/** One stacked range under a `TreeAnchor`, with its precomputed drift suffix. */
export interface RangeEntry {
  range: RangeLabel;
  /** Precomputed ` — changed` (etc.), or `''` when the anchor carries no drift. */
  suffix: string;
}

/** One distinct path's collapsed anchor entry, ready for tree layout. */
export interface TreeAnchor {
  /** Repo-relative, posix-separated path. */
  path: string;
  /**
   * Stacked ranges on this path. Empty means "path only, no range column at
   * all" — a bare-path leaf, distinct from a single `whole-file` entry (which
   * renders the path too, but is an explicit range-kind classification).
   */
  ranges: RangeEntry[];
}

// ---------------------------------------------------------------------------
// collapseByPath
// ---------------------------------------------------------------------------

/**
 * Collapse rows that name the same path into one `TreeAnchor` with stacked
 * ranges, preserving first-seen order. `renderAnchorTree`'s contract requires
 * at most one `TreeAnchor` per distinct path — this is the mandatory
 * pre-processing step every caller runs first to guarantee that.
 *
 * Mirrors the order-array-plus-Map idiom already used by
 * `dedupeByAnchor()` (advisor-core.ts) for the same reason: the CLI can emit
 * multiple rows for one logical path, and the *position* of a later
 * same-path row is subsumed into that path's first occurrence, not appended
 * at its own later position. Concretely: `a.ts#L1-L5`, `b.ts#L1-L5`,
 * `a.ts#L9-L12` collapses to `[a.ts (two stacked ranges), b.ts (one range)]`
 * — `a.ts` sits at position 0, its first occurrence, not its last.
 */
export function collapseByPath(rows: { path: string; range: RangeLabel; suffix: string }[]): TreeAnchor[] {
  const order: string[] = [];
  const byPath = new Map<string, TreeAnchor>();
  for (const row of rows) {
    let anchor = byPath.get(row.path);
    if (!anchor) {
      anchor = { path: row.path, ranges: [] };
      byPath.set(row.path, anchor);
      order.push(row.path);
    }
    anchor.ranges.push({ range: row.range, suffix: row.suffix });
  }
  return order.map((path) => byPath.get(path) as TreeAnchor);
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

interface LeafNode {
  kind: 'leaf';
  name: string;
  anchor: TreeAnchor;
}

interface DirNode {
  kind: 'dir';
  name: string;
  children: PathTreeNode[];
}

type PathTreeNode = LeafNode | DirNode;

/**
 * Split a path into `/`-separated segments, or `null` when doing so would
 * feed an empty-string segment into the trie (a leading `/`, a trailing `/`,
 * a doubled `//`, or the empty string). `null` signals the caller to render
 * that anchor's full path string as a single, unsplit, atomic top-level leaf
 * instead of attempting to nest it — a known-enumerable class of malformed
 * paths gets a real rule here rather than the split running anyway and
 * fabricating an empty-named directory node. A bare filename with no `/` at
 * all produces exactly one non-empty segment and is handled by the ordinary
 * path below (it becomes a top-level leaf with no directory to nest under —
 * already atomic, no special case needed).
 */
function splitSegments(path: string): string[] | null {
  if (path.length === 0) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) return null;
  return segments;
}

function findOrCreateDir(parent: DirNode, name: string): DirNode {
  for (const child of parent.children) {
    if (child.kind === 'dir' && child.name === name) return child;
  }
  const node: DirNode = { kind: 'dir', name, children: [] };
  parent.children.push(node);
  return node;
}

/** Insert one anchor into the trie, creating/reusing directory nodes in arrival order. */
function insertAnchor(root: DirNode, segments: string[], anchor: TreeAnchor): void {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = findOrCreateDir(cur, segments[i]);
  }
  cur.children.push({ kind: 'leaf', name: segments[segments.length - 1], anchor });
}

/**
 * Build the top-level forest from a `TreeAnchor[]` already collapsed by
 * `collapseByPath`. Sibling order is never re-sorted — a path either opens a
 * new node at its arrival position or is nested under a directory node
 * created/reused at that directory's own first-occurrence position.
 */
function buildForest(anchors: TreeAnchor[]): PathTreeNode[] {
  const root: DirNode = { kind: 'dir', name: '', children: [] };
  for (const anchor of anchors) {
    const segments = splitSegments(anchor.path);
    if (segments === null) {
      root.children.push({ kind: 'leaf', name: anchor.path, anchor });
      continue;
    }
    insertAnchor(root, segments, anchor);
  }
  return root.children;
}

/** A node paired with the (possibly folded) name it displays on its own line. */
interface DisplayItem {
  name: string;
  node: PathTreeNode;
}

/**
 * Fold a chain of single-child nodes into one combined name
 * (`public/claude/runtime/skills/card`, `dirty/mod.rs`,
 * `.devcontainer/Dockerfile`). Folding continues while the current node is a
 * directory with **exactly one child**, regardless of whether that child is a
 * directory or a leaf: a node with one child conveys no grouping by
 * definition, so folding it loses no structure while removing a line whose
 * only content is a connector. Stops at the first directory with 2+ children
 * (expand from there) or at a leaf (which then renders with the folded name).
 *
 * Folding lone *leaves* — not just lone directories — is what keeps the tree
 * no taller than the flat bullet list it replaces, and what makes a single
 * anchor render as the one-line tree the plan promises even when its path has
 * directories in it. It also keeps the discriminating segment on the same
 * line as its range (`dirty/mod.rs #L392-L399`) for `mod.rs`/`index.ts`
 * layouts, where the filename alone identifies nothing.
 */
function foldChain(node: PathTreeNode): DisplayItem {
  let name = node.name;
  let cur = node;
  while (cur.kind === 'dir' && cur.children.length === 1) {
    const child = cur.children[0];
    name = `${name}/${child.name}`;
    cur = child;
  }
  return { name, node: cur };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Rank of a stacked entry's range kind: `whole-file` first, then numeric
 * `range`s, then `truncated`. A whole-file anchor is the CLI's `0-0` row — it
 * covers the entire file, so it sorts ahead of every line range on that file
 * the same way line 0 would. `truncated` carries no position at all and sorts
 * last.
 */
function rangeRank(range: RangeLabel): number {
  switch (range.kind) {
    case 'whole-file':
      return 0;
    case 'range':
      return 1;
    case 'truncated':
      return 2;
  }
}

/**
 * Stacked-range order is by kind rank then numeric (`start` then `end`),
 * overriding arrival or codepoint order — the only sorting this module does,
 * and scoped strictly to ranges stacked on one path (never to sibling paths
 * or directory order). Equal-ranked entries (two `truncated`s, or two
 * identical ranges) keep their own relative arrival order, since the sort is
 * stable.
 */
function compareRangeEntries(a: RangeEntry, b: RangeEntry): number {
  const rank = rangeRank(a.range) - rangeRank(b.range);
  if (rank !== 0) return rank;
  if (a.range.kind === 'range' && b.range.kind === 'range') {
    return a.range.start - b.range.start || a.range.end - b.range.end;
  }
  return 0;
}

/**
 * The range column's text, or `null` when the entry prints as a bare path
 * with no range column at all.
 *
 * A `whole-file` entry is the one kind whose rendering depends on context.
 * Alone on its path it stays a bare path with zero marker — that is what the
 * CLI's own flat list prints for a whole-file anchor, and adding a marker
 * there would annotate the overwhelmingly common case for the benefit of the
 * rare one. *Stacked* behind other ranges on the same path it must carry an
 * explicit marker: without one it renders as a continuation line holding
 * nothing but indentation and its drift suffix, which erases the anchor
 * outright when the suffix is empty and — worse — hangs its ` — changed`
 * under a neighbouring range, exactly the visual grammar that means "another
 * range on this same file". The reader would then reconcile the range that
 * did not drift. Of the three fixes available (print the path on
 * continuation lines, sort whole-file to position 0, or split it into its own
 * leaf), an explicit marker is the only one that makes the entry identifiable
 * in *every* position rather than only in the position the sort happens to
 * put it in; sorting it first (see {@link rangeRank}) is kept as well because
 * "whole file, then its ranges in line order" is the order a reader expects,
 * not because identifiability depends on it.
 */
function labelFor(range: RangeLabel, sole: boolean): string | null {
  switch (range.kind) {
    case 'range':
      return `#L${range.start}-L${range.end}`;
    case 'whole-file':
      return sole ? null : '(whole file)';
    case 'truncated':
      return '(truncated in source — anchor incomplete)';
  }
}

// ---------------------------------------------------------------------------
// Column math
// ---------------------------------------------------------------------------

/**
 * The grapheme segmenter, constructed on first use and then cached — including
 * a cached `null` when it cannot be constructed at all.
 *
 * Lazy on purpose. `Intl` is not part of the JavaScript language core: a Node
 * built `--with-intl=none` has no `Intl` global whatsoever, and `hooks.json`
 * invokes a bare `node` off the user's `PATH`, so `engines.node` constrains
 * nothing here. Constructing this at module scope put a `ReferenceError` in
 * the bundles' top-level statements, where it throws at *import* — before any
 * of the fail-closed `try/catch` blocks in `renderAnchorRun`, `renderPathRun`
 * and `anchorBullets` exist to catch it. The hook process then died with exit
 * 1, which Claude Code treats as a non-blocking hook error: the commit gate
 * silently allowed the commit and the drift reminder silently vanished.
 * Building it inside the render path puts any failure back inside those
 * catches.
 *
 * FAIL-CLOSED, not a `<greenfield>`-forbidden fallback — the same category as
 * the local `try/catch` blocks at this module's call sites, and load-bearing
 * for the same reason. Nothing in the column-alignment path may be able to
 * cost the commit gate or the drift reminder: if display width cannot be
 * measured, the list still prints and the gate still holds; only alignment is
 * lost.
 */
let cachedSegmenter: { value: Intl.Segmenter | null } | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    try {
      cachedSegmenter = { value: new Intl.Segmenter('en', { granularity: 'grapheme' }) };
    } catch {
      cachedSegmenter = { value: null };
    }
  }
  return cachedSegmenter.value;
}

/**
 * Code point ranges rendered two columns wide: the East Asian Wide (W) and
 * Fullwidth (F) blocks of UAX #11, plus the emoji blocks that terminals and
 * proportional agent-facing renderers both give double width. Everything else
 * counts as one column.
 *
 * Sorted ascending and non-overlapping — {@link isWideCodePoint} short-circuits
 * on the first range starting past the code point.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2600, 0x27bf],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x17000, 0x18aff],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd]
];

function isWideCodePoint(cp: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/**
 * Display width of a name in terminal columns — the unit the range column is
 * actually aligned in. Measured over grapheme clusters (so a decomposed `é`
 * or a combining-mark sequence counts once, not once per code point), with
 * each cluster contributing two columns when its base code point is East
 * Asian Wide/Fullwidth or emoji and one otherwise.
 *
 * Neither UTF-16 `.length` nor `Array.from(name).length` is this unit: the
 * first over-counts a surrogate pair, the second under-counts a CJK ideograph
 * and over-counts a decomposed accent.
 *
 * When {@link graphemeSegmenter} is unavailable (a Node built
 * `--with-intl=none` has no `Intl` global at all), this degrades to the cruder
 * per-code-point measure rather than throwing. That measure over-counts a
 * decomposed accent and a regional-indicator flag pair, so alignment can be a
 * column or two off — which is the entire cost, and is the correct price to
 * pay: the anchor list still prints and the commit gate still holds.
 */
function displayWidth(name: string): number {
  const segmenter = graphemeSegmenter();
  let width = 0;
  if (segmenter === null) {
    for (const codePoint of name) {
      width += isWideCodePoint(codePoint.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return width;
  }
  for (const { segment } of segmenter.segment(name)) {
    width += isWideCodePoint(segment.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/**
 * Alignment ceiling. A sibling group whose widest range-bearing name exceeds
 * this width does not align at all — every name in it takes a single space
 * before its range. The alternative (pad the short names to the ceiling while
 * the long one sits at its own natural column) pays most of the width for
 * alignment that aligns with nothing, which is strictly worse than not
 * aligning. Names themselves are never truncated or elided at any width.
 */
const MAX_ALIGN_COLUMN = 48;

/**
 * The column every range-bearing name in this sibling group pads to, or `0`
 * when the group forgoes alignment (no range-bearing names, or a name past
 * {@link MAX_ALIGN_COLUMN}). Alignment scope is the group's direct children
 * only, never the whole tree — whole-tree alignment would let one deeply
 * nested long name pad every unrelated branch.
 */
function computeGroupTarget(items: DisplayItem[]): number {
  let max = 0;
  for (const item of items) {
    if (item.node.kind === 'leaf' && printsRangeColumn(item.node.anchor)) {
      max = Math.max(max, displayWidth(item.name));
    }
  }
  return max > MAX_ALIGN_COLUMN ? 0 : max;
}

/**
 * Whether this anchor prints a range column at all — the exact condition
 * {@link labelFor} encodes, hoisted so {@link computeGroupTarget} measures the
 * same set of names it pads. An anchor with no ranges, or a *sole* whole-file
 * entry (which renders as a bare path with zero marker), contributes no range
 * column and so must not contribute to the group max either: otherwise a
 * whole-file anchor on a path past {@link MAX_ALIGN_COLUMN} silently suppresses
 * alignment for its range-bearing siblings while itself printing nothing to
 * align.
 */
function printsRangeColumn(anchor: TreeAnchor): boolean {
  const { ranges } = anchor;
  if (ranges.length === 0) return false;
  return ranges.some((entry) => labelFor(entry.range, ranges.length === 1) !== null);
}

/** The spacing between a name of `nameWidth` columns and its range column. */
function computePad(nameWidth: number, target: number): string {
  if (nameWidth >= target) return ' ';
  return ' '.repeat(target - nameWidth + 1);
}

/**
 * Render one leaf's line(s). An empty `ranges` array is a bare-path leaf with
 * no range column at all (distinct from a `whole-file` entry, which is an
 * explicit classification that also prints with zero marker when it stands
 * alone, but through the ranges pipeline). Multiple stacked ranges print
 * under a continuation prefix instead of repeating the name; each carries its
 * own suffix independently, and each carries a label identifying which anchor
 * the suffix belongs to.
 */
function renderLeafLines(
  name: string,
  anchor: TreeAnchor,
  ownPrefix: string,
  childPrefix: string,
  groupTarget: number
): string[] {
  const { ranges } = anchor;
  if (ranges.length === 0) return [`${ownPrefix}${name}`];

  const sorted = [...ranges].sort(compareRangeEntries);
  const sole = sorted.length === 1;
  const nameWidth = displayWidth(name);
  const pad = computePad(nameWidth, groupTarget);
  const blank = ' '.repeat(nameWidth + pad.length);

  return sorted.map((entry, i) => {
    const label = labelFor(entry.range, sole);
    if (label === null) return `${ownPrefix}${name}${entry.suffix}`;
    const base = i === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}

function renderNodes(nodes: PathTreeNode[], prefix: string): string[] {
  const lines: string[] = [];
  const items = nodes.map(foldChain);
  const groupTarget = computeGroupTarget(items);
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const ownPrefix = `${prefix}${isLast ? '└─ ' : '├─ '}`;
    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
    if (item.node.kind === 'leaf') {
      lines.push(...renderLeafLines(item.name, item.node.anchor, ownPrefix, childPrefix, groupTarget));
    } else {
      lines.push(`${ownPrefix}${item.name}/`);
      lines.push(...renderNodes(item.node.children, childPrefix));
    }
  });
  return lines;
}

/**
 * Render a collapsed anchor list as a box-drawing tree, grouped by shared
 * path prefix. Every anchor list renders as a tree unconditionally — a single
 * anchor becomes a one-line tree whatever its depth (see {@link foldChain});
 * there is no flat-bullet path or size floor in this module.
 *
 * Height is bounded by {@link foldChain}: a directory line only ever appears
 * where it genuinely groups two or more siblings, so the tree adds at most
 * one line per real grouping and never one per path segment.
 *
 * Total for any well-formed `TreeAnchor[]`: degenerate paths (rule enforced
 * in {@link splitSegments}) are normalized to atomic leaves rather than
 * thrown on, so this function never needs an internal try/catch. Callers add
 * their own catch around this call in a later phase (fail-open discipline
 * lives at the call site, not here).
 *
 * `renderAnchorTree`'s contract requires at most one `TreeAnchor` per
 * distinct `path` — pass anchors through {@link collapseByPath} first.
 */
export function renderAnchorTree(anchors: TreeAnchor[]): string[] {
  const forest = buildForest(anchors);
  return renderNodes(forest, '');
}
