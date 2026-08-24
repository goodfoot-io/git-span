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
| `pre-commit.wiki.sh`          | Single pass: `wiki check --fix --print-applied --no-exit-code --source=worktree` auto-fixes drifted links/anchors AND creates/extends `.wiki` mesh coverage for uncovered fragment links. Re-stages fix deltas of tracked `.md` files that were **clean before the hook ran** (pre-fix worktree hash == index hash); files already dirty before the hook are never staged — they are named in a warning and left unstaged for their owner. Scaffolded meshes are staged only when every page they anchor was clean before the hook; otherwise warned and skipped | No — advisory (`--no-exit-code`); the hook never aborts the commit |
| `pre-commit.biome.sh`         | `biome check --fix` on staged TS/JS, re-stage fixes                  | Yes, on Biome errors it cannot autofix       |

Each sub-script:

- No-ops silently if its tool is absent (`command -v <tool> || exit 0`) — a
  local hook is a developer guard, not a CI gate.
- Stages any files it auto-fixes **before** it decides to block, so a
  fail-closed exit never discards the fixes (principle 4).
- Is independently runnable and `bash -n`-clean. Debug one by hand:
  `.githooks/pre-commit.biome.sh`.

Span coverage is no longer deferred to `post-commit`. The wiki hook runs in
`pre-commit`: it invokes `wiki check --fix --print-applied
--source=worktree`, which in this CLI version both auto-repairs fixable
link/anchor drift AND creates git-span coverage for any uncovered fragment
links in a single pass. Only a pre-commit hook can stage those
freshly-created `.wiki/` mesh files into the commit being made.

Because several agent sessions share one checkout, the hook must never sweep
another session's in-progress edits into a stranger's commit, and `git add`
is whole-file — a content hash alone cannot distinguish "changed only by
--fix" from "dirty before the hook and also fixed". So before `--fix` runs,
the hook snapshots each tracked `.md` as {worktree-hash, index-hash}:

- **Clean before the hook** (worktree hash == index hash): if `--fix` rewrote
  it, its fix delta is re-staged.
- **Already dirty before the hook** (worktree hash != index hash): never
  staged, even when `--fix` touched it — named in a stderr warning instead,
  and left unstaged in the worktree for its owner.
- **Scaffolded meshes** (`--print-applied` paths): staged only when every
  `.md` page the mesh anchors was clean before the hook; otherwise warned and
  skipped, so meshes coupled to another session's uncommitted page stay out.
  A mesh whose file cannot be read is skipped too (fail closed).

## post-checkout (advisory)

`post-checkout` is the dispatcher. It forwards the hook's arguments
(`$1` old-head, `$2` new-head, `$3` branch-checkout flag) to each
sub-script.

| Sub-script                          | Purpose                                                                   | Blocks checkout? |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `post-checkout.mtime-normalize.sh`  | Pin tracked-file mtimes under the cargo crate roots to the time of the last commit that touched each file, so the shared Cargo target root stays warm across worktrees | No (advisory)    |

`post-checkout.mtime-normalize.sh` is what makes "same commit" mean "same
mtimes" in a new worktree, so a fresh `git worktree add` finds the shared
Cargo target cache already warm instead of paying a full cold rebuild.
Only clean files are pinned; files with uncommitted edits keep their own
mtimes (cargo must rebuild them, and pinning would push sibling worktrees
at the same commit into rebuilding against them). See
`packages/git-span/scripts/cargo-build-system.md` for the full rationale.

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
