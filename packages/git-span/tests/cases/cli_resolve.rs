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

/// Every report line keyed on `prefix`, trimmed. Two lines sharing one key is
/// how the config contradiction presented itself to an operator — a field label
/// saying `config: unchanged` and a ceiling line saying the settings were gone,
/// both prefixed `config:` and two lines apart — so the assertion that catches
/// it has to be about the *set* of such lines, not the presence of either one.
fn field_lines(stdout: &str, prefix: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with(prefix))
        .map(str::to_string)
        .collect()
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

/// A diverged why, in the writer's own shape: the anchor residue and the why
/// residue get separate blocks on their own sides of the blank-line separator.
///
/// This fixture used to be hand-written as a *single* block holding both
/// sides' anchor line, a blank, and their prose — a shape the writer cannot
/// emit, and one whose interior blank moves the anchor/why boundary on
/// whichever side it appears in. `resolve` now refuses it rather than guessing
/// the boundary back, so the fixture has to be what it always claimed to be.
fn why_divergence_fixture(repo: &TestRepo) -> Result<String> {
    anchor_and_why_residue(repo, "our rationale", "their rationale")
}

fn why_divergence_case(side: &str, kept: &str, dropped: &str) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = why_divergence_fixture(&repo)?;
    repo.write_file(".span/m", &fixture)?;

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
    let fixture = why_divergence_fixture(&repo)?;
    repo.write_file(".span/m", &fixture)?;
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
        stdout.contains("`[config]` was not recoverable from this input")
            && stdout.contains("no unmerged index stage could be read"),
        "the config-recovery ceiling must be reported loudly; stdout=\n{stdout}"
    );
    // The contradiction this pairs with: the field label two lines up used to
    // say `config: unchanged` — a claim of agreement about a value neither
    // split side ever carried, since the residue writer serializes no
    // `[config]` at all. Presence of the warning alone never caught that;
    // absence of the contradicting label is what does.
    assert!(
        !stdout.contains("config: unchanged"),
        "no `[config]` reached either side, so nothing can be reported as unchanged; \
         stdout=\n{stdout}"
    );
    assert_eq!(
        field_lines(&stdout, "config:"),
        vec![
            "config: written with default settings — no `[config]` in this input stated one"
                .to_string()
        ],
        "exactly one line may key on `config:`; stdout=\n{stdout}"
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
        stdout.contains("The why text was written empty")
            && stdout.contains("no unmerged index stage could be read"),
        "the why-recovery ceiling must be reported loudly; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("why: unchanged"),
        "there is no why on either side to be unchanged; stdout=\n{stdout}"
    );
    assert_eq!(
        field_lines(&stdout, "why:").len(),
        1,
        "exactly one line may key on `why:`; stdout=\n{stdout}"
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
        !stdout.contains("`[config]` was not recoverable from this input"),
        "the recovery ceiling must not be reported when stages were readable; stdout=\n{stdout}"
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
    // `handed.txt` has to exist for `--rehash` to be willing to write an
    // anchor on it at all: a source it cannot read is a hash it cannot vouch
    // for, whichever side the record came from. What this test is about is
    // that the *hand-settled record* survives, not that a dead path does.
    repo.write_file("handed.txt", "handed one\nhanded two\n")?;

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
///
/// This is also the guard on the *shape* of the why-region check. The sentence
/// parses as `WholeFile { path_has_whitespace: true }`, because
/// `parse_anchor_line` splits at the last space and absorbs `docs at` into the
/// path. Any widening of that check to whole-file addresses generally — rather
/// than to whitespace-free ones — hard-stops this span.
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

// ---------------------------------------------------------------------------
// 20. The anchor/why boundary itself
//
// The span format marks the boundary with a blank line and nothing else, so
// the writer knows where it is and the reader can only reconstruct it. Every
// fixture below varies the boundary — moving it, making it asymmetric across
// the two sides, or putting a block on the wrong side of it — because no
// fixture in this suite varied it before, and that is the single reason a
// deleted anchor, a fabricated anchor, and a guard wired to the complement of
// its own condition all shipped green.
//
// These fixtures are deliberately **not** driver-generated and cannot be:
// `format_residue_markers` emits none of these shapes. Each one names its real
// producer in a comment — old-format residue, or a hand-edited conflicted file,
// which the card invites by making hand progress authoritative.
// ---------------------------------------------------------------------------

/// Assert every side refuses `fixture` and leaves it byte-identical.
fn every_side_refuses(fixture: &str, expected_reason: &str) -> Result<()> {
    let repo = TestRepo::seeded()?;
    for side in ["--rehash", "--ours", "--theirs"] {
        repo.write_file(".span/m", fixture)?;
        let before = read_span_bytes(&repo, "m")?;
        let out = repo.run_span(["resolve", "m", side])?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_ne!(
            out.status.code(),
            Some(0),
            "{side} must refuse a boundary it cannot establish; stderr=\n{stderr}"
        );
        // The refusal reason is one long sentence that the error renderer wraps
        // to the terminal, so match against a whitespace-normalized copy: the
        // assertion is about the words, not where the renderer broke the line.
        let flattened = stderr.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(
            flattened.contains(expected_reason),
            "{side}: the refusal must name what it could not establish; stderr=\n{stderr}"
        );
        assert_eq!(
            before,
            read_span_bytes(&repo, "m")?,
            "{side} must leave the file byte-identical"
        );
    }
    Ok(())
}

/// **The asymmetric boundary.** `SideBuilder` flips into the why region on the
/// first blank line *that side* sees, so a blank inside the conflict block
/// moves the boundary on one side and not the other. Ours' prose lands in the
/// why; theirs' lands in the anchors and is written back as a tracked anchor
/// whose path is a sentence. Producer: a hand-edited conflicted file.
#[test]
fn resolve_refuses_a_blank_line_inside_the_anchor_residue_block() -> Result<()> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let fixture = format!(
        "\
file1.txt#L1-L5 rk64:{h1}
<<<<<<< ours

The parser and the lexer agree; docs at https://example.com
=======
Divergent prose, docs at https://example.com
>>>>>>> theirs
"
    );
    every_side_refuses(&fixture, "blank line inside a conflict block")
}

