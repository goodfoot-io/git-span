//! Rejection of anchors whose path falls inside the resolved span root.
//!
//! Two enforcement layers:
//! - Layer 1 (add-time): `git span add` refuses an anchor path inside the span root before
//!   any I/O, with a message naming both the offending path and the span root.
//! - Layer 2 (read-time surfacing): `SpanFile::parse` stays a pure text→struct transform so a
//!   poisoned span remains loadable and repairable. `stale`/`doctor` surface the interior
//!   anchor per-span as a loud, actionable report (without aborting the whole corpus), while
//!   `show`/`list`/`remove`/`delete` continue to operate on the poisoned span.
//!
//! Tests are modeled on `round2_eval_qa_fixes.rs` and `add_gitignored_anchor_reject.rs`.

use crate::support;

use anyhow::Result;
use std::process::Command;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Layer 1 — add-time, default root (.span)
// ---------------------------------------------------------------------------

/// `git span add foo .span/bar` must fail with a message naming both the
/// offending path and the span root.
#[test]
fn add_rejects_anchor_inside_default_span_root() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo/flow", ".span/bar"])?;
    assert!(
        !out.status.success(),
        "add must reject an anchor inside the span root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains(".span/bar"),
        "error must name the offending path; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".span"),
        "error must name the span root; stderr:\n{stderr}"
    );
    Ok(())
}

/// The span root entry itself (`.span`) must be rejected as an anchor path.
#[test]
fn add_rejects_span_root_itself_as_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo/flow", ".span"])?;
    assert!(
        !out.status.success(),
        "add must reject the span root entry itself; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

/// A legitimate source anchor must still be accepted (regression guard).
#[test]
fn add_accepts_legitimate_anchor_with_default_root() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "a legitimate anchor must still be accepted; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Layer 1 — add-time, resolved root (--span-dir)
// ---------------------------------------------------------------------------

/// With `GIT_SPAN_DIR=docs/span`, an anchor `docs/span/x` is rejected.
#[test]
fn add_rejects_anchor_inside_resolved_span_dir_flag() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span_with_env(
        ["add", "demo/flow", "docs/span/x"],
        "GIT_SPAN_DIR",
        "docs/span",
    )?;
    assert!(
        !out.status.success(),
        "add must reject anchor inside configured span root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("docs/span"),
        "error must reference the span root; stderr:\n{stderr}"
    );
    Ok(())
}

/// With `GIT_SPAN_DIR=docs/span`, a literal `.span/x` anchor IS accepted
/// (proves `.span` is not special-cased when the root is elsewhere).
#[test]
fn add_accepts_dot_span_anchor_when_root_is_elsewhere() -> Result<()> {
    let repo = TestRepo::new()?;
    // Create .span/bar as a real tracked file so the existence check passes.
    repo.write_file(".span/bar", "content\n")?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span_with_env(
        ["add", "demo/flow", ".span/bar"],
        "GIT_SPAN_DIR",
        "docs/span",
    )?;
    assert!(
        out.status.success(),
        "`.span/bar` must be accepted when span root is `docs/span`; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// With `GIT_SPAN_DIR=docs/span`, an anchor `docs/span/x` is rejected.
#[test]
fn add_rejects_anchor_inside_git_span_dir_env() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
    cmd.current_dir(repo.path());
    cmd.env("GIT_SPAN_DIR", "docs/span");
    cmd.args(["add", "demo/flow", "docs/span/x"]);
    let out = cmd.output()?;

    assert!(
        !out.status.success(),
        "add must reject anchor inside GIT_SPAN_DIR root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Layer 2 — read-time enforcement via SpanFile::parse / stale / show
// ---------------------------------------------------------------------------

/// A hand-edited span file carrying a span-root-interior anchor causes
/// `git span stale` to surface an error rather than honor the anchor.
#[test]
fn stale_surfaces_error_for_span_root_anchor_in_span_file() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    // Hand-write a span file that contains an anchor inside the span root.
    // Format: "<path> <algorithm>:<hash>\n\n<why>\n"
    repo.write_file(
        ".span/bad-span",
        ".span/something sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\nBad span with span-root anchor.\n",
    )?;
    repo.commit_all("add bad span file")?;
    repo.write_commit_graph()?;

    let out = repo.run_span(["stale"])?;
    // stale surfaces the interior anchor as a loud per-span report on stderr
    // and drives a non-zero exit (fail-closed), without aborting the corpus.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "stale must exit non-zero for a span-root anchor; stdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        stderr.contains("interior-anchor") && stderr.contains(".span/something"),
        "stale must name the interior anchor in its report; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove bad-span"),
        "stale report must name a working repair command; stderr:\n{stderr}"
    );
    Ok(())
}

/// `git span show` on a span file containing a span-root anchor must still
/// operate (parse is pure) — the poisoned span stays loadable so it can be
/// inspected and repaired, rather than aborting the whole corpus.
#[test]
fn show_operates_on_span_with_span_root_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    repo.write_file(
        ".span/bad-span",
        ".span/something sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\nBad span.\n",
    )?;
    repo.commit_all("add bad span")?;

    let out = repo.run_span(["show", "bad-span"])?;
    assert!(
        out.status.success(),
        "show must operate on a poisoned span; exit {:?}\nstdout:\n{}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}
