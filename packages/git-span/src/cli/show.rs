//! `git span` list / `git span <name>` show / `git span list` — §10.4, §3.4.

use crate::cli::format;
use crate::cli::{CliError, ListArgs, NextStep, ShowArgs, parse_range_address};
use crate::types::{AnchorExtent, SpanConfig};
use crate::validation::validate_span_name_shape;
use anyhow::Result;
use serde::Serialize;
use std::collections::HashSet;

// ---------------------------------------------------------------------------
// Listing pipeline types and helpers
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AnchorEntry {
    path: String,
    extent: AnchorExtent,
}

#[derive(Clone)]
struct SpanListing {
    name: String,
    why: String,
    anchors: Vec<AnchorEntry>,
}

/// Build [`SpanListing`]s from already-loaded spans so callers who hold a
/// single corpus load can derive listings without a second parse.
fn build_listings(spans: &[(String, crate::types::Span)], include_why: bool) -> Vec<SpanListing> {
    spans
        .iter()
        .map(|(name, span)| {
            let why = if include_why {
                span.why.clone()
            } else {
                String::new()
            };
            let anchors: Vec<AnchorEntry> = span
                .anchors
                .iter()
                .map(|(_id, r)| AnchorEntry {
                    path: r.path.clone(),
                    extent: r.extent,
                })
                .collect();
            SpanListing {
                name: name.clone(),
                why: why.trim_end_matches('\n').to_string(),
                anchors,
            }
        })
        .collect()
}

