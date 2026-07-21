//! `git span stale --fix` — rewrite `Moved` anchors and whitespace-equivalent
//! `Changed` anchors in place by editing the span worktree files. No commit is
//! produced; the operator inspects the rewrite with `git diff` and stages it
//! manually.
//!
//! The per-layer hashing rule (Worktree > Index > HEAD) drives both
//! which layer's content to read and which hashing convention to use.
//! `current.blob` is unreliable on the `Changed`/`Moved` branches (see
//! `notes/current-blob-unreliable-for-fix.md`), so we read content per
//! surfacing layer rather than via `current.blob`.

use crate::cli::commit::{hash_anchor_content, span_file_path,
    write_worktree_span};
use crate::git::IndexEntrySnapshot;
use crate::span_file::{AnchorRecord, SpanFile, has_conflict_markers};
use crate::types::{AnchorExtent, AnchorStatus, DriftSource, SpanResolved};
use anyhow::Result;
use git_span_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};
use git_span_core::span_file::merge_span_files;
use git_span_core::UnresolvedAnchor;
use std::collections::{BTreeMap, HashMap, HashSet};

/// Carries the result of a single `apply_fix` invocation.
pub(crate) struct FixResult {
    /// Anchor ids actually rewritten or merged this invocation.
    /// Used by `run_stale` for the exit-code subtraction and the
    /// "auto-updated" tag.
    pub(crate) rewritten_anchor_ids: HashSet<String>,
    /// Names of span files written to disk (`write_worktree_span` called).
    /// Exact: a name appears here iff `any_rewritten || coalesced` was true
    /// for that span, OR the span is a conflicted span whose conflict
    /// resolution wrote the file (fully resolved or partially resolved).
    /// Used by `run_stale` to scope the post-fix re-resolve.
    /// Fully and partially resolved spans are both included so the
    /// post-fix re-resolve sees the post-resolution content and reflects
    /// any remaining residue accurately.
    pub(crate) rewritten_span_names: HashSet<String>,
    /// How many distinct span files were written to disk during this fix
    /// pass.  Incremented when `write_worktree_span` or `write_residue_span`
    /// is called (conflict-resolution both fully- and partially-resolved),
    /// or when the per-span re-anchor/coalesce loop calls
    /// `write_worktree_span`.  A span touched by both interior-anchor repair
    /// AND re-anchoring counts once.
    pub(crate) spans_touched: usize,
    /// How many anchor records were updated (re-anchored, coalesced, or
    /// merged during conflict resolution).  Coalesced groups count as one
    /// anchor each.  Conflict-resolution merged anchors count here.
    pub(crate) anchors_updated: usize,
    /// How many anchor records were removed outright (interior-anchor
    /// repair: records whose path falls under the span root).
    pub(crate) anchors_removed: usize,
}

// ---------------------------------------------------------------------------
// Conflict resolution helpers
// ---------------------------------------------------------------------------

/// Read raw span file content from the worktree, returning `None` when the
/// file does not exist.
fn read_raw_span_content(repo: &gix::Repository, span_root: &str, name: &str) -> Result<Option<String>> {
    let path = span_file_path(repo, span_root, name)?;
    if path.exists() {
        Ok(Some(std::fs::read_to_string(&path)?))
    } else {
        Ok(None)
    }
}

/// A text region within a conflict-markered file.
enum ConflictRegion {
    Ours,
    Base,
    Theirs,
    Outside,
}

/// Split a Git textual conflict-markered span text into ours/theirs sides.
///
/// Lines outside any conflict block (non-conflicted anchor lines) are
/// included in both sides. Ours and theirs are separated at conflict
/// boundaries; diff3 base content (`|||||||`) is discarded.
///
/// Returns `None` when no conflict markers are found.
fn split_conflict_markers(input: &str) -> Option<(String, String)> {
    let mut ours_lines: Vec<&str> = Vec::new();
    let mut theirs_lines: Vec<&str> = Vec::new();
    let mut region = ConflictRegion::Outside;
    let mut found_conflict = false;
    // Blank lines from the Outside section that have not yet been committed
    // to the output.  They are flushed when a non-blank Outside line follows,
    // or discarded when a conflict block starts — a blank line right before a
    // conflict marker is the span-format anchor/why separator, and keeping it
    // would create a spurious `\n\n` boundary between pre-conflict anchors and
    // the conflict block's own anchor lines.
    let mut pending_blanks: usize = 0;

    for line in input.lines() {
        if line.starts_with("<<<<<<<") {
            // Discard pending blank lines — they were the anchor/why separator
            // which must not separate pre-conflict anchors from inside anchors.
            pending_blanks = 0;
            region = ConflictRegion::Ours;
            found_conflict = true;
            continue;
        }
        if line.starts_with("|||||||") {
            // diff3 base marker: skip base content, stay in "base" until
            // we hit the `=======` separator or `>>>>>>>` close.
            pending_blanks = 0;
            region = ConflictRegion::Base;
            continue;
        }
        if let Some(rest) = line.strip_prefix("=======")
            && (rest.is_empty() || rest.starts_with(char::is_whitespace))
        {
            region = ConflictRegion::Theirs;
            continue;
        }
        // A run of `=` longer than 7 is not a conflict separator
        // (e.g. Markdown setext underline). Fall through to collect.
        if line.starts_with(">>>>>>>") {
            pending_blanks = 0;
            region = ConflictRegion::Outside;
            continue;
        }
        match region {
            ConflictRegion::Outside => {
                if line.is_empty() {
                    pending_blanks += 1;
                } else {
                    // Flush pending blanks before this non-blank line.
                    for _ in 0..pending_blanks {
                        ours_lines.push("");
                        theirs_lines.push("");
                    }
                    pending_blanks = 0;
                    ours_lines.push(line);
                    theirs_lines.push(line);
                }
            }
            ConflictRegion::Ours => ours_lines.push(line),
            ConflictRegion::Theirs => theirs_lines.push(line),
            ConflictRegion::Base => { /* skip diff3 base content */ }
        }
    }

    if !found_conflict {
        return None;
    }

    // Post-process: ensure there is a `\n\n` separator between the combined
    // anchor block (Outside anchors + conflict-block anchors) and the why
    // text.  Insert a blank line before the first non-anchor-looking line.
    for lines in [&mut ours_lines, &mut theirs_lines] {
        let non_anchor_pos = lines.iter().position(|l| !looks_like_anchor_line(l));
        if let Some(pos) = non_anchor_pos
            && pos > 0
            && !lines[pos - 1].is_empty()
        {
            lines.insert(pos, "");
        }
    }

    Some((ours_lines.join("\n"), theirs_lines.join("\n")))
}

