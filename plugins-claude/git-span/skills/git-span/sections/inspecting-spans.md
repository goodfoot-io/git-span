# Inspecting spans

Reading span state is local and fast — no network. Spans are tracked files, so
if the question is about shared state, pull first with ordinary git:

```bash
git pull
```

## Find spans touching a file or anchor

This is the primary use of `git span list`. Always scope the query — a path, an anchor address, or a glob. Repos can carry hundreds or thousands of spans; a bare `git span list` is rarely the right tool.

Overlap semantics — a span is listed if any anchor touches the queried path or range. The full anchor list of each matching span is always shown.

```bash
git span list src/Button.tsx
git span list src/Button.tsx#L40-L60
git span list src/Button.tsx src/Button.css     # multiple targets — unioned, deduped
git span list checkout-request-flow src/api.ts  # span name + path mixed
git span list billing/payments/checkout         # hierarchical span name (resolved as span, not path)
git span list 'src/billing/**/*.ts'             # glob (quote to defer to git span, or let the shell expand)
```

Each argument is tried as a span name first when it has the span-name shape (kebab-case segments, optionally separated by `/`); it falls through to path-index lookup when no span matches, then to a worktree existence check. A target that resolves to no spans is fine on its own — the command exits 0. The command only errors when a target names something that doesn't exist (missing file, missing span name, or a literal glob the shell didn't expand). The same rule applies to `git span stale [<target>...]`.

## Narrow by span name prefix

When the scope is a naming convention rather than a path, filter by span name:

```bash
git span list billing/payments/              # prefix scan over span names
git span list --offset 10 --limit 10         # pagination (by span, after filters)
```

Bare `git span list` with no targets enumerates every span in the repo. Avoid it on real repos — prefer a path, glob, or prefix filter. Use `--porcelain` (`name<TAB>path<TAB>start-end`) when piping into other tools.

Bare `git span` (no arguments) prints short help.

## Trace blast radius

`git span list` answers "which spans touch this file?". `git span tree`
answers the follow-on: "if I change this file, what could ripple outward?" It
renders a nested impact tree rooted at the matched files, expanding through
span co-occurrence to the files each could affect — without opening individual
span files.

```bash
git span tree src/auth/session.ts                 # blast radius from one file
git span tree 'src/billing/**/*.ts'               # roots = every matched anchor path
git span tree src/auth/session.ts --depth 1       # immediate neighbors only
git span tree src/auth/session.ts --depth 0       # the matched roots themselves, nothing expanded
git span tree src/auth/session.ts --format json   # nested {members, children} for tooling
```

Files that all anchor the same span are mutually connected, so they collapse
onto a single comma-separated line and expand once as a unit — a cluster that
moves together reads as one line, and you reach the files beyond it through
that line. Expansion is bounded by `-d`/`--depth` (default `3`), because the
graph is dense and otherwise grows quickly.

Arguments are file **paths and globs only**, resolved repo-relative with the
same `globset` matching and exact-path lookup as `list`/`stale` (results
unioned and deduped), with these differences worth remembering:

- **Paths and globs only.** Unlike `list`/`stale`, `tree` does NOT accept
  `#L<start>-L<end>` line-range addresses or bare span names — only file paths
  and globs that match anchored paths.
- **At least one argument is required.** There is no bare `git span tree`.
- **It fails closed.** A pattern matching no anchored file is an error, not a
  silent empty result. (`list`/`stale` exit 0 on an empty match; `tree` does
  not.)

`tree` only reads — it never authors or edits spans, and it is not a
replacement for `list`/`show`/`stale`. See `./command-reference.md` for the
full flag list.

## Show a single span

```bash
git span <name>                   # full view (= git span show <name>)
```

`git span show` prints the span file's content: `name`, `message` (the why),
each `[[anchors]]` block, and the trailing `[config]` block.

Print the current why:

```bash
git span why <name>
```

## Historical state

Span history is read from the git tree at any past commit — the span is a
tracked file, so this is just reading the file out of git history:

```bash
git show <commit-ish>:.span/<name>
```

## Walk span history

`git span history <name>` walks every commit that changed the span file, oldest
first, rendering each anchor's **source content** read from the tree at that
commit (not the stored hash), plus a `current` block when the worktree has
drifted. It omits no-op commits and reuses `stale`'s drift labels in `current`.

```bash
git span history <name>                       # XML (default) — for reading
git span history <name> --format json         # structured — for tooling
git span history <name> [-n <count>]          # limit the walk
```

- The XML is **not a parseable document** (no root, multiple top-level
  `<commit>`). Read it, or use `--format json` to consume it.
- The spine is span-*file* commits, not source history — edits between them fold
  into the next snapshot, and `event="added"` means "entered the span," not
  "written here." It is not blame: to *fix* drift, drive off `git span stale`
  (`./responding-to-drift.md`), not this view.

For the raw span-file diff (hashes, addresses) instead of anchor content, plain
git still works: `git log -p -- .span/<name>`, `git show <commit>:.span/<name>`.

## Inspecting config

The resolver config is the `[config]` block at the tail of `git span show`
output (`copy_detection`, `ignore_whitespace`, `follow_moves`). To script
against it, read the span file directly — it is TOML.

## Before a span is committed

`git span add`/`why` write `.span/<name>` in the working tree immediately, so
even before the commit:

- **`git span <name>` / `git span show <name>`** — reflect the working-tree
  span file right away.
- **`git span stale`** — scans against the working-tree span files by default.
- A teammate sees the span only after the commit containing `.span/<name>`
  lands on a shared branch.
