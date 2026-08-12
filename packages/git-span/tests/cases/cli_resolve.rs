//! CLI: `git span resolve <name>` — settle a conflict-markered span file
//! under one explicitly chosen side.
//!
//! Most fixtures here are built with **no real unmerged index stages**: the
//! text-sourcing path carries anchors and why on its own, so a
//! hand-assembled or driver-generated worktree file is the honest input, and
//! it keeps the bulk of the suite cheap. The index-stage supplement — config
//! recovery, base-aware three-way resolution, hand-edit preservation — gets
//! its own smaller set of tests ([`mid_merge_repo`]) that leave a real `git
//! merge` uncommitted, since that is the only way to exercise it honestly.
//! Any
//! fixture that stands in for real driver output is produced by running
//! `git span merge-driver` itself ([`driver_residue`]) rather than
//! hand-written, because hand-written residue has concealed real defects
//! before. The fixtures that are deliberately *not* driver-shaped — the
//! `[config]`-inside-a-block refusal and the two-blocks-on-one-side refusal —
//! stay hand-written by design: they test what happens when the input is not
//! the writer's own output.

use crate::support;

use anyhow::Result;
use git_span_core::span_file::{AnchorRecord, SpanConfig, SpanFile};
use git_span_core::{CopyDetection, cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// `file1.txt` as `TestRepo::seeded` writes it (10 lines).
const ORIGINAL: &str = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";

/// `file2.txt` as `TestRepo::seeded` writes it (16 lines).
const FILE2: &str = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n\
     line11\nline12\nline13\nline14\nline15\nline16\n";

/// An arbitrary well-formed rk64 hash token that matches no real content.
const OTHER_HASH: &str = "0123456789abcdef";
const THIRD_HASH: &str = "fedcba9876543210";

fn span_path(repo: &TestRepo, name: &str) -> std::path::PathBuf {
    repo.path().join(".span").join(name)
}

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    Ok(std::fs::read_to_string(span_path(repo, name))?)
}

fn read_span_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(span_path(repo, name))?)
}

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_span_core::AnchorExtent::WholeFile,
    ))
}

/// Produce residue text by running the **real merge driver** over three span
/// texts, so a fixture that claims to be driver output actually is one.
///
/// Returns the driver's output text; asserts the driver took its partial
/// resolution branch (exit 1), since a fully-resolved merge writes no markers.
fn driver_residue(
    repo: &TestRepo,
    base: &str,
    ours: &str,
    theirs: &str,
    marker_len: &str,
) -> Result<String> {
    repo.write_file(".merge-base", base)?;
    repo.write_file(".merge-ours", ours)?;
    repo.write_file(".merge-theirs", theirs)?;
    let out = repo.run_span([
        "merge-driver",
        ".merge-base",
        ".merge-ours",
        ".merge-theirs",
        marker_len,
    ])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "driver must take its partial-resolution branch to produce residue; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(std::fs::read_to_string(repo.path().join(".merge-ours"))?)
}

/// Driver-shaped residue with a single anchor-residue block on
/// `file1.txt#L1-L5` and an agreed `why` — which the writer carries into the
/// text plainly, after the separator, since the why is not the conflicting
/// field and `ours`' copy of it is non-empty.
fn anchor_only_residue(repo: &TestRepo, marker_len: &str) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let base = format!("file1.txt#L1-L5 rk64:{h1}\n\nshared rationale\n");
    let ours = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!("file1.txt#L1-L5 rk64:{THIRD_HASH}\n\nshared rationale\n");
    driver_residue(repo, &base, &ours, &theirs, marker_len)
}

/// Driver-shaped residue carrying **two** conflict blocks — an anchor-residue
/// block before the separator and a why-residue block after it — which is what
/// [`format_residue_markers`] emits whenever a why diverges alongside anchor
/// residue, and the shape `resolve` must accept.
///
/// [`format_residue_markers`]: git_span::cli::drift_fix
fn anchor_and_why_residue(repo: &TestRepo, ours_why: &str, theirs_why: &str) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let base = format!("file1.txt#L1-L5 rk64:{h1}\n\nbase rationale\n");
    let ours = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\n{ours_why}\n");
    let theirs = format!("file1.txt#L1-L5 rk64:{THIRD_HASH}\n\n{theirs_why}\n");
    let residue = driver_residue(repo, &base, &ours, &theirs, "7")?;
    assert_eq!(
        residue.matches("<<<<<<<").count(),
        2,
        "fixture assumption: a divergent why alongside anchor residue is two blocks; \
         residue=\n{residue}"
    );
    Ok(residue)
}

// ---------------------------------------------------------------------------
// 1. --rehash settles disjoint anchors (and is the default)
// ---------------------------------------------------------------------------

