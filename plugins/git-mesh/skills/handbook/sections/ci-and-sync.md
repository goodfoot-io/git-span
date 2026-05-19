# CI and sync

## Sync

Meshes are ordinary tracked files under `.mesh/`. They are versioned, fetched,
and pushed exactly like any other tracked file — there are no mesh refspecs and
no `git mesh fetch`/`push`:

```bash
git pull         # picks up teammates' mesh edits along with their code
git push         # publishes your committed mesh edits
```

A mesh edit is shared the moment the commit that contains `.mesh/<name>` lands
on a shared branch. **Pull before reviewing shared mesh state.** All `git mesh`
reads are local and never contact the network.

Inspect a mesh's history with plain git:

```bash
git log --oneline -- .mesh/<name>
git show <commit>:.mesh/<name>
```

## HEAD-only invariant (the CI mode)

CI runners should not see checkout noise — line-ending churn, auto-generated
files, smudge-time artifacts. Collapse the resolver to its HEAD layer:

```bash
git mesh stale --head
```

`--head` resolves against HEAD only (ignoring index and working tree).
Equivalently, `--no-worktree --no-index` drops both upper layers.

## PR gate (scope to branch)

```bash
git fetch origin
base="$(git merge-base origin/main HEAD)"
git mesh stale --since "$base" --head --format github-actions
```

`--since` limits findings to anchors recorded on the current branch.
`--format github-actions` emits annotations for GitHub Actions; `junit` and
`json` are also available.

## Full repository audit (scheduled)

```bash
git fetch origin
git mesh stale --head --format junit
```

Use for repositories with many relationships that can drift without a nearby PR.

## Advisory report (no gating)

```bash
git mesh stale --head --no-exit-code --format json > mesh-report.json
```

`--no-exit-code` forces exit 0 regardless of findings. Use for dashboards or
audit work where stale meshes are counted, not blocked.

## Fresh-clone tolerance

On CI runners that have not fetched LFS or partial-clone content:

```bash
git mesh stale --head --ignore-unavailable --format github-actions
```

`--ignore-unavailable` downgrades only `CONTENT_UNAVAILABLE` findings. Drift
findings still fail. See `./content-unavailable.md` for reason codes.

## Setup audit

```bash
git mesh doctor
```

Lightweight setup check — confirms every mesh file parses. Suitable for a
developer setup step or a CI pre-check. Not a semantic-drift check.
