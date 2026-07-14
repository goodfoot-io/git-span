//! Card main-157, Phase 0 reproduction: `notes/investigation-question-log.md`
//! Step 3, "Is cache-on byte-identical in a simple dirty state?", and
//! `notes/benchmark-evidence.md`'s "Real Workspace Cache Matrix".
//!
//! Dirtying ONLY the root `.gitignore` in a clone of the real workspace
//! (which naturally carries organic committed drift across many spans —
//! source files drift out from under their anchors over ordinary
//! development) makes cache-on output diverge from the TRUE cache-off
//! ground truth (both `GIT_SPAN_CACHE=0` AND `GIT_SPAN_CACHE_V2=0` — the
//! repaired Phase 0 oracle; see `TestRepo`-equivalent env handling below).
//! Several already-committed-drifted findings lose their " in the working
//! tree" qualifier and report as plain "changed" instead of "changed in the
//! working tree" once cache-on renders them via the dirty-overlay path's
//! `committed_only` baseline.
//!
//! This mirrors the real-workspace finding exactly: dirtying only
//! `.gitignore` flipped several committed-stale anchors from `changed in the
//! working tree` to `changed`, and it reproduces for BOTH a cold cache-on
//! run (fresh cache) and a warm cache-on run — repeated cache-on output is
//! stable and therefore looks "correct" on its own; only a true both-tiers-
//! disabled oracle catches the divergence.
//!
//! This is a KNOWN, NOT-YET-FIXED bug. Phase 0 is measurement-surface repair
//! only (no `resolver/cache` or `resolver/cache_v2` changes); a later
//! phase's new store closes this gap (see `plans/initial.md` Phase 5's
//! dirty exit gate, "this is the gate that formally closes the `.gitignore`
//! divergence bug"). The test is `#[ignore]`d so it documents the failure
//! without breaking `yarn test` — unignore it once a phase fixes the
//! divergence.
//!
//! Uses a real (not synthetic) clone of the workspace because the
//! divergence depends on the real corpus's organic committed drift; a
//! hand-built minimal repository with one deliberately-drifted span did NOT
//! reproduce it (the single-span `committed_only` normalization already
//! covers that narrow case) — only the shape of a real, larger, evolving
//! corpus does.

use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");

/// Walk up from `CARGO_MANIFEST_DIR` to find the root that contains `.span/`
/// — mirrors `benches/real_corpus.rs`'s `find_workspace_root`.
fn find_workspace_root() -> Option<PathBuf> {
    let start = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    Path::new(&start)
        .ancestors()
        .find(|p| p.join(".span").is_dir())
        .map(|p| p.to_path_buf())
}

/// Clone the workspace into a temp dir. `None` if there's no `.span/` to
/// find (test then skips rather than failing on an unrelated environment).
fn clone_workspace() -> Option<(tempfile::TempDir, PathBuf)> {
    let workspace_root = find_workspace_root()?;
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let src = workspace_root.to_str().expect("workspace root is UTF-8");
    let dst = tmp.path().to_str().expect("tmp path is UTF-8");

    let status = Command::new("git")
        .args(["clone", "--local", src, dst])
        .status()
        .expect("spawn git clone");
    if !status.success() {
        let status2 = Command::new("git")
            .args(["clone", "--no-hardlinks", src, dst])
            .status()
            .expect("spawn git clone --no-hardlinks");
        assert!(status2.success(), "git clone --no-hardlinks failed");
    }
    let path = tmp.path().to_path_buf();
    Some((tmp, path))
}

fn run_span(repo: &Path, args: &[&str], cache_off: bool) -> String {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).args(args);
    if cache_off {
        // The repaired Phase 0 oracle: disable EVERY currently-existing
        // persistent cache tier, not just `GIT_SPAN_CACHE_V2` — see
        // `benches/real_corpus.rs::run_oracle`.
        cmd.env("GIT_SPAN_CACHE", "0");
        cmd.env("GIT_SPAN_CACHE_V2", "0");
    }
    let out = cmd.output().unwrap_or_else(|e| panic!("spawn git-span {args:?}: {e}"));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn delete_cache(repo: &Path) {
    let db = repo.join(".git").join("span").join("stale-cache.db");
    for suffix in ["", "-wal", "-shm"] {
        let p = PathBuf::from(format!("{}{suffix}", db.display()));
        let _ = fs::remove_file(&p);
    }
    let fs_dir = repo.join(".git").join("span").join("cache");
    let _ = fs::remove_dir_all(&fs_dir);
}

/// Reproduces the `.gitignore`-only-dirty divergence against a real clone of
/// the workspace corpus. Marked `#[ignore]` — this documents a known,
/// not-yet-fixed bug (card main-157); a later phase's new store must make
/// this pass. Run explicitly with `cargo test -- --ignored
/// gitignore_dirty_cache_divergence`.
#[test]
#[ignore = "known bug (card main-157): cache-on drops \" in the working tree\" \
            on already-committed-drifted spans when only .gitignore is \
            dirty; fixed by a later phase's new store, not Phase 0 \
            (measurement-surface repair only)"]
fn dirty_gitignore_only_matches_cache_off() -> Result<()> {
    let Some((_tmp, repo)) = clone_workspace() else {
        eprintln!("[gitignore_dirty_cache_divergence] SKIP: no .span/ found");
        return Ok(());
    };
    Command::new("git")
        .current_dir(&repo)
        .args(["config", "user.email", "bench@example.com"])
        .status()
        .expect("git config user.email");
    Command::new("git")
        .current_dir(&repo)
        .args(["config", "user.name", "bench"])
        .status()
        .expect("git config user.name");

    // True cache-off ground truth BEFORE dirtying: establishes the corpus
    // carries organic committed drift to exercise (otherwise this
    // environment doesn't reproduce the bug's precondition).
    delete_cache(&repo);
    let off_clean = run_span(&repo, &["stale", "--no-exit-code"], true);
    assert!(
        !off_clean.trim().is_empty(),
        "workspace clone has no stale findings — cannot exercise the bug \
         (needs organic committed drift)"
    );

    // Dirty ONLY the root .gitignore.
    let gitignore = repo.join(".gitignore");
    let mut contents = fs::read_to_string(&gitignore).unwrap_or_default();
    contents.push_str("*.tmp\n");
    fs::write(&gitignore, contents).expect("dirty .gitignore");

    delete_cache(&repo);
    let ground_truth = run_span(&repo, &["stale", "--no-exit-code"], true);
    assert!(
        ground_truth.contains("changed in the working tree"),
        "ground truth has no \" in the working tree\" findings after \
         dirtying .gitignore — bug precondition not exercised:\n{ground_truth}"
    );

    delete_cache(&repo);
    let cache_on_cold = run_span(&repo, &["stale", "--no-exit-code"], false);
    let cache_on_warm = run_span(&repo, &["stale", "--no-exit-code"], false);

    assert_eq!(
        cache_on_cold, ground_truth,
        "cold cache-on diverged from the true (both-tiers-disabled) cache-off \
         ground truth after dirtying only .gitignore"
    );
    assert_eq!(
        cache_on_warm, ground_truth,
        "warm cache-on diverged from the true (both-tiers-disabled) cache-off \
         ground truth after dirtying only .gitignore"
    );
    Ok(())
}
