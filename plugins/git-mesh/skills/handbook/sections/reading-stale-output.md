# Reading `git mesh stale` output

`git mesh stale` asks: *do the anchored bytes still match reality?* It prints
one finding per anchor per drifting layer.

## Status values

- **`FRESH`** — Current bytes equal anchored bytes at the same location. No action.
- **`MOVED`** — Bytes are equal, but path or line numbers changed. Usually keep; re-anchor only if the new location is the one the mesh should point at.
- **`CHANGED`** — Current bytes differ from the anchored bytes. Review the relationship, then update code or mesh.
- **`DELETED`** — The anchored path is absent from the resolved layer (renamed, moved, or deleted). Read `./terminal-statuses.md`.
- **`CONFLICT`** (`MERGE_CONFLICT`) / **`SUBMODULE`** / **`CONTENT_UNAVAILABLE(...)`** — Terminal. Read `./terminal-statuses.md` or `./content-unavailable.md`.

## Layers and the `src` column

Mesh files are tracked files; `git mesh add`/`remove`/`why` edit them in the
working tree directly. There is no separate mesh staging area, so the resolver
checks three *content* layers for the anchored code: HEAD → Index → Worktree.
Each drifting layer produces its own finding.

- **`src=H`** — Drift is already in HEAD (committed).
- **`src=I`** — Drift is in the index (staged with `git add`) but not HEAD.
- **`src=W`** — Drift is in the worktree (unstaged edit on disk).

The same anchor can appear twice when two layers both differ — e.g. a file with
one edit `git add`-ed (src=I) and another edit left unstaged (src=W). That's the
layering doing its job, not a duplicate.

Select or peel layers:
- `--head` resolves against HEAD only.
- `--staged` resolves against the index over HEAD (no worktree).
- `--worktree` is the default (worktree over index over HEAD), named explicitly.
- `--no-worktree` drops W findings; `--no-index` drops I findings.
- HEAD is always on — no flag turns it off.

(`--no-staged-mesh` is accepted for compatibility but has no effect: mesh edits
live in the worktree, not a separate staging area.)

## Re-anchoring silences a finding

To clear a `CHANGED` finding, re-anchor the mesh (`git mesh add <name>
<anchor>` rewrites the recorded hash to current bytes) and commit `.mesh`.
`git add`/`git commit` of *source* files only moves drift between content
layers; they do not silence a finding — the anchor's recorded hash still
disagrees until you re-anchor.

## Exit code

Non-zero if any of:
- A finding has drift at HEAD / Index / Worktree (`CHANGED` / `MOVED` against the recorded hash).
- A terminal status (`DELETED`, `MERGE_CONFLICT`, `SUBMODULE`, `CONTENT_UNAVAILABLE`) isn't suppressed.
- A positional `<target>` names a referent that doesn't exist (missing file, missing mesh name, unmatched literal glob). Stderr in that case is `git mesh stale: file not found: '<target>'`.

`--no-exit-code` forces exit 0 regardless of findings. `--ignore-unavailable`
downgrades `CONTENT_UNAVAILABLE` only.

## No-news-is-good-news

`git mesh stale` is silent on the clean path. A fully-fresh mesh produces no
per-mesh header, no anchor list, no why — output is empty and exit code is 0.
This applies to every form: the no-args sweep, a named mesh
(`git mesh stale <name>`), and a path arg (`git mesh stale src/auth.ts`). To
force a full listing of a mesh's anchors regardless of staleness, use
`git mesh <name>` instead of `stale`.

A target that resolves to zero meshes — for example
`git mesh stale notes/readme.md` against a path no mesh tracks — also exits 0
silently. Only a missing referent (see above) drives a non-zero exit.

## Machine formats

```bash
git mesh stale --format porcelain
git mesh stale --format json
git mesh stale --format junit
git mesh stale --format github-actions
```

### JSON schema (schema_version: 2)

Top-level: `{ "schema_version": 2, "mesh": "<name>", "findings": [...], "pending": [...] }`.
(`pending` is always an empty array in the file-backed model — there is no
staging stream; it is retained only for a stable schema shape.)

Each finding carries:
- `status.code` — `"FRESH"`, `"CHANGED"`, `"MOVED"`, `"DELETED"`, `"CONFLICT"`, `"SUBMODULE"`, `"CONTENT_UNAVAILABLE"`
- `status.detail` — reason tag for `CONTENT_UNAVAILABLE` (e.g. `"LfsNotFetched"`); empty otherwise
- `anchor.kind` — `"lines"` or `"whole"`
- `anchor.path`, `anchor.line_start`, `anchor.line_end` (null for whole-file)
- `current.blob` — the live blob OID, or `null` when the file is deleted
- `current.path`, `current.line_start`, `current.line_end` — live location (may differ from anchor for `MOVED`)
- `moved_to` — present only for `MOVED`; null for all other statuses
- `source` — `"(index)"`, `"(worktree)"`, or absent for HEAD

`CONTENT_UNAVAILABLE` findings carry a `status.detail` with the reason tag.

### Text vs JSON disagreements

The text renderer and JSON encoder do not always agree on status codes for the
same anchor. When scripting against stale output, pick one format and test
against it. Do not mix text and JSON interpretations in the same workflow. The
JSON schema is the canonical encoding; the text renderer optimizes for human
skimmability.

## Hook injections vs. CLI stale output

The PostToolUse hook in `plugins/git-mesh/hooks.json` does **not** call
`git mesh stale`. It calls `git mesh advice <sid> read|touch|flush`, whose
render shape and marker set are different. See `./understanding-hook-output.md`
for the advice render. Notable differences when reading text in
`additionalContext` / `systemMessage`:

- Header line: `<active-anchor> is in the <mesh> mesh with:` (advice) vs. per-mesh status header (`stale`).
- Status clauses appear in **parentheses** in advice (`(CHANGED)`, `(MOVED)`, `(DELETED)`, `(CONFLICT)`, `(SUBMODULE)`, `(RENAMED)`); `stale` uses **square brackets** (`[CHANGED]`, `[MOVED]`) plus `FRESH` and `src=…` annotations that advice does not emit.
- Advice may include an excerpt block of related anchor bytes and a one-line `git mesh …` next-step command; `stale` never does.

If text in `additionalContext` carries `src=…`, something other than the
standard hook produced it.