/// The same fabrication with the boundary left symmetric: no blank anywhere,
/// so both sides read every line as an anchor and theirs' sentence becomes a
/// whole-file anchor at path `Divergent prose, docs at`. A whole-file address
/// whose path holds whitespace is the one anchor shape prose can counterfeit.
#[test]
fn resolve_refuses_prose_masquerading_as_a_whole_file_anchor() -> Result<()> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
Divergent prose, docs at https://example.com
>>>>>>> theirs
"
    );
    every_side_refuses(&fixture, "whole-file anchor path contains whitespace")
}

/// **The boundary in the other direction.** A conflict block sitting after the
/// separator is why by position, so a tracked anchor inside it is pushed onto
/// `.why` and deleted outright — silently, at exit 0, and structurally absent
/// from the report because the report iterates the merged anchors and a deleted
/// anchor is in neither side's list. Producer: residue written by a git-span
/// predating the two-block writer.
#[test]
fn resolve_refuses_an_anchor_record_inside_a_why_region_block() -> Result<()> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let fixture = format!(
        "\
file1.txt#L1-L5 rk64:{h1}

<<<<<<< ours
some rationale
=======
file2.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> theirs
"
    );
    every_side_refuses(&fixture, "sits *after* the blank-line separator")
}

/// Reproduce the residue layout of `format_residue_markers` **as it stood
/// before `42d28964`**, which is the writer that puts a tracked anchor after
/// the separator. Read it at
/// `git show 42d28964^:packages/git-span/src/cli/drift_fix.rs` (body at line
/// 424): it writes the resolved anchors, then pushes the blank separator —
/// guarded only by "there is any residue or why at all" — and only *then* opens
/// one conflict block whose sides begin with `u.ours` / `u.theirs`, the
/// `AnchorRecord` serializations of the divergent anchors. `42d28964`'s own
/// message names the defect: that writer "wrapped anchor residue and why
/// residue in a single conflict block".
///
/// The fixtures below cannot be driver-generated — that writer no longer exists
/// in the tree, and the current one emits a post-separator block only for why
/// text, which is why exercising a live merge never reaches this class. This
/// helper is the next best thing to generating them: it mirrors the old
/// writer's emission order line for line, so the shape under test is derived
/// from the writer rather than guessed at. Hand-written residue fixtures have
/// concealed defects three times on this card; that is what this helper exists
/// to avoid.
fn pre_42d28964_residue(resolved: &[String], ours: &[String], theirs: &[String]) -> String {
    let mut out = String::new();
    for line in resolved {
        out.push_str(line);
        out.push('\n');
    }
    // The separator, emitted *before* the block — this single `push('\n')` is
    // the whole defect.
    out.push('\n');
    out.push_str("<<<<<<< ours\n");
    for line in ours {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("=======\n");
    for line in theirs {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str(">>>>>>> theirs\n");
    out
}

/// Assert an anchor line's hash is the shape a production writer emits:
/// sixteen lowercase hex, the only output `rk64_to_hex`'s `{fp:016x}` has. A
/// fixture that fails this no longer reaches the post-separator refusal, which
/// is narrowed on exactly this property.
fn assert_writer_shaped_hash(line: &str) {
    let hash = line
        .rsplit_once(':')
        .unwrap_or_else(|| panic!("fixture line has no hash token: `{line}`"))
        .1;
    assert!(
        hash.len() == 16
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "fixture assumption: `{line}` must carry a writer-shaped (16 lowercase hex) hash, or it \
         is permitted as prose and this test silently stops exercising the refusal"
    );
}

/// The same silent deletion for the **whole-file** address form, which the
/// check missed. `Display` renders a whole-file anchor as `<path> <alg>:<hash>`
/// with no `#L` range, so it classifies as `WholeFile` where the check named
/// only `LineRange` and fell through to permit. This is not a corner case:
/// `git span add <name> <path>` with no range writes one, and this repository's
/// own `.span/` tree is 61 whole-file anchors out of 322.
///
/// Both address forms are exercised here against the writer-derived layout, so
/// the fixture that already passed and the one that did not are settled by the
/// same input shape.
#[test]
fn resolve_refuses_a_bare_anchor_record_of_either_address_form_after_the_separator() -> Result<()> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let resolved = vec![format!("file1.txt#L1-L5 rk64:{h1}")];
    let cases = [
        (
            "WholeFile { path_has_whitespace: false }",
            format!("src/b.txt rk64:{OTHER_HASH}"),
            format!("src/b.txt rk64:{THIRD_HASH}"),
            "whole-file anchor record",
        ),
        (
            "LineRange { path_has_whitespace: false }",
            format!("file2.txt#L1-L5 rk64:{OTHER_HASH}"),
            format!("file2.txt#L1-L5 rk64:{THIRD_HASH}"),
            "line-range anchor record",
        ),
    ];

    for (shape, ours, theirs, described) in cases {
        // The refusal is narrowed to a writer-shaped hash — sixteen lowercase
        // hex — so a fixture carrying a short hash like `1111` or `deadbeef`
        // (the style used throughout the `span_file` unit tests) would still
        // *pass* this test while no longer exercising the refusal at all. Pin
        // the assumption rather than trusting the constants to stay put.
        assert_writer_shaped_hash(&ours);
        assert_writer_shaped_hash(&theirs);
        let fixture = pre_42d28964_residue(
            &resolved,
            std::slice::from_ref(&ours),
            std::slice::from_ref(&theirs),
        );
        // Match the phrase *with* the quoted line after it, so a message about
        // some other line in the block cannot satisfy the assertion.
        let expected = format!("{described}, `{ours}`");
        every_side_refuses(&fixture, &expected).map_err(|e| e.context(format!("shape {shape}")))?;
    }
    Ok(())
}

/// The over-refusal the whitespace test alone could not avoid, closed by the
/// second half of the check. `See https://example.com` splits at the last space
/// to address `See` and hash part `https://example.com`, so it has a
/// whitespace-free whole-file address — indistinguishable, on that test alone,
/// from `src/b.txt rk64:…`. The number of words before the colon-bearing token
/// was deciding whether a why line read as a bare record: one word a record,
/// two prose.
///
/// What separates them is the content hash. Every production write site is
/// `content_hash: rk64_to_hex(fp)`, and `rk64_to_hex` is `format!("{fp:016x}")`
/// — sixteen lowercase hex, always. `//example.com` and `1234` are not hashes
/// this codebase emitted, so those lines cannot be misplaced records.
///
/// These fixtures use the pre-`42d28964` layout, so each line sits in exactly
/// the position that gets a record refused. They pass because of the hash, not
/// because of where they are.
#[test]
fn resolve_accepts_one_word_why_prose_whose_last_token_merely_holds_a_colon() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    for line in ["See https://example.com", "Ref rfc:1234", "Docs docs:v2"] {
        let owned = line.to_string();
        let fixture = pre_42d28964_residue(
            &[format!("file1.txt#L1-L5 rk64:{h1}")],
            std::slice::from_ref(&owned),
            std::slice::from_ref(&owned),
        );
        repo.write_file(".span/m", &fixture)?;
        let out = repo.run_span(["resolve", "m", "--ours"])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "`{line}` is prose, not a misplaced record; stderr=\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let span = read_span(&repo, "m")?;
        let parsed = SpanFile::parse(&span)?;
        assert!(
            parsed.why.contains(line),
            "`{line}` must survive as prose; span:\n{span}"
        );
    }
    Ok(())
}

