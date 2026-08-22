//! `git span` must keep working when the on-disk git index is missing.
//!
//! ## The bug
//!
//! When `$GIT_DIR/index` does not exist, gix synthesizes an in-memory index
//! by recursively walking every tree under `HEAD^{tree}`
//! (`Repository::index_from_tree`). That walk is all-or-nothing: one tree
//! object it cannot read aborts the whole load, and the load sites surfaced
//! that as a generic repository-read failure whose remediation steers users
//! toward `git fsck` and restoring objects from backup. The states that
//! actually produce it are healthy ones: partial clones
//! (`--filter=tree:<n>`, or any clone checked out lazily) routinely hold
//! HEAD's trees only on the promisor remote — real git works there because
//! it fetches promisor objects on demand and never materializes an index
//! from HEAD at all. `git fsck` exits 0 on exactly these repositories, so
//! the repair advice contradicted itself.
//!
//! ## The fix
//!
//! Every index read goes through `git::load_index` /
//! `git::load_index_or_empty`. When gix's from-tree synthesis is the step
//! that failed, the loaders rebuild the same listing with git itself —
//! `git read-tree <HEAD^{tree}>` into a temporary `GIT_INDEX_FILE` — which
//! exercises git's own validation *and* its promisor lazy-fetch, then load
//! the rebuilt file back through gix. The user's real index is never
//! touched. When even git cannot rebuild (unreachable promisor, genuinely
//! damaged store) the error names both halves: the synthesis failure and
//! why `git read-tree` could not repair it.

use crate::support::TestRepo;
use anyhow::Result;
use gix::bstr::ByteSlice;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A repo with a subdirectory tree, a committed span, and no on-disk index.
///
/// Returns the expected `git ls-files -s` listing captured while the index
/// still existed, for parity assertions against whatever loader answers
/// after the file is gone.
fn seeded_repo_missing_index() -> Result<(TestRepo, Vec<String>)> {
    let repo = TestRepo::new()?;
    repo.run_git(["config", "gc.auto", "0"])?;
    repo.write_file("root.txt", "root\n")?;
    repo.write_file("sub/deep.txt", "deep\n")?;
    repo.commit_all("seed files")?;
    repo.span_stdout(["add", "demo", "root.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare span"])?;

    let listing = repo
        .git_stdout(["ls-files", "-s"])?
        .lines()
        .map(str::to_string)
        .collect();

    std::fs::remove_file(repo.path().join(".git/index"))?;
    assert!(
        !repo.path().join(".git/index").exists(),
        "fixture precondition: the on-disk index must be gone"
    );
    Ok((repo, listing))
}

/// The reconstructed index must equal what git itself had listed while the
/// index file existed — mode, oid, stage, and path for every entry.
#[test]
fn rebuilt_index_matches_git_listing() -> Result<()> {
    let (repo, expected) = seeded_repo_missing_index()?;
    let gix_repo = repo.gix_repo()?;

    let loaded = git_span::git::load_index(&gix_repo)?;
    use gix::index::entry::Stage;
    let mut actual: Vec<String> = loaded
        .entries()
        .iter()
        .map(|entry| {
            let stage = match entry.stage() {
                Stage::Unconflicted => 0u32,
                // Stages 1–3 only ever appear mid-merge, which this fixture
                // does not create; render them distinctly so a surprise
                // fails the comparison instead of masquerading as stage 0.
                _ => 1u32,
            };
            format!(
                "{:06o} {} {}\t{}",
                entry.mode.bits(),
                entry.id,
                stage,
                entry.path(&loaded).to_str_lossy()
            )
        })
        .collect();
    actual.sort();
    let mut sorted_expected = expected;
    sorted_expected.sort();

    assert_eq!(
        actual.len(),
        sorted_expected.len(),
        "entry count diverges:\nactual: {actual:#?}\nexpected: {sorted_expected:#?}"
    );
    for (a, e) in actual.iter().zip(sorted_expected.iter()) {
        assert_eq!(a, e, "reconstructed entry diverges from git's listing");
    }
    Ok(())
}

/// With every object local, losing the index file must not change what
/// `git span drift` reports.
#[test]
fn drift_survives_missing_index_when_objects_local() -> Result<()> {
    let control = TestRepo::new()?;
    control.run_git(["config", "gc.auto", "0"])?;
    control.write_file("root.txt", "root\n")?;
    control.write_file("sub/deep.txt", "deep\n")?;
    control.commit_all("seed files")?;
    control.span_stdout(["add", "demo", "root.txt"])?;
    control.run_git(["add", ".span"])?;
    control.run_git(["commit", "-m", "declare span"])?;
    let with_index = control.run_span(["drift"])?;
    assert!(
        with_index.status.success(),
        "control run with an index must succeed"
    );

    let (repo, _listing) = seeded_repo_missing_index()?;
    let without_index = repo.run_span(["drift"])?;
    assert!(
        without_index.status.success(),
        "drift must survive a missing index when HEAD's trees are locally \
         readable; stdout: {}; stderr: {}",
        String::from_utf8_lossy(&without_index.stdout),
        String::from_utf8_lossy(&without_index.stderr),
    );
    assert_eq!(
        String::from_utf8_lossy(&without_index.stdout),
        String::from_utf8_lossy(&with_index.stdout),
        "the missing-index scan must report identically to the control"
    );
    Ok(())
}