#[test]
fn resolve_rehash_settles_disjoint_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );

    // Bare `resolve` — no side flag — must behave exactly like `--rehash`.
    repo.write_file(".span/m", &fixture)?;
    let out = repo.run_span(["resolve", "m"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "bare resolve must succeed; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let bare = read_span(&repo, "m")?;

    repo.write_file(".span/m", &fixture)?;
    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(out.status.code(), Some(0), "--rehash must succeed");
    let explicit = read_span(&repo, "m")?;

    assert_eq!(bare, explicit, "--rehash is the default; outputs must match");
    assert!(
        explicit.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "file1 anchor; span:\n{explicit}"
    );
    assert!(
        explicit.contains(&format!("file2.txt#L1-L5 rk64:{h2}")),
        "file2 anchor; span:\n{explicit}"
    );
    assert!(
        !explicit.contains("<<<<<<<") && !explicit.contains(">>>>>>>"),
        "no markers may remain; span:\n{explicit}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 2. All-or-nothing: the file is byte-identical after a failed --rehash
// ---------------------------------------------------------------------------

#[test]
fn resolve_rehash_all_or_nothing_leaves_file_untouched() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    // file1 is rehashable; gone.txt is not present in the worktree at all,
    // so its divergent pair can never be settled under --rehash.
    let fixture = format!(
        "\
file1.txt#L1-L5 rk64:{h1}
<<<<<<< ours
gone.txt#L1-L3 rk64:{OTHER_HASH}
=======
gone.txt#L1-L3 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "unsettleable residue must fail");
    assert!(
        stderr.contains("gone.txt#L1-L3"),
        "error must name the stuck anchor; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains(OTHER_HASH) && stderr.contains(THIRD_HASH),
        "error must carry both prior hashes; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("--ours") && stderr.contains("--theirs"),
        "error must suggest taking a side; stderr=\n{stderr}"
    );

    let after = read_span_bytes(&repo, "m")?;
    assert_eq!(before, after, "the span file must be byte-identical");
    Ok(())
}

// ---------------------------------------------------------------------------
// 3. Orphan with an unreadable source fails closed — on each side
// ---------------------------------------------------------------------------

fn orphan_unreadable_case(orphan_in_ours: bool) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h2 = line_slice_hash(FILE2, 1, 5);
    let orphan = format!("gone.txt#L1-L3 rk64:{OTHER_HASH}");
    let live = format!("file2.txt#L1-L5 rk64:{h2}");
    let (ours_line, theirs_line) = if orphan_in_ours {
        (&orphan, &live)
    } else {
        (&live, &orphan)
    };
    let fixture = format!(
        "\
<<<<<<< ours
{ours_line}
=======
{theirs_line}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(
        out.status.code(),
        Some(0),
        "an orphan whose source is unreadable must not be silently kept with a \
         stale hash; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("gone.txt#L1-L3") && stderr.contains("orphan anchor"),
        "error must name the orphan; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains(if orphan_in_ours { "only by ours" } else { "only by theirs" }),
        "error must name the side the orphan came from; stderr=\n{stderr}"
    );
    assert_eq!(
        before,
        read_span_bytes(&repo, "m")?,
        "the span file must be byte-identical"
    );
    Ok(())
}

#[test]
fn resolve_rehash_orphan_unreadable_source_fails_closed_ours_side() -> Result<()> {
    orphan_unreadable_case(true)
}

#[test]
fn resolve_rehash_orphan_unreadable_source_fails_closed_theirs_side() -> Result<()> {
    orphan_unreadable_case(false)
}

// ---------------------------------------------------------------------------
// 3b. An anchor whose declared range no longer fits its source fails closed
// ---------------------------------------------------------------------------

#[test]
fn resolve_rehash_out_of_range_anchor_fails_closed_orphan_arm() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h2 = line_slice_hash(FILE2, 1, 5);
    // file1.txt has 10 lines; the orphan claims through line 40. Readable and
    // marker-free, so it clears every other precondition.
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L40 rk64:{OTHER_HASH}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("file1.txt#L1-L40") && stderr.contains("only 10 lines"),
        "error must cite the source's real line count; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

#[test]
fn resolve_rehash_out_of_range_anchor_fails_closed_divergent_hash_arm() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L40 rk64:{OTHER_HASH}
=======
file1.txt#L1-L40 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("file1.txt#L1-L40") && stderr.contains("only 10 lines"),
        "error must cite the source's real line count; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

// ---------------------------------------------------------------------------
// 4. --ours unions a theirs-only orphan rather than filtering to ours
// ---------------------------------------------------------------------------

#[test]
fn resolve_ours_unions_theirs_only_orphan() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "--ours always settles anchor residue; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains(&format!("file2.txt#L1-L5 rk64:{h2}")),
        "a theirs-only anchor is union, not residue, and must survive --ours; span:\n{span}"
    );
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "the divergent anchor must take ours' record; span:\n{span}"
    );
    assert!(
        !span.contains(OTHER_HASH),
        "theirs' record for the divergent anchor must be gone; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 5. --ours / --theirs settle a hash divergence
// ---------------------------------------------------------------------------

fn hash_divergence_case(side: &str, kept: &str, dropped: &str) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{OTHER_HASH}
=======
file1.txt#L1-L5 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m", side])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "{side} must settle a hash divergence; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(span.contains(kept), "{side} must keep its own record; span:\n{span}");
    assert!(
        !span.contains(dropped),
        "the other side's hash must be absent; span:\n{span}"
    );
    assert!(!span.contains("<<<<<<<"), "no markers may remain; span:\n{span}");
    Ok(())
}

#[test]
fn resolve_ours_settles_hash_divergence() -> Result<()> {
    hash_divergence_case("--ours", OTHER_HASH, THIRD_HASH)
}

#[test]
fn resolve_theirs_settles_hash_divergence() -> Result<()> {
    hash_divergence_case("--theirs", THIRD_HASH, OTHER_HASH)
}

// ---------------------------------------------------------------------------
// 6/7. --why divergence: settled by --ours/--theirs, refused by --rehash
// ---------------------------------------------------------------------------

fn why_divergence_fixture() -> String {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}

our rationale
=======
file1.txt#L1-L5 rk64:{h1}

their rationale
>>>>>>> theirs
"
    )
}

