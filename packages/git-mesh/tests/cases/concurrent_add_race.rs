//! Reproduction test for the read-modify-write race in `run_add`:
//! concurrent `git mesh add` invocations on the same mesh silently lose
//! anchors.
//!
//! The race window spans `read_worktree_mesh` -> `write_worktree_mesh`
//! (~75 lines of code from L466 to L541: anchor processing, content
//! hashing, record management). Two threads calling `run_add` concurrently
//! against the same mesh name, each adding a different anchor, read the
//! same starting mesh content, both mutate independently in memory, and
//! the slower write silently overwrites the faster.
//!
//! Test strategy:
//! 1. Seed a mesh with one anchor so it exists on disk.
//! 2. Launch two threads, each adding a different second anchor.
//! 3. After both threads complete, read the mesh back and assert all
//!    three anchors are present.
//!
//! The current (unfixed) code will frequently produce only 2 anchors:
//! both threads read {A}, thread A writes {A, B}, thread B writes {A, C}
//! (B's write is based on the same stale starting state {A}, so it
//! overwrites thread A's addition).
//!
//! Note: we intentionally do NOT use a Barrier here. A Barrier that
//! releases both threads simultaneously causes them to collide inside
//! `write_worktree_mesh` on the shared temp-file name (`.race.tmp`),
//! which is a *separate* concurrency defect (missing unique temp names).
//! Without a barrier, the read-modify-write race still manifests because
//! both threads perform their reads at roughly the same time early in
//! `run_add`, then independently process and write.

use crate::support;

use anyhow::Result;
use git_mesh::cli::commit::run_add;
use git_mesh::cli::AddArgs;
use support::TestRepo;

#[test]
fn concurrent_add_race_loses_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Seed the mesh with a first anchor so the .mesh/<name> file exists
    // on disk before either worker thread tries to read it.
    repo.mesh_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    let repo_path = repo.path().to_path_buf();

    // Worker 1: adds file1.txt#L6-L10 to the same mesh.
    let rp1 = repo_path.clone();
    let t1 = std::thread::spawn(move || -> Result<()> {
        let gix_repo = gix::open(&rp1)?;
        let args = AddArgs {
            name: "test/race".into(),
            anchors: vec!["file1.txt#L6-L10".into()],
            at: None,
        };
        run_add(&gix_repo, args, ".mesh")?;
        Ok(())
    });

    // Worker 2: adds file2.txt#L1-L5 to the same mesh.
    let rp2 = repo_path.clone();
    let t2 = std::thread::spawn(move || -> Result<()> {
        let gix_repo = gix::open(&rp2)?;
        let args = AddArgs {
            name: "test/race".into(),
            anchors: vec!["file2.txt#L1-L5".into()],
            at: None,
        };
        run_add(&gix_repo, args, ".mesh")?;
        Ok(())
    });

    // Wait for both workers to complete.
    let r1 = t1.join().unwrap();
    let r2 = t2.join().unwrap();

    // If we hit the temp-file-name collision between the two threads'
    // `write_worktree_mesh` calls, one thread will fail with ENOENT.
    // That is itself a concurrency bug (the temp file should be unique
    // per writer), but it's a *different* bug than the silent lost-update
    // race this test targets. When that happens, re-run the test — high
    // probability the timing lines up and the read-modify-write race
    // manifests (lost anchors) instead of the temp-file collision.
    //
    // If both failed, something is fundamentally broken.
    if r1.is_err() && r2.is_err() {
        return Err(anyhow::anyhow!(
            "both threads failed — not the expected race; \
             r1: {:?}, r2: {:?}",
            r1,
            r2
        ));
    }

    // If exactly one thread failed with an ENOENT from the temp-file
    // collision, the other thread's anchors must still all be present.
    // The surviving thread's write is the one that landed — the temp-file
    // collision prevented the other from even reaching the write, which
    // means this run exercises the temp-file bug, not the lost-update bug.
    // That's still a valid failure (we assert the test fails), but the
    // error message will reflect the temp-file collision rather than the
    // lost-update race.
    //
    // The assert below checks that all expected anchors survived
    // *regardless* of which thread(s) wrote. If both threads contributed
    // (no temp-file collision and no lost-update), we have 3 anchors.
    // If one thread hit the temp-file collision, the other's write
    // landed and we'll have 2 anchors (seed + that thread's add).
    // If both threads wrote but the slower overwrote the faster
    // (lost-update race), we'll also have 2 anchors.
    //
    // Only 3 anchors (both threads' adds survived) means the test passed —
    // which must not happen against the unfixed code without a lock.

    let mesh_content = std::fs::read_to_string(repo.path().join(".mesh/test/race"))
        .expect("mesh file must exist after at least one successful add");
    let mesh = git_mesh::mesh_file::MeshFile::parse(&mesh_content)?;

    let anchor_paths: Vec<String> = mesh
        .anchors
        .iter()
        .map(|a| format!("{}#L{}-L{}", a.path, a.start_line, a.end_line))
        .collect();

    // We expect this assertion to fail against the unfixed code because:
    // - Both threads read from the same starting state (seed anchor only)
    // - Both independently add their anchor
    // - The slower write overwrites the faster → only 2 anchors survive
    //
    // If the temp-file collision occurred (one thread's rename consumed
    // the other's temp file), we also get 2 anchors (or fewer), which
    // also fails this assertion — correctly identifying that concurrency
    // is broken.
    assert_eq!(
        mesh.anchors.len(),
        3,
        "Concurrent run_add lost work: expected 3 anchors but found {}.\n\
         Mesh content:\n{}\n\
         Anchors present:\n\
         {}\n\
         r1: {:?}\n\
         r2: {:?}",
        mesh.anchors.len(),
        mesh_content,
        anchor_paths.join("\n"),
        r1,
        r2,
    );

    Ok(())
}
