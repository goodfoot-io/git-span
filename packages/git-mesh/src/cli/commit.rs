//! Mesh-edit command handlers — §6.2, §6.3, §6.4, §10.5.
//!
//! Every function produces markdown-formatted prose output per the prose
//! specification in CARD.md. All errors use [`CliError`] with structured
//! remediation context.
//!
//! `run_add`, `run_remove`, and `run_why` edit worktree mesh files
//! directly; meshes are tracked files, so there is no separate staging
//! area or commit step beyond the worktree write.

use crate::cli::error::from_lib_error;
use crate::cli::format::{IDEMPOTENT_TAG, format_anchor_address};
use crate::cli::{AddArgs, CliError, NextStep, RemoveArgs, WhyArgs};
use crate::mesh_file::AnchorRecord;
use crate::mesh_file::MeshFile;
use crate::mesh_file::parse_address;
use crate::mesh_file_reader::MeshFileReader;
use crate::types::{AnchorExtent, validate_add_target};
use anyhow::{Context, Result};
use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};
use std::fmt::Write as FmtWrite;
use std::path::Path;

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
                "git mesh {subcommand} <name> <path>#L<start>-L<end>"
            )),
            NextStep::Bash(format!("git mesh {subcommand} <name> <path>")),
        ],
    }
}

// The mesh root is resolved once in `cli::dispatch` (the single
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
        crate::git::index_entries(repo)
            .ok()
            .and_then(|entries| {
                entries
                    .into_iter()
                    .find(|en| en.path == path && en.mode.is_commit())
            })
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

/// Build the absolute worktree path for a mesh file: `<workdir>/<mesh_root>/<name>`.
pub(crate) fn mesh_file_path(
    repo: &gix::Repository,
    mesh_root: &str,
    name: &str,
) -> Result<std::path::PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;
    Ok(workdir.join(mesh_root).join(name))
}

/// Read a mesh file from the worktree. Returns an empty `MeshFile` when the
/// file does not exist.
pub(crate) fn read_worktree_mesh(repo: &gix::Repository, mesh_root: &str, name: &str) -> Result<MeshFile> {
    let path = mesh_file_path(repo, mesh_root, name)?;
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        Ok(MeshFile::parse(&content)?)
    } else {
        Ok(MeshFile {
            anchors: Vec::new(),
            why: String::new(),
        })
    }
}