fn why_divergence_case(side: &str, kept: &str, dropped: &str) -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &why_divergence_fixture())?;

    let out = repo.run_span(["resolve", "m", side])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "{side} must settle a why divergence; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(span.contains(kept), "{side} must keep its own prose; span:\n{span}");
    assert!(!span.contains(dropped), "the other prose must be gone; span:\n{span}");
    assert!(!span.contains("<<<<<<<"), "no markers may remain; span:\n{span}");
    assert!(
        String::from_utf8_lossy(&out.stdout).contains(&format!("why: kept {}", &side[2..])),
        "report must attribute the why to the chosen side; stdout=\n{}",
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

#[test]
fn resolve_ours_settles_why_divergence() -> Result<()> {
    why_divergence_case("--ours", "our rationale", "their rationale")
}

#[test]
fn resolve_theirs_settles_why_divergence() -> Result<()> {
    why_divergence_case("--theirs", "their rationale", "our rationale")
}

#[test]
fn resolve_rehash_fails_on_why_divergence() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &why_divergence_fixture())?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("--why"),
        "the error must name the diverged field; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("--ours") && stderr.contains("--theirs"),
        "the error must point at the sides that can settle it; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

// ---------------------------------------------------------------------------
// 8. `[config]` divergence — function-level, because the CLI layer's
//    driver-shape refusal makes a text-sourced config divergence unreachable
// ---------------------------------------------------------------------------

#[test]
fn resolve_config_conflict_settlement_unit_test() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix_repo = repo.gix_repo()?;

    let anchor = |hash: &str| AnchorRecord {
        path: "file1.txt".to_string(),
        start_line: 1,
        end_line: 5,
        algorithm: "rk64".to_string(),
        content_hash: hash.to_string(),
    };
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let ours_config = SpanConfig {
        copy_detection: CopyDetection::AnyFileInRepo,
        ignore_whitespace: true,
        follow_moves: true,
    };
    let ours = SpanFile {
        anchors: vec![anchor(&h1)],
        why: "shared rationale".to_string(),
        config: ours_config,
    };
    let theirs = SpanFile {
        anchors: vec![anchor(&h1)],
        why: "shared rationale".to_string(),
        config: SpanConfig::default(),
    };

    // --rehash cannot arbitrate settings from the worktree: it is a named
    // failure, and specifically not a `--why` failure.
    let failures = git_span::cli::resolve::settle_for_test(&gix_repo, "rehash", &ours, &theirs)
        .expect_err("a config divergence must fail closed under --rehash");
    assert!(
        failures.iter().any(|f| f.contains("[config]")),
        "the failure must name [config]; failures={failures:?}"
    );
    assert!(
        !failures.iter().any(|f| f.contains("--why")),
        "a config-only divergence must not be reported as a why divergence; failures={failures:?}"
    );

    // --ours/--theirs pick that side's *whole* SpanConfig, not a
    // field-by-field default.
    let (merged, _, config_label) =
        git_span::cli::resolve::settle_for_test(&gix_repo, "ours", &ours, &theirs)
            .expect("--ours settles a config divergence");
    assert_eq!(merged.config, ours_config, "--ours keeps ours' whole config");
    assert_eq!(config_label, "kept ours");

    let (merged, _, config_label) =
        git_span::cli::resolve::settle_for_test(&gix_repo, "theirs", &ours, &theirs)
            .expect("--theirs settles a config divergence");
    assert_eq!(merged.config, SpanConfig::default(), "--theirs keeps theirs'");
    assert_eq!(config_label, "kept theirs");
    Ok(())
}

// ---------------------------------------------------------------------------
// 8b/8g. The recovery-ceiling report lines, on the no-index-stages path
// ---------------------------------------------------------------------------

#[test]
fn resolve_reports_config_loss_when_no_index_stages() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_only_residue(&repo, "7")?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "the residue is rehashable; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("no `[config]` section found in the input")
            && stdout.contains("No unmerged index stages were available"),
        "the config-loss ceiling must be reported loudly; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("[config]"),
        "default config serializes nothing; span:\n{span}"
    );
    Ok(())
}

