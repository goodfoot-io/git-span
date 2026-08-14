//! Span-edit command handlers — §6.2, §6.3, §6.4, §10.5.
//!
//! Every function produces markdown-formatted prose output per the prose
//! specification in CARD.md. All errors use [`CliError`] with structured
//! remediation context.
//!
//! `run_add`, `run_remove`, `run_replace`, and `run_why` edit worktree span
//! files directly; spans are tracked files, so there is no separate staging
//! area or commit step beyond the worktree write.

use crate::cli::drift_label::format_drift_label;
use crate::cli::drift_output::status_json;
use crate::cli::error::from_lib_error;
use crate::cli::format::{IDEMPOTENT_TAG, format_anchor_address, quote_shell};
use crate::cli::{AddArgs, AddFormat, CliError, NextStep, RemoveArgs, ReplaceArgs, ReplaceFormat, WhyArgs, WhyFormat};
use crate::git::IndexEntrySnapshot;
use crate::resolver::{anchor_status_is_drift, resolve_named_spans_retaining_source_layers};
use crate::span_file::AnchorRecord;
use crate::span_file::SpanFile;
use crate::span_file::parse_address;
use crate::span_file_reader::SpanFileReader;
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, EngineOptions, LayerSet,
    validate_add_target,
};
use anyhow::{Context, Result};
use fs4::fs_std::FileExt;
use git_span_core::{
    RK64_ALGORITHM, ResolveCommand, ResolvedRecord, carried_sentinel, cheap_fingerprint_with_extent,
    rk64_to_hex,
};
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

    // Whether `bytes` came from a git-normalized worktree read (clean
    // filter applied). Only such reads can disagree with the file the
    // user sees in the worktree: `--at` reads the committed blob
    // directly, a submodule gitlink has no worktree file, and the
    // `FilterFailed` fallback below already uses the raw bytes.
    let mut normalized_worktree_read = false;

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
                    Ok(b) => {
                        normalized_worktree_read = true;
                        b
                    }
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
        // A worktree read applies git's clean filter (LFS, custom
        // smudge/clean drivers, EOL normalization), which can rewrite
        // the content the user sees on disk. When the filtered bytes
        // have a different line count than the raw worktree file, the
        // anchor's line numbers address one text in the user's editor
        // and a different text in the hashed content — the recorded
        // hash would silently cover bytes the user never wrote. Fail
        // closed instead. The raw read is best-effort: a
        // tracked-but-deleted file falls through to the count check
        // below (which rejects on the empty content), and the
        // `--at`/gitlink/`FilterFailed` paths never reach here.
        if normalized_worktree_read
            && let Ok(raw) = crate::git::read_worktree_bytes(repo, path)
        {
            let raw_line_count = count_lines(&raw);
            if raw_line_count != line_count {
                anyhow::bail!(
                    "invalid anchor: git's clean filter rewrites `{path}` \
                     ({raw_line_count} lines on disk) into different content \
                     ({line_count} lines), so `{path}#L{start}-L{end}` would \
                     not address the file you are looking at. Use `--at \
                     <commit>` to pin the anchor to a specific commit's \
                     (filtered) content instead."
                );
            }
        }
        if *end > line_count {
            // A path that is intact in HEAD but not materialized in this
            // checkout — sparse-excluded, an unfetched promisor or LFS blob —
            // reads as zero bytes here. "exceeds file line count (0)" is then
            // a false statement about the repository: the file has content,
            // this working copy just does not have it, and the operator is
            // sent looking for a truncation that never happened. Name the
            // real condition and the step that clears it.
            if line_count == 0
                && anchor_oid.is_none()
                && !repo
                    .workdir()
                    .map(|w| w.join(path).is_file())
                    .unwrap_or(false)
                && head_has_path(repo, path)
            {
                anyhow::bail!(
                    "`{path}` is not materialized in this checkout: it exists in HEAD but \
                     has no worktree file (excluded by sparse-checkout, or an unfetched \
                     promisor/LFS blob), so `{path}#L{start}-L{end}` cannot be verified \
                     here. Materialize it — e.g. `git sparse-checkout add {path}` or \
                     `git lfs pull` — and re-run."
                );
            }
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

/// Whether HEAD's tree carries a blob at `path`. Used to separate "this file
/// is empty or truncated" from "this file has content the working copy has
/// not materialized", which read identically from the worktree.
///
/// Best-effort: an unborn HEAD or an unreadable tree answers `false`, which
/// falls back to the plain line-count message rather than asserting
/// something about the repository that was not established.
fn head_has_path(repo: &gix::Repository, path: &str) -> bool {
    let Ok(head) = repo.rev_parse_single("HEAD") else {
        return false;
    };
    crate::git::path_blob_at(repo, &head.detach().to_string(), path).is_ok()
}

/// RAII guard that releases an advisory file lock and removes the lock
/// file on drop.
pub(crate) struct SpanLock {
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
/// Acquisition is attempted without blocking first. When another process
/// holds the lock, this names the span it is waiting on and then waits a
/// bounded [`lock_wait`] before giving up with an error. An unbounded,
/// silent block was the wrong shape here: `git span drift --fix` sweeps
/// every span in one invocation and prints as it goes, so contention on
/// span three of ten stalled the process mid-report with no output at all,
/// and a CI harness could only kill it — leaving `.span/` half-reconciled
/// with no diagnostic naming which span was stuck. A caller that would
/// rather wait longer can re-run; a caller that cannot wait now gets told
/// what to do about it.
pub(crate) fn lock_span_file(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
) -> Result<SpanLock> {
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
    let lock_path = span_path
        .parent()
        .map(|p| p.join(&lock_name))
        .unwrap_or_else(|| lock_dir.join(&lock_name));

    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = File::create(&lock_path)
        .with_context(|| format!("failed to create lock file `{}`", lock_path.display()))?;

    // Fast path: uncontended, which is every ordinary invocation.
    match file.try_lock_exclusive() {
        Ok(true) => {
            return Ok(SpanLock {
                _file: file,
                path: lock_path,
            });
        }
        Ok(false) => {}
        Err(e) => {
            return Err(anyhow::Error::from(e).context(format!(
                "failed to acquire exclusive lock on `{}`",
                lock_path.display()
            )));
        }
    }

    // Contended. Say so before waiting — a silent wait is indistinguishable
    // from a hang, and the operator cannot tell which span is blocked.
    let budget = lock_wait();
    eprintln!(
        "waiting for another `git span` process to release span `{name}` \
         (up to {}s)",
        budget.as_secs()
    );

    let deadline = std::time::Instant::now() + budget;
    loop {
        match file.try_lock_exclusive() {
            Ok(true) => {
                return Ok(SpanLock {
                    _file: file,
                    path: lock_path,
                });
            }
            Ok(false) => {}
            Err(e) => {
                return Err(anyhow::Error::from(e).context(format!(
                    "failed to acquire exclusive lock on `{}`",
                    lock_path.display()
                )));
            }
        }
        if std::time::Instant::now() >= deadline {
            anyhow::bail!(
                "timed out after {}s waiting for the lock on span `{name}` \
                 (`{}`). Another `git span` process is still holding it — \
                 wait for it to finish and re-run. If no such process exists, \
                 the lock file is stale and can be deleted.",
                budget.as_secs(),
                lock_path.display(),
            );
        }
        std::thread::sleep(LOCK_POLL);
    }
}

/// How long [`lock_span_file`] waits for a contended span lock before
/// failing with a diagnostic. Long enough to ride out a concurrent `add` or
/// `--fix` on a large corpus, short enough that a CI job fails with a
/// message rather than being killed on a job timeout.
const LOCK_WAIT_DEFAULT_SECS: u64 = 30;

/// Poll interval while waiting. `flock` has no timed variant, so the wait is
/// a try-loop; the interval is short enough to be imperceptible and long
/// enough not to spin.
const LOCK_POLL: std::time::Duration = std::time::Duration::from_millis(25);

/// The contended-lock wait budget, overridable by `GIT_SPAN_LOCK_WAIT_SECS`.
///
/// A harness that would rather fail fast than hold a job open — and the
/// tests that exercise the timeout path — set it low; an operator on a slow
/// filesystem sets it high. An unparseable or absent value takes the
/// default rather than failing, since a bad knob must not break a command
/// that would otherwise have acquired the lock immediately.
fn lock_wait() -> std::time::Duration {
    let secs = std::env::var("GIT_SPAN_LOCK_WAIT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(LOCK_WAIT_DEFAULT_SECS);
    std::time::Duration::from_secs(secs)
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
pub(crate) fn read_worktree_span(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
) -> Result<SpanFile> {
    let path = span_file_path(repo, span_root, name)?;
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        Ok(SpanFile::parse(&content)?)
    } else {
        Ok(SpanFile {
            anchors: Vec::new(),
            why: String::new(),
            resolved: Vec::new(),
            config: crate::span_file::SpanConfig::default(),
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
        path.file_name().and_then(|n| n.to_str()).unwrap_or("span")
    );
    let tmp_path = path
        .parent()
        .map(|p| p.join(&tmp_name))
        .unwrap_or_else(|| std::path::PathBuf::from(&tmp_name));
    std::fs::write(&tmp_path, span.serialize())?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// Remove every anchor record at `(path, start, end)`, returning the records
/// that were removed, in file order.
///
/// Makes no hash decision of its own — callers push whatever they want the
/// identity to hold afterwards, or nothing. It lives here rather than in
/// `git-span-core` for exactly that reason: it carries no hash policy, and
/// both callers (`add`'s retain-and-replace, `replace`'s retirement of the
/// old identity) are CLI-local.
///
/// It returns the records rather than a count because what was destroyed is
/// reportable: `replace` has to tell the operator how many records vanished
/// at the old identity, and whether any of them carried the collapse
/// sentinel — neither question can be answered from a bare number.
fn remove_all_at_identity(
    anchors: &mut Vec<AnchorRecord>,
    path: &str,
    start: u32,
    end: u32,
) -> Vec<AnchorRecord> {
    let mut removed = Vec::new();
    anchors.retain(|a| {
        if a.path == path && a.start_line == start && a.end_line == end {
            removed.push(a.clone());
            false
        } else {
            true
        }
    });
    removed
}

/// Record a collapse resolution in the span file's `[resolved]` section:
/// one record per identity, the latest resolution replacing any earlier one
/// at the same `(path, start_line, end_line)`.
///
fn upsert_resolved_record(records: &mut Vec<ResolvedRecord>, record: ResolvedRecord) {
    if let Some(existing) = records.iter_mut().find(|existing| {
        existing.path == record.path
            && existing.start_line == record.start_line
            && existing.end_line == record.end_line
    }) {
        *existing = record;
    } else {
        records.push(record);
    }
}

fn resolution_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
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
            // Either kind means the name is occupied, which is the only
            // question this loop asks — so discarding the discriminator here
            // stays correct after it was given one.
            Err(crate::Error::SpanConflict { .. }) => {}
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

/// Which side of a supersession conflict is the whole-file anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WholeFileSide {
    /// The requested anchor is whole-file; the conflicting one is a range.
    Requested,
    /// The conflicting anchor is whole-file; the requested one is a range.
    Existing,
}

/// Where the conflicting anchor comes from: an anchor already tracked on the
/// span, or a second anchor requested in the same invocation.
///
/// The two kinds need different remediation — an existing record can be
/// removed with `git span remove`, while a co-requested anchor was never
/// added (the invocation fails all-or-nothing) and can only be dropped from
/// the command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConflictSource {
    /// The conflict is against an anchor already tracked on the span.
    ExistingRecord,
    /// The conflict is between two anchors requested in the same invocation.
    CoRequested,
}

/// A provable supersession between a requested anchor and an existing (or
/// co-requested) anchor on the same path: exactly one side is whole-file
/// and the pair is not an exact identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SupersessionConflict {
    /// Canonical address of the requested anchor
    /// (`<path>` or `<path>#L<s>-L<e>`).
    pub requested_addr: String,
    /// Canonical address of the anchor it conflicts with — either an
    /// existing record on the span or a co-requested anchor.
    pub conflicting_addr: String,
    /// Which side of the pair is the whole-file anchor.
    pub whole_file_side: WholeFileSide,
    /// Whether the conflicting anchor is tracked on the span or was
    /// requested in the same invocation.
    pub source: ConflictSource,
}

/// Return the first provable supersession conflict between the requested
/// anchors and a span's existing anchors.
///
/// Provable supersession is: same path, exactly one side whole-file, and not
/// an exact identity. Range-vs-range pairs (disjoint, partially overlapping,
/// or nested) are never provable — a bounded range may address distinct
/// concerns, and the command does not guess. The requested list is checked
/// against the existing records *and* against the other requested anchors
/// (post-coalesce), so a single invocation cannot create the same trap it
/// rejects.
///
/// Iteration is requested-outer, existing-inner, then co-requested, so the
/// reported conflict is the deterministic first match in that order. The
/// canonical addresses render via [`format_anchor_address`];
/// [`WholeFileSide`] says which side of the pair is whole-file.
pub(crate) fn supersession_conflict(
    requested: &[(String, AnchorExtent)],
    existing: &[AnchorRecord],
) -> Option<SupersessionConflict> {
    /// Whole-file records use the `(0, 0)` sentinel (`start_line == 0 &&
    /// end_line == 0`).
    fn record_is_whole_file(r: &AnchorRecord) -> bool {
        r.start_line == 0 && r.end_line == 0
    }
    /// A line range degenerate to `(0, 0)` would key identically to a
    /// whole-file anchor — an exact identity, never a conflict.
    fn extent_is_sentinel(e: &AnchorExtent) -> bool {
        matches!(e, AnchorExtent::LineRange { start: 0, end: 0 })
    }

    // Requested-outer: each requested anchor against every existing record,
    // then against every co-requested anchor. The first match in this order
    // is reported.
    for (i, (path, extent)) in requested.iter().enumerate() {
        let requested_whole = matches!(extent, AnchorExtent::WholeFile);

        // Against the span's existing records.
        for r in existing {
            if r.path != *path {
                continue;
            }
            let existing_whole = record_is_whole_file(r);
            if requested_whole == existing_whole {
                // Exact identity (or a pure range pair) — never provable.
                continue;
            }
            if !requested_whole && extent_is_sentinel(extent) {
                // The range keys identically to the whole-file record.
                continue;
            }
            let (whole_file_side, conflicting_addr) = if requested_whole {
                (
                    WholeFileSide::Requested,
                    format_anchor_address(&r.path, Some(r.start_line), Some(r.end_line)),
                )
            } else {
                (
                    WholeFileSide::Existing,
                    format_anchor_address(&r.path, None, None),
                )
            };
            return Some(SupersessionConflict {
                requested_addr: addr_from_extent(path, extent),
                conflicting_addr,
                whole_file_side,
                source: ConflictSource::ExistingRecord,
            });
        }

        // Against the other co-requested anchors (post-coalesce).
        for (j, (other_path, other_extent)) in requested.iter().enumerate() {
            if j == i || *other_path != *path {
                continue;
            }
            let other_whole = matches!(other_extent, AnchorExtent::WholeFile);
            if requested_whole == other_whole {
                continue;
            }
            if !requested_whole && extent_is_sentinel(extent) {
                continue;
            }
            let whole_file_side = if requested_whole {
                WholeFileSide::Requested
            } else {
                WholeFileSide::Existing
            };
            return Some(SupersessionConflict {
                requested_addr: addr_from_extent(path, extent),
                conflicting_addr: addr_from_extent(other_path, other_extent),
                whole_file_side,
                source: ConflictSource::CoRequested,
            });
        }
    }
    None
}

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
    let index_snapshot = crate::git::index_entries(repo).map_err(|e| CliError {
        subcommand: "add",
        summary: "failed to read the git index.".into(),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git status".into())],
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
            validate_add_target(repo, std::path::Path::new(path), extent, &index_snapshot)
                .map_err(|err| {
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
    // Snapshot the pre-write anchor set: the supersession fact is computed
    // from the requested addresses against what was on the span before this
    // invocation's write.
    let pre_write_anchors = span_file.anchors.clone();

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

    // Supersession preflight: reject any requested anchor that provably
    // supersedes an existing (or co-requested) anchor on the same path —
    // whole-file vs range in either direction, barring exact identity —
    // before any mutation or content hashing. Placement before the process
    // loop checks every requested anchor against the original existing set,
    // which makes multi-anchor invocations all-or-nothing by construction.
    {
        let _perf = crate::perf::span("add.preflight-supersession");
        if let Some(conflict) = supersession_conflict(&parsed, &span_file.anchors) {
            return Err(match conflict.source {
                // The conflicting anchor is tracked on the span: removing it
                // is actionable, so print the exact quoted remove command.
                ConflictSource::ExistingRecord => {
                    let (summary, direction) = match conflict.whole_file_side {
                        WholeFileSide::Requested => (
                            format!(
                                "the requested whole-file anchor `{}` supersedes the existing \
                                 anchor `{}` on span `{}`.",
                                conflict.requested_addr, conflict.conflicting_addr, args.name
                            ),
                            "the requested anchor is the whole file, and the existing one is a range",
                        ),
                        WholeFileSide::Existing => (
                            format!(
                                "`{}` is superseded by the existing whole-file anchor `{}` on \
                                 span `{}`.",
                                conflict.requested_addr, conflict.conflicting_addr, args.name
                            ),
                            "the existing anchor is the whole file, and the requested one is a range",
                        ),
                    };
                    CliError {
                        subcommand: "add",
                        summary,
                        what_happened: format!(
                            "`{}` and `{}` anchor the same path, and {}; adding both would leave \
                             the superseded anchor reported as permanent drift, so the add is \
                             rejected before anything is written.",
                            conflict.requested_addr, conflict.conflicting_addr, direction
                        ),
                        next_steps: vec![
                            NextStep::Prose(
                                "Remove the conflicting anchor, then retry the add.".into(),
                            ),
                            NextStep::Bash(format!(
                                "git span remove {} {}",
                                args.name,
                                quote_shell(&conflict.conflicting_addr)
                            )),
                        ],
                    }
                }
                // The two anchors were requested together, so nothing was
                // written — there is no record to remove. Say the requested
                // anchors conflict and tell the user to fix the invocation.
                ConflictSource::CoRequested => {
                    let (summary, direction) = match conflict.whole_file_side {
                        WholeFileSide::Requested => (
                            format!(
                                "the requested whole-file anchor `{}` supersedes the requested \
                                 range `{}`; the two anchors in this invocation conflict with \
                                 each other.",
                                conflict.requested_addr, conflict.conflicting_addr
                            ),
                            "the requested anchor is the whole file, and the other requested \
                             one is a range",
                        ),
                        WholeFileSide::Existing => (
                            format!(
                                "`{}` is superseded by the requested whole-file anchor `{}`; \
                                 the two anchors in this invocation conflict with each other.",
                                conflict.requested_addr, conflict.conflicting_addr
                            ),
                            "the other requested anchor is the whole file, and the requested \
                             one is a range",
                        ),
                    };
                    CliError {
                        subcommand: "add",
                        summary,
                        what_happened: format!(
                            "`{}` and `{}` anchor the same path, and {}; adding both would leave \
                             the superseded anchor reported as permanent drift, so the add is \
                             rejected before anything is written.",
                            conflict.requested_addr, conflict.conflicting_addr, direction
                        ),
                        next_steps: vec![NextStep::Prose(format!(
                            "Drop one of the two anchors (`{}` or `{}`) from the invocation, \
                             then retry the add.",
                            conflict.requested_addr, conflict.conflicting_addr
                        ))],
                    }
                }
            }
            .into());
        }
    }

    // Track per-anchor outcomes for the summary.
    struct AddOutcome {
        addr: String,
        kind: AddOutcomeKind,
        /// Records retired at this identity that carried the
        /// duplicate-collapse sentinel. See the acknowledgement below.
        retired_sentinels: usize,
    }
    enum AddOutcomeKind {
        Added,     // new anchor — record created
        Resolved,  // existing anchor — hash changed, updated
        Unchanged, // anchor already matches stored hash
        /// The identity carried more than one record; every one of them was
        /// replaced by the single freshly-hashed record. `records_before` is
        /// the pre-collapse count (the count after is always 1).
        Collapsed { records_before: usize },
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

            // Retain-and-replace, not patch-the-first-match: every record at
            // this identity is removed and one record carrying the hash just
            // computed from the content the operator named takes their place.
            //
            // The record count comes from a direct scan of `span_file.anchors`
            // — never from `existing`, whose one slot per identity is filled
            // last-write-wins and can therefore describe a different record
            // than the one the mutation actually touches.
            let matching_before = span_file
                .anchors
                .iter()
                .filter(|a| {
                    a.path == *path && a.start_line == start_line && a.end_line == end_line
                })
                .count();
            // `add` does not run the shared collapse primitive, and does not
            // need to: that primitive answers "which of these records
            // survives", a question `add` never has to ask. Every record at
            // the identity is removed and one record carrying the hash just
            // computed from the named content takes their place, so no
            // surviving record's fields are inherited from any of them. The
            // scope is deliberately one identity — `add` acts on the
            // addresses it was given and never sweeps the rest of the file;
            // that sweep is `drift --fix`'s job.
            // The retired records are read, not discarded. `add` at a
            // sentinel-bearing address *is* the operator asserting the
            // coupled content is still here — the exact verification the
            // sentinel was planted to wait for, and as legitimate a
            // resolution as `replace` naming a new address. It is also, until
            // now, the silent one: `replace` narrated what it destroyed while
            // `add`, the first-named and likelier branch of the same
            // annotation, printed `(hash changed)` over a value that was
            // never a hash of anything and exited 0. An operator who answered
            // "yes, still here" got silence; one who answered "it moved" got
            // a paragraph.
            let retired = remove_all_at_identity(&mut span_file.anchors, path, start_line, end_line);
            let retired_sentinels = retired.iter().filter(|r| carried_sentinel(r)).count();

            // The durable half of the acknowledgement: a sentinel retired
            // here is a human, not a hash, deciding the coupling is correct,
            // and the decision is recorded in the span file's `[resolved]`
            // section so it outlives this invocation. The record is a
            // parallel mutation on `span_file.resolved` at the same point as
            // the anchor push below — before `write_worktree_span`, so the
            // record is part of the persisted file.
            if retired_sentinels > 0 {
                upsert_resolved_record(
                    &mut span_file.resolved,
                    ResolvedRecord {
                        timestamp: resolution_timestamp(),
                        command: ResolveCommand::Add,
                        path: path.clone(),
                        start_line,
                        end_line,
                        algorithm: algorithm.clone(),
                        content_hash: content_hash.clone(),
                    },
                );
            }

            span_file.anchors.push(AnchorRecord {
                path: path.clone(),
                start_line,
                end_line,
                algorithm,
                content_hash: content_hash.clone(),
            });

            let kind = match matching_before {
                0 => AddOutcomeKind::Added,
                // The `existing` map is trustworthy as a hash-match oracle
                // only when the identity is known to hold exactly one record.
                1 if existing.get(&key) == Some(&content_hash) => AddOutcomeKind::Unchanged,
                1 => AddOutcomeKind::Resolved,
                n => AddOutcomeKind::Collapsed { records_before: n },
            };

            outcomes.push(AddOutcome {
                addr,
                kind,
                retired_sentinels,
            });
        }
    }

    // Write the updated span file.
    {
        let _perf = crate::perf::span("add.write-span-file");
        write_worktree_span(repo, span_root, &args.name, &mut span_file)?;
    }

    // --- Post-write reconcile check ---------------------------------------
    // Runs while still holding the exclusive span-file lock (`_add_lock`
    // lives until the end of `run_add`), so the check sees the just-written
    // declaration and is serialized against concurrent mutations of the same
    // span (plan §Mechanism).
    let check = {
        let _perf = crate::perf::span("add.reconcile-check");
        let start = std::time::Instant::now();
        let check = run_reconcile_check(repo, span_root, &args.name, &parsed, &pre_write_anchors)?;
        crate::perf::counter("add.reconcile-us", start.elapsed().as_micros() as u64);
        check
    };

    // --- Output -----------------------------------------------------------
    let exit = reconcile_exit_code(&check);
    match args.format {
        AddFormat::Human => {
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
            let collapsed_count = outcomes
                .iter()
                .filter(|o| matches!(o.kind, AddOutcomeKind::Collapsed { .. }))
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
            if collapsed_count > 0 {
                write!(&mut summary, "; {collapsed_count} collapsed").unwrap();
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
                        // "hash changed" is the wrong noun for a sentinel:
                        // the prior value was not a hash of anything, it was
                        // the marker meaning nothing had been hashed.
                        let detail = if o.retired_sentinels > 0 {
                            "unverified collapse resolved"
                        } else {
                            "hash changed"
                        };
                        format!(
                            "- resolved in-place: `{}` `{}` ({detail})",
                            args.name, o.addr
                        )
                    }
                    AddOutcomeKind::Unchanged => {
                        format!(
                            "- unchanged: `{}` `{}` (content matches stored hash)",
                            args.name, o.addr
                        )
                    }
                    AddOutcomeKind::Collapsed { records_before } => {
                        format!(
                            "- collapsed: `{}` `{}` ({records_before} records → 1, hash reverified)",
                            args.name, o.addr
                        )
                    }
                };
                println!("{line}");
            }

            // The symmetric acknowledgement to `replace`'s, in the same
            // vocabulary, because the two are the two endpoints of one
            // annotation and should read as one story rather than as two
            // commands with unrelated manners.
            let retired_sentinels: usize = outcomes.iter().map(|o| o.retired_sentinels).sum();
            if retired_sentinels > 0 {
                println!();
                println!(
                    "Resolved an unverified collapse: {} retired record{} carried the \
                     collapsed-duplicate marker, so nothing had confirmed what that identity \
                     tracked. Naming this address is that confirmation — the installed record \
                     is hashed from the content that is there now, and the marker is gone. If \
                     those lines are not the coupled content, `git span replace {} <old> \
                     <new-address>` is the command that moves it.",
                    retired_sentinels,
                    if retired_sentinels == 1 { "" } else { "s" },
                    args.name,
                );
                println!(
                    "The resolution is recorded in the span file's `[resolved]` section."
                );
            }

            // The post-write facts: superseded, remains, and the single
            // span-wide line. Local success (above) never names span-wide
            // state.
            render_reconcile_block(&args.name, &check, true);
        }
        AddFormat::Json => {
            let doc = MutationDocument::new(
                "add",
                &args.name,
                outcomes
                    .iter()
                    .map(|o| AnchorOutcome {
                        address: o.addr.clone(),
                        outcome: match o.kind {
                            AddOutcomeKind::Added => AddressOutcome::Added,
                            AddOutcomeKind::Resolved => AddressOutcome::Resolved,
                            AddOutcomeKind::Unchanged => AddressOutcome::Unchanged,
                            AddOutcomeKind::Collapsed { .. } => AddressOutcome::Collapsed,
                        },
                        records_before: match o.kind {
                            AddOutcomeKind::Collapsed { records_before } => Some(records_before),
                            _ => None,
                        },
                        retired_collapsed_duplicates: (o.retired_sentinels > 0)
                            .then_some(o.retired_sentinels),
                    })
                    .collect(),
                check.superseded.clone(),
                check.remaining.clone(),
                span_health_from_check(&check),
            );
            println!("{}", serde_json::to_string_pretty(&doc)?);
        }
    }
    Ok(exit)
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
// replace
// ---------------------------------------------------------------------------

pub fn run_replace(repo: &gix::Repository, args: ReplaceArgs, span_root: &str) -> Result<i32> {
    crate::validation::validate_span_name(&args.name)?;

    // Parse both addresses first; fail-closed with no partial state.
    let (old_path, old_extent) = {
        let _perf = crate::perf::span("replace.parse-anchors");
        parse_address(&args.old_anchor)
            .ok_or_else(|| invalid_anchor_error("replace", &args.old_anchor))?
    };
    let (new_path, new_extent) =
        parse_address(&args.new_anchor).ok_or_else(|| invalid_anchor_error("replace", &args.new_anchor))?;

    let (old_start, old_end) = match &old_extent {
        AnchorExtent::LineRange { start, end } => (*start, *end),
        AnchorExtent::WholeFile => (0, 0),
    };
    let (new_start, new_end) = match &new_extent {
        AnchorExtent::LineRange { start, end } => (*start, *end),
        AnchorExtent::WholeFile => (0, 0),
    };

    // Exact-identity contract: an anchor replaced with its own address is
    // `git span add`'s job (the in-place `Resolved` hash refresh), not
    // `replace`'s. Refusing keeps `replace` crisp — it changes identity,
    // and never silently degrades into additive behavior.
    if old_path == new_path && old_start == new_start && old_end == new_end {
        return Err(CliError {
            subcommand: "replace",
            summary: format!(
                "`{}` is already the identity of the anchor being replaced.",
                args.old_anchor
            ),
            what_happened: "The old and new address are the same. `git span add` refreshes \
                an anchor's content hash in place; `replace` exists to change identity."
                .to_string(),
            next_steps: vec![NextStep::Bash(format!(
                "git span add {} {}",
                args.name, args.new_anchor
            ))],
        }
        .into());
    }

    // New-target validation reuses the full `add` pipeline so a poisoned
    // declaration is never written: anchor-path safety, span-root
    // exclusion, the index-snapshot existence probe, the stage-time
    // precheck (gitignored / rewritten targets), and the git-normalized
    // content hash. All of this runs *before* the lock is taken and any
    // read happens, mirroring `run_add`'s fail-closed ordering.
    let index_snapshot = crate::git::index_entries(repo).map_err(|e| CliError {
        subcommand: "replace",
        summary: "failed to read the git index.".into(),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git status".into())],
    })?;
    {
        let _perf = crate::perf::span("replace.validate-targets");
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?
            .to_path_buf();
        crate::span_root::validate_repo_relative_path("anchor path", &new_path).map_err(|e| {
            CliError {
                subcommand: "replace",
                summary: format!("`{new_path}` is not a valid anchor path."),
                what_happened: e.to_string(),
                next_steps: vec![NextStep::Prose(
                    "Anchor paths must be repo-relative, must not contain \
                     `..`, and must not be inside `.git`."
                        .into(),
                )],
            }
        })?;

        crate::span_root::reject_anchor_inside_span_root(span_root, &new_path).map_err(|e| {
            CliError {
                subcommand: "replace",
                summary: format!("`{new_path}` is not a valid anchor path."),
                what_happened: e.to_string(),
                next_steps: vec![NextStep::Prose(format!(
                    "Anchor paths must not be inside the span root `{span_root}`. \
                     Choose a source file outside the span directory."
                ))],
            }
        })?;

        // Existence: tracked in the index or present in the worktree. A
        // path with no content to hash cannot be anchored.
        let exists = {
            let tracked = index_snapshot.iter().any(|en| en.path == new_path);
            tracked || workdir.join(&new_path).exists()
        };
        if !exists {
            return Err(CliError {
                subcommand: "replace",
                summary: format!("`{new_path}` does not exist."),
                what_happened: format!(
                    "`{new_path}` is neither tracked nor present in the \
                     worktree, so there is no content to anchor."
                ),
                next_steps: vec![
                    NextStep::Bash(format!("ls {new_path}")),
                    NextStep::Prose("Create the file or correct the anchor path.".into()),
                ],
            }
            .into());
        }

        validate_add_target(repo, std::path::Path::new(&new_path), &new_extent, &index_snapshot)
            .map_err(|err| {
                let next_steps = match &err {
                    crate::types::AddPrecheckError::GitignoredPath { .. } => vec![
                        NextStep::Prose(
                            "git-span tracks content through git and cannot resolve a path \
                             git never sees. Un-ignore the path (edit `.gitignore`) or anchor \
                             a committed file instead."
                                .into(),
                        ),
                        NextStep::Bash(format!("git check-ignore -v {new_path}")),
                    ],
                    _ => vec![NextStep::Prose(
                        "Fix the path or choose a different extent.".into(),
                    )],
                };
                from_lib_error(
                    "replace",
                    format!("anchor precheck failed for `{new_path}`."),
                    err,
                    next_steps,
                )
            })?;
    }

    // Acquire an exclusive advisory lock on the span file before reading
    // to prevent concurrent read-modify-write races (lost-update).
    let _replace_lock = {
        let _perf = crate::perf::span("replace.lock-span");
        lock_span_file(repo, span_root, &args.name)?
    };

    // Read the current worktree span file.
    let mut span_file = {
        let _perf = crate::perf::span("replace.read-current");
        read_worktree_span(repo, span_root, &args.name)?
    };

    // Retire every record at the old identity, however many there are. A
    // hand-edited or legacy declaration can hold several records sharing
    // the identity with different hashes, but none of them is being read
    // for content: the operator named the old identity as the thing to swap
    // out, so there is no survivor to name and no hash to adjudicate — the
    // identity disappears wholesale. Zero records is the one remaining
    // error: a plain missing anchor.
    let retired = remove_all_at_identity(&mut span_file.anchors, &old_path, old_start, old_end);
    let retired_records = retired.len();
    // How many of the retired records were survivors of a collapse that
    // nothing had verified. `replace` resolves that state rather than
    // carrying it forward, and the resolution is legitimate: the sentinel
    // means "no hash here is trustworthy because two records disagreed",
    // and an operator naming a new address is precisely the act of deciding
    // where the coupled content actually lives. Carrying the sentinel onto
    // the new record would make it unfalsifiable — `replace` is the exit the
    // collapse annotation itself recommends, so a `replace` that preserved
    // the marker would leave the operator in a loop with no way out.
    // Demanding an explicit acknowledgement flag fails the same test from
    // the other side: the tool would refuse the command it just told the
    // operator to run, over a state they cannot see until they are refused.
    // So it resolves — and says so, which is the part that was missing.
    let retired_sentinels = retired.iter().filter(|r| carried_sentinel(r)).count();
    if retired_records == 0 {
        return Err(CliError {
            subcommand: "replace",
            summary: format!("`{}` is not an anchor on `{}`.", args.old_anchor, args.name),
            what_happened: format!(
                "`{}` does not currently track that anchor, so there is nothing to replace.",
                args.name,
            ),
            next_steps: vec![NextStep::Bash(format!("git span show {}", args.name))],
        }
        .into());
    }

    // A swap onto an identity the span already tracks would leave two
    // same-identity records behind — *creating* a duplicate identity rather
    // than resolving one that pre-exists, which is a different concern from
    // the old identity retired above. Retiring the old anchor on its own is
    // the one-command path.
    if span_file.anchors.iter().any(|a| {
        a.path == new_path && a.start_line == new_start && a.end_line == new_end
    }) {
        return Err(CliError {
            subcommand: "replace",
            summary: format!("`{}` is already an anchor on `{}`.", args.new_anchor, args.name),
            what_happened: "The new identity is already tracked, so a swap would leave two \
                records with the same identity (the writer sorts but does not dedupe)."
                .to_string(),
            next_steps: vec![NextStep::Bash(format!(
                "git span remove {} {}",
                args.name, args.old_anchor
            ))],
        }
        .into());
    }

    // Hash the new content and install the one new record — the only
    // addition in the transaction. `why` and every unrelated anchor are
    // preserved.
    let (algorithm, content_hash) = {
        let _perf = crate::perf::span("replace.process");
        hash_anchor_content(repo, &new_path, &new_extent, None, &index_snapshot)?
    };
    // The durable half of the acknowledgement: a sentinel retired here is a
    // human, not a hash, deciding where the coupled content lives, and the
    // decision is recorded in the span file's `[resolved]` section so it
    // outlives this invocation — at the new identity, with the `replace`
    // command naming the move.
    if retired_sentinels > 0 {
        upsert_resolved_record(
            &mut span_file.resolved,
            ResolvedRecord {
                timestamp: resolution_timestamp(),
                command: ResolveCommand::Replace,
                path: new_path.clone(),
                start_line: new_start,
                end_line: new_end,
                algorithm: algorithm.clone(),
                content_hash: content_hash.clone(),
            },
        );
    }
    {
        span_file.anchors.push(AnchorRecord {
            path: new_path.clone(),
            start_line: new_start,
            end_line: new_end,
            algorithm,
            content_hash,
        });
    }

    // Write the updated span file.
    {
        let _perf = crate::perf::span("replace.write-span-file");
        write_worktree_span(repo, span_root, &args.name, &mut span_file)?;
    }
    // Release the lock before the read-only drift resolve.
    drop(_replace_lock);

    // --- Output -----------------------------------------------------------
    // Resolve only the replaced span (uncached engine path, so there is
    // no store staleness after the write) and report its drift-free
    // state: exactly the `drift` discovery boundary, so `replace` and
    // `drift` can never disagree about the span they both just saw.
    // Repository-read failures get the same curated shape `drift` uses.
    let curate = |e: crate::Error| -> anyhow::Error {
        match e {
            crate::Error::Git(e) => crate::cli::resolver_read_error("replace", e).into(),
            _ => e.into(),
        }
    };
    let resolved = {
        let _perf = crate::perf::span("replace.drift-report");
        let options = crate::types::EngineOptions::full();
        let names = [args.name.clone()];
        crate::resolver::resolve_named_spans(repo, span_root, &names, options).map_err(curate)?
    };
    let span = match resolved.into_iter().next() {
        Some((_, Ok(span))) => span,
        Some((_, Err(e))) => return Err(curate(e)),
        None => unreachable!("resolve_named_spans returns one result per requested name"),
    };
    let drift_free = !crate::resolver::span_is_reportable_in_drift_discovery(&span);
    let drifted_addrs: Vec<String> = span
        .anchors
        .iter()
        .filter(|a| crate::resolver::anchor_status_is_drift(&a.status))
        .map(|a| {
            let path_str = a.anchored.path.to_string_lossy();
            addr_from_extent(&path_str, &a.anchored.extent)
        })
        .collect();

    match args.format {
        ReplaceFormat::Human => {
            println!(
                "Replaced anchor on span `{}`: retired {} record{} at `{}`, installed `{}`.",
                args.name,
                retired_records,
                if retired_records == 1 { "" } else { "s" },
                args.old_anchor,
                args.new_anchor
            );
            if retired_sentinels > 0 {
                println!(
                    "Resolved an unverified collapse: {} retired record{} carried the \
                     collapsed-duplicate marker, so nothing had confirmed what that identity \
                     tracked. Naming `{}` is that confirmation — the installed record is hashed \
                     from the content there, and the marker is gone.",
                    retired_sentinels,
                    if retired_sentinels == 1 { "" } else { "s" },
                    args.new_anchor
                );
                println!(
                    "The resolution is recorded in the span file's `[resolved]` section."
                );
            }
            if drift_free {
                println!("Span is drift-free.");
            } else {
                println!("Span is not drift-free.");
                for addr in &drifted_addrs {
                    println!("- drifted: `{addr}`");
                }
            }
        }
        ReplaceFormat::Json => {
            let obj = serde_json::json!({
                "span": args.name,
                "retired": args.old_anchor,
                "retired_records": retired_records,
                "retired_collapsed_duplicates": retired_sentinels,
                "installed": args.new_anchor,
                "drift_free": drift_free,
                "drifted": drifted_addrs,
            });
            println!("{}", serde_json::to_string_pretty(&obj)?);
        }
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// why
// ---------------------------------------------------------------------------

pub fn run_why(repo: &gix::Repository, args: WhyArgs, span_root: &str) -> Result<i32> {
    let WhyArgs {
        name,
        why_text,
        format,
    } = args;

    // Positional text → write mode. Piped stdin → write mode (only when
    // data is actually present — an empty stdin falls through to read).
    // Terminal stdin with no positional → read mode (print current why).
    let write_body: Option<String> = if let Some(m) = why_text {
        Some(m)
    } else if !std::io::stdin().is_terminal() {
        let mut body = String::new();
        std::io::stdin().read_to_string(&mut body)?;
        if body.is_empty() {
            None
        } else {
            Some(body)
        }
    } else {
        None
    };

    let Some(body) = write_body else {
        // Read mode. `--format json` is rejected fail-closed with a
        // usage-style `CliError` before any output (exit 1, no stdout),
        // mirroring drift's `--fix`-with-machine-format rejection — an
        // ignored flag that silently prints prose would teach a migrating
        // hook to parse prose as a document.
        if matches!(format, WhyFormat::Json) {
            return Err(CliError {
                subcommand: "why",
                summary: "`--format json` is only supported in write mode.".into(),
                what_happened: "Read mode prints the current why as prose; a hook \
                                migrating to `--format json` would parse prose as a \
                                document."
                    .into(),
                next_steps: vec![NextStep::Bash(format!(
                    "git span why {name} <why text> --format json"
                ))],
            }
            .into());
        }
        let _perf = crate::perf::span("why.read");
        return run_why_reader(repo, &name, span_root);
    };

    crate::validation::validate_span_name(&name)?;
    let _perf = crate::perf::span("why.write");
    run_why_write_mode(repo, &name, &body, span_root, format)
}

/// Write mode: write the why while holding the exclusive span-file lock,
/// then run the post-write reconcile check under the same lock (plan
/// §Mechanism) and render the remains/span-wide block. The supersession
/// fact is empty by construction — `why` touches no addresses — so no
/// superseded lines and an empty `superseded` array in JSON.
fn run_why_write_mode(
    repo: &gix::Repository,
    name: &str,
    body: &str,
    span_root: &str,
    format: WhyFormat,
) -> Result<i32> {
    // The lock is held through the check below: it serializes the write and
    // the check against concurrent mutations of the same span, and the check
    // sees the just-written declaration.
    let _why_lock = {
        let _perf = crate::perf::span("why.lock-span");
        lock_span_file(repo, span_root, name)?
    };
    let pre_write_anchors = {
        let _perf = crate::perf::span("why.read-current");
        let mut span_file = read_worktree_span(repo, span_root, name)?;
        let anchors = span_file.anchors.clone();
        span_file.why = body.to_string();
        {
            let _perf = crate::perf::span("why.write-span-file");
            write_worktree_span(repo, span_root, name, &mut span_file)?;
        }
        anchors
    };
    let check = {
        let _perf = crate::perf::span("why.reconcile-check");
        let start = std::time::Instant::now();
        let check = run_reconcile_check(repo, span_root, name, &[], &pre_write_anchors)?;
        crate::perf::counter("why.reconcile-us", start.elapsed().as_micros() as u64);
        check
    };
    let exit = reconcile_exit_code(&check);
    match format {
        WhyFormat::Human => {
            println!("Set why on span `{name}`.{IDEMPOTENT_TAG}");
            render_reconcile_block(name, &check, false);
        }
        WhyFormat::Json => {
            let doc = MutationDocument::new(
                "why",
                name,
                Vec::new(),
                Vec::new(),
                check.remaining.clone(),
                span_health_from_check(&check),
            )
            .with_why_written();
            println!("{}", serde_json::to_string_pretty(&doc)?);
        }
    }
    Ok(exit)
}

fn run_why_reader(repo: &gix::Repository, name: &str, span_root: &str) -> Result<i32> {
    crate::validation::validate_span_name(name)?;

    // Current effective view: worktree overlays index overlays HEAD.
    let reader = SpanFileReader::new(repo, span_root.to_string());
    // A conflicted span reaches here as the bare `Error::SpanConflict`, whose
    // Display is a diagnosis with no next step. The variant text stays as it
    // is — `commit.rs` swallows the variant deliberately and other readers
    // match on it — so the remediation is attached here, where `why` is the
    // surface an operator lands on mid-merge.
    let span = reader.read_effective(name).map_err(|e| -> anyhow::Error {
        if let crate::Error::SpanConflict { kind, .. } = e {
            CliError {
                subcommand: "why",
                summary: format!("span `{name}` is in a Git conflict state."),
                what_happened: crate::cli::resolve::conflict_diagnosis(name, kind),
                // `why` was the worst of the five circling surfaces and this
                // is why: it passed `conflict_remediation` straight through
                // with nothing in front of it, so its *first* fenced command
                // was `git span resolve --dry-run` — a command that writes
                // nothing — and it showed no `git status` at all. An operator
                // mid-merge, which its own comment above says is exactly who
                // lands here, got a dead end as the opening move. `show`
                // already put a `git status` in front; match it, so the first
                // command shows the operator where they actually are.
                next_steps: {
                    let mut steps =
                        vec![NextStep::Bash(format!("git status {span_root}/{name}"))];
                    steps.extend(crate::cli::resolve::conflict_remediation(
                        &[name], span_root, kind,
                    ));
                    steps
                },
            }
            .into()
        } else {
            e.into()
        }
    })?;

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

// ---------------------------------------------------------------------------
// Reconcile check (post-write span-wide health)
// ---------------------------------------------------------------------------
//
// After an anchor mutation, the command output must distinguish the
// requested-address success (the *local* fact) from the fate of superseded
// old anchors and the span-wide drift-free state — the *span-wide* fact,
// asserted only by a scoped resolver check over the resulting declaration.
// The surface below is the contract: `ReconcileCheck` carries the three
// facts, the JSON document family (schema_version 1) is the structured
// rendering, and `is_superseded` is the provable-supersession predicate.

/// Mutation-family JSON document version. Versioning is per family: the
/// mutation document starts at 1 while the drift scan document uses its own
/// 2→3 history, and the two shapes are identified by their top-level keys
/// (`command` vs `findings`) — two shapes claiming the same version number
/// would make the number meaningless.
pub const MUTATION_JSON_SCHEMA_VERSION: u32 = 1;

/// Stable outcome enum for `addresses[].outcome` in the mutation document:
/// `ADDED | RESOLVED | UNCHANGED | COLLAPSED`.
///
/// Every variant is a unit variant on purpose: `outcome` always serializes
/// as a bare JSON string, so a consumer can type the field as a string and
/// compare it literally. Per-outcome detail rides on sibling fields of
/// [`AnchorOutcome`] (see `records_before`), never inside `outcome`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AddressOutcome {
    /// Brand-new anchor record created.
    Added,
    /// Existing anchor's hash updated in place.
    Resolved,
    /// Anchor already matched the stored hash.
    Unchanged,
    /// The identity carried more than one record; all of them were replaced
    /// by the single freshly-hashed record. `records_before` carries the
    /// pre-collapse count.
    Collapsed,
}

/// Stable enum for `superseded[].state`: `RETIRED | REMAINS`.
///
/// `RETIRED` is the integration seam for the main-204 atomic-replacement
/// capability (when `add` itself retires the old anchor) and is not produced
/// on this branch — here supersession always reports `REMAINS` (the anchor is
/// still in the declaration) and hands the operator the runnable retire
/// command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SupersessionState {
    /// The mutation itself removed the old anchor from the declaration.
    Retired,
    /// The old anchor is still in the declaration; retire it with the
    /// printed `git span remove` next action.
    Remains,
}

/// Stable enum for `span_health.state`: `DRIFT_FREE | DRIFT | UNKNOWN`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpanHealthState {
    /// Span-wide clean: no anchor has a status for which
    /// `anchor_status_is_drift()` returns true.
    DriftFree,
    /// At least one actionable-drift anchor on the span.
    Drift,
    /// The check could not produce a verdict — `reason` carries the detail
    /// ("index changed during scan" or the check-error detail).
    Unknown,
}

/// One requested address and its outcome in the mutation document.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AnchorOutcome {
    pub address: String,
    pub outcome: AddressOutcome,
    /// Record count at this identity before the mutation, present only on
    /// `COLLAPSED` rows. Absent — not `null` — everywhere else, so the three
    /// pre-existing outcome kinds' JSON is byte-for-byte unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub records_before: Option<usize>,
    /// How many records this mutation retired at the address carried the
    /// duplicate-collapse sentinel. Present only when at least one did, so
    /// every row that resolves nothing unverified is byte-for-byte unchanged.
    ///
    /// The sibling of `replace`'s `retired_collapsed_duplicates`, and named
    /// to match it: a script that wants to know "did this command silently
    /// dispose of a state nobody had verified" must be able to ask both
    /// endpoints of the annotation's advice the same question.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retired_collapsed_duplicates: Option<usize>,
}

/// One provably superseded old anchor: the covering new address, its state,
/// and the runnable retire next action.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SupersededAnchor {
    /// Canonical address of the old anchor (e.g. `src/read-user.ts#L1-L5`).
    pub address: String,
    /// Canonical address of the new anchor that covers it.
    pub superseded_by: String,
    pub state: SupersessionState,
    /// Runnable next action (e.g. `git span remove <span> <addr>`).
    pub next_step: String,
}

/// One actionable-drift anchor that remains after the mutation.
///
/// `status` is the exact output of `drift_output::status_json`, so the
/// anchor-status vocabulary is shared with drift's findings by construction.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RemainingAnchor {
    pub address: String,
    pub status: serde_json::Value,
    pub next_step: String,
    /// Human drift-label vocabulary for the human remains line (plan
    /// §Output contract: "reusing the drift-label vocabulary"). Rendering
    /// detail, never serialized — the JSON document carries `address`,
    /// `status`, and `next_step` only.
    #[serde(skip_serializing)]
    pub label: String,
}

/// One drifting anchor inside `span_health.drifting`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DriftingAnchor {
    pub address: String,
    pub status: serde_json::Value,
}

