# Cargo build system

This document explains how the Rust crates (`packages/git-span` and
`packages/git-span-core`) are compiled, where build artifacts live, how
concurrent worktrees stay safe, and the one cargo invariant the whole layout
exists to protect. Read it before changing any `cargo` invocation in a
`package.json` script, a `scripts/*.sh` helper, or a CI workflow — those entry
points are deliberately kept on one flag-and-target-group profile and a
divergence reintroduces the failures described below. (The one subcommand
difference today: local `typecheck` and `lint` both run `cargo clippy`, while
CI's typecheck is a plain `cargo check` step — same `RUSTFLAGS`, same group, so
the two share fingerprints; see [CI parity](#ci-parity).)

## The invariant: never mix rmeta and rlib in one target directory

Cargo compiles a crate in one of two output modes:

- **Non-codegen** (`cargo check`, `cargo clippy`): emits only `.rmeta`
  (type-checked metadata, no machine code). Fast.
- **Codegen** (`cargo build`, `cargo test`, `cargo nextest run`, `cargo run`,
  benches): emits `.rlib` (compiled code) — required by anything that actually
  links and runs.

If both modes share one `CARGO_TARGET_DIR`, a prior `cargo check` can leave a
dependency present **only as `.rmeta`**. A later codegen build sees a fresh
fingerprint, skips recompilation, then fails at link time:

```
error[E0463]: can't find crate for `serde_json`
error: cannot find attribute `error` in this scope   # thiserror's derive, rmeta-only
error: crate `…` required to be available in rlib format
```

These are exactly the intermittent failures this layout prevents. The race was
reproduced directly on the toolchain in use: seeding a directory with
`cargo check` artifacts and then running `cargo nextest run --no-run` in the
same directory fails to link `git-span-core`; keeping the two apart is clean.
Conversely, `check` + `clippy` share a directory cleanly (both rmeta), and
`test` + `build` + `run` share a directory cleanly (all rlib) — verified the
same way. So the minimal correct split is **two groups, not one dir and not
one-dir-per-task.**

## Directory layout

All scripted cargo tasks write under a shared per-user root. In the
devcontainer the root is a named Docker volume (`git-span-cargo-target`) mounted
at `/var/cache/git-span/cargo-target` on container-native storage; every
scripted entry point writing to the shared root honors the
`GIT_SPAN_CARGO_TARGET_ROOT` override (e.g. for CI isolation):

```
/var/cache/git-span/cargo-target/   # default root
├── .target.lock                 # flock coordinating tasks vs. cleanup (all worktrees)
├── .freshness-stamp             # toolchain/lockfile/config fingerprint
├── git-span/
│   ├── check/                   # cargo clippy (typecheck + lint)  → rmeta
│   ├── build/                   # cargo nextest + cargo build --release + gen-manpage → rlib
│   └── udeps/                   # cargo +nightly udeps (separate toolchain)
└── git-span-core/
    ├── check/                   # cargo clippy (typecheck + lint) → rmeta
    └── build/                   # cargo test → rlib
```

Splitting by `<crate>/<output-group>` keeps the rmeta/rlib invariant per crate.
`udeps` is isolated because it runs under the **nightly** toolchain; a different
`rustc` is a different fingerprint and would otherwise thrash the stable
artifacts.

The root is **shared across all worktrees on the machine** — a build started in
one worktree reuses dependency compilation done by a sibling. This is the whole
reason for a per-user root rather than per-worktree `target/` directories.

### Cross-worktree fingerprint invalidation

The sharing above is asymmetric by construction: cargo fingerprints embed
absolute paths of the *building* worktree. Registry dependencies compile from
`~/.cargo/registry` (identical paths from every worktree), so their units stay
shared — but each workspace's own crates record `rerun-if-changed` lists under
the building worktree's absolute root. Whichever worktree built into
`git-span/build` most recently owns the fingerprints; building from any other
worktree dirties every local unit (`RerunIfChangedOutputPathsChanged { new:
[.../cards/<sibling>/...] }`) and pays a full rebuild of `git-span-core` +
`git-span`. Measured cost: seconds on an idle machine, ~2 minutes under a
loaded parallel validation harness — recurring "interest" on every worktree
switch, not a one-time cold cost.

Three cache states, and how tooling treats them:

| State | Outcome |
|---|---|
| Warm for this worktree | Incremental no-op build |
| Cold (fresh root) | Full dependency graph compile — budget via `GIT_SPAN_CARGO_BUILD_BUDGET_MS`, see below |
| Warm but fingerprinted for a sibling | Local-graph rebuild, then green |

Slow builds are diagnosed, never silent: the portability suites' test helper
([buildWorkspaceGitSpan()](../../agent-hooks/test/real-bundle-helpers.ts))
enforces its own budget (`GIT_SPAN_CARGO_BUILD_BUDGET_MS`, default 480s —
deliberately under those suites' 600s hook timeouts) and converts an
over-budget kill into an error naming invalidation, elapsed time, and this
document's remediation. Independently, [with-target-lock.sh](with-target-lock.sh)
persists cargo's own fingerprint-invalidation log for any build slower than
`GIT_SPAN_FINGERPRINT_THRESHOLD` (default 15s) into
`$GIT_SPAN_CARGO_TARGET_ROOT/.fingerprint-tripwire/`, so the stale input is
on disk even when nobody was watching.

### Flag consistency within a group

Within each group every invocation uses identical `RUSTFLAGS`, so cargo never
rebuilds dependencies just because flags changed (the "fingerprint thrash"
problem). The `check` group sets `RUSTFLAGS="-W unused -W dead-code"` for both
`check` and `clippy`; the `build` group sets no extra flags. The two groups are
isolated directories, so the flag difference between them costs nothing.

Locally the check group has a single command: `yarn typecheck` runs the exact
`cargo clippy` command `yarn lint` runs (same wrapper, env, flags, target
directory), so the two steps in `yarn validate` share one artifact set and the
second invocation is a fingerprint no-op. Plain `cargo check` survives only as
CI's typecheck step, which writes into the same group with the same
`RUSTFLAGS` — see [CI parity](#ci-parity).

## Serial compilation — history

Scripted cargo invocations once pinned the compile graph to a single job —
`CARGO_BUILD_JOBS=1` for `check`/`clippy`/`build`/`run`, and `--build-jobs 1`
for `cargo nextest run` (nextest's build phase otherwise defaults to all cores,
ignoring the env var). That was a **correctness** requirement, not a tuning
knob, and it is gone: with the shared root relocated to container-native
storage (card **main-215**), every scripted task runs with **default job
parallelism**.

The pin existed because the shared root lived on the devcontainer's `virtiofs`
mount. With default parallelism, sibling `rustc` jobs intermittently aborted
with `error[E0463]: can't find crate for <dep>` — a *different* dependency on
each run (`bstr`, `serde`, `rustix`, `prodash`, …). cargo respects the
dependency DAG, so a dependent never *scheduled* before its dependency
finished; the failure was that a just-written `.rlib`/`.rmeta` was not yet
visible to a concurrent reader job when it opened it. virtiofs's write/read
visibility across concurrent processes is not immediately coherent, which was
the trigger; serial compilation removed the concurrency and the race with it.

The serialization was removed once before (card **main-122**, on the theory
that the per-task directory split plus `test = false` were the whole fix) and
the race returned exactly as that card predicted it might. The directory split
fixes the *rlib/rmeta* race; it did **not** fix the *intra-build parallelism*
race. The two were independent and both mitigations were required while the
root was on virtiofs.

The cost was real — a 10-core machine compiled one crate at a time. The run
phases stayed parallel (`cargo nextest run` executes test binaries
concurrently; only its *build* was serialized), so the tax was compilation
wall-clock only. Main-215's move of the root to a named volume on
container-native storage restored write/read coherence and made the pin
unnecessary; the pins were removed from the shared-root scripts and CI, and
the directory split remains as the one still-required mitigation.

## Worktree safety

Worktrees are created by `create-worktree`, which symlinks the gitignored
`target`/`target-cache` directories back to the main checkout at `/workspace`.
Those symlinks only matter for **ad-hoc raw `cargo`** (see below). Every
*scripted* task sets an absolute `CARGO_TARGET_DIR` into the shared root and so
ignores the symlinks entirely — builds from any worktree land in the same
shared cache regardless of where the worktree lives.

Concurrency is coordinated by [`with-target-lock.sh`](./with-target-lock.sh):

- Every cargo task takes a **shared** (reader) lock on `.target.lock` — many
  tasks run in parallel.
- Anything that deletes from the root (`clean-shared-build.sh`, the stale-stamp
  wipe in `cleanup-stale-target.sh`) takes an **exclusive** (writer) lock, so a
  `yarn build:clean` in one worktree can never `rm -rf` artifacts out from under
  a sibling worktree's in-flight build.

Within a single group directory, cargo's own `.cargo-lock` serializes the build
phase across processes, so two worktrees compiling the same group build serially
then run in parallel. That brief serialization is expected, not a hang.

## Cross-worktree cache warmth: commit-time mtimes

The shared root is warm only if cargo's fingerprints say the sources are
unchanged. Cargo 1.97's default (mtime-mode) fingerprinting records each
compiled file's mtime at build time; when a worktree checks out a commit, git
writes the files with "now" mtimes, so every new worktree looked *newer* than
every recorded mtime and paid a full cold rebuild of both crates even though
the cache already held identical artifacts (a fresh worktree's first
`yarn validate` came in around 147s vs ~92-102s warm).

[`post-checkout.mtime-normalize.sh`](../../../.githooks/post-checkout.mtime-normalize.sh)
(dispatched from `.githooks/post-checkout`, wired via `core.hooksPath`)
fixes this: after any checkout it pins the mtimes of tracked files under the
crate roots (the directories of every tracked `packages/*/Cargo.toml` /
`npm/*/Cargo.toml`) to the commit time of the last commit that touched each
file, taken from a single `git log HEAD --format=%ct --name-only -z` walk over
those directories. "Same commit" then means "same mtimes" in every worktree,
and a fresh `git worktree add` at a commit already built in the shared root
starts warm instead of rebuilding. The hook costs well under a second (one
walk, ~0.2s, plus one `touch -h` per file).

Two properties keep it safe:

- **Pinning is newer-only.** Cargo 1.97's mtime check marks a unit stale only
  when a source file is *newer* than the recorded mtime; older is never stale.
  Commit times are always in the past, so pinning can never make anything
  dirty: the shared cache needs no re-recording, and a dirty edit in one
  worktree (which makes the file newer only there) cannot flip sibling
  worktrees at the same commit into rebuilding.
- **Only clean files are pinned.** Files with uncommitted edits (staged or
  unstaged, per `git diff --name-only HEAD`) keep their own mtimes: cargo must
  rebuild them in the worktree that owns the edit, and pinning them would push
  every sibling at the same commit into rebuilding against them too.

The hook is advisory and fails open: a file with no pin (e.g. a parse drift, or
a checkout at an old commit) is skipped with a stderr warning — skipping is
correct there, since that worktree must rebuild anyway. Checkout at a
*changed* commit lands the same way: newer files are simply newer than the
cache's records, so cargo rebuilds only what the commit actually touched.

## Linker wrapper: bare name, worktree-invariant fingerprints

Linux links run through the mold cc wrapper
([`cc.mold-wrapper.sh`](./cc.mold-wrapper.sh)) selected via the
`[target.*].linker` config key (RUSTFLAGS-immune, unlike `rustflags`). The key
must be a **bare name** (`linker = "cc.mold-wrapper"`), not a path — this is a
worktree-invariance requirement, not a style preference:

- Cargo 1.97 hashes the *resolved* `[target.*].linker` value into every unit
  fingerprint. A relative path (`linker = "scripts/cc.mold-wrapper.sh"`) is
  resolved against the config's directory, so a run from worktree A hashes
  `…/A/packages/git-span/scripts/…` and a run from sibling worktree B hashes
  `…/B/…`. Every unit built from the other directory goes
  `dirty: ConfigSettingsChanged` and the whole graph recompiles even though
  the shared root already holds every rlib.
- A value without `/` is kept as-is: the fingerprint covers only the literal
  string, which is identical from every worktree, and the PATH lookup happens
  at spawn time. Wrapper content, path, or staleness can therefore never cause
  a rebuild.

The wrapper must exist on PATH for the build to link at all. Scripted entry
points self-heal: [`with-target-lock.sh`](./with-target-lock.sh) copies
`cc.mold-wrapper.sh` to `$HOME/.local/bin/cc.mold-wrapper` (copy-if-missing —
a user-installed wrapper is never clobbered) and prepends that dir to PATH for
the wrapped command. The devcontainer image installs it to `/usr/local/bin`
for ad-hoc raw `cargo`, and CI installs it in the workflow (CI does not run
through `with-target-lock.sh`). See README "Linker (Linux only)" for manual
installs.

## Freshness stamp lifecycle

The shared root's `.freshness-stamp` (see the layout above) records the inputs
the cache was built with: sha256 of both crates' `Cargo.lock`, `rustc
--version`, and sha256 of both crates' `.cargo/config.toml`. The computation
lives once in [`cargo-target-stamp.sh`](./cargo-target-stamp.sh), sourced by
both [`with-target-lock.sh`](./with-target-lock.sh) and
[`cleanup-stale-target.sh`](./cleanup-stale-target.sh).

- **Healthy builds refresh.** Every scripted cargo task ends (on status 0) by
  calling `refresh_target_stamp`, which writes the stamp only if it is missing
  or differs — so after any build the stamp reflects the inputs that build
  compiled. The refresh is advisory: a failure warns on stderr and does not
  fail the build, because cleanup re-evaluates on its own.
- **Missing stamp → record, do not wipe.** `cleanup-stale-target.sh` treats a
  missing stamp as *no evidence* that anything changed (the root predates the
  stamp feature, or a wipe already cleared it) — it records the stamp and
  appends a `STAMP … created-missing` line to the wipe-events log instead of
  deleting warm artifacts.
- **Stale stamp → whole-root wipe.** When the stamp exists but differs from
  the current inputs (lockfile, toolchain, or config change), the script
  `rm -rf`s every top-level directory under the root under the exclusive lock
  and writes the fresh stamp, logging a `WIPE … stale removing …` line.

## Raw `cargo` (ad-hoc, not used by any scripted entry point)

A bare `cargo` invocation that does **not** set `CARGO_TARGET_DIR` falls back to
[`.cargo/config.toml`](../.cargo/config.toml)'s `target-dir = "target-cache"`.
In a worktree that path is a symlink to the main checkout's `target-cache`, so
ad-hoc builds share one location but are **not** covered by the target lock and
**do** mix check/build output. Prefer the `yarn` scripts; reach for raw `cargo`
only for one-off experiments, and expect a full rebuild if you alternate
`cargo check` and `cargo test` there.

## CI parity

`.github/workflows/ci.yml` runs raw `cargo` (no Node/yarn in the CLI job) but
mirrors this layout exactly: each step sets `CARGO_TARGET_DIR` to the matching
`<crate>/<group>` directory, passes `--locked`, and sets the same `RUSTFLAGS`
for the check group. `CARGO_INCREMENTAL=0` because a cold CI build never recoups
incremental-metadata overhead. If you change a cargo command in a `package.json`
script, change the corresponding CI step in lockstep — the
`devops/cargo-test-parallelism` and `devops/core-crate-test-consistency` spans
exist to flag exactly that coupling.

One deliberate exception: CI's typecheck is a plain `cargo check` step while
local typecheck runs `cargo clippy` (the lint command). CI is cold on every
run, so it has no warm cache whose fingerprints a second invalidation surface
could wipe — the card main-217 motivation for delegation does not apply there —
and both commands share the same `RUSTFLAGS` and `check/` group, so the
rmeta/rlib invariant and fingerprint profile stay uniform. The check group's
*flag profile* is what must never diverge; the subcommand may.

## Maintenance

- `yarn build:clean` — wipe the `git-span/build` tree and rebuild. Honors the
  exclusive lock.
- `cleanup-stale-target.sh` — reconciles the root's freshness stamp (see the
  lifecycle above): records a missing stamp without wiping, wipes the whole
  root when a stale stamp shows the toolchain version, either crate's
  `Cargo.lock`, or either crate's `.cargo/config.toml` changed (cargo's own
  `cargo clean` only touches the default target dir and would leave these
  subdirectories stale).
- Override the root for isolation (e.g. CI) with `GIT_SPAN_CARGO_TARGET_ROOT`.
