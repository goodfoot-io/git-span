<golden-rule>
After making any changes to code or configuration files, lint, type check, and run all tests. (Not required for markdown, JSON, or CSS changes.)

異常を検知した時点で、誰もが即時に可視化・共有し、作業を一旦停止して真因を特定し、再発防止策（恒久対策）を講じてから再開する。

This applies to all warnings and failures encountered during validation, not only warnings or failures caused by your changes. Do not dismiss failures as "pre-existing" or "unrelated."

**A test that does not run because of an infrastructure error is a blocking condition.** Do not proceed with implementation.
</golden-rule>

<greenfield>
This is a greenfield implementation. Do not create migrations, backwards compatibility, or fallbacks.
</greenfield>

<right-way-over-easy-way>
Always choose the "right way" over the "easy way".
</right-way-over-easy-way>

<fail-closed>
Prefer 'fail closed' workflows over 'fail open' workflows.
</fail-closed>

<workspace-information>
Our workspace uses Yarn 4.x as a package manager. Do not use other package managers such as 'npm'.

This is a Yarn 4.x monorepo with packages in ./packages/ containing a Rust CLI (packages/git-span) and a VS Code extension (packages/extension).

Use local rather than origin branches.

Cargo build artifacts are written to a **shared per-user directory** at
`$HOME/.cache/git-span/cargo-target/<crate>/<group>/`, where `<crate>` is `git-span` or
`git-span-core` and `<group>` is `check` (non-codegen tasks: `cargo check`, `cargo clippy`
— rmeta) or `build` (codegen tasks: `cargo nextest`, `cargo build`, `cargo run` — rlib).
`git-span/udeps/` is a third group for the nightly `cargo udeps`. **Non-codegen (rmeta) and
codegen (rlib) artifacts must never share a directory** — doing so leaves rmeta-only crates
that fail downstream rlib links with `E0463 "can't find crate"`. This was the root cause of
the build failures; the full rationale and layout live in
[packages/git-span/scripts/cargo-build-system.md](./packages/git-span/scripts/cargo-build-system.md).
The directory is shared across all card worktrees: a build started from any worktree reuses
compilation work already done by sibling worktrees.

All yarn scripts and tooling scripts honor the `GIT_SPAN_CARGO_TARGET_ROOT` environment
variable to override this root (e.g., for CI isolation). The per-worktree fallback
`packages/git-span/target-cache/` (via [.cargo/config.toml](./packages/git-span/.cargo/config.toml))
is still present for ad-hoc `cargo` invocations but is not the default for any scripted entry point.

**Build-phase serialization:** Cargo's `.cargo-lock` serializes builds across worktrees
sharing the same group subdirectory. Concurrent `yarn test` runs in different worktrees
build serially (order of seconds) then test in parallel. This is normal — not a hang.

**Shared target-root lock:** Every scripted cargo task runs under a *shared* flock on
`$HOME/.cache/git-span/cargo-target/.target.lock` (via
`packages/git-span/scripts/with-target-lock.sh`), and anything that deletes from the
shared root (`clean-shared-build.sh`, the freshness-stamp wipe in
`cleanup-stale-target.sh`) takes the *exclusive* lock. A `yarn build:clean` in one
worktree therefore waits for in-flight builds in sibling worktrees instead of deleting
artifacts out from under them. Worktrees checked out at commits predating this lock do
not participate in it — avoid running their `build:clean` while another worktree builds.
</workspace-information>

<jsdoczoom>

**Shows increasing levels of documentation in TypeScript files based on JSDoc annotations.**

```bash
# Use instead of `find . -name "*.ts" | xargs grep -ril "CacheKey|buildIndex|TreeNode"`
jsdoczoom ./src/** --search "CacheKey|buildIndex|TreeNode"
```

Each output header - "# [FILE PATH]@[DEPTH]" - is the next drill-down selector.

Run `jsdoczoom [FILE PATH]@[DEPTH]` to get deeper information on the file.

Then `jsdoczoom [FILE PATH]@[DEPTH + 1]` to get deeper still.

```bash
# The --search value is a regex passed as a plain string — never escape | or other regex metacharacters
jsdoczoom --search "foo|bar"      # GOOD: matches either foo or bar
jsdoczoom --search "foo\|bar"     # BAD: treats \| as a literal character, not alternation
```

Use the `jsdoczoom:jsdoczoom` subagent instead of the `Explore` subagent to answer code questions in this repository.
</jsdoczoom>

<documentation>

<validation>
Lint and typecheck the entire project frequently — these operations are cheap. During development, focus test runs as tightly as possible: a single failing test or suite should be re-run alone until it passes. Broaden scope only for final confirmations or when a fix demands wider information.

Run validation from the package directory containing the changed files, using that package's scripts from `package.json` (e.g., `yarn lint`, `yarn typecheck`, `yarn test`).

Run `yarn validate` from the workspace root for final validations — it typechecks, lints, tests, and builds all packages. The script merges stderr into stdout, prints `Exit code: N` at the end, and writes everything to `./yarn-validate-output.log`. **Run only `yarn validate` — do not add `2>&1`, `echo $?`, or any other wrapper.** Exit code 0 means all checks passed.

If a new feature was added to the `git-span` CLI, build the latest version and use the `Bash` tool to perform smoke tests around the new feature.
</validation>

<git-span>

```bash
# Stage the span: slug titles the subsystem; line-range anchors (`path#L<start>-L<end>`) or whole-file anchors carry the path
git span add billing/checkout-request-flow \
  web/checkout.tsx#L88-L120 \
  api/charge.ts#L30-L76

# Name the subsystem, flow, or concern the anchors collectively form, and say plainly what it does across them
git span why billing/checkout-request-flow \
  -m "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server."

# Persist the span alongside the code in the same commit
git add .span && git commit -m "Wire checkout to charge API"

# Later ...

# Run `git span stale [--patch] [glob]` and carefully examine the files in each span to identify drift
git span stale
```

</git-span>