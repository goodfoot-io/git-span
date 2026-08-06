//! Rejection of provable supersession during `git span add`.
//!
//! `add` appends any non-identical extent beside existing anchors. Adding a
//! line range next to an existing whole-file anchor for the same path (or
//! vice versa) silently leaves the old anchor as permanent drift — the
//! operator must remember the separate removal. The card makes `add` reject
//! provable supersession before writing anything: same path, exactly one
//! side whole-file, and not an exact identity. Range-vs-range overlaps
//! (disjoint, partial, nested) are never provable and keep working; exact
//! identity is the supported refresh and keeps working; multi-anchor
//! invocations are all-or-nothing.
//!
//! Modeled on `add_gitignored_anchor_reject.rs` and
//! `anchor_inside_span_root_reject.rs` (the `TestRepo` harness).

use crate::support;

use anyhow::Result;
use std::fs;
use support::TestRepo;

/// Tokenize a POSIX-shell command line into argv, honoring the two quoting
/// constructs `quote_shell` emits: single-quoted segments (literal until the
/// closing quote) and backslash-escaped characters outside quotes (so
/// `'\''` re-enters a quoted segment around one literal `'`). The round-trip
/// proves shell-safety: an unescaped embedded `'` would split the argument
/// apart and the removal would target the wrong anchor.
fn tokenize_shell_words(cmd: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut chars = cmd.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                for n in chars.by_ref() {
                    if n == '\'' {
                        break;
                    }
                    cur.push(n);
                }
            }
            '\\' => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            c if c.is_whitespace() => {
                if !cur.is_empty() {
                    words.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words
}

/// Read `.span/<name>` from `repo` as bytes.
fn span_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    Ok(fs::read(repo.path().join(".span").join(name))?)
}

/// Assert `out` has the co-requested rejection shape: exit 1, both canonical
/// addresses named, no remove command (the span tracks neither anchor), and
/// prose guidance to drop one of the two anchors from the invocation.
fn assert_co_requested_rejection(out: &std::process::Output, whole: &str, range: &str) {
    assert!(
        !out.status.success(),
        "add must reject two co-requested same-path superseding anchors; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains(&format!("`{whole}`")),
        "stderr must name the whole-file canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(&format!("`{range}`")),
        "stderr must name the range canonical address; stderr:\n{stderr}"
    );
    assert!(
        !stderr.contains("git span remove"),
        "stderr must not print a remove command for an anchor the span does not track; stderr:\n{stderr}"
    );
    assert!(
        !stderr.contains("existing anchor"),
        "the co-requested anchor must not be called the existing anchor; stderr:\n{stderr}"
    );
    let lower = stderr.to_lowercase();
    assert!(
        lower.contains("drop one of the two anchors"),
        "stderr must tell the user to drop one of the two anchors from the invocation; stderr:\n{stderr}"
    );
}

// ---------------------------------------------------------------------------
// (1) Whole-file exists, add range → rejected
// ---------------------------------------------------------------------------

/// Adding a range beside an existing whole-file anchor for the same path
/// must be rejected before any write: exit 1, stderr names both canonical
/// addresses and contains the exact shell-quoted `git span remove` command,
/// and the span file stays byte-identical.
#[test]
fn add_superseding_overlap_reject_whole_file_then_range() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        first.status.success(),
        "the whole-file add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = span_bytes(&repo, "demo")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs#L1-L4"])?;
    assert!(
        !out.status.success(),
        "add must reject a range superseded by an existing whole-file anchor; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/lib.rs`"),
        "stderr must name the existing whole-file canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("`src/lib.rs#L1-L4`"),
        "stderr must name the requested canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove demo 'src/lib.rs'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    let after = span_bytes(&repo, "demo")?;
    assert_eq!(
        before, after,
        "a rejected add must leave `.span/demo` byte-identical"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (2) Range exists, add whole-file → rejected
// ---------------------------------------------------------------------------

/// The mirror direction: adding a whole-file anchor beside an existing
/// same-path range is equally provable supersession and must be rejected
/// with the same shape.
#[test]
fn add_superseding_overlap_reject_range_then_whole_file() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/lib.rs#L1-L4"])?;
    assert!(
        first.status.success(),
        "the range add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = span_bytes(&repo, "demo")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        !out.status.success(),
        "add must reject a whole-file anchor superseding an existing range; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/lib.rs#L1-L4`"),
        "stderr must name the existing range canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("`src/lib.rs`"),
        "stderr must name the requested whole-file canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove demo 'src/lib.rs#L1-L4'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    let after = span_bytes(&repo, "demo")?;
    assert_eq!(
        before, after,
        "a rejected add must leave `.span/demo` byte-identical"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (3) Exact identity → refresh keeps working
// ---------------------------------------------------------------------------

/// Re-adding the identical anchor is the supported refresh operation: an
/// unchanged content reports `unchanged`, and a mutated content resolves in
/// place — both still exit 0.
#[test]
fn add_superseding_overlap_reject_exact_identity_refresh_still_succeeds() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    // Identical re-add — content unchanged → "unchanged".
    let second = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        second.status.success(),
        "an identical re-add must succeed; exit {:?}\nstderr:\n{}",
        second.status.code(),
        String::from_utf8_lossy(&second.stderr)
    );
    let stdout = String::from_utf8_lossy(&second.stdout);
    assert!(
        stdout.contains("unchanged"),
        "an identical re-add must report `unchanged`; stdout:\n{stdout}"
    );

    // Mutate the content, re-add — identity refresh resolves in place.
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\n")?;
    let third = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        third.status.success(),
        "an identity refresh after mutation must succeed; exit {:?}\nstderr:\n{}",
        third.status.code(),
        String::from_utf8_lossy(&third.stderr)
    );
    let stdout = String::from_utf8_lossy(&third.stdout);
    assert!(
        stdout.contains("resolved in-place"),
        "an identity refresh after mutation must report `resolved in-place`; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (4)-(6) Range-vs-range overlaps → never provable, keep working
// ---------------------------------------------------------------------------

/// Disjoint same-file ranges address distinct regions — both accepted and
/// both recorded.
#[test]
fn add_superseding_overlap_reject_disjoint_ranges_same_file_succeed() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "src/lib.rs",
        "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n",
    )?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs#L1-L2", "src/lib.rs#L10-L12"])?;
    assert!(
        out.status.success(),
        "disjoint same-file ranges must both be accepted; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let content = fs::read_to_string(repo.path().join(".span/demo"))?;
    assert!(
        content.contains("src/lib.rs#L1-L2"),
        "span file must record the first range; content:\n{content}"
    );
    assert!(
        content.contains("src/lib.rs#L10-L12"),
        "span file must record the second range; content:\n{content}"
    );
    Ok(())
}

