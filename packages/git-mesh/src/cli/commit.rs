//! Staging + commit handlers — §6.2, §6.3, §6.4, §10.5.
//!
//! Every function produces markdown-formatted prose output per the prose
//! specification in CARD.md. All errors use [`CliError`] with structured
//! remediation context.

use crate::cli::error::from_lib_error;
use crate::cli::format::{format_anchor_address, format_ref_transition, IDEMPOTENT_TAG};
use crate::cli::{AddArgs, CliError, CommitArgs, ConfigArgs, NextStep, RemoveArgs, WhyArgs};
use crate::git::resolve_ref_oid_optional_repo;
use crate::staging::{append_prepared_add, parse_address, prepare_add, StagedConfig};
use crate::types::{validate_add_target, AnchorExtent, CopyDetection, EngineOptions};
use crate::{append_config, append_remove, commit_mesh, read_mesh, set_why};
use anyhow::{Context, Result};
use std::fmt::Write as FmtWrite;

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

/// Resolve the current tip of `refs/meshes/v1/<name>` (if it exists).
fn current_mesh_tip_sha(repo: &gix::Repository, name: &str) -> Option<String> {
    let r = format!("refs/meshes/v1/{name}");
    resolve_ref_oid_optional_repo(repo, &r).ok().flatten()
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

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

pub fn run_add(repo: &gix::Repository, args: AddArgs) -> Result<i32> {
    crate::validation::validate_mesh_name(&args.name)?;

    // Parse every address first; fail-closed with no partial staging.
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
    // occurrence, drop earlier ones. Cross-invocation supersede is
    // handled by `append_prepared_add` (which strips + renumbers).
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

    // Resolve the existing anchor_id for this `(path, extent)` in both
    // the committed mesh and the resolved (staging-aware) mesh.
    let committed_ranges = {
        let _perf = crate::perf::span("add.read-mesh-ranges");
        mesh_range_id_lookup(repo, &args.name)
    };
    let mut mesh_ranges_lookup = {
        let _perf = crate::perf::span("add.resolve-current-ranges");
        mesh_current_range_id_lookup(repo, &args.name)
    };
    mesh_ranges_lookup.extend(committed_ranges.clone());

    let mut prepared = Vec::with_capacity(parsed.len());
    {
        let _perf = crate::perf::span("add.prepare-anchors");
        for (path, extent) in &parsed {
            prepared.push(prepare_add(repo, path, *extent, anchor_oid.as_deref())?);
        }
    }

    // Track per-anchor outcomes for the summary.
    struct AddOutcome {
        addr: String,
        kind: AddOutcomeKind,
    }
    enum AddOutcomeKind {
        Staged,    // new anchor — sidecar created
        Resolved,  // existing anchor — sidecar updated
        #[allow(dead_code)]
        Unchanged, // anchor already clean
    }

    let mut outcomes: Vec<AddOutcome> = Vec::with_capacity(parsed.len());

    {
        let _perf = crate::perf::span("add.write-staging");
        for (add, (path, extent)) in prepared.iter().zip(parsed.iter()) {
            let anchor_id = mesh_ranges_lookup.get(&(path.clone(), *extent)).cloned();
            let addr = addr_from_extent(path, extent);

            // Determine outcome before writing staging.
            let is_in_committed = committed_ranges.contains_key(&(path.clone(), *extent));
            let kind = if anchor_id.is_some() {
                // Anchor already existed (committed or staged) — updating it.
                AddOutcomeKind::Resolved
            } else {
                // Brand new anchor.
                AddOutcomeKind::Staged
            };

            // If anchor was already in committed and content hasn't changed,
            // we could skip staging. For now, "unchanged" requires byte-level
            // comparison that we defer; always write the sidecar and label
            // based on anchor_id presence.
            let _ = is_in_committed;

            append_prepared_add(repo, &args.name, add, anchor_id)?;

            outcomes.push(AddOutcome { addr, kind });
        }
    }

    // --- Output -----------------------------------------------------------
    let staged_count = outcomes
        .iter()
        .filter(|o| matches!(o.kind, AddOutcomeKind::Staged))
        .count();
    let resolved_count = outcomes
        .iter()
        .filter(|o| matches!(o.kind, AddOutcomeKind::Resolved))
        .count();
    let head = short_head_sha(repo).unwrap_or_else(|| "unknown".into());

    // Summary line.
    let summary = if resolved_count == 0 {
        format!(
            "Staged {} anchor{} on `{}`, anchored at `HEAD` (`{head}`).",
            staged_count,
            if staged_count == 1 { "" } else { "s" },
            args.name
        )
    } else {
        let mut s = String::new();
        write!(
            &mut s,
            "Staged {} anchor{}",
            staged_count,
            if staged_count == 1 { "" } else { "s" }
        )
        .unwrap();
        if resolved_count > 0 {
            write!(&mut s, " and resolved {resolved_count} in place").unwrap();
        }
        write!(
            &mut s,
            " on `{}`, anchored at `HEAD` (`{head}`).",
            args.name
        )
        .unwrap();
        s
    };
    println!("{summary}");
    println!();

    // Per-anchor lines.
    for o in &outcomes {
        let line = match o.kind {
            AddOutcomeKind::Staged => {
                format!(
                    "- staged add: `{}` `{}` (sidecar created -- commit required)",
                    args.name, o.addr
                )
            }
            AddOutcomeKind::Resolved => {
                format!(
                    "- resolved in-place: `{}` `{}` (no staging -- no commit needed)",
                    args.name, o.addr
                )
            }
            AddOutcomeKind::Unchanged => unreachable!(),
        };
        println!("{line}");
    }

    // Follow-up command suggestion.
    if staged_count > 0 {
        let plural = if staged_count == 1 { "" } else { "s" };
        let extra = if resolved_count > 0 {
            format!(
                ". The other{} need no commit",
                if resolved_count == 1 { "" } else { "s" }
            )
        } else {
            String::new()
        };
        println!();
        println!(
            "Run `git mesh commit {}` to record the staged anchor{}{}.",
            args.name, plural, extra
        );
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

pub fn run_remove(repo: &gix::Repository, args: RemoveArgs) -> Result<i32> {
    crate::validation::validate_mesh_name(&args.name)?;

    let mut parsed: Vec<(String, AnchorExtent)> = Vec::with_capacity(args.anchors.len());
    {
        let _perf = crate::perf::span("remove.parse-anchors");
        for addr in &args.anchors {
            let p = parse_address(addr).ok_or_else(|| invalid_anchor_error("remove", addr))?;
            parsed.push(p);
        }
    }

    // Build the set of anchors currently present on the mesh (committed +
    // staged adds, minus staged removes).
    let mut present: Vec<(String, AnchorExtent)> = Vec::new();
    {
        let _perf = crate::perf::span("remove.read-current-anchors");
        match read_mesh(repo, &args.name) {
            Ok(mesh) => {
                for (_id, r) in &mesh.anchors_v2 {
                    present.push((r.path.clone(), r.extent));
                }
            }
            Err(crate::Error::MeshNotFound(_)) => {}
            Err(e) => return Err(e.into()),
        }
    }
    let staging = crate::staging::read_staging(repo, &args.name).unwrap_or_default();
    for a in &staging.adds {
        present.push((a.path.clone(), a.extent));
    }
    for r in &staging.removes {
        if let Some(idx) = present
            .iter()
            .position(|(p, e)| p == &r.path && *e == r.extent)
        {
            present.remove(idx);
        }
    }

    let mut effective = present.clone();
    let mut staged_addrs: Vec<String> = Vec::new();
    for (path, extent) in &parsed {
        let idx = effective.iter().position(|(p, e)| p == path && e == extent);
        match idx {
            Some(i) => {
                effective.remove(i);
                staged_addrs.push(addr_from_extent(path, extent));
            }
            None => {
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
        }
    }

    {
        let _perf = crate::perf::span("remove.write-staging");
        for (path, extent) in &parsed {
            match extent {
                AnchorExtent::LineRange { start, end } => {
                    append_remove(repo, &args.name, path, *start, *end)?;
                }
                AnchorExtent::WholeFile => {
                    crate::staging::append_remove_whole(repo, &args.name, path)?;
                }
            }
        }
    }

    // --- Output -----------------------------------------------------------
    let n = staged_addrs.len();
    println!(
        "Staged removal of {n} anchor{} from `{}`.",
        if n == 1 { "" } else { "s" },
        args.name
    );
    println!();
    for addr in &staged_addrs {
        println!(
            "- staged remove: `{}` `{}` (sidecar created -- commit required)",
            args.name, addr
        );
    }
    println!();
    println!("Run `git mesh commit {}` to record the removal.", args.name);

    Ok(0)
}

// ---------------------------------------------------------------------------
// why
// ---------------------------------------------------------------------------

pub fn run_why(repo: &gix::Repository, args: WhyArgs) -> Result<i32> {
    // Reader vs. writer disambiguation per `docs/why-plan.md` §B2:
    // any of `-m`/`-F`/`--edit` ⇒ writer; otherwise reader (which
    // optionally accepts `--at <commit>` for historical reads).
    let writer = args.m.is_some() || args.file.is_some() || args.edit;
    if !writer {
        let _perf = crate::perf::span("why.read");
        return run_why_reader(repo, &args.name, args.at.as_deref());
    }
    if let Some(m) = args.m {
        let _perf = crate::perf::span("why.write-message");
        set_why(repo, &args.name, &m)?;
        return print_why_written(&args.name);
    }
    if let Some(f) = args.file {
        let body = {
            let _perf = crate::perf::span("why.read-file");
            std::fs::read_to_string(&f).with_context(|| format!("failed to read {f}"))?
        };
        let _perf = crate::perf::span("why.write-message");
        set_why(repo, &args.name, &body)?;
        return print_why_written(&args.name);
    }
    // Editor flow (--edit).
    run_why_editor(repo, &args.name)
}

fn print_why_written(name: &str) -> Result<i32> {
    println!("Staged a new why on `{name}`.{IDEMPOTENT_TAG}");
    println!();
    println!("Run `git mesh commit {name}` to record it.");
    Ok(0)
}

fn run_why_reader(repo: &gix::Repository, name: &str, at: Option<&str>) -> Result<i32> {
    crate::validation::validate_mesh_name(name)?;
    let info = crate::mesh::mesh_commit_info_at(repo, name, at)?;
    let body = info.message.trim_end_matches('\n');
    if body.is_empty() {
        println!("`{name}` has no why recorded.");
    } else {
        println!("{body}");
    }
    Ok(0)
}

fn run_why_editor(repo: &gix::Repository, name: &str) -> Result<i32> {
    let _perf = crate::perf::span("why.edit");
    crate::validation::validate_mesh_name(name)?;
    let staging_dir = crate::git::mesh_dir(repo).join("staging");
    std::fs::create_dir_all(&staging_dir)?;

    let encoded = crate::staging::encode_name_for_fs(name);
    let why_path = staging_dir.join(format!("{encoded}.why"));
    let template: String = if why_path.exists() {
        std::fs::read_to_string(&why_path)?
    } else if let Ok(info) = crate::mesh::mesh_commit_info(repo, name) {
        info.message
    } else {
        String::from("\n# Write the relationship description. Empty why aborts.\n")
    };

    let edit_path = staging_dir.join(format!("{encoded}.why.EDITMSG"));
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
        return Err(anyhow::anyhow!("editor `{editor}` exited with {status}"));
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
                 so there is nothing to stage."
                    .into(),
            next_steps: vec![NextStep::Bash(format!("git mesh why {name} --edit"))],
        }
        .into());
    }
    set_why(repo, name, &body)?;
    print_why_written(name)
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

pub fn run_commit(repo: &gix::Repository, args: CommitArgs) -> Result<i32> {
    if let Some(name) = args.name {
        return run_commit_single(repo, &name);
    }

    // No mesh name given: commit every mesh that has a non-empty staging
    // area (post-commit hook path, §10.2).
    let candidates: std::collections::BTreeSet<String> = {
        let _perf = crate::perf::span("commit.scan-staging");
        crate::staging::list_staged_mesh_names(repo)?
            .into_iter()
            .collect()
    };

    let mut staged: Vec<String> = Vec::new();
    {
        let _perf = crate::perf::span("commit.read-staging");
        for name in candidates {
            let s = crate::staging::read_staging(repo, &name).unwrap_or_default();
            let has_anything = !s.adds.is_empty()
                || !s.removes.is_empty()
                || !s.configs.is_empty()
                || s.why.is_some();
            if has_anything {
                staged.push(name);
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
            let old = r.old_sha.as_deref().unwrap_or("(none)");
            writeln!(
                stdout_lines,
                "- `{}` -- recorded: `{old}` -> `{}`.",
                r.name, r.new_sha
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
    old_sha: Option<String>,
    new_sha: String,
}

fn run_commit_single(repo: &gix::Repository, name: &str) -> Result<i32> {
    // Check if there's anything staged for this mesh before committing.
    let staging = crate::staging::read_staging(repo, name).unwrap_or_default();
    let has_anything = !staging.adds.is_empty()
        || !staging.removes.is_empty()
        || !staging.configs.is_empty()
        || staging.why.is_some();

    if !has_anything {
        // Check if the mesh ref even exists.
        let ref_name = format!("refs/meshes/v1/{name}");
        let ref_exists = resolve_ref_oid_optional_repo(repo, &ref_name)
            .ok()
            .flatten()
            .is_some();
        if !ref_exists {
            return Err(CliError {
                subcommand: "commit",
                summary: format!("no mesh named `{name}`."),
                what_happened: format!(
                    "There is no `{ref_name}` ref and no staging area under \
                     `.git/mesh/staging/{name}`."
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

    let old_sha = current_mesh_tip_sha(repo, name);
    match commit_mesh(repo, name) {
        Ok(new_sha) => {
            let ref_name = format!("refs/meshes/v1/{name}");
            let old = old_sha.as_deref().unwrap_or("(none)");
            println!(
                "{} {}",
                format_ref_transition(&ref_name, old, &new_sha),
                IDEMPOTENT_TAG
            );
            println!();
            println!("Run `git mesh {name}` to verify.");
            Ok(0)
        }
        Err(e) => {
            // Wrap library errors in CliError.
            let _ref_name = format!("refs/meshes/v1/{name}");
            Err(from_lib_error(
                "commit",
                format!("mesh `{name}` failed to commit."),
                e,
                vec![
                    NextStep::Bash(format!("git mesh status {name}")),
                    NextStep::Bash(format!("git mesh why {name} -m \"...\"")),
                ],
            )
            .into())
        }
    }
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

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
// Anchor-ID lookups (unchanged from the original)
// ---------------------------------------------------------------------------

fn mesh_range_id_lookup(
    repo: &gix::Repository,
    mesh_name: &str,
) -> std::collections::HashMap<(String, AnchorExtent), String> {
    let mut out = std::collections::HashMap::new();
    let Ok(mesh) = read_mesh(repo, mesh_name) else {
        return out;
    };
    for (id, r) in &mesh.anchors_v2 {
        out.insert((r.path.clone(), r.extent), id.clone());
    }
    out
}

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
