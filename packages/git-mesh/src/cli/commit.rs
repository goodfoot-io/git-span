//! Staging + commit handlers — §6.2, §6.3, §6.4, §10.5.
//!
//! Every function produces markdown-formatted prose output per the prose
//! specification in CARD.md. All errors use [`CliError`] with structured
//! remediation context.
//!
//! ## Migration status
//!
//! * **`run_add`**, **`run_remove`**, **`run_why`** — rewritten for Phase 3
//!   (file-backed mesh storage). These edit worktree mesh files directly.
//! * **`run_commit`**, **`run_config`** — retain the old ref-backed staging
//!   implementation as dead code. Will be removed in Group 4 (Phase 5).

use crate::cli::error::from_lib_error;
use crate::cli::format::{format_anchor_address, IDEMPOTENT_TAG};
use crate::cli::{AddArgs, CliError, CommitArgs, ConfigArgs, NextStep, RemoveArgs, WhyArgs};
use crate::git::resolve_ref_oid_optional_repo;
use crate::mesh_file::AnchorRecord;
use crate::mesh_file::MeshFile;
use crate::mesh_file_reader::MeshFileReader;
use crate::mesh_root::resolve_mesh_root;
use crate::staging::parse_address;
use crate::staging::StagedConfig;
use crate::types::{validate_add_target, AnchorExtent, CopyDetection, EngineOptions};
use crate::{append_config, commit_mesh, read_mesh};
use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
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

/// Resolve HEAD SHA and return the first 7 hex characters.
fn short_head_sha(repo: &gix::Repository) -> Option<String> {
    let id = crate::git::resolve_ref_oid_optional_repo(repo, "HEAD")
        .ok()
        .flatten()?;
    Some(id[..7].to_string())
}

/// Resolve the current catalog ref tip SHA.
fn current_mesh_tip_sha(repo: &gix::Repository, _name: &str) -> Option<String> {
    resolve_ref_oid_optional_repo(repo, crate::mesh::catalog::CATALOG_REF)
        .ok()
        .flatten()
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

/// Resolve the mesh root directory, reading from the CLI `--mesh-dir` flag,
/// the `GIT_MESH_DIR` environment variable, git config, or the default.
fn resolve_mesh_root_for(repo: &gix::Repository, mesh_dir: Option<&str>) -> Result<String> {
    let env_dir = std::env::var("GIT_MESH_DIR").ok();
    resolve_mesh_root(repo, mesh_dir, env_dir.as_deref())
        .map_err(|e| anyhow::anyhow!("{}", e))
}

/// Count lines in a byte slice.
fn count_lines(bytes: &[u8]) -> u32 {
    std::str::from_utf8(bytes)
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0)
}

/// Compute a SHA-256 content hash for the file at `path` with the given
/// `extent`.
///
/// When `anchor_oid` is `Some(commit_oid)`, the content is read from that
/// commit's tree. When `None`, the content is read from the worktree.
///
/// For line-range extents, validates that the range is within the file's
/// line count.
///
/// Returns `(algorithm, hex_hash)` where algorithm is `"sha256"`.
fn hash_anchor_content(
    repo: &gix::Repository,
    path: &str,
    extent: &AnchorExtent,
    anchor_oid: Option<&str>,
) -> Result<(String, String)> {
    let bytes = match anchor_oid {
        Some(commit_oid) => {
            let blob_oid = crate::git::path_blob_at(repo, commit_oid, path)
                .map_err(|e| {
                    anyhow::anyhow!("could not read `{path}` at commit `{commit_oid}`: {e}")
                })?;
            crate::git::read_blob_bytes(repo, &blob_oid)?
        }
        None => crate::git::read_worktree_bytes(repo, path)?,
    };

    // Validate line range extent against the actual content.
    if let AnchorExtent::LineRange { start, end } = extent {
        let line_count = count_lines(&bytes);
        if *start < 1 || *end < *start {
            anyhow::bail!("invalid anchor: start={start} end={end}");
        }
        if *end > line_count {
            anyhow::bail!(
                "invalid anchor: end={end} exceeds file line count ({line_count})"
            );
        }
        // Also verify that the content is valid UTF-8 (no binary content
        // for line anchors).
        if std::str::from_utf8(&bytes).is_err() {
            anyhow::bail!("line-anchor pin rejected on binary path: {path}");
        }
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    let hex: String = result.iter().map(|b| format!("{b:02x}")).collect();
    Ok(("sha256".to_string(), hex))
}

/// Build the absolute worktree path for a mesh file: `<workdir>/<mesh_root>/<name>`.
fn mesh_file_path(repo: &gix::Repository, mesh_root: &str, name: &str) -> Result<std::path::PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;
    Ok(workdir.join(mesh_root).join(name))
}

