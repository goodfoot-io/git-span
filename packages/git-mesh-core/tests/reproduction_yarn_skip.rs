//! Reproduction test: Yarn workspace iteration silently skips git-mesh-core.
//!
//! The workspace root's `package.json` declares workspaces via `packages/*`,
//! which causes Yarn to glob-expand `packages/` subdirectories. Since
//! `packages/git-mesh-core` has no `package.json`, Yarn does not recognize it
//! as a workspace member and `yarn workspaces foreach -A run test` never enters
//! the crate.
//!
//! This test always fails, confirming the bug when run directly via
//! `cargo test` in this directory, but remaining invisible to `yarn test`
//! from the workspace root.

#[test]
fn yarn_skips_this_crate() {
    panic!(
        "Yarn workspace iteration never entered git-mesh-core, \
         so this failing test was never executed by `yarn test`. \
         This reproduces the bug: git-mesh-core has no package.json, \
         therefore Yarn silently skips it and the crate's 26+ unit \
         tests and integration tests are never exercised by CI."
    );
}