/// The span-wide health block of the mutation document.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SpanHealth {
    pub state: SpanHealthState,
    pub drift_count: usize,
    pub drifting: Vec<DriftingAnchor>,
    /// Count of `RESOLVED_PENDING_COMMIT` anchors: clean by definition, but
    /// never hidden.
    pub resolved_pending_commit_count: usize,
    /// Present only on `UNKNOWN` ("index changed during scan" or the
    /// check-error detail).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The mutation-family JSON document (`schema_version: 1`).
///
/// Every top-level key is always emitted (arrays possibly empty), so hooks
/// rely on a stable key set rather than key presence.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MutationDocument {
    pub schema_version: u32,
    pub command: String,
    pub span: String,
    pub addresses: Vec<AnchorOutcome>,
    pub superseded: Vec<SupersededAnchor>,
    pub remaining: Vec<RemainingAnchor>,
    pub span_health: SpanHealth,
    /// `Some(true)` only on `why` documents (plan §Output contract: the why
    /// document carries `why_written: true`); absent on `add` documents,
    /// which the plan's example shows without the key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub why_written: Option<bool>,
}

impl MutationDocument {
    /// Build a document with the family's `schema_version: 1` pinned.
    pub fn new(
        command: &str,
        span: &str,
        addresses: Vec<AnchorOutcome>,
        superseded: Vec<SupersededAnchor>,
        remaining: Vec<RemainingAnchor>,
        span_health: SpanHealth,
    ) -> Self {
        Self {
            schema_version: MUTATION_JSON_SCHEMA_VERSION,
            command: command.to_string(),
            span: span.to_string(),
            addresses,
            superseded,
            remaining,
            span_health,
            why_written: None,
        }
    }

