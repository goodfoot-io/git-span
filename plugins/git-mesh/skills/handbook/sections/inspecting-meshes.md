# Inspecting meshes

Reading mesh state is local and fast — no network. Meshes are tracked files, so
if the question is about shared state, pull first with ordinary git:

```bash
git pull
```

## Find meshes touching a file or anchor

This is the primary use of `git mesh list`. Always scope the query — a path, an anchor address, or a glob. Repos can carry hundreds or thousands of meshes; a bare `git mesh list` is rarely the right tool.

Overlap semantics — a mesh is listed if any anchor touches the queried path or range. The full anchor list of each matching mesh is always shown.

```bash
git mesh list src/Button.tsx
git mesh list src/Button.tsx#L40-L60
git mesh list src/Button.tsx src/Button.css     # multiple targets — unioned, deduped
git mesh list checkout-request-flow src/api.ts  # mesh name + path mixed
git mesh list billing/payments/checkout         # hierarchical mesh name (resolved as mesh, not path)
git mesh list 'src/billing/**/*.ts'             # glob (quote to defer to git mesh, or let the shell expand)
```

Each argument is tried as a mesh name first when it has the mesh-name shape (kebab-case segments, optionally separated by `/`); it falls through to path-index lookup when no mesh matches, then to a worktree existence check. A target that resolves to no meshes is fine on its own — the command exits 0. The command only errors when a target names something that doesn't exist (missing file, missing mesh name, or a literal glob the shell didn't expand). The same rule applies to `git mesh stale [<target>...]`.

## Narrow by name or content with `--search`

When the scope is a naming convention or a phrase rather than a path, filter instead of enumerating:

```bash
git mesh list --search 'billing/payments/'   # prefix scan over mesh names
git mesh list --search 'parser'              # case-insensitive match against name, why, or anchor address
git mesh list --offset 10 --limit 10         # pagination (by mesh, after filters)
```

Bare `git mesh list` with no targets and no `--search` enumerates every mesh in the repo. Avoid it on real repos — prefer a path, glob, or `--search` filter. Use `--porcelain` (`name<TAB>path<TAB>start-end`) when piping into other tools.

Bare `git mesh` (no arguments) prints short help.

## Trace blast radius

`git mesh list` answers "which meshes touch this file?". `git mesh tree`
answers the follow-on: "if I change this file, what could ripple outward?" It
renders a nested impact tree rooted at the matched files, expanding through
mesh co-occurrence to the files each could affect — without opening individual
mesh files.

```bash
git mesh tree src/auth/session.ts                 # blast radius from one file
git mesh tree 'src/billing/**/*.ts'               # roots = every matched anchor path
git mesh tree src/auth/session.ts --depth 1       # immediate neighbors only
git mesh tree src/auth/session.ts --depth 0       # the matched roots themselves, nothing expanded
git mesh tree src/auth/session.ts --format json   # nested {members, children} for tooling
```

Files that all anchor the same mesh are mutually connected, so they collapse
onto a single comma-separated line and expand once as a unit — a cluster that
moves together reads as one line, and you reach the files beyond it through
that line. Expansion is bounded by `-d`/`--depth` (default `3`), because the
graph is dense and otherwise grows quickly.

Arguments are file **paths and globs only**, resolved repo-relative with the
same `globset` matching and exact-path lookup as `list`/`stale` (results
unioned and deduped), with these differences worth remembering:

- **Paths and globs only.** Unlike `list`/`stale`, `tree` does NOT accept
  `#L<start>-L<end>` line-range addresses or bare mesh names — only file paths
  and globs that match anchored paths.
- **At least one argument is required.** There is no bare `git mesh tree`.
- **It fails closed.** A pattern matching no anchored file is an error, not a
  silent empty result. (`list`/`stale` exit 0 on an empty match; `tree` does
  not.)

`tree` only reads — it never authors or edits meshes, and it is not a
replacement for `list`/`show`/`stale`. See `./command-reference.md` for the
full flag list.

## Show a single mesh

```bash
git mesh <name>                   # full view (= git mesh show <name>)
git mesh show <name> --oneline    # one line per anchor, no header
```

`git mesh show` prints the mesh file's content: `name`, `message` (the why),
each `[[anchors]]` block, and the trailing `[config]` block.

Print the current why:

```bash
git mesh why <name>
```

## Historical state

`--at` accepts any ordinary git commit-ish — the mesh is a tracked file, so this
is just reading the file out of git history:

```bash
git mesh show <name> --at HEAD~3
git mesh show <name> --at <branch-or-tag-or-sha>
git mesh why  <name> --at HEAD~5
```

## Walk mesh history

`git mesh history <name>` walks every commit that changed the mesh file, oldest
first, rendering each anchor's **source content** read from the tree at that
commit (not the stored hash), plus a `current` block when the worktree has
drifted. It omits no-op commits and reuses `stale`'s drift labels in `current`.

```bash
git mesh history <name>                       # XML (default) — for reading
git mesh history <name> --format json         # structured — for tooling
git mesh history <name> [--since <commit-ish> | -n <count>]   # scope the walk
```

- The XML is **not a parseable document** (no root, multiple top-level
  `<commit>`). Read it, or use `--format json` to consume it.
- The spine is mesh-*file* commits, not source history — edits between them fold
  into the next snapshot, and `event="added"` means "entered the mesh," not
  "written here." It is not blame: to *fix* drift, drive off `git mesh stale`
  (`./responding-to-drift.md`), not this view.

For the raw mesh-file diff (hashes, addresses) instead of anchor content, plain
git still works: `git log -p -- .mesh/<name>`, `git show <commit>:.mesh/<name>`.

## Inspecting config

The resolver config is the `[config]` block at the tail of `git mesh show`
output (`copy_detection`, `ignore_whitespace`, `follow_moves`). To script
against it, read the mesh file directly — it is TOML.

## Before a mesh is committed

`git mesh add`/`why` write `.mesh/<name>` in the working tree immediately, so
even before the commit:

- **`git mesh <name>` / `git mesh show <name>`** — reflect the working-tree
  mesh file right away.
- **`git mesh stale`** — scans against the working-tree mesh files by default.
- A teammate sees the mesh only after the commit containing `.mesh/<name>`
  lands on a shared branch.