#[test]
fn resolve_reports_why_loss_when_no_index_stages() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // The one why the residue writer still leaves out of the text: one that
    // only `theirs` added, which its non-conflicting branch never writes
    // because that branch emits `ours_why`. With no stages to read stage 3
    // from, the prose is simply gone — which is what the ceiling reports.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let residue = driver_residue(
        &repo,
        &format!("file1.txt#L1-L5 rk64:{h1}\n"),
        &format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n"),
        &format!("file1.txt#L1-L5 rk64:{THIRD_HASH}\n\nrationale Y\n"),
        "7",
    )?;
    assert!(
        !residue.contains("rationale Y"),
        "this fixture only tests why-loss if the driver really left the why out; \
         residue=\n{residue}"
    );
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0));
    assert!(
        stdout.contains("no why text found in the input")
            && stdout.contains("no unmerged index stages were available"),
        "the why-loss ceiling must be reported loudly; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("rationale Y"),
        "the why genuinely cannot be recovered from text alone; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 8c–8i + 14. Index-stage supplementation, against real unmerged stages
//
// Every test below runs against a genuinely unmerged index: a real `git
// merge` routed through the real span merge driver, left uncommitted, so
// stages 1/2/3 hold the pre-driver blobs the worktree residue no longer
// carries. That is the only honest way to exercise the supplement.
// ---------------------------------------------------------------------------

/// The anchors' source file. It appears in the worktree only *after* the
/// merge, so the driver had nothing to re-hash from (which is what leaves the
/// residue) while `resolve --rehash` afterwards does.
const LATER: &str = "alpha\nbravo\ncharlie\ndelta\n";

/// A hash for the merge base's record, distinct from both sides'.
const BASE_HASH: &str = "1111222233334444";

/// A hash an operator wrote by hand — matching no stage blob and no worktree
/// content, so "preserved exactly" is unambiguous.
const HAND_HASH: &str = "aaaabbbbccccdddd";

/// Leave the repo mid-merge: real `MERGE_HEAD`, real unmerged stages 1/2/3 on
/// `.span/m`, and driver-produced residue in the worktree. Returns the repo
/// and that residue text.
///
/// The residue is the driver's own output by construction — this is the
/// fixture-provenance rule the cheap fixtures satisfy via `driver_residue`.
fn mid_merge_repo(base: &str, ours: &str, theirs: &str) -> Result<(TestRepo, String)> {
    let repo = TestRepo::seeded()?;
    // Route `.span/**` through the real driver; git's default text merge
    // would produce a shape `resolve` deliberately refuses.
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
    repo.run_git([
        "config",
        "merge.span.name",
        "git-span structural span merge",
    ])?;
    repo.run_git([
        "config",
        "merge.span.driver",
        &format!(
            "{} merge-driver %O %A %B %L",
            env!("CARGO_BIN_EXE_git-span")
        ),
    ])?;
    repo.write_file(".span/m", base)?;
    repo.commit_all("declare m")?;

    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file(".span/m", theirs)?;
    repo.commit_all("side edits m")?;

    repo.run_git(["checkout", "main"])?;
    repo.write_file(".span/m", ours)?;
    repo.commit_all("main edits m")?;

    let merge = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "--no-edit", "side"])
        .output()?;
    assert!(
        !merge.status.success(),
        "the driver must fail closed on this fixture, or there are no stages to read; \
         stdout=\n{}\nstderr=\n{}",
        String::from_utf8_lossy(&merge.stdout),
        String::from_utf8_lossy(&merge.stderr)
    );

    let staged = repo.git_stdout(["ls-files", "-u", ".span/m"])?;
    for stage in ["1", "2", "3"] {
        assert!(
            staged.contains(&format!(" {stage}\t.span/m")),
            "fixture assumption: stage {stage} must be present; ls-files -u:\n{staged}"
        );
    }

    let residue = read_span(&repo, "m")?;
    assert!(
        residue.contains("<<<<<<<"),
        "fixture assumption: the worktree file must carry driver residue; residue=\n{residue}"
    );

    repo.write_file("later.txt", LATER)?;
    Ok((repo, residue))
}

/// Base/ours/theirs for the common shape: one anchor conflicting on hash and a
/// `why` that is identical everywhere, which the writer carries into the
/// residue text plainly.
fn shared_why_sides() -> (String, String, String) {
    (
        format!("later.txt#L1-L3 rk64:{BASE_HASH}\n\nshared rationale\n"),
        format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n\nshared rationale\n"),
        format!("later.txt#L1-L3 rk64:{THIRD_HASH}\n\nshared rationale\n"),
    )
}

/// Base/ours/theirs for the one shape whose `why` the residue writer still
/// leaves out of the worktree text entirely: `theirs` adds prose that `ours`
/// does not have.
///
/// Three-way arbitration finds no divergence (only one side changed the
/// field), so [`format_residue_markers`] takes its non-conflicting branch and
/// writes `ours_why` — which is empty — while the anchor residue keeps the
/// file unmerged. Stage 3 is then the only surviving copy of the added prose,
/// and it is the sole remaining trigger for the stage why supplement.
///
/// [`format_residue_markers`]: git_span::cli::drift_fix
fn theirs_only_why_sides() -> (String, String, String) {
    (
        format!("later.txt#L1-L3 rk64:{BASE_HASH}\n"),
        format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n"),
        format!("later.txt#L1-L3 rk64:{THIRD_HASH}\n\nrationale Y\n"),
    )
}