    /// Mark the document as a written `why` (`why_written: true`).
    pub fn with_why_written(mut self) -> Self {
        self.why_written = Some(true);
        self
    }
}

/// Result of the post-write span-wide reconcile check.
///
/// `indeterminate` is the resolver's `index_changed` verdict only and drives
/// exit 2 (the retryable condition, exactly as `git span drift` defines it);
/// `check_error` is the fatal path and drives exit 1. `clean` is the
/// span-wide fact — it never names local mutation success.
#[derive(Debug, Clone, PartialEq)]
pub struct ReconcileCheck {
    /// Old anchors the invocation provably supersedes.
    pub superseded: Vec<SupersededAnchor>,
    /// Actionable-drift anchors not touched by this invocation and not
    /// reported as superseded (the two arrays are disjoint by definition).
    pub remaining: Vec<RemainingAnchor>,
    /// Every actionable-drift anchor on the span, touched or not — the
    /// span-wide drifted line lists all of them (plan: "lists every
    /// actionable-drift anchor, touched or not — covers the `--at` case
    /// where the *new* anchor is itself drifted"), and JSON
    /// `span_health.drifting` is rendered from this list. Empty on
    /// indeterminate and check-error verdicts (nothing trustworthy to list).
    pub drifting: Vec<DriftingAnchor>,
    /// Span-wide drift-free verdict.
    pub clean: bool,
    /// Resolver `index_changed` verdict — the retryable indeterminate.
    pub indeterminate: bool,
    /// Fatal check-error detail, when the check itself errored.
    pub check_error: Option<String>,
    /// Total anchors on the span at check time.
    pub total_anchors: usize,
    /// `RESOLVED_PENDING_COMMIT` anchors on the span (clean, informational).
    pub pending_commit_count: usize,
}