/// The ceiling, and the case that must *stay* refused: a why line quoting a
/// genuine anchor verbatim is byte-identical to a misplaced record — same
/// address, same sixteen-hex hash — so no predicate can separate them. Refusing
/// is the right side to fail on, since the alternative is deleting a tracked
/// coupling at exit 0. Named here so it reads as an irreducible limit rather
/// than an oversight.
#[test]
fn resolve_still_refuses_a_why_that_is_nothing_but_a_verbatim_anchor() -> Result<()> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let quoted = format!("file2.txt#L1-L5 rk64:{OTHER_HASH}");
    let fixture = pre_42d28964_residue(
        &[format!("file1.txt#L1-L5 rk64:{h1}")],
        std::slice::from_ref(&quoted),
        std::slice::from_ref(&quoted),
    );
    every_side_refuses(&fixture, &format!("line-range anchor record, `{quoted}`"))
}

/// The residual, pinned rather than left implicit. An anchor whose **own path
/// contains a space** is byte-identical to why prose that quotes an address:
/// `parse_anchor_line` splits at the last space, so `my file.txt#L1-L3 rk64:…`
/// and `stale since we moved file2.txt#L1-L5 rk64:…` are the same shape to the
/// reader. The check is keyed on a whitespace-free address precisely so the
/// second round-trips, and the price is that the first is still swallowed into
/// the why by the pre-`42d28964` layout.
///
/// This test asserts the loss on purpose. Refusing here instead would hard-stop
/// every why ending in a URL — see
/// [`resolve_round_trips_url_ending_why_prose_the_old_gate_refused`] — which is
/// a far larger and far commoner class than an anchor on a path with a space in
/// it. If the residue format ever carries the boundary explicitly, this is the
/// assertion that should flip.
#[test]
fn resolve_still_loses_a_post_separator_anchor_whose_path_contains_a_space() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    for line in [
        format!("my file.txt#L1-L3 rk64:{OTHER_HASH}"),
        format!("my file.txt rk64:{OTHER_HASH}"),
    ] {
        let fixture = pre_42d28964_residue(
            &[format!("file1.txt#L1-L5 rk64:{h1}")],
            std::slice::from_ref(&line),
            std::slice::from_ref(&line),
        );
        repo.write_file(".span/m", &fixture)?;
        let out = repo.run_span(["resolve", "m", "--ours"])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "a whitespace-bearing address is read as prose, not refused; stderr=\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let span = read_span(&repo, "m")?;
        let parsed = SpanFile::parse(&span)?;
        assert_eq!(
            parsed.anchors.len(),
            1,
            "known residual: the anchor is not tracked, it landed in the why; span:\n{span}"
        );
        assert!(
            parsed.why.contains(&line),
            "known residual: it survives as prose rather than being deleted outright; \
             span:\n{span}"
        );
    }
    Ok(())
}