#[test]
fn resolve_recovers_config_from_index_stages_after_partial_residue() -> Result<()> {
    let base = format!("later.txt#L1-L3 rk64:{BASE_HASH}\n\nshared rationale\n");
    let ours = format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!(
        "later.txt#L1-L3 rk64:{THIRD_HASH}\n\nshared rationale\n\n[config]\n\
         copy_detection = \"same-commit\"\nignore_whitespace = true\nfollow_moves = false\n"
    );
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        !residue.contains("[config]"),
        "fixture assumption: the residue writer drops [config] from the worktree text; \
         residue=\n{residue}"
    );

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "the residue is rehashable once later.txt exists; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("[config]") && span.contains("ignore_whitespace = true"),
        "the non-default config must be recovered from the stage blobs; span:\n{span}"
    );
    assert!(
        !stdout.contains("no `[config]` section found in the input"),
        "the loss ceiling must not be reported when stages were available; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_preserves_hand_edited_worktree_content() -> Result<()> {
    let base = format!(
        "handed.txt#L1-L2 rk64:{BASE_HASH}\nlater.txt#L1-L3 rk64:{BASE_HASH}\n\nshared rationale\n"
    );
    let ours = format!(
        "handed.txt#L1-L2 rk64:{OTHER_HASH}\nlater.txt#L1-L3 rk64:{OTHER_HASH}\n\n\
         shared rationale\n"
    );
    let theirs = format!(
        "handed.txt#L1-L2 rk64:{THIRD_HASH}\nlater.txt#L1-L3 rk64:{THIRD_HASH}\n\n\
         shared rationale\n"
    );
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        residue.contains(&format!("handed.txt#L1-L2 rk64:{OTHER_HASH}"))
            && residue.contains(&format!("handed.txt#L1-L2 rk64:{THIRD_HASH}")),
        "fixture assumption: both handed.txt records must be residue; residue=\n{residue}"
    );

    // The operator settles handed.txt by hand — lifting it out of the block
    // as one clean line whose hash matches neither stage blob — and leaves
    // later.txt marked, which is what they are still running `resolve` for.
    let hand_edited: String = std::iter::once(format!("handed.txt#L1-L2 rk64:{HAND_HASH}\n"))
        .chain(
            residue
                .lines()
                .filter(|l| !l.contains("handed.txt"))
                .map(|l| format!("{l}\n")),
        )
        .collect();
    repo.write_file(".span/m", &hand_edited)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "the remaining residue is rehashable; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains(&format!("handed.txt#L1-L2 rk64:{HAND_HASH}")),
        "the hand-resolved anchor must survive exactly — anchors are never sourced from \
         the frozen stage blobs; span:\n{span}"
    );
    assert!(
        !span.contains(OTHER_HASH) && !span.contains(THIRD_HASH),
        "neither stage record may reappear; span:\n{span}"
    );
    assert!(
        span.contains(&format!("later.txt#L1-L3 rk64:{}", line_slice_hash(LATER, 1, 3))),
        "the still-marked anchor must be re-hashed from the worktree; span:\n{span}"
    );
    Ok(())
}

#[test]
fn resolve_uses_real_base_to_avoid_unnecessary_why_conflict() -> Result<()> {
    let (base, ours, theirs) = theirs_only_why_sides();
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        !residue.contains("rationale"),
        "fixture assumption: the writer leaves theirs' added why out of the text; \
         residue=\n{residue}"
    );

    // After the supplement the two sides' why genuinely differ — ours empty,
    // theirs `rationale Y`. Without a real stage-1 base that is a two-way
    // compare and `--rehash` would fail closed on it; with one, base shows
    // only theirs changed and there is nothing to arbitrate.
    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(0),
        "with a base, the unchanged side yields and nothing needs arbitrating; stderr=\n{stderr}"
    );
    assert!(
        !stderr.contains("--why"),
        "a one-sided why change must never be reported as a divergence; stderr=\n{stderr}"
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("rationale Y"),
        "three-way resolution must take the side that actually changed; span:\n{span}"
    );
    Ok(())
}

