//! Golden fixture capture for the published `--format json` families.
//!
//! The test is `#[ignore]`-marked by design: the normal suite only ever
//! *byte-compares* against `tests/fixtures/json/` (see `json_golden.rs`), so
//! a promotion or renderer change cannot silently rewrite its own contract.
//! Regenerate the fixtures explicitly after an intentional output change:
//!
//! ```text
//! yarn test -- --run-ignored ignored-only json_fixtures
//! ```
//!
//! Determinism is enforced at capture time, not assumed: every scenario
//! runs twice, each time building a **fresh** repo and spawning a fresh
//! binary process (different allocator and HashMap seeds), and the capture
//! refuses to write unless the bytes match. Several of these commands
//! mutate their repo, so a same-repo re-run is not a determinism probe —
//! the scenario is what must reproduce. History's dates and hashes are
//! pinned with explicit-offset `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` on
//! every commit — an offsetless pin would parse in the runner's local
//! timezone and shift the hashes across machines.

use crate::support::TestRepo;

use anyhow::{ensure, Result};
use std::path::Path;

pub(super) const FIXTURE_DIR: &str = "tests/fixtures/json";

/// `git add -A && git commit -m <msg>` with both dates pinned to an
/// explicit-offset epoch so hashes are byte-stable across machines.
fn pinned_commit(repo: &TestRepo, msg: &str) -> Result<String> {
    repo.run_git(["add", "-A"])?;
    repo.run_git_with_env(
        ["commit", "-m", msg],
        &[
            ("GIT_AUTHOR_DATE", "@1720000000 +0000"),
            ("GIT_COMMITTER_DATE", "@1720000000 +0000"),
        ],
    )?;
    repo.head_sha()
}

/// Build the scenario fresh twice and require byte-identical stdout.
/// `scenario` constructs its own repo from scratch each call, so this
/// probes cross-process reproducibility rather than re-run behavior.
fn capture_twice(scenario: impl Fn() -> Result<Vec<u8>>) -> Result<Vec<u8>> {
    let first = scenario()?;
    let second = scenario()?;
    ensure!(
        first == second,
        "capture is not byte-deterministic across fresh processes; \
         refusing to write a fixture that would flake"
    );
    Ok(first)
}

fn write_fixture(name: &str, bytes: &[u8]) -> Result<()> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_DIR);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(name), bytes)?;
    Ok(())
}

/// The conflict-markered span file `resolve` fixtures are built from,
/// mirroring `cli_resolve.rs`'s hand-assembled residue (rk64 tokens that
/// match no real content, so resolution outcomes are fixed).
fn resolve_fixture() -> String {
    "\
<<<<<<< ours
file1.txt#L1-L5 rk64:0123456789abcdef
=======
file1.txt#L1-L5 rk64:fedcba9876543210
file2.txt#L1-L5 rk64:fedcba9876543210
>>>>>>> theirs
"
    .to_string()
}

/// `add --format json` on the seeded repo. The scenario builds a fresh
/// repo per run because `add` mutates the span store.
pub(super) fn mutation_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["add", "m", "file1.txt#L1-L5", "--format", "json"])?;
    ensure!(
        !out.stdout.is_empty() && out.stdout[0] == b'{',
        "add --format json must emit a JSON object"
    );
    Ok(out.stdout)
}

/// `resolve --ours --format json` over hand-assembled residue.
pub(super) fn resolve_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &resolve_fixture())?;
    let out = repo.run_span(["resolve", "m", "--ours", "--format", "json"])?;
    Ok(out.stdout)
}

/// `resolve --dry-run --format json` over the same residue input.
pub(super) fn resolve_dry_run_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &resolve_fixture())?;
    let out = repo.run_span(["resolve", "m", "--dry-run", "--format", "json"])?;
    Ok(out.stdout)
}

/// `context --format json` for a span queried at its own anchor address.
pub(super) fn context_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    ensure!(repo.run_span(["add", "ctx", "file1.txt#L1-L2"])?.status.success());
    let out = repo.run_span(["context", "file1.txt#L1-L2", "--format", "json"])?;
    Ok(out.stdout)
}

/// `history --format json` over pinned-date commits.
pub(super) fn history_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file("file2.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n")?;
    pinned_commit(&repo, "C0: initial files")?;
    ensure!(repo.run_span(["add", "h", "file1.txt#L1-L5"])?.status.success());
    ensure!(repo.run_span(["add", "h", "file2.txt#L1-L3"])?.status.success());
    ensure!(
        repo.run_span(["why", "h", "First why: tracks the two source files."])?
            .status
            .success()
    );
    pinned_commit(&repo, "C1: create span")?;
    repo.write_file("file2.txt", "ALPHA\nBETA\ngamma\ndelta\nepsilon\n")?;
    pinned_commit(&repo, "C2: edit file2 content only")?;
    let out = repo.run_span(["history", "h", "--format", "json"])?;
    ensure!(out.status.success(), "history failed");
    Ok(out.stdout)
}

/// `drift --format json` for a mutated anchor.
pub(super) fn drift_dirty_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    ensure!(repo.run_span(["add", "d", "file1.txt#L1-L5"])?.status.success());
    ensure!(repo.run_span(["why", "d", "seed"])?.status.success());
    {
        repo.run_git(["add", ".span"])?;
        pinned_commit(&repo, "span commit")?;
    }
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    pinned_commit(&repo, "mutate")?;
    let out = repo.run_span(["drift", "d", "--format", "json"])?;
    Ok(out.stdout)
}

/// `drift --format json` for a clean scan — the always-emitted-keys shape.
pub(super) fn drift_clean_scenario() -> Result<Vec<u8>> {
    let repo = TestRepo::seeded()?;
    ensure!(repo.run_span(["add", "d", "file1.txt#L1-L5"])?.status.success());
    ensure!(repo.run_span(["why", "d", "seed"])?.status.success());
    {
        repo.run_git(["add", ".span"])?;
        pinned_commit(&repo, "span commit")?;
    }
    let out = repo.run_span(["drift", "d", "--format", "json"])?;
    Ok(out.stdout)
}

#[test]
#[ignore = "regenerate golden JSON fixtures explicitly; normal suite only compares"]
fn capture_all_families() -> Result<()> {
    write_fixture("mutation.json", &capture_twice(mutation_scenario)?)?;
    write_fixture("resolve.json", &capture_twice(resolve_scenario)?)?;
    write_fixture("resolve-dry-run.json", &capture_twice(resolve_dry_run_scenario)?)?;
    write_fixture("context.json", &capture_twice(context_scenario)?)?;
    write_fixture("history.json", &capture_twice(history_scenario)?)?;
    write_fixture("drift.json", &capture_twice(drift_dirty_scenario)?)?;
    write_fixture("drift-clean.json", &capture_twice(drift_clean_scenario)?)?;
    Ok(())
}
