//! Span-edit command handlers — §6.2, §6.3, §6.4, §10.5.
//!
//! Every function produces markdown-formatted prose output per the prose
//! specification in CARD.md. All errors use [`CliError`] with structured
//! remediation context.
//!
//! `run_add`, `run_remove`, and `run_why` edit worktree span files
//! directly; spans are tracked files, so there is no separate staging
//! area or commit step beyond the worktree write.

use crate::cli::error::from_lib_error;
use crate::cli::format::{IDEMPOTENT_TAG, format_anchor_address};
use crate::cli::{AddArgs, CliError, NextStep, RemoveArgs, WhyArgs};
use crate::git::IndexEntrySnapshot;
use crate::span_file::AnchorRecord;
use crate::span_file::SpanFile;
use crate::span_file::parse_address;
use crate::span_file_reader::SpanFileReader;
use crate::types::{AnchorExtent, validate_add_target};
use anyhow::{Context, Result};
use fs4::fs_std::FileExt;
use git_span_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};
use std::fmt::Write as FmtWrite;
use std::fs::File;
use std::io::IsTerminal;
use std::io::Read;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Render an anchor address from a `(path, &AnchorExtent)` pair into the
/// canonical `<path>#L<s>-L<e>` or bare `<path>` form.
fn addr_from_extent(path: &str, extent: &AnchorExtent) -> String {
    match extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(path, Some(*start), Some(*end))
        }
        AnchorExtent::WholeFile => format_anchor_address(path, None, None),
    }
}

/// Build a [`CliError`] for invalid anchor syntax.
fn invalid_anchor_error(subcommand: &'static str, addr: &str) -> CliError {
    CliError {
        subcommand,
        summary: format!("`{addr}` is not a valid anchor."),
        what_happened: format!(
            "Anchor addresses are either a path on its own (whole file) or \
             `<path>#L<start>-L<end>` (line range). `{addr}` is missing the `L` \
             prefix and the `-L<end>` half."
        ),
        next_steps: vec![
            NextStep::Bash(format!(
                "git span {subcommand} <name> <path>#L<start>-L<end>"
            )),
            NextStep::Bash(format!("git span {subcommand} <name> <path>")),
        ],
    }
}

// The span root is resolved once in `cli::dispatch` (the single
// precedence chain) and threaded into every handler. The `add`,
// `remove`, and `why` writers receive the already-resolved root.

/// Count lines in a byte slice.
fn count_lines(bytes: &[u8]) -> u32 {
    std::str::from_utf8(bytes)
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0)
}