/// Convert an `AnchorRecord`'s stored `(start_line, end_line)` into an
/// `AnchorExtent` (whole-file anchors store `0, 0`).
fn anchor_record_extent(a: &AnchorRecord) -> AnchorExtent {
    if a.start_line == 0 && a.end_line == 0 {
        AnchorExtent::WholeFile
    } else {
        AnchorExtent::LineRange {
            start: a.start_line,
            end: a.end_line,
        }
    }
}

/// Provable-supersession rule (plan §Definitions): an old anchor is
/// superseded by a new anchor of the same invocation only when, on the same
/// path, the new extent *covers* the old extent:
///
/// - a new whole-file anchor covers any old extent on the path (line range
///   or whole-file);
/// - a new line range covers an old line range iff `new.start <= old.start`
///   and `new.end >= old.end`;
/// - identical `(path, extent)` is NOT supersession — that is the existing
///   resolved-in-place (hash update) case;
/// - disjoint same-path ranges, partial overlaps, and any cross-path pair are
///   never supersession.
pub fn is_superseded(old: &AnchorRecord, new_path: &str, new_extent: &AnchorExtent) -> bool {
    if old.path != new_path {
        return false;
    }
    let old_extent = anchor_record_extent(old);
    if old_extent == *new_extent {
        return false;
    }
    match new_extent {
        AnchorExtent::WholeFile => true,
        AnchorExtent::LineRange { start, end } => match old_extent {
            AnchorExtent::WholeFile => false,
            AnchorExtent::LineRange {
                start: old_start,
                end: old_end,
            } => *start <= old_start && *end >= old_end,
        },
    }
}

