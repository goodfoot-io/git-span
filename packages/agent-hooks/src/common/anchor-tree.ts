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

/**
 * Collapse a chain of directories with exactly one child at each level into a
 * single combined name (`public/claude/runtime/skills/card`), matching the
 * card's own example. Stops at the first level that either isn't a lone
 * directory child (2+ children, expand from here) or is a leaf (render the
 * leaf on its own line below the combined directory line).
 */
function collapseChain(node: DirNode): { name: string; node: DirNode } {
  let name = node.name;
  let cur = node;
  while (cur.children.length === 1 && cur.children[0].kind === 'dir') {
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
 * Stacked-range order is numeric (`start` then `end`), overriding arrival or
 * codepoint order — the only sorting this module does, and scoped strictly to
 * ranges stacked on one path (never to sibling paths or directory order).
 * `truncated` entries carry no numeric position and sort after every numeric
 * `range` entry, keeping their own relative arrival order (a stable sort
 * leaves equal-ranked entries — including any two non-numeric entries — in
 * place).
 */
function compareRangeEntries(a: RangeEntry, b: RangeEntry): number {
  const aNumeric = a.range.kind === 'range';
  const bNumeric = b.range.kind === 'range';
  if (aNumeric && bNumeric) {
    const ar = a.range as Extract<RangeLabel, { kind: 'range' }>;
    const br = b.range as Extract<RangeLabel, { kind: 'range' }>;
    return ar.start - br.start || ar.end - br.end;
  }
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return 0;
}

/** The range column's text, or `null` for `whole-file` (zero marker — bare path). */
function labelFor(range: RangeLabel): string | null {
  switch (range.kind) {
    case 'range':
      return `#L${range.start}-L${range.end}`;
    case 'whole-file':
      return null;
    case 'truncated':
      return '(truncated in source — anchor incomplete)';
  }
}

/**
 * Padding cap: no path is ever truncated or elided, but padding itself stops
 * growing past this many columns past the tree prefix. Beyond the cap a
 * single space precedes the range instead of continued padding, so one
 * pathologically long filename can't blow out an entire group's alignment.
 */
const MAX_PAD_COLUMN = 48;

/** Column width to pad `name` (in code points) to, given the sibling group's widest name. */
function computePad(nameLen: number, groupMax: number): string {
  const target = Math.min(groupMax, MAX_PAD_COLUMN);
  if (nameLen >= target) return ' ';
  return ' '.repeat(target - nameLen + 1);
}

/**
 * The widest name (in code points, {@link Array.from} over the string so
 * non-BMP characters count as one unit) among leaf siblings that actually
 * display a range column in this immediate sibling group. Alignment scope is
 * this group's direct children only, never the whole tree.
 */
function computeGroupMax(nodes: PathTreeNode[]): number {
  let max = 0;
  for (const node of nodes) {
    if (node.kind === 'leaf' && node.anchor.ranges.length > 0) {
      max = Math.max(max, Array.from(node.name).length);
    }
  }
  return max;
}

/**
 * Render one leaf's line(s). An empty `ranges` array is a bare-path leaf with
 * no range column at all (distinct from a `whole-file` entry, which is an
 * explicit classification that also prints with zero marker but through the
 * ranges pipeline). Multiple stacked ranges print under a continuation
 * prefix instead of repeating the name; each carries its own suffix
 * independently.
 */
function renderLeafLines(node: LeafNode, ownPrefix: string, childPrefix: string, groupMax: number): string[] {
  const { name } = node;
  const { ranges } = node.anchor;
  if (ranges.length === 0) return [`${ownPrefix}${name}`];

  const sorted = [...ranges].sort(compareRangeEntries);
  const nameLen = Array.from(name).length;
  const pad = computePad(nameLen, groupMax);
  const blank = ' '.repeat(nameLen + pad.length);

  return sorted.map((entry, i) => {
    const label = labelFor(entry.range);
    if (label === null) {
      const base = i === 0 ? `${ownPrefix}${name}` : `${childPrefix}${blank}`;
      return `${base}${entry.suffix}`;
    }
    const base = i === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}

function renderNodes(nodes: PathTreeNode[], prefix: string): string[] {
  const lines: string[] = [];
  const groupMax = computeGroupMax(nodes);
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const ownPrefix = `${prefix}${isLast ? '└─ ' : '├─ '}`;
    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
    if (node.kind === 'leaf') {
      lines.push(...renderLeafLines(node, ownPrefix, childPrefix, groupMax));
    } else {
      const { name, node: finalDir } = collapseChain(node);
      lines.push(`${ownPrefix}${name}/`);
      lines.push(...renderNodes(finalDir.children, childPrefix));
    }
  });
  return lines;
}

/**
 * Render a collapsed anchor list as a box-drawing tree, grouped by shared
 * path prefix. Every anchor list renders as a tree unconditionally — a single
 * anchor becomes a one-line tree; there is no flat-bullet path or size floor
 * in this module.
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
