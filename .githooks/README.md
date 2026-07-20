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
| `pre-commit.wiki.sh`          | Phase 1: `wiki check --fix` auto-fixes drifted links/anchors AND creates git-span coverage for uncovered fragment links, re-stages the fixed `*.md` already staged for this commit (never unstaged pages) and exactly the spans touched (`--print-applied`). Phase 2: re-runs `wiki check` (no `--fix`) as a fail-closed gate | Yes, if `wiki check --fix` errors, or if phase 2 finds unresolved validation errors |
| `pre-commit.biome.sh`         | `biome check --fix` on staged TS/JS, re-stage fixes                  | Yes, on Biome errors it cannot autofix       |

Each sub-script:

- No-ops silently if its tool is absent (`command -v <tool> || exit 0`) — a
  local hook is a developer guard, not a CI gate.
- Stages any files it auto-fixes **before** it decides to block, so a
  fail-closed exit never discards the fixes (principle 4).
- Is independently runnable and `bash -n`-clean. Debug one by hand:
  `.githooks/pre-commit.biome.sh`.

Span coverage is no longer deferred to `post-commit`. The wiki hook's two
phases both run in `pre-commit`: phase 1 runs `wiki check --fix
--print-applied --source=worktree`, which in this CLI version both
auto-repairs fixable link/anchor drift AND creates git-span coverage for any
uncovered fragment links in a single pass, then re-stages the fixed `*.md`
pages **that are already part of this commit** (a fix to a page the committer
never staged is left in the worktree for its owner, so the commit cannot
silently absorb an unstaged page) and exactly the spans the run created or
extended. Phase 2 re-runs
`wiki check` (no `--fix`) as a fail-closed gate that aborts the commit on any
residual validation error or unrepairable uncovered fragment link. Only a
pre-commit hook can stage those freshly-created `.span/` files into the commit
being made and abort the commit when coverage cannot be created, so the gate
is fail-closed there rather than advisory.

## post-commit / post-rewrite (advisory)

Same dispatcher model as `pre-commit`, but a sub-script failure is reported
(to stderr) and never aborts -- you cannot un-commit from `post-commit`, and
`post-rewrite` has already rewritten history by the time it fires.

Neither router currently has any sub-scripts registered -- git-span
reconciliation moved off this commit-triggered path onto in-session
PostToolUse/PreToolUse hooks (see `packages/agent-hooks`), so `PARTS` is
empty in both.

## Adding a concern

1. Write `.githooks/<event>.<concern>.sh` from the pattern above.
2. `chmod +x` it (git must store mode `100755`).
3. Add its filename to `PARTS` in `.githooks/<event>`, in run order.
4. Document it in the table above.

## Not a hook

`merge-json-version` is a git **merge driver** (invoked via `git config
merge`, args `%O %A %B %P`), not a git event hook. It is intentionally not
part of the dispatcher model and is left as a standalone script.
