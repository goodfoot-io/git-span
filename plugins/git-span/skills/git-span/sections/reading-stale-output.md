# Reading `git span stale` output

`git span stale` asks: *do the anchored bytes still match reality?* It prints
one finding per anchor per drifting layer.

## Status values

- **`FRESH`** — Current bytes equal anchored bytes at the same location. No action.
- **`MOVED`** — Bytes are equal, but path or line numbers changed. Usually keep; re-anchor only if the new location is the one the span should point at.
- **`CHANGED`** — Current bytes differ from the anchored bytes. Review the relationship, then update code or span.
- **`DELETED`** — The anchored path is absent from the resolved layer (renamed, moved, or deleted). Read `./terminal-statuses.md`.
- **`CONFLICT`** (`MERGE_CONFLICT`) / **`SUBMODULE`** / **`CONTENT_UNAVAILABLE(...)`** — Terminal. Read `./terminal-statuses.md` or `./content-unavailable.md`.
- **`RESOLVED_PENDING_COMMIT`** — `--fix` healed the anchor in this run, but the fix is not yet committed to `.span`. Not counted as stale for this invocation's exit code.

## Layers and the `src` column

Span files are tracked files; `git span add`/`remove`/`why` edit them in the
working tree directly. There is no separate span staging area, so the resolver
checks three *content* layers for the anchored code: HEAD → Index → Worktree.
Each drifting layer produces its own finding.

- **`src=H`** — Drift is already in HEAD (committed).
- **`src=I`** — Drift is in the index (staged with `git add`) but not HEAD.
- **`src=W`** — Drift is in the worktree (unstaged edit on disk).

The same anchor can appear twice when two layers both differ — e.g. a file with
one edit `git add`-ed (src=I) and another edit left unstaged (src=W). That's the
layering doing its job, not a duplicate.

All three layers — HEAD, Index, Worktree — are always resolved. There is no
flag to peel or select individual layers.

## Re-anchoring silences a finding

To clear a `CHANGED` finding, re-anchor the span (`git span add <name>
<anchor>` rewrites the recorded hash to current bytes) and commit `.span`.
`git add`/`git commit` of *source* files only moves drift between content
layers; they do not silence a finding — the anchor's recorded hash still
disagrees until you re-anchor.

## Exit code

Non-zero if any of:
- A finding has drift at HEAD / Index / Worktree (`CHANGED` / `MOVED` against the recorded hash).
- A terminal status (`DELETED`, `MERGE_CONFLICT`, `SUBMODULE`, `CONTENT_UNAVAILABLE`) isn't suppressed.
- A positional `<target>` names a referent that doesn't exist (missing file, missing span name, unmatched literal glob). Stderr in that case is `git span stale: file not found: '<target>'`.

`--no-exit-code` forces exit 0 regardless of findings.

## No-news-is-good-news

`git span stale` is silent on the clean path. A fully-fresh span produces no
per-span header, no anchor list, no why — output is empty and exit code is 0.
This applies to every form: the no-args sweep, a named span
(`git span stale <name>`), and a path arg (`git span stale src/auth.ts`). To
force a full listing of a span's anchors regardless of staleness, use
`git span <name>` instead of `stale`.

A target that resolves to zero spans — for example
`git span stale notes/readme.md` against a path no span tracks — also exits 0
silently. Only a missing referent (see above) drives a non-zero exit.

## Machine formats

```bash
git span stale --format porcelain
git span stale --format json
```

### JSON schema (schema_version: 2)

Top-level: `{ "schema_version": 2, "span": "<name>", "findings": [...] }`.

Each finding carries:
- `status.code` — `"FRESH"`, `"CHANGED"`, `"MOVED"`, `"DELETED"`, `"CONFLICT"`, `"SUBMODULE"`, `"CONTENT_UNAVAILABLE"`, `"RESOLVED_PENDING_COMMIT"`
- `status.reason` — SCREAMING_SNAKE_CASE reason tag for `CONTENT_UNAVAILABLE` (e.g. `"LFS_NOT_FETCHED"`, `"LFS_NOT_INSTALLED"`, `"PROMISOR_MISSING"`, `"SPARSE_EXCLUDED"`, `"FILTER_FAILED"`, `"IO_ERROR"`); absent otherwise
- `status.detail` — structured payload for `CONTENT_UNAVAILABLE` (e.g. `{"filter": "..."}` for a filter failure, `{"message": "..."}` for an I/O error); `null` for other reasons or other statuses
- `anchor.kind` — `"lines"` or `"whole"`
- `anchor.path`, `anchor.line_start`, `anchor.line_end` (null for whole-file)
- `current.blob` — the live blob OID, or `null` when the file is deleted
- `current.path`, `current.line_start`, `current.line_end` — live location (may differ from anchor for `MOVED`)
- `moved_to` — present only for `MOVED`; null for all other statuses
- `source` — `"(index)"`, `"(worktree)"`, or absent for HEAD

### Text vs JSON disagreements

The text renderer and JSON encoder do not always agree on status codes for the
same anchor. When scripting against stale output, pick one format and test
against it. Do not mix text and JSON interpretations in the same workflow. The
JSON schema is the canonical encoding; the text renderer optimizes for human
skimmability.

## Hook injections vs. CLI stale output

The PreToolUse hook in `plugins/git-span/hooks.json` does **not** call
`git span stale`. It calls `git span list <names…>` for spans whose anchors
overlap the tool's line range, wrapping the output in `<git-span>…</git-span>`
and injecting it as a `systemMessage`. See `./understanding-hook-output.md`
for the hook render format. Notable differences:

- Hook output uses `<git-span>` XML tags; `stale` emits plain text per-span status headers.
- `stale` uses bracket markers (`[CHANGED]`, `[MOVED]`) and `FRESH`/`src=…` annotations; the hook emits `git span list` human-readable output without those markers.