/// Fixture for the promisor scenarios: an origin whose HEAD carries a real
/// subtree plus a committed span, cloned with `--no-checkout
/// --filter=tree:0` so the clone holds neither an index nor most of HEAD's
/// trees — the state a lazily-materialized checkout is found in.
struct PartialClone {
    /// Kept alive so the clone's promisor remote stays readable.
    _origin: tempfile::TempDir,
    origin_url: String,
    /// Kept alive so the clone directory outlives the fixture.
    #[allow(dead_code)]
    dir: tempfile::TempDir,
    clone_dir: PathBuf,
}

impl PartialClone {
    fn new(reachable_remote: bool) -> Result<Self> {
        let origin = TestRepo::new()?;
        origin.run_git(["config", "gc.auto", "0"])?;
        origin.run_git(["config", "uploadpack.allowFilter", "true"])?;
        origin.write_file("root.txt", "root\n")?;
        origin.write_file("deep/inner.txt", "inner\n")?;
        origin.commit_all("seed files")?;
        origin.span_stdout(["add", "demo", "root.txt"])?;
        origin.run_git(["add", ".span"])?;
        origin.run_git(["commit", "-m", "declare span"])?;

        let dir = tempfile::tempdir()?;
        let origin_url = format!("file://{}", origin.path().display());
        let mut clone = Command::new("git");
        clone
            .arg("clone")
            .arg("--quiet")
            .arg("--no-checkout")
            .arg("--filter=tree:0")
            .arg(&origin_url)
            .arg(dir.path().join("clone"));
        let out = clone.output()?;
        anyhow::ensure!(
            out.status.success(),
            "partial clone failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let clone_dir = dir.path().join("clone");

        if !reachable_remote {
            // Repoint the promisor remote at a path that cannot exist, the
            // way a moved or expired CI source looks from inside the clone.
            let config = std::fs::read_to_string(clone_dir.join(".git/config"))?;
            let broken = config.replace(&origin_url, "file:///nonexistent-nowhere");
            std::fs::write(clone_dir.join(".git/config"), broken)?;
        }

        assert!(
            !clone_dir.join(".git/index").exists(),
            "fixture precondition: --no-checkout leaves no index file"
        );
        Ok(Self {
            _origin: origin.dir,
            origin_url,
            dir,
            clone_dir,
        })
    }

    fn path(&self) -> &Path {
        &self.clone_dir
    }

    #[allow(dead_code)]
    fn url(&self) -> &str {
        &self.origin_url
    }
}

fn run_drift_in(dir: &Path) -> Result<std::process::Output> {
    Ok(Command::new(env!("CARGO_BIN_EXE_git-span"))
        .arg("drift")
        .current_dir(dir)
        .output()?)
}

/// In a partial clone holding none of HEAD's trees locally but served by a
/// reachable promisor remote, `drift` must recover: the rebuild asks git,
/// and git lazily fetches what it needs — the same operation `git status`
/// performs in this state. The user's own index file stays absent; nothing
/// writes into the repository as a side effect of scanning.
#[test]
fn reconstruction_lazily_fetches_promisor_trees() -> Result<()> {
    let fixture = PartialClone::new(/* reachable_remote */ true)?;

    let out = run_drift_in(fixture.path())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "drift must recover when git can materialize the missing trees; \
         stdout: {stdout}; stderr: {stderr}"
    );
    assert!(
        !fixture.path().join(".git/index").exists(),
        "scanning must not write an index file into the user's repository"
    );
    Ok(())
}

/// When the promisor remote is unreachable AND no index exists, the scan
/// still fails closed — real git fails in the same state — but the error
/// must name what actually happened: no index file exists and the rebuild
/// through git failed too. It must not leave the operator with only gix's
/// internal "Could not create index from tree" line to decode while `git
/// fsck` reports a perfectly healthy repository.
#[test]
fn unrecoverable_state_names_both_failures() -> Result<()> {
    let fixture = PartialClone::new(/* reachable_remote */ false)?;

    let out = run_drift_in(fixture.path())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "an unreachable promisor with no index must fail closed; \
         stdout: {stdout}; stderr: {stderr}"
    );
    assert!(
        stdout.is_empty(),
        "nothing may be rendered on a failed scan; got: {stdout}"
    );
    assert!(
        stderr.contains("git span drift: span state could not be resolved."),
        "the curated resolver shape must lead; got: {stderr}"
    );
    assert!(
        stderr.contains("read-tree"),
        "the failure must say the git-backed rebuild was attempted; got: {stderr}"
    );
    Ok(())
}

/// An unborn HEAD keeps its exact historical failure: the loaders only
/// divert gix's *from-tree synthesis* failures, never its unborn-HEAD
/// errors, so `add`'s curated "failed to read the git index" guidance is
/// untouched.
#[test]
fn unborn_head_failure_text_unchanged() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.txt", "hello\n")?;
    let out = repo.run_span(["add", "demo", "a.txt"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success());
    assert!(
        stderr.contains("failed to read the git index."),
        "curated add summary must be unchanged; got: {stderr}"
    );
    assert!(
        stderr.contains("does not have any commits"),
        "underlying unborn-HEAD cause must be unchanged; got: {stderr}"
    );
    assert!(
        !stderr.contains("read-tree"),
        "no rebuild may be attempted for an unborn HEAD; got: {stderr}"
    );
    Ok(())
}