/// Compute an rk64 content fingerprint for the file at `path` with the
/// given `extent`.
///
/// When `anchor_oid` is `Some(commit_oid)`, the content is read from that
/// commit's tree. When `None`, the content is read from the worktree.
///
/// For line-range extents, validates that the range is within the file's
/// line count.
///
/// Returns `(algorithm, hex_hash)` where algorithm is `"rk64"`.
pub(crate) fn hash_anchor_content(
    repo: &gix::Repository,
    path: &str,
    extent: &AnchorExtent,
    anchor_oid: Option<&str>,
    index_snapshot: &[IndexEntrySnapshot],
) -> Result<(String, String)> {
    // Worktree reads must use the *same* canonicalization the resolver
    // compares against, or a freshly-added anchor reads `Changed`/`Moved`
    // with zero source edits in any repo with EOL normalization
    // (`* text=auto`, `core.autocrlf`), a clean/smudge filter, or a
    // custom filter driver. The resolver derives every layer's comparison
    // hash from the git-normalized blob bytes (HEAD/index) or
    // `read_worktree_normalized` (worktree); there is exactly one
    // canonicalization, shared by add-time hashing and resolve-time
    // comparison, for both line and whole-file extents. Blob reads
    // (`--at`) are already the post-clean blob bytes on both sides.
    // A submodule gitlink is a directory on disk — there is no file
    // content to read. Its content identity is the recorded commit OID
    // in the index. Whole-file pins on the gitlink root are allowed
    // (D2); hash the gitlink OID hex so drift = the submodule pointer
    // changing. This matches the resolver's gitlink canonicalization.
    let gitlink_oid = || -> Option<Vec<u8>> {
        index_snapshot
            .iter()
            .find(|en| en.path == path && en.mode.is_commit())
            .map(|en| en.oid.to_string().into_bytes())
    };

    let bytes = match anchor_oid {
        Some(commit_oid) => {
            let blob_oid = crate::git::path_blob_at(repo, commit_oid, path).map_err(|e| {
                anyhow::anyhow!("could not read `{path}` at commit `{commit_oid}`: {e}")
            })?;
            crate::git::read_blob_bytes(repo, &blob_oid)?
        }
        None => {
            if let Some(oid) = gitlink_oid() {
                oid
            } else {
                let mut custom_filters = crate::resolver::layers::CustomFilters::new();
                match crate::resolver::layers::read_worktree_normalized(
                    repo,
                    &mut custom_filters,
                    path,
                ) {
                    Ok(b) => b,
                    // A required custom filter driver that fails has no
                    // canonical content. The resolver short-circuits such
                    // a path to `ContentUnavailable(FilterFailed)` and
                    // never compares the stored hash, so record the raw
                    // worktree bytes (pre-normalization) — add must still
                    // succeed and register the anchor.
                    Err(crate::Error::FilterFailed { .. }) => {
                        crate::git::read_worktree_bytes(repo, path)?
                    }
                    Err(e) => return Err(e.into()),
                }
            }
        }
    };

    // Validate line range extent against the actual content.
    if let AnchorExtent::LineRange { start, end } = extent {
        let line_count = count_lines(&bytes);
        if *start < 1 || *end < *start {
            anyhow::bail!("invalid anchor: start={start} end={end}");
        }
        if *end > line_count {
            anyhow::bail!("invalid anchor: end={end} exceeds file line count ({line_count})");
        }
        // Also verify that the content is valid UTF-8 (no binary content
        // for line anchors).
        if std::str::from_utf8(&bytes).is_err() {
            anyhow::bail!("line-anchor pin rejected on binary path: {path}");
        }
    }

    let fp = cheap_fingerprint_with_extent(&bytes, extent);
    Ok((RK64_ALGORITHM.to_string(), rk64_to_hex(fp)))
}

/// RAII guard that releases an advisory file lock and removes the lock
/// file on drop.
struct SpanLock {
    _file: File,
    path: std::path::PathBuf,
}

impl Drop for SpanLock {
    fn drop(&mut self) {
        // Best-effort cleanup — a stale lock file is harmless (another
        // process can still acquire the lock on a new inode), but leaving
        // it behind confuses empty-directory pruning.
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Acquire an exclusive advisory file lock (`flock`) for a span file,
/// protecting the read-modify-write critical section against concurrent
/// writers. The lock is released and the lock-file path is cleaned up
/// when the returned [`SpanLock`] is dropped.
///
/// The lock file lives alongside the span file in `<span_root>/`, named
/// `.<basename>.lock`. The dot prefix keeps it invisible to all three
/// [`SpanFileReader`] enumeration paths — the same convention
/// [`write_worktree_span`] uses for its temp file.
///
/// Blocks until the lock is acquired. A crashed or killed process
/// releases its locks automatically, so this never blocks forever.
fn lock_span_file(repo: &gix::Repository, span_root: &str, name: &str) -> Result<SpanLock> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;
    let lock_dir = workdir.join(span_root);

    // Derive the lock-file path from the span path. For "foo/bar", the
    // span file is `<span_root>/foo/bar` and the lock file is
    // `<span_root>/foo/.bar.lock`.
    let span_path = lock_dir.join(name);
    let lock_name = format!(
        ".{}.lock",
        span_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("span")
    );
    let lock_path = span_path.parent().map(|p| p.join(&lock_name)).unwrap_or_else(|| {
        lock_dir.join(&lock_name)
    });

    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = File::create(&lock_path)
        .with_context(|| format!("failed to create lock file `{}`", lock_path.display()))?;
    file.lock_exclusive()
        .with_context(|| format!("failed to acquire exclusive lock on `{}`", lock_path.display()))?;
    Ok(SpanLock {
        _file: file,
        path: lock_path,
    })
}

/// Build the absolute worktree path for a span file: `<workdir>/<span_root>/<name>`.
pub(crate) fn span_file_path(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
) -> Result<std::path::PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;
    Ok(workdir.join(span_root).join(name))
}

