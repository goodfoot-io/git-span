//! Library tests for span read paths (file-backed model, §6.5, §6.6).
//!
//! Spans are tracked `.span/<name>` files; `read_span`/`read_span_at`/
//! `show_span`/`list_span_names` read the layered (worktree/index/HEAD)
//! view. The removed ref-backed commit-metadata APIs (`span_commit_info`,
//! `span_log`, `append_add`, `commit_span`, `set_why`) no longer exist;
//! the suites that exercised them are deleted with this rewrite.

use crate::support;

use anyhow::Result;
use git_span::{list_span_names, read_span, read_span_at, show_span};
use support::{TestRepo, create_and_commit_span};

fn seed_two_spans(repo: &TestRepo) -> Result<()> {
    let gix = repo.gix_repo()?;
    create_and_commit_span(&gix, "alpha", &[("file1.txt", 1, 5)], "alpha init")?;
    create_and_commit_span(&gix, "beta", &[("file2.txt", 2, 6)], "beta init")?;
    Ok(())
}

#[test]
fn list_span_names_is_sorted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_spans(&repo)?;
    let names = list_span_names(&repo.gix_repo()?)?;
    assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);
    Ok(())
}

#[test]
fn list_span_names_empty_repo() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(list_span_names(&repo.gix_repo()?)?.is_empty());
    Ok(())
}

#[test]
fn read_span_returns_effective_state() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_spans(&repo)?;
    let m = read_span(&repo.gix_repo()?, "alpha")?;
    assert_eq!(m.name, "alpha");
    assert_eq!(m.anchors.len(), 1);
    assert!(m.why.contains("alpha init"));
    Ok(())
}

#[test]
fn read_span_missing_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let err = read_span(&repo.gix_repo()?, "ghost").unwrap_err();
    assert!(matches!(err, git_span::Error::SpanNotFound(_)));
    Ok(())
}

#[test]
fn show_span_is_read_span_alias() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_spans(&repo)?;
    let gix = repo.gix_repo()?;
    assert_eq!(show_span(&gix, "alpha")?, read_span(&gix, "alpha")?);
    Ok(())
}

#[test]
fn read_span_at_walks_history() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_span(&gix, "hist", &[("file1.txt", 1, 5)], "v1")?;
    let first = repo.head_sha()?;
    create_and_commit_span(
        &gix,
        "hist",
        &[("file1.txt", 1, 5), ("file2.txt", 3, 7)],
        "v2",
    )?;
    let old = read_span_at(&gix, "hist", Some(&first))?;
    assert_eq!(old.anchors.len(), 1);
    let tip = read_span_at(&gix, "hist", None)?;
    assert_eq!(tip.anchors.len(), 2);
    Ok(())
}

#[test]
fn read_span_at_missing_commitish_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_span(&gix, "h", &[("file1.txt", 1, 5)], "v1")?;
    let head = repo.head_sha()?;
    // Span did not exist at the initial commit (HEAD~1).
    let err = read_span_at(&gix, "h", Some(&format!("{head}~1"))).unwrap_err();
    assert!(matches!(err, git_span::Error::SpanNotFound(_)));
    Ok(())
}

#[test]
fn read_span_at_none_is_effective() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_span(&gix, "h", &[("file1.txt", 1, 5)], "v1")?;
    assert_eq!(read_span_at(&gix, "h", None)?, read_span(&gix, "h")?);
    Ok(())
}
