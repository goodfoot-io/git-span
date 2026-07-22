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

## Same-commit workflow

Positional drift (a pure line-shift from an edit) is healed inline by the
`PostToolUse` touch hook the moment the edit lands — there is no separate
"reconcile spans" commit to make for it. Only genuine semantic drift (content
that no longer matches what a span asserts) needs your action, and when it
does, fold the `.span/` fix into the **same commit** as the code change that
caused it — never a follow-up commit. Before `git commit`/`git push`, a
`PreToolUse` gate re-checks the changeset and holds the command if real span
debt remains; see "Handling a gate denial" below.

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
git span why <name> -m "<one present-tense sentence naming the subsystem and what it does across the anchors>"
git add .span && git commit -m "..."
```
The why is a definition, not a work order: a complete sentence (subject + verb, never
`label:`) in role words, not file names, specific enough that someone who just edited one
anchor can tell whether their change lands inside it. No rules, warnings, or review steps
— put those in comments at the load-bearing anchor sites. A span isn't done until those
comments exist.

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

## Handling a gate denial

A `git commit`/`git push` can come back denied with a checklist in its
`permissionDecisionReason`. Two shapes:

- **Semantic staleness** — one or more anchors drifted for real. Resolve each
  listed span with the recipes above (usually Re-anchor), then re-run the
  exact same commit. This check is also consider-once: it denies once per
  distinct set of findings, so an identical retry with the same findings
  passes. Editing a span's anchors changes the findings and earns one fresh
  deny.
- **Uncovered writes** — a changed file has no covering span at all. Either
  declare the coupling with `git span add`, or just retry the identical
  command: this check is consider-once, so an unchanged debt state passes on
  the second attempt.

There's no override for a gate denial — every deny resolves on its own by
either fixing the underlying debt or retrying once the finding has already
been shown. A scan that fails to complete never blocks the command either:
the gate warns that span debt wasn't verified and lets the command proceed;
resolve the underlying read/scan error if the coupling still needs
verifying.

`.span/.gateignore` is a standing, committed, path-scoped opt-out of the
uncovered-writes check specifically (a gitignore-style pattern list, same
grammar as `.hookignore`) — see `references/hookignore.md`'s `.gateignore`
section. It never suppresses the semantic-staleness check.

**Codex caveat**: whether a denial actually blocks the shell tool here was
never confirmed live in this repo (`references/codex-install-and-trust.md`); if
the same `git commit`/`git push` you expected to be denied instead runs, treat
the checklist as advisory and fix it anyway rather than assuming the gate is
inert — the CI gate recipe (`references/ci-and-sync.md`) is the confirmed
backstop.

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
6. A `<git-span>` block appeared — or a `git commit`/`git push` was denied — during an
   `apply_patch` or shell call → `references/understanding-hook-output.md`.
7. The touch hook's block surfaces spans that are noise for a path class, or the gate's
   uncovered-writes nudge is noise for the whole repo → `references/hookignore.md`.
8. Mining git history for undeclared couplings (broad sweep, not one known pair) →
   `references/finding-span-candidates.md`.
9. CI wiring, PR gating, syncing spans across remotes, or a non-gating advisory report →
   `references/ci-and-sync.md`.
10. git-span under OpenAI Codex (marketplace install, hook trust) →
    `references/codex-install-and-trust.md`.
11. Exact flags, defaults, exit codes, anchor/config grammar, or reserved names →
    `references/command-reference.md`.
12. A command errors unexpectedly, or a `why`/`doctor`/`list` result looks wrong beyond
    the gotchas above → `references/command-quirks-and-errors.md`.
13. Where `.span/` data lives, refs, line-ending guarantees, or the optional merge driver →
    `references/storage-model.md`.
14. Anything else — 2+ spans need attention, or a coupling might no longer hold at all →
    `references/triage.md`.
15. Sweeping `.span/**` (or a large slice of it) up to the why-writing standard, not just
    one drifted span → `references/why-cleanup-campaign.md`.

## Not in this build — don't burn a `--help` call
`move` subcommand; `stale --patch/--stat/--worktree/--staged/--head/--search`;
`why --at/-F/--edit`; `show --patch/--at`; `add --replace`; `list --search/--batch`;
`doctor --strict`.
