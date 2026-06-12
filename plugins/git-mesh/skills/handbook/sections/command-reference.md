# Command reference

A mesh is an ordinary tracked plain-text file under the mesh root (default
`.mesh/<name>`, overridable with `--mesh-dir`, `GIT_MESH_DIR`, or
`git config git-mesh.dir`). `git mesh add` / `remove` / `why` edit that file
directly; `git add .mesh && git commit` persists it. There is no staging area,
no mesh refs, and no `git mesh commit` step.

## Anchor grammar

- **Line-range anchor**: `<path>#L<start>-L<end>` — 1-based, inclusive.
- **Whole-file anchor**: `<path>` alone — no `#L…` suffix. See `./whole-file-and-lfs.md`.

`#` is a shell comment character; quote anchors when scripting (`'src/auth.ts#L10-L20'`).

## Global options

These are valid on every subcommand (and on the bare `git mesh` form):

```bash
--perf                  # emit perf timings to stderr (or GIT_MESH_PERF=1)
--mesh-dir <MESH_DIR>   # mesh root; overrides GIT_MESH_DIR and git config git-mesh.dir
```

## Reading

```bash
git mesh                                             # list every mesh
git mesh <name>                                      # show one mesh (= git mesh show <name>)
git mesh show <name> [--oneline] [--at <commit-ish>]
git mesh list [<target>...] [--porcelain] [--oneline]
git mesh list [<target>...] [--search <regex>] [--offset <n>] [--limit <n>]
git mesh list --porcelain --batch                    # read path filters from stdin
git mesh stale [<target>...] [--format human|porcelain|json|junit|github-actions]
git mesh stale [<target>...] [--oneline|--stat|--patch] [--since <commit-ish>]
git mesh stale [<target>...] [--head|--staged|--worktree]
git mesh stale [<target>...] [--no-worktree] [--no-index]
git mesh stale [<target>...] [--ignore-unavailable] [--no-exit-code]
git mesh stale [<target>...] [--fix]                 # re-anchor in place; resolve .mesh/ conflicts
git mesh tree <glob>... [-d|--depth <n>] [--format human|json]
```

Each `<target>` is one of: a mesh name, a file path, or — for `list` only — a
line-range address `<path>#L<start>-L<end>`. Globs are expanded by the shell.
Multiple targets are unioned and deduplicated.

Resolution rule: arguments containing `#L` are line-range addresses. Arguments
that match mesh-name shape — one or more kebab-case segments separated by `/` —
try mesh-name resolution first and fall through to path lookup when no mesh
matches. Arguments that don't match mesh-name shape (paths with extensions,
globs) go straight to path lookup. A target that resolves to no meshes is fine
on its own — `list` exits 0 with an empty result; `stale` exits 0 silently.
The command only errors when a target names a referent that doesn't exist
(missing file, missing mesh name, unmatched literal glob).

Silent exit-0 from `git mesh stale` (and `list`) means the queried scope is
clean. See `./reading-stale-output.md` § "No-news-is-good-news".

`git mesh show` emits the mesh file's content (name, why, anchors, and the
`[config]` block). `--at <commit-ish>` shows the mesh as it existed in the git
tree at a past commit — ordinary git history, because the mesh is a tracked file.

`git mesh stale` read-mode flags select which layer the live content is read
from: `--head` (HEAD only), `--staged` (index over HEAD), `--worktree`
(the default — worktree over index over HEAD). `--no-worktree` / `--no-index`
drop a layer.

`git mesh tree <glob>...` traces blast radius: it renders a clique-grouped
impact tree rooted at the matched anchor paths, expanding outward through mesh
co-occurrence to the files each could affect. Files that all anchor the same
mesh — and are therefore mutually connected — collapse onto one
comma-separated line and expand once as a unit. Unlike `list`/`stale`, `tree`
requires at least one argument and **fails closed**: a pattern matching no
anchored file is an error (there is no silent exit-0). Arguments are file
**paths and globs only**, resolved repo-relative with the same `globset`
matching and exact-path lookup as `list`/`stale` (no CWD-relative joining or
bare-prefix expansion). Unlike `list`/`stale`, `tree` does NOT accept
`#L<start>-L<end>` line-range addresses or bare mesh names.
`-d`/`--depth` bounds the expansion (default `3`; `--depth 0` prints the roots
only). `--format human` (default) prints the nested markdown list; `--format
json` emits the same structure as nested
`{ "members": [...], "children": [...] }` nodes. See
`./inspecting-meshes.md` § "Trace blast radius".

## Editing a mesh

```bash
git mesh add <name> <anchor>... [--at <commit-ish>]   # write anchors into .mesh/<name>
git mesh remove <name> <anchor>...                    # remove anchors from .mesh/<name>
git mesh why <name>                                   # print current why
git mesh why <name> [--at <commit-ish>]               # print historical why
git mesh why <name> [-m <text>|-F <file>|--edit]      # write a new why into .mesh/<name>
git add .mesh && git commit                           # persist the edits
```

