# Suppressing spans per path: `.hookignore`

Some spans are noise when browsing certain parts of the tree — wiki or
marketing spans that anchor prose add little when surfaced inline while reading
source. A repo can hold those back, **per path**, with a `.hookignore` file.
This only affects the PreToolUse inline block (see
`./understanding-hook-output.md`); it never changes what `git span` commands
report or how anchors resolve.

## Where it lives

A single file at the span root: `<repoRoot>/.span/.hookignore`. It is an
ordinary tracked file — commit it like any span.

## Line format

Each non-comment line is:

```text
<path-pattern><whitespace><prefix>[,<prefix>…]
```

- **`<path-pattern>`** — a gitignore-style glob (subset, see below) matched
  against an anchor's repo-relative path.
- one or more spaces/tabs.
- **`<prefix>[,<prefix>…]`** — a comma-separated list of span **slug prefixes**
  to suppress for anchors whose path matches the pattern. No spaces inside the
  list (the list is a single whitespace-delimited token).

A span is suppressed for a given anchor when **some** line's path pattern matches
the anchor's path **and** lists a prefix the span's slug carries. A slug carries
a prefix when the slug equals the prefix or begins with `<prefix>/`. So `wiki`
suppresses the slug `wiki` and `wiki/onboarding`, but not `wikileaks`.

```text
# Hold wiki and marketing spans back while reading hook source.
packages/agent-hooks/src   wiki,marketing

# Anywhere under docs/, suppress wiki spans.
docs/   wiki
```

## Pattern grammar (a deliberate subset of gitignore)

- Blank lines and lines beginning with `#` are skipped.
- A line missing either the pattern or the prefix list is malformed and skipped.
- A trailing `/` restricts the pattern to **directories** — the leaf file itself
  is not tested, only its ancestor directories (so `docs/` suppresses everything
  beneath `docs/` but a top-level file literally named `docs` would not match).
- A pattern containing a slash (or a leading `/`) is **anchored to the repo
  root**; a pattern with no slash matches a single path **component at any
  depth**.
- `*` and `?` match within one path segment; `**` matches across segments.
- **Negation (`!`) is not supported.**

## Fail-open

A missing or unreadable `.hookignore`, or a malformed line, yields no rule —
spans surface as normal rather than being silently hidden. When in doubt the
file errs toward showing spans, not hiding them.

## Suppressing the gate's uncovered-writes check: `.gateignore`

A separate file, `<repoRoot>/.span/.gateignore`, controls the gate's
uncovered-writes leg (`references/understanding-hook-output.md` § "The gate:
what a denied command sees") — a changed file no span anchors at all. It is
**user-owned**: nothing creates or populates it (unlike `.hookignore`, which
the `git-span` CLI auto-creates), so its absence is the normal, unconfigured
state.

Each non-comment line is a single gitignore-style path pattern — the same
grammar as `.hookignore` above (blank lines and `#` comments skipped, trailing
`/` for directory-only, anchored-vs-unanchored matching, `*`/`?`/`**`, no
negation), but with **no trailing prefix list**: a `.gateignore` line either
excludes a path from the uncovered-writes check or it doesn't, since the gate
has no per-span-slug suppression concept.

```text
# Generated output and vendored code never need a span.
packages/agent-hooks/generated/**
vendor/
```

This is a coarser tool than `.hookignore` in scope but finer-grained in
matching: it opts specific paths out of the "should this changed file have a
span?" nudge, rather than suppressing specific spans on specific paths. Reach
for it when part of a repo's write surface is dominated by files that will
never carry a coupling worth declaring (generated output, vendored code, pure
config) and the one-time uncovered-writes prompt on those paths is pure noise
rather than an occasional useful nudge.

`.gateignore` never affects the gate's **semantic-staleness** check — a
changeset that already carries a drifted anchor is still denied regardless of
this file (once per distinct set of findings; an identical retry passes on
its own). It only silences the "nothing anchors this new/changed file"
observation, and only for the paths it matches — a standing, committed,
path-scoped exclusion from that one check.

Fail-open: a missing or unreadable `.gateignore`, or a malformed line, yields
no additional exclusion — the uncovered-writes check simply falls back to the
gate's unconditional `.span/**` exclusion.

```bash
cat <<'EOF' > .span/.gateignore
vendor/
EOF
git add .span/.gateignore && git commit -m "Exclude vendored code from the gate's uncovered-writes nudge"
```
