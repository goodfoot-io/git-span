//! Cross-OS span portability: anchor paths must persist in the canonical
//! POSIX, forward-slash, repo-relative form regardless of the separator the
//! author typed, so a span created on one OS resolves on the other.
//!
//! "Both directions":
//!  - Linux-authored (forward slash) — the canonical form — round-trips and
//!    resolves (this is what a Windows checkout reads).
//!  - Windows-authored (backslash) — normalized on write to forward slash —
//!    round-trips and resolves (this is what a Linux checkout reads).
//!
//! The git tree/index is forward-slash on every platform; a stored backslash
//! path would fail to resolve everywhere, so normalization is required at the
//! write boundary. In the file-backed model that boundary is
//! `span_file::parse_address` (via `normalize_anchor_path`), exercised here
//! through the real `git span add` binary.

use crate::support;

use anyhow::Result;
use git_span::read_span;
use git_span::resolve_span;
use git_span::types::{AnchorStatus, EngineOptions};
use support::TestRepo;

/// Seed a repo with a nested file so the separator actually matters
/// (`sub/dir/file.txt`), committed at HEAD.
fn seeded_nested() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("sub/dir/file.txt", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed nested file")?;
    Ok(repo)
}

/// `git span add <name> <addr>` then commit the `.span/<name>` file with
/// ordinary git, mirroring the post-add commit flow.
fn add_and_commit(repo: &TestRepo, name: &str, addr: &str) -> Result<()> {
    let out = repo.run_span(["add", name, addr])?;
    anyhow::ensure!(
        out.status.success(),
        "git span add {addr} failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", &format!("span: {name}")])?;
    Ok(())
}

/// The single stored anchor path for `span`, read back through the
/// layered file reader.
fn stored_path(repo: &TestRepo, span: &str) -> Result<String> {
    let m = read_span(&repo.gix_repo()?, span)?;
    assert_eq!(m.anchors.len(), 1, "expected exactly one anchor");
    Ok(m.anchors[0].1.path.clone())
}

fn only_status(repo: &TestRepo, span: &str) -> Result<AnchorStatus> {
    // The layered engine requires a commit-graph (with changed-path bloom
    // filters); write it after all commits (file + span file) exist.
    repo.write_commit_graph()?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", span, EngineOptions::full())?;
    assert_eq!(mr.anchors.len(), 1, "expected exactly one resolved anchor");
    Ok(mr.anchors[0].status.clone())
}

/// Direction 1: forward-slash (Linux-authored / canonical) line anchor.
/// Stored verbatim and resolves Fresh.
#[test]
fn forward_slash_line_anchor_round_trips_and_resolves() -> Result<()> {
    let repo = seeded_nested()?;
    add_and_commit(&repo, "fwd", "sub/dir/file.txt#L1-L3")?;

    assert_eq!(stored_path(&repo, "fwd")?, "sub/dir/file.txt");
    assert_eq!(only_status(&repo, "fwd")?, AnchorStatus::Fresh);
    Ok(())
}

/// Direction 2: backslash (Windows-authored) line anchor must be normalized
/// to forward slash on write — never persisted with a backslash — and must
/// resolve against the forward-slash git tree.
#[test]
fn backslash_line_anchor_is_normalized_and_resolves() -> Result<()> {
    let repo = seeded_nested()?;
    add_and_commit(&repo, "bwd", "sub\\dir\\file.txt#L1-L3")?;

    let stored = stored_path(&repo, "bwd")?;
    assert!(
        !stored.contains('\\'),
        "stored anchor path must not contain a backslash, got `{stored}`"
    );
    assert_eq!(stored, "sub/dir/file.txt");
    assert_eq!(only_status(&repo, "bwd")?, AnchorStatus::Fresh);
    Ok(())
}

/// Both separator spellings must converge on the identical stored anchor so
/// the same logical anchor is portable across OSes (and last-write-wins /
/// supersede keys match).
#[test]
fn both_separators_produce_identical_canonical_storage() -> Result<()> {
    let repo = seeded_nested()?;
    add_and_commit(&repo, "fwd", "sub/dir/file.txt#L2-L4")?;
    add_and_commit(&repo, "bwd", "sub\\dir\\file.txt#L2-L4")?;

    assert_eq!(stored_path(&repo, "fwd")?, stored_path(&repo, "bwd")?);
    assert_eq!(only_status(&repo, "fwd")?, AnchorStatus::Fresh);
    assert_eq!(only_status(&repo, "bwd")?, AnchorStatus::Fresh);
    Ok(())
}

/// Whole-file anchors travel the same `parse_address` boundary, so a
/// backslash-authored whole-file pin is normalized and resolves too.
#[test]
fn backslash_whole_file_anchor_is_normalized_and_resolves() -> Result<()> {
    let repo = seeded_nested()?;
    add_and_commit(&repo, "whole", "sub\\dir\\file.txt")?;

    assert_eq!(stored_path(&repo, "whole")?, "sub/dir/file.txt");
    assert_eq!(only_status(&repo, "whole")?, AnchorStatus::Fresh);
    Ok(())
}
