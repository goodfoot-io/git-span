//! Card main-220 regression: every `yarn validate` in this monorepo recompiles
//! the full 236-crate Rust test graph (~2m20s) despite a warm shared cargo
//! cache. A validation following another validation (or any sibling-worktree
//! activity) with no Rust source changes must reuse the test-profile cache
//! (nextest build phase in seconds); instead cargo rebuilds every crate.
//!
//! Root cause (confirmed by main-218 for the sibling-worktree span-store
//! rebuilds and by the main-220 probes for this test graph): Cargo 1.97 hashes
//! the *resolved* `[target.*].linker` value into every unit's fingerprint. The
//! package-local [.cargo/config.toml](./.cargo/config.toml) pins
//! `linker = "scripts/cc.mold-wrapper.sh"` — a *relative* path. Cargo resolves
//! it against the config's directory, so a cargo run from worktree A hashes
//! `…/A/packages/git-span/scripts/cc.mold-wrapper.sh` and a run from sibling
//! worktree B hashes `…/B/…`. The hashes differ, every unit built from the
//! other directory goes `dirty: ConfigSettingsChanged`, and the whole graph
//! recompiles — even though the shared target root at
//! `/var/cache/git-span/cargo-target` already holds every rlib. A bare-name
//! linker (`linker = "cc.mold-wrapper"`) resolved via PATH hashes identically
//! from every worktree, which is the fix shape.
//!
//! The test drives the exact divergence: two byte-identical mini-crates at
//! distinct absolute paths (`<temp>/a/packages/git-span` and
//! `<temp>/b/packages/git-span`), each with a VERBATIM copy of the package's
//! `.cargo/config.toml` plus its linker wrapper script, built into one shared
//! `CARGO_TARGET_DIR`. A worktree-invariant linker config makes the second
//! build fresh; the current relative-path config flips it to recompile, and
//! the assertion on the second build's output fails with that output embedded
//! in the message.
//!
//! Two probe constraints are baked in: (1) the config must be copied VERBATIM —
//! a config containing ONLY the linker key does not flip, so the test must
//! reproduce the full combination (target-dir, incremental dev/test profiles,
//! `[env]`, and both target sections) exactly as shipped; (2) the wrapper
//! script must exist at the resolved relative location in each crate, since
//! the relative linker is executed as a path, not looked up on PATH.
//!
//! Linux-only: the linker keys only apply to the Linux GNU targets
//! (`x86_64-unknown-linux-gnu` / `aarch64-unknown-linux-gnu`) in the config.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use crate::support;

/// Monorepo root: `packages/git-span` (CARGO_MANIFEST_DIR) → `packages` → root.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

/// Lay out a mini bin crate at `root` mirroring the repo's package shape:
/// `packages/git-span/{Cargo.toml,src/main.rs,.cargo/config.toml,scripts/cc.mold-wrapper.sh}`.
/// The config and wrapper are copied VERBATIM from the repo.
fn write_mini_crate(root: &Path, repo: &Path) {
    let pkg = root.join("packages/git-span");
    fs::create_dir_all(pkg.join("src")).expect("mkdir src");
    fs::create_dir_all(pkg.join(".cargo")).expect("mkdir .cargo");
    fs::create_dir_all(pkg.join("scripts")).expect("mkdir scripts");
    fs::write(
        pkg.join("Cargo.toml"),
        "[package]\nname = \"cargo-config-probe\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write Cargo.toml");
    fs::write(pkg.join("src/main.rs"), "fn main() {}\n").expect("write main.rs");
    fs::copy(
        repo.join("packages/git-span/.cargo/config.toml"),
        pkg.join(".cargo/config.toml"),
    )
    .expect("copy config verbatim");
    fs::copy(
        repo.join("packages/git-span/scripts/cc.mold-wrapper.sh"),
        pkg.join("scripts/cc.mold-wrapper.sh"),
    )
    .expect("copy linker wrapper");
    support::make_executable(&pkg.join("scripts/cc.mold-wrapper.sh")).expect("make wrapper executable");
}

