//! `git span merge-driver` — the git merge driver for `.span/` files.
//!
//! Invoked by git with the standard merge-driver protocol: `%O %A %B %L`.
//! Reads the three clean blob temp files (base, ours, theirs), parsers each
//! as a `SpanFile`, and calls `merge_span_files` to resolve structurally.
//!
//! Never trusts the worktree (source_files is empty), so same-anchor
//! hash/range divergence with no merge-base resolution is written as
//! minimal conflict markers and the driver exits non-zero — git keeps the
//! path unmerged (partial resolution signal).
//!
//! Registration (manual):
//!
//! ```gitattributes
//! .span/** merge=span
//! ```
//!
//! ```git config
//! [merge "span"]
//!     name = git-span structural span merge
//!     driver = git span merge-driver %O %A %B %L
//! ```

use crate::cli::MergeDriverArgs;
use crate::cli::drift_fix::format_residue_markers;
use crate::descriptor_authority::RetainedDirectory;
use crate::cli::format::{format_same_side_collapse, format_sentinel_preserved};
use crate::span_file::SpanFile;
use anyhow::Result;
use git_span_core::merge_span_files;

/// Run the merge driver: read base/ours/theirs from temp file paths, merge
/// structurally, and write the output to the `%A` (ours) path.
///
/// Returns:
/// - `Ok(0)` on fully resolved merge
/// - `Ok(1)` on partial resolution (residue markers written, path still unmerged)
pub(crate) fn run_merge_driver(args: MergeDriverArgs) -> Result<i32> {
    // Step 1: Read the three temp files.
    let base_text = std::fs::read_to_string(&args.base)
        .map_err(|e| anyhow::anyhow!("failed to read base `{}`: {}", args.base, e))?;
    let ours_text = std::fs::read_to_string(&args.ours)
        .map_err(|e| anyhow::anyhow!("failed to read ours `{}`: {}", args.ours, e))?;
    let theirs_text = std::fs::read_to_string(&args.theirs)
        .map_err(|e| anyhow::anyhow!("failed to read theirs `{}`: {}", args.theirs, e))?;

    // Step 2: Parse each as a clean SpanFile. Git guarantees the temp
    // files are clean (no conflict markers), so parse should always
    // succeed for well-formed span content.
    let base = SpanFile::parse(&base_text)
        .map_err(|e| anyhow::anyhow!("failed to parse base span: {e}"))?;
    let ours = SpanFile::parse(&ours_text)
        .map_err(|e| anyhow::anyhow!("failed to parse ours span: {e}"))?;
    let theirs = SpanFile::parse(&theirs_text)
        .map_err(|e| anyhow::anyhow!("failed to parse theirs span: {e}"))?;

    // Step 3: Structural merge with base (three-way) and NO source files.
    // The merge driver must NOT trust the worktree, which may be mid-merge.
    let result = merge_span_files(Some(&base), &ours, &theirs, &[]);

    // Step 3b: Name every collapse and every preserved sentinel. Neither is
    // visible in the written file as an event — a same-side collapse would
    // otherwise drop a record silently, and a preserved sentinel looks like
    // ordinary drift to anyone who did not watch the merge happen.
    for (side, collapsed) in &result.same_side_collapsed {
        println!("{}", format_same_side_collapse(*side, collapsed));
    }
    for (path, start_line, end_line) in &result.sentinel_preserved {
        // The `%O %A %B %L` protocol hands this process three temp files and
        // a marker length — never the span's name — so the completion
        // commands carry an explicit `<span-name>` placeholder rather than a
        // fabricated one. See [`format_sentinel_preserved`].
        println!(
            "{}",
            format_sentinel_preserved(None, path, *start_line, *end_line)
        );
    }

    // Step 4: Write the merged result to the %A (ours) path.
    if result.unresolved.is_empty() && !result.conflicts.any() {
        // Fully resolved — write clean span and exit 0.
        let serialized = result.merged.serialize();
        write_file(&args.ours, &serialized)?;
        Ok(0)
    } else {
        // Partial resolution: write resolved anchors clean, wrap residue
        // in minimal conflict markers using the requested marker length.
        let output = serialize_with_driver_markers(
            &result,
            &ours,
            &theirs,
            args.marker_len,
        );
        write_file(&args.ours, &output)?;
        // Exit non-zero: git keeps this path unmerged (the idiomatic
        // partial-resolution signal). The user can then run
        // `git span drift --fix` for the authoritative full resolution
        // (which trusts the worktree).
        Ok(1)
    }
}

/// Build the serialized span output with minimal conflict markers wrapping
/// unresolved residue, using the specified marker length.
fn serialize_with_driver_markers(
    result: &git_span_core::SpanMergeResult,
    ours: &SpanFile,
    theirs: &SpanFile,
    marker_len: u32,
) -> String {
    // Build marker strings by repeating the marker character marker_len times.
    let open_marker = format!("{} ours\n", "<".repeat(marker_len as usize));
    let sep_marker = format!("{}\n", "=".repeat(marker_len as usize));
    let close_marker = format!("{} theirs\n", ">".repeat(marker_len as usize));

    format_residue_markers(
        result,
        ours,
        theirs,
        &open_marker,
        &sep_marker,
        &close_marker,
    )
}

/// Write content to a file atomically (write to temp, rename).
fn write_file(path: &str, content: &str) -> Result<()> {
    let p = std::path::Path::new(path);
    let parent = p
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let leaf = p
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("merge output has no file name"))?;
    RetainedDirectory::open_canonical(parent)?.atomic_write(leaf, content.as_bytes(), 0o644)
}
