//! Slice 1 — CLI validation and naming.
//!
//! Each rejection asserts a non-zero exit code and a stderr substring.
//! The positive tests exercise the `<category>/<slug>` and the
//! hierarchical `<category>/<subcategory>/<identifier-slug>` mesh-name
//! forms end to end (add → commit → ls / show / stale).

use crate::support;

use anyhow::Result;
use std::process::Output;
use support::TestRepo;

fn mesh_exists(repo: &TestRepo, name: &str) -> bool {
    git_mesh::list_mesh_names(&repo.gix_repo().unwrap())
        .map(|names| names.contains(&name.to_string()))
        .unwrap_or(false)
}

fn assert_rejected(out: &Output, needle: &str) {
    let code = out.status.code();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "expected non-zero exit, got {code:?}; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains(needle),
        "expected stderr to contain {needle:?}, got:\n{stderr}"
    );
}

fn seeded_with_a_b() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file_lines("a.ts", 10)?;
    repo.write_file_lines("b.ts", 10)?;
    repo.commit_all("init")?;
    Ok(repo)
}

#[test]
fn top_level_help_works_outside_repo() -> Result<()> {
    let tmp = tempfile::tempdir()?;
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
    cmd.current_dir(tmp.path());
    cmd.arg("--help");
    let out = cmd.output()?;
    assert!(out.status.success(), "expected success");
    Ok(())
}

// ------------------------------------------------------------------
// 5. Mesh name `<category>/<slug>` accepted.
// ------------------------------------------------------------------

#[test]
fn category_slash_slug_name_accepted_and_indexed() -> Result<()> {
    let repo = seeded_with_a_b()?;

    let out = repo.run_mesh([
        "add",
        "billing/checkout-request-flow",
        "a.ts#L1-L5",
        "b.ts#L1-L5",
    ])?;
    assert!(
        out.status.success(),
        "stage failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let out = repo.run_mesh([
        "why",
        "billing/checkout-request-flow",
        "-m",
        "Checkout request flow.",
    ])?;
    assert!(out.status.success(), "why failed");

    assert!(
        mesh_exists(&repo, "billing/checkout-request-flow"),
        "expected mesh billing/checkout-request-flow"
    );

    let listed = repo.mesh_stdout(["list", "a.ts"])?;
    assert!(
        listed.contains("billing/checkout-request-flow"),
        "ls output missing the mesh:\n{listed}"
    );

    let shown = repo.mesh_stdout(["show", "billing/checkout-request-flow"])?;
    assert!(
        shown.contains("Checkout request flow"),
        "show output missing why:\n{shown}"
    );

    let stale = repo.run_mesh(["stale", "--format=porcelain"])?;
    assert_ne!(
        stale.status.code(),
        Some(2),
        "stale errored: {}",
        String::from_utf8_lossy(&stale.stderr)
    );

    let listed_b = repo.mesh_stdout(["list", "b.ts"])?;
    assert!(
        listed_b.contains("billing/checkout-request-flow"),
        "file-index missing partner side:\n{listed_b}"
    );

    Ok(())
}

#[test]
fn hierarchical_three_segment_name_accepted_and_indexed() -> Result<()> {
    let repo = seeded_with_a_b()?;

    let name = "billing/payments/checkout-request-flow";
    let out = repo.run_mesh(["add", name, "a.ts#L1-L5", "b.ts#L1-L5"])?;
    assert!(
        out.status.success(),
        "stage failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let out = repo.run_mesh(["why", name, "-m", "Checkout request flow."])?;
    assert!(out.status.success(), "why failed");

    assert!(mesh_exists(&repo, name), "expected mesh `{name}`");

    let listed = repo.mesh_stdout(["list", "a.ts"])?;
    assert!(
        listed.contains(name),
        "ls output missing the hierarchical mesh:\n{listed}"
    );
    Ok(())
}

#[test]
fn rejects_empty_segment_in_name() -> Result<()> {
    let repo = seeded_with_a_b()?;
    let out = repo.run_mesh(["add", "a//c", "a.ts#L1-L5"])?;
    assert_rejected(&out, "empty segment");
    Ok(())
}

#[test]
fn rejects_uppercase_in_name() -> Result<()> {
    let repo = seeded_with_a_b()?;
    let out = repo.run_mesh(["add", "Billing/Flow", "a.ts#L1-L5"])?;
    assert_rejected(&out, "must start with a-z or 0-9");
    Ok(())
}