/// Read a mesh file from the worktree. Returns an empty `MeshFile` when the
/// file does not exist.
fn read_worktree_mesh(repo: &gix::Repository, mesh_root: &str, name: &str) -> Result<MeshFile> {
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

/// Write a mesh file to the worktree, creating parent directories as needed.
fn write_worktree_mesh(repo: &gix::Repository, mesh_root: &str, name: &str, mesh: &MeshFile) -> Result<()> {
    let path = mesh_file_path(repo, mesh_root, name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, mesh.serialize())?;
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

/// Acquire the staging lock with retries. Returns the lock file path and an
/// open handle. The lock is released by deleting the file after the handle is
/// closed.
///
/// Dead code in Phase 3 (file-backed storage). Retained until Group 4 removal.
#[allow(dead_code)]
fn acquire_staging_lock(repo: &gix::Repository) -> std::result::Result<(std::path::PathBuf, std::fs::File), CliError> {
    let lock_dir = crate::git::mesh_dir(repo).join("staging");
    std::fs::create_dir_all(&lock_dir).map_err(|e| CliError {
        subcommand: "add",
        summary: "could not access staging directory.".into(),
        what_happened: format!("{}", e),
        next_steps: vec![NextStep::Prose(
            "Check that `.git/mesh/staging` exists and is writable.".into(),
        )],
    })?;
    let lock_path = lock_dir.join("staging.lock");
    for _attempt in 0..3 {
        match std::fs::File::create_new(&lock_path) {
            Ok(lock) => return Ok((lock_path, lock)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                return Err(CliError {
                    subcommand: "add",
                    summary: "could not create staging lock.".into(),
                    what_happened: format!("{}", e),
                    next_steps: vec![NextStep::Prose(
                        "Check that `.git/mesh/staging` is writable.".into(),
                    )],
                });
            }
        }
    }
    Err(CliError {
        subcommand: "add",
        summary: "another `git mesh add` holds the staging lock.".into(),
        what_happened: "The staging lock at `.git/mesh/staging/staging.lock` could not be \
                         acquired after 3 attempts (50ms apart). This usually means another \
                         `git mesh add` is running concurrently."
            .into(),
        next_steps: vec![
            NextStep::Prose(
                "Wait for the other process to finish, then re-run the command. \
                 Do not parallelize `git mesh add` operations that share the same repository."
                    .into(),
            ),
        ],
    })
}

/// Release the staging lock by closing the handle and removing the lock file.
///
/// Dead code in Phase 3 (file-backed storage). Retained until Group 4 removal.
#[allow(dead_code)]
fn release_staging_lock(lock_path: std::path::PathBuf, _lock: std::fs::File) {
    drop(_lock);
    let _ = std::fs::remove_file(&lock_path);
}

pub fn run_add(repo: &gix::Repository, args: AddArgs, mesh_dir: Option<&str>) -> Result<i32> {
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

    // Resolve `--at <commit-ish>` to a full OID up front.
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

    // Stage-time precheck.
    {
        let _perf = crate::perf::span("add.validate-targets");
        for (path, extent) in &parsed {
            validate_add_target(repo, std::path::Path::new(path), extent).map_err(|err| {
                from_lib_error(
                    "add",
                    format!("anchor precheck failed for `{path}`."),
                    err,
                    vec![NextStep::Prose(
                        "Fix the path or choose a different extent.".into(),
                    )],
                )
            })?;
        }
    }

    // Resolve mesh root.
    let mesh_root = {
        let _perf = crate::perf::span("add.resolve-mesh-root");
        resolve_mesh_root_for(repo, mesh_dir)?
    };

    // Check for prefix collision against existing worktree mesh files
    // before any file I/O.  The filesystem would reject the read/write
    // with a cryptic OS error, so we surface a structured mesh error.
    check_worktree_prefix_collision(repo, &mesh_root, &args.name)
        .map_err(|e| CliError {
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
        read_worktree_mesh(repo, &mesh_root, &args.name)?
    };

    // Build a lookup of existing anchors: (path, start_line, end_line) -> content_hash.
    let existing: std::collections::HashMap<(String, u32, u32), String> = mesh_file
        .anchors
        .iter()
        .map(|a| ((a.path.clone(), a.start_line, a.end_line), a.content_hash.clone()))
        .collect();

    // Track per-anchor outcomes for the summary.
    struct AddOutcome {
        addr: String,
        kind: AddOutcomeKind,
    }
    enum AddOutcomeKind {
        Added,    // new anchor — record created
        Resolved, // existing anchor — hash changed, updated
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
        write_worktree_mesh(repo, &mesh_root, &args.name, &mesh_file)?;
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
    let head = short_head_sha(repo).unwrap_or_else(|| "unknown".into());

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
    write!(
        &mut summary,
        " to mesh `{}`, anchored at `HEAD` (`{head}`).",
        args.name
    )
    .unwrap();
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

pub fn run_remove(repo: &gix::Repository, args: RemoveArgs, mesh_dir: Option<&str>) -> Result<i32> {
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

    // Resolve mesh root.
    let mesh_root = {
        let _perf = crate::perf::span("remove.resolve-mesh-root");
        resolve_mesh_root_for(repo, mesh_dir)?
    };

    // Read the current worktree mesh file.
    let mut mesh_file = {
        let _perf = crate::perf::span("remove.read-current");
        read_worktree_mesh(repo, &mesh_root, &args.name)?
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
            mesh_file
                .anchors
                .retain(|a| !(a.path == *path && a.start_line == start_line && a.end_line == end_line));

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
        write_worktree_mesh(repo, &mesh_root, &args.name, &mesh_file)?;
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

pub fn run_why(repo: &gix::Repository, args: WhyArgs, mesh_dir: Option<&str>) -> Result<i32> {
    // Reader vs. writer disambiguation:
    // any of `-m`/`-F`/`--edit` => writer; otherwise reader (which
    // optionally accepts `--at <commit>` for historical reads).
    let writer = args.m.is_some() || args.file.is_some() || args.edit;
    if !writer {
        let _perf = crate::perf::span("why.read");
        return run_why_reader(repo, &args.name, args.at.as_deref(), mesh_dir);
    }
    if let Some(m) = args.m {
        let _perf = crate::perf::span("why.write-message");
        run_why_writer(repo, &args.name, &m, mesh_dir)?;
        return print_why_written(&args.name);
    }
    if let Some(f) = args.file {
        let body = {
            let _perf = crate::perf::span("why.read-file");
            std::fs::read_to_string(&f).with_context(|| format!("failed to read {f}"))?
        };
        let _perf = crate::perf::span("why.write-message");
        run_why_writer(repo, &args.name, &body, mesh_dir)?;
        return print_why_written(&args.name);
    }
    // Editor flow (--edit).
    run_why_editor(repo, &args.name, mesh_dir)
}

fn print_why_written(name: &str) -> Result<i32> {
    println!("Set why on mesh `{name}`.{IDEMPOTENT_TAG}");
    Ok(0)
}

fn run_why_writer(repo: &gix::Repository, name: &str, body: &str, mesh_dir: Option<&str>) -> Result<()> {
    let mesh_root = resolve_mesh_root_for(repo, mesh_dir)?;
    let mut mesh_file = read_worktree_mesh(repo, &mesh_root, name)?;
    mesh_file.why = body.to_string();
    write_worktree_mesh(repo, &mesh_root, name, &mesh_file)?;
    Ok(())
}

fn run_why_reader(
    repo: &gix::Repository,
    name: &str,
    at: Option<&str>,
    mesh_dir: Option<&str>,
) -> Result<i32> {
    crate::validation::validate_mesh_name(name)?;
    let mesh_root = resolve_mesh_root_for(repo, mesh_dir)?;

    let mesh = if let Some(at_commit) = at {
        // Historical read: look up the mesh file in the tree at `at_commit`.
        let mesh_path = format!("{mesh_root}/{name}");
        let tree_result = crate::git::tree_entry_at(repo, at_commit, Path::new(&mesh_path))?;
        match tree_result {
            Some((_mode, oid)) => {
                let text = crate::git::read_git_text(repo, &oid.to_string())?;
                MeshFile::parse(&text).ok()
            }
            None => None,
        }
    } else {
        // Current effective view: worktree overlays index overlays HEAD.
        let reader = MeshFileReader::new(repo, mesh_root);
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

fn run_why_editor(repo: &gix::Repository, name: &str, mesh_dir: Option<&str>) -> Result<i32> {
    let _perf = crate::perf::span("why.edit");
    let mesh_root = resolve_mesh_root_for(repo, mesh_dir)?;
    crate::validation::validate_mesh_name(name)?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("bare repository is not supported"))?;

    // Read current why as the editor template.
    let template: String = {
        let path = workdir.join(&mesh_root).join(name);
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

    let mesh_dir_path = workdir.join(&mesh_root);
    std::fs::create_dir_all(&mesh_dir_path)
        .with_context(|| format!("failed to create mesh directory `{}`", mesh_dir_path.display()))?;

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

    run_why_writer(repo, name, &body, mesh_dir)?;
    print_why_written(name)
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------
//
// Dead code in Phase 3 (file-backed storage). Retained until Group 4 removal.

#[allow(dead_code)]
pub fn run_commit(repo: &gix::Repository, args: CommitArgs) -> Result<i32> {
    if let Some(name) = args.name {
        return run_commit_single(repo, &name);
    }

    // No mesh name given: commit every mesh that has a non-empty staging
    // area or a modified .mesh/ worktree file (§10.2).
    let candidates: std::collections::BTreeSet<String> = {
        let _perf = crate::perf::span("commit.scan-staging");
        let staging_names: std::collections::BTreeSet<String> =
            crate::staging::list_staged_mesh_names(repo)?
                .into_iter()
                .collect();
        let file_names: std::collections::BTreeSet<String> =
            crate::mesh::read::list_mesh_names(repo)?
                .into_iter()
                .collect();
        staging_names.union(&file_names).cloned().collect()
    };

    let mut staged: Vec<String> = Vec::new();
    {
        let _perf = crate::perf::span("commit.read-staging");
        let catalog = crate::mesh::catalog::Catalog::load(repo)?;
        for name in candidates {
            let s = crate::staging::read_staging(repo, &name).unwrap_or_default();
            let has_staging = !s.adds.is_empty()
                || !s.removes.is_empty()
                || !s.configs.is_empty()
                || s.why.is_some();
            if has_staging {
                staged.push(name);
                continue;
            }
            // No staging — check if the .mesh/ file differs from the catalog.
            let mesh_root = ".mesh";
            if let Ok(mf) = read_worktree_mesh(repo, mesh_root, &name) {
                let mesh_file_changed = match catalog.lookup(&name)? {
                    Some(cat_mesh) => {
                        let w_mesh = crate::types::mesh_from_file(&name, &mf);
                        w_mesh != cat_mesh
                    }
                    None => !mf.anchors.is_empty() || !mf.why.is_empty(),
                };
                if mesh_file_changed {
                    staged.push(name);
                }
            }
        }
    }

    if staged.is_empty() {
        println!("Nothing is staged.");
        return Ok(0);
    }

    // Collect old tips before committing (parallel arrays).
    let total = staged.len();
    let mut commit_results: Vec<CommitMeshResult> = Vec::with_capacity(total);
    let mut failures: Vec<(String, String)> = Vec::new();

    for name in &staged {
        let old_sha = current_mesh_tip_sha(repo, name);
        match commit_mesh(repo, name) {
            Ok(new_sha) => {
                commit_results.push(CommitMeshResult {
                    name: name.clone(),
                    old_sha,
                    new_sha,
                });
            }
            Err(e) => {
                failures.push((name.clone(), e.to_string()));
            }
        }
    }

    let success_count = commit_results.len();
    let mut stdout_lines = String::new();

    if success_count > 0 {
        writeln!(
            stdout_lines,
            "Committed {success_count} of {total} staged meshes."
        )
        .unwrap();
        writeln!(stdout_lines).unwrap();

        for r in &commit_results {
            let short = &r.new_sha[..7.min(r.new_sha.len())];
            writeln!(
                stdout_lines,
                "- `{}` -- recorded: `{short}`.",
                r.name,
            )
            .unwrap();
        }
        if !failures.is_empty() {
            for (name, _msg) in &failures {
                writeln!(
                    stdout_lines,
                    "- `{name}` -- failed: see error below."
                )
                .unwrap();
            }
        }
        writeln!(stdout_lines).unwrap();
        // Follow-up: list commands for successful meshes.
        let verify_cmds: Vec<String> = commit_results
            .iter()
            .map(|r| format!("git mesh {}", r.name))
            .collect();
        if verify_cmds.len() == 1 {
            writeln!(stdout_lines, "Run `{}` to verify.", verify_cmds[0]).unwrap();
        } else if verify_cmds.len() <= 3 {
            writeln!(
                stdout_lines,
                "Run `{}` and `{}` to verify the recorded meshes.",
                verify_cmds[..verify_cmds.len() - 1].join("`, `"),
                verify_cmds.last().unwrap()
            )
            .unwrap();
        } else {
            writeln!(
                stdout_lines,
                "Run `{}` to verify the recorded meshes.",
                verify_cmds.join(" && ")
            )
            .unwrap();
        }
    }

    if failures.is_empty() {
        print!("{stdout_lines}");
        Ok(0)
    } else {
        print!("{stdout_lines}");
        Err(CliError {
            subcommand: "commit",
            summary: format!("{success_count} of {total} meshes committed."),
            what_happened: {
                let mut w = String::new();
                for (name, msg) in &failures {
                    writeln!(&mut w, "mesh `{name}`: {msg}").unwrap();
                }
                w
            },
            next_steps: if !commit_results.is_empty() {
                let cmds: Vec<String> = commit_results
                    .iter()
                    .map(|r| format!("git mesh {}", r.name))
                    .collect();
                vec![NextStep::Bash(cmds.join(" && "))]
            } else {
                vec![NextStep::Prose("Fix the error above and retry.".into())]
            },
        }
        .into())
    }
}

struct CommitMeshResult {
    name: String,
    #[allow(dead_code)]
    old_sha: Option<String>,
    new_sha: String,
}

#[allow(dead_code)]
fn run_commit_single(repo: &gix::Repository, name: &str) -> Result<i32> {
    // Check if there's anything staged for this mesh before committing.
    let staging = crate::staging::read_staging(repo, name).unwrap_or_default();
    let has_anything = !staging.adds.is_empty()
        || !staging.removes.is_empty()
        || !staging.configs.is_empty()
        || staging.why.is_some();

    if !has_anything {
        // Check if the mesh exists in the catalog OR as a worktree mesh file.
        let catalog = crate::mesh::catalog::Catalog::load(repo)?;
        let mesh_file_exists = repo
            .workdir()
            .map(|wd| {
                let p = wd.join(".mesh").join(name);
                p.exists()
            })
            .unwrap_or(false);
        if catalog.lookup(name)?.is_none() && !mesh_file_exists {
            return Err(CliError {
                subcommand: "commit",
                summary: format!("no mesh named `{name}`."),
                what_happened: format!(
                    "No catalog entry for `{name}` and no `.mesh/{name}` file."
                ),
                next_steps: vec![
                    NextStep::Bash("git mesh list".into()),
                    NextStep::Bash(format!("git mesh add {name} <path>#L<start>-L<end>")),
                    NextStep::Bash(format!("git mesh commit {name}")),
                ],
            }
            .into());
        }
    }

    let _old_sha = current_mesh_tip_sha(repo, name);
    match commit_mesh(repo, name) {
        Ok(new_sha) => {
            let short = &new_sha[..7.min(new_sha.len())];
            println!("Committed `{name}` ({short}).{}", IDEMPOTENT_TAG);
            println!();
            println!("Run `git mesh {name}` to verify.");
            Ok(0)
        }
        Err(e) => Err(from_lib_error(
            "commit",
            format!("mesh `{name}` failed to commit."),
            e,
            vec![
                NextStep::Bash(format!("git mesh status {name}")),
                NextStep::Bash(format!("git mesh why {name} -m \"...\"")),
            ],
        )
        .into()),
    }
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
//
// Dead code in Phase 3 (file-backed storage). Retained until Group 4 removal.

#[allow(dead_code)]
pub fn run_config(repo: &gix::Repository, args: ConfigArgs) -> Result<i32> {
    // Read mesh config.
    let mesh = {
        let _perf = crate::perf::span("config.read-mesh");
        read_mesh(repo, &args.name).map_err(|e| {
            from_lib_error(
                "config",
                format!("no mesh named `{}`.", args.name),
                e,
                vec![
                    NextStep::Bash("git mesh list".into()),
                    NextStep::Bash(format!("git mesh add {} <path>#L<start>-L<end>", args.name)),
                ],
            )
        })?
    };

    match (args.unset, args.key, args.value) {
        (Some(unset), _, _) => {
            let entry = match unset.as_str() {
                "copy-detection" => {
                    StagedConfig::CopyDetection(crate::types::DEFAULT_COPY_DETECTION)
                }
                "ignore-whitespace" => {
                    StagedConfig::IgnoreWhitespace(crate::types::DEFAULT_IGNORE_WHITESPACE)
                }
                "follow-moves" => StagedConfig::FollowMoves(crate::types::DEFAULT_FOLLOW_MOVES),
                other => {
                    return Err(CliError {
                        subcommand: "config",
                        summary: format!("`{other}` is not a config key."),
                        what_happened: "Known keys: `copy-detection`, `ignore-whitespace`, `follow-moves`.".into(),
                        next_steps: vec![NextStep::Bash(format!("git mesh config {}", args.name))],
                    }
                    .into());
                }
            };
            crate::staging::append_config(repo, &args.name, &entry)?;
            print_config_staged(&args.name, &unset, default_value_str(&unset))
        }
        (None, None, _) => {
            // Read all config keys.
            let staging = crate::staging::read_staging(repo, &args.name).unwrap_or_default();
            let (staged_cd, staged_iw, staged_fm) = crate::staging::resolve_staged_config(
                &staging,
                (
                    mesh.config.copy_detection,
                    mesh.config.ignore_whitespace,
                    mesh.config.follow_moves,
                ),
            );
            let cd_changed = staged_cd != mesh.config.copy_detection;
            let iw_changed = staged_iw != mesh.config.ignore_whitespace;
            let fm_changed = staged_fm != mesh.config.follow_moves;

            println!("Resolver options on `{}`:", args.name);
            println!();
            print_config_line(
                "copy-detection",
                cd_str(staged_cd),
                cd_changed,
                cd_str(mesh.config.copy_detection),
            );
            print_config_line(
                "ignore-whitespace",
                &staged_iw.to_string(),
                iw_changed,
                &mesh.config.ignore_whitespace.to_string(),
            );
            print_config_line(
                "follow-moves",
                &staged_fm.to_string(),
                fm_changed,
                &mesh.config.follow_moves.to_string(),
            );
            Ok(0)
        }
        (None, Some(key), None) => {
            match key.as_str() {
                "copy-detection" => {
                    println!(
                        "`copy-detection` is `{}` on `{}`.",
                        cd_str(mesh.config.copy_detection),
                        args.name
                    );
                }
                "ignore-whitespace" => {
                    println!(
                        "`ignore-whitespace` is `{}` on `{}`.",
                        mesh.config.ignore_whitespace, args.name
                    );
                }
                "follow-moves" => {
                    println!(
                        "`follow-moves` is `{}` on `{}`.",
                        mesh.config.follow_moves, args.name
                    );
                }
                other => {
                    return Err(CliError {
                        subcommand: "config",
                        summary: format!("`{other}` is not a config key."),
                        what_happened: "Known keys: `copy-detection`, `ignore-whitespace`, `follow-moves`.".into(),
                        next_steps: vec![NextStep::Bash(format!("git mesh config {}", args.name))],
                    }
                    .into());
                }
            }
            Ok(0)
        }
        (None, Some(key), Some(value)) => {
            let entry = match key.as_str() {
                "copy-detection" => StagedConfig::CopyDetection(match value.as_str() {
                    "off" => CopyDetection::Off,
                    "same-commit" => CopyDetection::SameCommit,
                    "any-file-in-commit" => CopyDetection::AnyFileInCommit,
                    "any-file-in-repo" => CopyDetection::AnyFileInRepo,
                    _ => {
                        return Err(CliError {
                            subcommand: "config",
                            summary: format!(
                                "`{value}` is not a valid value for `copy-detection`."
                            ),
                            what_happened: "`copy-detection` accepts `off`, `same-commit`, \
                                 `any-file-in-commit`, or `any-file-in-repo`.".into(),
                            next_steps: vec![
                                NextStep::Bash(format!(
                                    "git mesh config {} copy-detection same-commit",
                                    args.name
                                )),
                                NextStep::Bash(format!(
                                    "git mesh config {} --unset copy-detection",
                                    args.name
                                )),
                            ],
                        }
                        .into());
                    }
                }),
                "ignore-whitespace" => StagedConfig::IgnoreWhitespace(match value.as_str() {
                    "true" => true,
                    "false" => false,
                    _ => {
                        return Err(CliError {
                            subcommand: "config",
                            summary: format!(
                                "`{value}` is not a valid value for `ignore-whitespace`."
                            ),
                            what_happened: "`ignore-whitespace` accepts only `true` or `false`.".into(),
                            next_steps: vec![
                                NextStep::Bash(format!(
                                    "git mesh config {} ignore-whitespace true",
                                    args.name
                                )),
                                NextStep::Bash(format!(
                                    "git mesh config {} --unset ignore-whitespace",
                                    args.name
                                )),
                            ],
                        }
                        .into());
                    }
                }),
                "follow-moves" => StagedConfig::FollowMoves(match value.as_str() {
                    "true" => true,
                    "false" => false,
                    _ => {
                        return Err(CliError {
                            subcommand: "config",
                            summary: format!("`{value}` is not a valid value for `follow-moves`."),
                            what_happened: "`follow-moves` accepts only `true` or `false`.".into(),
                            next_steps: vec![
                                NextStep::Bash(format!(
                                    "git mesh config {} follow-moves true",
                                    args.name
                                )),
                                NextStep::Bash(format!(
                                    "git mesh config {} --unset follow-moves",
                                    args.name
                                )),
                            ],
                        }
                        .into());
                    }
                }),
                other => {
                    return Err(CliError {
                        subcommand: "config",
                        summary: format!("`{other}` is not a config key."),
                        what_happened: "Known keys: `copy-detection`, `ignore-whitespace`, `follow-moves`.".into(),
                        next_steps: vec![NextStep::Bash(format!("git mesh config {}", args.name))],
                    }
                    .into());
                }
            };
            append_config(repo, &args.name, &entry)?;
            print_config_staged(&args.name, &key, &value)
        }
    }
}

/// Print a single config value line, with staged-change annotation.
fn print_config_line(key: &str, value: &str, changed: bool, committed_value: &str) {
    if changed {
        println!("- `{key}` is `{committed_value}` (staged change to `{value}`).");
    } else {
        println!("- `{key}` is `{value}`.");
    }
}

/// Print the "staged config" success message.
fn print_config_staged(name: &str, key: &str, value: &str) -> Result<i32> {
    println!("Staged `{key} = {value}` on `{name}`.{IDEMPOTENT_TAG}");
    println!();
    println!("Run `git mesh commit {name}` to record it.");
    Ok(0)
}

fn cd_str(cd: CopyDetection) -> &'static str {
    match cd {
        CopyDetection::Off => "off",
        CopyDetection::SameCommit => "same-commit",
        CopyDetection::AnyFileInCommit => "any-file-in-commit",
        CopyDetection::AnyFileInRepo => "any-file-in-repo",
    }
}

fn default_value_str(key: &str) -> &'static str {
    match key {
        "copy-detection" => cd_str(crate::types::DEFAULT_COPY_DETECTION),
        "ignore-whitespace" => {
            if crate::types::DEFAULT_IGNORE_WHITESPACE {
                "true"
            } else {
                "false"
            }
        }
        "follow-moves" => {
            if crate::types::DEFAULT_FOLLOW_MOVES {
                "true"
            } else {
                "false"
            }
        }
        _ => "default",
    }
}

// ---------------------------------------------------------------------------
// Anchor-ID lookups (dead code, retained until Group 4).
// ---------------------------------------------------------------------------

#[allow(dead_code)]
fn mesh_range_id_lookup(
    repo: &gix::Repository,
    mesh_name: &str,
) -> std::collections::HashMap<(String, AnchorExtent), String> {
    let mut out = std::collections::HashMap::new();
    let Ok(mesh) = read_mesh(repo, mesh_name) else {
        return out;
    };
    for (id, r) in &mesh.anchors {
        out.insert((r.path.clone(), r.extent), id.clone());
    }
    out
}

#[allow(dead_code)]
fn mesh_current_range_id_lookup(
    repo: &gix::Repository,
    mesh_name: &str,
) -> std::collections::HashMap<(String, AnchorExtent), String> {
    let mut out = std::collections::HashMap::new();
    let Ok(resolved) = crate::resolver::resolve_mesh(repo, mesh_name, EngineOptions::full()) else {
        return out;
    };
    for r in resolved.anchors {
        let Some(current) = r.current else { continue };
        out.insert(
            (current.path.to_string_lossy().into_owned(), current.extent),
            r.anchor_id,
        );
    }
    out
}