`git mesh add` without `--at` hashes each anchor against the file content at
`HEAD`; `--at <commit-ish>` hashes against an ordinary git commit-ish instead.

## Configuration

Resolver options are per-mesh and live in a `[config]` block inside the mesh
file. They are read and shown by `git mesh show <name>`; edit them by editing
`.mesh/<name>` directly and committing it like any other tracked change. There
is no `git mesh config` subcommand.

```toml
# tail of .mesh/<name>
[config]
copy_detection = "same-commit"   # off | same-commit | any-file-in-commit | any-file-in-repo
ignore_whitespace = false        # true | false
follow_moves = false             # true | false
```

Defaults when the block is absent: `copy_detection = "same-commit"`,
`ignore_whitespace = false`, `follow_moves = false`.

Copy-detection values:
- **`off`** — strict rename-only or no copy tracking.
- **`same-commit`** — default; good balance for ordinary refactors.
- **`any-file-in-commit`** — code may be copied from another file touched in the same commit.
- **`any-file-in-repo`** — last resort; broad and can be expensive.

`ignore_whitespace = true` is appropriate for formatting churn; it is wrong if
whitespace is semantically meaningful. Config is part of the mesh file, so it is
versioned and shared by every consumer of the mesh exactly like the anchors.

## Structural

```bash
git mesh delete <name>            # remove .mesh/<name>
git mesh move   <old> <new>       # rename a mesh (<new> must not already exist)
```

These edit the working tree (`git rm` / rename of the mesh file); commit the
result with `git add .mesh && git commit`. To restore a prior mesh state, use
ordinary git — `git checkout <commit-ish> -- .mesh/<name>` or `git revert`.

## Sync and maintenance

Meshes are tracked files: they fetch, push, and pull with ordinary
`git fetch` / `git push` / `git pull`. There are no mesh refspecs.

```bash
git mesh doctor [--strict]        # audit the local mesh setup
```

## Merge conflict resolution

A `.mesh/` file is a derived, line-oriented artifact, so a merge (or rebase,
cherry-pick, stash apply) that touched the same anchored region on both branches
leaves git's textual conflict markers in the mesh file. A conflict-markered mesh
is a hard error for every read-only command (`show`, `list`, `stale`) until it is
resolved. Two commands resolve it — you never hand-edit an `rk64:` hash.

```bash
git mesh stale --fix              # authoritative resolver (also re-anchors drift)
git mesh merge-driver <O> <A> <B> <L>   # git-invoked accelerator (never run by hand)
```

`git mesh stale --fix` is the authoritative finisher. Beyond re-anchoring
`Moved`/`Changed` anchors in place (re-hashing each against the deepest drifting
layer, Worktree > Index > HEAD), it rewrites conflict-markered `.mesh/` files
into one clean version: it splits the markers into ours/theirs, **enforces a
clean-source precondition** — every source file an affected mesh anchors must
itself be conflict-free — reads the now-clean source, and merges structurally
(anchors unioned, re-pointed, re-hashed against the worktree, written in
canonical `(path, start, end)` order). It produces no commit and is only
supported with `--format human`. It **fails closed** in two cases, leaving a
minimal conflict around exactly the unresolvable lines, declining to re-stage
that mesh, and reporting loudly:

- a source file an affected mesh anchors still carries conflict markers, or
- the `--why` prose diverged between ours and theirs (no merge base to resolve it).

`git mesh merge-driver %O %A %B %L` is an **optional accelerator**, invoked by
git itself during the merge — never run by hand. Register it so the easy majority
of `.mesh/` conflicts collapse in place and never surface (see
`./git-hook-setup.md` § "Optional merge driver"). It receives three clean blob
temp files and the marker length, must **not** trust the worktree (which may be
mid-merge), and so resolves only the structurally-derivable part — union of
distinct anchors, three-way `--why` merge, identical anchors. Any same-anchor
range/hash divergence is deferred: it writes a minimal conflict and exits
non-zero (git's native partial-resolution signal), leaving `git mesh stale --fix`
to finish authoritatively. It is a strict subset of `--fix`: a developer who
never registers it reaches the identical clean end state through `--fix` alone;
the driver changes only how many conflicts surface mid-merge, never whether a
clean result is reachable.

## Reserved mesh names

A mesh name must be kebab-case segments separated by `/`. The following tokens
are reserved and cannot be used as a mesh name (so the bare `git mesh <name>`
form is unambiguous): `add`, `remove`, `commit`, `why`, `restore`, `revert`,
`delete`, `move`, `stale`, `tree`, `fetch`, `push`, `doctor`, `log`, `config`,
`list`, `help`, `pre-commit`, `advice`, `rewrite`, `hooks`, `merge-driver`.
