# `git span history` — v2 output contract

This document is the reference specification for `git span history`'s two renderers
(`render_human` and `render_json` in [history.rs](../src/cli/history.rs)). Every example
below is genuine output — captured by building the CLI and running
`git span history agent-hooks/hook-message-copy` against this repository's own git
history — trimmed for length with `⋮` markers. Those markers are elision added for this
document only; the real renderers never truncate a diff or drop a commit.

## Output contract

Both formats render the same underlying timeline, newest-first:

- **`current`** — the span's *live* drift: how the content at each declared address now
  differs from the state the declaration records, rendered first (human) or as the
  `current` object (JSON). **Not only working-tree drift.** It covers every layer
  `git span stale` reports because the resolver behind it is `stale`'s, run over
  the same `HEAD`/index/worktree layer set. These are observational layers, not commit
  statuses: `HEAD` can describe committed content drift or a worktree-only declaration
  re-anchor compared with the declaration in `HEAD`. Which layers a given anchor drifted
  at is named by the `sources` field and by the `drift source` marker line, so a clean
  working tree is never described as a working-tree edit. Omitted entirely when the
  worktree declaration matches `HEAD` and no anchor has drifted.
- **`commits`** — one section per commit that changed the declaration or an anchored
  file's content within a declared range, newest-first. A qualifying commit that changed
  nothing observable (e.g. only outside every declared range) produces no section.

Every observable change is expressed exactly once, as a unified diff in git's own
dialect:

- **`span_diff`** — the real git blob diff of the `.span/<name>` declaration file between
  two states. This subsumes the old `why` field: why prose lives in the declaration, so a
  why edit shows up as an ordinary line in this diff.
