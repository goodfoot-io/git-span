# CI and sync

## Sync

Spans are ordinary tracked files under `.span/`. They are versioned, fetched,
and pushed exactly like any other tracked file — there are no span refspecs
and no `git span fetch`/`push` subcommands:

```bash
git pull         # picks up teammates' span edits along with their code
git push         # publishes your committed span edits
```

A span edit is shared the moment the commit that contains `.span/<name>` lands
on a shared branch. **Pull before reviewing shared span state.** All
`git span` reads are local and never contact the network.

Inspect a span's history with `git span history <name>` (preferred) or plain
git:

```bash
git log --oneline -- .span/<name>
git show <commit>:.span/<name>
```

## Advisory report (no gating)

```bash
git span stale --no-exit-code --format json > span-report.json
```

`--no-exit-code` forces exit 0 regardless of findings (`stale` otherwise exits
1 on any drift). Use for dashboards or audit work where stale spans are
counted, not blocked. `--format json` emits one JSON object —
`{"findings": [...], "schema_version": N, "span": "..."}` — not
newline-delimited records.

## Setup audit

```bash
git span doctor
```

Lightweight setup check — confirms every span file parses, and prints a
store-size summary. Suitable for a developer setup step or a CI pre-check.
Not a semantic-drift check. One malformed span file aborts the whole run with
an unscoped error rather than a per-span report — see
`references/command-quirks-and-errors.md` § "One malformed `.span/` file...".

## CI gate: the enforcement backstop

The in-session gate (`references/understanding-hook-output.md`) only runs inside
a hooked Claude Code or Codex session. It's high-leverage but not exhaustive —
a human-authored commit, a session with hooks disabled, or a Codex session
where `permissionDecision: 'deny'` doesn't actually block (see
`references/codex-install-and-trust.md`) can all land span debt. `git span
stale` with its default exit code is the backstop that catches what the gate
missed, at the point where it's cheapest to catch: before merge.

```bash
git span stale                # exits 1 on any drift, 0 when clean
```

No `--no-exit-code` here — CI wants the failing exit code, unlike the
advisory report above.

### GitHub Actions example

```yaml
name: git-span
on: [pull_request]
jobs:
  stale-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # spans compare against real git history
      - name: Build git-span
        run: cargo build --release -p git-span   # or install a prebuilt binary
      - name: Check for stale spans
        run: git span stale
```

`fetch-depth: 0` matters — a shallow checkout can make `stale` misjudge
history-dependent findings the same way a partial clone does (see
`references/content-unavailable.md`).

### Generic-runner one-liner

For any CI system that isn't GitHub Actions:

```bash
git span stale || { echo "::error::stale spans found — run 'git span stale' locally to see them"; exit 1; }
```

### Wiring into `yarn validate` (or an equivalent aggregate script)

Add `git span stale` as its own step, not folded into lint/typecheck/test —
its failure mode (semantic drift) is a different signal than a type error or
a failing assertion, and a project's own validation aggregator should report
it distinctly:

```bash
# in the project's validate script, alongside lint/typecheck/test/build:
echo "Checking spans..."
git span stale || { echo "git span stale found drift — see above"; exit 1; }
```

Keep this step **after** lint/typecheck/test in the aggregate script order —
span debt is a documentation-coupling concern, not a correctness one, so it
should never mask an earlier, more actionable failure.
