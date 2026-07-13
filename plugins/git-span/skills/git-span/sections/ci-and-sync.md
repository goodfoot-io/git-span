# CI and sync

## Sync

Spans are ordinary tracked files under `.span/`. They are versioned, fetched,
and pushed exactly like any other tracked file — there are no span refspecs and
no `git span fetch`/`push`:

```bash
git pull         # picks up teammates' span edits along with their code
git push         # publishes your committed span edits
```

A span edit is shared the moment the commit that contains `.span/<name>` lands
on a shared branch. **Pull before reviewing shared span state.** All `git span`
reads are local and never contact the network.

Inspect a span's history with plain git:

```bash
git log --oneline -- .span/<name>
git show <commit>:.span/<name>
```

## HEAD-only invariant (the CI mode)

CI runners should not see checkout noise — line-ending churn, auto-generated
files, smudge-time artifacts. Collapse the resolver to its HEAD layer:

```bash
git span stale --head
```

`--head` resolves against HEAD only (ignoring index and working tree).
Equivalently, `--no-worktree --no-index` drops both upper layers.

## PR gate (scope to branch)

```bash
git fetch origin
base="$(git merge-base origin/main HEAD)"
git span stale --since "$base" --head --format github-actions
```

`--since` limits findings to anchors recorded on the current branch.
`--format github-actions` emits annotations for GitHub Actions; `junit` and
`json` are also available.

## Full repository audit (scheduled)

```bash
git fetch origin
git span stale --head --format junit
```

Use for repositories with many relationships that can drift without a nearby PR.

## Advisory report (no gating)

```bash
git span stale --head --no-exit-code --format json > span-report.json
```

`--no-exit-code` forces exit 0 regardless of findings. Use for dashboards or
audit work where stale spans are counted, not blocked.

## Fresh-clone tolerance

On CI runners that have not fetched LFS or partial-clone content:

```bash
git span stale --head --ignore-unavailable --format github-actions
```

`--ignore-unavailable` downgrades only `CONTENT_UNAVAILABLE` findings. Drift
findings still fail. See `./content-unavailable.md` for reason codes.

## Setup audit

```bash
git span doctor
```

Lightweight setup check — confirms every span file parses. Suitable for a
developer setup step or a CI pre-check. Not a semantic-drift check.