- **per-anchor diffs** — pseudo-diffs between an anchor's *extracted snapshots*, using
  `path#Lstart-Lend` display paths and `index rk64:…` lines instead of git blob OIDs.
  Anchors pair across consecutive states by identical content first, then by exact
  address, then by content similarity (git's `-M` shape). Similarity pairing is
  conditional on the floor: at or above 50% a re-anchor renders as one
  `rename from`/`rename to` block; below it the two snapshots are unrelated and render
  as `deleted anchor` + `new anchor`; when the recorded side cannot be read at all the
  rename lines stay and the `similarity index` line is omitted, because nothing could be
  measured. Separately and independently of content, an address that stood still while
  the token the declaration records for it changed renders a `rebound anchor` block —
  beside the content block when the content changed too.

Declared anchor ranges are taken at face value at every commit — a stale range
extracting "wrong" content *is* the drift being visualized, never remapped. Anchor diffs
are always computed between extracted snapshots, never by clipping a file's real commit
patch to a line range.

## Human format (default)

`git log -p` style: `commit <40-hex>`,
`Date:   <weekday> <month> <day> HH:MM:SS YYYY <±HHMM>`, a blank line, the
four-space-indented commit summary, a blank line, then the declaration diff and each
anchor diff. Live drift (when present) comes first with no `commit`/`Date` header —
git's own idiom for "outside the timeline", which is what this block is: the drift may
can involve any resolver layer, and the headerless form says only that no single commit
entry accounts for it. The `drift source` line names the observing layers; it does not
prove whether the declaration or content change was committed.

Real output, two consecutive commits from `agent-hooks/hook-message-copy`'s history —
a pure re-anchor with content hunks (similarity < 100%, so headers *and* hunks), two
anchor deletions, an ordinary content modification, an anchor first-add, and a pure
re-anchor with no content change (similarity 100%, header only, no hunks):

```
commit e86fe9cc50f359301ca4a61156f4f6bfcba150a8
Date:   Wed Jul 29 14:53:08 2026 -0400

    Rebuild the gate bundles over both the ranking fix and the bracketed-path fix

diff --git a/.span/agent-hooks/hook-message-copy b/.span/agent-hooks/hook-message-copy
index 08d060d..b5566ae 100644
--- a/.span/agent-hooks/hook-message-copy
+++ b/.span/agent-hooks/hook-message-copy
@@ -1,6 +1,4 @@
-packages/agent-hooks/src/common/gate-core.ts#L1019-L1126 rk64:0a52ab2b949313f9
-packages/agent-hooks/src/common/gate-core.ts#L1025-L1132 rk64:0a52ab2b949313f9
-packages/agent-hooks/src/common/gate-core.ts#L1032-L1139 rk64:0a52ab2b949313f9
+packages/agent-hooks/src/common/gate-core.ts#L1040-L1147 rk64:0a52ab2b949313f9
 packages/agent-hooks/src/common/touch-core.ts#L245-L274 rk64:fe4d90f3aa35936c
 packages/website/content/docs/agent-integration.mdx rk64:34c2f95c65143b3d
 plugins-claude/git-span/skills/git-span/references/understanding-hook-output.md rk64:eb3ed563e709d0d3

diff --git a/packages/agent-hooks/src/common/gate-core.ts#L1032-L1139 b/packages/agent-hooks/src/common/gate-core.ts#L1040-L1147
similarity index 92%
rename from packages/agent-hooks/src/common/gate-core.ts#L1032-L1139
rename to packages/agent-hooks/src/common/gate-core.ts#L1040-L1147
index rk64:8a020b17c9efd975..rk64:0a52ab2b949313f9
--- a/packages/agent-hooks/src/common/gate-core.ts#L1032-L1139
+++ b/packages/agent-hooks/src/common/gate-core.ts#L1040-L1147
@@ -1032,11 +1040,3 @@
-  }
-
-  const out: string[] = [];
-  let pending: StalePorcelainRow[] = [];
-  let inBullets = false;
-  const closeBullets = (): void => {
-    for (const { addr, statuses } of dedupeByAnchor(pending)) {
-      out.push(`- ${addr} — ${statuses.map(humanStatusLabel).join(', ')}`);
     }
     pending = [];
     inBullets = false;
@@ -1137,3 +1137,11 @@
   if (text.includes('<git-span>')) return text;
   return `<git-span>\n${text}\n</git-span>`;
 }
+
+/**
+ * The advisory surfaced when the changeset's only staleness is environmental —
+ * the gate allows but says why, so the unresolvable condition is not silently
+ * swallowed.
+ */
+function renderEnvironmentalReason(conditions: StalePorcelainRow[], blocksText: string): string {
+  return [

diff --git a/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126 b/dev/null
deleted anchor
index rk64:f239cfdd91dbaf6c..0000000000000000
--- a/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126
+++ /dev/null
@@ -1019,108 +0,0 @@
- * bullet run; spans absent from `blocksText` entirely (or an empty/failed
- * list read) get a synthesized minimal block — no finding is ever dropped.
- * Every finding matching (or appended for) a given anchor address is
- * collapsed via {@link dedupeByAnchor} first, so a single anchor never
- * renders as more than one bullet regardless of how many drifting-layer rows
- * the CLI emitted for it.
- */
⋮  (108-line deletion body continues, omitted here for length)

diff --git a/packages/agent-hooks/src/common/gate-core.ts#L1025-L1132 b/dev/null
deleted anchor
index rk64:553a1236747ca251..0000000000000000
--- a/packages/agent-hooks/src/common/gate-core.ts#L1025-L1132
+++ /dev/null
@@ -1025,108 +0,0 @@
- */
-function annotateBlocks(blocksText: string, rows: StalePorcelainRow[]): string {
-  const remaining = new Map<string, StalePorcelainRow[]>();
⋮  (108-line deletion body continues, omitted here for length — this commit
   consolidated two near-duplicate anchor ranges into the single re-anchored
   range shown above, so both old ranges delete in the same commit)

commit 78da668ffb8928389751cc54266a9bfddeb66bb8
Date:   Wed Jul 29 14:48:30 2026 -0400

    Correct the overstated invariant on the changeset filter

diff --git a/.span/agent-hooks/hook-message-copy b/.span/agent-hooks/hook-message-copy
index 131dbbc..08d060d 100644
--- a/.span/agent-hooks/hook-message-copy
+++ b/.span/agent-hooks/hook-message-copy
@@ -1,5 +1,6 @@
 packages/agent-hooks/src/common/gate-core.ts#L1019-L1126 rk64:0a52ab2b949313f9
 packages/agent-hooks/src/common/gate-core.ts#L1025-L1132 rk64:0a52ab2b949313f9
+packages/agent-hooks/src/common/gate-core.ts#L1032-L1139 rk64:0a52ab2b949313f9
 packages/agent-hooks/src/common/touch-core.ts#L245-L274 rk64:fe4d90f3aa35936c
 packages/website/content/docs/agent-integration.mdx rk64:34c2f95c65143b3d
 plugins-claude/git-span/skills/git-span/references/understanding-hook-output.md rk64:eb3ed563e709d0d3

diff --git a/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126 b/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126
index rk64:671b650278f9e4b5..rk64:f239cfdd91dbaf6c
--- a/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126
+++ b/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126
@@ -1019,3 +1019,10 @@
+ * bullet run; spans absent from `blocksText` entirely (or an empty/failed
+ * list read) get a synthesized minimal block — no finding is ever dropped.
+ * Every finding matching (or appended for) a given anchor address is
+ * collapsed via {@link dedupeByAnchor} first, so a single anchor never
+ * renders as more than one bullet regardless of how many drifting-layer rows
+ * the CLI emitted for it.
+ */
 function annotateBlocks(blocksText: string, rows: StalePorcelainRow[]): string {
   const remaining = new Map<string, StalePorcelainRow[]>();
   for (const row of rows) {
@@ -1117,10 +1124,3 @@
   ].join('\n');
 }
 
-/**
- * Wrap `text` for delivery as a harness's `additionalContext`, so every such
- * payload this gate emits sits inside a `<git-span>...</git-span>` block —
- * matching the touch hook's block styling — never bare prose. A no-op when
- * `text` already carries a `<git-span>` tag somewhere (e.g.
- * {@link renderUncoveredReason}'s output already wraps itself), so a caller
- * can apply this unconditionally without ever nesting one block inside

diff --git a/dev/null b/packages/agent-hooks/src/common/gate-core.ts#L1025-L1132
new anchor
index 0000000000000000..rk64:553a1236747ca251
--- /dev/null
+++ b/packages/agent-hooks/src/common/gate-core.ts#L1025-L1132
@@ -0,0 +1025,108 @@
+ */
+function annotateBlocks(blocksText: string, rows: StalePorcelainRow[]): string {
+  const remaining = new Map<string, StalePorcelainRow[]>();
+  for (const row of rows) {
+    const group = remaining.get(row.name);
+    if (group) group.push(row);
+    else remaining.set(row.name, [row]);
⋮  (108-line addition body continues, omitted here for length)

diff --git a/packages/agent-hooks/src/common/gate-core.ts#L1025-L1132 b/packages/agent-hooks/src/common/gate-core.ts#L1032-L1139
similarity index 100%
rename from packages/agent-hooks/src/common/gate-core.ts#L1025-L1132
rename to packages/agent-hooks/src/common/gate-core.ts#L1032-L1139
index rk64:8a020b17c9efd975..rk64:8a020b17c9efd975
```

Conventions demonstrated:

- The `.span/<name>` diff (`span_diff`) uses ordinary git blob headers (`index
  <old7>..<new7> 100644`, `/dev/null` on creation); anchor pseudo-diffs use `index
  rk64:<old>..rk64:<new>` carrying the same `rk64:` extent hashes visible in the
  declaration lines.
- `rename from`/`rename to`/`similarity index NN%` replace git's normal `copy` machinery
  when an anchor's address changes and pairs by content similarity (≥ 50%, git's `-M`
  default) rather than exact address; hunks are included whenever content also changed
  (92% similarity, `e86fe9cc`) and omitted when the paired content is byte-identical
  (100% similarity, `78da668f` — header only, no hunk).
