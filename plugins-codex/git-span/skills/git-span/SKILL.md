---
name: git-span
description: Track, declare, and reconcile implicit semantic couplings between file/line ranges in a git repo via anchored spans.
---

# git-span

```
git span stale [<name-or-path>] [--fix] [--no-exit-code] [--format human|porcelain|json]
git span add <name> <anchor>...          # declare or refresh; anchor = path or path#Lstart-Lend
git span why <name> [-m "..."]           # bare = read; -m = write, after add/remove
git span remove <name> <anchor>...       # retire a superseded anchor (pair with add)
git span delete <name>                   # whole span gone; NAME only, no anchor args
git span list [<target>...] [--oneline]  # positional filter on name or path
git span show <name>                     # == bare `git span <name>`
```
After any `add`/`remove`/`why -m`/`delete`: `git add .span && git commit -m "..."`.

## Trust boundary
`git span stale`/`show`/`why`/`history` output is ground truth. Never re-derive it with
`git log`, `git show <hash>`, or a raw `Read` of a `.span/*` file — act on the CLI's own
output and stop.

## Core gotchas
- `stale --fix` only clears `Moved` anchors and whitespace-only `Changed` anchors. Real
  content drift stays reported on purpose — re-anchor directly with `add`; re-running
  `--fix` again will not change the result.
- `add` never retires what it supersedes. Moving an anchor to a new path/range is
  `remove <old-anchor>` then `add <new-anchor>`; skip `remove` and `stale` reports the old
  one as `Moved` forever.
- Anchor end-line must equal the file's *current* line count — `add` rejects
  `end=N exceeds file line count (M)`. Run `wc -l <path>` right before writing
  `#Lstart-Lend`, especially right after editing that file.
- Names are kebab-case segments (`a-z0-9`, no leading dot/uppercase); `.github/x.yml` is
  an invalid name — pick a subsystem slug instead.
- `stale`/`list` on a real, tracked, but unanchored path silently return zero (exit 0),
  not an error — that is not proof the span doesn't exist; confirm with `git span list`.
- `stale` exits 1 on any drift, breaking `&&` chains — pass `--no-exit-code` when chaining.

## Recipes

### Declare a new coupling
```
git span add <name> <anchor>...
git span why <name> -m "one sentence: name the subsystem, what it does across anchors"
git add .span && git commit -m "..."
```

### Re-anchor + retire (stale names the drifted anchor; fix is obvious)
```
git span stale <name>                     # see which anchor(s) drifted and how
# Moved (same content, new path):  git span stale --fix <name>   suffices
# Changed, coupling still holds:   keep the SAME range unless the file's line count moved
git span remove <name> <old-anchor>       # only if path or range actually changed
git span add <name> <new-anchor>          # wc -l <path> first
git span why <name> -m "..."              # only if the relationship itself changed
git span stale <name>                     # must exit 0 before commit
git add .span && git commit -m "..."
```

### Value update, keep spans consistent (a coupled code+doc value changes)
```
# edit the code value AND the doc sentence the span couples it to
git span add <name> <anchor>...           # same anchor(s); refreshes the stored hash
git span stale <name>                     # must exit 0
git add .span && git commit -m "..."
```
If the edit shifted the file's line count, treat it as Re-anchor above instead (recount
with `wc -l` and write the new range).

## Where to go next
Pick the first that fits:
1. Read-only question, no `.span` mutation intended → `references/inspect.md`.
2. A `stale`/`show`/`list` finding says `DELETED`, `CONFLICT`, or `SUBMODULE` →
   `references/terminal-statuses.md`.
3. A finding says `CONTENT_UNAVAILABLE(...)`, or LFS / partial clone / sparse checkout is
   involved → `references/content-unavailable.md`.
4. The anchor target is binary, image, symlink, or LFS-tracked, or a whole-file anchor
   (no `#L`) is in play → `references/whole-file-and-lfs.md`.
5. One span — declaring it, re-anchoring it, or refreshing a coupled value — matches one
   of the three recipes above → do that, no section read.
6. A `<git-span>` block appeared — or expectedly didn't — during a `Read`/`Edit`/`Write` →
   `references/understanding-hook-output.md`.
7. The PreToolUse block surfaces spans that are noise for a path class →
   `references/hookignore.md`.
8. Installing or troubleshooting the `post-commit`/`post-rewrite` reconciliation hooks or
   the optional merge driver → `references/git-hook-setup.md`.
9. You were spawned unattended as the dispatcher's standalone reconciler agent →
   `references/standalone-reconciler.md`.
10. Mining git history for undeclared couplings (broad sweep, not one known pair) →
    `references/finding-span-candidates.md`.
11. CI wiring, PR gating, syncing spans across remotes, or a non-gating advisory report →
    `references/ci-and-sync.md`.
12. git-span under OpenAI Codex (marketplace install, hook trust) →
    `references/codex-install-and-trust.md`.
13. Exact flags, defaults, exit codes, anchor/config grammar, or reserved names →
    `references/command-reference.md`.
14. A command errors unexpectedly, or a `why`/`doctor`/`list` result looks wrong beyond
    the gotchas above → `references/command-quirks-and-errors.md`.
15. Where `.span/` data lives, refs, or line-ending guarantees →
    `references/storage-model.md`.
16. Anything else — 2+ spans need attention, or a coupling might no longer hold at all →
    `references/triage.md`.

## Not in this build — don't burn a `--help` call
`move` subcommand; `stale --patch/--stat/--worktree/--staged/--head/--search`;
`why --at/-F/--edit`; `show --patch/--at`; `add --replace`; `list --search/--batch`;
`doctor --strict`.
