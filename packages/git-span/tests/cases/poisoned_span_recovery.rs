//! Recovery and surfacing for a PRE-EXISTING poisoned span — a committed
//! span file that already carries an anchor pointing inside the resolved span
//! root (a hand-edit that bypassed add-time Layer-1 rejection).
//!
//! Contract:
//! - `SpanFile::parse` is a pure text→struct transform, so a poisoned span
//!   stays loadable and repairable.
//! - `stale`/`doctor` surface the interior anchor per-span as a loud,
//!   actionable report, while still reporting other (clean) spans — one
//!   poisoned span never blanks the whole corpus.
//! - `remove`/`delete` repair the poisoned span; `stale --fix` does NOT
//!   silently no-op (it excises the offending anchor); `show`/`list` operate.

use crate::support;

use anyhow::Result;
use support::TestRepo;

const POISON_HASH: &str =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Seed a repo with one CLEAN span and one POISONED span (carrying a
/// span-root-interior anchor), both committed. Returns the repo.
fn repo_with_poisoned_and_clean_span() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\nline3\n")?;
    repo.commit_all("seed source")?;

    // Clean span authored the supported way.
    let out = repo.run_span(["add", "clean/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "seeding clean span failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Poisoned span: hand-written with an anchor inside `.span`.
    repo.write_file(
        ".span/poison",
        &format!(".span/clean/flow {POISON_HASH}\n\nSmuggled a span document as an anchor.\n"),
    )?;
    repo.commit_all("commit clean + poisoned spans")?;
    repo.write_commit_graph()?;
    Ok(repo)
}

#[test]
fn stale_surfaces_poison_per_span_without_blanking_clean_span() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    // Make the clean span drift so stale has something to report for it too.
    repo.write_file("src/lib.rs", "line1\nCHANGED\nline3\n")?;

    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "stale must exit non-zero with a poisoned span present;\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    // Poison surfaced, actionably, naming file/anchor/root/fix.
    assert!(
        stderr.contains("interior-anchor"),
        "report header missing; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".span/poison"),
        "report must name the span file; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove poison .span/clean/flow"),
        "report must name a working repair command; stderr:\n{stderr}"
    );
    // The clean span's drift is still reported on stdout — not blanked.
    assert!(
        stdout.contains("clean/flow"),
        "clean span must still be reported; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
fn doctor_surfaces_poison_per_span() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !out.status.success(),
        "doctor must exit non-zero when an interior anchor is present;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains(".span/poison") && stdout.contains("git span remove poison"),
        "doctor must name the poisoned span and a working fix; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
fn remove_repairs_poisoned_span() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    let out = repo.run_span(["remove", "poison", ".span/clean/flow"])?;
    assert!(
        out.status.success(),
        "remove must drop the offending anchor;\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    // The interior anchor is gone — doctor reports no interior violation now.
    let doctor = repo.run_span(["doctor"])?;
    let dout = String::from_utf8_lossy(&doctor.stdout);
    assert!(
        !dout.contains(".span/clean/flow"),
        "interior anchor must be gone after remove; doctor stdout:\n{dout}"
    );
    Ok(())
}

#[test]
fn delete_succeeds_on_poisoned_span() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    let out = repo.run_span(["delete", "poison"])?;
    assert!(
        out.status.success(),
        "delete must remove the whole poisoned span;\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let list = repo.run_span(["list"])?;
    let lout = String::from_utf8_lossy(&list.stdout);
    assert!(
        list.status.success(),
        "list must operate after delete;\nstderr:\n{}",
        String::from_utf8_lossy(&list.stderr)
    );
    assert!(
        !lout.contains("poison"),
        "deleted poisoned span must not appear in list; stdout:\n{lout}"
    );
    Ok(())
}

#[test]
fn stale_fix_does_not_silently_noop_on_poisoned_span() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    let _ = repo.run_span(["stale", "--fix"])?;

    // --fix must ACT — never silently skip. The offending anchor line must
    // have been excised from the worktree span file.
    let contents = std::fs::read_to_string(repo.path().join(".span/poison"))?;
    assert!(
        !contents.contains(".span/clean/flow"),
        "stale --fix must excise the interior anchor (not silently no-op); span file now:\n{contents}"
    );
    Ok(())
}

/// `git span stale <filepath>` where the span anchoring `<filepath>` ALSO
/// carries an interior anchor must surface the violation and exit non-zero,
/// matching the behavior of bare `stale` and span-name-form `stale`.
///
/// Regression guard for the literal `p == &v.span_name` compare that silently
/// dropped in-scope interior violations when the arg was a file path rather than
/// a span name.
#[test]
fn scoped_stale_by_filepath_surfaces_interior_violation() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\nline3\n")?;
    repo.commit_all("seed source")?;

    // Create a legitimate span that anchors src/lib.rs.
    let out = repo.run_span(["add", "my/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "seeding span failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Hand-inject an interior anchor into that same span file, simulating a
    // bypass of the add-time Layer-1 check. The span file format is:
    //   <anchor-line>+\n\n<why>\n
    // Read the file, split at the blank line, prepend the interior anchor to
    // the anchors section, then rejoin.
    let span_path = repo.path().join(".span/my/flow");
    let current = std::fs::read_to_string(&span_path)?;
    // Split on first blank line (anchors / why separator).
    let (anchors_section, why_section) = current
        .split_once("\n\n")
        .expect("span file must contain blank-line separator");
    let poisoned = format!(
        "{anchors_section}\n.span/my/flow {POISON_HASH}\n\n{why_section}"
    );
    std::fs::write(&span_path, &poisoned)?;
    repo.commit_all("inject interior anchor into my/flow")?;
    repo.write_commit_graph()?;

    // Scoped by file path — the span my/flow anchors src/lib.rs.
    let out = repo.run_span(["stale", "src/lib.rs"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "`git span stale src/lib.rs` must exit non-zero when in-scope span carries interior anchor;\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        stderr.contains("interior-anchor"),
        "interior-anchor report header must appear; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".span/my/flow") || stderr.contains("my/flow"),
        "report must identify the span with the interior anchor; stderr:\n{stderr}"
    );

    // Span-name-form must behave identically (regression guard: this already worked).
    let out2 = repo.run_span(["stale", "my/flow"])?;
    let stderr2 = String::from_utf8_lossy(&out2.stderr);
    assert!(
        !out2.status.success(),
        "`git span stale my/flow` must also exit non-zero; stderr:\n{stderr2}"
    );
    assert!(
        stderr2.contains("interior-anchor"),
        "span-name-form stale must report interior anchor; stderr:\n{stderr2}"
    );

    Ok(())
}

#[test]
fn list_operates_with_poisoned_span_present() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_span()?;

    let out = repo.run_span(["list"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "list must operate despite a poisoned span;\nstderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Both spans still enumerated — one poison does not blank the corpus.
    assert!(
        stdout.contains("clean/flow") && stdout.contains("poison"),
        "list must enumerate both spans; stdout:\n{stdout}"
    );
    Ok(())
}
