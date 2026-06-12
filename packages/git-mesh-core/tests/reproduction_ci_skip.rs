//! Reproduction: CI never runs git-mesh-core's test suite.
//!
//! ## Hypothesis
//!
//! CI's `build-cli` job (`.github/workflows/ci.yml` lines 37-47) runs every Rust
//! command from within `packages/git-mesh` only.  It never enters
//! `packages/git-mesh-core`, so core's 30+ unit tests and integration tests are
//! invisible to CI.
//!
//! ## Reproduction mechanism
//!
//! 1. This test unconditionally panics when executed locally:
//!
//!    ```text
//!    $ cd packages/git-mesh-core
//!    $ cargo test reproduction_ci_skip
//!    ---- tests::reproduction_ci_skip::ci_never_runs_git_mesh_core_tests stdout ----
//!    thread 'tests::reproduction_ci_skip::ci_never_runs_git_mesh_core_tests' panicked at ...
//!    ```
//!
//! 2. CI never runs this test because the `build-cli` job's steps are all
//!    scoped to `packages/git-mesh`:
//!
//!    | ci.yml line | Step              | Working directory          |
//!    |-------------|-------------------|----------------------------|
//!    | 37-38       | `Cargo check`     | `cd packages/git-mesh && …` |
//!    | 40-41       | `Cargo clippy`    | `cd packages/git-mesh && …` |
//!    | 43-44       | `Cargo test`      | `cd packages/git-mesh && …` |
//!    | 46-47       | `Cargo build`     | `cd packages/git-mesh && …` |
//!
//!    No step ever runs `cd packages/git-mesh-core && cargo test`.
//!
//! 3. Result: **Green CI despite broken core code.** A regression that breaks
//!    every test in git-mesh-core would pass CI without a single warning.
//!
//! ## Proof that the gap is real
//!
//! The local test suite at the time of writing:
//!
//! - **30+ unit tests** in `packages/git-mesh-core/src/lib.rs` (all annotated
//!   with `#[test]` across ~740 lines of test modules)
//! - **1 integration test file** (`tests/scan_non_canonical.rs`) with 8 test
//!   functions covering non-canonical content-hash input handling
//! - **1 benchmark** (`benches/scan.rs`) via Criterion
//!
//! All of these are exercised by `cargo test` inside git-mesh-core and none of
//! them is exercised by `cargo test` inside git-mesh.

/// Unconditionally fails to demonstrate that CI never runs this crate's tests.
///
/// If CI ran `cargo test` inside `packages/git-mesh-core`, this panic would
/// turn CI red.  Because CI never enters this directory, CI stays green — even
/// though every test in the crate could be broken.
#[test]
fn ci_never_runs_git_mesh_core_tests() {
    panic!(
        "CI SKIP GAP: This test ran locally but would never run in CI. \
         The `build-cli` job in .github/workflows/ci.yml lines 37-47 \
         only enters `packages/git-mesh`.  No step enters \
         `packages/git-mesh-core`, so this crate's entire test suite \
         (30+ unit tests + 8 integration tests + benchmarks) is invisible \
         to CI.  See the file-level doc comment for full details."
    );
}