/// Run the post-write span-wide reconcile check over the touched span.
///
/// Per plan §Mechanism, the check runs while still holding the exclusive
/// span-file flock, resolves the single span via
/// `resolve_named_spans_retaining_source_layers` (with
/// `EngineOptions { layers: LayerSet::full(), ignore_unavailable: false,
/// needs_all_layers: true, since: None, fuzzy_threshold: 0.95 }` — the
/// human-renderer configuration, so per-anchor statuses match what
/// `git span drift <span>` would show), reads the `index_changed` verdict
/// from the returned `SourceLayers`, and derives the three facts:
///
/// - superseded: requested addresses vs. the pre-write anchor set
///   (`is_superseded`);
/// - remains: actionable-drift anchors not touched by this invocation;
/// - clean: no anchor of the resolved span has a status for which
///   `anchor_status_is_drift()` returns true.
///
/// A resolver hard error is captured as `check_error: Some(...)` (the fatal
/// path, exit 1) rather than propagated: the write already succeeded and the
/// local facts must still print, followed by the `state unverified` line. The
/// `index_changed` verdict is captured as `indeterminate: true` (exit 2, the
/// retryable condition) and makes the per-anchor verdicts untrustworthy, so
/// `remaining`/`drifting` are emptied for that verdict — only the provable
/// supersession facts survive it.
pub fn run_reconcile_check(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    touched: &[(String, AnchorExtent)],
    pre_write_anchors: &[AnchorRecord],
) -> Result<ReconcileCheck> {
    let options = EngineOptions {
        layers: LayerSet::full(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
        fuzzy_threshold: 0.95,
    };
    let names = vec![name.to_string()];
    let (resolved, source_layers) = match resolve_named_spans_retaining_source_layers(
        repo, span_root, &names, options,
    ) {
        Ok(pair) => pair,
        Err(e) => {
            return Ok(check_error_result(name, touched, pre_write_anchors, e.to_string()));
        }
    };
    let (_, resolution) = resolved.into_iter().next().unwrap_or_else(|| {
        (
            name.to_string(),
            Err(crate::Error::SpanNotFound(name.to_string())),
        )
    });
    let span = match resolution {
        Ok(span) => span,
        Err(e) => {
            return Ok(check_error_result(name, touched, pre_write_anchors, e.to_string()));
        }
    };

    let superseded = superseded_for(name, touched, pre_write_anchors);
    // (path, extent) keys of the pre-write anchors reported as superseded —
    // such an anchor's fate is the supersession fact, never the remains fact.
    let superseded_keys: std::collections::HashSet<(String, AnchorExtent)> =
        pre_write_anchors
            .iter()
            .filter(|old| touched.iter().any(|(p, e)| is_superseded(old, p, e)))
            .map(|old| (old.path.clone(), anchor_record_extent(old)))
            .collect();
    let touched_keys: std::collections::HashSet<(String, AnchorExtent)> =
        touched.iter().cloned().collect();

    let mut remaining: Vec<RemainingAnchor> = Vec::new();
    let mut drifting: Vec<DriftingAnchor> = Vec::new();
    for a in &span.anchors {
        if !anchor_status_is_drift(&a.status) {
            continue;
        }
        let key = (
            a.anchored.path.to_string_lossy().into_owned(),
            a.anchored.extent,
        );
        let address = resolved_anchor_address(&a.anchored);
        drifting.push(DriftingAnchor {
            address: address.clone(),
            status: status_json(&a.status),
        });
        if touched_keys.contains(&key) || superseded_keys.contains(&key) {
            continue;
        }
        remaining.push(RemainingAnchor {
            address,
            status: status_json(&a.status),
            next_step: format!("git span remove {name} {}", resolved_anchor_address(&a.anchored)),
            label: drift_label_for(a),
        });
    }

    let indeterminate = source_layers.index_changed;
    let pending_commit_count = span
        .anchors
        .iter()
        .filter(|a| matches!(a.status, AnchorStatus::ResolvedPendingCommit))
        .count();
    Ok(ReconcileCheck {
        superseded,
        remaining: if indeterminate { Vec::new() } else { remaining },
        drifting: if indeterminate { Vec::new() } else { drifting },
        clean: !indeterminate && !span.anchors.iter().any(|a| anchor_status_is_drift(&a.status)),
        indeterminate,
        check_error: None,
        total_anchors: span.anchors.len(),
        pending_commit_count,
    })
}

/// A `ReconcileCheck` for the fatal path: the write happened but the check
/// could not produce a verdict. The supersession facts are still derivable
/// (they are provable from the pre-write declaration, no resolver needed);
/// nothing else is.
fn check_error_result(
    name: &str,
    touched: &[(String, AnchorExtent)],
    pre_write_anchors: &[AnchorRecord],
    detail: String,
) -> ReconcileCheck {
    ReconcileCheck {
        superseded: superseded_for(name, touched, pre_write_anchors),
        remaining: Vec::new(),
        drifting: Vec::new(),
        clean: false,
        indeterminate: false,
        check_error: Some(detail),
        total_anchors: 0,
        pending_commit_count: 0,
    }
}

/// The plan's provable-supersession report for one invocation: for every
/// pre-write anchor covered by a requested address of this invocation, the
/// covering new address, `REMAINS` state (the anchor is still in the
/// declaration on this branch), and the runnable retire command.
fn superseded_for(
    name: &str,
    touched: &[(String, AnchorExtent)],
    pre_write_anchors: &[AnchorRecord],
) -> Vec<SupersededAnchor> {
    let mut out = Vec::new();
    for old in pre_write_anchors {
        let Some((new_path, new_extent)) = touched
            .iter()
            .find(|(p, e)| is_superseded(old, p, e))
        else {
            continue;
        };
        let old_addr = addr_from_extent(&old.path, &anchor_record_extent(old));
        out.push(SupersededAnchor {
            address: old_addr.clone(),
            superseded_by: addr_from_extent(new_path, new_extent),
            state: SupersessionState::Remains,
            next_step: format!("git span remove {name} {old_addr}"),
        });
    }
    out
}

/// Canonical address of a resolved anchor's anchored location.
fn resolved_anchor_address(loc: &AnchorLocation) -> String {
    match loc.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&loc.path.to_string_lossy(), Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&loc.path.to_string_lossy(), None, None),
    }
}