/// Heuristic: a line looks like a span anchor if it has the form
/// `<path> <algorithm>:<content_hash>` where `algorithm` is ASCII alphanumeric
/// and `content_hash` is non-empty.  Used to re-introduce the `\n\n` anchor/why
/// separator inside `split_conflict_markers`.
fn looks_like_anchor_line(line: &str) -> bool {
    if let Some(space_pos) = line.rfind(' ') {
        let hash_part = &line[space_pos + 1..];
        if let Some(colon_pos) = hash_part.find(':') {
            let algo = &hash_part[..colon_pos];
            let hash = &hash_part[colon_pos + 1..];
            return !algo.is_empty()
                && !hash.is_empty()
                && algo.chars().all(|c| c.is_ascii_alphanumeric());
        }
    }
    false
}

/// Read every source file referenced by anchors in `ours` and `theirs`,
/// checking each for conflict markers. Returns deduplicated
/// `(repo_relative_path, file_bytes)` pairs for the paths that read cleanly.
///
/// A path that fails a plain I/O read (e.g. the file was deleted/renamed
/// away) is simply omitted from the returned vec rather than aborting the
/// whole function — its absence is the signal `prune_unreadable_renamed_orphans`
/// uses to identify dead-path orphan anchors. This is a distinct failure
/// class from a *poisoned* source: if a source file itself contains conflict
/// markers, that is still fail-closed and aborts the whole span, unchanged
/// from today.
fn read_clean_source_files(
    repo: &gix::Repository,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> Result<Vec<(String, Vec<u8>)>> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for anchor in ours.anchors.iter().chain(theirs.anchors.iter()) {
        if !seen.insert(anchor.path.clone()) {
            continue;
        }
        let bytes = match crate::git::read_worktree_bytes(repo, &anchor.path) {
            Ok(bytes) => bytes,
            // Plain I/O read failure (e.g. not found after a rename): skip
            // this path. Its absence from the returned vec signals
            // "unreadable" to prune_unreadable_renamed_orphans.
            Err(_) => continue,
        };

        // Check for conflict markers in the source file.
        // Non-UTF-8 (binary) files cannot contain textual conflict markers,
        // and line-range anchors already reject non-UTF-8 at hash time.
        if std::str::from_utf8(&bytes).is_ok() {
            let text = String::from_utf8_lossy(&bytes);
            if has_conflict_markers(&text) {
                anyhow::bail!(
                    "source file `{}` contains conflict markers; cannot resolve span conflict",
                    anchor.path
                );
            }
        }

        files.push((anchor.path.clone(), bytes));
    }

    Ok(files)
}

