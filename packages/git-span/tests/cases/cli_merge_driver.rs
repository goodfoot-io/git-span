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
