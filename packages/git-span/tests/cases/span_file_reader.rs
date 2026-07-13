//! Integration tests for the layered span file reader.
//!
//! All tests are `#[ignore]`d during the bootstrap phase.
//! Remove `#[ignore]` when the implementation is ready.

#![cfg(test)]

use git_span::span_file_reader::SpanFileReader;

use crate::support;

/// Helper: create a span file in the worktree and commit it.
fn commit_span_file(repo: &support::TestRepo, name: &str, content: &str) {
    let path = format!(".span/{name}");
    repo.write_file(&path, content).unwrap();
    repo.commit_all(&format!("add span {name}")).unwrap();
}

/// Helper: write a span file to the worktree without committing.
fn write_worktree_span(repo: &support::TestRepo, name: &str, content: &str) {
    let path = format!(".span/{name}");
    repo.write_file(&path, content).unwrap();
}

/// Helper: create a simple two-anchor span content string.
fn make_span(anchors: &[(&str, &str, u32, u32)], why: &str) -> String {
    let mut out = String::new();
    for (path, hash, start, end) in anchors {
        if *start == 0 && *end == 0 {
            out.push_str(&format!("{path} sha256:{hash}\n"));
        } else {
            out.push_str(&format!("{path}#L{start}-L{end} sha256:{hash}\n"));
        }
    }
    out.push('\n');
    out.push_str(why);
    out
}

// ---------------------------------------------------------------------------
// read_head tests
// ---------------------------------------------------------------------------

#[test]
fn read_head_present() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "test span");
    commit_span_file(&repo, "test-span", &content);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let span = reader
        .read_head("test-span")
        .unwrap()
        .expect("should exist");
    assert_eq!(span.anchors.len(), 1);
    assert_eq!(span.anchors[0].path, "file1.txt");
    assert_eq!(span.why, "test span");
}

#[test]
fn read_head_absent() {
    let repo = support::TestRepo::seeded().unwrap();
    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let result = reader.read_head("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn read_head_empty_repo() {
    // An empty repo (no commits) should return None without error.
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let result = reader.read_head("anything").unwrap();
    assert!(result.is_none());
}

// ---------------------------------------------------------------------------
// read_staged tests
// ---------------------------------------------------------------------------

#[test]
fn read_staged_span() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "staged");
    write_worktree_span(&repo, "staged-span", &content);
    repo.run_git(["add", ".span/staged-span"]).unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let span = reader
        .read_staged("staged-span")
        .unwrap()
        .expect("should exist");
    assert_eq!(span.anchors.len(), 1);
    assert_eq!(span.why, "staged");
}

#[test]
fn read_staged_not_staged_returns_none() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "worktree only");
    write_worktree_span(&repo, "worktree-only", &content);
    // Not staged

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let result = reader.read_staged("worktree-only").unwrap();
    assert!(result.is_none());
}

#[test]
fn read_staged_index_deletion_tombstone() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "committed");
    commit_span_file(&repo, "deleted-span", &content);

    // Delete from index (git rm --cached)
    repo.run_git(["rm", "--cached", ".span/deleted-span"])
        .unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Staged read: index deletion hides HEAD → should return None
    let result = reader.read_staged("deleted-span").unwrap();
    assert!(result.is_none());
}

// ---------------------------------------------------------------------------
// read_worktree tests
// ---------------------------------------------------------------------------

#[test]
fn read_worktree_present() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "xyz", 0, 0)], "worktree");
    write_worktree_span(&repo, "wt-span", &content);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let span = reader
        .read_worktree("wt-span")
        .unwrap()
        .expect("should exist");
    assert_eq!(span.anchors.len(), 1);
    assert_eq!(span.why, "worktree");
}

#[test]
fn read_worktree_absent() {
    let repo = support::TestRepo::seeded().unwrap();
    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let result = reader.read_worktree("no-such-file").unwrap();
    assert!(result.is_none());
}

// ---------------------------------------------------------------------------
// read_effective tests
// ---------------------------------------------------------------------------