/// The resolver status label for the human remains line, from the shared
/// drift-label vocabulary.
fn drift_label_for(a: &AnchorResolved) -> String {
    format_drift_label(&a.status, a.source, a.locus.as_ref(), a.current.is_some())
}

/// Map a `ReconcileCheck` verdict to the three-state exit contract (plan
/// §Exit codes): 2 = indeterminate (the resolver's `index_changed` verdict
/// only — the retryable condition, exactly as `git span drift` defines it,
/// distinct from both 0 (clean) and 1 (drift / check error)); 1 = drift
/// remains or the check errored; 0 = clean.
///
/// Extracted as a testable function because the Phase-2 seam test drives
/// the verdict → exit mapping through real code, not a hand-rolled
/// construction.
pub(crate) fn reconcile_exit_code(check: &ReconcileCheck) -> i32 {
    if check.indeterminate {
        2
    } else if check.check_error.is_some() || !check.clean {
        1
    } else {
        0
    }
}

/// Build the JSON `span_health` block from a check verdict.
fn span_health_from_check(check: &ReconcileCheck) -> SpanHealth {
    let (state, reason) = if check.indeterminate {
        (SpanHealthState::Unknown, Some("index changed during scan".into()))
    } else if let Some(detail) = &check.check_error {
        (SpanHealthState::Unknown, Some(detail.clone()))
    } else if check.clean {
        (SpanHealthState::DriftFree, None)
    } else {
        (SpanHealthState::Drift, None)
    };
    SpanHealth {
        state,
        drift_count: check.drifting.len(),
        drifting: check.drifting.clone(),
        resolved_pending_commit_count: check.pending_commit_count,
        reason,
    }
}