/// The over-refusal guard, and the reason the why-side check is keyed on a
/// *whitespace-free* address rather than on the address form: why prose that
/// *quotes* an anchor absorbs the surrounding words into the parsed path, so it
/// is still prose and must still round-trip. Driver-generated, because this is a
/// shape the writer really does produce.
#[test]
fn resolve_accepts_why_prose_that_quotes_an_anchor_address() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_and_why_residue(
        &repo,
        &format!("stale since we moved file2.txt#L1-L5 rk64:{OTHER_HASH}"),
        "their rationale",
    )?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "a quoted anchor address inside why prose is not a misplaced anchor; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    let parsed = SpanFile::parse(&span)?;
    assert_eq!(
        parsed.anchors.len(),
        1,
        "the quoted address must not become a second anchor; span:\n{span}"
    );
    assert!(
        parsed.why.contains("stale since we moved file2.txt#L1-L5"),
        "the quote must survive as prose; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 21. An anchor `--rehash` cannot verify
//
// The residue writer puts only same-key residue inside the conflict block and
// copies every other anchor into *both* split sides, so driver-produced input
// always has identical key sets on ours and theirs. A guard keyed on
// orphanhood therefore could not fire on the input it was written for.
// Readability, not orphanhood, is what `--rehash` needs — and only `--rehash`:
// an unreadable source is the entire reason `--ours`/`--theirs` exist.
// ---------------------------------------------------------------------------

/// Driver residue carrying one divergent anchor plus an agreed anchor whose
/// file does not exist in the worktree — the anchor the old guard could never
/// see, because the writer coalesces it outside the block and onto both sides.
fn deleted_source_residue(repo: &TestRepo) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let dead = format!("gone.txt#L1-L3 rk64:{OTHER_HASH}");
    let base = format!("{dead}\nfile1.txt#L1-L5 rk64:{h1}\n\nshared rationale\n");
    let ours = format!("{dead}\nfile1.txt#L1-L5 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!("{dead}\nfile1.txt#L1-L5 rk64:{THIRD_HASH}\n\nshared rationale\n");
    let residue = driver_residue(repo, &base, &ours, &theirs, "7")?;
    assert!(
        residue
            .lines()
            .any(|l| l == dead && !residue.starts_with("<<<<<<<")),
        "fixture assumption: the agreed dead anchor is written outside the block, which is \
         what put it on both split sides; residue=\n{residue}"
    );
    Ok(residue)
}

#[test]
fn resolve_rehash_refuses_an_anchor_whose_source_is_gone() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = deleted_source_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(
        out.status.code(),
        Some(0),
        "an anchor `--rehash` cannot verify must not pass as `unchanged`; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("gone.txt#L1-L3") && stderr.contains("source unreadable"),
        "the refusal must name the anchor it could not verify; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("--ours") && stderr.contains("--theirs"),
        "the refusal must still point at the sides that can settle it; stderr=\n{stderr}"
    );
    // The offer is made because both sides were evaluated against this file
    // and settle it — not as a standing property of side flags. The retired
    // sentence promised that both "leave every other anchor exactly as the
    // merge produced it", which nothing in the run checked and which was false
    // on the inputs where the boundary had been misreconstructed; it was the
    // specific reassurance that made the damaging next command feel safe.
    assert!(
        !stderr.contains("exactly as the merge produced it"),
        "the remediation must not promise safety it never verified; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("evaluating them against this file just now"),
        "it must say the offer was derived from this input; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

/// The card's headline path, guarded end to end: a divergent `--why` with no
/// merge base is a well-formed input that simply needs a side, `--rehash`
/// refuses it, and the refusal has to route to a side flag that then works.
/// Narrowing the remediation for finding 4 must not cost this.
#[test]
fn resolve_rehash_why_divergence_refuses_then_the_offered_side_works() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_and_why_residue(&repo, "rationale ours", "rationale theirs")?;
    repo.write_file(".span/m", &residue)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("--why"),
        "the blocker must be named; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("git span resolve m --ours")
            && stderr.contains("git span resolve m --theirs"),
        "and both sides must still be offered as the exit; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");

    // The offer is only honest if it holds, so take it.
    let out = repo.run_span(["resolve", "m", "--theirs"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "the side the refusal offered must settle the file; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("rationale theirs") && !span.contains("<<<<<<<"),
        "span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 23. The structural line states what the split showed, not what the kernel
//     had left over afterwards
// ---------------------------------------------------------------------------

/// `structural_only` used to be read off `result.unresolved` *after* the kernel
/// merge, which is empty on exactly the successful `--rehash` runs where
/// residue existed and re-hashing settled it. The report then printed "no
/// residue required the requested side" directly beneath a per-anchor line
/// saying the anchor was re-hashed because the sides disagreed.
#[test]
fn resolve_rehash_does_not_call_a_settled_divergence_structural() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_only_residue(&repo, "7")?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("re-hashed from the worktree"),
        "fixture assumption: this run settles real residue by re-hashing; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("no residue required the requested side"),
        "the two lines contradict each other; stdout=\n{stdout}"
    );
    Ok(())
}

/// The other half: the line still fires where it is true. This fixture is
/// deliberately **not** driver output — the writer emits markers only for a
/// same-key hash divergence, so residue with nothing contested cannot come from
/// it. It is hand-built to stand for a conflict-markered file whose two sides
/// differ only by which anchors they carry, which the kernel unions without
/// consulting the chosen side at all.
#[test]
fn resolve_reports_a_genuinely_structural_merge_as_structural() -> Result<()> {
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

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("no residue required the requested side"),
        "nothing here was contested, so the line is the honest summary; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("kept ours"),
        "and nothing may be reported as decided by the side flag; stdout=\n{stdout}"
    );
    Ok(())
}

