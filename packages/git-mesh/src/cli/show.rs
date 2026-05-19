//! `git mesh` list / `git mesh <name>` show / `git mesh list` — §10.4, §3.4.

use crate::cli::{CliError, ListArgs, NextStep, ShowArgs, parse_range_address};
use crate::cli::format;
use crate::types::{AnchorExtent, MeshConfig};
use serde::Serialize;
use crate::validation::validate_mesh_name_shape;
use crate::mesh::read::read_mesh_at_in;
use anyhow::Result;
use regex::RegexBuilder;
use std::collections::HashSet;
use std::io::{self, BufRead};

// ---------------------------------------------------------------------------
// Listing pipeline types and helpers
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AnchorEntry {
    path: String,
    extent: AnchorExtent,
}

#[derive(Clone)]
struct MeshListing {
    name: String,
    why: String,
    anchors: Vec<AnchorEntry>,
}

fn collect_listings(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<MeshListing>> {
    collect_listings_with_options(repo, mesh_root, true, true)
}

fn collect_listings_with_options(
    repo: &gix::Repository,
    mesh_root: &str,
    include_why: bool,
    _include_state: bool,
) -> Result<Vec<MeshListing>> {
    let mesh_pairs = crate::mesh::read::load_all_meshes_in(repo, mesh_root)?;
    let mut listings: Vec<MeshListing> = Vec::new();
    for (name, mesh) in mesh_pairs {
        let message = if include_why { mesh.message } else { String::new() };
        let anchors: Vec<AnchorEntry> = mesh
            .anchors
            .into_iter()
            .map(|(_id, r)| AnchorEntry { path: r.path, extent: r.extent })
            .collect();
        listings.push(MeshListing {
            name,
            why: message.trim_end_matches('\n').to_string(),
            anchors,
        });
    }
    Ok(listings)
}

fn collect_listings_for_names(
    repo: &gix::Repository,
    mesh_root: &str,
    names: &[String],
    include_why: bool,
    _include_state: bool,
) -> Result<Vec<MeshListing>> {
    let name_set: HashSet<&str> = names.iter().map(String::as_str).collect();
    let mut listings = Vec::with_capacity(names.len());
    for (name, mesh) in crate::mesh::read::load_all_meshes_in(repo, mesh_root)? {
        if !name_set.contains(name.as_str()) {
            continue;
        }
        let message = if include_why { mesh.message } else { String::new() };
        let anchors: Vec<AnchorEntry> = mesh
            .anchors
            .into_iter()
            .map(|(_id, r)| AnchorEntry { path: r.path, extent: r.extent })
            .collect();
        listings.push(MeshListing {
            name,
            why: message.trim_end_matches('\n').to_string(),
            anchors,
        });
    }
    Ok(listings)
}


fn collect_filtered_porcelain_listings_with_staging(
    repo: &gix::Repository,
    mesh_root: &str,
    target: &str,
    staged_listings: Option<&[MeshListing]>,
) -> Result<Vec<MeshListing>> {
    let (path, range) = if target.contains("#L") {
        let (path, start, end) = parse_range_address(target)?;
        (path, Some((start, end)))
    } else {
        (target.to_string(), None)
    };

    // File-backed model: scan every visible mesh file for an anchor
    // matching the requested (path, range) rather than consulting the
    // ref-backed path index.
    let _ = staged_listings;
    let mesh_pairs = {
        let _perf = crate::perf::span("list.path-filter-scan");
        crate::mesh::read::load_all_meshes_in(repo, mesh_root)?
    };
    let mut listings = Vec::with_capacity(mesh_pairs.len());
    for (name, mesh) in mesh_pairs {
        let anchors: Vec<AnchorEntry> = mesh
            .anchors
            .into_iter()
            .map(|(_id, anchor)| AnchorEntry {
                path: anchor.path,
                extent: anchor.extent,
            })
            .collect();
        if anchors
            .iter()
            .any(|anchor| anchor_matches(anchor, &path, range))
        {
            listings.push(MeshListing {
                name,
                why: mesh.message.trim_end_matches('\n').to_string(),
                anchors,
            });
        }
    }

    Ok(listings)
}

fn collect_staged_porcelain_listings(_repo: &gix::Repository) -> Result<Vec<MeshListing>> {
    // File-backed model: no staging area, so no staged-only listings.
    Ok(Vec::new())
}

fn anchor_matches(anchor: &AnchorEntry, path: &str, range: Option<(u32, u32)>) -> bool {
    if anchor.path != path {
        return false;
    }
    match (anchor.extent, range) {
        (_, None) => true,
        (AnchorExtent::WholeFile, Some(_)) => true,
        (AnchorExtent::LineRange { start, end }, Some((query_start, query_end))) => {
            start <= query_end && end >= query_start
        }
    }
}

fn apply_search(listings: &mut Vec<MeshListing>, re: &regex::Regex) {
    listings.retain(|l| {
        if re.is_match(&l.name) {
            return true;
        }
        for line in l.why.lines() {
            if re.is_match(line) {
                return true;
            }
        }
        for a in &l.anchors {
            if re.is_match(&a.path) {
                return true;
            }
            let addr = render_range_address(&a.path, a.extent);
            if re.is_match(&addr) {
                return true;
            }
        }
        false
    });
}

fn anchor_addr_plain(a: &AnchorEntry) -> String {
    match a.extent {
        AnchorExtent::LineRange { start, end } => format!("{}#L{start}-L{end}", a.path),
        AnchorExtent::WholeFile => a.path.clone(),
    }
}

fn render_list_block(listing: &MeshListing) {
    println!("## {}", listing.name);
    let mut bullets: Vec<String> = Vec::new();
    for a in &listing.anchors {
        bullets.push(format!("- {}", anchor_addr_plain(a)));
    }
    if bullets.is_empty() {
        println!("*Mesh has no anchors*");
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

fn render_blocks(page: &[MeshListing]) {
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

fn render_porcelain(page: &[MeshListing]) {
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

fn run_list_batch_porcelain(repo: &gix::Repository, mesh_root: &str) -> Result<i32> {
    let staged_listings = {
        let _perf = crate::perf::span("list.batch-read-staged-meshes");
        collect_staged_porcelain_listings(repo)?
    };
    // File-backed model: every query line scans the same mesh files, so
    // a mesh can match more than one query. Render each matched mesh's
    // anchors once across the whole batch (dedup by name). A query that
    // matches no mesh at all still prints the `no meshes` sentinel; a
    // query whose every match was already rendered prints nothing.
    let stdin = io::stdin();
    let mut seen: HashSet<String> = HashSet::new();
    for target in stdin.lock().lines() {
        let target = target?;
        let mut listings = collect_filtered_porcelain_listings_with_staging(
            repo,
            mesh_root,
            &target,
            Some(&staged_listings),
        )?;
        listings.sort_by(|a, b| a.name.cmp(&b.name));

        if listings.is_empty() {
            println!("no meshes");
        } else {
            let fresh: Vec<MeshListing> = listings
                .into_iter()
                .filter(|l| seen.insert(l.name.clone()))
                .collect();
            render_porcelain(&fresh);
        }
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// TOML output helpers for `git mesh show`
// ---------------------------------------------------------------------------

/// Serialization wrapper so `Vec<(String, Anchor)>` renders as a TOML
/// array of tables with `id` as a regular field rather than a tuple.
#[derive(Serialize)]
struct AnchorEntryToml {
    id: String,
    path: String,
    extent: AnchorExtent,
}

/// Top-level TOML shape for `git mesh show`. Omits the compatibility
/// `anchors` field (`Vec<String>`) and any live-resolution state.
#[derive(Serialize)]
struct MeshToml {
    name: String,
    message: String,
    anchors: Vec<AnchorEntryToml>,
    config: MeshConfig,
}

// ---------------------------------------------------------------------------
// Public run functions
// ---------------------------------------------------------------------------

pub fn run_show(repo: &gix::Repository, args: ShowArgs, mesh_root: &str) -> Result<i32> {
    let mesh = {
        let _perf = crate::perf::span("show.read-mesh");
        // Fail-closed: a mesh in a Git conflict state cannot be shown —
        // refuse explicitly rather than rendering conflict-marker text as
        // valid why/anchor data.
        let conflict_err = |name: &str| CliError {
            subcommand: "show",
            summary: format!("mesh `{name}` is in a Git conflict state."),
            what_happened: format!(
                "The mesh file for `{name}` has an unresolved merge \
                 (unmerged index entry or `<<<<<<<`/`>>>>>>>` markers). \
                 git-mesh refuses to present conflict-marker content as \
                 valid mesh data."
            ),
            next_steps: vec![
                NextStep::Bash(format!("git status {mesh_root}/{name}")),
                NextStep::Prose(
                    "Resolve the merge conflict in the mesh file, then retry."
                        .into(),
                ),
            ],
        };
        if args.at.is_none() {
            crate::mesh::read::read_mesh_in(repo, &args.name, mesh_root).map_err(|e| {
                if matches!(e, crate::Error::MeshConflict(_)) {
                    conflict_err(&args.name)
                } else if matches!(e, crate::Error::MeshNotFound(_)) {
                    CliError {
                        subcommand: "show",
                        summary: format!("no mesh named `{}`.", args.name),
                        what_happened: format!("{}", e),
                        next_steps: vec![NextStep::Bash("git mesh list".into())],
                    }
                } else {
                    // The mesh file exists but failed to parse (or another
                    // read error). Surface only the underlying error —
                    // a "not found" summary would be misleading for a
                    // mesh that exists. Matches what `list`/`stale` do.
                    CliError {
                        subcommand: "show",
                        summary: format!("{}", e),
                        what_happened: format!(
                            "The mesh file for `{}` could not be read.",
                            args.name
                        ),
                        next_steps: vec![NextStep::Bash(format!(
                            "git mesh doctor {}",
                            args.name
                        ))],
                    }
                }
            })?
        } else {
            read_mesh_at_in(repo, &args.name, args.at.as_deref(), mesh_root).map_err(|e| {
                if matches!(e, crate::Error::MeshConflict(_)) {
                    conflict_err(&args.name)
                } else if matches!(e, crate::Error::MeshNotFound(_)) {
                    CliError {
                        subcommand: "show",
                        summary: format!("no mesh named `{}`.", args.name),
                        what_happened: format!("{}", e),
                        next_steps: vec![NextStep::Bash("git mesh list".into())],
                    }
                } else {
                    // The mesh file exists but failed to parse (or another
                    // read error). Surface only the underlying error —
                    // a "not found" summary would be misleading for a
                    // mesh that exists. Matches what `list`/`stale` do.
                    CliError {
                        subcommand: "show",
                        summary: format!("{}", e),
                        what_happened: format!(
                            "The mesh file for `{}` could not be read.",
                            args.name
                        ),
                        next_steps: vec![NextStep::Bash(format!(
                            "git mesh doctor {}",
                            args.name
                        ))],
                    }
                }
            })?
        }
    };

    if args.oneline {
        let _perf = crate::perf::span("show.render-oneline");
        for (_id, r) in &mesh.anchors {
            match r.extent {
                AnchorExtent::LineRange { start, end } => {
                    println!("{}", format::format_anchor_address(&r.path, Some(start), Some(end)));
                }
                AnchorExtent::WholeFile => {
                    println!("{}", format::format_anchor_address(&r.path, None, None));
                }
            }
        }
        return Ok(0);
    }

    let _perf = crate::perf::span("show.render-default");

    let toml_output = MeshToml {
        name: mesh.name.clone(),
        message: mesh.message.trim_end_matches('\n').to_string(),
        anchors: mesh
            .anchors
            .iter()
            .map(|(id, a)| AnchorEntryToml {
                id: id.clone(),
                path: a.path.clone(),
                extent: a.extent,
            })
            .collect(),
        config: mesh.config,
    };

    let toml_str = toml::to_string_pretty(&toml_output)?;
    print!("{toml_str}");
    Ok(0)
}



pub fn run_list(repo: &gix::Repository, args: ListArgs, mesh_root: &str) -> Result<i32> {
    if args.batch {
        let _perf = crate::perf::span("list.batch-porcelain");
        return run_list_batch_porcelain(repo, mesh_root);
    }

    // Resolve targets to mesh names (or list all if no args).
    let resolved_names: Option<Vec<String>> = if args.targets.is_empty() {
        None
    } else {
        Some(resolve_targets(repo, mesh_root, &args.targets)?)
    };

    // Fail-closed: a mesh in a Git conflict state cannot be listed
    // reliably (`load_all_meshes_in` skips it rather than rendering
    // conflict-marker text). Refuse explicitly instead of silently
    // dropping it, so an unresolved merge is never reported as a clean
    // empty list.
    {
        let conflicted =
            crate::mesh::read::conflicted_mesh_names_in(repo, mesh_root)?;
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
                summary: format!("mesh `{joined}` is in a Git conflict state."),
                what_happened: format!(
                    "The mesh file(s) `{joined}` have an unresolved merge \
                     (unmerged index entry or `<<<<<<<`/`>>>>>>>` markers). \
                     git-mesh refuses to list conflict-marker content as \
                     valid mesh data."
                ),
                next_steps: vec![
                    NextStep::Bash(format!("git status {mesh_root}")),
                    NextStep::Prose(
                        "Resolve the merge conflict in the mesh file(s), then retry."
                            .into(),
                    ),
                ],
            }
            .into());
        }
    }

    let include_why = !args.porcelain || args.search.is_some();
    let include_state = !args.porcelain;
    let mut listings = {
        let _perf = crate::perf::span("list.collect");
        if let Some(ref names) = resolved_names {
            collect_listings_for_names(repo, mesh_root, names, include_why, include_state)?
        } else if include_why && include_state {
            collect_listings(repo, mesh_root)?
        } else {
            collect_listings_with_options(repo, mesh_root, include_why, include_state)?
        }
    };

    if let Some(ref pat) = args.search {
        let _perf = crate::perf::span("list.filter-search");
        match RegexBuilder::new(pat).case_insensitive(true).build() {
            Ok(re) => apply_search(&mut listings, &re),
            Err(err) => {
                return Err(CliError {
                    subcommand: "list",
                    summary: "`--search` regex is invalid.".into(),
                    what_happened: format!(
                        "The regex `{pat}` failed to compile: {err}"
                    ),
                    next_steps: vec![
                        NextStep::Prose(
                            "Try a simpler pattern or check for unescaped special characters."
                                .into(),
                        ),
                        NextStep::Bash(
                            "git mesh list --search \"pattern\"".into(),
                        ),
                    ],
                }
                .into());
            }
        }
    }

    let _perf = crate::perf::span("list.sort-page-render");
    listings.sort_by(|a, b| a.name.cmp(&b.name));

    let page: Vec<_> = listings
        .into_iter()
        .skip(args.offset)
        .take(args.limit.unwrap_or(usize::MAX))
        .collect();

    if page.is_empty() {
        println!("No meshes match the filters.");
        return Ok(0);
    }

    if args.oneline {
        let _perf = crate::perf::span("list.render-oneline");
        for listing in &page {
            for a in &listing.anchors {
                let addr = match a.extent {
                    AnchorExtent::LineRange { start, end } => {
                        format::format_anchor_address(&a.path, Some(start), Some(end))
                    }
                    AnchorExtent::WholeFile => {
                        format::format_anchor_address(&a.path, None, None)
                    }
                };
                println!("`{}` `{}`", listing.name, addr);
            }
        }
    } else if args.porcelain {
        render_porcelain(&page);
    } else {
        render_blocks(&page);
    }

    Ok(0)
}

fn render_range_address(path: &str, extent: AnchorExtent) -> String {
    match extent {
        AnchorExtent::LineRange { start, end } => format!("{path}#L{start}-L{end}"),
        AnchorExtent::WholeFile => format!("{path}  (whole)"),
    }
}

// ---------------------------------------------------------------------------
// Multi-target resolver
// ---------------------------------------------------------------------------

/// Resolve positional args to a deduplicated set of mesh names.
///
/// Two-step dispatch per arg:
///   - `#L` range → `parse_range_address` + `matching_mesh_names` with range
///   - `/` present → `matching_mesh_names` without range (skip mesh-name check)
///   - bare arg → check the effective mesh file `<mesh-root>/<arg>`;
///     if it exists, use as mesh name, else fall through to
///     `matching_mesh_names` without range
///
/// Zero-match args produce stderr diagnostics and an error.  Empty args return
/// an empty vector immediately.
pub(crate) fn resolve_targets(
    repo: &gix::Repository,
    mesh_root: &str,
    args: &[String],
) -> Result<Vec<String>> {
    if args.is_empty() {
        return Ok(Vec::new());
    }

    let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());
    let mut result: HashSet<String> = HashSet::new();
    let mut missing_args: Vec<&str> = Vec::new();

    // Resolve each arg. Rule: a zero-match against the mesh set is fine on
    // its own — exit 0 silently. We only error when the arg names something
    // that doesn't exist: a missing file, a missing mesh name, or a glob the
    // shell left literal because it matched nothing.
    for arg in args {
        if arg.contains("#L") {
            // Range address: parse path and range, scan mesh files.
            let (path, start, end) = parse_range_address(arg)?;
            let names = crate::mesh::read::meshes_matching_path_in(
                repo,
                &path,
                Some((start, end)),
                mesh_root,
            )?;
            if !names.is_empty() {
                result.extend(names);
            } else if !file_exists_in_workdir(repo, std::path::Path::new(&path)) {
                missing_args.push(arg);
            }
        } else if validate_mesh_name_shape(arg).is_ok() {
            // Mesh-name shape (bare slug or hierarchical): try the
            // file-backed effective view, then a path-index scan, then a
            // worktree existence check.
            if reader.read_effective(arg)?.is_some() {
                result.insert(arg.clone());
            } else {
                let names =
                    crate::mesh::read::meshes_matching_path_in(repo, arg, None, mesh_root)?;
                if !names.is_empty() {
                    result.extend(names);
                } else if !file_exists_in_workdir(repo, std::path::Path::new(arg)) {
                    missing_args.push(arg);
                }
            }
        } else if crate::mesh::read::is_glob_pattern(arg) {
            let names = crate::mesh::read::matching_mesh_names_glob_in(repo, arg, None, mesh_root)?;
            if !names.is_empty() {
                result.extend(names);
            } else {
                missing_args.push(arg);
            }
        } else {
            // Not mesh-name shape (path with extension): scan mesh files
            // for an anchor on this path.
            let names = crate::mesh::read::meshes_matching_path_in(repo, arg, None, mesh_root)?;
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
            summary: format!("`{all}` did not match any mesh, file, or path."),
            what_happened: format!(
                "The following arguments did not match a mesh name, a file path, \
                 or a path-index entry: `{all}`. Git-mesh resolves positional \
                 arguments as mesh names, file paths, or globs."
            ),
            next_steps: vec![
                NextStep::Prose("Check the spelling or list available meshes.".into()),
                NextStep::Bash("git mesh list".into()),
            ],
        }.into());
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
    // resolve_targets helpers and tests
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


    /// Write and commit a mesh file under `.mesh/<name>` so the
    /// file-backed `MeshFileReader` HEAD layer resolves it.
    fn create_mesh_ref(repo: &gix::Repository, name: &str) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        let mesh_path = workdir.join(".mesh").join(name);
        std::fs::create_dir_all(mesh_path.parent().unwrap()).unwrap();
        // A mesh with no anchors and no why serializes to empty; write a
        // single-line why so the file is non-empty and parses back.
        let mf = crate::mesh_file::MeshFile {
            anchors: Vec::new(),
            why: format!("mesh {name}"),
        };
        std::fs::write(&mesh_path, mf.serialize()).unwrap();
        run_git(&workdir, &["add", "-A"]);
        run_git(&workdir, &["commit", "-m", &format!("test: create mesh {name}")]);
    }

    /// File-backed model: a mesh that anchors `path#Lstart-Lend` is a
    /// tracked file under `.mesh/`. Write and commit it so the
    /// file-scanning path resolver (`meshes_matching_path`) finds it.
    fn create_path_index_entry(
        repo: &gix::Repository,
        mesh_name: &str,
        path: &str,
        start: u32,
        end: u32,
    ) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        let mesh_path = workdir.join(".mesh").join(mesh_name);
        std::fs::create_dir_all(mesh_path.parent().unwrap()).unwrap();
        let mf = crate::mesh_file::MeshFile {
            anchors: vec![crate::mesh_file::AnchorRecord {
                path: path.to_string(),
                start_line: start,
                end_line: end,
                algorithm: "sha256".to_string(),
                content_hash: "0".repeat(64),
            }],
            why: format!("mesh {mesh_name}"),
        };
        std::fs::write(&mesh_path, mf.serialize()).unwrap();
        run_git(&workdir, &["add", "-A"]);
        run_git(
            &workdir,
            &["commit", "-m", &format!("test: create mesh {mesh_name}")],
        );
    }

    #[test]
    fn resolve_targets_finds_mesh_by_name() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "my-mesh");
        let result = resolve_targets(&repo, ".mesh", &["my-mesh".to_string()]).unwrap();
        assert_eq!(result, vec!["my-mesh"]);
    }

    #[test]
    fn resolve_targets_path_index_lookup() {
        let (_td, repo) = seed_repo();
        create_path_index_entry(&repo, "mesh-a", "a.txt", 1, 5);
        let result = resolve_targets(&repo, ".mesh", &["a.txt".to_string()]).unwrap();
        assert_eq!(result, vec!["mesh-a"]);
    }

    #[test]
    fn resolve_targets_hash_l_range() {
        let (_td, repo) = seed_repo();
        create_path_index_entry(&repo, "mesh-a", "a.txt", 1, 10);
        let result =
            resolve_targets(&repo, ".mesh", &["a.txt#L1-L5".to_string()]).unwrap();
        assert_eq!(result, vec!["mesh-a"]);
    }

    #[test]
    fn resolve_targets_non_mesh_name_shape_goes_to_path_index() {
        // src/lib.rs contains `.rs` which fails mesh-name shape validation,
        // so it must go straight to path index even though it contains `/`.
        let (_td, repo) = seed_repo();
        create_path_index_entry(&repo, "mesh-from-path", "src/lib.rs", 1, 10);
        let result =
            resolve_targets(&repo, ".mesh", &["src/lib.rs".to_string()]).unwrap();
        assert_eq!(result, vec!["mesh-from-path"]);
    }

    #[test]
    fn resolve_targets_hierarchical_name_falls_through_when_no_mesh() {
        let (_td, repo) = seed_repo();
        // "category/slug" matches mesh-name shape but no mesh ref or
        // staging entry exists. Must fall through to path index.
        create_path_index_entry(&repo, "some-mesh", "category/slug", 1, 5);
        let result =
            resolve_targets(&repo, ".mesh", &["category/slug".to_string()]).unwrap();
        assert_eq!(result, vec!["some-mesh"]);
    }

    #[test]
    fn resolve_targets_deduplicates_across_args() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "mesh-a");
        create_path_index_entry(&repo, "mesh-a", "a.txt", 1, 5);
        let result = resolve_targets(
            &repo,
            ".mesh",
            &["mesh-a".to_string(), "a.txt".to_string()],
        )
        .unwrap();
        assert_eq!(result, vec!["mesh-a"]);
    }

    #[test]
    fn resolve_targets_zero_match_errors() {
        let (_td, repo) = seed_repo();
        let err = resolve_targets(&repo, ".mesh", &["nonexistent".to_string()])
            .unwrap_err();
        assert!(!err.to_string().is_empty());
    }

    #[test]
    fn resolve_targets_empty_args_returns_empty_vec() {
        let (_td, repo) = seed_repo();
        let result: Vec<String> = resolve_targets(&repo, ".mesh", &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn resolve_targets_mixed_mesh_names_and_paths() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "mesh-a");
        create_path_index_entry(&repo, "mesh-b", "a.txt", 1, 5);
        let result = resolve_targets(
            &repo,
            ".mesh",
            &["mesh-a".to_string(), "a.txt".to_string()],
        )
        .unwrap();
        let mut sorted = result.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["mesh-a", "mesh-b"]);
    }

    #[test]
    fn resolve_targets_committed_mesh_resolves_once() {
        // A committed mesh resolves to its name exactly once.
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "dual-mesh");
        let result = resolve_targets(&repo, ".mesh", &["dual-mesh".to_string()]).unwrap();
        assert_eq!(result, vec!["dual-mesh"]);
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
            batch: false,
            search: None,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".mesh").unwrap();
        assert_eq!(exit_code, 0);
    }

    #[test]
    fn run_list_mesh_name_arg_returns_ok() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "my-mesh");
        let args = ListArgs {
            targets: vec!["my-mesh".to_string()],
            porcelain: false,
            batch: false,
            search: None,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".mesh").unwrap();
        assert_eq!(exit_code, 0);
    }

    #[test]
    fn run_list_zero_match_errors_with_cli_error() {
        let (_td, repo) = seed_repo();
        let args = ListArgs {
            targets: vec!["nonexistent".to_string()],
            porcelain: false,
            batch: false,
            search: None,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let err = run_list(&repo, args, ".mesh").unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("nonexistent"), "{msg}");
        assert!(msg.contains("did not match"), "{msg}");
    }

    #[test]
    fn resolve_targets_works_after_rename() {
        // File-backed model: meshes are tracked files. Renaming a mesh
        // is renaming its file under `.mesh/`; the file-scanning path
        // resolver must then find the anchor under the new name.
        let (_td, repo) = seed_repo();
        create_path_index_entry(&repo, "alpha", "a.txt", 1, 5);

        let workdir = repo.workdir().unwrap().to_path_buf();
        let mesh_dir = workdir.join(".mesh");
        std::fs::rename(mesh_dir.join("alpha"), mesh_dir.join("renamed")).unwrap();
        run_git(&workdir, &["add", "-A"]);
        run_git(&workdir, &["commit", "-m", "test: rename alpha -> renamed"]);

        let result = resolve_targets(&repo, ".mesh", &["a.txt#L3-L4".to_string()]).unwrap();
        assert_eq!(result, vec!["renamed"]);
    }

    #[test]
    fn run_list_multiple_mesh_names() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "mesh-a");
        create_mesh_ref(&repo, "mesh-b");
        let args = ListArgs {
            targets: vec!["mesh-a".to_string(), "mesh-b".to_string()],
            porcelain: false,
            batch: false,
            search: None,
            offset: 0,
            limit: None,
            oneline: false,
        };
        let exit_code = run_list(&repo, args, ".mesh").unwrap();
        assert_eq!(exit_code, 0);
    }

    // --- hierarchical mesh name reproduction tests ---

    #[test]
    fn resolve_targets_hierarchical_name_resolves_to_mesh() {
        let (_td, repo) = seed_repo();
        create_mesh_ref(&repo, "billing/payments/checkout");
        let result =
            resolve_targets(&repo, ".mesh", &["billing/payments/checkout".to_string()]).unwrap();
        assert_eq!(result, vec!["billing/payments/checkout"]);
    }

}