/// Partially overlapping ranges are ambiguous, not provable — accepted, not
/// guessed.
#[test]
fn add_superseding_overlap_reject_partially_overlapping_ranges_succeed() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "src/lib.rs",
        "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n",
    )?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs#L1-L6", "src/lib.rs#L4-L9"])?;
    assert!(
        out.status.success(),
        "partially overlapping ranges must both be accepted; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let content = fs::read_to_string(repo.path().join(".span/demo"))?;
    assert!(
        content.contains("src/lib.rs#L1-L6"),
        "span file must record the first range; content:\n{content}"
    );
    assert!(
        content.contains("src/lib.rs#L4-L9"),
        "span file must record the second range; content:\n{content}"
    );
    Ok(())
}

/// A range nested inside another range is never provable supersession —
/// accepted.
#[test]
fn add_superseding_overlap_reject_nested_ranges_succeed() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "src/lib.rs",
        "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
    )?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs#L1-L10", "src/lib.rs#L3-L5"])?;
    assert!(
        out.status.success(),
        "nested ranges must both be accepted; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let content = fs::read_to_string(repo.path().join(".span/demo"))?;
    assert!(
        content.contains("src/lib.rs#L1-L10"),
        "span file must record the outer range; content:\n{content}"
    );
    assert!(
        content.contains("src/lib.rs#L3-L5"),
        "span file must record the inner range; content:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (7) Multi-anchor invocation → all-or-nothing
// ---------------------------------------------------------------------------

/// A single invocation mixing a valid anchor and a conflicting anchor must
/// fail as a whole, before any record changes: the span file's bytes must be
/// identical before and after (not merely present).
#[test]
fn add_superseding_overlap_reject_multi_anchor_is_all_or_nothing() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.write_file("src/a.rs", "a1\na2\na3\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        first.status.success(),
        "the whole-file add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = span_bytes(&repo, "demo")?;

    // One valid anchor plus one conflicting anchor in a single invocation.
    let out = repo.run_span(["add", "demo", "src/a.rs", "src/lib.rs#L1-L2"])?;
    assert!(
        !out.status.success(),
        "a multi-anchor add containing a conflict must fail as a whole; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("git span remove demo 'src/lib.rs'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    let after = span_bytes(&repo, "demo")?;
    assert_eq!(
        before, after,
        "a rejected multi-anchor add must not partially write `.span/demo` (byte-identical)"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (8) Shell-safe remove command round-trip
// ---------------------------------------------------------------------------

/// A path containing a space and an apostrophe: the printed remove command,
/// executed verbatim via `git` (with the freshly built binary discoverable
/// as `git-span`), must actually remove the anchor. The round-trip proves
/// the single-quoted rendering is shell-safe.
#[test]
fn add_superseding_overlap_reject_printed_remove_command_round_trips() -> Result<()> {
    let repo = TestRepo::new()?;
    let path = "dir with'quote/file name.txt";
    repo.write_file(path, "l1\nl2\nl3\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", path])?;
    assert!(
        first.status.success(),
        "the whole-file add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    let out = repo.run_span(["add", "demo", &format!("{path}#L1-L2")])?;
    assert!(
        !out.status.success(),
        "add must reject the range superseding the whole-file anchor; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);

    // The printed command is a single line inside the fenced bash block;
    // extract it verbatim and prove a shell would hand `remove` exactly one
    // argument equal to the literal path (spaces and apostrophe intact).
    let marker = "git span remove ";
    let start = stderr
        .find(marker)
        .expect("stderr must print the remove command");
    let end = stderr[start..]
        .find('\n')
        .map(|i| start + i)
        .unwrap_or(stderr.len());
    let printed = &stderr[start..end];
    assert_eq!(
        printed,
        "git span remove demo 'dir with'\\''quote/file name.txt'",
        "the printed command must be single-quoted with `'\\''` escaping; stderr:\n{stderr}"
    );
    let tokens = tokenize_shell_words(printed);
    assert_eq!(
        tokens,
        vec![
            "git".to_string(),
            "span".to_string(),
            "remove".to_string(),
            "demo".to_string(),
            path.to_string(),
        ],
        "shell tokenization of the printed command must yield the path as one argument"
    );

    // Execute the printed command via `git`, with the freshly built binary
    // first on PATH so `git span` dispatches to it (portable: no reliance on
    // a pre-installed git-span). Split the inherited PATH into segments and
    // rejoin with the bin dir prepended — `join_paths` joins segments with
    // the platform PATH separator (`:` on Unix, `;` on Windows) and rejects
    // any segment containing it, so the whole inherited PATH cannot be
    // passed as a single segment.
    let bin_dir = std::path::Path::new(env!("CARGO_BIN_EXE_git-span"))
        .parent()
        .expect("CARGO_BIN_EXE_git-span must live in a directory");
    let mut segments: Vec<std::path::PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    segments.insert(0, bin_dir.to_path_buf());
    let sandbox_path = std::env::join_paths(segments)?;
    let path_str = sandbox_path.to_string_lossy().into_owned();
    repo.run_git_with_env(&tokens[1..], &[("PATH", &path_str)])?;

    let content = fs::read_to_string(repo.path().join(".span/demo"))?;
    assert!(
        !content.contains(path),
        "executing the printed remove command must delete the anchor; span file:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (9) Co-requested anchors → conflict between the requested anchors
// ---------------------------------------------------------------------------

/// Two same-path superseding anchors requested in one invocation, on a span
/// that contains neither, must be rejected as a conflict between the two
/// REQUESTED anchors: nothing was written, so there is no remove command to
/// print, and the only repair is dropping one anchor from the invocation.
#[test]
fn add_superseding_overlap_reject_co_requested_whole_file_then_range() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs", "src/lib.rs#L1-L4"])?;
    assert_co_requested_rejection(&out, "src/lib.rs", "src/lib.rs#L1-L4");
    assert!(
        !repo.path().join(".span/demo").exists(),
        "a rejected co-requested add must not create `.span/demo`"
    );
    Ok(())
}

/// The reversed order (range first, whole-file second) reports the same
/// co-requested shape: both requested addresses named, no remove command.
#[test]
fn add_superseding_overlap_reject_co_requested_range_then_whole_file() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_span(["add", "demo", "src/lib.rs#L1-L4", "src/lib.rs"])?;
    assert_co_requested_rejection(&out, "src/lib.rs", "src/lib.rs#L1-L4");
    assert!(
        !repo.path().join(".span/demo").exists(),
        "a rejected co-requested add must not create `.span/demo`"
    );
    Ok(())
}

/// The amendment arrangement: the span holds the whole-file anchor and the
/// invocation is `<range> <whole-file>`. The first rejection is against the
/// existing record and prints the working remove command; after following it
/// the span is empty, and retrying the IDENTICAL invocation must now produce
/// the co-requested shape — no remove command, invocation-fix guidance —
/// never the "existing anchor" wording for a pair that was never added.
#[test]
fn add_superseding_overlap_reject_co_requested_after_following_existing_remove() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n")?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/lib.rs"])?;
    assert!(
        first.status.success(),
        "the whole-file add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    // First rejection: the range conflicts with the existing whole-file
    // record, so the printed remove command targets the tracked anchor and
    // must actually work.
    let invocation = ["add", "demo", "src/lib.rs#L1-L4", "src/lib.rs"];
    let out = repo.run_span(invocation)?;
    assert!(
        !out.status.success(),
        "add must reject the range against the existing whole-file anchor; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("git span remove demo 'src/lib.rs'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    // Follow the printed guidance: removing the tracked whole-file anchor
    // must succeed (the span file is rewritten, now empty).
    let removed = repo.run_span(["remove", "demo", "src/lib.rs"])?;
    assert!(
        removed.status.success(),
        "the printed remove must succeed; exit {:?}\nstderr:\n{}",
        removed.status.code(),
        String::from_utf8_lossy(&removed.stderr)
    );
    let after_remove = span_bytes(&repo, "demo")?;

    // Retry the identical invocation: nothing is tracked now, so the
    // conflict is between the two requested anchors — co-requested shape.
    let retry = repo.run_span(invocation)?;
    assert_co_requested_rejection(&retry, "src/lib.rs", "src/lib.rs#L1-L4");
    let after_retry = span_bytes(&repo, "demo")?;
    assert_eq!(
        after_remove, after_retry,
        "a rejected co-requested add must leave `.span/demo` byte-identical"
    );
    Ok(())
}