#[test]
fn resolve_ours_preserves_non_diverged_why_change() -> Result<()> {
    let (base, ours, theirs) = theirs_only_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("rationale Y"),
        "`--ours` must not revert a clean, uncontested change it was never asked to \
         arbitrate; span:\n{span}"
    );
    assert!(
        span.contains(&format!("later.txt#L1-L3 rk64:{OTHER_HASH}")),
        "the genuinely divergent anchor still takes ours' record; span:\n{span}"
    );
    assert!(
        stdout.contains("why: resolved automatically (matches theirs)"),
        "the report must not claim the side choice fired; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("why: kept ours") && !stdout.contains("why: unchanged"),
        "stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_ours_preserves_non_diverged_config_change() -> Result<()> {
    let base = format!("later.txt#L1-L3 rk64:{BASE_HASH}\n\nshared rationale\n");
    let ours = format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!(
        "later.txt#L1-L3 rk64:{THIRD_HASH}\n\nshared rationale\n\n[config]\n\
         copy_detection = \"same-commit\"\nignore_whitespace = false\nfollow_moves = true\n"
    );
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("follow_moves = true"),
        "`--ours` must not revert theirs' uncontested setting to ours' default; span:\n{span}"
    );
    assert!(
        stdout.contains("config: resolved automatically (matches theirs)"),
        "stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("config: kept ours"),
        "stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_recovers_why_from_index_stages_after_partial_residue() -> Result<()> {
    let (base, ours, theirs) = theirs_only_why_sides();
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        !residue.contains("rationale"),
        "fixture assumption: the writer emits `ours_why` for a non-diverged why, so theirs' \
         added prose is absent from the text; residue=\n{residue}"
    );

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("rationale Y"),
        "the why the writer left out must be recovered from stage 3, not merely reported \
         as lost; span:\n{span}"
    );
    assert!(
        stdout.contains("recovered from index stages"),
        "the report must not present a restored why as agreement; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("no why text found in the input"),
        "the loss ceiling must not fire when stages were available; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_hand_edited_why_is_never_overwritten_from_index_stages() -> Result<()> {
    let (base, ours, theirs) = theirs_only_why_sides();
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;

    // The operator has since written their own why into the residue text,
    // below the anchor block's separator. A non-empty text-sourced why is
    // exactly what the supplement must not touch — the empty-string
    // discriminator is the whole guard.
    let hand_edited = format!("{residue}operator rationale\n");
    repo.write_file(".span/m", &hand_edited)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("operator rationale"),
        "the hand-edited why must survive; span:\n{span}"
    );
    assert!(
        !span.contains("rationale Y"),
        "the stage blob must never override a non-empty text-sourced why; span:\n{span}"
    );
    assert!(
        !stdout.contains("recovered from index stages"),
        "nothing was recovered here; stdout=\n{stdout}"
    );
    Ok(())
}

/// The narrowed supplement's two halves, on the ambiguous shape the plan
/// disclosed: an operator who clears both sides of a contested why produces
/// exactly the text a dropped why produces. Since only `theirs` can lose a why
/// to the writer, only `theirs` is restored — `ours`' clear stands, which
/// removes the false positive the symmetric version carried.
#[test]
fn resolve_why_cleared_by_hand_stands_on_ours_and_is_restored_on_theirs() -> Result<()> {
    let base = format!("later.txt#L1-L3 rk64:{BASE_HASH}\n\nrationale X\n");
    let ours = format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n\nrationale Y\n");
    let theirs = format!("later.txt#L1-L3 rk64:{THIRD_HASH}\n\nrationale Z\n");
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        residue.contains("rationale Y") && residue.contains("rationale Z"),
        "fixture assumption: a contested why is carried in its own block; residue=\n{residue}"
    );

    // The operator decides the span no longer needs a why and deletes both
    // paragraphs, leaving the anchor residue.
    let cleared: String = residue
        .lines()
        .filter(|l| !l.starts_with("rationale "))
        .map(|l| format!("{l}\n"))
        .collect();
    repo.write_file(".span/m", &cleared)?;
    let before = read_span_bytes(&repo, "m")?;

    // Restoring theirs makes the divergence real again against ours' empty
    // why, so `--rehash` has something it cannot arbitrate — the ambiguity
    // surfaces rather than being silently read as agreement on an empty why.
    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("--why"),
        "the restored divergence must be named; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");

    // `--theirs` writes the stage-supplied prose back — the disclosed choice
    // of restore over preserve-empty — and says so rather than calling it
    // agreement.
    let out = repo.run_span(["resolve", "m", "--theirs"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("rationale Z") && !span.contains("rationale Y"),
        "the stage-supplied why for the chosen side must be restored; span:\n{span}"
    );
    assert!(
        stdout.contains("recovered from index stages") && !stdout.contains("why: unchanged"),
        "the operator must be able to see that something put the why back; stdout=\n{stdout}"
    );

    // `--ours` honors the clear: the writer can never drop ours' why, so an
    // empty one is the operator's own edit and the supplement leaves it alone.
    repo.write_file(".span/m", &cleared)?;
    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("rationale"),
        "ours' deliberate clear must stand; span:\n{span}"
    );
    assert!(
        stdout.contains("why: kept ours") && !stdout.contains("recovered from index stages"),
        "nothing was recovered into what was written; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_never_stages() -> Result<()> {
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("<<<<<<<"),
        "the span must be fully resolved in the worktree; span:\n{span}"
    );

    let staged = repo.git_stdout(["ls-files", "-u", ".span/m"])?;
    for stage in ["1", "2", "3"] {
        assert!(
            staged.contains(&format!(" {stage}\t.span/m")),
            "resolve must never stage: stage {stage} must still be unmerged; \
             ls-files -u:\n{staged}"
        );
    }
    assert!(
        repo.path().join(".git").join("MERGE_HEAD").exists(),
        "resolve must not touch the merge state"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 9/10/10b/10c. Input-shape refusals, and the gate not over-triggering
// ---------------------------------------------------------------------------

#[test]
fn resolve_refuses_config_inside_conflict_block() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    // Deliberately NOT driver-shaped: this is what Git's default text merge
    // produces when the span merge driver is not registered.
    let fixture = format!(
        "\
file1.txt#L1-L5 rk64:{h1}

why prose

<<<<<<< ours
[config]
ignore_whitespace = true
=======
[config]
ignore_whitespace = false
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    for side in ["--rehash", "--ours", "--theirs"] {
        let out = repo.run_span(["resolve", "m", side])?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_ne!(out.status.code(), Some(0), "{side} must refuse; stderr=\n{stderr}");
        assert!(
            stderr.contains("[config]") && stderr.contains("inside a conflict block"),
            "{side} must name the reason; stderr=\n{stderr}"
        );
        assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    }
    Ok(())
}

/// The corrected input-shape claim's refusal half: the writer coalesces every
/// divergent anchor into *one* block before the separator, so two blocks on
/// the same side of it are not its output — this is what Git's default text
/// merge produces when the span driver is not registered.
#[test]
fn resolve_refuses_two_conflict_blocks_on_one_side_of_the_separator() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> theirs
<<<<<<< ours
file2.txt#L1-L5 rk64:{h2}
=======
file2.txt#L1-L5 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("2 conflict blocks in its anchor block"),
        "the refusal must name the count and the region; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

/// The claim's acceptance half, over the writer's own two-block output: a why
/// that diverges alongside anchor residue gets its own block *after* the
/// separator, and `resolve` must settle that end to end rather than refuse the
/// driver's output in the one case the card exists for.
#[test]
fn resolve_settles_real_driver_output_with_a_divergent_why() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_and_why_residue(&repo, "our rationale", "their rationale")?;
    repo.write_file(".span/m", &residue)?;

    // --rehash settles the anchor from the worktree but cannot arbitrate
    // prose, so the why divergence is what stops it — and it says so.
    let before = read_span_bytes(&repo, "m")?;
    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("--why"),
        "the divergent why must be named, not the input shape; stderr=\n{stderr}"
    );
    assert!(
        !stderr.contains("conflict blocks"),
        "the driver's own output must never be refused as unshaped; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");

    let out = repo.run_span(["resolve", "m", "--theirs"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "--theirs must settle the driver's two-block output; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("their rationale") && !span.contains("our rationale"),
        "the chosen side's prose must be what lands; span:\n{span}"
    );
    assert!(
        span.contains(&format!(
            "file1.txt#L1-L5 rk64:{}",
            line_slice_hash(ORIGINAL, 1, 5)
        )) || span.contains(&format!("file1.txt#L1-L5 rk64:{THIRD_HASH}")),
        "the anchor residue must be settled too; span:\n{span}"
    );
    assert!(!span.contains("<<<<<<<"), "no markers may remain; span:\n{span}");
    assert!(
        stdout.contains("why: kept theirs"),
        "stdout=\n{stdout}"
    );
    Ok(())
}

