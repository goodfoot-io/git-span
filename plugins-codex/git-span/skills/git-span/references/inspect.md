# Inspect spans (read-only — no `add`/`remove`/`delete`/`commit` here)

Match the question to the command, don't reflexively mutate:

- Existence / what's currently anchored → `git span list [<target>...]` (all spans if no
  target; `--oneline` for terse `<span-name> <path>#Lx-Ly` rows) or `git span show <name>`
  (== bare `git span <name>`) for one span's full anchors+why+config.
- Rationale / definition → `git span why <name>` (bare, just prints the why).
- Timeline / when something changed → `git span history <name>` — XML by default,
  `--format json` for JSON.
- Drift check without fixing anything → `git span stale [<name-or-path>]` — read-only
  unless `--fix` is passed; omit `--fix` here.

**`stale --format json` is one JSON object** — `{"findings": [...], "schema_version": N,
"span": "..."}`, `findings` holding every drifting anchor. Parse as one document, not
line-by-line. Empty when nothing is stale (no bytes at all, not `{}`).

**Selector trap**: `list`/`show`/`why`/`history`/`stale` resolve `<name>`/`<target>` as a
span name *or* a file path — never assume one. A real, tracked file not anchored by any
span does **not** error: `list` prints "No spans match the filters.", `stale` prints
"0 stale across 0 spans", both exit 0. Only a path/name that matches nothing at all in the
repo errors explicitly ("is not tracked" / "did not match any span, file, or path"). Before
reporting "no such span," re-check the exact name/path with a bare `git span list`.
