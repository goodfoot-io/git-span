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

## Advisory report (no gating)

```bash
git span stale --no-exit-code --format json > span-report.json
```

`--no-exit-code` forces exit 0 regardless of findings. Use for dashboards or
audit work where stale spans are counted, not blocked.

## Setup audit

```bash
git span doctor
```

Lightweight setup check — confirms every span file parses. Suitable for a
developer setup step or a CI pre-check. Not a semantic-drift check.