- `new anchor` / `deleted anchor` replace git's mode lines (`new file mode`/`deleted file
  mode`) for anchors with no pairing partner in the adjacent state — including a moved
  anchor whose old and new content fall *below* the similarity threshold, which is two
  unrelated blocks and never one rename; the body is a full addition/deletion against
  `/dev/null`. Git draws the same line: a `git mv` plus a total replacement renders
  `new file` + `deleted file` even at `--find-renames=0%`.
- `rebound anchor` marks a change of *binding*: an address stood still while the token the
  declaration records for it changed. The predicate is per address and says nothing about
  content — the block renders whether or not the content also changed. An anchor that
  *moved*, carrying its content to a new address, is not rebound: the rename block already
  accounts for it (two anchors exchanging addresses along with their content break
  neither). The `index` line carries the two recorded tokens (never the rendered content's
  hash) and the block has no body, because the token transition is its entire content.
  When the content changed too, this block is emitted *beside* the ordinary content block
  for the same address: the rebinding is the event a content hunk cannot express, and a
  lone content hunk invites a re-hash — the repair that would bind the why-prose
  permanently to unrelated content, when the truth wants the rebinding reverted.
- Hunk headers carry real file coordinates: the old range addresses the old file, the new
  range the new file, exactly like ordinary `git diff` output.
- Commits where nothing observable changed (declaration touched but no anchor content or
  address moved, or vice versa) are omitted from the timeline entirely.

### Live drift (`current`)

A live edit inside `touch-core.ts#L245-L274`, here still in the worktree, renders headerless and
first, ahead of any commit sections. Its `drift source worktree` line is what says the
worktree comparison observed the edit. A committed content edit can instead produce
`drift source head`, but that marker alone does not establish commit status: a declaration
re-anchored only in the worktree can also compare its new address with `HEAD`'s declaration
and produce `head`. Inspect `span_diff` and the timeline; if only the declaration changed,
commit or revert that declaration edit rather than searching for a content commit.

```
diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274
drift source worktree
index rk64:49bd4bc548ecea54..rk64:4493cd6c8a727900
--- a/packages/agent-hooks/src/common/touch-core.ts#L245-L274
+++ b/packages/agent-hooks/src/common/touch-core.ts#L245-L274
@@ -247,7 +247,7 @@
 }

 function cleanFooter(fileName: string): string {
-  return `If you change ${fileName} check the other files to confirm they still work together.`;
+  return `If you change ${fileName} check the other coupled files to confirm they still work together.`;
 }

 /**
```

When the worktree declaration bytes also differ from `HEAD` (a `why` edit or
anchor add/remove), a `span_diff` block precedes the anchor diffs, using the same
`index <old7>..<new7> 100644` dialect — the worktree side's hash comes from a blob-OID
computation that never writes the object. The whole `current` section is omitted when the
worktree declaration matches `HEAD` and no anchor resolves as drifted.

### The three `current` shapes

Every drifted anchor is classified into exactly one of three states before it is rendered.
The distinction decides which address each side of the header wears, whether a proposal is
offered, and where the live bytes are read — so the three shapes are worth reading as a
set. All captures below are genuine output of the built binary.

**1. In-place drift** — the declaration is unchanged and the resolver found the content
still at the declared address, edited. Both sides wear the declared address and the hunks
are the edit:

