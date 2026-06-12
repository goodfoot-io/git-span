# Cargo build system

This document explains how the Rust crates (`packages/git-mesh` and
`packages/git-mesh-core`) are compiled, where build artifacts live, how
concurrent worktrees stay safe, and the one cargo invariant the whole layout
exists to protect. Read it before changing any `cargo` invocation in a
`package.json` script, a `scripts/*.sh` helper, or a CI workflow — those entry
points are deliberately kept identical and a divergence reintroduces the
failures described below.

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
same directory fails to link `git-mesh-core`; keeping the two apart is clean.
Conversely, `check` + `clippy` share a directory cleanly (both rmeta), and
`test` + `build` + `run` share a directory cleanly (all rlib) — verified the
same way. So the minimal correct split is **two groups, not one dir and not
one-dir-per-task.**

## Directory layout

All scripted cargo tasks write under a shared per-user root:

```
${GIT_MESH_CARGO_TARGET_ROOT:-$HOME/.cache/git-mesh/cargo-target}/
├── .target.lock                 # flock coordinating tasks vs. cleanup (all worktrees)
├── .freshness-stamp             # toolchain/lockfile/config fingerprint
├── git-mesh/
│   ├── check/                   # cargo check (typecheck) + cargo clippy (lint)  → rmeta
│   ├── build/                   # cargo nextest + cargo build --release + gen-manpage → rlib
│   └── udeps/                   # cargo +nightly udeps (separate toolchain)
└── git-mesh-core/
    ├── check/                   # cargo check + cargo clippy → rmeta
    └── build/                   # cargo test → rlib
```

Splitting by `<crate>/<output-group>` keeps the rmeta/rlib invariant per crate.
`udeps` is isolated because it runs under the **nightly** toolchain; a different
`rustc` is a different fingerprint and would otherwise thrash the stable
artifacts.

The root is **shared across all worktrees on the machine** — a build started in
one worktree reuses dependency compilation done by a sibling. This is the whole
reason for a per-user root rather than per-worktree `target/` directories.

### Flag consistency within a group

Within each group every invocation uses identical `RUSTFLAGS`, so cargo never
rebuilds dependencies just because flags changed (the "fingerprint thrash"
problem). The `check` group sets `RUSTFLAGS="-W unused -W dead-code"` for both
`check` and `clippy`; the `build` group sets no extra flags. The two groups are
isolated directories, so the flag difference between them costs nothing.

## Serial compilation (`CARGO_BUILD_JOBS=1` / `--build-jobs 1`)

Every scripted cargo invocation pins the compile graph to a single job:
`CARGO_BUILD_JOBS=1` for `check`/`clippy`/`build`/`run`, and `--build-jobs 1`
for `cargo nextest run` (nextest's build phase otherwise defaults to all cores,
ignoring the env var). This is a **correctness** requirement, not a tuning knob.

With default parallelism, sibling `rustc` jobs intermittently abort with
`error[E0463]: can't find crate for <dep>` — and it is a *different* dependency
on each run (`bstr`, `serde`, `rustix`, `prodash`, …). cargo respects the
dependency DAG, so a dependent never *schedules* before its dependency
finishes; the failure is that a just-written `.rlib`/`.rmeta` is not yet visible
to a concurrent reader job when it opens it. The shared target root lives on the
devcontainer's `virtiofs` mount, whose write/read visibility across concurrent
processes is not immediately coherent, which is the most likely trigger. Serial
compilation removes the concurrency and the race with it.

This serialization was removed once (card **main-122**, on the theory that the
per-task directory split plus `test = false` were the whole fix) and the race
returned exactly as that card predicted it might. The directory split fixes the
*rlib/rmeta* race; it does **not** fix this *intra-build parallelism* race.
The two are independent and both mitigations are required.

The cost is real — a 10-core machine compiles one crate at a time. The run
phases stay parallel: `cargo nextest run` executes test binaries concurrently
(only its *build* is serialized), so the tax is compilation wall-clock only.
Serialization is applied in the scripts and CI rather than in
`.cargo/config.toml` so that the release cross-build (`actions-rust-cross`,
bare `cargo build --release` on a non-`virtiofs` runner) keeps full parallelism.

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
`devops/cargo-test-parallelism` and `devops/core-crate-test-consistency` meshes
exist to flag exactly that coupling.

## Maintenance

- `yarn build:clean` — wipe the `git-mesh/build` tree and rebuild. Honors the
  exclusive lock.
- `cleanup-stale-target.sh` — wipes the whole root when the toolchain version,
  either crate's `Cargo.lock`, or either crate's `.cargo/config.toml` changes
  (cargo's own `cargo clean` only touches the default target dir and would leave
  these subdirectories stale).
- Override the root for isolation (e.g. CI) with `GIT_MESH_CARGO_TARGET_ROOT`.