/// The other half, and the half a uniform refusal would have broken: taking a
/// side is exactly how an operator gets past a source that is gone, so the
/// anchor is written — with the report saying it was never verified, instead of
/// the bare `unchanged` that claimed a check nobody performed.
#[test]
fn resolve_ours_writes_an_unverifiable_anchor_and_says_so() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = deleted_source_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "taking a side is the documented way past an unreadable source; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("gone.txt#L1-L3"),
        "the operator chose this side; the anchor must survive; span:\n{span}"
    );
    assert!(
        stdout.contains("unverified") && stdout.contains("gone.txt#L1-L3"),
        "the report must not present an unverifiable anchor as a settled one; stdout=\n{stdout}"
    );
    // The half the warning alone never covered: the per-anchor line for the
    // same anchor still read `unchanged`, so one report said the anchor was
    // never checked and, three lines up, that both sides agreed on a hash the
    // run had verified. `gone.txt` is agreed residue-adjacent content copied
    // into both split sides, which is exactly the shape that produced
    // `unchanged`.
    assert!(
        !stdout.contains("gone.txt#L1-L3: unchanged"),
        "the anchor line must not claim a check the run could not perform; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("gone.txt#L1-L3: unverified"),
        "and it must say what it actually did instead; stdout=\n{stdout}"
    );
    // file1.txt is readable, so its line keeps its ordinary wording — the
    // suffix must track the source, not smear across the whole report.
    assert!(
        stdout.contains("file1.txt#L1-L5: kept ours"),
        "a verifiable anchor keeps its plain outcome; stdout=\n{stdout}"
    );
    Ok(())
}

/// The regression gate both evaluators asked for, scoped to `--rehash` because
/// only `--rehash` claims worktree truth: after it succeeds, nothing it wrote
/// may be drifting. Under `--ours`/`--theirs` a dead anchor legitimately
/// survives, so the same assertion there would fail on correct behavior.
#[test]
fn resolve_rehash_leaves_no_drift_behind() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = anchor_only_residue(&repo, "7")?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    repo.run_git(["add", ".span/m"])?;
    let drift = repo.run_span(["drift"])?;
    assert_eq!(
        drift.status.code(),
        Some(0),
        "a span `--rehash` settled must be drift-clean; stdout=\n{}\nstderr=\n{}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );
    Ok(())
}

/// The two rename dead ends, from `resolve`'s seat. `resolve` does not run
/// `drift --fix`'s rename-pruning stage, so a source renamed away — whether it
/// has one plausible new home or several — reaches `--rehash` as an anchor with
/// no readable source and is refused by name rather than cloned with a stale
/// hash. `--ours` then carries it, which is the operator deciding the rename
/// question themselves.
fn renamed_away_case(candidates: &[&str]) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let mut lines = vec![format!("old/name.txt#L1-L5 rk64:{OTHER_HASH}")];
    for candidate in candidates {
        repo.write_file(candidate, ORIGINAL)?;
        lines.push(format!("{candidate}#L1-L5 rk64:{h1}"));
    }
    lines.sort();
    let anchors = lines.join("\n");
    let base = format!("{anchors}\n\nshared rationale\n");
    let ours = format!("{anchors}\n\nshared rationale\n");
    let theirs = format!(
        "{}\n\nshared rationale\n",
        anchors.replacen(OTHER_HASH, THIRD_HASH, 1)
    );
    let residue = driver_residue(&repo, &base, &ours, &theirs, "7")?;
    repo.write_file(".span/m", &residue)?;
    let before = read_span_bytes(&repo, "m")?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        stderr.contains("old/name.txt#L1-L5"),
        "the refusal must name the path that is gone rather than guess its new home; \
         stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "the side flags remain the exit; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("unverified") && stdout.contains("old/name.txt#L1-L5"),
        "and they must not claim the carried anchor was verified; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_rehash_refuses_a_source_renamed_away_with_one_candidate() -> Result<()> {
    renamed_away_case(&["new/name.txt"])
}

#[test]
fn resolve_rehash_refuses_a_source_renamed_away_with_ambiguous_candidates() -> Result<()> {
    renamed_away_case(&["new/one.txt", "new/two.txt"])
}

// ---------------------------------------------------------------------------
// 22. Stage 3 consulted for absence, not only presence
// ---------------------------------------------------------------------------

/// The deletion direction of the why supplement. `theirs` deletes prose `ours`
/// still has; the field has not diverged, so the writer emits `ours_why`
/// verbatim into the residue text and both split sides read it as an agreed
/// outside line. Stage 3 is the only record that the deletion happened.
#[test]
fn resolve_honors_a_why_the_peer_deleted() -> Result<()> {
    let base = format!("later.txt#L1-L3 rk64:{BASE_HASH}\n\nours prose\n");
    let ours = format!("later.txt#L1-L3 rk64:{OTHER_HASH}\n\nours prose\n");
    let theirs = format!("later.txt#L1-L3 rk64:{THIRD_HASH}\n");
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    assert!(
        residue.contains("ours prose"),
        "fixture assumption: the writer fabricates agreement by carrying ours' why; \
         residue=\n{residue}"
    );

    for side in ["--rehash", "--theirs"] {
        repo.write_file(".span/m", &residue)?;
        let out = repo.run_span(["resolve", "m", side])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "{side}: stderr=\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let span = read_span(&repo, "m")?;
        assert!(
            !span.contains("ours prose"),
            "{side} must not resurrect a why the peer deliberately deleted; span:\n{span}"
        );
    }
    Ok(())
}

