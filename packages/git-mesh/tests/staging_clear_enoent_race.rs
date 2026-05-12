//! `clear_staging` must not abort mid-loop when a concurrent unlink
//! removes a snapshot entry before the loop reaches it (main-60-1).
//!
//! [`clear_staging`](../../src/staging.rs) reads the staging directory
//! into a snapshot, then unlinks each matching entry with the `?`
//! operator. On Linux, a concurrent unlink between snapshot and removal
//! makes the second `fs::remove_file` return `ErrorKind::NotFound`; the
//! `?` propagates and every later entry in the snapshot survives as a
//! permanent orphan. The fix is to swallow `NotFound` (the file is
//! already gone — the caller's intent is satisfied) and keep iterating.
//!
//! The race window is too narrow for shell-driven repros to hit
//! reliably, so this test injects a deterministic pause via the
//! `GIT_MESH_TEST_CLEAR_STAGING_PAUSE` env flag and races a direct
//! `fs::remove_file` from a second thread between the `read_dir`
//! snapshot and the first unlink.

mod support;

use anyhow::Result;
use git_mesh::clear_staging;
use std::fs;
use std::thread;
use std::time::Duration;
use support::TestRepo;

#[test]
fn clear_staging_continues_iteration_when_a_snapshot_entry_is_already_gone() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let staging_dir = repo.path().join(".git/mesh/staging");
    fs::create_dir_all(&staging_dir)?;

    // Encoded mesh name is identity for simple ASCII names — see
    // `encode_name_for_fs`. Seed both halves of a sidecar pair so the
    // loop has two matching entries to walk.
    let sidecar = staging_dir.join("m.1");
    let meta = staging_dir.join("m.1.meta");
    fs::write(&sidecar, b"sidecar")?;
    fs::write(&meta, b"meta")?;

    let repo_path = repo.path().to_owned();
    let racer_target = sidecar.clone();

    let clear_thread = thread::spawn(move || -> Result<()> {
        // Safety: env mutation is process-global. The pause is only
        // observed by `clear_staging`; no other thread reads this var.
        unsafe {
            std::env::set_var("GIT_MESH_TEST_CLEAR_STAGING_PAUSE", "1");
        }
        let gix = gix::open(&repo_path)?;
        let result = clear_staging(&gix, "m");
        unsafe {
            std::env::remove_var("GIT_MESH_TEST_CLEAR_STAGING_PAUSE");
        }
        result?;
        Ok(())
    });

    // While `clear_staging` is paused after its `read_dir` snapshot,
    // simulate a concurrent unlink racing in. The remove must happen
    // before the paused thread wakes — sleep for less than the pause.
    thread::sleep(Duration::from_millis(40));
    fs::remove_file(&racer_target)?;

    clear_thread.join().expect("clear thread panicked")?;

    assert!(
        !sidecar.exists(),
        "sidecar `m.1` should be gone (we removed it)",
    );
    assert!(
        !meta.exists(),
        "sidecar meta `m.1.meta` survived because clear_staging aborted on ENOENT — \
         this is the bug: partial cleanup leaves orphans",
    );
    Ok(())
}
