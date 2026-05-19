//! Render-output behaviors for the advice CLI `read` verb: it surfaces
//! mesh partners on first hit (only for meshes whose creating commit was
//! published during the active session), dedupes via `meshes-seen.jsonl`
//! on the second hit, and isolates the seen set across distinct sessions.
//!
//! File-backed model: meshes are tracked `.mesh/<name>` files seeded via
//! `create_and_commit_mesh`. Same-session scoping still uses the
//! OID-baseline diff (`mark`/`diff` before and after the commit), so the
//! baseline/observe dance is preserved.

mod support;

use anyhow::Result;
use std::process::Output;
use support::{create_and_commit_mesh, TestRepo};
use uuid::Uuid;

fn sid(prefix: &str) -> String {
    format!("slice3-{prefix}-{}", Uuid::new_v4())
}

fn run_advice(repo: &TestRepo, session: &str, extra: &[&str]) -> Result<Output> {
    let mut args: Vec<String> = vec!["advice".into(), session.into()];
    for a in extra {
        args.push((*a).into());
    }
    repo.run_mesh(args)
}

fn ok(out: &Output) {
    assert!(
        out.status.success(),
        "expected success, code={:?} stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Establish a fresh baseline: mark+diff with no meshes yet.
fn establish_baseline(repo: &TestRepo, session: &str) -> Result<()> {
    ok(&run_advice(repo, session, &["mark", "baseline"])?);
    ok(&run_advice(repo, session, &["diff", "baseline"])?);
    Ok(())
}

/// Observe new mesh refs: mark+diff to capture against baseline.
fn observe_new_mesh(repo: &TestRepo, session: &str) -> Result<()> {
    ok(&run_advice(repo, session, &["mark", "obs"])?);
    ok(&run_advice(repo, session, &["diff", "obs"])?);
    Ok(())
}

#[test]
fn read_intersects_mesh_surfaces_partner() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    let s = sid("partner");

    establish_baseline(&repo, &s)?;
    create_and_commit_mesh(
        &gix,
        "m1",
        &[("file1.txt", 1, 5), ("file2.txt", 1, 5)],
        "two-file partnership",
    )?;
    observe_new_mesh(&repo, &s)?;

    let out = run_advice(&repo, &s, &["read", "file1.txt#L1-L5"])?;
    ok(&out);
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.contains("is in the `m1` mesh with:") && stdout.contains("two-file partnership"),
        "expected mesh why, got:\n{stdout}"
    );
    assert!(
        stdout.contains("- `file2.txt#L1-L5`"),
        "expected partner mention, got:\n{stdout}"
    );
    for line in stdout.lines() {
        assert!(!line.starts_with("# "), "line is `# `-prefixed: {line:?}");
    }
    Ok(())
}

#[test]
fn second_read_of_same_path_dedupes_via_meshes_seen() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    let s = sid("dedup-same");

    establish_baseline(&repo, &s)?;
    create_and_commit_mesh(
        &gix,
        "dd",
        &[("file1.txt", 1, 5), ("file2.txt", 1, 5)],
        "dedup",
    )?;
    observe_new_mesh(&repo, &s)?;

    let first = run_advice(&repo, &s, &["read", "file1.txt#L1-L5"])?;
    ok(&first);
    let first_out = String::from_utf8(first.stdout)?;
    assert!(!first_out.is_empty(), "first read should produce output");

    let second = run_advice(&repo, &s, &["read", "file1.txt#L1-L5"])?;
    ok(&second);
    assert!(
        second.stdout.is_empty(),
        "second read of same path within session must dedupe via meshes-seen, got:\n{}",
        String::from_utf8_lossy(&second.stdout)
    );
    Ok(())
}

#[test]
fn read_of_partner_path_does_not_resurface_already_seen_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    let s = sid("new-trigger");

    establish_baseline(&repo, &s)?;
    create_and_commit_mesh(
        &gix,
        "dd2",
        &[("file1.txt", 1, 5), ("file2.txt", 1, 5)],
        "new-trigger",
    )?;
    observe_new_mesh(&repo, &s)?;

    let _ = run_advice(&repo, &s, &["read", "file1.txt#L1-L5"])?;

    let out = run_advice(&repo, &s, &["read", "file2.txt#L1-L5"])?;
    ok(&out);
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.is_empty(),
        "mesh already seen this session must not re-surface; got:\n{stdout}"
    );
    Ok(())
}

#[test]
fn read_with_no_meshes_renders_silent() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let s = sid("empty");
    establish_baseline(&repo, &s)?;
    repo.write_file("empty-target.txt", "x\n")?;
    let out = run_advice(&repo, &s, &["read", "empty-target.txt"])?;
    ok(&out);
    assert!(out.stdout.is_empty(), "no meshes → silent render");
    Ok(())
}

#[test]
fn isolated_sessions_do_not_share_seen_set() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;

    let s1 = sid("iso-a");
    let s2 = sid("iso-b");

    establish_baseline(&repo, &s1)?;
    establish_baseline(&repo, &s2)?;

    create_and_commit_mesh(
        &gix,
        "iso",
        &[("file1.txt", 1, 5), ("file2.txt", 1, 5)],
        "isolation",
    )?;

    observe_new_mesh(&repo, &s1)?;
    observe_new_mesh(&repo, &s2)?;

    let a1 = run_advice(&repo, &s1, &["read", "file1.txt#L1-L5"])?;
    ok(&a1);
    assert!(
        !a1.stdout.is_empty(),
        "session A first read produces output"
    );

    let b1 = run_advice(&repo, &s2, &["read", "file1.txt#L1-L5"])?;
    ok(&b1);
    assert!(
        !b1.stdout.is_empty(),
        "session B should see fresh output despite A's prior render"
    );
    Ok(())
}
