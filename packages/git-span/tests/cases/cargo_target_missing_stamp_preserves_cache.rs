//! Card main-220 regression: a `yarn build:clean` from *any* worktree wipes
//! the entire shared cargo target root even when nothing changed.
//!
//! The shared root (`$GIT_SPAN_CARGO_TARGET_ROOT`, default
//! `/var/cache/git-span/cargo-target`) is served by every scripted cargo
//! task in all 30+ sibling card worktrees, and
//! `scripts/cleanup-stale-target.sh` (the `build:clean` step) owns its
//! invalidation: it stamps the root with a freshness fingerprint built from
//! both crates' lockfiles, the rustc version, and both `.cargo/config.toml`
//! hashes, and wipes every top-level directory when the stamp is missing or
//! stale.
//!
//! The bug: the script *only writes* the stamp inside the wipe path. The
//! stamp file is absent on the shared root (nothing has ever caused a wipe),
//! so the first `build:clean` after the stamp feature shipped fires the wipe
//! unconditionally — the `[ -f "$stamp_file" ]` guard is never true, so the
//! "nothing changed" short-circuit can never trigger. The wipe discards the
//! fully warm test-profile graph (236 crates of rlibs under
//! `git-span/build/`), forcing the next validation run in every worktree to
//! recompile everything (~2m20s) despite unchanged lockfiles, toolchain, and
//! cargo config.
//!
//! Discrimination: the test runs the real script against a private temp root
//! (never the real `/var/cache/git-span/cargo-target`) that holds fake warm
//! artifacts in the documented layout — `git-span/build/libgit_span.rlib` and
//! `git-span-core/check/libgit_span_core.rmeta` — and deliberately omits
//! `.freshness-stamp`. All freshness inputs (lockfiles, rustc, cargo config)
//! are the unchanged repo ones. A correct script writes the stamp and leaves
//! the artifacts alone; the unfixed script sees "stamp missing", wipes both
//! top-level directories, and the artifact assertions fail with the script's
//! `WIPE ... missing removing ...` stderr line in the message. The exclusive
//! target-root lock (via `scripts/with-target-lock.sh`) is taken on the temp
//! root's own `.target.lock`, so this is fully isolated from the real shared
//! root — the tripwire is disabled (`GIT_SPAN_FINGERPRINT_TRIPWIRE=0`) to
//! keep the lock wrapper a plain pass-through.

use std::path::PathBuf;
use std::process::Command;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

#[cfg(unix)]
#[test]
fn cargo_target_missing_stamp_preserves_cache() {
    let tmp = tempfile::tempdir().expect("tempdir for private target root");
    let target_root = tmp.path();

    // Warm artifacts in the documented shared-root layout (see
    // scripts/cargo-build-system.md): codegen rlibs under build/, rmeta-only
    // artifacts under check/. No .freshness-stamp — the regression scenario.
    let build_rlib = target_root.join("git-span/build/libgit_span.rlib");
    let check_rmeta = target_root.join("git-span-core/check/libgit_span_core.rmeta");
    std::fs::create_dir_all(build_rlib.parent().unwrap()).expect("create build dir");
    std::fs::create_dir_all(check_rmeta.parent().unwrap()).expect("create check dir");
    std::fs::write(&build_rlib, b"warm test-profile artifact").expect("write rlib");
    std::fs::write(&check_rmeta, b"warm check artifact").expect("write rmeta");
    assert!(
        !target_root.join(".freshness-stamp").exists(),
        "precondition: the simulated shared root must start without a freshness stamp"
    );

    // The real script, exactly as `yarn build:clean` invokes it, pointed at
    // the private root. Lockfiles, rustc, and cargo config are all untouched
    // repo inputs — nothing has changed, so nothing may be wiped.
    let script = workspace_root().join("packages/git-span/scripts/cleanup-stale-target.sh");
    let out = Command::new("bash")
        .arg(&script)
        .current_dir(target_root)
        .env("GIT_SPAN_CARGO_TARGET_ROOT", target_root)
        .env("GIT_SPAN_FINGERPRINT_TRIPWIRE", "0")
        .output()
        .expect("spawn cleanup-stale-target.sh");

    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(
        out.status.success(),
        "cleanup-stale-target.sh exited {:?}\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}",
        out.status.code()
    );

    // The wipe must NOT have fired: nothing changed, so the warm artifacts
    // must survive. On the unfixed code the missing stamp bypasses the
    // unchanged-inputs short-circuit and the script `rm -rf`s both top-level
    // directories — the vanished artifact and the script's own WIPE stderr
    // line make the mechanism obvious.
    for artifact in [&build_rlib, &check_rmeta] {
        assert!(
            artifact.exists(),
            "warm artifact {} was wiped by cleanup-stale-target.sh despite no \
             change to lockfiles, toolchain, or cargo config — the missing \
             .freshness-stamp made the script wipe the whole target root \
             unconditionally\n--- script stderr ---\n{stderr}\n--- script stdout ---\n{stdout}",
            artifact.display()
        );
    }

    // And the script must have left a stamp behind so the *next* run has the
    // unchanged-inputs short-circuit to hit.
    let stamp = target_root.join(".freshness-stamp");
    assert!(
        stamp.is_file(),
        "script must record the freshness stamp after a no-op check\n--- script stderr ---\n{stderr}"
    );
}