/// Read a span file from the worktree. Returns an empty `SpanFile` when the
/// file does not exist.
pub(crate) fn read_worktree_span(repo: &gix::Repository, span_root: &str, name: &str) -> Result<SpanFile> {
    let path = span_file_path(repo, span_root, name)?;
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        Ok(SpanFile::parse(&content)?)
    } else {
        Ok(SpanFile {
            anchors: Vec::new(),
            why: String::new(),
        })
    }
}

/// Write a span file to the worktree atomically, creating parent directories
/// as needed.
///
/// Writes to a dot-prefixed temp file in the same directory, then
/// [`std::fs::rename`]s it to the target path.  Rename is atomic on the
/// same filesystem, so a crash or interruption never leaves a truncated
/// span file on disk — either the old content or the new content is
/// always visible.
///
/// The dot prefix (`.span.tmp`) is already hidden from all three
/// enumeration paths by [`crate::span_file_reader::is_span_name_segment`].
pub(crate) fn write_worktree_span(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    span: &mut SpanFile,
) -> Result<()> {
    // Sort anchors in canonical (path, start_line, end_line) order so that
    // the on-disk representation is independent of insertion order. Two
    // branches that add anchors to the same span in different orders produce
    // identical serialized output, eliminating ordering-only diffs and
    // conflicts.
    span.anchors.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    let path = span_file_path(repo, span_root, name)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;
    crate::span::structural::ensure_span_dir(workdir, span_root)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_name = format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("span")
    );
    let tmp_path = path.parent().map(|p| p.join(&tmp_name)).unwrap_or_else(|| {
        std::path::PathBuf::from(&tmp_name)
    });
    std::fs::write(&tmp_path, span.serialize())?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// Check for prefix collision between a new span name and existing worktree
