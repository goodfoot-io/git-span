---
name: git-span
description: Track, declare, and reconcile implicit semantic couplings — file/line-range anchors coupled by nothing a schema, test, or build step enforces.
---

# git-span

```
git span drift [<name-or-path>] [--fix] [--no-exit-code] [--format human|porcelain|json]
git span add <name> <anchor>...          # declare or refresh; anchor = path or path#Lstart-Lend
git span why <name> ["..."]           # bare = read; positional or stdin = write, after add/remove
git span remove <name> <anchor>...       # retire a superseded anchor (pair with add)
git span delete <name>                   # whole span gone; NAME only, no anchor args
git span list [<target>...] [--oneline]  # positional filter on name or path
git span show <name>                     # == bare `git span <name>`
```
After any `add`/`remove`/`why`/`delete`: `git add .span && git commit -m "..."`.

## Same-commit workflow

The `PostToolUse` touch hook heals positional drift (a pure line-shift) inline; no
reconcile commit is needed for it. Semantic drift — content no longer matching what a
span asserts — needs your action: conform the lagging artifact (docs follow the
committed code; code edits need the user's say-so) and fold it, with the `.span/`
refresh, into the **same commit** as the code change, never a follow-up. Before `git commit`/`git push` a `PreToolUse` advisor
re-checks the changeset and holds the command once if real span debt remains; see
`references/understanding-hook-output.md` § "Resolving a held commit".

## Trust boundary
`git span drift`/`show`/`why`/`history` output is ground truth. Never re-derive it with
`git log`, `git show <hash>`, or a raw `Read` of a `.span/*` file — act on the CLI's own
output and stop.

## Core gotchas
- `drift --fix` only clears `Moved` anchors and whitespace-only `Changed` anchors. Real
  content drift stays reported on purpose — re-anchor directly with `add`; re-running
  `--fix` again will not change the result.
- `add` never retires what it supersedes. Moving an anchor to a new path/range is
  `remove <old-anchor>` then `add <new-anchor>`; skip `remove` and `drift` reports the old
  one as `Moved` forever.
- Anchor end-line must equal the file's *current* line count — `add` rejects
  `end=N exceeds file line count (M)`. Run `wc -l <path>` right before writing
  `#Lstart-Lend`, especially right after editing that file.
- Names are kebab-case segments (`a-z0-9`, no leading dot/uppercase); `.github/x.yml` is
  an invalid name — pick a subsystem slug instead.
- `drift`/`list` on a real, tracked, but unanchored path silently return zero (exit 0),
  not an error — that is not proof the span doesn't exist; confirm with `git span list`.
- `drift` exits 1 on any drift, breaking `&&` chains — pass `--no-exit-code` when chaining.
- Don't span a path that a script or generator writes and nobody hand-edits — span the
  inputs instead. Committed output still counts: generated images, lockfiles, the man
  page.
- The same files mirrored across two platform roots are one directed coupling, not one span
  per file (roots are directories; `add` rejects those). With a parity check: anchor the
  normative side's files plus the check. Without one the span *is* the parity mechanism —
  keep both sides of each pair and name the normative direction in the why; dropping the
  mirror side removes the only drift detection. For a tree too large to enumerate (dozens
  of pairs), anchor one representative pair and say in the why that it stands for the tree.
  Never split into one span per pair, never delete.
- Anchors all in one file usually means the counterparty the why names is missing — add it;
  delete only if none exists.

## Recipes

### Declare a new coupling
```
git span add <name> <anchor>...
git span why <name> "<one present-tense sentence naming the subsystem and what it does across the anchors>"
git add .span && git commit -m "..."
```
Before `add`: name one edit at one anchor that silently breaks or falsifies another — code
behavior, doc accuracy, or a review obligation — with no compiler, test, or build catching
it. If you cannot, there is no span; the exception is a covering span `wiki check --fix`
creates, which the wiki tooling requires regardless.

The why is a definition, not a work order: a complete sentence (subject + verb, never
`label:`) in role words, not file names, specific enough that someone who just edited one
anchor can tell whether their change lands inside it. Rules, warnings, and review steps go
in comments at the load-bearing anchor sites; a span isn't done until those exist. Good
example: "Product-listing pagination is a continuation-token flow defined by the API and
mirrored by each client library."

### Re-anchor + retire (drift names the drifted anchor; fix is obvious)
```
git span drift <name>                     # see which anchor(s) drifted and how
# Moved (same content, new path):  git span drift --fix <name>   suffices
# Changed, anchors still agree:    keep the SAME range unless the file's line count moved
# Changed, doc lags committed code: rewrite the doc first; code fixes need the user's say-so
git span remove <name> <old-anchor>       # only if path or range actually changed
git span add <name> <new-anchor>          # wc -l <path> first
git span why <name> "..."              # only if the relationship itself changed
git span drift <name>                     # must exit 0 before commit
git add .span && git commit -m "..."
```

### Value update, keep spans consistent (a coupled code+doc value changes)
```
# edit the code value AND the doc sentence the span couples it to
git span add <name> <anchor>...           # same anchor(s); refreshes the stored hash
git span drift <name>                     # must exit 0
git add .span && git commit -m "..."
```
If the edit shifted the file's line count, treat it as Re-anchor above instead (recount
with `wc -l` and write the new range).

## Where to go next
Pick the first that fits:
1. Read-only question, no `.span` mutation intended → `references/inspect.md`.
2. A `drift`/`show`/`list` finding says `DELETED`, `CONFLICT`, or `SUBMODULE` →
   `references/terminal-statuses.md`.
3. A finding says `CONTENT_UNAVAILABLE(...)`, or LFS / partial clone / sparse checkout is
   involved → `references/content-unavailable.md`.
4. The anchor target is binary, image, symlink, or LFS-tracked, or a whole-file anchor
   (no `#L`) is in play → `references/whole-file-and-lfs.md`.
5. One span — declaring it, re-anchoring it, or refreshing a coupled value — matches one
   of the three recipes above → do that, no section read.
6. A `<git-span>` block appeared — or a `git commit`/`git push` was held — during a
   `Read`/`Edit`/`Write`/`Bash` call → `references/understanding-hook-output.md`.
7. The touch hook's block surfaces spans that are noise for a path class, or the advisor's
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


