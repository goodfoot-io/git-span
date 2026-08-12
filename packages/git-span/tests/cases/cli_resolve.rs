//! CLI: `git span resolve <name>` — settle a conflict-markered span file
//! under one explicitly chosen side.
//!
//! Every fixture here is built with **no real unmerged index stages**: the
//! text-sourcing path is the whole of what `resolve` reads today, so a
//! hand-assembled or driver-generated worktree file is the honest input. Any
//! fixture that stands in for real driver output is produced by running
//! `git span merge-driver` itself ([`driver_residue`]) rather than
//! hand-written, because hand-written residue has concealed real defects
//! before. The two fixtures that are deliberately *not* driver-shaped —
//! the `[config]`-inside-a-block refusal and the fabricated-anchor witness —
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

/// The driver-shaped residue both 8b and 8g need: an anchor-only conflict
/// block on `file1.txt#L1-L5`, with a why that is identical on both sides and
/// therefore silently omitted by the residue writer.
fn anchor_only_residue(repo: &TestRepo, marker_len: &str) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let base = format!("file1.txt#L1-L5 rk64:{h1}\n\nshared rationale\n");
    let ours = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!("file1.txt#L1-L5 rk64:{THIRD_HASH}\n\nshared rationale\n");
    driver_residue(repo, &base, &ours, &theirs, marker_len)
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
    // The residue writer omits the why paragraph entirely when the why is not
    // the conflicting field — so the worktree text carries no why at all.
    let residue = anchor_only_residue(&repo, "7")?;
    assert!(
        !residue.contains("shared rationale"),
        "this fixture only tests why-loss if the driver really dropped the why; \
         residue=\n{residue}"
    );
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0));
    assert!(
        stdout.contains("no why paragraph found in the input")
            && stdout.contains("No unmerged index stages were available"),
        "the why-loss ceiling must be reported loudly; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        !span.contains("shared rationale"),
        "the why genuinely cannot be recovered from text alone; span:\n{span}"
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

#[test]
fn resolve_refuses_multiple_conflict_blocks() -> Result<()> {
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
        stderr.contains("2 conflict blocks") && stderr.contains("at most one"),
        "the refusal must name the count; stderr=\n{stderr}"
    );
    assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    Ok(())
}

#[test]
fn resolve_refuses_fabricated_anchor_from_why_prose() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    // Deliberately NOT driver-shaped: the witness for the anchor/why boundary
    // heuristic fabricating an anchor out of a URL-ending why line.
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
docs at https://example.com
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
docs at https://example.com
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
            stderr.contains("https") && stderr.contains("rk64"),
            "{side} must cite the fabricated algorithm token; stderr=\n{stderr}"
        );
        assert_eq!(before, read_span_bytes(&repo, "m")?, "file must be untouched");
    }
    Ok(())
}

#[test]
fn resolve_algorithm_gate_does_not_reject_ordinary_why_with_colon() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let fixture = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{OTHER_HASH}

Authority: see the schema doc
=======
file1.txt#L1-L5 rk64:{THIRD_HASH}

Authority: see the schema doc
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "a colon inside prose is not an anchor; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("Authority: see the schema doc"),
        "the why must survive intact; span:\n{span}"
    );
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "the anchor must be re-hashed from the worktree; span:\n{span}"
    );
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
