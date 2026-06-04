# Suppressing meshes per path: `.hookignore`

Some meshes are noise when browsing certain parts of the tree — wiki or
marketing meshes that anchor prose add little when surfaced inline while reading
source. A repo can hold those back, **per path**, with a `.hookignore` file.
This only affects what the agent hooks surface (the PreToolUse inline block and
the Stop hook's stale / related sections); it never changes what `git mesh`
commands report or how anchors resolve.

## Where it lives

A single file at the mesh root: `<repoRoot>/.mesh/.hookignore`. It is an
ordinary tracked file — commit it like any mesh.

## Line format

Each non-comment line is:

```text
<path-pattern><whitespace><prefix>[,<prefix>…]
```

- **`<path-pattern>`** — a gitignore-style glob (subset, see below) matched
  against an anchor's repo-relative path.
- one or more spaces/tabs.
- **`<prefix>[,<prefix>…]`** — a comma-separated list of mesh **slug prefixes**
  to suppress for anchors whose path matches the pattern. No spaces inside the
  list (the list is a single whitespace-delimited token).

A mesh is suppressed for a given anchor when **some** line's path pattern matches
the anchor's path **and** lists a prefix the mesh's slug carries. A slug carries
a prefix when the slug equals the prefix or begins with `<prefix>/`. So `wiki`
suppresses the slug `wiki` and `wiki/onboarding`, but not `wikileaks`.

```text
# Hold wiki and marketing meshes back while reading hook source.
packages/agent-hooks/src   wiki,marketing

# Anywhere under docs/, suppress wiki meshes.
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
meshes surface as normal rather than being silently hidden. When in doubt the
file errs toward showing meshes, not hiding them.