```
diff --git a/touch-core.js#L1-L3 b/touch-core.js#L1-L3
drift source worktree
index rk64:6fc01f81b6737e74..rk64:0ac1f50418017539
--- a/touch-core.js#L1-L3
+++ b/touch-core.js#L1-L3
@@ -1,3 +1,3 @@
 function cleanFooter(name) {
-  return `check ${name}`;
+  return `check the coupled ${name}`;
 }
```

**2. Resolver relocation** — the declaration is unchanged and the recorded content was
found somewhere else. This renders as a *proposal*: `proposed anchor <address>` in the
header, and **both** sides keep the declared address, because nothing has moved yet.
`git span stale` says the same thing (`moved to touch-core.js#L4-L6`), and
`git span stale --fix` is what would write it. There are no hunks — the content is
byte-identical, which is why the two `index` hashes agree:

```
diff --git a/touch-core.js#L1-L3 b/touch-core.js#L1-L3
proposed anchor touch-core.js#L4-L6
drift source worktree
index rk64:6fc01f81b6737e74..rk64:6fc01f81b6737e74
```

```json
{
  "content": "function cleanFooter(name) {\n  return `check ${name}`;\n}\n",
  "diff": "diff --git a/touch-core.js#L1-L3 b/touch-core.js#L1-L3\nproposed anchor touch-core.js#L4-L6\ndrift source worktree\nindex rk64:6fc01f81b6737e74..rk64:6fc01f81b6737e74\n",
  "path": "touch-core.js#L1-L3",
  "proposed": "touch-core.js#L4-L6",
  "sources": ["WORKTREE"]
}
```