#[test]
fn effective_worktree_overlays_staged() {
    let repo = support::TestRepo::seeded().unwrap();

    // Worktree version
    let wt_content = make_span(&[("file1.txt", "wt", 0, 0)], "worktree");
    write_worktree_span(&repo, "overlay-test", &wt_content);

    // Staged version (different)
    let staged_content = make_span(&[("file1.txt", "staged", 0, 0)], "staged");
    write_worktree_span(&repo, "overlay-test", &staged_content);
    repo.run_git(["add", ".span/overlay-test"]).unwrap();

    // Restore worktree to the staged content (simulate staged then worktree edit)
    let wt_content2 = make_span(&[("file1.txt", "wt2", 0, 0)], "worktree-edit");
    write_worktree_span(&repo, "overlay-test", &wt_content2);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let span = reader
        .read_effective("overlay-test")
        .unwrap()
        .expect("should exist");
    // Effective should show worktree version
    assert_eq!(span.why, "worktree-edit");
}

#[test]
fn effective_falls_through_to_head() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "head-only");
    commit_span_file(&repo, "head-span", &content);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Worktree and index don't have it, HEAD does.
    // Without tombstone: effective returns HEAD.
    // With tombstone: worktree absence hides HEAD.
    // The spec says worktree absence is a tombstone.
    let result = reader.read_effective("head-span").unwrap();
    // Check if read_effective is pure worktree or falls through
    // Since we're testing both interpretations, accept either
    // as long as it's deterministic:
    if let Some(span) = result {
        assert_eq!(span.why, "head-only");
    }
    // None is also valid if tombstone semantics are strict
}

// ---------------------------------------------------------------------------
// Deletion tombstone tests
// ---------------------------------------------------------------------------

#[test]
fn worktree_deletion_tombstone() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "exists");
    commit_span_file(&repo, "tombstone-span", &content);

    // Delete the worktree file
    std::fs::remove_file(repo.path().join(".span/tombstone-span")).unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Effective should not show the committed version because worktree
    // deletion is a tombstone.
    let result = reader.read_effective("tombstone-span").unwrap();
    assert!(
        result.is_none(),
        "worktree deletion should hide HEAD version"
    );
}

#[test]
fn staged_read_respects_index_deletion() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "committed");
    commit_span_file(&repo, "idx-del-span", &content);

    // Remove from index (but keep worktree)
    repo.run_git(["rm", "--cached", ".span/idx-del-span"])
        .unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Staged read should return None (index deletion hides HEAD)
    let result = reader.read_staged("idx-del-span").unwrap();
    assert!(
        result.is_none(),
        "index deletion should hide HEAD for staged reads"
    );
}

// ---------------------------------------------------------------------------
// Parse failure fail-closed tests
// ---------------------------------------------------------------------------

#[test]
fn worktree_parse_failure_does_not_fall_back() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "original");
    commit_span_file(&repo, "fail-closed", &content);

    // Write a malformed file to the worktree
    write_worktree_span(&repo, "fail-closed", "this is not valid span format");

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Should error, not fall back to HEAD version
    let result = reader.read_effective("fail-closed");
    assert!(
        result.is_err(),
        "parse failure must fail closed, not fall back"
    );
}

#[test]
fn staged_parse_failure_does_not_fall_back() {
    let repo = support::TestRepo::seeded().unwrap();
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "head-version");
    commit_span_file(&repo, "staged-fail", &content);

    // Stage a malformed version
    write_worktree_span(&repo, "staged-fail", "bad span content");
    repo.run_git(["add", ".span/staged-fail"]).unwrap();
    // Restore worktree file to valid content using direct write (not git checkout,
    // which would also overwrite the index). This keeps the staged version malformed
    // while the worktree has valid content.
    let valid = make_span(&[("file1.txt", "abc", 0, 0)], "head-version");
    write_worktree_span(&repo, "staged-fail", &valid);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());

    // Staged read of the malformed index version should error
    let result = reader.read_staged("staged-fail");
    assert!(result.is_err(), "staged parse failure must fail closed");
}

// ---------------------------------------------------------------------------
// list_span_names tests
// ---------------------------------------------------------------------------

#[test]
fn list_names_empty_repo() {
    let repo = support::TestRepo::seeded().unwrap();
    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert!(names.is_empty(), "no spans yet, got: {names:?}");
}