/// The presence direction must keep working, and a hand-typed why must still
/// be untouchable — the two properties the deletion fix could most easily have
/// broken, since it reads the same stage from the same shape of text.
#[test]
fn resolve_why_supplement_still_ignores_a_hand_typed_why() -> Result<()> {
    let (base, ours, theirs) = theirs_only_why_sides();
    let (repo, residue) = mid_merge_repo(&base, &ours, &theirs)?;
    let hand_edited = format!("{residue}operator rationale\n");
    repo.write_file(".span/m", &hand_edited)?;

    let out = repo.run_span(["resolve", "m", "--theirs"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("operator rationale") && !span.contains("rationale Y"),
        "a why that differs from stage 2 is the operator's and is never replaced; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 23. A stage that cannot be read never becomes a value
//
// These fixtures are deliberately not driver-generated: the producer is a
// `.span/` file committed with conflict markers still in it (the `git add`
// reflex), which stages a blob `SpanFile::parse` fails closed on by design.
// Building that index state directly is the honest way to reach it.
// ---------------------------------------------------------------------------

fn hash_blob(repo: &TestRepo, content: &str) -> Result<String> {
    use std::io::Write;
    let mut child = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(content.as_bytes())?;
    let out = child.wait_with_output()?;
    assert!(out.status.success(), "git hash-object failed");
    Ok(String::from_utf8(out.stdout)?.trim().to_string())
}

/// Put `.span/m` into the index at all three unmerged stages.
fn stage_all_three(repo: &TestRepo, s1: &str, s2: &str, s3: &str) -> Result<()> {
    use std::io::Write;
    let info = format!(
        "100644 {} 1\t.span/m\n100644 {} 2\t.span/m\n100644 {} 3\t.span/m\n",
        hash_blob(repo, s1)?,
        hash_blob(repo, s2)?,
        hash_blob(repo, s3)?
    );
    let mut child = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["update-index", "--index-info"])
        .stdin(std::process::Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(info.as_bytes())?;
    assert!(child.wait()?.success(), "git update-index failed");
    Ok(())
}

/// One mechanism, two mirror-image witnesses: whichever stage fails to parse,
/// the swallowed error used to become a `SpanConfig::default()` for that side
/// that then *won* the three-way merge and was reported as an arbitration
/// result, with `[config]` absent from the written file and no warning at all.
fn unreadable_stage_case(unreadable_stage: u8) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let good = format!(
        "file1.txt#L1-L5 rk64:{h1}\n\nshared rationale\n\n[config]\nfollow_moves = true\n"
    );
    // A span file someone committed mid-conflict: markers intact, so
    // `SpanFile::parse` fails closed on it exactly as designed.
    let marked = format!(
        "<<<<<<< ours\nfile1.txt#L1-L5 rk64:{OTHER_HASH}\n=======\n\
         file1.txt#L1-L5 rk64:{THIRD_HASH}\n>>>>>>> theirs\n\nshared rationale\n\n\
         [config]\nfollow_moves = true\n"
    );
    let (s2, s3) = if unreadable_stage == 2 {
        (marked.as_str(), good.as_str())
    } else {
        (good.as_str(), marked.as_str())
    };
    stage_all_three(&repo, &good, s2, s3)?;

    let residue = format!(
        "<<<<<<< ours\nfile1.txt#L1-L5 rk64:{OTHER_HASH}\n=======\n\
         file1.txt#L1-L5 rk64:{THIRD_HASH}\n>>>>>>> theirs\n\nshared rationale\n"
    );
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "stderr=\n{stderr}");

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("follow_moves = true"),
        "the setting both readable stages carry must survive a stage that does not parse; \
         span:\n{span}"
    );
    assert!(
        stderr.contains("could not be read") && stdout.contains("could not be read"),
        "a failed stage read must be reported, not swallowed; stdout=\n{stdout}\nstderr=\n{stderr}"
    );
    assert!(
        !stdout.contains("config: resolved automatically"),
        "no arbitration happened here — a blob simply failed to parse; stdout=\n{stdout}"
    );
    // Nor may the label fall back to claiming agreement: only one side's
    // `[config]` was ever read, and the other's value is `resolve`'s own
    // unchanged-from-base inference. The label has to name which side spoke.
    assert!(
        !stdout.contains("config: unchanged"),
        "a side whose blob failed to parse asserted nothing to agree with; stdout=\n{stdout}"
    );
    let side_that_spoke = if unreadable_stage == 2 { "theirs" } else { "ours" };
    assert_eq!(
        field_lines(&stdout, "config:"),
        vec![format!(
            "config: taken from {side_that_spoke} — {}' `[config]` was never read",
            if unreadable_stage == 2 { "ours" } else { "theirs" }
        )],
        "the label must name the side the value actually came from; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn resolve_unreadable_ours_stage_never_becomes_a_config_value() -> Result<()> {
    unreadable_stage_case(2)
}

#[test]
fn resolve_unreadable_theirs_stage_never_becomes_a_config_value() -> Result<()> {
    unreadable_stage_case(3)
}

// ---------------------------------------------------------------------------
// 12. Discoverability: every surface an operator hits while a span is
//     conflicted names `git span resolve`
//
// The command was complete and unreachable — `show`/`list`/`why` refused the
// file with an instruction to open a text editor (verbatim the option
// `resolve` replaces), `drift` rendered a bare `— conflict` row, and
// `drift --fix`'s bail-outs said "resolve manually". Nothing named the
// command, and no test asserted on the absence of a pointer, so it escaped.
// These assert presence at each surface.
//
// Every fixture below is a real mid-merge repo: real `MERGE_HEAD`, real
// unmerged stages, driver-produced residue. That matters here more than
// elsewhere, because what is under test is the message an operator sees when
// they are actually mid-merge.
// ---------------------------------------------------------------------------

/// The pointer every conflicted surface must carry: the command, named with
/// the span, and `--dry-run` — not a side, which is the operator's choice.
fn assert_names_resolve(text: &str, surface: &str) {
    assert!(
        text.contains("git span resolve m --dry-run"),
        "`{surface}` must name `git span resolve m --dry-run`; output=\n{text}"
    );
}

/// The instruction the pointer replaces. A surface that still says this has
/// sent the operator to a text editor.
fn assert_no_editor_instruction(text: &str, surface: &str) {
    assert!(
        !text.contains("Resolve the merge conflict in the span file"),
        "`{surface}` must not send the operator to a text editor; output=\n{text}"
    );
}

#[test]
fn show_conflict_refusal_names_resolve() -> Result<()> {
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["show", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "show must still refuse");
    assert!(
        stderr.contains("Git conflict state"),
        "show must still name the conflict; stderr=\n{stderr}"
    );
    assert_names_resolve(&stderr, "show");
    assert_no_editor_instruction(&stderr, "show");
    Ok(())
}

#[test]
fn list_conflict_refusal_names_resolve() -> Result<()> {
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["list"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "list must still refuse");
    assert_names_resolve(&stderr, "list");
    assert_no_editor_instruction(&stderr, "list");
    Ok(())
}

#[test]
fn why_conflict_refusal_names_resolve() -> Result<()> {
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["why", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "why must still refuse");
    // `why` used to surface the bare `Error::SpanConflict` Display — a
    // diagnosis with no next step at all.
    assert!(
        stderr.contains("What to do next"),
        "why's refusal must carry a remediation section; stderr=\n{stderr}"
    );
    assert_names_resolve(&stderr, "why");
    Ok(())
}

#[test]
fn drift_conflict_report_names_resolve() -> Result<()> {
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;

    let out = repo.run_span(["drift"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("conflict"),
        "drift must still report the conflict; stdout=\n{stdout}"
    );
    assert_names_resolve(&stdout, "drift");
    Ok(())
}

#[test]
fn drift_fix_poisoned_source_bailout_names_resolve() -> Result<()> {
    // Card dead end 1: `--fix` aborts the whole span because the anchored
    // source is itself conflicted. This is the case `resolve --ours`/
    // `--theirs` handles perfectly — it settles from the residue text and
    // never reads that source — so the bail-out may say so plainly.
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;
    repo.write_file(
        "later.txt",
        "<<<<<<< HEAD\nalpha\n=======\nALPHA\n>>>>>>> side\nbravo\ncharlie\ndelta\n",
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("cannot resolve conflict in `m`")
            && stderr.contains("contains conflict markers"),
        "the poisoned-source bail-out must still fire; stderr=\n{stderr}"
    );
    assert!(
        stderr.contains("git span resolve m --ours"),
        "the poisoned-source bail-out must name the side flags that settle it \
         without reading that source; stderr=\n{stderr}"
    );
    assert_names_resolve(&stderr, "drift --fix");
    assert!(
        !stderr.contains("resolve manually"),
        "the bail-out must not still end at a text editor; stderr=\n{stderr}"
    );
    // And the claim has to be true: `--ours` must actually settle this file.
    let settled = repo.run_span(["resolve", "m", "--ours"])?;
    assert_eq!(
        settled.status.code(),
        Some(0),
        "the bail-out promised `--ours` settles this; it must; stderr=\n{}",
        String::from_utf8_lossy(&settled.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("<<<<<<<"),
        "the span must be clean after the advised command; span:\n{span}"
    );
    Ok(())
}

#[test]
fn drift_fix_does_not_advise_re_running_itself_on_a_pure_conflict() -> Result<()> {
    // The evaluator's exact sequence: the operator follows `--fix`, it
    // dead-ends, and the summary tells them to re-run the thing that just
    // failed. A conflicted span file is not analyzable until it is settled,
    // so "run git span drift again" is the one advice that cannot help here.
    let (base, ours, theirs) = shared_why_sides();
    let (repo, _) = mid_merge_repo(&base, &ours, &theirs)?;
    repo.write_file(
        "later.txt",
        "<<<<<<< HEAD\nalpha\n=======\nALPHA\n>>>>>>> side\nbravo\ncharlie\ndelta\n",
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("anchor remains drifted"),
        "the count line must still report what remains; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("run git span drift again"),
        "re-running drift cannot settle a conflict; stdout=\n{stdout}"
    );
    assert_names_resolve(&stdout, "drift --fix");
    Ok(())
}

// ---------------------------------------------------------------------------
// 27. The same shape on the *anchor* side of the separator
//
// `AnchorLineShape`'s record variants fell through to permit in both arms of
// `boundary_violation`. The post-separator half was closed first, where the
// cost is a deleted anchor; this is the pre-separator half, where the cost is a
// fabricated one — prose written back as a tracked coupling whose path is a
// word lifted out of the operator's own sentence.
//
// The producer is a hand-edited conflicted file, which `resolve` itself routes
// operators to: its refusals say editing the file by hand remains available.
// So the layout below is generated by the real writer and only the *contents*
// of the block are hand-edited, which is exactly what such an operator does.
// ---------------------------------------------------------------------------

/// Driver-generated residue — one resolved anchor outside the block, one
/// anchor-residue block before the separator, the separator, then the why —
/// with the two lines inside the block replaced by whatever an operator typed
/// there. Every structural assumption is asserted against the generated text
/// before the edit, so the fixture cannot drift into some other shape and keep
/// passing.
fn hand_edited_anchor_block(
    repo: &TestRepo,
    ours_line: &str,
    theirs_line: &str,
) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let kept = format!("file1.txt#L1-L5 rk64:{h1}");
    let contested_ours = format!("file2.txt#L1-L5 rk64:{OTHER_HASH}");
    let contested_theirs = format!("file2.txt#L1-L5 rk64:{THIRD_HASH}");
    let base = format!("{kept}\nfile2.txt#L1-L5 rk64:{h2}\n\nshared rationale\n");
    let ours = format!("{kept}\n{contested_ours}\n\nshared rationale\n");
    let theirs = format!("{kept}\n{contested_theirs}\n\nshared rationale\n");
    let residue = driver_residue(repo, &base, &ours, &theirs, "7")?;

    assert_eq!(
        residue.matches("<<<<<<<").count(),
        1,
        "fixture assumption: one anchor-residue block; residue=\n{residue}"
    );
    let block_at = residue.find("<<<<<<<").expect("block");
    let separator_at = residue
        .find(">>>>>>>")
        .map(|close| residue[close..].find("\n\n").expect("separator") + close)
        .expect("close marker");
    assert!(
        block_at < separator_at,
        "fixture assumption: the block sits *before* the blank-line separator, which is where \
         the current writer puts anchor residue; residue=\n{residue}"
    );
    assert!(
        residue[..block_at].contains(&kept),
        "fixture assumption: the agreed anchor is written outside the block; residue=\n{residue}"
    );

    let edited = residue
        .replace(&contested_ours, ours_line)
        .replace(&contested_theirs, theirs_line);
    assert!(
        edited.contains(ours_line) && edited.contains(theirs_line),
        "the hand edit must have landed; edited=\n{edited}"
    );
    Ok(edited)
}

/// The fabrication this closes. `See https://example.com` splits at the last
/// space into address `See` and hash part `https://example.com`, so its
/// whole-file address carries no whitespace and the path test cannot see it.
/// Settled, it became a tracked coupling at path `See`, extent `WholeFile` — at
/// exit 0, from a line the operator wrote as prose.
///
/// Worse, `--ours` imported *theirs'* fabrication too, because two different
/// sentences parse to two different paths, so neither is contested and the
/// kernel's union branch keeps both. A side flag arbitrates divergent hashes,
/// not membership; the fix is to stop the sentences becoming anchors at all.
#[test]
fn resolve_refuses_prose_inside_the_anchor_residue_block() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = hand_edited_anchor_block(
        &repo,
        "See https://example.com",
        "Ref https://other.example",
    )?;
    every_side_refuses(&fixture, "content hash is not the sixteen lowercase hex digits")?;

    // Not just refused — refused naming the line the operator typed, so the
    // message points at the edit rather than at the block in general.
    let repo2 = TestRepo::seeded()?;
    repo2.write_file(".span/m", &fixture)?;
    let out = repo2.run_span(["resolve", "m", "--ours"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let flattened = stderr.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        flattened.contains("`See https://example.com`"),
        "the refusal must quote the offending line; stderr=\n{stderr}"
    );
    Ok(())
}

/// The same discriminator, in the shape the whitespace test alone would have
/// missed the other way: one word, then a colon-bearing token that is not a
/// URL. Both sides of the block are prose here, so this is the pre-separator
/// twin of `resolve_accepts_one_word_why_prose_whose_last_token_merely_holds_a_colon`
/// — except that before the separator the answer is a refusal, since prose has
/// no business in the anchor block at all and settling it fabricates.
#[test]
fn resolve_refuses_a_colon_bearing_word_inside_the_anchor_residue_block() -> Result<()> {
    for (ours_line, theirs_line) in [
        ("tracked rfc:1234", "untracked rfc:5678"),
        ("Docs docs:v2", "Docs docs:v3"),
    ] {
        let repo = TestRepo::seeded()?;
        let fixture = hand_edited_anchor_block(&repo, ours_line, theirs_line)?;
        every_side_refuses(&fixture, "content hash is not the sixteen lowercase hex digits")
            .map_err(|e| e.context(format!("line `{ours_line}`")))?;
    }
    Ok(())
}

/// The guard on the new refusal's polarity: it must never fire on a line a
/// writer produced. A genuine anchor record inside the anchor-residue block —
/// in **either** address form, since `Display` writes a whole-file anchor with
/// no `#L` — still settles at exit 0 and is still tracked afterwards.
///
/// This is what makes the hash test free here. Every record the writer puts
/// before the separator carries sixteen lowercase hex by construction
/// (`rk64_to_hex` is `format!("{fp:016x}")`), so everything the refusal newly
/// rejects is a line no writer emits in this region.
#[test]
fn resolve_still_settles_a_genuine_anchor_record_before_the_separator() -> Result<()> {
    for (address, expected_path) in [("file2.txt#L1-L5", "file2.txt"), ("file2.txt", "file2.txt")] {
        let repo = TestRepo::seeded()?;
        let h1 = line_slice_hash(ORIGINAL, 1, 5);
        let kept = format!("file1.txt#L1-L5 rk64:{h1}");
        let ours_line = format!("{address} rk64:{OTHER_HASH}");
        let theirs_line = format!("{address} rk64:{THIRD_HASH}");
        assert_writer_shaped_hash(&ours_line);
        let base = format!("{kept}\n{address} rk64:{}\n\nshared rationale\n", "1".repeat(16));
        let ours = format!("{kept}\n{ours_line}\n\nshared rationale\n");
        let theirs = format!("{kept}\n{theirs_line}\n\nshared rationale\n");
        let fixture = driver_residue(&repo, &base, &ours, &theirs, "7")?;
        assert!(
            fixture.contains("<<<<<<<"),
            "fixture assumption: the divergent anchor is residue; fixture=\n{fixture}"
        );

        repo.write_file(".span/m", &fixture)?;
        let out = repo.run_span(["resolve", "m", "--ours"])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "a writer-shaped record before the separator must still settle; stderr=\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let span = read_span(&repo, "m")?;
        let parsed = SpanFile::parse(&span)?;
        assert!(
            parsed
                .anchors
                .iter()
                .any(|a| a.path == expected_path && a.content_hash == OTHER_HASH),
            "ours' side of the contested anchor must be tracked; span:\n{span}"
        );
    }
    Ok(())
}