**3. Re-anchor** — the *worktree declaration itself* moved the anchor: the same recorded
token sits at a different address than it does in `HEAD`'s copy. No proposal is offered —
the move is already written down. Which form the block takes is decided by the same
similarity threshold that governs every other pairing (≥ 50%, git's `-M` default).

*At or above the threshold*, the two snapshots are one anchor that moved and was edited,
and the block is a rename: the old side is labelled with `HEAD`'s address and carries the
recorded bytes, the new side is labelled with the worktree's address and carries the bytes
live there. In this capture `.span/re` moved from `touch-core.js#L1-L3` to
`touch-core.js#L3-L5` in the same edit that reworded the helper and pushed it down two
lines:

```
diff --git a/touch-core.js#L1-L3 b/touch-core.js#L3-L5
similarity index 66%
rename from touch-core.js#L1-L3
rename to touch-core.js#L3-L5
drift source worktree, head
index rk64:6fc01f81b6737e74..rk64:0ac1f50418017539
--- a/touch-core.js#L1-L3
+++ b/touch-core.js#L3-L5
@@ -1,3 +3,3 @@
 function cleanFooter(name) {
-  return `check ${name}`;
+  return `check the coupled ${name}`;
 }
```

*Below the threshold*, the two snapshots have nothing to do with each other — the ordinary
case being an anchor re-pointed to its new home before the content matches — and a rename
would spell out an edit that never happened. It renders instead as two blocks asserting no
edit at all: the recorded block leaves its old address, and the newly covered block
arrives at the new one. Git behaves the same way; it emits `new file` + `deleted file` for
a `git mv` plus a total replacement even at `--find-renames=0%`. Here `.span/re` was
re-anchored from `touch-core.js#L1-L3` to `touch-core.js#L5-L7`, where unrelated code
lives:

```
diff --git a/touch-core.js#L1-L3 b/dev/null
deleted anchor
drift source head
index rk64:6fc01f81b6737e74..0000000000000000
--- a/touch-core.js#L1-L3
+++ /dev/null
@@ -1,3 +0,0 @@
-function cleanFooter(name) {
-  return `check ${name}`;
-}

diff --git a/dev/null b/touch-core.js#L5-L7
new anchor
drift source head
index 0000000000000000..rk64:3ce91890e260ec60
--- /dev/null
+++ b/touch-core.js#L5-L7
@@ -0,0 +5,3 @@
+function cleanHeader(name) {
+  return `${name} depends on:`;
+}
```

The two paths agree: the `current` block and the timeline entry the same declaration
change produces once committed render the same form for the same event — a rename at or
above the threshold, a delete plus a create below it.

There is a third case, and it is not a third point on the same scale. The threshold sorts
re-anchors whose two sides can be *compared*; when the recorded side is unrecoverable
there is nothing to compare, and the two verdicts must not be conflated. Continuity
disproven splits into two blocks. Continuity **unknown** disproves nothing: `Reanchored`
is entered because the user's own declaration moved a recorded token between addresses, so
the move is asserted rather than inferred, and splitting it would fabricate two events
where one was declared. The rename lines stay and the `similarity index` line is simply
absent — its absence is the positive claim "how alike is unknown", which is the honest
alternative to measuring an unreadable side as `0%`:

```
diff --git a/f.txt#L1-L3 b/f.txt#L5-L7
rename from f.txt#L1-L3
rename to f.txt#L5-L7
drift source head
index rk64:1c854b1df1e7cc97..rk64:e892818d24d10605
recorded snapshot unrecoverable
```

`similarity index 0%` therefore has no producer anywhere in the command: a measurable pair
below the floor splits, and an unmeasurable one omits the number.

A re-anchor outranks a relocation: when the declaration has moved an anchor *and* the
resolver would propose a further move, the declaration's move is what renders. Two
directions of travel in one header would contradict each other.

### When the recorded bytes cannot be shown

A diff needs an old side, and the old side is the bytes the declaration records by hash.
`recorded snapshot unrecoverable` is the marker for the case where those bytes are
nowhere to be found:

> **the predicate, stated once:** the field fires exactly when *no snapshot in this
> render's snapshot set hashes to the declaration's recorded token*. It is render-scoped —
> a claim about what this report can show, never a claim about the repository at large.

The search runs by content hash across every snapshot the report produces, not merely
under the anchor's own address, so the marker can never claim a loss that the same output
disproves twenty lines lower. It reaches the reader in the header, beside
`proposed anchor` and the rename lines, so the human block and the JSON `diff` string stay
byte-identical. The block then stops there: two differing hashes and no hunks. It never
co-occurs with `proposed` — a relocation found the recorded bytes by definition.

The ordinary way to reach this state is a declaration that was written but never
committed, whose content then moved on:

```
diff --git a/touch-core.js#L1-L3 b/touch-core.js#L1-L3
drift source worktree
index rk64:6fc01f81b6737e74..rk64:0ac1f50418017539
recorded snapshot unrecoverable
```

```json
{
  "content": "function cleanFooter(name) {\n  return `check the coupled ${name}`;\n}\n",
  "diff": "diff --git a/touch-core.js#L1-L3 b/touch-core.js#L1-L3\ndrift source worktree\nindex rk64:6fc01f81b6737e74..rk64:0ac1f50418017539\nrecorded snapshot unrecoverable\n",
  "path": "touch-core.js#L1-L3",
  "recorded": "unrecoverable",
  "sources": ["WORKTREE"]
}
```

## JSON format (`--format json`, `schema_version: 2`)

Same data; `diff`/`span_diff`/`content` are the identical raw strings the human renderer
prints — not structured hunks. Real output, `git span history agent-hooks/hook-message-copy
--format json -n 1`, for the same working-tree edit shown above. Object keys render in
alphabetical order (the emitter's own order, not hand-arranged); long string values below
are trimmed with `⋮` (never with `…`, and never in a way a reader could mistake for real
diff/content bytes) for length only:

```json
{
  "commits": [
    {
      "anchors": [
        {
          "diff": "diff --git a/packages/agent-hooks/src/common/advisor-core.ts#L1308-L1600 b/packages/agent-hooks/src/common/advisor-core.ts#L1308-L1600\nrebound anchor\nindex rk64:c2562abf5e1ddfde..rk64:430eac0d450d07d6\n",
          "path": "packages/agent-hooks/src/common/advisor-core.ts#L1308-L1600"
        },
        {
          "diff": "diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\nrebound anchor\nindex rk64:4ec29c5402e3f47c..rk64:49bd4bc548ecea54\n",
          "path": "packages/agent-hooks/src/common/touch-core.ts#L245-L274"
        }
      ],
      "date": "2026-07-30T11:51:18-04:00",
      "hash": "5c5dcecd53c3f53a3801878f06f4b23636e7b945",
      "span_diff": "diff --git a/.span/agent-hooks/hook-message-copy b/.span/agent-hooks/hook-message-copy\nindex 2b1682a..dcdf615 100644\n--- a/.span/agent-hooks/hook-message-copy\n+++ b/.span/agent-hooks/hook-message-copy\n@@ -1,7 +1,7 @@\n⋮ (rest of the declaration diff, elided here for length)\n",
      "summary": "Re-hash hook-message-copy after footer copy refinement"
    }
  ],
  "current": {
    "anchors": [
      {
        "content": "function cleanHeader(fileName: string): string {\n  return `${fileName} has implicit dependencies:`;\n}\n\nfunction cleanFooter(fileName: string): string {\n  return `If you change ${fileName} check the other coupled files to confirm they still work together.`;\n}\n⋮ (rest of the extracted anchor snapshot, elided here for length)\n",
        "diff": "diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\ndrift source worktree\nindex rk64:49bd4bc548ecea54..rk64:4493cd6c8a727900\n--- a/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n+++ b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n@@ -247,7 +247,7 @@\n }\n \n function cleanFooter(fileName: string): string {\n-  return `If you change ${fileName} check the other files to confirm they still work together.`;\n+  return `If you change ${fileName} check the other coupled files to confirm they still work together.`;\n }\n \n /**\n",
        "path": "packages/agent-hooks/src/common/touch-core.ts#L245-L274",
        "sources": ["WORKTREE"]
      }
    ]
  },
  "schema_version": 2,
  "scoped": true,
  "span": "agent-hooks/hook-message-copy"
}
```

`scoped: true` is present here because `-n 1` dropped older commits — the object above is
a genuine capture of that scoped case, `commits` and all: `-n 1` still surfaces one commit
alongside `current`, since `current` and the newest qualifying commit are independent of
each other.

The `anchors` array above is elided to two of its five entries. A `commit` whose
`.span/<name>` change re-hashed every anchor without adding, removing, or moving one (as
`5c5dcecd`) still accounts for each anchor: the token the declaration binds at each
address changed, so each renders as a `rebound anchor` block whose `index` line carries
the two **recorded** tokens and whose body is empty because the token transition is the
whole block. This is the only block form whose `index` hashes are recorded tokens rather
than rendered content — and it exists because a declaration can move bindings without
touching a byte of source. A commit that permutes bindings among addresses (an anchor
swap, a rotation) changes nothing a content comparison can see, and without this form it
would be the one commit that broke every affected anchor and reported nothing.

Nothing about the content enters that test. A commit that rebinds an address *and* edits
it emits two objects at that address — the `rebound anchor` block carrying the token
transition, and an ordinary content block carrying the edit — because both facts are
true and neither describes the other. Objects in the same entry are therefore identified
by `(path, block form)`, readable from structured fields alone: the object with a
`rebound` field is the binding transition, the object without it is the content
transition.

First-add anchors — for example the whole-span
creation commit `2cbb7301`, `packages/agent-hooks/src/common/gate-core.ts#L797-L853` —
carry `content` instead of `diff`:

```json
{
  "content": "/** The full-span checklist a semantic-staleness deny renders into `reason`. */\nfunction renderStalenessReason(findings: StalePorcelainRow[], blocksText: string): string {\n  const names = [...new Set(findings.map((row) => row.name))];\n⋮ (rest of the extracted anchor snapshot, elided here for length)\n",
  "path": "packages/agent-hooks/src/common/gate-core.ts#L797-L853"
}
```

## Format rules (normative)

- `schema_version`: always `2` (an integer, not a string).
- `date` on each JSON commit is a full ISO-8601 timestamp with UTC offset — git's `%aI`
  author date (e.g. `"2026-07-30T11:51:18-04:00"`), not a bare day. The human format
  uses Git's full default author-date rendering:
  `Date:   <weekday> <month> <day> HH:MM:SS YYYY <±HHMM>`.
- `commits` is newest-first in both formats, matching how a reader scans `git log`.
- Each timeline anchor object carries `path` (the address *after* the change; for a
  removal, the last address the anchor held) plus **exactly one** of `diff` or `content`
  — `content` only for a first-add, `diff` for every other case (modify, rename, delete,
  rebind).
- **Two anchor objects in one entry's `anchors` array may share a `path`.** Block identity
  is the pair `(path, block form)`, never `path` alone. One address renders two objects
  whenever two independent facts are true of it in the same commit: a commit that rebinds
  an address *and* edits its content emits a `rebound anchor` object and a content object,
  both wearing that address. A consumer keying a map by `path` silently drops one of them.
  The two carry different facts and are readable apart from structured fields alone — the
  object with a `rebound` field carries the recorded-token transition (`rebound.from` →
  `rebound.to`), and the object without it carries the content transition in `diff`. A
  consumer that renders only one still renders something coherent; a consumer that renders
  only the content object reports a rebinding-to-unrelated-content as ordinary drift.
- Each `current` anchor object carries `path` plus **both** `diff` and `content` when
  present, so a consumer never has to reconstruct live content from a patch.
- `sources` on a `current` anchor is an **array**, and it is omitted rather than emitted as
  `[]`. It names every layer the drift was observed at, using `git span stale`'s own three
  strings — one anchor can be drifted at more than one, and a scalar would have to pick a
  winner and drop the rest. Order is the resolver's, not sorted: line ranges use
  `WORKTREE` → `INDEX` → `HEAD`; whole files use `INDEX` → `WORKTREE` → `HEAD`.

- `span_diff` is present on a commit or on `current` iff the `.span/<name>` declaration
  blob actually changed between the two states being compared; omitted otherwise (not set
  to `null`).
- `current` is omitted entirely from the JSON object (not emitted as `{}` or `null`) when
  the worktree declaration matches `HEAD` and no anchor is drifted.
- `scoped: true` is present iff `--limit` dropped older qualifying commits; absent
  (not `false`) when the timeline is the complete record. The command also prints a
  warning to stderr in this case, in both formats — see below.
- No `event`, no per-commit `why`, no XML — schema v2 replaces all three.

### `commits[].anchors[]` field list (normative)

This is the complete set of keys a *timeline* anchor object can emit. It is a separate
list from `current.anchors[]` below because the two emitters have inverted presence
rules — a timeline object carries `content` **xor** `diff` and structurally cannot carry
`proposed` or `recorded`, while a `current` object carries `diff` unconditionally. A key
not on this list is a contract violation, and
[cli_history.rs](../tests/cases/cli_history.rs) asserts both directions of the agreement
over a sweep of every timeline state.

- `path` — always present. The anchor's address *after* the change; for a removal, the
  last address it held. Not unique within an entry — see the multiplicity rule above.
- `diff` — present exactly when `content` is absent. The same bytes the human block prints
  for this anchor, header and all.
- `content` — present exactly on a first-add whose snapshot was extractable, replacing
  `diff`: there is no old side to diff against, so the full snapshot is the payload.
- `unavailable` — present when the anchor's *new-side* content could not be extracted:
  `"absent"` (no such file at this commit), `"range-past-eof"` (the file is there and the
  declared range starts past its end), or `"binary"` (not UTF-8). A status to style, never
  source to render. Each value has a producing fixture in the sweep — a documented value
  with no producer is a promise nothing in the product keeps.
- `rebound` — present exactly on a `rebound anchor` object, and the structured
  discriminator that identifies one: an object `{ "from": "rk64:…", "to": "rk64:…" }`
  naming the token the previous state's declaration recorded at this address and the token
  this state records. Both are spelled the way the `.span` file spells them, so either
  side joins directly against the declaration. The same transition appears on the `diff`
  string's `index` line; the field exists so a consumer never has to parse the patch to
  find it. Never co-occurs with `content`.

### `current.anchors[]` field list (normative)

This is the complete set of keys a `current` anchor object can emit; a key not on this
list is a contract violation, and [cli_history.rs](../tests/cases/cli_history.rs) asserts
the two lists agree over a sweep of every state above.

- `path` — always present. The anchor's **declared** address: the string `git span stale`
  prints and the only join key a consumer can match against the `.span` file. Never the
  resolver's proposal.
- `diff` — always present. The same bytes the human block prints for this anchor, header
  and all. Degrades to a header-only block when there are no honest hunks to show: a
  relocation, an unrecoverable recorded snapshot, or a side whose content a filter could
  not produce (`unavailable: "filter-failed"`). Hunks need a side that was *read*; the
  third case is the one where it was not, so the block states the two tokens and the
  reason and stops.
- `content` — the full bytes whose hash the header names on the side wearing `path`, so a
  consumer never reconstructs live content from a patch. The join is guaranteed by
  construction rather than by convention: the body and the token beside it come from a
  single read, and where git converts a file on its way into the repository — a
  `.gitattributes` `filter` line — both are the *converted* bytes, because the token the
  header names is the token a re-anchor would record and `git span add` records what git
  stores. Two reads is how this field once printed a user's own lines beside the
  fingerprint of an LFS pointer. For a `deleted anchor` that is
  the recorded block leaving; for everything else it is the new side. For every shape but
  a relocation those bytes are the ones at `path`; for a relocation they are the recorded
  bytes, which live at `proposed` and not at `path` — that displacement is the finding.
  Absent exactly when `unavailable` is present.
- `unavailable` — replaces `content` when the bytes could not be extracted: `"absent"` (the
  anchored content is not there — the file is gone, or the resolver could locate the
  declared content nowhere), `"range-past-eof"` (the file *is* there and the declared range
  starts past its end), `"binary"` (not UTF-8), or `"filter-failed"` (the file is there and
  readable, and the filter `.gitattributes` names for it could not produce content — the
  driver is missing, unconfigured, or unable to run). A status to style, never source to
  render — no placeholder prose is ever emitted as content or as diff body text.

  `"filter-failed"` is the value that must not collapse into `"absent"`, and did. The
  resolver has always computed it — `git span stale` prints `content unavailable (filter
  failed)` for the same repository — but this enum could not carry it, so the reason was
  projected away and the fallback said "no such file at this commit" about a file with
  five readable lines, under a deletion hunk for lines `git diff` reported untouched. The
  discriminator between this state and a working filter is **not** whether a filter is
  configured; it is whether the driver produces content. A filter that runs and transforms
  the content has failed at nothing and emits no `unavailable` at all.

  All four values are reachable from the `current` block, on the same terms as from a
  commit: the live read applies the commit read's policy on both axes, encoding and extent,
  so one file state gets one account whether or not it has been committed. Reading a
  declared range that runs off the end of its file used to yield an empty string here,
  which is content — it measured as a similarity, split one declared move into a delete
  plus a create, and shipped `"content": ""` for an address holding nothing at all.

  The distinction this field carries is load-bearing downstream, because the `index` line's
  null hash cannot carry it: an absent file, a past-EOF range, a filter that produced no
  content, the `/dev/null` side of a create or delete, and a *genuinely empty* recorded
  extent all hash to `0000000000000000`. The empty extent is honest — `git span add` on an empty file records
  exactly that token — and it keeps `content: ""` with no `unavailable`, which is what makes
  the presence rule above the only reliable way to tell "there are no bytes here" from
  "there are no bytes, and here is why".

  That rule is about *contracts*, and it used to be read as a statement about surfaces too:
  the reason lived in JSON and nowhere else, so `--format human` — the default, and the
  format this command exists to produce — could not distinguish an absent file from a
  past-EOF range at all. Both render `+++ /dev/null` over the same deletion hunk. The reason
  is now echoed into the header as a `content unavailable <reason>` marker line (below), so
  the default output can express what the structured field contracts. The marker is an echo,
  not a second contract: `unavailable` is still the only field a consumer reads.
- `proposed` — present when the resolver believes the recorded content now lives at a
  different address. A *proposal* (`git span stale --fix` would write it), not an
  accomplished move, so it never renders as `rename to` and never relabels either side of
  the header. Agrees with `git span stale`'s `moved to <address>`.
- `recorded` — present, with the single value `"unrecoverable"`, exactly when no snapshot
  in this render's snapshot set hashes to the declaration's recorded token. The `diff` then
  carries the `recorded snapshot unrecoverable` marker line and no hunks. Cannot co-occur
  with `proposed`.
- `sources` — the layers this anchor drifted at, as an array over `git span stale`'s exact
  strings: `"HEAD"`, `"INDEX"`, `"WORKTREE"`. The resolver sequence is preserved exactly,
  not sorted: line-range anchors use `WORKTREE` → `INDEX` → `HEAD`, while whole-file
  anchors use `INDEX` → `WORKTREE` → `HEAD`.
  Omitted when the resolver named no layer; **never emitted as `[]`**, so presence alone is
  the test and a consumer never has to distinguish "no layer" from "empty".

  An array, not a scalar, because one anchor is routinely drifted at more than one layer at
  once — commit an edit without re-anchoring, then edit the same lines again in the working
  tree, and `stale` reports `WORKTREE` *and* `HEAD`. A scalar would have to pick the
  first and silently drop another observation. No individual value proves commit status:
  in particular, `HEAD` can come from a worktree-only declaration re-anchor. Inspect the
  declaration diff and commit timeline before deciding whether to commit, revert, or
  re-anchor.

  Independent of `unavailable`, `proposed`, and `recorded`: it says *where* the drift was
  seen, never *what* could be read there. It is the structured half of the
  `drift source <layers>` marker line, and the two are emitted together or not at all,
  because the marker is built into the header the JSON `diff` string is built from.

Four marker lines belong to the anchor dialect. Three of them appear only in `current`
blocks — `proposed anchor <address>`, `drift source <layers>`, and
`recorded snapshot unrecoverable` — and the fourth, `content unavailable`, names why a
block has no bytes, in two forms.

`drift source <layers>` names the layer or layers the drift was observed at, lower-cased
from the same three values `sources` carries and joined with `, ` in the resolver's
extent-dependent order: line ranges use worktree → index → head and whole files use
index → worktree → head. It exists because the `current` block is deliberately
headerless — git's idiom for "outside the timeline" — and a headerless block cannot say by
its shape which comparison observed drift. `HEAD` is not proof of a committed change: a
worktree-only declaration re-anchor can also produce it. The line sits immediately above
`index`, after `proposed anchor` and the rename lines, and it appears in every `current`
block that has a layer to name, including both halves of a below-threshold re-anchor split:
the marker and the `sources` key are emitted from one place, so the default output can never
be the one surface that cannot say where the drift lives.

`content unavailable <old>..<new>` appears wherever a block has no bytes on *either* side
and the reason for that changed between them (a range that ran past the end of its file,
and then the file deleted outright). Without it such a commit would render as a header with
no hunks, indistinguishable from a renderer that lost them — the same gap
`recorded snapshot unrecoverable` was added to close.

`content unavailable <reason>` appears wherever a single side has no bytes for a reason a
`/dev/null` side cannot state — `range-past-eof` or `filter-failed`. A `/dev/null` side
states that there are no bytes, which is equally true of a deleted file, so without this
line those states render byte-identical blocks — same `---`/`+++` pair, same deletion hunk
— in the format the command produces by default. They are not the same state and they do
not want the same repair: a deleted file wants restoring, a range past the end of a file
sitting on disk wants re-anchoring, and a failed filter wants the driver installed and no
source change at all. Only those two reasons earn the line; a plain absence does not,
because a `/dev/null` side is the honest and long-standing rendering of "there is nothing
here" and naming it would annotate every ordinary create and delete. The asymmetry carries
the meaning: the line says the *file* is present and something narrower is not.

The precedent is git's own `Binary files … differ` — a dedicated sentence in the header
stating a fact the `---`/`+++` sides cannot. What that precedent does not do, and neither
does this, is put explanatory prose in a hunk body.

The two reasons part company on the hunks below the line. A past-EOF block keeps them: the
range genuinely has no bytes and `git diff` shows the same lines leaving in the same
commit, so the hunk is honest and stays. A `filter-failed` block has none: the content was
never *measured*, so a hunk would spell the unread side out as a full deletion — signed
lines for an edit nobody observed, over a file `git status` calls clean, which is the shape
this renderer is forbidden to produce. That block is its header alone.

Every one of them lives in the header rather than being appended by the human renderer, so
the JSON `diff` string and the human block are the same bytes. None of them is a contract: a
marker line is a legend for a person reading the patch, and everything it states is
recoverable from structured fields — `proposed`, `recorded`, and each entry's own
`unavailable`, whose value is what the third marker echoes and whose value against the
previous entry's is the transition its two-sided form spells out. A consumer that parses the
patch string to recover block form or state is reading the wrong surface.

## Scoped-limit warning

When `--limit`/`-n` truncates the *rendered* timeline (the underlying walk is always
complete — a narrow anchor in a busy file can never fill the window with commits that
changed nothing, since only qualifying commits are counted against the limit), the
command still prints the requested window to stdout but warns on stderr and sets `scoped`
(JSON) or leaves the human window as-is (no scoped marker in text — the stderr warning is
the signal in both formats):

```
warning: history is scoped — `--limit` dropped older commits; this is a partial timeline, not the complete record
```

The first commit shown in a scoped window still diffs against the true prior span state,
so its diffs stay truthful — only the *count* of commits shown is capped.