/// Write a mesh file to the worktree atomically, creating parent directories
/// as needed.
///
/// Writes to a dot-prefixed temp file in the same directory, then
/// [`std::fs::rename`]s it to the target path.  Rename is atomic on the
/// same filesystem, so a crash or interruption never leaves a truncated
/// mesh file on disk — either the old content or the new content is
/// always visible.
///
/// The dot prefix (`.mesh.tmp`) is already hidden from all three
/// enumeration paths by [`crate::mesh_file_reader::is_mesh_name_segment`].
pub(crate) fn write_worktree_mesh(
    repo: &gix::Repository,
    mesh_root: &str,
    name: &str,
    mesh: &MeshFile,
) -> Result<()> {
    let path = mesh_file_path(repo, mesh_root, name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_name = format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("mesh")
    );
    let tmp_path = path.parent().map(|p| p.join(&tmp_name)).unwrap_or_else(|| {
        std::path::PathBuf::from(&tmp_name)
    });
    std::fs::write(&tmp_path, mesh.serialize())?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// Check for prefix collision between a new mesh name and existing worktree
/// mesh files.  The filesystem enforces that two paths cannot coexist when
/// one is a strict prefix of the other (e.g. `a/b` and `a/b/c`).
///
/// Returns `Ok(())` when no collision exists, or an error describing the
/// collision with both mesh names.
fn check_worktree_prefix_collision(
    repo: &gix::Repository,
    mesh_root: &str,
    name: &str,
) -> std::result::Result<(), crate::Error> {
    let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());
    let known_names = reader.list_mesh_names()?;
    for other in &known_names {
        if other == name {
            continue;
        }
        // `list_mesh_names` returns the raw HEAD∪index∪worktree union; a
        // name deleted in the index/worktree but still in HEAD is a
        // tombstone and no longer occupies its path.  Filter it through
        // the effective view (mirrors `load_all_meshes_in`).
        match reader.read_effective(other) {
            Ok(Some(_)) => {}
            Err(crate::Error::MeshConflict(_)) => {}
            Ok(None) => continue,
            Err(e) => return Err(e),
        }
        // `other` is a strict ancestor of `name`.
        if let Some(rest) = name.strip_prefix(other.as_str())
            && rest.starts_with('/')
        {
            return Err(crate::Error::MeshNameCollidesWithExistingMesh {
                staged: name.to_string(),
                blocking: other.clone(),
            });
        }
        // `other` is a strict descendant of `name`.
        if let Some(rest) = other.strip_prefix(name)
            && rest.starts_with('/')
        {
            return Err(crate::Error::MeshNameCollidesWithExistingMesh {
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

pub fn run_add(repo: &gix::Repository, args: AddArgs, mesh_root: &str) -> Result<i32> {
    crate::validation::validate_mesh_name(&args.name)?;

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

    // Anchor source-path safety (fail-closed, per `<fail-closed>` and the
    // File Format / Storage Layout path rules). Every anchor address path
    // must be a safe repo-relative path — the same rule enforced for the
    // mesh root, via the shared validator (no parallel implementation) —
    // and must point at content that exists (tracked, in the worktree, or
    // a submodule gitlink). Reject absolute / `..` / inside-`.git` /
    // nonexistent paths before any mesh-file I/O.
    {
        let _perf = crate::perf::span("add.validate-anchor-paths");
        let workdir = repo
            .workdir()
            .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?
            .to_path_buf();
        for (path, _extent) in &parsed {
            crate::mesh_root::validate_repo_relative_path("anchor path", path).map_err(|e| {
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

            crate::mesh_root::reject_anchor_inside_mesh_root(mesh_root, path).map_err(|e| {
                CliError {
                    subcommand: "add",
                    summary: format!("`{path}` is not a valid anchor path."),
                    what_happened: e.to_string(),
                    next_steps: vec![NextStep::Prose(format!(
                        "Anchor paths must not be inside the mesh root `{mesh_root}`. \
                         Choose a source file outside the mesh directory."
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
                let tracked = crate::git::index_entries(repo)
                    .map(|entries| entries.iter().any(|en| en.path == *path))
                    .unwrap_or(false);
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
            validate_add_target(repo, std::path::Path::new(path), extent).map_err(|err| {
                let next_steps = match &err {
                    crate::types::AddPrecheckError::GitignoredPath { .. } => vec![
                        NextStep::Prose(
                            "git-mesh tracks content through git and cannot resolve a path \
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

    // Check for prefix collision against existing worktree mesh files
    // before any file I/O.  The filesystem would reject the read/write
    // with a cryptic OS error, so we surface a structured mesh error.
    check_worktree_prefix_collision(repo, mesh_root, &args.name).map_err(|e| CliError {
        subcommand: "add",
        summary: format!("cannot add mesh `{}`", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Prose(
            "Rename the mesh to avoid the prefix collision.".into(),
        )],
    })?;

    // Read the current worktree mesh file.
    let mut mesh_file = {
        let _perf = crate::perf::span("add.read-current");
        read_worktree_mesh(repo, mesh_root, &args.name)?
    };

    // Build a lookup of existing anchors: (path, start_line, end_line) -> content_hash.
    let existing: std::collections::HashMap<(String, u32, u32), String> = mesh_file
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
                hash_anchor_content(repo, path, extent, anchor_oid.as_deref())?;
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
                    if let Some(record) = mesh_file.anchors.iter_mut().find(|a| {
                        a.path == *path && a.start_line == start_line && a.end_line == end_line
                    }) {
                        record.algorithm = algorithm;
                        record.content_hash = content_hash;
                    }
                    AddOutcomeKind::Resolved
                }
            } else {
                // Brand new anchor.
                mesh_file.anchors.push(AnchorRecord {
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

    // Write the updated mesh file.
    {
        let _perf = crate::perf::span("add.write-mesh-file");
        write_worktree_mesh(repo, mesh_root, &args.name, &mesh_file)?;
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
    write!(&mut summary, " to mesh `{}`.", args.name).unwrap();
    println!("{summary}");
    println!();

    // Per-anchor lines.
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

pub fn run_remove(repo: &gix::Repository, args: RemoveArgs, mesh_root: &str) -> Result<i32> {
    crate::validation::validate_mesh_name(&args.name)?;

    // Parse every address first; fail-closed with no partial state.
    let mut parsed: Vec<(String, AnchorExtent)> = Vec::with_capacity(args.anchors.len());
    {
        let _perf = crate::perf::span("remove.parse-anchors");
        for addr in &args.anchors {
            let p = parse_address(addr).ok_or_else(|| invalid_anchor_error("remove", addr))?;
            parsed.push(p);
        }
    }

    // Read the current worktree mesh file.
    let mut mesh_file = {
        let _perf = crate::perf::span("remove.read-current");
        read_worktree_mesh(repo, mesh_root, &args.name)?
    };

    let mut removed_addrs: Vec<String> = Vec::new();
    {
        let _perf = crate::perf::span("remove.remove-anchors");
        for (path, extent) in &parsed {
            let (start_line, end_line) = match extent {
                AnchorExtent::LineRange { start, end } => (*start, *end),
                AnchorExtent::WholeFile => (0, 0),
            };

            let before = mesh_file.anchors.len();
            mesh_file.anchors.retain(|a| {
                !(a.path == *path && a.start_line == start_line && a.end_line == end_line)
            });

            if mesh_file.anchors.len() == before {
                let addr = addr_from_extent(path, extent);
                return Err(CliError {
                    subcommand: "remove",
                    summary: format!("`{addr}` is not an anchor on `{}`.", args.name),
                    what_happened: format!(
                        "`{}` does not currently track that anchor, so there is nothing to remove.",
                        args.name,
                    ),
                    next_steps: vec![NextStep::Bash(format!("git mesh {}", args.name))],
                }
                .into());
            }

            removed_addrs.push(addr_from_extent(path, extent));
        }
    }

    // Write the updated mesh file.
    {
        let _perf = crate::perf::span("remove.write-mesh-file");
        write_worktree_mesh(repo, mesh_root, &args.name, &mesh_file)?;
    }

    // --- Output -----------------------------------------------------------
    let n = removed_addrs.len();
    println!(
        "Removed {n} anchor{} from mesh `{}`.",
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

pub fn run_why(repo: &gix::Repository, args: WhyArgs, mesh_root: &str) -> Result<i32> {
    // Reader vs. writer disambiguation:
    // any of `-m`/`-F`/`--edit` => writer; otherwise reader (which
    // optionally accepts `--at <commit>` for historical reads).
    let writer = args.m.is_some() || args.file.is_some() || args.edit;
    if !writer {
        let _perf = crate::perf::span("why.read");
        return run_why_reader(repo, &args.name, args.at.as_deref(), mesh_root);
    }
    if let Some(m) = args.m {
        let _perf = crate::perf::span("why.write-message");
        run_why_writer(repo, &args.name, &m, mesh_root)?;
        return print_why_written(&args.name);
    }
    if let Some(f) = args.file {
        let body = {
            let _perf = crate::perf::span("why.read-file");
            std::fs::read_to_string(&f).with_context(|| format!("failed to read {f}"))?
        };
        let _perf = crate::perf::span("why.write-message");
        run_why_writer(repo, &args.name, &body, mesh_root)?;
        return print_why_written(&args.name);
    }
    // Editor flow (--edit).
    run_why_editor(repo, &args.name, mesh_root)
}

fn print_why_written(name: &str) -> Result<i32> {
    println!("Set why on mesh `{name}`.{IDEMPOTENT_TAG}");
    Ok(0)
}

fn run_why_writer(repo: &gix::Repository, name: &str, body: &str, mesh_root: &str) -> Result<()> {
    let mut mesh_file = read_worktree_mesh(repo, mesh_root, name)?;
    mesh_file.why = body.to_string();
    write_worktree_mesh(repo, mesh_root, name, &mesh_file)?;
    Ok(())
}

fn run_why_reader(
    repo: &gix::Repository,
    name: &str,
    at: Option<&str>,
    mesh_root: &str,
) -> Result<i32> {
    crate::validation::validate_mesh_name(name)?;

    let mesh = if let Some(at_commit) = at {
        // Historical read: look up the mesh file in the tree at `at_commit`.
        let mesh_path = format!("{mesh_root}/{name}");
        let tree_result = crate::git::tree_entry_at(repo, at_commit, Path::new(&mesh_path))?;
        match tree_result {
            Some((_mode, oid)) => {
                let text = crate::git::read_git_text(repo, &oid.to_string())?;
                let mf = MeshFile::parse(&text).map_err(|e| {
                    if matches!(e, git_mesh_core::Error::MeshConflict(_)) {
                        CliError {
                            subcommand: "why",
                            summary: format!(
                                "mesh `{name}` at `{at_commit}` is in a Git conflict state."
                            ),
                            what_happened: format!(
                                "The mesh file for `{name}` at commit `{at_commit}` has \
                                 an unresolved merge (conflict markers). git-mesh refuses \
                                 to present conflict-marker content as valid mesh data."
                            ),
                            next_steps: vec![
                                NextStep::Prose(
                                    "The mesh file was corrupted during a merge. \
                                     Use a commit before the merge to recover the why text."
                                        .into(),
                                ),
                            ],
                        }
                    } else {
                        CliError {
                            subcommand: "why",
                            summary: format!(
                                "mesh `{name}` at `{at_commit}` could not be parsed."
                            ),
                            what_happened: e.to_string(),
                            next_steps: vec![
                                NextStep::Prose(
                                    "The historical mesh file is malformed. \
                                     Use a different commit to read the why text, \
                                     or inspect the mesh file directly with \
                                     `git show <commit>:.mesh/{name}`."
                                        .into(),
                                ),
                            ],
                        }
                    }
                })?;
                Some(mf)
            }
            None => None,
        }
    } else {
        // Current effective view: worktree overlays index overlays HEAD.
        let reader = MeshFileReader::new(repo, mesh_root.to_string());
        reader.read_effective(name)?
    };

    match mesh {
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

fn run_why_editor(repo: &gix::Repository, name: &str, mesh_root: &str) -> Result<i32> {
    let _perf = crate::perf::span("why.edit");
    crate::validation::validate_mesh_name(name)?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;

    // Read current why as the editor template.
    let template: String = {
        let path = workdir.join(mesh_root).join(name);
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            let mf = MeshFile::parse(&content)?;
            if mf.why.is_empty() {
                String::from("\n# Write the relationship description. Empty why aborts.\n")
            } else {
                mf.why
            }
        } else {
            String::from("\n# Write the relationship description. Empty why aborts.\n")
        }
    };

    let mesh_dir_path = workdir.join(mesh_root);
    std::fs::create_dir_all(&mesh_dir_path).with_context(|| {
        format!(
            "failed to create mesh directory `{}`",
            mesh_dir_path.display()
        )
    })?;

    let edit_path = mesh_dir_path.join(format!("{name}.EDITMSG"));
    std::fs::write(&edit_path, &template)?;

    let editor = std::env::var("GIT_EDITOR")
        .ok()
        .or_else(|| std::env::var("VISUAL").ok())
        .or_else(|| std::env::var("EDITOR").ok())
        .unwrap_or_else(|| "vi".to_string());

    let status = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("{editor} \"$@\"", editor = editor))
        .arg(&editor)
        .arg(&edit_path)
        .status()
        .with_context(|| format!("failed to spawn editor `{editor}`"))?;
    if !status.success() {
        return Err(CliError {
            subcommand: "why",
            summary: format!("editor `{editor}` exited with {status}."),
            what_happened: format!(
                "The editor `{editor}` exited with a non-zero status ({status}), \
                 so the why body was not set."
            ),
            next_steps: vec![NextStep::Bash(format!("git mesh why {name} --edit"))],
        }
        .into());
    }

    let raw = std::fs::read_to_string(&edit_path)?;
    let stripped = raw
        .lines()
        .filter(|l| !l.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");
    let body = stripped.trim_end().to_string();

    let _ = std::fs::remove_file(&edit_path);

    if body.is_empty() {
        return Err(CliError {
            subcommand: "why",
            summary: "aborting because the why is empty.".into(),
            what_happened:
                "The editor returned a body containing only whitespace and comment lines, \
                 so there is nothing to set."
                    .into(),
            next_steps: vec![NextStep::Bash(format!("git mesh why {name} --edit"))],
        }
        .into());
    }

    run_why_writer(repo, name, &body, mesh_root)?;
    print_why_written(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_file::AnchorRecord;

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
    fn write_worktree_mesh_is_atomic() {
        use std::os::unix::fs::MetadataExt;

        let (_dir, repo) = temp_repo();

        let mesh = MeshFile {
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
        write_worktree_mesh(&repo, ".mesh", "test/atomic", &mesh).unwrap();
        let path = mesh_file_path(&repo, ".mesh", "test/atomic").unwrap();
        assert!(path.exists(), "mesh file should exist after first write");

        let ino_before = std::fs::metadata(&path).unwrap().ino();

        // Second write: updates the same mesh with different content.
        let mesh2 = MeshFile {
            anchors: vec![AnchorRecord {
                path: "src/main.rs".into(),
                start_line: 5,
                end_line: 15,
                algorithm: "rk64".into(),
                content_hash: "bbbb".into(),
            }],
            why: "second write".into(),
        };
        write_worktree_mesh(&repo, ".mesh", "test/atomic", &mesh2).unwrap();

        let ino_after = std::fs::metadata(&path).unwrap().ino();

        // Atomic writes (temp + rename) replace the directory entry, giving
        // the file a new inode.  Non-atomic writes (std::fs::write) truncate
        // and overwrite in place, keeping the same inode.
        assert_ne!(
            ino_before, ino_after,
            "write_worktree_mesh must use atomic rename (inode changed), \
             but inode stayed the same — direct write detected"
        );
    }

    #[test]
    fn write_worktree_mesh_leaves_no_temp_file_after_rename() {
        let (_dir, repo) = temp_repo();

        let mesh = MeshFile {
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

        write_worktree_mesh(&repo, ".mesh", "test/atomic", &mesh).unwrap();
        let path = mesh_file_path(&repo, ".mesh", "test/atomic").unwrap();

        // The mesh file must exist and be complete.
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
            "temp file remained after write_worktree_mesh — rename must consume it"
        );

        // Read back through read_worktree_mesh to confirm round-trip.
        let read_back = read_worktree_mesh(&repo, ".mesh", "test/atomic").unwrap();
        assert_eq!(read_back.anchors.len(), 2);
        assert_eq!(read_back.why, "atomic write verification");
    }
}
