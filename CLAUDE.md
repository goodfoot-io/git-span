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

<commit-message>
Do not include a "Co-Authored-By: Claude ..." message in commits.
</commit-message>

<workspace-information>
Our workspace uses Yarn 4.x as a package manager. Do not use other package managers such as 'npm'.

This is a Yarn 4.x monorepo with packages in ./packages/ containing a Rust CLI (packages/git-mesh) and a VS Code extension (packages/extension).

Use local rather than origin branches.

Cargo build artifacts for the git-mesh CLI are written to a **shared per-user directory**
at `$HOME/.cache/git-mesh/cargo-target/<task>/`, where `<task>` is one of `build`, `test`,
`lint`, `typecheck`, `udeps`, or `sync`. This directory is shared across all card worktrees:
a build started from any worktree reuses compilation work already done by sibling worktrees.

All yarn scripts and tooling scripts honor the `GIT_MESH_CARGO_TARGET_ROOT` environment
variable to override this root (e.g., for CI isolation). The per-worktree fallback
`packages/git-mesh/target-cache/` (via [.cargo/config.toml](./packages/git-mesh/.cargo/config.toml))
is still present for ad-hoc `cargo` invocations but is not the default for any scripted entry point.

`sccache` (`RUSTC_WRAPPER=sccache`, `SCCACHE_DIR=/home/node/.cache/sccache`) deduplicates
`rustc` invocations across worktrees as a second caching layer, covering compilation but not linking.

**Build-phase serialization:** Cargo's `.cargo-lock` serializes builds across worktrees
sharing the same task subdirectory. Concurrent `yarn test` runs in different worktrees
build serially (order of seconds) then test in parallel. This is normal — not a hang.

**Shared target-root lock:** Every scripted cargo task runs under a *shared* flock on
`$HOME/.cache/git-mesh/cargo-target/.target.lock` (via
`packages/git-mesh/scripts/with-target-lock.sh`), and anything that deletes from the
shared root (`clean-shared-build.sh`, the freshness-stamp wipe in
`cleanup-stale-target.sh`) takes the *exclusive* lock. A `yarn build:clean` in one
worktree therefore waits for in-flight builds in sibling worktrees instead of deleting
artifacts out from under them. Worktrees checked out at commits predating this lock do
not participate in it — avoid running their `build:clean` while another worktree builds.

The one true `sccache` binary is `/usr/local/bin/sccache`, installed by the
Dockerfile for the build platform's architecture and verified at image build
time. Do not install another copy (e.g. `cargo install sccache` into
`~/.cargo/bin`, which is bind-mounted and outlives rebuilds): a second binary
shadowing the managed one is how client/server version skew — and the wedged
servers it causes — happened in the first place. If you see `error: could not
exec sccache`, rebuild the devcontainer.

`yarn validate` and `yarn bump` run `scripts/ensure-sccache.sh` first, and the
devcontainer runs it at every container start (`postStartCommand`), so a stale or
version-mismatched `sccache` server holding the server socket is reclaimed and a
clean server started before any Rust compile. If a *direct* `cargo build` ever
aborts with `sccache: error: Failed to read response header` / `failed to fill
whole buffer` (a wedged server the client can't replace), run
`bash scripts/ensure-sccache.sh` to recover. If automatic recovery fails it exits
non-zero with the manual steps: `pkill -9 -f sccache`, then
`SCCACHE_DIR=/home/node/.cache/sccache SCCACHE_START_SERVER=1 sccache`.
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

If a new feature was added to the `git-mesh` CLI, build the latest version and use the `Bash` tool to perform smoke tests around the new feature.
</validation>

<git-mesh>

```bash
# Stage the mesh: slug titles the subsystem; line-range anchors (`path#L<start>-L<end>`) or whole-file anchors carry the path
git mesh add billing/checkout-request-flow \
  web/checkout.tsx#L88-L120 \
  api/charge.ts#L30-L76

# Name the subsystem, flow, or concern the anchors collectively form, and say plainly what it does across them
git mesh why billing/checkout-request-flow \
  -m "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server."

# The post-commit hook runs `git mesh commit`
git commit -m "Wire checkout to charge API"

# Later ...

# Run `git mesh stale [--patch] [glob]` and carefully examine the files in each mesh to identify drift
git mesh stale
```

</git-mesh>