//! CLI: `git span merge-driver` -- integration tests for the Git merge driver.
//!
//! The merge driver is invoked by Git with the standard merge-driver protocol
//! (%O %A %B %L).  These tests simulate that by writing temp files and calling
//! the binary directly.
//!
//! The merge driver NEVER trusts the worktree (source_files is empty), so
//! same-anchor hash divergence with no merge-base resolution is written as
//! minimal conflict markers and the driver exits non-zero -- Git keeps the
//! path unmerged (partial-resolution signal).

use std::path::Path;
use std::process::Command;

/// Helper: write span content to a temp file and return its path.
fn write_span_file(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
    let p = dir.join(name);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&p, content).unwrap();
    p
}

// ---------------------------------------------------------------------------
// Clean three-way merge
// ---------------------------------------------------------------------------

#[test]
fn merge_driver_resolves_clean_three_way() {
    let dir = tempfile::tempdir().unwrap();

    // Base has one anchor on a.txt.  Ours adds b.txt, theirs adds c.txt.
    // All three share the same a.txt hash and the same empty why => union.
    let base = write_span_file(dir.path(), "base", "a.txt#L1-L5 rk64:111\n\nwhy\n");
    let ours = write_span_file(
        dir.path(),
        "ours",
        "a.txt#L1-L5 rk64:111\nb.txt#L1-L3 rk64:222\n\nwhy\n",
    );
    let theirs = write_span_file(
        dir.path(),
        "theirs",
        "a.txt#L1-L5 rk64:111\nc.txt#L1-L7 rk64:333\n\nwhy\n",
    );

    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .args([
            "merge-driver",
            &base.to_string_lossy(),
            &ours.to_string_lossy(),
            &theirs.to_string_lossy(),
            "7",
        ])
        .output()
        .unwrap();

    assert_eq!(
        out.status.code(),
        Some(0),
        "expected exit 0 for clean merge; stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    // The output file is the 'ours' path (overwritten by the driver).
    let output = std::fs::read_to_string(&ours).unwrap();
    assert!(
        output.contains("a.txt#L1-L5 rk64:111"),
        "a.txt anchor; output:\n{output}"
    );
    assert!(
        output.contains("b.txt#L1-L3 rk64:222"),
        "b.txt anchor; output:\n{output}"
    );
    assert!(
        output.contains("c.txt#L1-L7 rk64:333"),
        "c.txt anchor; output:\n{output}"
    );
    assert!(
        !output.contains("<<<<<<<"),
        "no conflict markers in clean resolve; output:\n{output}"
    );
}

// ---------------------------------------------------------------------------
// Divergent same-anchor hash (no source to resolve)
// ---------------------------------------------------------------------------

#[test]
fn merge_driver_exits_non_zero_on_divergence() {
    let dir = tempfile::tempdir().unwrap();

    // Both sides have the same x.txt anchor but DIVERGENT hash on z.txt,
    // and no source files are available (merge driver never trusts the
    // worktree).  z.txt must land in unresolved => exit 1 + markers.
    let base = write_span_file(dir.path(), "base", "x.txt#L1-L5 rk64:111\n\n");
    let ours = write_span_file(
        dir.path(),
        "ours",
        "x.txt#L1-L5 rk64:111\nz.txt#L1-L3 rk64:222\n\n",
    );
    let theirs = write_span_file(
        dir.path(),
        "theirs",
        "x.txt#L1-L5 rk64:111\nz.txt#L1-L3 rk64:333\n\n",
    );

    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .args([
            "merge-driver",
            &base.to_string_lossy(),
            &ours.to_string_lossy(),
            &theirs.to_string_lossy(),
            "7",
        ])
        .output()
        .unwrap();

    assert_eq!(
        out.status.code(),
        Some(1),
        "expected exit 1 for partial resolution; stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output = std::fs::read_to_string(&ours).unwrap();
    // The common anchor (x.txt) is written cleanly.
    assert!(
        output.contains("x.txt#L1-L5 rk64:111"),
        "common anchor clean; output:\n{output}"
    );
    // The divergent anchor produces minimal conflict markers.
    assert!(
        output.contains("<<<<<<<"),
        "conflict markers expected; output:\n{output}"
    );
    assert!(
        output.contains("z.txt#L1-L3 rk64:222"),
        "our z.txt anchor; output:\n{output}"
    );
    assert!(
        output.contains("z.txt#L1-L3 rk64:333"),
        "their z.txt anchor; output:\n{output}"
    );
}

// ---------------------------------------------------------------------------
// Duplicate-collapse sentinel and same-side duplicates
// ---------------------------------------------------------------------------

/// The fixed rk64 hash `drift --fix`'s collapse plants on a survivor whose
/// content was never verified. Not all-zero: zero is the fingerprint of a
/// range that does not exist, which a deleted path produces for free.
const SENTINEL_LINE: &str = "rk64:ffffffffffffffff";

fn run_driver(
    base: &std::path::Path,
    ours: &std::path::Path,
    theirs: &std::path::Path,
) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_git-span"))
        .args([
            "merge-driver",
            &base.to_string_lossy(),
            &ours.to_string_lossy(),
            &theirs.to_string_lossy(),
            "7",
        ])
        .output()
        .unwrap()
}

#[test]
fn merge_driver_reports_preserved_sentinel_with_no_counterpart() {
    let dir = tempfile::tempdir().unwrap();

    // The driver always passes an empty source list, so this path can never
    // rehash anything -- but it must still *report* that a sentinel crossed
    // the merge, not carry it through silently.
    let base = write_span_file(dir.path(), "base", "x.txt#L1-L5 rk64:111\n\n");
    let ours = write_span_file(
        dir.path(),
        "ours",
        &format!("x.txt#L1-L5 rk64:111\ns.txt#L2-L4 {SENTINEL_LINE}\n\n"),
    );
    let theirs = write_span_file(dir.path(), "theirs", "x.txt#L1-L5 rk64:111\n\n");

    let out = run_driver(&base, &ours, &theirs);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();

    assert_eq!(out.status.code(), Some(0), "stdout:\n{stdout}");
    assert!(
        stdout.contains("preserved unverified collapse marker: `s.txt#L2-L4`"),
        "preservation line expected; stdout:\n{stdout}"
    );
    // A sentinel arriving by merge is always in committed state, and
    // `drift --fix` tracks a position from worktree hunks -- so the old
    // "run `drift --fix` to keep its position current, then `add` once the
    // reported address matches" instruction could never complete for this
    // population: the first clause does nothing and the second clause's
    // condition can never become true. What is left is to say the location
    // is unconfirmed and hand the operator both completions.
    assert!(
        !stdout.contains("git span drift --fix"),
        "the line must not send this population through a command that \
         cannot help it; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("this merge confirmed nothing about where that content now lives"),
        "the line states plainly that the address is unconfirmed; \
         stdout:\n{stdout}"
    );
    // Both commands take `<NAME>` first, and the `%O %A %B %L` protocol
    // never tells this process which span it is merging — so the name is an
    // explicit `<span-name>` placeholder, in the same style as
    // `<new-address>`. Asserted positionally rather than by substring: the
    // failure this guards against is a command that reads as complete and
    // exits 2 on `<NAME>` when pasted, which only argument *order* catches.
    assert!(
        stdout.contains("git span add <span-name> s.txt#L2-L4")
            && stdout.contains("git span replace <span-name> s.txt#L2-L4 <new-address>"),
        "both completion paths are named against the recorded address, with \
         the span-name argument present as a placeholder rather than \
         omitted; stdout:\n{stdout}"
    );

    let output = std::fs::read_to_string(&ours).unwrap();
    assert!(
        output.contains(&format!("s.txt#L2-L4 {SENTINEL_LINE}")),
        "sentinel carried through unchanged; output:\n{output}"
    );
}

#[test]
fn merge_driver_reports_preserved_sentinel_on_divergence_without_duplicating_it() {
    let dir = tempfile::tempdir().unwrap();

    // Sentinel on theirs, a real hash on ours, no source to adjudicate: the
    // conflict markers remain the correct outcome, and the preservation
    // report is additive to them -- never a second, clean copy of the same
    // identity, which a hand-resolved merge would leave duplicated.
    let base = write_span_file(dir.path(), "base", "x.txt#L1-L5 rk64:111\n\n");
    let ours = write_span_file(
        dir.path(),
        "ours",
        "x.txt#L1-L5 rk64:111\ns.txt#L2-L4 rk64:222\n\n",
    );
    let theirs = write_span_file(
        dir.path(),
        "theirs",
        &format!("x.txt#L1-L5 rk64:111\ns.txt#L2-L4 {SENTINEL_LINE}\n\n"),
    );

    let out = run_driver(&base, &ours, &theirs);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();

    assert_eq!(out.status.code(), Some(1), "stdout:\n{stdout}");
    assert!(
        stdout.contains("preserved unverified collapse marker: `s.txt#L2-L4`"),
        "preservation line expected alongside the conflict; stdout:\n{stdout}"
    );

    let output = std::fs::read_to_string(&ours).unwrap();
    assert!(
        output.contains("<<<<<<<"),
        "conflict markers expected; output:\n{output}"
    );
    // Exactly the two conflict-side records for that identity, and no clean
    // line outside the markers.
    let occurrences = output.matches("s.txt#L2-L4").count();
    assert_eq!(occurrences, 2, "no duplicate clean line; output:\n{output}");
}

#[test]
fn merge_driver_reports_same_side_duplicate_collapse() {
    let dir = tempfile::tempdir().unwrap();

    // Ours carries an unrepaired duplicate. Before this, the index build's
    // last-write-wins insert dropped one record with no report at all.
    let base = write_span_file(dir.path(), "base", "x.txt#L1-L5 rk64:111\n\n");
    let ours = write_span_file(
        dir.path(),
        "ours",
        "x.txt#L1-L5 rk64:111\nd.txt#L1-L3 rk64:222\nd.txt#L1-L3 rk64:333\n\n",
    );
    let theirs = write_span_file(dir.path(), "theirs", "x.txt#L1-L5 rk64:111\n\n");

    let out = run_driver(&base, &ours, &theirs);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();

    assert!(
        stdout.contains("collapsed same-side duplicate (ours): `d.txt#L1-L3` — 2 records → 1"),
        "same-side collapse line expected; stdout:\n{stdout}"
    );
    // The divergent group's survivor carries the sentinel, so the same run
    // also reports the preservation.
    assert!(
        stdout.contains("preserved unverified collapse marker: `d.txt#L1-L3`"),
        "preservation line expected; stdout:\n{stdout}"
    );

    let output = std::fs::read_to_string(&ours).unwrap();
    assert_eq!(
        output.matches("d.txt#L1-L3").count(),
        1,
        "one surviving record; output:\n{output}"
    );
    assert!(
        output.contains(&format!("d.txt#L1-L3 {SENTINEL_LINE}")),
        "survivor carries the sentinel; output:\n{output}"
    );
}