/// Drop orphan anchors (present on only one side) whose path is unreadable
/// when — and only when — exactly one orphan anchor on the *other* side
/// shares the identical (start_line, end_line) at a different, readable
/// path AND no other own-side orphan would independently claim that same
/// opposite-side candidate. Mutates `ours`/`theirs` in place. Returns an
/// error (preserving today's whole-span fail-closed behavior) if any orphan
/// anchor's path is unreadable and no unambiguous, uncontested live
/// counterpart exists.
///
/// An anchor is an "orphan" on a side when its `(path, start_line, end_line)`
/// key is absent from the other side's key set — this mirrors the map keys
/// `merge_span_files` builds. Anchors whose key exists on both sides (a
/// same-path `Changed` conflict) or whose orphan path IS readable are left
/// untouched here; they resolve via the existing, unmodified structural-merge
/// kernel (rehash-and-keep or union, respectively).
///
/// The "exactly one readable candidate" precondition holds both per-orphan
/// (an unreadable orphan sees exactly one same-range readable candidate on
/// the other side) and per-candidate (no *other* unreadable orphan on the
/// same side also maps to that candidate). Without the per-candidate check,
/// two unreadable orphans sharing a line range would each independently
/// adopt the single opposite-side candidate and silently collapse into one
/// anchor. When that many-to-one collision is detected we bail closed for
/// all colliding orphans rather than adopting any.
fn prune_unreadable_renamed_orphans(
    ours: &mut SpanFile,
    theirs: &mut SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> Result<()> {
    let readable: HashSet<&str> = source_files.iter().map(|(p, _)| p.as_str()).collect();

    let ours_keys: HashSet<(&str, u32, u32)> = ours
        .anchors
        .iter()
        .map(|a| (a.path.as_str(), a.start_line, a.end_line))
        .collect();
    let theirs_keys: HashSet<(&str, u32, u32)> = theirs
        .anchors
        .iter()
        .map(|a| (a.path.as_str(), a.start_line, a.end_line))
        .collect();

    // Orphans: anchors present on only one side (key absent from the other).
    let ours_orphans: Vec<usize> = ours
        .anchors
        .iter()
        .enumerate()
        .filter(|(_, a)| !theirs_keys.contains(&(a.path.as_str(), a.start_line, a.end_line)))
        .map(|(i, _)| i)
        .collect();
    let theirs_orphans: Vec<usize> = theirs
        .anchors
        .iter()
        .enumerate()
        .filter(|(_, a)| !ours_keys.contains(&(a.path.as_str(), a.start_line, a.end_line)))
        .map(|(i, _)| i)
        .collect();

    let remove_ours =
        plan_orphan_removals(&ours.anchors, &ours_orphans, &theirs.anchors, &theirs_orphans, &readable)?;
    let remove_theirs =
        plan_orphan_removals(&theirs.anchors, &theirs_orphans, &ours.anchors, &ours_orphans, &readable)?;

    let mut idx = 0usize;
    ours.anchors.retain(|_| {
        let keep = !remove_ours.contains(&idx);
        idx += 1;
        keep
    });
    let mut idx = 0usize;
    theirs.anchors.retain(|_| {
        let keep = !remove_theirs.contains(&idx);
        idx += 1;
        keep
    });

    Ok(())
}

/// Decide which of one side's unreadable orphan anchors to drop in favor of
/// an unambiguous, uncontested rename target on the other side.
///
/// `own_orphans` / `other_orphans` are indices into `own_anchors` /
/// `other_anchors` respectively. For each unreadable own-side orphan we
/// gather its readable rename candidates on the other side (same
/// `(start_line, end_line)`, different path). The removal is fail-closed:
///
/// - **zero candidates** — the source path is gone and no rename target was
///   found among readable sources; bail naming the path.
/// - **two or more candidates** — the rename target is ambiguous; bail
///   naming the candidate paths so the operator can pick one.
/// - **exactly one candidate** — provisionally adopt, then verify no other
///   own-side orphan claims the same candidate (many-to-one collapse); bail
///   closed for all colliding orphans if one is found.
///
/// Returns the set of own-side indices to drop when every unreadable orphan
/// resolves to a distinct, unambiguous target.
fn plan_orphan_removals(
    own_anchors: &[AnchorRecord],
    own_orphans: &[usize],
    other_anchors: &[AnchorRecord],
    other_orphans: &[usize],
    readable: &HashSet<&str>,
) -> Result<HashSet<usize>> {
    // (own index, chosen candidate key) for each unreadable orphan that has
    // exactly one same-range readable candidate on the other side.
    let mut chosen: Vec<(usize, (String, u32, u32))> = Vec::new();

    for &i in own_orphans {
        let anchor = &own_anchors[i];
        if readable.contains(anchor.path.as_str()) {
            continue;
        }
        let candidates: Vec<&AnchorRecord> = other_orphans
            .iter()
            .map(|&j| &other_anchors[j])
            .filter(|c| {
                c.start_line == anchor.start_line
                    && c.end_line == anchor.end_line
                    && c.path != anchor.path
                    && readable.contains(c.path.as_str())
            })
            .collect();

        match candidates.len() {
            0 => anyhow::bail!(
                "source file `{}` referenced by conflicted anchor no longer exists \
                 and was not found among readable sources; resolve manually",
                anchor.path
            ),
            1 => {
                let c = candidates[0];
                chosen.push((i, (c.path.clone(), c.start_line, c.end_line)));
            }
            _ => {
                let names: Vec<&str> =
                    candidates.iter().map(|c| c.path.as_str()).collect();
                anyhow::bail!(
                    "anchor `{}` has multiple possible rename targets ({}); resolve manually",
                    anchor.path,
                    names.join(", ")
                );
            }
        }
    }

    // Per-candidate check: two own-side orphans claiming the same opposite-side
    // candidate would silently collapse into a single anchor. Bail closed.
    let mut claims: HashMap<(String, u32, u32), usize> = HashMap::new();
    for (_, key) in &chosen {
        *claims.entry(key.clone()).or_insert(0) += 1;
    }
    for (_, key) in &chosen {
        if claims[key] > 1 {
            anyhow::bail!(
                "multiple conflicted anchors map to the same rename target \
                 `{}#L{}-L{}`; resolve manually",
                key.0,
                key.1,
                key.2
            );
        }
    }

    Ok(chosen.into_iter().map(|(i, _)| i).collect())
}

/// Format the residue marker text for a partially-resolved merge.
///
/// Produces the text portion of a residue span file: resolved anchors in
/// canonical order, a blank-line separator, and optionally a conflict block
/// wrapping unresolved anchor residue and/or divergent why text.
///
/// The caller supplies full marker strings (including labels and trailing
/// newlines) so that different callers can customize marker length and label
/// format. Callers must sort `resolved_anchors` in canonical
/// `(path, start_line, end_line)` order before calling.
pub(crate) fn format_residue_markers(
    resolved_anchors: &[AnchorRecord],
    unresolved: &[UnresolvedAnchor],
    ours_why: &str,
    theirs_why: &str,
    open_marker: &str,  // e.g. "<<<<<<< ours\n"
    sep_marker: &str,   // e.g. "=======\n"
    close_marker: &str, // e.g. ">>>>>>> theirs\n"
) -> String {
    let mut output = String::new();

    // Resolved anchors in canonical (path, start_line, end_line) order.
    // Caller is responsible for sorting.
    for anchor in resolved_anchors {
        output.push_str(&anchor.to_string());
        output.push('\n');
    }

    // Separate why divergence (empty-path entry) from anchor residue.
    let why_conflict = unresolved.iter().any(|u| u.path.is_empty());
    let anchor_residue: Vec<&UnresolvedAnchor> =
        unresolved.iter().filter(|u| !u.path.is_empty()).collect();

    // Always insert the blank-line separator before any residue or why.
    if !resolved_anchors.is_empty()
        || !anchor_residue.is_empty()
        || why_conflict
        || !ours_why.is_empty()
    {
        output.push('\n');
    }

    if !anchor_residue.is_empty() || why_conflict {
        // Minimal conflict block wrapping only the residue.
        output.push_str(open_marker);
        for u in &anchor_residue {
            output.push_str(&u.ours.to_string());
            output.push('\n');
        }
        if why_conflict {
            output.push_str(ours_why);
            if !ours_why.ends_with('\n') {
                output.push('\n');
            }
        }
        output.push_str(sep_marker);
        for u in &anchor_residue {
            output.push_str(&u.theirs.to_string());
            output.push('\n');
        }
        if why_conflict {
            output.push_str(theirs_why);
            if !theirs_why.ends_with('\n') {
                output.push('\n');
            }
        }
        output.push_str(close_marker);
    } else if !ours_why.is_empty() {
        // No residue, just write the why text.
        output.push_str(ours_why);
        if !ours_why.ends_with('\n') {
            output.push('\n');
        }
    }

    output
}

/// Write a span file with partial resolution: resolved anchors in canonical
/// order followed by minimal conflict markers wrapping only the unresolved
/// residue (unresolved anchors and/or divergent why text).
///
/// Does NOT re-stage the file (no `git add`), and attempts
/// `git update-index --unresolve <span_path>` to restore unmerged index
/// stages when they are still recoverable.
fn write_residue_span(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    resolved_anchors: &[AnchorRecord],
    unresolved: &[UnresolvedAnchor],
    ours_why: &str,
    theirs_why: &str,
) -> Result<()> {
    // Sort resolved anchors in canonical (path, start_line, end_line) order.
    let mut sorted = resolved_anchors.to_vec();
    sorted.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    let output = format_residue_markers(
        &sorted,
        unresolved,
        ours_why,
        theirs_why,
        "<<<<<<< ours\n",
        "=======\n",
        ">>>>>>> theirs\n",
    );

    // Write atomically (same approach as write_worktree_span).
    let path = span_file_path(repo, span_root, name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_name = format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("span")
    );
    let tmp_path = path
        .parent()
        .map(|p| p.join(&tmp_name))
        .unwrap_or_else(|| std::path::PathBuf::from(&tmp_name));
    std::fs::write(&tmp_path, &output)?;
    std::fs::rename(&tmp_path, &path)?;

    // Only attempt to restore unmerged index stages when the span file
    // actually has unmerged index entries. Otherwise `git update-index
    // --unresolve` prints "Not in the middle of a merge." to stderr, which
    // confuses users.
    let span_rel_path = format!("{span_root}/{name}");
    let has_unmerged = crate::git::index_entries(repo)
        .ok()
        .map(|entries| {
            entries
                .iter()
                .any(|e| e.path == span_rel_path && e.stage != gix::index::entry::Stage::Unconflicted)
        })
        .unwrap_or(false);
    if has_unmerged {
        let _ = std::process::Command::new("git")
            .arg("update-index")
            .arg("--unresolve")
            .arg(&span_rel_path)
            .current_dir(repo.workdir().unwrap_or(std::path::Path::new(".")))
            .status();
    }

    Ok(())
}

/// Resolve a single conflicted span by splitting markers, merging
/// structurally, and writing the result. Returns the resolution outcome.
///
/// Called from `apply_fix` when `has_conflict_markers()` returns true
/// for the raw span content.
fn resolve_conflicted_span(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    raw: &str,
    fix_result: &mut FixResult,
) -> Result<()> {
    // Step 1: Split markers into ours/theirs text.
    let (ours_text, theirs_text) = split_conflict_markers(raw).ok_or_else(|| {
        anyhow::anyhow!(
            "internal error: span `{name}` reported as conflicted but no markers found"
        )
    })?;

    // Step 2: Parse each side as a clean span file (markers are removed).
    // Wrap parse errors with context so the operator can diagnose a span
    // whose conflict marker splitting produced malformed output (e.g. a
    // `=======` inside why text).
    let mut ours = SpanFile::parse(&ours_text).map_err(|e| {
        anyhow::anyhow!(
            "failed to parse conflict-side content for span `{name}`: {e}"
        )
    })?;
    let mut theirs = SpanFile::parse(&theirs_text).map_err(|e| {
        anyhow::anyhow!(
            "failed to parse conflict-side content for span `{name}`: {e}"
        )
    })?;

    // Step 3: Enforce clean-source precondition (fail-closed on a source
    // file that itself contains conflict markers; tolerant of a plain
    // missing/renamed-away path).
    let source_files = read_clean_source_files(repo, &ours, &theirs)?;

    // Step 3b: Prune dead-path orphan anchors that have an unambiguous live
    // counterpart on the other side (renamed-file case), before the
    // structural-merge kernel runs. Fails closed if an unreadable orphan
    // anchor has zero or multiple candidates.
    prune_unreadable_renamed_orphans(&mut ours, &mut theirs, &source_files)?;

    // Step 4: Structural merge.
    let result = merge_span_files(None, &ours, &theirs, &source_files);

    // Step 5: Determine outcome.
    let why_conflict = result.unresolved.iter().any(|u| u.path.is_empty());
    let anchor_residue_count = result.unresolved.iter().filter(|u| !u.path.is_empty()).count();

    if result.unresolved.is_empty() {
        // Fully resolved — all anchors merged cleanly, why resolved.
        let resolved_count = result.merged.anchors.len();
        let mut merged = result.merged;
        write_worktree_span(repo, span_root, name, &mut merged)?;

        // Stage the span file to clear unmerged index stages (1/2/3) so the
        // user can commit directly without a manual `git add`.
        let span_rel_path = format!("{span_root}/{name}");
        let workdir = repo.workdir().unwrap_or(std::path::Path::new("."));
        let add_status = std::process::Command::new("git")
            .arg("add")
            .arg(&span_rel_path)
            .current_dir(workdir)
            .status()
            .map_err(|e| {
                anyhow::anyhow!(
                    "failed to run git add for `{name}` after conflict resolution: {e}"
                )
            })?;
        if !add_status.success() {
            anyhow::bail!("git add failed for `{name}` after conflict resolution");
        }

        fix_result.rewritten_span_names.insert(name.to_string());
        fix_result.spans_touched += 1;
        fix_result.anchors_updated += resolved_count;
        println!("  resolved conflict: `{name}` — all anchors merged clean");
    } else {
        // Partial resolution — write resolved anchors + minimal residue.
        write_residue_span(
            repo,
            span_root,
            name,
            &result.merged.anchors,
            &result.unresolved,
            &ours.why,
            &theirs.why,
        )?;
        fix_result.rewritten_span_names.insert(name.to_string());
        fix_result.spans_touched += 1;
        fix_result.anchors_updated += result.merged.anchors.len();

        // Build a human-readable reason for the residue report.
        let reasons: Vec<String> = {
            let mut r = Vec::new();
            if anchor_residue_count > 0 {
                r.push(format!("{anchor_residue_count} anchor(s) divergent"));
            }
            if why_conflict {
                r.push("--why text diverged".to_string());
            }
            r
        };
        let reason_str = reasons.join("; ");
        println!(
            "  partial resolution: `{name}` — resolved anchors written clean, \
             residue remains ({reason_str}); file not re-staged"
        );
    }

    Ok(())
}

/// Re-anchor every `Moved` anchor and whitespace-equivalent `Changed` anchor
/// in `spans` by rewriting the matching span worktree files. A `Changed`
/// anchor whose content differs beyond whitespace is left drifting. Returns a
/// [`FixResult`] carrying the set of `anchor_id`s actually rewritten and the
/// set of span names whose files were written to disk.
///
/// Terminal statuses (`Deleted`, `ContentUnavailable`, `MergeConflict`,
/// `Submodule`, `Orphaned`) are left untouched. `Fresh` anchors are not
/// candidates either.
///
/// **Conflict resolution**: When on-disk span content carries Git textual
/// conflict markers, `--fix` splits the file into ours/theirs, enforces
/// a clean-source precondition (every source file referenced by either
/// side must be free of conflict markers), calls `merge_span_files()`,
/// and writes the result. Fully resolved conflicts are re-staged (the
/// span name enters [`FixResult::rewritten_span_names`]); conflicts with
/// residual unresolvable anchors or a divergent `--why` write the
/// resolved anchors cleanly, wrap only the residue in minimal conflict
/// markers, do NOT re-stage, and attempt `git update-index --unresolve`
/// to restore unmerged index stages.
pub(crate) fn apply_fix(
    repo: &gix::Repository,
    spans: &[SpanResolved],
    span_root: &str,
    fuzzy_threshold: f64,
) -> Result<FixResult> {
    let mut fix = FixResult {
        rewritten_anchor_ids: HashSet::new(),
        rewritten_span_names: HashSet::new(),
        spans_touched: 0,
        anchors_updated: 0,
        anchors_removed: 0,
    };

    // Resolve HEAD once for HEAD-layer rewrites. Some test scenarios may
    // have no HEAD yet (unborn branch); in that case we simply skip
    // HEAD-layer rewrites and leave the affected anchors as-is.
    let head_oid: Option<String> = repo
        .rev_parse_single("HEAD")
        .ok()
        .map(|id| id.detach().to_string());

    // Materialize the index snapshot once — shared by every
    // hash_anchor_content call and the Index-layer hash path below.
    let index_snapshot: Option<Vec<IndexEntrySnapshot>> =
        crate::git::index_entries(repo).ok();

    for m in spans {
        // --- Conflict detection and resolution ---
        // Read the raw content and check for Git textual conflict markers.
        // When markers are present, attempt structural merge resolution.
        let raw = match read_raw_span_content(repo, span_root, &m.name) {
            Ok(Some(content)) => content,
            Ok(None) => {
                // File does not exist on disk — an empty span (e.g. a
                // staging-only entry with no committed file). Skip.
                continue;
            }
            Err(e) => {
                // I/O error reading the file. Skip this span (pre-existing
                // behavior: unreadable spans are left for the operator).
                eprintln!("warning: cannot read span `{}`: {}", m.name, e);
                continue;
            }
        };

        // If the raw content has conflict markers, resolve structurally.
        if has_conflict_markers(&raw) {
            match resolve_conflicted_span(repo, span_root, &m.name, &raw, &mut fix) {
                Ok(()) => {}
                Err(e) => {
                    // Resolution failed (e.g. conflicted source file).
                    // Report loudly and leave the span conflicted.
                    eprintln!(
                        "warning: cannot resolve conflict in `{}`: {}",
                        m.name, e
                    );
                }
            }
            // Skip the per-anchor re-anchor loop — the conflict resolution
            // already handled the span file completely.
            continue;
        }

        // Parse the clean content (no conflict markers).
        let mut span_file = match SpanFile::parse(&raw) {
            Ok(mf) => mf,
            Err(_) => continue,
        };

        let mut any_rewritten = false;

        // Repair interior anchors in place: drop every anchor record whose
        // path falls inside the span root. `parse` is pure, so a poisoned
        // span loads fine and `--fix` can excise the offending anchor rather
        // than silently no-opping past it. The remaining loud surfacing in
        // `run_stale` covers any span `--fix` does not write (e.g. the anchor
        // lived only in a non-worktree layer).
        let before = span_file.anchors.len();
        span_file
            .anchors
            .retain(|r| crate::span_root::classify_interior_anchor(span_root, &r.path).is_none());
        let dropped = before - span_file.anchors.len();
        if dropped > 0 {
            fix.anchors_removed += dropped;
            any_rewritten = true;
        }

        for resolved in &m.anchors {
            // Re-anchor `Moved` unconditionally (bytes are identical, only
            // relocated). Re-anchor `Changed` only when the change preserved
            // the anchored content (whitespace/formatting-equivalent); a
            // meaning-changing edit is left drifting so the coupling
            // resurfaces. Everything else (Fresh, terminal) is skipped.
            let reanchor = match resolved.status {
                AnchorStatus::Moved => {
                    // Exact-match MOVED (fuzzy_successors empty): always
                    // re-anchor. Fuzzy MOVED: only re-anchor when confidence
                    // meets or exceeds the threshold.
                    match resolved.fuzzy_successors.first() {
                        Some(best) => best.confidence >= fuzzy_threshold,
                        None => true,
                    }
                }
                AnchorStatus::Changed => resolved.content_equivalent,
                AnchorStatus::ResolvedPendingCommit => false,  // already synced with worktree
                _ => false,
            };
            if !reanchor {
                continue;
            }
            let Some(current) = &resolved.current else {
                continue;
            };

            // Pick the shallowest drifting layer: H < I < W.
            // Re-anchoring against the shallowest layer ensures the hash
            // and position share provenance (card main-148).
            let layer = match resolved
                .layer_sources
                .iter()
                .copied()
                .min_by_key(|s| match s {
                    DriftSource::Head => 1,
                    DriftSource::Index => 2,
                    DriftSource::Worktree => 3,
                }) {
                Some(s) => s,
                None => continue,
            };

            let cur_path_str = current.path.to_string_lossy().to_string();
            let cur_extent = current.extent;

            // For in-file MOVED anchors the anchored content has not
            // changed — only its position. Re-use the existing hash from
            // the span record instead of re-hashing, which would compute
            // a hash against a potentially different layer's content at
            // the tracked position (card main-148).
            // Cross-file (rename) and fuzzy relocations must re-hash:
            // the content is at a different path or has changed.
            let idx = index_snapshot.as_deref().unwrap_or(&[]);
            let hash_hex: String = if matches!(resolved.status, AnchorStatus::Moved)
                && resolved.fuzzy_successors.is_empty()
                && resolved
                    .current
                    .as_ref()
                    .is_some_and(|c| c.path == resolved.anchored.path)
            {
                let (anc_start, anc_end) = match resolved.anchored.extent {
                    AnchorExtent::LineRange { start, end } => (start, end),
                    AnchorExtent::WholeFile => (0, 0),
                };
                let anc_path = resolved.anchored.path.to_string_lossy().to_string();
                match span_file
                    .anchors
                    .iter()
                    .find(|r| {
                        r.path == anc_path
                            && r.start_line == anc_start
                            && r.end_line == anc_end
                    })
                    .map(|r| r.content_hash.clone())
                {
                    Some(h) => h,
                    None => continue,
                }
            } else {
                // Compute the canonical hash from the surfacing layer.
                match layer {
                    DriftSource::Worktree => {
                        crate::perf::record_fix_hash_call();
                        match hash_anchor_content(
                            repo, &cur_path_str, &cur_extent, None, idx,
                        ) {
                            Ok((_alg, h)) => h,
                            Err(_) => continue,
                        }
                    }
                    DriftSource::Head => {
                        let oid = match head_oid.as_deref() {
                            Some(o) => o,
                            None => continue,
                        };
                        crate::perf::record_fix_hash_call();
                        let head_result = hash_anchor_content(
                            repo, &cur_path_str, &cur_extent, Some(oid), idx,
                        );
                        match head_result {
                            Ok((_alg, h)) => h,
                            Err(_) => {
                                let entry = match index_snapshot
                                    .as_deref()
                                    .unwrap_or(&[])
                                    .iter()
                                    .find(|en| {
                                        en.path == cur_path_str
                                            && en.stage
                                                == gix::index::entry::Stage::Unconflicted
                                    }) {
                                    Some(e) => e,
                                    None => continue,
                                };
                                let blob_oid_hex = entry.oid.to_string();
                                let bytes = match crate::git::read_blob_bytes(
                                    repo, &blob_oid_hex,
                                ) {
                                    Ok(b) => b,
                                    Err(_) => continue,
                                };
                                if let AnchorExtent::LineRange { start, end } =
                                    cur_extent
                                {
                                    let line_count = std::str::from_utf8(&bytes)
                                        .map(|s| s.lines().count() as u32)
                                        .unwrap_or(0);
                                    if start < 1 || end < start || end > line_count {
                                        continue;
                                    }
                                    if std::str::from_utf8(&bytes).is_err() {
                                        continue;
                                    }
                                }
                                rk64_to_hex(cheap_fingerprint_with_extent(
                                    &bytes, &cur_extent,
                                ))
                            }
                        }
                    }
                    DriftSource::Index => {
                        let entry = match index_snapshot
                            .as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .find(|en| {
                                en.path == cur_path_str
                                    && en.stage
                                        == gix::index::entry::Stage::Unconflicted
                            }) {
                            Some(e) => e,
                            None => continue,
                        };
                        let blob_oid_hex = entry.oid.to_string();
                        let bytes = match crate::git::read_blob_bytes(
                            repo, &blob_oid_hex,
                        ) {
                            Ok(b) => b,
                            Err(_) => continue,
                        };
                        if let AnchorExtent::LineRange { start, end } = cur_extent {
                            let line_count = std::str::from_utf8(&bytes)
                                .map(|s| s.lines().count() as u32)
                                .unwrap_or(0);
                            if start < 1 || end < start || end > line_count {
                                continue;
                            }
                            if std::str::from_utf8(&bytes).is_err() {
                                continue;
                            }
                        }
                        rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &cur_extent))
                    }
                }
            };

            // Locate the AnchorRecord matching the anchored (path, extent).
            let (anc_start, anc_end) = match resolved.anchored.extent {
                AnchorExtent::LineRange { start, end } => (start, end),
                AnchorExtent::WholeFile => (0, 0),
            };
            let anc_path = resolved.anchored.path.to_string_lossy().to_string();

            let record = span_file.anchors.iter_mut().find(|r| {
                r.path == anc_path && r.start_line == anc_start && r.end_line == anc_end
            });
            let Some(record) = record else { continue };

            // Rewrite in place.
            let (new_start, new_end) = match cur_extent {
                AnchorExtent::LineRange { start, end } => (start, end),
                AnchorExtent::WholeFile => (0, 0),
            };
            record.path = cur_path_str;
            record.start_line = new_start;
            record.end_line = new_end;
            record.algorithm = RK64_ALGORITHM.to_string();
            record.content_hash = hash_hex;
            fix.rewritten_anchor_ids.insert(resolved.anchor_id.clone());
            fix.anchors_updated += 1;
            crate::perf::record_fix_rewritable_anchor();
            any_rewritten = true;
        }

        // Record keys (path, start, end) of anchors eligible to participate
        // in a line-range merge. A record is mergeable ONLY when it is
        // "worktree-fresh after the rewrite pass" — its recorded content
        // matches the worktree at its extent — so the worktree union hash
        // `coalesce_line_ranges` recomputes is provably correct. Anything
        // else (terminal drift, non-worktree-layer drift, a Moved/Changed
        // that failed to rewrite) is a barrier. Built after the rewrite loop
        // because the Moved/Changed branch depends on the `rewritten` set.
        let mut mergeable_keys: HashSet<(String, u32, u32)> = HashSet::new();
        for resolved in &m.anchors {
            match resolved.status {
                AnchorStatus::Fresh => {
                    // Fresh anchors are not rewritten; their record still
                    // carries the anchored address and is worktree-fresh.
                    let (s, e) = match resolved.anchored.extent {
                        AnchorExtent::LineRange { start, end } => (start, end),
                        AnchorExtent::WholeFile => (0, 0),
                    };
                    mergeable_keys.insert((
                        resolved.anchored.path.to_string_lossy().to_string(),
                        s,
                        e,
                    ));
                }
                AnchorStatus::Moved | AnchorStatus::Changed => {
                    // Eligible only when it was actually rewritten this pass
                    // and its deepest drift layer is the worktree (so the
                    // rewritten record hashes the worktree content). The loop
                    // rewrote the record to `current`'s path/extent.
                    if !fix.rewritten_anchor_ids.contains(&resolved.anchor_id) {
                        continue;
                    }
                    let Some(current) = &resolved.current else {
                        continue;
                    };
                    let deepest = resolved
                        .layer_sources
                        .iter()
                        .copied()
                        .max_by_key(|s| match s {
                            DriftSource::Worktree => 3,
                            DriftSource::Index => 2,
                            DriftSource::Head => 1,
                        });
                    if deepest != Some(DriftSource::Worktree) {
                        continue;
                    }
                    let (s, e) = match current.extent {
                        AnchorExtent::LineRange { start, end } => (start, end),
                        AnchorExtent::WholeFile => (0, 0),
                    };
                    mergeable_keys
                        .insert((current.path.to_string_lossy().to_string(), s, e));
                }
                // Terminal statuses are never eligible.
                _ => {}
            }
        }

        // Normalize line-range anchors: collapse every contiguous or
        // overlapping pair on the same path into a single anchor. This runs
        // over the records as they stand after the per-anchor rewrite —
        // both ranges this run relocated and ranges that were already
        // adjacent in the authored span — so the written file is fully
        // normalized regardless of whether anything was re-anchored.
        let before_coalesce = fix.rewritten_anchor_ids.len();
        let coalesced = coalesce_line_ranges(
            repo,
            &m.name,
            &mut span_file,
            &mergeable_keys,
            &mut fix.rewritten_anchor_ids,
            index_snapshot.as_deref().unwrap_or(&[]),
        );
        let coalesced_count = fix.rewritten_anchor_ids.len() - before_coalesce;
        fix.anchors_updated += coalesced_count;

        if any_rewritten || coalesced {
            write_worktree_span(repo, span_root, &m.name, &mut span_file)?;
            fix.rewritten_span_names.insert(m.name.clone());
            fix.spans_touched += 1;
        }
    }

    Ok(fix)
}

