//! `git mesh merge-driver` — the git merge driver for `.mesh/` files.
//!
//! Invoked by git with the standard merge-driver protocol: `%O %A %B %L`.
//! Reads the three clean blob temp files (base, ours, theirs), parsers each
//! as a `MeshFile`, and calls `merge_mesh_files` to resolve structurally.
//!
//! Never trusts the worktree (source_files is empty), so same-anchor
//! hash/range divergence with no merge-base resolution is written as
//! minimal conflict markers and the driver exits non-zero — git keeps the
//! path unmerged (partial resolution signal).
//!
//! Registration (manual):
//!
//! ```gitattributes
//! .mesh/** merge=mesh
//! ```
//!
//! ```git config
//! [merge "mesh"]
//!     name = git-mesh structural mesh merge
//!     driver = git mesh merge-driver %O %A %B %L
//! ```

use crate::cli::stale_fix::format_residue_markers;
use crate::cli::MergeDriverArgs;
use crate::mesh_file::{AnchorRecord, MeshFile};
use anyhow::Result;
use git_mesh_core::merge_mesh_files;
use std::io::Write;

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

    // Step 2: Parse each as a clean MeshFile. Git guarantees the temp
    // files are clean (no conflict markers), so parse should always
    // succeed for well-formed mesh content.
    let base = MeshFile::parse(&base_text)
        .map_err(|e| anyhow::anyhow!("failed to parse base mesh: {e}"))?;
    let ours = MeshFile::parse(&ours_text)
        .map_err(|e| anyhow::anyhow!("failed to parse ours mesh: {e}"))?;
    let theirs = MeshFile::parse(&theirs_text)
        .map_err(|e| anyhow::anyhow!("failed to parse theirs mesh: {e}"))?;

    // Step 3: Structural merge with base (three-way) and NO source files.
    // The merge driver must NOT trust the worktree, which may be mid-merge.
    let result = merge_mesh_files(Some(&base), &ours, &theirs, &[]);

    // Step 4: Write the merged result to the %A (ours) path.
    if result.unresolved.is_empty() {
        // Fully resolved — write clean mesh and exit 0.
        let serialized = result.merged.serialize();
        write_file(&args.ours, &serialized)?;
        Ok(0)
    } else {
        // Partial resolution: write resolved anchors clean, wrap residue
        // in minimal conflict markers using the requested marker length.
        let output = serialize_with_driver_markers(
            &result.merged,
            &result.unresolved,
            &ours.why,
            &theirs.why,
            args.marker_len,
        );
        write_file(&args.ours, &output)?;
        // Exit non-zero: git keeps this path unmerged (the idiomatic
        // partial-resolution signal). The user can then run
        // `git mesh stale --fix` for the authoritative full resolution
        // (which trusts the worktree).
        Ok(1)
    }
}

/// Build the serialized mesh output with minimal conflict markers wrapping
/// unresolved residue, using the specified marker length.
fn serialize_with_driver_markers(
    merged: &git_mesh_core::mesh_file::MeshFile,
    unresolved: &[git_mesh_core::UnresolvedAnchor],
    ours_why: &str,
    theirs_why: &str,
    marker_len: u32,
) -> String {
    // Build marker strings by repeating the marker character marker_len times.
    let open_marker = format!("{} ours\n", "<".repeat(marker_len as usize));
    let sep_marker = format!("{}\n", "=".repeat(marker_len as usize));
    let close_marker = format!("{} theirs\n", ">".repeat(marker_len as usize));

    // Defensive sort by canonical (path, start_line, end_line) ordering,
    // consistent with write_residue_mesh in stale_fix.rs.
    let mut sorted = merged.anchors.clone();
    sorted.sort_by(|a: &AnchorRecord, b: &AnchorRecord| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    format_residue_markers(
        &sorted,
        unresolved,
        ours_why,
        theirs_why,
        &open_marker,
        &sep_marker,
        &close_marker,
    )
}

/// Write content to a file atomically (write to temp, rename).
fn write_file(path: &str, content: &str) -> Result<()> {
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_name = format!(
        ".{}.tmp",
        p.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("merge")
    );
    let tmp_path = p
        .parent()
        .map(|pp| pp.join(&tmp_name))
        .unwrap_or_else(|| std::path::PathBuf::from(&tmp_name));
    let mut f = std::fs::File::create(&tmp_path)?;
    f.write_all(content.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp_path, p)?;
    Ok(())
}