/// The witness the retired `rk64` gate existed to refuse: a why line whose
/// last token is `<word>:<word>`. The boundary is structural now — the line
/// arrives in the why region and can never be re-read as an anchor — so it
/// must round-trip through `resolve` intact rather than be rejected.
#[test]
fn resolve_round_trips_url_ending_why_prose_the_old_gate_refused() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_and_why_residue(
        &repo,
        "docs at https://example.com",
        "moved, see rfc:1234",
    )?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "prose that merely looks anchor-shaped is not a refusal; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("docs at https://example.com"),
        "the sentence must survive as prose, not become an anchor at path `docs at`; \
         span:\n{span}"
    );
    assert!(
        !span.contains("https:") || span.contains("docs at https://example.com"),
        "span:\n{span}"
    );
    assert!(
        !span.contains("moved, see rfc:1234"),
        "the unchosen side's prose must be gone; span:\n{span}"
    );
    // Re-parsing is the real proof the round trip was lossless: a fabricated
    // anchor would show up here as an extra record.
    let parsed = SpanFile::parse(&span)?;
    assert_eq!(parsed.anchors.len(), 1, "exactly one anchor; span:\n{span}");
    assert_eq!(parsed.anchors[0].path, "file1.txt");
    assert_eq!(parsed.why.trim(), "docs at https://example.com");
    Ok(())
}

// ---------------------------------------------------------------------------
// 11/12/13. No-op, missing span, and a directory shadowing the name
// ---------------------------------------------------------------------------

#[test]
fn resolve_no_markers_is_a_noop() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "a clean span"])?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "a clean span is the add-refresh case, not the missing-target case; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("no conflict markers") && stdout.contains("nothing to resolve"),
        "stdout=\n{stdout}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

#[test]
fn resolve_missing_span_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["resolve", "nope"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr=\n{stderr}");
    assert!(
        stderr.contains("no span named `nope`"),
        "structured error expected; stderr=\n{stderr}"
    );
    assert!(
        !span_path(&repo, "nope").exists(),
        "a failed resolve must never create the span file"
    );
    Ok(())
}

