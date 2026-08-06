<cargo>
Cargo build artifacts are written to a **shared per-user directory** at
`/var/cache/git-span/cargo-target/<crate>/<group>/`, where `<crate>` is `git-span` or
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
`/var/cache/git-span/cargo-target/.target.lock` (via
`packages/git-span/scripts/with-target-lock.sh`), and anything that deletes from the
shared root (`clean-shared-build.sh`, the freshness-stamp wipe in
`cleanup-stale-target.sh`) takes the *exclusive* lock. A `yarn build:clean` in one
worktree therefore waits for in-flight builds in sibling worktrees instead of deleting
artifacts out from under them. Worktrees checked out at commits predating this lock do
not participate in it — avoid running their `build:clean` while another worktree builds.
</cargo>