//! Reproduction test: `git span stale` must emit
//! `ContentUnavailable(PromisorMissing)` when a blob referenced by an anchor
//! cannot be read from the local object store and promisor files are present,
//! rather than misclassifying the anchor as `Deleted` or `Changed`.
//!
//! ## The bug
//!
//! `UnavailableReason::PromisorMissing` is defined in `types.rs` (line 135)
//! and fully supported through the cache DTO, drift-label rendering, stale
//! output (human, JSON, porcelain), and `--ignore-unavailable` filtering.
//! However, **no code path ever constructs this variant.** The resolver in
//! `anchor.rs` calls `git::read_git_text()` through several `.unwrap_or_default()`
//! chain links; when the underlying `gix::Repository::find_object()` fails
//! (object not in the local store — as in a `--filter=blob:none` partial clone
//! where the blob was never fetched), the error is silently swallowed and empty
//! bytes are returned instead. The empty-content comparison then falls through
//! to the `current_lines.len() < anchored_start` branch at line 883, which
//! classifies the anchor as `Deleted` — even though the only problem is that
//! the blob hasn't been fetched from the promisor remote.
//!
//! The `promisor_active()` detection in `cache_v2/mod.rs` (line 979) checks
//! for the presence of `$GIT_DIR/objects/info/promisor*` files and uses that
//! as part of the cache-availability hash. But this check is only used for
//! **cache invalidation**, never during anchor resolution. The resolver
//! itself has no awareness of promisor status and doesn't inspect the object
//! store for fetchability.
//!
//! ## Expected fix locus
//!
//! In `anchor.rs`, after `git::read_git_text()` (or `blob_data`) fails and
//! returns a `Result::Err`, the error path should check whether promisor
//! files are present (via `promisor_active()` from `cache_v2/mod.rs` or
//! equivalent logic) before falling back to empty bytes. When promisor
//! markers are detected, the failure should produce
//! `AnchorStatus::ContentUnavailable(UnavailableReason::PromisorMissing)`.
//!
//! The promisor check needs to be accessible from the resolver engine;
//! currently it lives in the cache module. The relevant call sites are:
//! - `anchor.rs` line ~527: `git::read_git_text(repo, o).unwrap_or_default()`
//! - `anchor.rs` line ~554: `git::read_git_text(repo, &oid).unwrap_or_default()`
//! - `anchor.rs` line ~655: `.unwrap_or_default()` on HEAD blob reads
//!
//! ## Test design
//!
//! 1. Create a git repo with a file and a span anchored to it.
//! 2. Commit the file and the span, write the commit-graph.
//! 3. Find the blob OID of the anchored file and delete its loose object
//!    from `objects/XX/XXXX…` to simulate a missing promisor blob.
//! 4. Create a `objects/info/promisor-pack` marker file so the repo appears
//!    as a partial clone to `promisor_active()`.
//! 5. Resolve the span with `EngineOptions::committed_only()` (HEAD-layer
//!    only, bypassing the worktree file that still exists on disk).
//! 6. Assert the anchor status is `ContentUnavailable(PromisorMissing)`.
//!
//! This test **MUST FAIL** against the current unfixed code, which reports
//! `Deleted` (via the empty-content branch at `anchor.rs` line 883) because
//! the blob read error is silently swallowed by `.unwrap_or_default()`.

use crate::support;
use anyhow::Result;
use git_span::types::{AnchorStatus, EngineOptions, UnavailableReason};
use git_span::resolve_span;
use support::TestRepo;

#[test]
fn promisor_missing_blob_misclassified_as_deleted() -> Result<()> {
    let repo = TestRepo::new()?;

    // Prevent git from auto-packing loose objects into pack files
    // (packed objects cannot be individually deleted).
    repo.run_git(["config", "gc.auto", "0"])?;

    // Create a file and commit it as the anchor target.
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("initial commit")?;

    // Set up a span pointing to file1.txt.
    repo.span_stdout(["add", "test-span", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "test-span", "-m", "promisor reproduction test"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    repo.write_commit_graph()?;

    // Sanity: the span file and anchored file exist in the worktree.
    assert!(
        repo.path().join(".span/test-span").exists(),
        ".span/test-span must exist in the worktree"
    );
    assert!(
        repo.path().join("file1.txt").exists(),
        "file1.txt must exist in the worktree"
    );

    // Get the blob OID of file1.txt.  In a freshly committed repo with
    // gc.auto=0 this is always stored as a loose object at
    // `.git/objects/{first2}/{rest}`.
    let blob_oid = repo.git_stdout(["hash-object", "file1.txt"])?;
    let first_two: &str = &blob_oid[..2];
    let rest: &str = &blob_oid[2..];
    let blob_path = repo
        .path()
        .join(".git")
        .join("objects")
        .join(first_two)
        .join(rest);

    // Verify the blob is a loose object (not inside a pack).
    assert!(
        blob_path.exists(),
        "blob {blob_oid} should exist as a loose object at {blob_path:?}"
    );
    let pack_dir = repo.path().join(".git").join("objects").join("pack");
    let has_packs = pack_dir.exists()
        && std::fs::read_dir(&pack_dir)?
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_string_lossy().ends_with(".pack"));
    assert!(
        !has_packs,
        "expected no pack files (gc.auto=0 prevents packing)"
    );

    // --- Simulate a missing promisor blob ---
    // Delete the loose object file so gix::Repository::find_object() fails.
    std::fs::remove_file(&blob_path)?;
    assert!(!blob_path.exists(), "blob object should have been deleted");

    // Create the promisor marker file that `git::promisor_active()` looks
    // for (`objects/info/` entries starting with "promisor") and that a
    // real partial clone would have.  The marker signals that the object
    // store is incomplete by design (partial clone), not corrupted.
    let info_dir = repo.path().join(".git").join("objects").join("info");
    if !info_dir.exists() {
        std::fs::create_dir_all(&info_dir)?;
    }
    std::fs::write(info_dir.join("promisor-pack"), "")?;
    assert!(
        info_dir.join("promisor-pack").exists(),
        "promisor marker file should exist"
    );

    // --- Resolve the anchor via the library API ---
    // Use EngineOptions::committed_only() (HEAD layer only) so the resolver
    // reads the blob from the git object database through read_git_text(),
    // not from the worktree file on disk (which still exists and would mask
    // the bug).
    let gix = repo.gix_repo()?;
    let resolved = resolve_span(
        &gix,
        ".span",
        "test-span",
        EngineOptions::committed_only(),
    )?;

    assert!(
        !resolved.anchors.is_empty(),
        "expected at least one resolved anchor"
    );

    let status = &resolved.anchors[0].status;

    // === THIS ASSERTION MUST FAIL against the current unfixed code ===
    //
    // The bug: `git::read_git_text()` returns `Err` (the blob is not in the
    // object store), but `.unwrap_or_default()` on lines 527/554/655 of
    // `anchor.rs` silently converts that into an empty string.  The empty
    // content then lands on the `current_lines.len() < anchored_start`
    // branch at line 883, which classifies the anchor as `Deleted` instead of
    // `ContentUnavailable(PromisorMissing)`.
    assert_eq!(
        *status,
        AnchorStatus::ContentUnavailable(UnavailableReason::PromisorMissing),
        "BUG: missing promisor blob should report ContentUnavailable(PromisorMissing), \
         not {status:?}. This test MUST FAIL until the resolver detects \
         missing promisor objects during blob reads.",
    );

    Ok(())
}