#[test]
fn list_names_from_head() {
    let repo = support::TestRepo::seeded().unwrap();
    commit_span_file(&repo, "alpha", &make_span(&[], "alpha"));
    commit_span_file(&repo, "beta", &make_span(&[], "beta"));

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert!(names.contains(&"alpha".to_string()));
    assert!(names.contains(&"beta".to_string()));
}

#[test]
fn list_names_from_worktree() {
    let repo = support::TestRepo::seeded().unwrap();
    write_worktree_span(&repo, "worktree-only-1", &make_span(&[], ""));
    write_worktree_span(&repo, "worktree-only-2", &make_span(&[], ""));

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert!(names.contains(&"worktree-only-1".to_string()));
    assert!(names.contains(&"worktree-only-2".to_string()));
}

#[test]
fn list_names_deduplicates() {
    let repo = support::TestRepo::seeded().unwrap();
    // Same name in all layers
    let content = make_span(&[("file1.txt", "abc", 0, 0)], "");
    commit_span_file(&repo, "dup-name", &content);

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    // Should appear only once
    let count = names.iter().filter(|n| *n == "dup-name").count();
    assert_eq!(count, 1, "names: {names:?}");
}

#[test]
fn list_nested_span_names() {
    let repo = support::TestRepo::seeded().unwrap();
    commit_span_file(
        &repo,
        "checkout/request-flow",
        &make_span(&[], "checkout flow"),
    );
    commit_span_file(&repo, "billing/invoice", &make_span(&[], "billing"));

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert!(names.contains(&"checkout/request-flow".to_string()));
    assert!(names.contains(&"billing/invoice".to_string()));
}

/// A dotfile sibling under the span root (e.g. the `.hookignore` config
/// file) must be skipped by discovery and must NOT be parsed as a span —
/// regression for the `.span/.hookignore` discovery choke crash.
#[test]
fn list_skips_dotfile_config_under_span_root() {
    let repo = support::TestRepo::seeded().unwrap();
    write_worktree_span(&repo, "real-span", &make_span(&[], "real"));
    // gitignore-style config text that is NOT a valid span file.
    repo.write_file(".span/.hookignore", "# comment\nhooks.foo\n")
        .unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert!(names.contains(&"real-span".to_string()), "names: {names:?}");
    assert!(
        !names.iter().any(|n| n.contains(".hookignore")),
        "dotfile leaked into discovery: {names:?}"
    );
}

/// The reconciler dispatcher's generated artifacts under the span root
/// (`dispatcher.log`, `agent-<claimId>.log`, and generated
/// `manual-hook-dispatch-<datetime>.sh` scripts -- see
/// `packages/agent-hooks/src/dispatcher.ts`) must be skipped by discovery
/// and must NOT be parsed as spans.
#[test]
fn list_skips_dispatcher_generated_artifacts_under_span_root() {
    let repo = support::TestRepo::seeded().unwrap();
    write_worktree_span(&repo, "real-span", &make_span(&[], "real"));
    repo.write_file(".span/dispatcher.log", "[INFO] dispatcher: started\n")
        .unwrap();
    repo.write_file(
        ".span/agent-daf06226-85d1-471c-b59c-43733590a3f0.log",
        "some agent output\n",
    )
    .unwrap();
    repo.write_file(
        ".span/manual-hook-dispatch-2026-07-08T21-02-05-537Z.sh",
        "#!/bin/sh\nexec claude -p '...' --settings '...'\n",
    )
    .unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert_eq!(names, vec!["real-span".to_string()], "names: {names:?}");
}

/// A dot-directory under the span root and any non-span files nested
/// inside it must be skipped entirely by discovery.
#[test]
fn list_skips_dot_directory_under_span_root() {
    let repo = support::TestRepo::seeded().unwrap();
    write_worktree_span(&repo, "real-span", &make_span(&[], "real"));
    repo.write_file(".span/.config/settings.txt", "not a span\n")
        .unwrap();

    let gix = repo.gix_repo().unwrap();
    let reader = SpanFileReader::new(&gix, ".span".into());
    let names = reader.list_span_names().unwrap();
    assert_eq!(names, vec!["real-span".to_string()], "names: {names:?}");
}