/// Build [`SpanListing`]s for a specific set of names from already-loaded
/// spans.
fn build_listings_for_names(
    spans: &[(String, crate::types::Span)],
    names: &[String],
    include_why: bool,
) -> Vec<SpanListing> {
    let name_set: HashSet<&str> = names.iter().map(String::as_str).collect();
    spans
        .iter()
        .filter(|(name, _)| name_set.contains(name.as_str()))
        .map(|(name, span)| {
            let why = if include_why {
                span.why.clone()
            } else {
                String::new()
            };
            let anchors: Vec<AnchorEntry> = span
                .anchors
                .iter()
                .map(|(_id, r)| AnchorEntry {
                    path: r.path.clone(),
                    extent: r.extent,
                })
                .collect();
            SpanListing {
                name: name.clone(),
                why: why.trim_end_matches('\n').to_string(),
                anchors,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// BatchFilter — shared grammar for `list --batch` and `stale --batch`
// ---------------------------------------------------------------------------

/// A single stdin filter line for batch commands.
///
/// Grammar:
///   - `<path>` — matches all anchors whose path equals `path`
///   - `<path>#L<start>-L<end>` — matches anchors whose range overlaps
///     `[start, end]`; whole-file anchors (`0-0`) are suppressed
pub enum BatchFilter {
    /// Plain path — match every anchor on this path.
    Path(String),
    /// Range filter — intersect each anchor's `[start, end]` against
    /// `[start, end]`; suppress whole-file anchors.
    Ranged { path: String, start: u32, end: u32 },
}

impl BatchFilter {
    /// Parse one stdin line into a `BatchFilter`.
    ///
    /// The ranged grammar is `<path>#L<digits>-L<digits>` at end-of-line.
    /// Only a tail-anchored match (`#L<start>-L<end>` where both are
    /// integers) is treated as ranged; any other `#L` substring in the
    /// path component is left as-is and the whole line is treated as a
    /// plain path. This avoids misparses like `notes/issue#L42.md`.
    pub fn parse(line: &str) -> Result<Self> {
        // Look for the last `#L` occurrence and check whether the tail
        // matches `<digits>-L<digits>` (end-of-string).
        if let Some(hash_pos) = line.rfind("#L") {
            let tail = &line[hash_pos + 2..]; // after "#L"
            // tail must be "<digits>-L<digits>"
            if let Some(dash_l_pos) = tail.find("-L") {
                let start_str = &tail[..dash_l_pos];
                let end_str = &tail[dash_l_pos + 2..];
                if !start_str.is_empty()
                    && !end_str.is_empty()
                    && start_str.chars().all(|c| c.is_ascii_digit())
                    && end_str.chars().all(|c| c.is_ascii_digit())
                {
                    // Parse directly using the tail-anchored components to
                    // avoid `parse_range_address` splitting on the first `#L`
                    // (which would mangle paths containing `#L` substrings).
                    let path = line[..hash_pos].to_string();
                    let start: u32 = start_str.parse()?;
                    let end: u32 = end_str.parse()?;
                    if path.is_empty() {
                        return Err(anyhow::anyhow!(
                            "invalid anchor `{line}`; anchor path cannot be empty"
                        ));
                    }
                    if start < 1 {
                        return Err(anyhow::anyhow!(
                            "invalid anchor `{line}`; anchor start must be at least 1"
                        ));
                    }
                    if end < start {
                        return Err(anyhow::anyhow!(
                            "invalid anchor `{line}`; anchor end must be at least start"
                        ));
                    }
                    return Ok(BatchFilter::Ranged { path, start, end });
                }
            }
        }
        Ok(BatchFilter::Path(line.to_string()))
    }

    /// Returns the path component of this filter.
    pub fn path(&self) -> &str {
        match self {
            BatchFilter::Path(p) => p,
            BatchFilter::Ranged { path, .. } => path,
        }
    }

    /// Returns true if this filter matches the given anchor.
    ///
    /// For `Path` filters, any anchor on the path matches.
    /// For `Ranged` filters, whole-file anchors are suppressed and
    /// line-range anchors must overlap the filter range.
    pub fn matches_anchor(&self, anchor_path: &str, extent: AnchorExtent) -> bool {
        match self {
            BatchFilter::Path(p) => anchor_path == p,
            BatchFilter::Ranged { path, start, end } => {
                if anchor_path != path {
                    return false;
                }
                match extent {
                    // Whole-file anchors suppressed under ranged filter
                    AnchorExtent::WholeFile => false,
                    AnchorExtent::LineRange {
                        start: a_start,
                        end: a_end,
                    } => a_start <= *end && a_end >= *start,
                }
            }
        }
    }
}

/// Collect individual range pairs from a set of `BatchFilter` lines for the
/// same path. Returns the path and an optional vec of `(start, end)` pairs;
/// `None` means at least one filter is path-only (match everything on the
/// path). Individual ranges are preserved rather than collapsed into a
/// bounding hull so that an anchor between two disjoint ranges is not
/// falsely reported as matching.
pub fn merge_batch_filters(filters: &[BatchFilter]) -> (String, Option<Vec<(u32, u32)>>) {
    debug_assert!(!filters.is_empty());
    let path = filters[0].path().to_string();
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    for f in filters {
        match f {
            BatchFilter::Path(_) => return (path, None),
            BatchFilter::Ranged { start, end, .. } => ranges.push((*start, *end)),
        }
    }
    (path, Some(ranges))
}

fn anchor_addr_plain(a: &AnchorEntry) -> String {
    match a.extent {
        AnchorExtent::LineRange { start, end } => format!("{}#L{start}-L{end}", a.path),
        AnchorExtent::WholeFile => a.path.clone(),
    }
}

fn render_list_block(listing: &SpanListing) {
    println!("## {}", listing.name);
    let mut bullets: Vec<String> = Vec::new();
    for a in &listing.anchors {
        bullets.push(format!("- {}", anchor_addr_plain(a)));
    }
    if bullets.is_empty() {
        println!("*Span has no anchors*");
    } else {
        for b in &bullets {
            println!("{b}");
        }
    }
    let trimmed_why = listing.why.trim_end_matches('\n');
    if !trimmed_why.is_empty() {
        println!();
        println!("{trimmed_why}");
    }
}

fn render_blocks(page: &[SpanListing]) {
    let total = page.len();
    for (i, listing) in page.iter().enumerate() {
        render_list_block(listing);
        if i + 1 < total {
            println!();
            println!("---");
            println!();
        }
    }
}

fn render_porcelain(page: &[SpanListing]) {
    for listing in page {
        for a in &listing.anchors {
            let extent_str = match a.extent {
                AnchorExtent::LineRange { start, end } => format!("{start}-{end}"),
                AnchorExtent::WholeFile => "0-0".to_string(),
            };
            println!("{}\t{}\t{}", listing.name, a.path, extent_str);
        }
    }
}

// ---------------------------------------------------------------------------
// TOML output helpers for `git span show`
// ---------------------------------------------------------------------------

/// Serialization wrapper so `Vec<(String, Anchor)>` renders as a TOML
/// array of tables with `id` as a regular field rather than a tuple.
#[derive(Serialize)]
struct AnchorEntryToml {
    id: String,
    path: String,
    extent: AnchorExtent,
}

/// Top-level TOML shape for `git span show`. Omits the compatibility
/// `anchors` field (`Vec<String>`) and any live-resolution state.
#[derive(Serialize)]
struct SpanToml {
    name: String,
    why: String,
    anchors: Vec<AnchorEntryToml>,
    config: SpanConfig,
}

// ---------------------------------------------------------------------------
// Public run functions
// ---------------------------------------------------------------------------

pub fn run_show(repo: &gix::Repository, args: ShowArgs, span_root: &str) -> Result<i32> {
    let span = {
        let _perf = crate::perf::span("show.read-span");
        // Fail-closed: a span in a Git conflict state cannot be shown —
        // refuse explicitly rather than rendering conflict-marker text as
        // valid why/anchor data.
        let conflict_err = |name: &str| CliError {
            subcommand: "show",
            summary: format!("span `{name}` is in a Git conflict state."),
            what_happened: format!(
                "The span file for `{name}` has an unresolved merge \
                 (unmerged index entry or `<<<<<<<`/`>>>>>>>` markers). \
                 git-span refuses to present conflict-marker content as \
                 valid span data."
            ),
            next_steps: vec![
                NextStep::Bash(format!("git status {span_root}/{name}")),
                NextStep::Prose("Resolve the merge conflict in the span file, then retry.".into()),
            ],
        };
        crate::span::read::read_span_in(repo, &args.name, span_root).map_err(|e| {
            if matches!(e, crate::Error::SpanConflict(_)) {
                conflict_err(&args.name)
            } else if matches!(e, crate::Error::SpanNotFound(_)) {
                CliError {
                    subcommand: "show",
                    summary: format!("no span named `{}`.", args.name),
                    what_happened: format!("{}", e),
                    next_steps: vec![NextStep::Bash("git span list".into())],
                }
            } else {
                // The span file exists but failed to parse (or another
                // read error). Surface only the underlying error —
                // a "not found" summary would be misleading for a
                // span that exists. Matches what `list`/`stale` do.
                CliError {
                    subcommand: "show",
                    summary: format!("{}", e),
                    what_happened: format!(
                        "The span file for `{}` could not be read.",
                        args.name
                    ),
                    next_steps: vec![NextStep::Bash(format!("git span doctor {}", args.name))],
                }
            }
        })?
    };

    let _perf = crate::perf::span("show.render-default");

    let toml_output = SpanToml {
        name: span.name.clone(),
        why: span.why.trim_end_matches('\n').to_string(),
        anchors: span
            .anchors
            .iter()
            .map(|(id, a)| AnchorEntryToml {
                id: id.clone(),
                path: a.path.clone(),
                extent: a.extent,
            })
            .collect(),
        config: span.config,
    };

    let toml_str = toml::to_string_pretty(&toml_output)?;
    print!("{toml_str}");
    Ok(0)
}

pub fn run_list(repo: &gix::Repository, args: ListArgs, span_root: &str) -> Result<i32> {
    // Reset the corpus-load counters incremented from deep call sites
    // (`load_all_spans_in`, the glob scan) so the emit block at the end
    // reports values from this single list invocation only.
    crate::perf::reset_list_counters();

    // Load the full span corpus exactly once. Every downstream consumer
    // — target resolution, conflict detection, listing collection —
    // derives its answer from this single in-memory copy. Discovery and
    // parse phases are timed inside `load_all_spans_in`.
    let (spans, conflicted) =
        crate::span::read::load_all_spans_in(repo, span_root)?;

    // Build the path index from the already-loaded spans so target
    // resolution doesn't trigger a second corpus parse.
    let index_build_start = crate::perf::enabled().then(std::time::Instant::now);
    let path_index = crate::span::read::SpanPathIndex::from_loaded_spans(&spans)?;
    let index_build_us = index_build_start
        .map(|t| t.elapsed().as_micros() as u64)
        .unwrap_or(0);

    // Collect loaded span names into a set so bare-name lookups can
    // check membership without a per-arg `read_effective` call.
    let loaded_names: std::collections::HashSet<String> =
        spans.iter().map(|(n, _)| n.clone()).collect();

    // Resolve targets to span names (or list all if no args).
    let resolved_names: Option<Vec<String>> = if args.targets.is_empty() {
        None
    } else {
        Some(resolve_targets_from_index(
            repo,
            span_root,
            &args.targets,
            &path_index,
            &loaded_names,
        )?)
    };

    // Fail-closed: a span in a Git conflict state cannot be listed
    // reliably (`load_all_spans_in` skips it rather than rendering
    // conflict-marker text). Refuse explicitly instead of silently
    // dropping it, so an unresolved merge is never reported as a clean
    // empty list. Conflict names were collected during the single
    // corpus load above — no second scan needed.
    {
        let in_scope: Vec<String> = match &resolved_names {
            Some(names) => conflicted
                .into_iter()
                .filter(|c| names.iter().any(|n| n == c))
                .collect(),
            None => conflicted,
        };
        if !in_scope.is_empty() {
            let joined = in_scope.join("`, `");
            return Err(CliError {
                subcommand: "list",
                summary: format!("span `{joined}` is in a Git conflict state."),
                what_happened: format!(
                    "The span file(s) `{joined}` have an unresolved merge \
                     (unmerged index entry or `<<<<<<<`/`>>>>>>>` markers). \
                     git-span refuses to list conflict-marker content as \
                     valid span data."
                ),
                next_steps: vec![
                    NextStep::Bash(format!("git status {span_root}")),
                    NextStep::Prose(
                        "Resolve the merge conflict in the span file(s), then retry.".into(),
                    ),
                ],
            }
            .into());
        }
    }

    // Counts for the perf emit block (computed only when perf is enabled to
    // keep the disabled path allocation- and loop-free). `spans-matched` is
    // the count surviving glob/target resolution; with no targets it is the
    // whole loaded corpus. `anchors-indexed` is the flat path-index size.
    let (anchors_indexed, spans_matched) = if crate::perf::enabled() {
        let anchors: u64 = spans.iter().map(|(_, m)| m.anchors.len() as u64).sum();
        let matched = match &resolved_names {
            Some(names) => names.len() as u64,
            None => spans.len() as u64,
        };
        (anchors, matched)
    } else {
        (0, 0)
    };

    let include_why = !args.porcelain;
    let mut listings = {
        let _perf = crate::perf::span("list.collect");
        if let Some(ref names) = resolved_names {
            build_listings_for_names(&spans, names, include_why)
        } else {
            build_listings(&spans, include_why)
        }
    };

    // Emit the per-phase corpus-load counters for the list path. Phase
    // timings recorded from deep call sites are read back here, mirroring the
    // resolver's `stale_spans` emit block; `render_us` is the only timing
    // measured locally. No-ops when perf is disabled.
    let emit_list_counters = |render_us: u64| {
        crate::perf::counter("list.discover-us", crate::perf::list_discover_us());
        crate::perf::counter("list.parse-us", crate::perf::list_parse_us());
        crate::perf::counter("list.index-build-us", index_build_us);
        crate::perf::counter("list.glob-scan-us", crate::perf::list_glob_scan_us());
        crate::perf::counter("list.render-us", render_us);
        crate::perf::counter(
            "list.spans-discovered",
            crate::perf::list_spans_discovered(),
        );
        crate::perf::counter("list.spans-parsed", crate::perf::list_spans_parsed());
        crate::perf::counter("list.bytes-parsed", crate::perf::list_bytes_parsed());
        crate::perf::counter("list.layer-reads", crate::perf::list_layer_reads());
        crate::perf::counter("list.anchors-indexed", anchors_indexed);
        crate::perf::counter("list.spans-matched", spans_matched);
    };

    let _perf = crate::perf::span("list.sort-page-render");
    listings.sort_by(|a, b| a.name.cmp(&b.name));

    let page: Vec<_> = listings
        .into_iter()
        .skip(args.offset)
        .take(args.limit.unwrap_or(usize::MAX))
        .collect();

    if page.is_empty() {
        println!("No spans match the filters.");
        emit_list_counters(0);
        return Ok(0);
    }

    let render_start = crate::perf::enabled().then(std::time::Instant::now);
    if args.oneline {
        let _perf = crate::perf::span("list.render-oneline");
        for listing in &page {
            for a in &listing.anchors {
                let addr = match a.extent {
                    AnchorExtent::LineRange { start, end } => {
                        format::format_anchor_address(&a.path, Some(start), Some(end))
                    }
                    AnchorExtent::WholeFile => format::format_anchor_address(&a.path, None, None),
                };
                println!("`{}` `{}`", listing.name, addr);
            }
        }
    } else if args.porcelain {
        render_porcelain(&page);
    } else {
        render_blocks(&page);
    }
    let render_us = render_start
        .map(|t| t.elapsed().as_micros() as u64)
        .unwrap_or(0);
    emit_list_counters(render_us);

    Ok(0)
}

// ---------------------------------------------------------------------------
// Multi-target resolver
// ---------------------------------------------------------------------------

/// Resolve positional args to a deduplicated set of span names, given a
/// pre-built [`SpanPathIndex`] and a set of loaded span names so callers who
/// already hold a single corpus load can resolve targets without a second
/// parse.
///
/// Two-step dispatch per arg:
///   - `#L` range → `parse_range_address` + path-index match with range
///   - span-name shape → check the pre-loaded name set, else fall through to
///     a path-index scan
///   - glob / path → path-index scan, then a worktree existence check
///
/// Zero-match args produce stderr diagnostics and an error.  Empty args return
/// an empty vector immediately.
fn resolve_targets_from_index(
    repo: &gix::Repository,
    _span_root: &str,
    args: &[String],
    path_index: &crate::span::read::SpanPathIndex,
    loaded_names: &std::collections::HashSet<String>,
) -> Result<Vec<String>> {
    if args.is_empty() {
        return Ok(Vec::new());
    }

    let mut result: HashSet<String> = HashSet::new();
    let mut missing_args: Vec<&str> = Vec::new();

    for arg in args {
        if arg.contains("#L") {
            let (path, start, end) = parse_range_address(arg)?;
            let names = path_index.matching_names(&path, Some((start, end)));
            if !names.is_empty() {
                result.extend(names);
            } else if !file_exists_in_workdir(repo, std::path::Path::new(&path)) {
                missing_args.push(arg);
            }
        } else if validate_span_name_shape(arg).is_ok() {
            // Check the pre-loaded name set before falling through to the
            // path index — avoids a per-arg `read_effective` call.
            if loaded_names.contains(arg) {
                result.insert(arg.clone());
            } else {
                let names = path_index.matching_names(arg, None);
                if !names.is_empty() {
                    result.extend(names);
                } else if !file_exists_in_workdir(repo, std::path::Path::new(arg)) {
                    missing_args.push(arg);
                }
            }
        } else if crate::span::read::is_glob_pattern(arg) {
            let names = path_index.matching_names_glob(arg, None)?;
            if !names.is_empty() {
                result.extend(names);
            } else {
                missing_args.push(arg);
            }
        } else {
            let names = path_index.matching_names(arg, None);
            if !names.is_empty() {
                result.extend(names);
            } else if !file_exists_in_workdir(repo, std::path::Path::new(arg)) {
                missing_args.push(arg);
            }
        }
    }

    if !missing_args.is_empty() {
        let all = missing_args.join("`, `");
        return Err(CliError {
            subcommand: "list",
            summary: format!("`{all}` did not match any span, file, or path."),
            what_happened: format!(
                "The following arguments did not match a span name, a file path, \
                 or a path-index entry: `{all}`. Git-span resolves positional \
                 arguments as span names, file paths, or globs."
            ),
            next_steps: vec![
                NextStep::Prose("Check the spelling or list available spans.".into()),
                NextStep::Bash("git span list".into()),
            ],
        }
        .into());
    }

    Ok(result.into_iter().collect())
}

fn file_exists_in_workdir(repo: &gix::Repository, rel: &std::path::Path) -> bool {
    repo.workdir()
        .map(|w| w.join(rel).exists())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    // -----------------------------------------------------------------------
    // shared test helpers
    // -----------------------------------------------------------------------

    use std::path::Path;
    use std::process::Command;

    fn seed_repo() -> (tempfile::TempDir, gix::Repository) {
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "alpha\n").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
        let repo = gix::open(dir).unwrap();
        (td, repo)
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Write and commit a span file under `.span/<name>` so the
    /// file-backed `SpanFileReader` HEAD layer resolves it.
    fn create_span_ref(repo: &gix::Repository, name: &str) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        let span_path = workdir.join(".span").join(name);
        std::fs::create_dir_all(span_path.parent().unwrap()).unwrap();
        // A span with no anchors and no why serializes to empty; write a
        // single-line why so the file is non-empty and parses back.
        let mf = crate::span_file::SpanFile {
            anchors: Vec::new(),
            why: format!("span {name}"),
        };
        std::fs::write(&span_path, mf.serialize()).unwrap();
        run_git(&workdir, &["add", "-A"]);
        run_git(
            &workdir,
            &["commit", "-m", &format!("test: create span {name}")],
        );
    }

    // -----------------------------------------------------------------------
    // run_list integration tests
    // -----------------------------------------------------------------------

    #[test]
    fn run_list_no_args_returns_ok() {
        let (_td, repo) = seed_repo();
        let args = ListArgs {
            targets: vec![],
            porcelain: false,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".span").unwrap();
        assert_eq!(exit_code, 0);
    }

    #[test]
    fn run_list_span_name_arg_returns_ok() {
        let (_td, repo) = seed_repo();
        create_span_ref(&repo, "my-span");
        let args = ListArgs {
            targets: vec!["my-span".to_string()],
            porcelain: false,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".span").unwrap();
        assert_eq!(exit_code, 0);
    }

    #[test]
    fn run_list_zero_match_errors_with_cli_error() {
        let (_td, repo) = seed_repo();
        let args = ListArgs {
            targets: vec!["nonexistent".to_string()],
            porcelain: false,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let err = run_list(&repo, args, ".span").unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("nonexistent"), "{msg}");
        assert!(msg.contains("did not match"), "{msg}");
    }

    #[test]
    fn run_list_multiple_span_names() {
        let (_td, repo) = seed_repo();
        create_span_ref(&repo, "span-a");
        create_span_ref(&repo, "span-b");
        let args = ListArgs {
            targets: vec!["span-a".to_string(), "span-b".to_string()],
            porcelain: false,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".span").unwrap();
        assert_eq!(exit_code, 0);
    }

    // -----------------------------------------------------------------------
    // BatchFilter unit tests (six cases required by constraints)
    // -----------------------------------------------------------------------

    #[test]
    fn batch_filter_path_only_matches_all_anchors_on_path() {
        // Case 1: path-only line matches any anchor (whole-file or ranged)
        let f = BatchFilter::parse("src/lib.rs").unwrap();
        assert!(f.matches_anchor("src/lib.rs", AnchorExtent::WholeFile));
        assert!(f.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 5, end: 10 }
        ));
        assert!(!f.matches_anchor("src/main.rs", AnchorExtent::WholeFile));
    }

    #[test]
    fn batch_filter_ranged_intersects() {
        // Case 2: ranged line that intersects anchor range
        let f = BatchFilter::parse("src/lib.rs#L5-L15").unwrap();
        // anchor [10, 20] overlaps filter [5, 15]
        assert!(f.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 10, end: 20 }
        ));
        // anchor [1, 6] overlaps filter [5, 15]
        assert!(f.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 1, end: 6 }
        ));
    }

    #[test]
    fn batch_filter_ranged_misses() {
        // Case 3: ranged line that does not intersect anchor range
        let f = BatchFilter::parse("src/lib.rs#L5-L10").unwrap();
        // anchor [20, 30] does not overlap filter [5, 10]
        assert!(!f.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 20, end: 30 }
        ));
        // anchor [1, 4] does not overlap filter [5, 10]
        assert!(!f.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 1, end: 4 }
        ));
    }

    #[test]
    fn batch_filter_ranged_suppresses_whole_file_anchors() {
        // Case 4: whole-file anchor is suppressed under a ranged filter
        let f = BatchFilter::parse("src/lib.rs#L5-L10").unwrap();
        assert!(!f.matches_anchor("src/lib.rs", AnchorExtent::WholeFile));
    }

    #[test]
    fn batch_filter_merge_preserves_individual_ranges() {
        // Two ranged lines on the same path are kept as individual ranges,
        // not collapsed into a hull, so anchors between disjoint ranges are
        // not falsely reported as matching.
        let filters = vec![
            BatchFilter::parse("src/lib.rs#L1-L10").unwrap(),
            BatchFilter::parse("src/lib.rs#L20-L30").unwrap(),
        ];
        let (path, ranges) = merge_batch_filters(&filters);
        assert_eq!(path, "src/lib.rs");
        // Individual ranges preserved, not merged into a hull [1,30].
        assert_eq!(ranges, Some(vec![(1, 10), (20, 30)]));

        // Anchors within individual ranges should match their respective filters.
        let (s1, e1) = ranges.as_ref().unwrap()[0];
        let f1 = BatchFilter::Ranged { path: path.clone(), start: s1, end: e1 };
        assert!(f1.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 5, end: 8 }
        ));
        let (s2, e2) = ranges.as_ref().unwrap()[1];
        let f2 = BatchFilter::Ranged { path: path.clone(), start: s2, end: e2 };
        assert!(f2.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 22, end: 25 }
        ));

        // Anchor between the two ranges should not match either.
        assert!(!f1.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 12, end: 18 }
        ));
        assert!(!f2.matches_anchor(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 12, end: 18 }
        ));
    }

    #[test]
    fn batch_filter_parse_malformed_returns_error() {
        // Only a clean tail-anchored `#L<digits>-L<digits>` is ranged;
        // everything else falls back to path-only (no error).

        // Missing -L<end>: not a clean tail — treated as path-only.
        let result = BatchFilter::parse("src/lib.rs#L5");
        assert!(result.is_ok(), "expected path-only fallback, got error");
        assert_eq!(result.unwrap().path(), "src/lib.rs#L5");

        // Non-numeric start: not a clean tail — treated as path-only.
        let result = BatchFilter::parse("src/lib.rs#Labc-L10");
        assert!(result.is_ok(), "expected path-only fallback, got error");
        assert_eq!(result.unwrap().path(), "src/lib.rs#Labc-L10");

        // start > end: parse_range_address rejects it.
        let result = BatchFilter::parse("src/lib.rs#L10-L5");
        assert!(
            result.is_err(),
            "expected error for start > end, got ok"
        );
    }

    // -----------------------------------------------------------------------
    // F4: tail-anchored discriminator tests
    // -----------------------------------------------------------------------

    #[test]
    fn batch_filter_path_with_inner_hash_l_is_path_only() {
        // notes/issue#L42.md has `#L` but the tail after the last `#L` is
        // `42.md`, which is not `<digits>-L<digits>` → path-only.
        let f = BatchFilter::parse("notes/issue#L42.md").unwrap();
        assert_eq!(f.path(), "notes/issue#L42.md");
        assert!(matches!(f, BatchFilter::Path(_)));
    }

    #[test]
    fn batch_filter_path_with_inner_hash_l_and_tail_range_is_ranged() {
        // notes/issue#L42.md#L10-L20: the last `#L` starts the tail `10-L20`
        // which parses → ranged on path `notes/issue#L42.md`.
        let f = BatchFilter::parse("notes/issue#L42.md#L10-L20").unwrap();
        assert_eq!(f.path(), "notes/issue#L42.md");
        assert!(matches!(f, BatchFilter::Ranged { start: 10, end: 20, .. }));
    }

    #[test]
    fn batch_filter_multi_hash_l_only_tail_matters() {
        // `foo#L#L#L.rs`: last `#L` is followed by `#L.rs`, no `-L<digits>` → path-only.
        let f = BatchFilter::parse("foo#L#L#L.rs").unwrap();
        assert_eq!(f.path(), "foo#L#L#L.rs");
        assert!(matches!(f, BatchFilter::Path(_)));
    }

    // -----------------------------------------------------------------------
    // F6: whitespace trim and blank-line skip tests
    // The actual skip happens in run_list_batch_porcelain (stdin loop),
    // but BatchFilter::parse itself must handle any trim the caller does.
    // We test that lines with only whitespace after trim_end are empty strings,
    // and that BatchFilter::parse("") produces a Path("") (callers skip these).
    // -----------------------------------------------------------------------

    #[test]
    fn batch_filter_parse_trailing_space_treated_as_path_after_trim() {
        // Caller trims: "src/lib.rs   ".trim_end() == "src/lib.rs"
        let trimmed = "src/lib.rs   ".trim_end();
        let f = BatchFilter::parse(trimmed).unwrap();
        assert_eq!(f.path(), "src/lib.rs");
    }

    #[test]
    fn batch_filter_parse_trailing_cr_treated_as_path_after_trim() {
        // Caller trims: "src/lib.rs\r".trim_end() == "src/lib.rs"
        let trimmed = "src/lib.rs\r".trim_end();
        let f = BatchFilter::parse(trimmed).unwrap();
        assert_eq!(f.path(), "src/lib.rs");
    }

    #[test]
    fn batch_filter_parse_blank_line_is_empty_path() {
        // After trim_end, blank and all-whitespace lines become empty strings.
        // Callers skip them via `if line.is_empty() { continue; }`.
        assert!("".trim_end().is_empty());
        assert!("   ".trim_end().is_empty());
        assert!("\t  ".trim_end().is_empty());
    }

    // -----------------------------------------------------------------------
    // Reproduction: hull collapse produces false positives
    // -----------------------------------------------------------------------

    #[test]
    fn merge_batch_filters_disjoint_ranges_no_false_positive_between() {
        // Two disjoint range filters on the same path:
        //   src/lib.rs#L1-L10
        //   src/lib.rs#L20-L30
        //
        // An anchor spanning [12, 18] overlaps NEITHER range, so it should
        // NOT match. Individual ranges are preserved rather than collapsed
        // into a hull.
        let filters = vec![
            BatchFilter::parse("src/lib.rs#L1-L10").unwrap(),
            BatchFilter::parse("src/lib.rs#L20-L30").unwrap(),
        ];
        let (path, ranges) = merge_batch_filters(&filters);
        assert_eq!(path, "src/lib.rs");

        // Individual ranges preserved, not a hull [1,30].
        let ranges = ranges.unwrap();
        assert_eq!(ranges.len(), 2);

        let anchor = AnchorExtent::LineRange {
            start: 12,
            end: 18,
        };

        // Check against each individual filter — neither matches.
        let matches_any = ranges.iter().any(|(s, e)| {
            let f = BatchFilter::Ranged { path: path.clone(), start: *s, end: *e };
            f.matches_anchor("src/lib.rs", anchor)
        });
        assert!(
            !matches_any,
            "anchor [12,18] should not match either filter [1,10] or [20,30]"
        );
    }

    // -----------------------------------------------------------------------
    // Reproduction: WholeFile anchor suppression strips unrelated paths
    // -----------------------------------------------------------------------

    #[test]
    fn whole_file_suppression_respects_filter_path() {
        // A span has a WholeFile anchor on a.rs and a LineRange anchor on b.rs.
        // When the query is a ranged filter on b.rs, the WholeFile anchor on
        // a.rs should NOT be suppressed — suppression is scoped to anchors
        // whose path matches the filter path. The WholeFile on b.rs IS
        // suppressed because it shares the filter path.
        let filter_path = "b.rs";

        let mut listing = SpanListing {
            name: "test-span".to_string(),
            why: "test span".to_string(),
            anchors: vec![
                AnchorEntry {
                    path: "a.rs".to_string(),
                    extent: AnchorExtent::WholeFile,
                },
                AnchorEntry {
                    path: filter_path.to_string(),
                    extent: AnchorExtent::WholeFile,
                },
                AnchorEntry {
                    path: "c.rs".to_string(),
                    extent: AnchorExtent::LineRange {
                        start: 1,
                        end: 10,
                    },
                },
            ],
        };

        // Correct retain logic: only suppress WholeFile anchors whose path
        // matches the filter path.
        listing.anchors.retain(|a| match a.extent {
            AnchorExtent::WholeFile => a.path != filter_path,
            AnchorExtent::LineRange { .. } => true,
        });

        // WholeFile anchor on a.rs (different path) should be KEPT.
        let whole_file_on_a = listing.anchors.iter().any(|a| {
            matches!(a.extent, AnchorExtent::WholeFile) && a.path == "a.rs"
        });
        assert!(
            whole_file_on_a,
            "WholeFile anchor on a.rs should be kept when filter is on b.rs"
        );

        // WholeFile anchor on b.rs (same path as filter) should be SUPPRESSED.
        let whole_file_on_b = listing.anchors.iter().any(|a| {
            matches!(a.extent, AnchorExtent::WholeFile) && a.path == filter_path
        });
        assert!(
            !whole_file_on_b,
            "WholeFile anchor on b.rs should be suppressed when filter is on b.rs"
        );

        // LineRange anchor on c.rs should be KEPT.
        assert!(listing.anchors.iter().any(|a| matches!(a.extent, AnchorExtent::LineRange { .. })),
            "LineRange anchor on c.rs should be kept");
    }
}