#[test]
fn resolve_name_collides_with_directory() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // A hierarchical span whose directory shadows the requested leaf name.
    repo.write_file(".span/m/leaf", "file1.txt#L1-L5 rk64:0000000000000000\n")?;

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(1),
        "a directory in the span's place is an ordinary error, not a panic; stderr=\n{stderr}"
    );
    assert!(
        stderr.starts_with("git span resolve:") && stderr.contains("could not be read"),
        "the error must be the structured shape, not a raw debug dump; stderr=\n{stderr}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 15/15b. --dry-run reports all three sides, including a failing one
// ---------------------------------------------------------------------------

#[test]
fn resolve_dry_run_reports_all_three_sides() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // gone.txt is simply absent — the benign, silently-omitted read class.
    let fixture = format!(
        "\
<<<<<<< ours
gone.txt#L1-L3 rk64:{OTHER_HASH}
=======
gone.txt#L1-L3 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--dry-run"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "a dry run always exits 0");
    assert!(
        stdout.contains("--rehash: would fail"),
        "the failing side must still be reported; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("--ours: would resolve") && stdout.contains("--theirs: would resolve"),
        "both settleable sides must be reported; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains(OTHER_HASH) && stdout.contains(THIRD_HASH),
        "each side's outcome must show what it would keep; stdout=\n{stdout}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "a dry run writes nothing");
    Ok(())
}

#[test]
fn resolve_dry_run_reports_rehash_failure_on_poisoned_source() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{OTHER_HASH}
=======
file1.txt#L1-L5 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    // The source file itself carries conflict markers — the `bail!`ing class,
    // distinct from "missing". This is the exact case an operator most wants
    // the three-way comparison for.
    repo.write_file(
        "file1.txt",
        "<<<<<<< HEAD\nline1\n=======\nline1 changed\n>>>>>>> branch\n",
    )?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--dry-run"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "a dry run always exits 0");
    assert!(
        stdout.contains("--rehash: would fail")
            && stdout.contains("source file `file1.txt`")
            && stdout.contains("conflict markers"),
        "the poisoned source must be reported as this side's outcome, not aborted; \
         stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("--ours: would resolve") && stdout.contains("--theirs: would resolve"),
        "the other two sides must still be evaluated; stdout=\n{stdout}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "a dry run writes nothing");
    Ok(())
}

// ---------------------------------------------------------------------------
// 16. The clean-source precondition binds --rehash only
// ---------------------------------------------------------------------------

#[test]
fn resolve_clean_source_precondition_applies_to_rehash_only() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{OTHER_HASH}
=======
file1.txt#L1-L5 rk64:{THIRD_HASH}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;
    repo.write_file(
        "file1.txt",
        "<<<<<<< HEAD\nline1\n=======\nline1 changed\n>>>>>>> branch\n",
    )?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("source file") && stderr.contains("conflict markers"),
        "the poisoned source must be named; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");

    // The identical fixture settles under --ours: no source is read at all.
    let out = repo.run_span(["resolve", "m", "--ours"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "--ours must route around an unreadable source; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(span.contains(OTHER_HASH), "span:\n{span}");
    assert!(!span.contains("<<<<<<<"), "span:\n{span}");
    Ok(())
}

// ---------------------------------------------------------------------------
// 17. A non-default conflict-marker length is still recognized
// ---------------------------------------------------------------------------

#[test]
fn resolve_marker_length_variants() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Real driver output at `%L=9`, exactly as git would invoke it under a
    // `conflict-marker-size` attribute.
    let residue = anchor_only_residue(&repo, "9")?;
    assert!(
        residue.contains("<<<<<<<<<") && residue.contains("========="),
        "the fixture must really carry 9-character markers; residue=\n{residue}"
    );
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "a non-default marker length must still split; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "the anchor must be re-hashed from the worktree; span:\n{span}"
    );
    assert!(
        !span.contains('<') && !span.contains('='),
        "no marker of any length may remain; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 18. `resolve` is a reserved span name
// ---------------------------------------------------------------------------

#[test]
fn resolve_reserved_name() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["add", "resolve", "file1.txt#L1-L5"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(
        out.status.code(),
        Some(0),
        "a span literally named `resolve` must be refused at create time"
    );
    assert!(
        stderr.contains("reserved"),
        "the refusal must say why; stderr=\n{stderr}"
    );

    // And the bare-name classifier must not splice `resolve` into `show`:
    // a missing positional is clap's usage error, not "no span named resolve".
    let out = repo.run_span(["resolve"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(2),
        "a missing span name is a clap usage error; stderr=\n{stderr}"
    );
    assert!(
        !stderr.contains("no span named `resolve`"),
        "`git span resolve` must never be routed to `show`; stderr=\n{stderr}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 19. --format json
// ---------------------------------------------------------------------------

#[test]
fn resolve_format_json() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m", "--format", "json"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let doc: serde_json::Value =
        serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("json expected: {e}\n{stdout}"));
    assert_eq!(doc["schema_version"], 1);
    assert_eq!(doc["command"], "resolve");
    assert_eq!(doc["span"], "m");
    assert_eq!(doc["side"], "rehash");
    assert_eq!(doc["written"], true);
    assert_eq!(
        doc["entries"].as_array().map(|a| a.len()),
        Some(2),
        "both settled anchors must appear; {stdout}"
    );
    assert!(
        !stdout.contains("resolved `m`"),
        "json must not carry the human prose; {stdout}"
    );
    Ok(())
}
