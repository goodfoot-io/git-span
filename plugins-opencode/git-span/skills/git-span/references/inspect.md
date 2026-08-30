<!-- Generated from skills-src/git-span/git-span/references/inspect.md by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Inspect spans (read-only — no `add`/`remove`/`delete`/`commit` here)

Match the question to the command, don't reflexively mutate:

- Existence / what's currently anchored → `git span list [<target>...]` (all spans if no
  target; `--oneline` for terse `<span-name> <path>#Lx-Ly` rows) or `git span show <name>`
  (== bare `git span <name>`) for one span's full anchors, why, resolution audit, and config.
- Rationale / definition → `git span why <name>` (bare, just prints the why).
- Timeline / when something changed → `git span history <name>` — newest-first
  git-log-style text by default, `--format json` for JSON.
- Drift check without fixing anything → `git span drift [<name-or-path>]` — read-only
  unless `--fix` is passed; omit `--fix` here.

In `git span show <name>`, each `[[resolved]]` entry records a human decision
that retired an unverified duplicate-identity sentinel. Read `state = "current"`
as “the same identity still carries the recorded hash” and `state = "stale"`
as “the hash changed or the identity disappeared.” A stale record is durable
provenance, not an actionable drift finding; do not delete or refresh it merely
to make the inspection look clean.

**`drift --format json` is one JSON object** — `{"findings": [...], "schema_version": 3,
"span": "...", "clean": true|false}`, `findings` holding every drifting anchor. Parse as
one document, not line-by-line. A clean scan still emits the document — `"clean": true`
(informational `RESOLVED_PENDING_COMMIT` findings may still be listed) — never empty
stdout; hooks distinguish clean from no output by the document itself.

**Selector trap**: `list`/`show`/`why`/`drift` resolve `<name>`/`<target>` as a span name
*or* a file path — never assume one; `history` is the exception and accepts only a span
name. A real, tracked file not anchored by any
span does **not** error: `list` prints "No spans match the filters.", `drift` prints
"0 drift across 0 spans", both exit 0. Only a path/name that matches nothing at all in the
repo errors explicitly ("is not tracked" / "did not match any span, file, or path"). Before
reporting "no such span," re-check the exact name/path with a bare `git span list`.