/// span files.  The filesystem enforces that two paths cannot coexist when
/// one is a strict prefix of the other (e.g. `a/b` and `a/b/c`).
///
/// Returns `Ok(())` when no collision exists, or an error describing the
/// collision with both span names.
fn check_worktree_prefix_collision(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
) -> std::result::Result<(), crate::Error> {
    let reader = crate::span_file_reader::SpanFileReader::new(repo, span_root.to_string());
    let known_names = reader.list_span_names()?;
    for other in &known_names {
        if other == name {
            continue;
        }
        // `list_span_names` returns the raw HEAD∪index∪worktree union; a
        // name deleted in the index/worktree but still in HEAD is a
        // tombstone and no longer occupies its path.  Filter it through
        // the effective view (mirrors `load_all_spans_in`).
        match reader.read_effective(other) {
            Ok(Some(_)) => {}
            Err(crate::Error::SpanConflict(_)) => {}
            Ok(None) => continue,
            Err(e) => return Err(e),
        }
        // `other` is a strict ancestor of `name`.
        if let Some(rest) = name.strip_prefix(other.as_str())
            && rest.starts_with('/')
        {
            return Err(crate::Error::SpanNameCollidesWithExistingSpan {
                staged: name.to_string(),
                blocking: other.clone(),
            });
        }
        // `other` is a strict descendant of `name`.
        if let Some(rest) = other.strip_prefix(name)
            && rest.starts_with('/')
        {
            return Err(crate::Error::SpanNameCollidesWithExistingSpan {
                staged: name.to_string(),
                blocking: other.clone(),
            });
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

pub fn run_add(repo: &gix::Repository, args: AddArgs, span_root: &str) -> Result<i32> {
    crate::validation::validate_span_name(&args.name)?;

    // Parse every address first; fail-closed with no partial state.
    let mut parsed: Vec<(String, AnchorExtent)> = Vec::with_capacity(args.anchors.len());
    {
        let _perf = crate::perf::span("add.parse-anchors");
        for addr in &args.anchors {
            let p = parse_address(addr).ok_or_else(|| invalid_anchor_error("add", addr))?;
            parsed.push(p);
        }
    }

    // Resolve `--at <commit-ish>` to a full OID up front, before the
    // path-existence probe that depends on it.  An unparseable or
    // ancestor-overflow `--at` surfaces a curated revision error here
    // rather than a misleading "does not exist" error from the probe below.
    let anchor_oid: Option<String> = match args.at.as_deref() {
        Some(s) => {
            let _perf = crate::perf::span("add.resolve-at");
            Some(crate::git::resolve_commit(repo, s).map_err(|e| CliError {
                subcommand: "add",
                summary: format!("`--at {s}` could not be resolved."),
                what_happened: e.to_string(),
                next_steps: vec![NextStep::Bash("git rev-parse HEAD".into())],
            })?)
        }
        None => None,
    };

    // Materialize the index snapshot once — every anchor-processing site
    // below (existence probe, validate_add_target, hash_anchor_content)
    // shares this single snapshot instead of re-reading the index per
    // anchor.
    let index_snapshot = crate::git::index_entries(repo).map_err(|e| {
        CliError {
            subcommand: "add",
            summary: "failed to read the git index.".into(),
            what_happened: e.to_string(),
            next_steps: vec![NextStep::Bash("git status".into())],
        }
    })?;

    // Anchor source-path safety (fail-closed, per `<fail-closed>` and the
    // File Format / Storage Layout path rules). Every anchor address path
    // must be a safe repo-relative path — the same rule enforced for the
    // span root, via the shared validator (no parallel implementation) —
    // and must point at content that exists (tracked, in the worktree, or
    // a submodule gitlink). Reject absolute / `..` / inside-`.git` /
    // nonexistent paths before any span-file I/O.
    {
        let _perf = crate::perf::span("add.validate-anchor-paths");
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?
            .to_path_buf();
        for (path, _extent) in &parsed {
            crate::span_root::validate_repo_relative_path("anchor path", path).map_err(|e| {
                CliError {
                    subcommand: "add",
                    summary: format!("`{path}` is not a valid anchor path."),
                    what_happened: e.to_string(),
                    next_steps: vec![NextStep::Prose(
                        "Anchor paths must be repo-relative, must not contain \
                         `..`, and must not be inside `.git`."
                            .into(),
                    )],
                }
            })?;

            crate::span_root::reject_anchor_inside_span_root(span_root, path).map_err(|e| {
                CliError {
                    subcommand: "add",
                    summary: format!("`{path}` is not a valid anchor path."),
                    what_happened: e.to_string(),
                    next_steps: vec![NextStep::Prose(format!(
                        "Anchor paths must not be inside the span root `{span_root}`. \
                         Choose a source file outside the span directory."
                    ))],
                }
            })?;

            // Existence: tracked in the index (includes submodule
            // gitlinks, mode 160000 — a valid whole-file anchor per the
            // plan's D2), present in the worktree, or readable at the
            // resolved `--at` commit. A path with no content to hash
            // cannot be anchored.
            let exists = if let Some(oid) = anchor_oid.as_deref() {
                crate::git::path_blob_at(repo, oid, path).is_ok()
            } else {
                let tracked = index_snapshot.iter().any(|en| en.path == *path);
                tracked || workdir.join(path).exists()
            };
            if !exists {
                return Err(CliError {
                    subcommand: "add",
                    summary: format!("`{path}` does not exist."),
                    what_happened: format!(
                        "`{path}` is neither tracked nor present in the \
                         worktree, so there is no content to anchor."
                    ),
                    next_steps: vec![
                        NextStep::Bash(format!("ls {path}")),
                        NextStep::Prose("Create the file or correct the anchor path.".into()),
                    ],
                }
                .into());
            }
        }
    }

    // Slice 3: last-write-wins. Within a single invocation, coalesce
    // duplicate `(path, extent)` adds silently — keep the last
    // occurrence, drop earlier ones.
    {
        let mut last_idx: std::collections::HashMap<(String, AnchorExtent), usize> =
            std::collections::HashMap::new();
        for (i, a) in parsed.iter().enumerate() {
            last_idx.insert(a.clone(), i);
        }
        let coalesced: Vec<(String, AnchorExtent)> = parsed
            .iter()
            .enumerate()
            .filter(|(i, a)| last_idx.get(*a) == Some(i))
            .map(|(_, a)| a.clone())
            .collect();
        parsed = coalesced;
    }

    // Stage-time precheck.
    {
        let _perf = crate::perf::span("add.validate-targets");
        for (path, extent) in &parsed {
            validate_add_target(repo, std::path::Path::new(path), extent, &index_snapshot).map_err(|err| {
                let next_steps = match &err {
                    crate::types::AddPrecheckError::GitignoredPath { .. } => vec![
                        NextStep::Prose(
                            "git-span tracks content through git and cannot resolve a path \
                             git never sees. Un-ignore the path (edit `.gitignore`) or anchor \
                             a committed file instead."
                                .into(),
                        ),
                        NextStep::Bash(format!("git check-ignore -v {path}")),
                    ],
                    _ => vec![NextStep::Prose(
                        "Fix the path or choose a different extent.".into(),
                    )],
                };
                from_lib_error(
                    "add",
                    format!("anchor precheck failed for `{path}`."),
                    err,
                    next_steps,
                )
            })?;
        }
    }

    // Check for prefix collision against existing worktree span files
    // before any file I/O.  The filesystem would reject the read/write
    // with a cryptic OS error, so we surface a structured span error.
    check_worktree_prefix_collision(repo, span_root, &args.name).map_err(|e| CliError {
        subcommand: "add",
        summary: format!("cannot add span `{}`", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Prose(
            "Rename the span to avoid the prefix collision.".into(),
        )],
    })?;

    // Acquire an exclusive advisory lock on the span file before reading
    // to prevent concurrent read-modify-write races (lost-update).
    let _add_lock = {
        let _perf = crate::perf::span("add.lock-span");
        lock_span_file(repo, span_root, &args.name)?
    };

    // Read the current worktree span file.
    let mut span_file = {
        let _perf = crate::perf::span("add.read-current");
        read_worktree_span(repo, span_root, &args.name)?
    };

    // Build a lookup of existing anchors: (path, start_line, end_line) -> content_hash.
    let existing: std::collections::HashMap<(String, u32, u32), String> = span_file
        .anchors
        .iter()
        .map(|a| {
            (
                (a.path.clone(), a.start_line, a.end_line),
                a.content_hash.clone(),
            )
        })
        .collect();

    // Track per-anchor outcomes for the summary.
    struct AddOutcome {
        addr: String,
        kind: AddOutcomeKind,
    }
    enum AddOutcomeKind {
        Added,     // new anchor — record created
        Resolved,  // existing anchor — hash changed, updated
        Unchanged, // anchor already matches stored hash
    }

    let mut outcomes: Vec<AddOutcome> = Vec::with_capacity(parsed.len());

    {
        let _perf = crate::perf::span("add.process-anchors");
        for (path, extent) in &parsed {
            let (algorithm, content_hash) =
                hash_anchor_content(repo, path, extent, anchor_oid.as_deref(), &index_snapshot)?;
            let addr = addr_from_extent(path, extent);

            let (start_line, end_line) = match extent {
                AnchorExtent::LineRange { start, end } => (*start, *end),
                AnchorExtent::WholeFile => (0, 0),
            };

            let key = (path.clone(), start_line, end_line);

            let kind = if let Some(existing_hash) = existing.get(&key) {
                if existing_hash == &content_hash {
                    // Content matches what is already stored.
                    AddOutcomeKind::Unchanged
                } else {
                    // Update the existing record's hash in place.
                    if let Some(record) = span_file.anchors.iter_mut().find(|a| {
                        a.path == *path && a.start_line == start_line && a.end_line == end_line
                    }) {
                        record.algorithm = algorithm;
                        record.content_hash = content_hash;
                    }
                    AddOutcomeKind::Resolved
                }
            } else {
                // Brand new anchor.
                span_file.anchors.push(AnchorRecord {
                    path: path.clone(),
                    start_line,
                    end_line,
                    algorithm,
                    content_hash,
                });
                AddOutcomeKind::Added
            };

            outcomes.push(AddOutcome { addr, kind });
        }
    }

    // Write the updated span file.
    {
        let _perf = crate::perf::span("add.write-span-file");
        write_worktree_span(repo, span_root, &args.name, &mut span_file)?;
    }

    // --- Output -----------------------------------------------------------
    let added_count = outcomes
        .iter()
        .filter(|o| matches!(o.kind, AddOutcomeKind::Added))
        .count();
    let resolved_count = outcomes
        .iter()
        .filter(|o| matches!(o.kind, AddOutcomeKind::Resolved))
        .count();
    let unchanged_count = outcomes
        .iter()
        .filter(|o| matches!(o.kind, AddOutcomeKind::Unchanged))
        .count();
    // Summary line.
    let mut summary = format!(
        "Added {} anchor{}",
        added_count,
        if added_count == 1 { "" } else { "s" },
    );
    if resolved_count > 0 {
        write!(&mut summary, " and resolved {resolved_count} in place").unwrap();
    }
    if unchanged_count > 0 {
        write!(&mut summary, "; {unchanged_count} unchanged").unwrap();
    }
    write!(&mut summary, " to span `{}`.", args.name).unwrap();
    println!("{summary}");
    println!();

    for o in &outcomes {
        let line = match o.kind {
            AddOutcomeKind::Added => {
                format!("- added: `{}` `{}`", args.name, o.addr)
            }
            AddOutcomeKind::Resolved => {
                format!(
                    "- resolved in-place: `{}` `{}` (hash changed)",
                    args.name, o.addr
                )
            }
            AddOutcomeKind::Unchanged => {
                format!(
                    "- unchanged: `{}` `{}` (content matches stored hash)",
                    args.name, o.addr
                )
            }
        };
        println!("{line}");
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

pub fn run_remove(repo: &gix::Repository, args: RemoveArgs, span_root: &str) -> Result<i32> {
    crate::validation::validate_span_name(&args.name)?;

    // Parse every address first; fail-closed with no partial state.
    let mut parsed: Vec<(String, AnchorExtent)> = Vec::with_capacity(args.anchors.len());
    {
        let _perf = crate::perf::span("remove.parse-anchors");
        for addr in &args.anchors {
            let p = parse_address(addr).ok_or_else(|| invalid_anchor_error("remove", addr))?;
            parsed.push(p);
        }
    }

    // Acquire an exclusive advisory lock on the span file before reading
    // to prevent concurrent read-modify-write races.
    let _remove_lock = {
        let _perf = crate::perf::span("remove.lock-span");
        lock_span_file(repo, span_root, &args.name)?
    };

    // Read the current worktree span file.
    let mut span_file = {
        let _perf = crate::perf::span("remove.read-current");
        read_worktree_span(repo, span_root, &args.name)?
    };

    let mut removed_addrs: Vec<String> = Vec::new();
    {
        let _perf = crate::perf::span("remove.remove-anchors");
        for (path, extent) in &parsed {
            let (start_line, end_line) = match extent {
                AnchorExtent::LineRange { start, end } => (*start, *end),
                AnchorExtent::WholeFile => (0, 0),
            };

            let before = span_file.anchors.len();
            span_file.anchors.retain(|a| {
                !(a.path == *path && a.start_line == start_line && a.end_line == end_line)
            });

            if span_file.anchors.len() == before {
                let addr = addr_from_extent(path, extent);
                return Err(CliError {
                    subcommand: "remove",
                    summary: format!("`{addr}` is not an anchor on `{}`.", args.name),
                    what_happened: format!(
                        "`{}` does not currently track that anchor, so there is nothing to remove.",
                        args.name,
                    ),
                    next_steps: vec![NextStep::Bash(format!("git span {}", args.name))],
                }
                .into());
            }

            removed_addrs.push(addr_from_extent(path, extent));
        }
    }

    // Write the updated span file.
    {
        let _perf = crate::perf::span("remove.write-span-file");
        write_worktree_span(repo, span_root, &args.name, &mut span_file)?;
    }

    // --- Output -----------------------------------------------------------
    let n = removed_addrs.len();
    println!(
        "Removed {n} anchor{} from span `{}`.",
        if n == 1 { "" } else { "s" },
        args.name
    );
    println!();
    for addr in &removed_addrs {
        println!("- removed: `{}` `{}`", args.name, addr);
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// why
// ---------------------------------------------------------------------------

pub fn run_why(repo: &gix::Repository, args: WhyArgs, span_root: &str) -> Result<i32> {
    // Positional text → write mode. Piped stdin → write mode.
    // Terminal stdin with no positional → read mode (print current why).
    if let Some(m) = args.why_text {
        crate::validation::validate_span_name(&args.name)?;
        let _perf = crate::perf::span("why.write");
        run_why_writer(repo, &args.name, &m, span_root)?;
        return print_why_written(&args.name);
    }
    if !std::io::stdin().is_terminal() {
        crate::validation::validate_span_name(&args.name)?;
        let _perf = crate::perf::span("why.write");
        let mut body = String::new();
        std::io::stdin().read_to_string(&mut body)?;
        run_why_writer(repo, &args.name, &body, span_root)?;
        return print_why_written(&args.name);
    }
    let _perf = crate::perf::span("why.read");
    run_why_reader(repo, &args.name, span_root)
}

fn print_why_written(name: &str) -> Result<i32> {
    println!("Set why on span `{name}`.{IDEMPOTENT_TAG}");
    Ok(0)
}

fn run_why_writer(repo: &gix::Repository, name: &str, body: &str, span_root: &str) -> Result<()> {
    // Acquire an exclusive advisory lock on the span file before reading
    // to prevent concurrent read-modify-write races.
    let _why_lock = lock_span_file(repo, span_root, name)?;

    let mut span_file = read_worktree_span(repo, span_root, name)?;
    span_file.why = body.to_string();
    write_worktree_span(repo, span_root, name, &mut span_file)?;
    Ok(())
}

fn run_why_reader(
    repo: &gix::Repository,
    name: &str,
    span_root: &str,
) -> Result<i32> {
    crate::validation::validate_span_name(name)?;

    // Current effective view: worktree overlays index overlays HEAD.
    let reader = SpanFileReader::new(repo, span_root.to_string());
    let span = reader.read_effective(name)?;

    match span {
        Some(mf) if !mf.why.is_empty() => {
            let body = mf.why.trim_end_matches('\n');
            println!("{body}");
        }
        _ => {
            println!("`{name}` has no why recorded.");
        }
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::span_file::AnchorRecord;

    /// Build a minimal gix repo in a tempdir for unit tests.
    fn temp_repo() -> (tempfile::TempDir, gix::Repository) {
        let dir = tempfile::tempdir().unwrap();
        gix::init(dir.path()).unwrap();
        let opts = gix::open::Options::default();
        let repo = gix::open_opts(dir.path(), opts).unwrap();
        (dir, repo)
    }

    #[test]
    #[cfg(unix)]
    fn write_worktree_span_is_atomic() {
        use std::os::unix::fs::MetadataExt;

        let (_dir, repo) = temp_repo();

        let mut span = SpanFile {
            anchors: vec![AnchorRecord {
                path: "src/lib.rs".into(),
                start_line: 1,
                end_line: 10,
                algorithm: "rk64".into(),
                content_hash: "aaaa".into(),
            }],
            why: "first write".into(),
        };

        // First write: creates the file.
        write_worktree_span(&repo, ".span", "test/atomic", &mut span).unwrap();
        let path = span_file_path(&repo, ".span", "test/atomic").unwrap();
        assert!(path.exists(), "span file should exist after first write");

        let ino_before = std::fs::metadata(&path).unwrap().ino();

        // Second write: updates the same span with different content.
        let mut span2 = SpanFile {
            anchors: vec![AnchorRecord {
                path: "src/main.rs".into(),
                start_line: 5,
                end_line: 15,
                algorithm: "rk64".into(),
                content_hash: "bbbb".into(),
            }],
            why: "second write".into(),
        };
        write_worktree_span(&repo, ".span", "test/atomic", &mut span2).unwrap();

        let ino_after = std::fs::metadata(&path).unwrap().ino();

        // Atomic writes (temp + rename) replace the directory entry, giving
        // the file a new inode.  Non-atomic writes (std::fs::write) truncate
        // and overwrite in place, keeping the same inode.
        assert_ne!(
            ino_before, ino_after,
            "write_worktree_span must use atomic rename (inode changed), \
             but inode stayed the same — direct write detected"
        );
    }

    #[test]
    fn write_worktree_span_leaves_no_temp_file_after_rename() {
        let (_dir, repo) = temp_repo();

        let mut span = SpanFile {
            anchors: vec![
                AnchorRecord {
                    path: "src/a.rs".into(),
                    start_line: 1,
                    end_line: 5,
                    algorithm: "rk64".into(),
                    content_hash: "1111".into(),
                },
                AnchorRecord {
                    path: "src/b.rs".into(),
                    start_line: 10,
                    end_line: 20,
                    algorithm: "rk64".into(),
                    content_hash: "2222".into(),
                },
            ],
            why: "atomic write verification".into(),
        };

        write_worktree_span(&repo, ".span", "test/atomic", &mut span).unwrap();
        let path = span_file_path(&repo, ".span", "test/atomic").unwrap();

        // The span file must exist and be complete.
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("src/a.rs"));
        assert!(content.contains("src/b.rs"));
        assert!(content.contains("atomic write verification"));

        // No temp file should remain — rename consumed it.
        let parent = path.parent().unwrap();
        let mut tmp_exists = false;
        for entry in std::fs::read_dir(parent).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name.ends_with(".tmp") {
                tmp_exists = true;
            }
        }
        assert!(
            !tmp_exists,
            "temp file remained after write_worktree_span — rename must consume it"
        );

        // Read back through read_worktree_span to confirm round-trip.
        let read_back = read_worktree_span(&repo, ".span", "test/atomic").unwrap();
        assert_eq!(read_back.anchors.len(), 2);
        assert_eq!(read_back.why, "atomic write verification");
    }

    #[test]
    fn write_worktree_span_sorts_anchors_in_canonical_order() {
        let (_dir, repo) = temp_repo();

        // Anchors inserted in reverse (path) order.
        let mut span = SpanFile {
            anchors: vec![
                AnchorRecord {
                    path: "z.rs".into(),
                    start_line: 1,
                    end_line: 5,
                    algorithm: "rk64".into(),
                    content_hash: "1111".into(),
                },
                AnchorRecord {
                    path: "a.rs".into(),
                    start_line: 10,
                    end_line: 20,
                    algorithm: "rk64".into(),
                    content_hash: "2222".into(),
                },
            ],
            why: String::new(),
        };

        write_worktree_span(&repo, ".span", "test/sorted", &mut span).unwrap();
        let path = span_file_path(&repo, ".span", "test/sorted").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();

        // "a.rs" line must appear before "z.rs" line.
        let a_pos = content.find("a.rs").unwrap();
        let z_pos = content.find("z.rs").unwrap();
        assert!(
            a_pos < z_pos,
            "anchors must be sorted by path: a.rs should precede z.rs"
        );

        // Second write: anchors with same path sorted by (start_line, end_line).
        let mut span2 = SpanFile {
            anchors: vec![
                AnchorRecord {
                    path: "lib.rs".into(),
                    start_line: 20,
                    end_line: 30,
                    algorithm: "rk64".into(),
                    content_hash: "3333".into(),
                },
                AnchorRecord {
                    path: "lib.rs".into(),
                    start_line: 1,
                    end_line: 10,
                    algorithm: "rk64".into(),
                    content_hash: "4444".into(),
                },
                // Whole-file anchor (0,0) for same path.
                AnchorRecord {
                    path: "lib.rs".into(),
                    start_line: 0,
                    end_line: 0,
                    algorithm: "rk64".into(),
                    content_hash: "5555".into(),
                },
            ],
            why: String::new(),
        };

        write_worktree_span(&repo, ".span", "test/sorted", &mut span2).unwrap();
        let content2 = std::fs::read_to_string(&path).unwrap();

        // Parsed ordering must match (path, start_line, end_line).
        let reparsed = SpanFile::parse(&content2).unwrap();
        assert_eq!(reparsed.anchors.len(), 3);
        // Whole-file (0,0) first, then (1,10), then (20,30).
        assert_eq!(reparsed.anchors[0].start_line, 0);
        assert_eq!(reparsed.anchors[0].end_line, 0);
        assert_eq!(reparsed.anchors[1].start_line, 1);
        assert_eq!(reparsed.anchors[1].end_line, 10);
        assert_eq!(reparsed.anchors[2].start_line, 20);
        assert_eq!(reparsed.anchors[2].end_line, 30);
    }
}
