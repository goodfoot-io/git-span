# `git span history` — v2 output contract

This document is the reference specification for `git span history`'s two renderers
(`render_human` and `render_json` in [history.rs](../src/cli/history.rs)). Every example
below is genuine output — captured by building the CLI and running
`git span history agent-hooks/hook-message-copy` against this repository's own git
history — trimmed for length with `⋮` markers. Those markers are elision added for this
document only; the real renderers never truncate a diff or drop a commit.

## Output contract

Both formats render the same underlying timeline, newest-first:

- **`current`** — uncommitted worktree drift from `HEAD`, rendered first (human) or as
  the `current` object (JSON). Omitted entirely when the worktree declaration matches
  `HEAD` and no anchor has drifted.
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
  Anchors pair across consecutive states by exact address first, then by content
  similarity (git's `-M` shape) — a re-anchor renders as a `rename from`/`rename to`
  block, not a delete followed by an add.

Declared anchor ranges are taken at face value at every commit — a stale range
extracting "wrong" content *is* the drift being visualized, never remapped. Anchor diffs
are always computed between extracted snapshots, never by clipping a file's real commit
patch to a line range.

## Human format (default)

`git log -p` style: `commit <40-hex>`, `Date:   YYYY-MM-DD`, a blank line, the
four-space-indented commit summary, a blank line, then the declaration diff and each
anchor diff. Uncommitted drift (when present) comes first with no `commit`/`Date`
header — git's own idiom for "not yet committed."

Real output, two consecutive commits from `agent-hooks/hook-message-copy`'s history —
a pure re-anchor with content hunks (similarity < 100%, so headers *and* hunks), two
anchor deletions, an ordinary content modification, an anchor first-add, and a pure
re-anchor with no content change (similarity 100%, header only, no hunks):

```
commit e86fe9cc50f359301ca4a61156f4f6bfcba150a8
Date:   2026-07-29

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
Date:   2026-07-29

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
  mode`) for anchors with no pairing partner in the adjacent state; the body is a full
  addition/deletion against `/dev/null`.
- Hunk headers carry real file coordinates: the old range addresses the old file, the new
  range the new file, exactly like ordinary `git diff` output.
- Commits where nothing observable changed (declaration touched but no anchor content or
  address moved, or vice versa) are omitted from the timeline entirely.

### Uncommitted drift (`current`)

A live edit inside `touch-core.ts#L245-L274`, still uncommitted, renders headerless and
first, ahead of any commit sections:

```
diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274
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

When the worktree declaration bytes also differ from `HEAD` (an uncommitted `why` edit or
anchor add/remove), a `span_diff` block precedes the anchor diffs, using the same
`index <old7>..<new7> 100644` dialect — the worktree side's hash comes from a blob-OID
computation that never writes the object. The whole `current` section is omitted when the
worktree declaration matches `HEAD` and no anchor resolves as drifted.

## JSON format (`--format json`, `schema_version: 2`)

Same data; `diff`/`span_diff`/`content` are the identical raw strings the human renderer
prints — not structured hunks. Real output, `git span history agent-hooks/hook-message-copy
--format json -n 1`, for the same uncommitted edit shown above. Object keys render in
alphabetical order (the emitter's own order, not hand-arranged); long string values below
are trimmed with `⋮` (never with `…`, and never in a way a reader could mistake for real
diff/content bytes) for length only:

```json
{
  "commits": [
    {
      "anchors": [],
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
        "diff": "diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\nindex rk64:49bd4bc548ecea54..rk64:4493cd6c8a727900\n--- a/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n+++ b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n@@ -247,7 +247,7 @@\n }\n \n function cleanFooter(fileName: string): string {\n-  return `If you change ${fileName} check the other files to confirm they still work together.`;\n+  return `If you change ${fileName} check the other coupled files to confirm they still work together.`;\n }\n \n /**\n",
        "path": "packages/agent-hooks/src/common/touch-core.ts#L245-L274"
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

A `commit` whose `.span/<name>` change re-hashed every anchor without adding, removing, or
moving one (as `5c5dcecd` above) still has an `anchors` array — it is simply empty; the
`span_diff` alone carries the change. First-add anchors — for example the whole-span
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
- `date` on each commit is a full ISO-8601 timestamp with UTC offset — git's `%aI` author
  date (e.g. `"2026-07-30T11:51:18-04:00"`), not a bare day. The human format's `Date:`
  line stays `YYYY-MM-DD`.
- `commits` is newest-first in both formats, matching how a reader scans `git log`.
- Each timeline anchor object carries `path` (the address *after* the change; for a
  removal, the last address the anchor held) plus **exactly one** of `diff` or `content`
  — `content` only for a first-add, `diff` for every other case (modify, rename, delete).
- Each `current` anchor object carries `path` plus **both** `diff` and `content` when
  present, so a consumer never has to reconstruct live content from a patch.
- `span_diff` is present on a commit or on `current` iff the `.span/<name>` declaration
  blob actually changed between the two states being compared; omitted otherwise (not set
  to `null`).
- `current` is omitted entirely from the JSON object (not emitted as `{}` or `null`) when
  the worktree declaration matches `HEAD` and no anchor is drifted.
- `scoped: true` is present iff `--limit` dropped older qualifying commits; absent
  (not `false`) when the timeline is the complete record. The command also prints a
  warning to stderr in this case, in both formats — see below.
- No `event`, no per-commit `why`, no XML — schema v2 replaces all three.

## Incomplete-walk and scoped-limit warnings

When the git-log walk hits its time budget (`walk_complete == false`), the command prints
to stderr and exits non-zero, with **no partial output on stdout**:

```
error: history walk incomplete — not all commits were inspected (hit time budget)
```

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
