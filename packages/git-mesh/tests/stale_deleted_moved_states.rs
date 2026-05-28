//! Regression tests for F2/F4/F7 of the tracked-file-storage evaluation.
//!
//! - F2: `git mesh stale` works on an ordinary repo with no commit-graph.
//! - F4: a removed anchored path/range classifies as `Deleted`; content
//!   relocated verbatim (different path or shifted range) classifies as
//!   `Moved`; both are distinct from `Changed`, across whole-file and
//!   line anchors and the worktree + index layers.
//! - F7: `git mesh stale --stat` lists only stale anchors and the
//!   heading count/wording matches the listed rows.

mod support;

use anyhow::Result;
use git_mesh::types::{AnchorStatus, EngineOptions};
use git_mesh::{resolve_mesh, stale_meshes};
use support::TestRepo;

fn full_opts() -> EngineOptions {
    EngineOptions::full()
}

/// F2: a plain `git init` + `git add` + `git commit` repo has no
/// commit-graph. `stale` must still succeed (no plumbing instruction as a
/// fatal error).
#[test]
fn stale_succeeds_without_commit_graph() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "charge", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "charge", "-m", "charge flow"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh charge"])?;

    // No `git commit-graph write` here — ordinary repo state.
    assert!(
        !repo.path().join(".git/objects/info/commit-graph").exists(),
        "test precondition: no commit-graph file"
    );

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "charge", EngineOptions::committed_only())?;
    assert_eq!(resolved.anchors.len(), 1);
    assert_eq!(resolved.anchors[0].status, AnchorStatus::Fresh);

    // Full scan path too (the headline command).
    let _ = stale_meshes(&gix, ".mesh", full_opts())?;

    // And via the CLI binary, including --patch / --stat.
    for args in [
        vec!["stale"],
        vec!["stale", "--patch"],
        vec!["stale", "--stat"],
    ] {
        let out = repo.run_mesh(args.clone())?;
        assert!(
            out.status.success(),
            "`git mesh {args:?}` failed on a no-commit-graph repo: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(())
}

/// F4(b): `git rm` (staged, uncommitted) of an anchored whole-file path
/// must read as a deletion ("deleted in the index"), never "changed".
#[test]
fn whole_file_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "wf", "api/charge.ts"])?;
    repo.run_mesh(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.mesh_stdout(["stale", "wf", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored whole-file path must read as a deletion, \
         not 'changed'; stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b): committed deletion of an anchored whole-file path → `Deleted`
/// (renders "deleted"; the path no longer resolves at HEAD).
#[test]
fn whole_file_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "wf", "api/charge.ts"])?;
    repo.run_mesh(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored whole-file path must be Deleted"
    );
    Ok(())
}

/// F4(b'): `git rm` (staged, uncommitted) of an anchored line-range path
/// must read as a deletion, never "changed".
#[test]
fn line_range_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.mesh_stdout(["stale", "lr", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored line-range path must read as a deletion; \
         stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b'): committed deletion of an anchored line-range path → `Deleted`.
#[test]
fn line_range_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored line-range path must be Deleted"
    );
    Ok(())
}

/// F4(c): verbatim-relocate anchored whole-file content to a new path and
/// delete the original → `Moved` (stored content hash exists at the new
/// path).
#[test]
fn whole_file_content_relocated_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "wf", "api/charge.ts"])?;
    repo.run_mesh(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh wf"])?;

    // Verbatim copy to a new path, remove the original (worktree+index).
    repo.write_file("api/billing.ts", "alpha\nbeta\ngamma\n")?;
    repo.run_git(["add", "api/billing.ts"])?;
    repo.run_git(["rm", "api/charge.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "verbatim-relocated whole-file content must classify as Moved"
    );
    let cur = resolved.anchors[0]
        .current
        .as_ref()
        .expect("Moved carries a current location");
    assert_eq!(cur.path, std::path::PathBuf::from("api/billing.ts"));
    Ok(())
}

/// F4(d): prepend lines so the anchored extent shifts down within the same
/// file → `Moved` (stored content hash found at a shifted range).
#[test]
fn line_range_shifted_extent_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "anchor-a\nanchor-b\nanchor-c\ntail\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh lr"])?;

    // Prepend two lines: the anchored slice now lives at L3-L5.
    repo.write_file(
        "api/charge.ts",
        "new-1\nnew-2\nanchor-a\nanchor-b\nanchor-c\ntail\n",
    )?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "prepended lines shifting the anchored extent must classify as Moved"
    );
    Ok(())
}