/// `cargo build` from `cwd` into the shared `target_dir`, with `path` (a
/// directory containing the wrapper under a bare name, as the fix shape
/// requires) prepended to PATH and any CARGO_LOG noise removed. Returns the
/// captured output with stderr folded into stdout so "Compiling"/"Finished"
/// lines are found regardless of which stream cargo writes them to.
fn cargo_build(cwd: &Path, target_dir: &Path, path: &str) -> Output {
    let existing = std::env::var("PATH").unwrap_or_default();
    let out = Command::new("cargo")
        .current_dir(cwd)
        .env("CARGO_TARGET_DIR", target_dir)
        .env("PATH", format!("{path}:{existing}"))
        .env_remove("CARGO_LOG")
        .args(["build", "--color", "never"])
        .output()
        .expect("spawn cargo build");
    Output {
        status: out.status,
        stdout: [&out.stdout[..], &out.stderr[..]].concat(),
        stderr: Vec::new(),
    }
}

#[test]
#[cfg(target_os = "linux")]
fn cargo_config_linker_worktree_invariance() {
    let repo = repo_root();
    assert!(
        repo.join("packages/git-span/.cargo/config.toml").exists(),
        "probe source config missing at {}",
        repo.join("packages/git-span/.cargo/config.toml").display()
    );

    // Two byte-identical crates at distinct absolute paths, one shared target
    // dir, one shared wrapper-bin dir. `tempdir()` keeps every path under a
    // single parent that is cleaned up on exit.
    let temp = tempfile::tempdir().expect("tempdir");
    let a = temp.path().join("a");
    let b = temp.path().join("b");
    let target = temp.path().join("target");
    let wrapper_bin = temp.path().join("bin");
    fs::create_dir_all(&wrapper_bin).expect("mkdir wrapper bin");
    write_mini_crate(&a, &repo);
    write_mini_crate(&b, &repo);
    // The fix shape: the wrapper also exists under a bare name on a shared
    // PATH directory (not used by the current config, but part of the shape
    // the fixed config resolves to).
    let bare = wrapper_bin.join("cc.mold-wrapper");
    fs::copy(repo.join("packages/git-span/scripts/cc.mold-wrapper.sh"), &bare).expect("copy bare wrapper");
    support::make_executable(&bare).expect("make bare wrapper executable");
    let path = wrapper_bin.to_string_lossy().into_owned();

    // Build from A, then from B. With a worktree-invariant linker config the
    // second build is a pure cache hit; with the shipped relative-path linker
    // it is fingerprinted against a different absolute path and recompiles.
    let first = cargo_build(&a.join("packages/git-span"), &target, &path);
    assert!(
        first.status.success(),
        "first build (dir a) must succeed; exit {:?}\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stdout)
    );
    let first_out = String::from_utf8_lossy(&first.stdout).into_owned();
    assert!(
        first_out.contains("Compiling"),
        "first build must compile the probe crate (sanity); output:\n{first_out}"
    );

    let second = cargo_build(&b.join("packages/git-span"), &target, &path);
    assert!(
        second.status.success(),
        "second build (dir b) must succeed; exit {:?}\n{}",
        second.status.code(),
        String::from_utf8_lossy(&second.stdout)
    );
    let second_out = String::from_utf8_lossy(&second.stdout).into_owned();

    assert!(
        second_out.contains("Finished"),
        "second build must reach the Finished line; output:\n{second_out}"
    );
    assert!(
        !second_out.contains("Compiling"),
        "second build from a different directory recompiled the probe crate \
         despite byte-identical sources and a warm shared target dir: the \
         relative [target.*].linker path \
         (scripts/cc.mold-wrapper.sh) resolves to a per-directory absolute \
         path, so Cargo 1.97 hashes a worktree-divergent linker into every \
         unit fingerprint (dirty: ConfigSettingsChanged) and rebuilds the \
         graph — the main-220 regression. A bare-name linker resolved via a \
         shared PATH entry hashes identically everywhere.\n\
         --- first build (dir a) ---\n{first_out}\n\
         --- second build (dir b) ---\n{second_out}"
    );
}
