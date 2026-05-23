# Git hooks

This repo uses a **router (dispatcher) model**. Each git event has one thin
dispatcher script that runs an explicit, ordered list of single-concern
sub-scripts. Adding, removing, or reordering a behavior is editing the `PARTS`
list in the dispatcher and dropping in one `<event>.<concern>.sh` file —
never untangling a monolithic hook.

Hooks live in this tracked directory and are wired via
`git config core.hooksPath .githooks` (never the untracked `.git/hooks/`), so
they travel with the repo and are reviewable.

## Contract per event

Events are either **fail-closed** or **advisory**, never mixed:

- **Fail-closed** (`pre-*` events that run *before* the action): a non-zero
  sub-script aborts the action.
- **Advisory** (`post-*` events that run *after* the action has landed): a
  sub-script failure is reported but never aborts. You cannot un-commit from
  `post-commit`; advisory parts run for side effects only.

## pre-commit (fail-closed)

`pre-commit` is the dispatcher. It contains only the ordered `PARTS` list and
the run loop — no business logic. Order is behavior; preserve it.

| Sub-script                    | Purpose                                                              | Blocks commit?                              |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `pre-commit.version-lock.sh`  | Lock package/plugin/Cargo manifest versions to the highest semver    | Yes, if node/yarn fails                      |
| `pre-commit.wiki.sh`          | Phase 1: `wiki check --fix` auto-fixes drifted links/anchors, re-stages `*.md`. Phase 2: `wiki scaffold` creates git-mesh coverage for uncovered fragment links, stages exactly those meshes | Yes, if `wiki scaffold` fails (git-mesh unavailable or `git mesh add` error) |
| `pre-commit.biome.sh`         | `biome check --fix` on staged TS/JS, re-stage fixes                  | Yes, on Biome errors it cannot autofix       |

Each sub-script:

- No-ops silently if its tool is absent (`command -v <tool> || exit 0`) — a
  local hook is a developer guard, not a CI gate.
- Stages any files it auto-fixes **before** it decides to block, so a
  fail-closed exit never discards the fixes (principle 4).
- Is independently runnable and `bash -n`-clean. Debug one by hand:
  `.githooks/pre-commit.biome.sh`.

Mesh coverage is no longer deferred to `post-commit`. The wiki hook's two
phases both run in `pre-commit`: phase 1 auto-repairs fixable link/anchor
drift and re-stages it; phase 2 runs `wiki scaffold` to create git-mesh
coverage for any uncovered fragment links and stages exactly the meshes it
creates or renames. Only a pre-commit hook can stage those freshly-created
`.mesh/` files into the commit being made and abort the commit when coverage
cannot be created, so phase 2 is fail-closed there rather than advisory.

## Adding a concern

1. Write `.githooks/pre-commit.<concern>.sh` from the pattern above.
2. `chmod +x` it (git must store mode `100755`).
3. Add its filename to `PARTS` in `.githooks/pre-commit`, in run order.
4. Document it in the table above.

## Not a hook

`merge-json-version` is a git **merge driver** (invoked via `git config
merge`, args `%O %A %B %P`), not a git event hook. It is intentionally not
part of the dispatcher model and is left as a standalone script.
