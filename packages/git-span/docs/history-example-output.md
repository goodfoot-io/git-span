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

Real output, three consecutive commits from `agent-hooks/hook-message-copy`'s history —
a pure re-anchor with content hunks (similarity < 100%, so headers *and* hunks), an
anchor deletion, and an anchor first-add:

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
index rk64:0a52ab2b949313f9..rk64:0a52ab2b949313f9
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
index rk64:0a52ab2b949313f9..0000000000000000
--- a/packages/agent-hooks/src/common/gate-core.ts#L1019-L1126
+++ /dev/null
@@ -1019,108 +0,0 @@
- * bullet run; spans absent from `blocksText` entirely (or an empty/failed
- * list read) get a synthesized minimal block — no finding is ever dropped.
⋮  (108-line deletion body continues, omitted here for length)

commit 2cbb7301d0500638a56c317c742f3fe2b04aab88
Date:   2026-07-21

    Declare the hook-message-copy span coupling both hooks' rendered wording to its doc mirrors

diff --git a/dev/null b/.span/agent-hooks/hook-message-copy
index 0000000..5eed1f7 100644
--- /dev/null
+++ b/.span/agent-hooks/hook-message-copy
@@ -0,0 +1,7 @@
+packages/agent-hooks/src/common/gate-core.ts#L797-L853 rk64:49728c3dbc47a6ab
+packages/agent-hooks/src/common/touch-core.ts#L233-L249 rk64:ed35ece307b8b9c0
+packages/website/content/docs/agent-integration.mdx rk64:e43151e22478015d
+plugins-claude/git-span/skills/git-span/references/understanding-hook-output.md rk64:0825905d01d5858e
+plugins-codex/git-span/skills/git-span/references/understanding-hook-output.md rk64:2c720530fdbcf3b6
+
+The hook-facing message copy: the latent-semantic-dependency wording rendered by the touch hook's block and the gate's four reasons, quoted verbatim in both plugin skill references and the website's agent-integration doc — reword one and the others must follow.

diff --git a/dev/null b/packages/agent-hooks/src/common/gate-core.ts#L797-L853
new anchor
index 0000000000000000..rk64:49728c3dbc47a6ab
--- /dev/null
+++ b/packages/agent-hooks/src/common/gate-core.ts#L797-L853
@@ -0,0 +797,57 @@
+/** The full-span checklist a semantic-staleness deny renders into `reason`. */
+function renderStalenessReason(findings: StalePorcelainRow[], blocksText: string): string {
+  const names = [...new Set(findings.map((row) => row.name))];
⋮  (addition body continues, omitted here for length)
```

Conventions demonstrated:

- The `.span/<name>` diff (`span_diff`) uses ordinary git blob headers (`index
  <old7>..<new7> 100644`, `/dev/null` on creation); anchor pseudo-diffs use `index
  rk64:<old>..rk64:<new>` carrying the same `rk64:` extent hashes visible in the
  declaration lines.
- `rename from`/`rename to`/`similarity index NN%` replace git's normal `copy` machinery
  when an anchor's address changes and pairs by content similarity (≥ 50%, git's `-M`
  default) rather than exact address; hunks are included whenever content also changed
  (as here — 92% similar, not identical).
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
--format json -n 1`, showing the `current` block for the same uncommitted edit above (no
`span_diff` here — only the anchor drifted, not the declaration):

```json
{
  "schema_version": 2,
  "span": "agent-hooks/hook-message-copy",
  "current": {
    "anchors": [
      {
        "path": "packages/agent-hooks/src/common/touch-core.ts#L245-L274",
        "diff": "diff --git a/packages/agent-hooks/src/common/touch-core.ts#L245-L274 b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\nindex rk64:49bd4bc548ecea54..rk64:4493cd6c8a727900\n--- a/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n+++ b/packages/agent-hooks/src/common/touch-core.ts#L245-L274\n@@ -247,7 +247,7 @@\n }\n \n function cleanFooter(fileName: string): string {\n-  return `If you change ${fileName} check the other files to confirm they still work together.`;\n+  return `If you change ${fileName} check the other coupled files to confirm they still work together.`;\n }\n \n /**\n",
        "content": "function cleanHeader(fileName: string): string {\n  return `${fileName} has implicit dependencies:`;\n}\n…"
      }
    ]
  },
  "commits": [
    {
      "hash": "5c5dcecd53c3f53a3801878f06f4b23636e7b945",
      "date": "2026-07-30T11:51:18-04:00",
      "summary": "Re-hash hook-message-copy after footer copy refinement",
      "span_diff": "diff --git a/.span/agent-hooks/hook-message-copy b/.span/agent-hooks/hook-message-copy\nindex 2b1682a..dcdf615 100644\n…",
      "anchors": []
    }
  ]
}
```

A `commit` whose `.span/<name>` change re-hashed every anchor without adding, removing, or
moving one (as above) still has an `anchors` array — it is simply empty; the `span_diff`
alone carries the change. First-add anchors — for example the whole-span creation commit
`2cbb7301`, `packages/agent-hooks/src/common/gate-core.ts#L797-L853` — carry `content`
instead of `diff`:

```json
{
  "path": "packages/agent-hooks/src/common/gate-core.ts#L797-L853",
  "content": "/** The full-span checklist a semantic-staleness deny renders into `reason`. */\nfunction renderStalenessReason(findings: StalePorcelainRow[], blocksText: string): string {\n…"
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

When `--limit`/`-n` truncates a timeline that has more history behind it, the command
still prints the requested window to stdout but warns on stderr and sets `scoped` (JSON)
or leaves the human window as-is (no scoped marker in text — the stderr warning is the
signal in both formats):

```
warning: history is scoped — `--limit` dropped older commits; this is a partial timeline, not the complete record
```

The first commit shown in a scoped window still diffs against the true prior span state,
so its diffs stay truthful — only the *count* of commits shown is capped.