/// F4: index-layer relocation. Stage a `git mv` (relocation lives in the
/// index, not yet committed) → `Moved` against the index layer.
#[test]
fn whole_file_relocated_in_index_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "x1\nx2\nx3\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "wf", "api/charge.ts"])?;
    repo.run_mesh(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh wf"])?;

    // Staged relocation: removed from the index/worktree at the old path,
    // present verbatim at the new path.
    repo.run_git(["mv", "api/charge.ts", "api/billing.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_mesh(&gix, ".mesh", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "staged-relocation verbatim content must classify as Moved"
    );
    Ok(())
}

/// F7: `--stat` on a mesh where only one of two anchors drifted must list
/// only the stale anchor, and the heading count/wording must match.
#[test]
fn stat_lists_only_stale_anchors() -> Result<()> {
    let repo = TestRepo::new()?;
    // Two LINE anchors in the SAME file; only the second range drifts.
    // This is the experience-evaluator's exact `m/mix` repro.
    repo.write_file("f.ts", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "m/mix", "f.ts#L1-L1"])?;
    repo.run_mesh(["add", "m/mix", "f.ts#L3-L4"])?;
    repo.run_mesh(["why", "m/mix", "-m", "mixed anchors"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh m/mix"])?;

    // Edit only lines 3-4; f.ts#L1-L1 stays Fresh.
    repo.write_file("f.ts", "l1\nl2\nL3X\nL4X\nl5\n")?;

    // Run twice: the first invocation is a cold resolve; the second hits
    // the cache_v2 baseline, which persists only non-`Fresh` finding rows
    // (so the cached `MeshResolved` carries only the stale anchor). The
    // heading must read "1 of 2" on BOTH runs — the bug was the cached
    // path falsely saying "All anchors … are stale".
    for run in ["cold", "cached"] {
        let out = repo.run_mesh(["stale", "--stat", "m/mix"])?;
        let text = String::from_utf8_lossy(&out.stdout);

        assert!(
            !text.contains("All anchors"),
            "[{run}] only one of two anchors is stale; must not say 'All anchors': {text}"
        );
        assert!(
            text.contains("1 of 2 anchors in m/mix are stale:"),
            "[{run}] heading must report '1 of 2 anchors in m/mix are stale:': {text}"
        );
        assert!(
            text.contains("f.ts#L3-L4"),
            "[{run}] stale anchor f.ts#L3-L4 must be listed: {text}"
        );
        assert!(
            !text.contains("f.ts#L1-L1"),
            "[{run}] fresh anchor f.ts#L1-L1 must NOT be listed under --stat: {text}"
        );
        assert!(
            !text.contains("+0 -0"),
            "[{run}] no fresh `+0 -0` rows under --stat: {text}"
        );
    }
    Ok(())
}

/// F7 (all-stale): when every anchor in a mesh is stale, `--stat` heading
/// reads "All anchors in <mesh> are stale:" (not a count fraction).
#[test]
fn stat_heading_all_stale() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "b1\nb2\nb3\nb4\nb5\n")?;
    repo.commit_all("seed")?;
    repo.run_mesh(["add", "all", "a.txt#L1-L3", "b.txt#L1-L3"])?;
    repo.run_mesh(["why", "all", "-m", "two anchors both stale"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh all"])?;

    // Drift both anchored slices.
    repo.write_file("a.txt", "CHANGED\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "CHANGED\nb2\nb3\nb4\nb5\n")?;

    // Cold + cached: the "All anchors" branch must hold on both paths.
    for run in ["cold", "cached"] {
        let out = repo.run_mesh(["stale", "--stat", "all"])?;
        let text = String::from_utf8_lossy(&out.stdout);

        assert!(
            text.contains("All anchors in all are stale:"),
            "[{run}] all-stale mesh must say 'All anchors in all are stale:': {text}"
        );
        assert!(
            !text.contains("of 2 anchors"),
            "[{run}] all-stale mesh must not use 'N of M' heading: {text}"
        );
        assert!(
            text.contains("a.txt"),
            "[{run}] stale anchor a.txt must be listed: {text}"
        );
        assert!(
            text.contains("b.txt"),
            "[{run}] stale anchor b.txt must be listed: {text}"
        );
    }
    Ok(())
}