/// Coalesce contiguous and overlapping line-range anchors on the same path
/// within a single span's records, in place.
///
/// Two line-range anchors on one `path` merge when their `[start, end]`
/// intervals overlap or are contiguous (`a.end + 1 >= b.start` after
/// sorting by `start`); the merged anchor spans `min(start)..max(end)` and
/// carries one freshly recomputed rk64 fingerprint over that combined extent.
/// A pair merges only when both contributing anchors are eligible — i.e.
/// each record's key is in `mergeable_keys`, the set of anchors that are
/// worktree-fresh after the rewrite pass (`Fresh` anchors, or `Moved`/
/// `Changed` anchors rewritten this pass whose deepest drift layer is the
/// worktree). A record NOT in `mergeable_keys` is a barrier: it breaks any
/// run and is passed through unchanged. This restriction is what makes
/// hashing the merged union from the worktree always correct — every merged
/// run is worktree-fresh, so its recomputed worktree union hash matches the
/// layer the per-anchor pass resolved, and the merged anchor re-resolves
/// `Fresh`. Terminal anchors (`Deleted`, `MergeConflict`, `Submodule`,
/// `ContentUnavailable`) and non-worktree-layer drift (committed/staged
/// edits with a clean worktree at the extent) are thus never folded in, so
/// the merge never papers over drift the operator still needs to see. The
/// combined region must also hash without conflict; a union the worktree
/// cannot hash is left as distinct anchors.
///
/// Whole-file anchors (`0/0`) are inert: they never merge with line-range
/// anchors on the same path and are never split or absorbed.
///
/// The `anchor_id` of every merged anchor is inserted into `merged_ids`
/// (the set the caller subtracts from the post-fix exit code) so the
/// collapsed range does not surface as residual drift. Returns `true` when
/// at least one merge changed the record set.
///
/// Cost: grouping is O(n) per span, sorting each path's ranges is
/// O(n log n) (dominant), and the sweep is O(n) — O(N log N) across N
/// anchors. The only added I/O is one hash recompute per extension via the
/// hashing path `--fix` already uses; whole-file anchors add nothing.
fn coalesce_line_ranges(
    repo: &gix::Repository,
    span_name: &str,
    span_file: &mut SpanFile,
    mergeable_keys: &HashSet<(String, u32, u32)>,
    merged_ids: &mut HashSet<String>,
    index_snapshot: &[IndexEntrySnapshot],
) -> bool {
    // Group line-range record indices by path; whole-file anchors (0/0) are
    // inert and never enter a group. BTreeMap keeps path iteration order
    // deterministic.
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, r) in span_file.anchors.iter().enumerate() {
        if r.start_line == 0 && r.end_line == 0 {
            continue;
        }
        groups.entry(r.path.clone()).or_default().push(i);
    }

    // A merged run emits its anchor at the lowest original index among its
    // members; the remaining members are dropped. Single-member runs leave
    // their record untouched.
    let mut replacement: HashMap<usize, AnchorRecord> = HashMap::new();
    let mut dropped: HashSet<usize> = HashSet::new();

    for (path, mut idxs) in groups {
        idxs.sort_by_key(|&i| {
            let r = &span_file.anchors[i];
            (r.start_line, r.end_line)
        });

        // Current run: member indices, extent, and the union hash recorded on
        // the last successful extension (`None` while the run is a single
        // member, which keeps its original hash).
        let mut run: Option<(Vec<usize>, u32, u32, Option<String>)> = None;

        let flush = |run: Option<(Vec<usize>, u32, u32, Option<String>)>,
                         replacement: &mut HashMap<usize, AnchorRecord>,
                         dropped: &mut HashSet<usize>,
                         merged_ids: &mut HashSet<String>| {
            let Some((members, start, end, hash)) = run else {
                return;
            };
            if members.len() < 2 {
                return;
            }
            let emit_at = *members.iter().min().expect("run is non-empty");
            let content_hash = hash.expect("multi-member run records a union hash");
            replacement.insert(
                emit_at,
                AnchorRecord {
                    path: path.clone(),
                    start_line: start,
                    end_line: end,
                    algorithm: RK64_ALGORITHM.to_string(),
                    content_hash,
                },
            );
            for &i in &members {
                if i != emit_at {
                    dropped.insert(i);
                }
            }
            merged_ids.insert(format!("{span_name}:{path}:L{start}-L{end}"));
        };

        for &i in &idxs {
            let r = &span_file.anchors[i];
            let is_mergeable =
                mergeable_keys.contains(&(r.path.clone(), r.start_line, r.end_line));

            if !is_mergeable {
                // Barrier: a record that is not worktree-fresh (terminal or
                // non-worktree-layer drift) breaks any run and never merges.
                flush(run.take(), &mut replacement, &mut dropped, merged_ids);
                continue;
            }

            match run.take() {
                None => {
                    run = Some((vec![i], r.start_line, r.end_line, None));
                }
                Some((mut members, start, end, hash)) => {
                    if r.start_line <= end.saturating_add(1) {
                        // Contiguous or overlapping: only merge if the
                        // combined extent hashes cleanly against the worktree.
                        let new_end = end.max(r.end_line);
                        let extent = AnchorExtent::LineRange {
                            start,
                            end: new_end,
                        };
                        crate::perf::record_fix_hash_call();
                        match hash_anchor_content(repo, &path, &extent, None, index_snapshot) {
                            Ok((_alg, h)) => {
                                members.push(i);
                                run = Some((members, start, new_end, Some(h)));
                            }
                            Err(_) => {
                                // Union cannot be hashed: keep both separate.
                                flush(
                                    Some((members, start, end, hash)),
                                    &mut replacement,
                                    &mut dropped,
                                    merged_ids,
                                );
                                run = Some((vec![i], r.start_line, r.end_line, None));
                            }
                        }
                    } else {
                        flush(
                            Some((members, start, end, hash)),
                            &mut replacement,
                            &mut dropped,
                            merged_ids,
                        );
                        run = Some((vec![i], r.start_line, r.end_line, None));
                    }
                }
            }
        }

        flush(run.take(), &mut replacement, &mut dropped, merged_ids);
    }

    if replacement.is_empty() {
        return false;
    }

    let mut new_anchors = Vec::with_capacity(span_file.anchors.len());
    for (i, r) in span_file.anchors.iter().enumerate() {
        if let Some(merged) = replacement.get(&i) {
            new_anchors.push(merged.clone());
        } else if !dropped.contains(&i) {
            new_anchors.push(r.clone());
        }
    }
    span_file.anchors = new_anchors;
    true
}