/// Render the post-write facts block (human): blank line, superseded lines
/// (when the invocation touches addresses), remains lines, blank line, and
/// the single span-wide line. Wording is character-for-character per plan
/// §Output contract. `include_superseded` is false for `why` — it touches no
/// addresses, so the supersession fact is empty by construction.
fn render_reconcile_block(name: &str, check: &ReconcileCheck, include_superseded: bool) {
    println!();
    if include_superseded {
        for s in &check.superseded {
            println!(
                "Old anchor superseded by `{}`: `{}` — next: `{}`",
                s.superseded_by, s.address, s.next_step
            );
        }
    }
    for r in &check.remaining {
        println!(
            "Old anchor remains: `{}` ({}) — next: `{}`",
            r.address, r.label, r.next_step
        );
    }
    if !check.superseded.is_empty() || !check.remaining.is_empty() {
        println!();
    }
    if let Some(detail) = &check.check_error {
        println!(
            "Span `{name}`: state unverified ({detail}) — run `git span drift {name}`."
        );
    } else if check.indeterminate {
        println!(
            "Span `{name}`: state indeterminate (index changed during check) — re-run the command or `git span drift {name}`."
        );
    } else if check.clean {
        let mut line = format!(
            "Span `{name}`: 0 drift across 1 span ({} anchor{} checked).",
            check.total_anchors,
            if check.total_anchors == 1 { "" } else { "s" }
        );
        if check.pending_commit_count > 0 {
            // The plan pins the suffix with a leading space:
            // `` ; 1 anchor resolved, pending commit ``.
            write!(
                &mut line,
                " ; {} anchor{} resolved, pending commit",
                check.pending_commit_count,
                if check.pending_commit_count == 1 { "" } else { "s" }
            )
            .unwrap();
        }
        println!("{line}");
    } else {
        let addrs: Vec<String> = check
            .drifting
            .iter()
            .map(|d| format!("`{}`", d.address))
            .collect();
        println!(
            "Span `{name}`: {} anchor{} drifted — {}. Run `git span drift {name}` for details.",
            check.drifting.len(),
            if check.drifting.len() == 1 { "" } else { "s" },
            addrs.join(", ")
        );
    }
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
            config: crate::span_file::SpanConfig::default(),
            resolved: Vec::new(),
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
            config: crate::span_file::SpanConfig::default(),
            resolved: Vec::new(),
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
            config: crate::span_file::SpanConfig::default(),
            resolved: Vec::new(),
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
            config: crate::span_file::SpanConfig::default(),
            resolved: Vec::new(),
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
            config: crate::span_file::SpanConfig::default(),
            resolved: Vec::new(),
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

    /// Build a minimal `AnchorRecord` for the supersession rule table.
    /// Whole-file anchors store `(0, 0)`.
    fn rec(path: &str, start_line: u32, end_line: u32) -> AnchorRecord {
        AnchorRecord {
            path: path.into(),
            start_line,
            end_line,
            algorithm: "rk64".into(),
            content_hash: "x".into(),
        }
    }

    fn lines(start: u32, end: u32) -> AnchorExtent {
        AnchorExtent::LineRange { start, end }
    }

    /// The plan's supersession rule table: identical extent → not superseded;
    /// whole-file covers range; range covers range; partial overlap → not
    /// superseded; disjoint same-path → not superseded; cross-path → not
    /// superseded.
    #[test]
    fn is_superseded_rule_table() {
        let old_range = rec("src/a.ts", 1, 5);
        let old_whole = rec("src/a.ts", 0, 0);

        // Identical (path, extent) is NOT supersession — the resolved-in-place
        // (hash update) case, for both line ranges and whole-file anchors.
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(1, 5)));
        assert!(!is_superseded(&old_whole, "src/a.ts", &AnchorExtent::WholeFile));

        // Whole-file covers any old extent on the path (line range).
        assert!(is_superseded(&old_range, "src/a.ts", &AnchorExtent::WholeFile));

        // Range covers range iff new.start <= old.start && new.end >= old.end.
        assert!(is_superseded(&old_range, "src/a.ts", &lines(1, 6)));
        assert!(is_superseded(&old_range, "src/a.ts", &lines(0, 5)));
        assert!(is_superseded(&old_range, "src/a.ts", &lines(1, 10)));

        // Partial overlap → not superseded (each direction).
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(2, 6)));
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(4, 10)));
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(2, 4)));

        // Disjoint same-path ranges → not superseded (each direction).
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(6, 10)));
        assert!(!is_superseded(&old_range, "src/a.ts", &lines(0, 0)));

        // A line range can never cover a whole-file anchor.
        assert!(!is_superseded(&old_whole, "src/a.ts", &lines(1, 100)));

        // Cross-path → never superseded, regardless of extents.
        assert!(!is_superseded(&old_range, "src/b.ts", &AnchorExtent::WholeFile));
        assert!(!is_superseded(&old_range, "src/b.ts", &lines(0, 100)));
        assert!(!is_superseded(&old_whole, "src/b.ts", &AnchorExtent::WholeFile));
    }

    // ---------------------------------------------------------------------
    // Supersession predicate contract
    //
    // These checks pin the `supersession_conflict` signature and the
    // predicate matrix from the plan.
    // ---------------------------------------------------------------------

    /// An `AnchorRecord` with the given (path, start, end); `(0, 0)` is the
    /// whole-file sentinel.
    fn record(path: &str, start_line: u32, end_line: u32) -> AnchorRecord {
        AnchorRecord {
            path: path.into(),
            start_line,
            end_line,
            algorithm: "rk64".into(),
            content_hash: "stub-hash".into(),
        }
    }

    /// A requested anchor: `(path, extent)` as `run_add` passes it.
    fn requested(path: &str, extent: AnchorExtent) -> (String, AnchorExtent) {
        (path.into(), extent)
    }

    #[test]
    fn existing_whole_file_vs_new_range_is_a_conflict() {
        let existing = vec![record("src/lib.rs", 0, 0)];
        let requested = vec![requested(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 1, end: 5 },
        )];
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/lib.rs#L1-L5".into(),
                conflicting_addr: "src/lib.rs".into(),
                whole_file_side: WholeFileSide::Existing,
                source: ConflictSource::ExistingRecord,
            })
        );
    }

    #[test]
    fn new_whole_file_vs_existing_range_is_a_conflict() {
        let existing = vec![record("src/lib.rs", 1, 5)];
        let requested = vec![requested("src/lib.rs", AnchorExtent::WholeFile)];
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/lib.rs".into(),
                conflicting_addr: "src/lib.rs#L1-L5".into(),
                whole_file_side: WholeFileSide::Requested,
                source: ConflictSource::ExistingRecord,
            })
        );
    }

    #[test]
    fn exact_identity_whole_file_is_not_a_conflict() {
        let existing = vec![record("src/lib.rs", 0, 0)];
        let requested = vec![requested("src/lib.rs", AnchorExtent::WholeFile)];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn exact_identity_range_is_not_a_conflict() {
        let existing = vec![record("src/lib.rs", 1, 5)];
        let requested = vec![requested(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 1, end: 5 },
        )];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn disjoint_ranges_same_file_are_not_a_conflict() {
        let existing = vec![record("src/lib.rs", 1, 5)];
        let requested = vec![requested(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 10, end: 20 },
        )];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn partially_overlapping_ranges_are_not_a_conflict() {
        let existing = vec![record("src/lib.rs", 1, 5)];
        let requested = vec![requested(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 3, end: 10 },
        )];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn nested_ranges_are_not_a_conflict() {
        let existing = vec![record("src/lib.rs", 1, 10)];
        let requested = vec![requested(
            "src/lib.rs",
            AnchorExtent::LineRange { start: 3, end: 5 },
        )];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn different_paths_are_not_a_conflict() {
        let existing = vec![record("src/a.rs", 0, 0)];
        let requested = vec![requested(
            "src/b.rs",
            AnchorExtent::LineRange { start: 1, end: 5 },
        )];
        assert!(supersession_conflict(&requested, &existing).is_none());
    }

    #[test]
    fn intra_invocation_whole_file_and_range_is_a_conflict() {
        // `add name P P#L1-L2` in one invocation must fail identically: the
        // first requested anchor (whole-file) is checked against its
        // co-requested same-path range. The conflict source is CoRequested —
        // nothing is tracked on the span yet, so no remove command applies.
        let requested = vec![
            requested("src/lib.rs", AnchorExtent::WholeFile),
            requested(
                "src/lib.rs",
                AnchorExtent::LineRange { start: 1, end: 5 },
            ),
        ];
        let existing: Vec<AnchorRecord> = Vec::new();
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/lib.rs".into(),
                conflicting_addr: "src/lib.rs#L1-L5".into(),
                whole_file_side: WholeFileSide::Requested,
                source: ConflictSource::CoRequested,
            })
        );
    }

    #[test]
    fn intra_invocation_range_then_whole_file_is_a_conflict() {
        // The reversed order (`add name P#L1-L2 P`) reports the range as the
        // requested anchor and the whole-file as the co-requested conflict.
        let requested = vec![
            requested(
                "src/lib.rs",
                AnchorExtent::LineRange { start: 1, end: 5 },
            ),
            requested("src/lib.rs", AnchorExtent::WholeFile),
        ];
        let existing: Vec<AnchorRecord> = Vec::new();
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/lib.rs#L1-L5".into(),
                conflicting_addr: "src/lib.rs".into(),
                whole_file_side: WholeFileSide::Existing,
                source: ConflictSource::CoRequested,
            })
        );
    }

    #[test]
    fn existing_record_conflict_wins_over_co_requested() {
        // When the same requested anchor conflicts with both an existing
        // record and a co-requested anchor, the existing-record match is
        // reported (existing-inner iteration precedes co-requested): the
        // first rejection is actionable with a remove command.
        let existing = vec![record("src/lib.rs", 0, 0)];
        let requested = vec![
            requested(
                "src/lib.rs",
                AnchorExtent::LineRange { start: 1, end: 5 },
            ),
            requested("src/lib.rs", AnchorExtent::WholeFile),
        ];
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/lib.rs#L1-L5".into(),
                conflicting_addr: "src/lib.rs".into(),
                whole_file_side: WholeFileSide::Existing,
                source: ConflictSource::ExistingRecord,
            })
        );
    }

    #[test]
    fn conflict_reports_the_deterministic_first_match() {
        // Both requested anchors conflict with their same-path existing
        // whole-file anchor; the first match in requested-outer,
        // existing-inner order must win.
        let existing = vec![record("src/a.rs", 0, 0), record("src/b.rs", 0, 0)];
        let requested = vec![
            requested(
                "src/a.rs",
                AnchorExtent::LineRange { start: 1, end: 2 },
            ),
            requested(
                "src/b.rs",
                AnchorExtent::LineRange { start: 3, end: 4 },
            ),
        ];
        assert_eq!(
            supersession_conflict(&requested, &existing),
            Some(SupersessionConflict {
                requested_addr: "src/a.rs#L1-L2".into(),
                conflicting_addr: "src/a.rs".into(),
                whole_file_side: WholeFileSide::Existing,
                source: ConflictSource::ExistingRecord,
            })
        );
    }

    /// The mutation document's serde contract: the exact enum spellings and
    /// top-level key set from the plan's example document (schema_version 1,
    /// `command`/`span`/`addresses`/`superseded`/`remaining`/`span_health`).
    #[test]
    fn mutation_document_serializes_contract_shape() {
        let doc = MutationDocument::new(
            "add",
            "user-id-lifecycle",
            vec![AnchorOutcome {
                address: "src/read-user.ts#L1-L3".into(),
                outcome: AddressOutcome::Added,
                records_before: None,
                retired_collapsed_duplicates: None,
            }],
            vec![SupersededAnchor {
                address: "src/read-user.ts#L1-L5".into(),
                superseded_by: "src/read-user.ts#L1-L3".into(),
                state: SupersessionState::Remains,
                next_step: "git span remove user-id-lifecycle src/read-user.ts#L1-L5".into(),
            }],
            vec![RemainingAnchor {
                address: "src/read-user.ts".into(),
                status: serde_json::json!({ "code": "CHANGED" }),
                next_step: "git span remove user-id-lifecycle src/read-user.ts".into(),
                label: "changed in the working tree".into(),
            }],
            SpanHealth {
                state: SpanHealthState::Drift,
                drift_count: 1,
                drifting: vec![DriftingAnchor {
                    address: "src/read-user.ts".into(),
                    status: serde_json::json!({ "code": "CHANGED" }),
                }],
                resolved_pending_commit_count: 0,
                reason: None,
            },
        );
        let v: serde_json::Value = serde_json::to_value(&doc).unwrap();
        assert_eq!(v["schema_version"], 1);
        assert_eq!(v["command"], "add");
        assert_eq!(v["span"], "user-id-lifecycle");
        assert_eq!(v["addresses"][0]["outcome"], "ADDED");
        assert_eq!(v["superseded"][0]["state"], "REMAINS");
        assert_eq!(v["superseded"][0]["superseded_by"], "src/read-user.ts#L1-L3");
        assert_eq!(v["remaining"][0]["status"]["code"], "CHANGED");
        assert_eq!(v["span_health"]["state"], "DRIFT");
        assert_eq!(v["span_health"]["drift_count"], 1);
        assert!(v["span_health"].get("reason").is_none());

        // A clean span: DRIFT_FREE, empty arrays, no reason key.
        let clean = MutationDocument::new(
            "add",
            "s",
            vec![],
            vec![],
            vec![],
            SpanHealth {
                state: SpanHealthState::DriftFree,
                drift_count: 0,
                drifting: vec![],
                resolved_pending_commit_count: 0,
                reason: None,
            },
        );
        let v: serde_json::Value = serde_json::to_value(&clean).unwrap();
        assert_eq!(v["span_health"]["state"], "DRIFT_FREE");
        assert!(v["addresses"].as_array().is_some_and(Vec::is_empty));
        assert!(v["superseded"].as_array().is_some_and(Vec::is_empty));
        assert!(v["remaining"].as_array().is_some_and(Vec::is_empty));
        assert!(v["span_health"].get("reason").is_none());

        // UNKNOWN carries the reason string.
        let unknown = SpanHealth {
            state: SpanHealthState::Unknown,
            drift_count: 0,
            drifting: vec![],
            resolved_pending_commit_count: 0,
            reason: Some("index changed during scan".into()),
        };
        let v: serde_json::Value = serde_json::to_value(&unknown).unwrap();
        assert_eq!(v["state"], "UNKNOWN");
        assert_eq!(v["reason"], "index changed during scan");

        // The remaining stable spellings.
        assert_eq!(
            serde_json::to_value(AddressOutcome::Resolved).unwrap(),
            "RESOLVED"
        );
        assert_eq!(
            serde_json::to_value(AddressOutcome::Unchanged).unwrap(),
            "UNCHANGED"
        );
        assert_eq!(
            serde_json::to_value(SupersessionState::Retired).unwrap(),
            "RETIRED"
        );
    }
}
