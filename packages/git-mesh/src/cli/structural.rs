//! Structural handlers (restore, revert, delete, move) + doctor — §6.6, §6.7, §6.8.

use crate::cli::{CliError, DeleteArgs, MoveArgs, NextStep, RestoreArgs, RevertArgs};
use crate::cli::format::{DESTRUCTIVE_TAG, IDEMPOTENT_TAG, format_fast_forward, format_ref_deletion};
use crate::sync::default_remote;
use crate::{delete_mesh, file_index, list_mesh_names, rename_mesh, revert_mesh, Error};
use anyhow::{Result, anyhow};
use std::collections::BTreeSet;
use std::fs;

pub fn run_restore(repo: &gix::Repository, args: RestoreArgs) -> Result<i32> {
    let staging = crate::staging::read_staging(repo, &args.name)?;
    let count = staging.adds.len() + staging.removes.len() + staging.configs.len()
        + staging.why.as_ref().map_or(0, |_| 1);
    if count == 0 {
        println!("`{}` has no staged operations.", args.name);
    } else {
        crate::staging::clear_staging(repo, &args.name)?;
        println!(
            "Cleared the staging area on `{}`. {} staged operations were discarded.{}",
            args.name, count, DESTRUCTIVE_TAG
        );
        println!();
        println!("Run `git mesh {}` to verify staging is empty.", args.name);
    }
    Ok(0)
}

pub fn run_revert(repo: &gix::Repository, args: RevertArgs) -> Result<i32> {
    let ref_name = format!("refs/meshes/v1/{}", args.name);
    let wd = crate::git::work_dir(repo)?;
    let current = crate::git::resolve_ref_oid_optional(wd, &ref_name)?
        .ok_or_else(|| Error::MeshNotFound(args.name.clone()))?;

    // Check if the target commit-ish is an ancestor of the current tip.
    let is_ancestor = crate::mesh::is_ancestor_commit(repo, &args.name, &args.commit_ish)
        .map_err(|e| anyhow!("{}", e))?;

    if !is_ancestor {
        let short_current: String = current.chars().take(7).collect();
        return Err(CliError {
            subcommand: "revert",
            summary: format!("cannot fast-forward `{}` to `{}`.", args.name, args.commit_ish),
            what_happened: format!(
                "`{}` is not an ancestor of the current mesh tip `{}`. \
                 `git mesh revert` only moves a mesh ref backwards along its own history.",
                args.commit_ish, short_current
            ),
            next_steps: vec![
                NextStep::Prose("List the mesh's history, then pick a commit on it:".into()),
                NextStep::Bash(format!(
                    "git mesh {} --log\ngit mesh revert {} <commit-on-the-log>",
                    args.name, args.name
                )),
            ],
        }
        .into());
    }

    let new_commit = revert_mesh(repo, &args.name, &args.commit_ish)?;
    let short_old: String = current.chars().take(7).collect();
    let short_new: String = new_commit.chars().take(7).collect();
    println!(
        "{}{}",
        format_fast_forward(&ref_name, &short_old, &short_new),
        DESTRUCTIVE_TAG
    );
    println!();
    println!("Run `git mesh {}` to verify.", args.name);
    Ok(0)
}

pub fn run_delete(repo: &gix::Repository, args: DeleteArgs) -> Result<i32> {
    let ref_name = format!("refs/meshes/v1/{}", args.name);
    let wd = crate::git::work_dir(repo)?;
    let current = match crate::git::resolve_ref_oid_optional(wd, &ref_name)? {
        Some(s) => s,
        None => {
            return Err(CliError {
                subcommand: "delete",
                summary: format!("no mesh named `{}`.", args.name),
                what_happened: format!("`{}` does not exist.", ref_name),
                next_steps: vec![NextStep::Bash("git mesh list".into())],
            }
            .into());
        }
    };

    delete_mesh(repo, &args.name)?;
    let short: String = current.chars().take(7).collect();
    println!(
        "{}{}",
        format_ref_deletion(&ref_name, &short),
        DESTRUCTIVE_TAG
    );
    println!();
    println!("Run `git mesh list` to confirm the mesh is gone.");
    Ok(0)
}

pub fn run_move(repo: &gix::Repository, args: MoveArgs) -> Result<i32> {
    let old_ref = format!("refs/meshes/v1/{}", args.old);
    let new_ref = format!("refs/meshes/v1/{}", args.new);

    // Check destination existence before calling rename_mesh so we can
    // produce a structured CliError.
    let wd = crate::git::work_dir(repo)?;
    if crate::git::resolve_ref_oid_optional(wd, &new_ref)?.is_some() {
        return Err(CliError {
            subcommand: "move",
            summary: format!("`{}` already exists.", args.new),
            what_happened: format!(
                "A mesh is already tracked at `{}`, so renaming `{}` over it would lose history.",
                new_ref, args.old
            ),
            next_steps: vec![
                NextStep::Prose("Pick a different name, or delete the existing mesh first:".into()),
                NextStep::Bash(format!(
                    "git mesh move {} <different-name>\ngit mesh delete {} && git mesh move {} {}",
                    args.old, args.new, args.old, args.new
                )),
            ],
        }
        .into());
    }

    // Check source existence early for a structured error.
    if crate::git::resolve_ref_oid_optional(wd, &old_ref)?.is_none() {
        return Err(CliError {
            subcommand: "move",
            summary: format!("no mesh named `{}`.", args.old),
            what_happened: format!("`{}` does not exist.", old_ref),
            next_steps: vec![NextStep::Bash("git mesh list".into())],
        }
        .into());
    }

    rename_mesh(repo, &args.old, &args.new)?;
    println!(
        "Renamed `{}` to `{}`. The mesh's history is preserved on `{}`.{}",
        args.old, args.new, new_ref, IDEMPOTENT_TAG
    );
    println!();
    println!("Run `git mesh {}` to verify.", args.new);
    Ok(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DoctorFinding {
    pub code: DoctorCode,
    pub severity: Severity,
    pub message: String,
    pub remediation: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DoctorCode {
    MissingPostCommitHook,
    MissingPreCommitHook,
    StagingCorrupt,
    RefspecMissing,
    OrphanRangeRef,
    FileIndexMissing,
    FileIndexRebuilt,
    DanglingRangeRef,
    SidecarTampered,
    /// Slice 6c: pre-existing duplicate mesh refspecs in
    /// `remote.<name>.{fetch,push}`. Doctor collapses them in-place and
    /// reports an INFO finding when it does.
    DuplicateRefspec,
    /// Slice 6d: `core.logAllRefUpdates` is not set to `always` (or is
    /// unset entirely), so refs under `refs/meshes/*` would not get
    /// reflog entries. Doctor sets it lazily and reports INFO.
    LogAllRefUpdatesSet,
    /// The `post-rewrite` hook is not installed or does not contain the
    /// `git mesh rewrite` marker.
    MissingPostRewriteHook,
}

const POST_COMMIT_HOOK_BODY: &str = "#!/bin/sh\ngit mesh commit\n";
const PRE_COMMIT_HOOK_BODY: &str = "#!/bin/sh\ngit mesh pre-commit\n";
const POST_REWRITE_HOOK_BODY: &str =
    "#!/bin/sh\ngit mesh rewrite\ngit mesh stale --compact --no-exit-code\n";
const POST_COMMIT_MARKER: &str = "git mesh commit";
const PRE_COMMIT_MARKER: &str = "git mesh pre-commit";
const POST_REWRITE_MARKER: &str = "git mesh rewrite";

pub fn doctor_run(repo: &gix::Repository) -> crate::Result<Vec<DoctorFinding>> {
    let mut out = Vec::new();
    let git_dir = crate::git::git_dir(repo).to_path_buf();

    // ---- Hook checks --------------------------------------------------
    check_hook(
        &git_dir,
        "post-commit",
        POST_COMMIT_MARKER,
        POST_COMMIT_HOOK_BODY,
        DoctorCode::MissingPostCommitHook,
        &mut out,
    );
    check_hook(
        &git_dir,
        "pre-commit",
        PRE_COMMIT_MARKER,
        PRE_COMMIT_HOOK_BODY,
        DoctorCode::MissingPreCommitHook,
        &mut out,
    );
    check_hook(
        &git_dir,
        "post-rewrite",
        POST_REWRITE_MARKER,
        POST_REWRITE_HOOK_BODY,
        DoctorCode::MissingPostRewriteHook,
        &mut out,
    );

    // ---- Refspec check -----------------------------------------------
    let remote = default_remote(repo).unwrap_or_else(|_| "origin".into());
    let url = crate::sync::get_remote_url(repo, &remote);
    if url.is_some() {
        let fetch = crate::sync::get_remote_multi(repo, &remote, "fetch");
        if !fetch.iter().any(|l| l.contains("refs/meshes/")) {
            out.push(DoctorFinding {
                code: DoctorCode::RefspecMissing,
                severity: Severity::Info,
                message: format!("remote `{remote}` has no mesh refspec"),
                remediation: Some("run `git mesh push` or `fetch` once to bootstrap".into()),
            });
        }
        // Slice 6c: collapse duplicate mesh refspecs in place.
        if let Ok((fd, pd)) = crate::sync::dedupe_mesh_refspecs(repo, &remote)
            && (fd > 0 || pd > 0)
        {
            out.push(DoctorFinding {
                code: DoctorCode::DuplicateRefspec,
                severity: Severity::Info,
                message: format!(
                    "collapsed duplicate mesh refspecs on remote `{remote}` (fetch: {fd}, push: {pd})"
                ),
                remediation: None,
            });
        }
    }

    // ---- Reflog coverage for mesh refs (Slice 6d) -------------------
    if crate::git::log_all_ref_updates_value(repo).as_deref() != Some("always")
        && crate::git::ensure_log_all_ref_updates_always(repo).is_ok()
    {
        out.push(DoctorFinding {
            code: DoctorCode::LogAllRefUpdatesSet,
            severity: Severity::Info,
            message: "set `core.logAllRefUpdates = always` so refs/meshes/* get reflog entries"
                .into(),
            remediation: None,
        });
    }

    // ---- Staging area corruption -------------------------------------
    check_staging(&git_dir, &mut out);

    // ---- Sidecar integrity (Slice 4) --------------------------------
    check_sidecar_integrity(repo, &mut out);

    // ---- Legacy anchor ref hygiene ----------------------------------
    check_legacy_anchor_refs(repo, &mut out);

    // ---- File index self-heal ---------------------------------------
    check_file_index(repo, &mut out);

    Ok(out)
}

fn check_legacy_anchor_refs(repo: &gix::Repository, out: &mut Vec<DoctorFinding>) {
    let Ok(anchor_refs) = crate::git::list_refs_stripped(repo, "refs/anchors/v1") else {
        return;
    };
    if anchor_refs.is_empty() {
        return;
    }
    let mut active = BTreeSet::new();
    let Ok(mesh_names) = list_mesh_names(repo) else {
        return;
    };
    for mesh_name in mesh_names {
        let Ok(mesh) = crate::mesh::read_mesh(repo, &mesh_name) else {
            continue;
        };
        for (anchor_id, _anchor) in mesh.anchors_v2 {
            active.insert(anchor_id);
        }
    }
    for anchor_id in anchor_refs {
        if !active.contains(&anchor_id) {
            out.push(DoctorFinding {
                code: DoctorCode::DanglingRangeRef,
                severity: Severity::Warn,
                message: format!("legacy anchor ref `{anchor_id}` is not referenced by any mesh"),
                remediation: None,
            });
        }
    }
}

fn check_hook(
    git_dir: &std::path::Path,
    name: &str,
    marker: &str,
    _suggested_body: &str,
    code: DoctorCode,
    out: &mut Vec<DoctorFinding>,
) {
    let hook_path = git_dir.join("hooks").join(name);
    let ok = fs::read_to_string(&hook_path)
        .map(|s| s.contains(marker))
        .unwrap_or(false);
    if !ok {
        out.push(DoctorFinding {
            code,
            severity: Severity::Info,
            message: format!("`{name}` hook not installed"),
            remediation: Some(format!(
                "Install it with `npx git-mesh install-hooks` or copy `packages/git-mesh/scripts/{name}` into `.git/hooks/`."
            )),
        });
    }
}

fn check_staging(git_dir: &std::path::Path, out: &mut Vec<DoctorFinding>) {
    let dir = git_dir.join("mesh").join("staging");
    if !dir.exists() {
        return;
    }
    // Group files: ops files (no dot) vs. sidecars (<name>.<N>) vs. .why
    let mut ops_files: Vec<(String, std::path::PathBuf)> = Vec::new();
    let mut sidecars: Vec<(String, u32, std::path::PathBuf)> = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for e in entries.flatten() {
        let fname = e.file_name();
        let Some(fn_str) = fname.to_str() else {
            continue;
        };
        if let Some((base, rest)) = fn_str.rsplit_once('.') {
            if rest == "why" {
                continue;
            }
            if let Ok(n) = rest.parse::<u32>() {
                // `base` is filesystem-encoded (`%2F` for `/` per
                // `staging::encode_name_for_fs`); decode for display and
                // for matching the ops-file basename.
                let decoded = crate::staging::decode_name_from_fs(base);
                sidecars.push((decoded, n, e.path()));
                continue;
            }
            // Unknown extension — skip
            continue;
        }
        ops_files.push((crate::staging::decode_name_from_fs(fn_str), e.path()));
    }

    for (name, path) in &ops_files {
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let mut add_n: u32 = 0;
        let mut expected_sidecars: BTreeSet<u32> = BTreeSet::new();
        for (idx, line) in text.lines().enumerate() {
            let lineno = idx + 1;
            if line.trim().is_empty() {
                continue;
            }
            if let Some(rest) = line.strip_prefix("add ") {
                add_n += 1;
                let (addr, anchor) = match rest.split_once('\t') {
                    Some((addr, anchor)) => (addr, Some(anchor)),
                    None => (rest, None),
                };
                if !is_valid_addr(addr) {
                    out.push(DoctorFinding {
                        code: DoctorCode::StagingCorrupt,
                        severity: Severity::Error,
                        message: format!("malformed staging line in {}:{lineno}", path.display()),
                        remediation: Some(format!("`git mesh restore {name}` and re-stage")),
                    });
                    continue;
                }
                if anchor.is_none() {
                    // expect sidecar <name>.<add_n>
                    expected_sidecars.insert(add_n);
                    let sidecar_p = dir.join(format!(
                        "{}.{add_n}",
                        crate::staging::encode_name_for_fs(name)
                    ));
                    if !sidecar_p.exists() {
                        out.push(DoctorFinding {
                            code: DoctorCode::StagingCorrupt,
                            severity: Severity::Error,
                            message: format!(
                                "missing sidecar for {}:{lineno} (expected {})",
                                path.display(),
                                sidecar_p.display()
                            ),
                            remediation: Some(format!("`git mesh restore {name}` and re-stage")),
                        });
                    }
                }
            } else if let Some(rest) = line.strip_prefix("remove ") {
                if !is_valid_addr(rest) {
                    out.push(DoctorFinding {
                        code: DoctorCode::StagingCorrupt,
                        severity: Severity::Error,
                        message: format!("malformed staging line in {}:{lineno}", path.display()),
                        remediation: Some(format!("`git mesh restore {name}` and re-stage")),
                    });
                }
            } else if line.starts_with("config ") {
                // permissive: validated at commit time
            } else {
                out.push(DoctorFinding {
                    code: DoctorCode::StagingCorrupt,
                    severity: Severity::Error,
                    message: format!("unknown staging op in {}:{lineno}", path.display()),
                    remediation: Some(format!("`git mesh restore {name}` and re-stage")),
                });
            }
        }
        // Orphaned sidecars: sidecars for `name` whose N isn't in expected_sidecars.
        for (sc_name, n, sc_path) in &sidecars {
            if sc_name == name && !expected_sidecars.contains(n) {
                out.push(DoctorFinding {
                    code: DoctorCode::StagingCorrupt,
                    severity: Severity::Warn,
                    message: format!(
                        "orphaned sidecar {} (no matching anchor-less `add` line)",
                        sc_path.display()
                    ),
                    remediation: Some(format!(
                        "delete {} or `git mesh restore {name}`",
                        sc_path.display()
                    )),
                });
            }
        }
    }

    // Sidecars whose basename has no ops file at all.
    let ops_names: BTreeSet<&str> = ops_files.iter().map(|(n, _)| n.as_str()).collect();
    for (sc_name, _n, sc_path) in &sidecars {
        if !ops_names.contains(sc_name.as_str()) {
            out.push(DoctorFinding {
                code: DoctorCode::StagingCorrupt,
                severity: Severity::Warn,
                message: format!(
                    "orphaned sidecar {} (no staging ops file for `{sc_name}`)",
                    sc_path.display()
                ),
                remediation: Some(format!("delete {}", sc_path.display())),
            });
        }
    }
}

fn is_valid_addr(s: &str) -> bool {
    let Some((path, frag)) = s.split_once("#L") else {
        return false;
    };
    if path.is_empty() {
        return false;
    }
    let Some((a, b)) = frag.split_once("-L") else {
        return false;
    };
    let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) else {
        return false;
    };
    a >= 1 && b >= a
}

fn check_sidecar_integrity(repo: &gix::Repository, out: &mut Vec<DoctorFinding>) {
    let dir = crate::git::mesh_dir(repo).join("staging");
    if !dir.exists() {
        return;
    }
    // Collect the set of mesh names with an ops file (no extension).
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut mesh_names: Vec<String> = Vec::new();
    for e in entries.flatten() {
        let Some(fname) = e.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !fname.contains('.') {
            mesh_names.push(fname);
        }
    }
    for name in &mesh_names {
        let staging = match crate::staging::read_staging(repo, name) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for add in &staging.adds {
            match crate::staging::read_sidecar_verified(repo, name, add.line_number) {
                Ok(_) => {}
                Err(crate::staging::SidecarVerifyError::Tampered) => {
                    out.push(DoctorFinding {
                        code: DoctorCode::SidecarTampered,
                        severity: Severity::Error,
                        message: format!(
                            "sidecar for mesh `{name}` slot {} (`{}`) failed integrity check",
                            add.line_number, add.path
                        ),
                        remediation: Some(format!(
                            "`git mesh restore {name}` and re-stage `{}`",
                            add.path
                        )),
                    });
                }
                Err(crate::staging::SidecarVerifyError::Missing) => {
                    // Already covered by `check_staging`'s "missing
                    // sidecar" finding; don't double-report.
                }
            }
        }
    }
}

fn check_file_index(repo: &gix::Repository, out: &mut Vec<DoctorFinding>) {
    let p = crate::git::mesh_dir(repo).join("file-index");
    let problem: Option<String> = if !p.exists() {
        Some("file index missing".into())
    } else {
        match fs::read_to_string(&p) {
            Ok(text) if text.starts_with("# mesh-index v2") => None,
            Ok(_) => Some("file index header missing or corrupt".into()),
            Err(e) => Some(format!("file index unreadable: {e}")),
        }
    };
    if let Some(msg) = problem {
        out.push(DoctorFinding {
            code: DoctorCode::FileIndexMissing,
            severity: Severity::Warn,
            message: msg,
            remediation: Some("regenerating automatically".into()),
        });
        match file_index::rebuild_index(repo) {
            Ok(()) => out.push(DoctorFinding {
                code: DoctorCode::FileIndexRebuilt,
                severity: Severity::Info,
                message: "file index regenerated".into(),
                remediation: None,
            }),
            Err(e) => out.push(DoctorFinding {
                code: DoctorCode::FileIndexRebuilt,
                severity: Severity::Error,
                message: format!("file index regeneration failed: {e}"),
                remediation: Some("inspect `.git/mesh/file-index` manually".into()),
            }),
        }
    }
}

/// Collect the set of `anchor_sha` values from all live meshes. Used by
/// `--gc-trail-cache` to distinguish live vs. orphan cache files.
fn collect_live_anchor_shas(repo: &gix::Repository) -> std::collections::HashSet<String> {
    let mut shas = std::collections::HashSet::new();
    let Ok(names) = list_mesh_names(repo) else {
        return shas;
    };
    for name in names {
        let Ok(mesh) = crate::mesh::read_mesh(repo, &name) else {
            continue;
        };
        for (_id, anchor) in mesh.anchors_v2 {
            shas.insert(anchor.anchor_sha);
        }
    }
    shas
}

pub fn run_doctor(repo: &gix::Repository, args: crate::cli::DoctorArgs) -> Result<i32> {
    if args.gc_trail_cache {
        let live_anchors = collect_live_anchor_shas(repo);
        match crate::resolver::trail_cache::gc(repo, &live_anchors) {
            Ok(report) => {
                println!(
                    "mesh doctor: trail cache gc — removed {} orphan(s), {} stale tempfile(s)",
                    report.removed_orphans, report.removed_stale_tmp
                );
            }
            Err(e) => {
                println!("git-mesh: trail_cache::gc failed: {e}");
            }
        }
    }
    let findings = doctor_run(repo)?;
    let names = list_mesh_names(repo).unwrap_or_default();
    let n_meshes = names.len();

    if findings.is_empty() {
        println!(
            "mesh doctor: {n_meshes} meshes checked, no findings.{IDEMPOTENT_TAG}",
        );
        return Ok(0);
    }

    // Print findings report.
    println!("# mesh doctor");
    println!();
    println!("{n_meshes} meshes checked, {} findings.", findings.len());
    println!();
    println!("## Findings");
    println!();

    for f in &findings {
        let label = match f.severity {
            Severity::Info => "INFO",
            Severity::Warn => "WARN",
            Severity::Error => "ERROR",
        };
        let code = format!("{:?}", f.code);
        print!("- {label} `{code}` — {}", f.message);
        if let Some(rem) = &f.remediation {
            println!();
            println!("  {rem}");
        } else {
            println!();
        }
    }

    // Severity-driven exit codes (§6.7):
    //   ERROR              → exit 1
    //   INFO / WARN only   → exit 0
    //   --strict promotes INFO and WARN to exit 1
    let has_error = findings.iter().any(|f| f.severity == Severity::Error);
    let has_non_ok = findings.iter().any(|f| {
        matches!(
            f.severity,
            Severity::Info | Severity::Warn | Severity::Error
        )
    });

    let strict_escalates = args.strict && has_non_ok;

    // Print "What to do next" on stdout for non-strict escalations.
    // When strict escalates, the CliError on stderr provides the guidance instead.
    if !strict_escalates {
        println!();
        println!("## What to do next");
        println!();
        if has_error {
            println!("Address the ERROR-level findings before staging more work. The other findings are advisory.");
        } else {
            println!("All findings are advisory. No action is required.");
        }
    }

    if args.strict && has_non_ok {
        let non_error_count = findings
            .iter()
            .filter(|f| f.severity != Severity::Error)
            .count();
        let kind = if non_error_count > 0 {
            "INFO/WARN"
        } else {
            "ERROR"
        };
        return Err(CliError {
            subcommand: "doctor",
            summary: format!(
                "failing because `--strict` was set and {non_error_count} {kind} finding(s) was reported."
            ),
            what_happened: "In strict mode, INFO and WARN findings escalate to a non-zero exit so CI catches advisory drift early."
                .into(),
            next_steps: vec![NextStep::Prose(
                "Fix the finding above, or drop `--strict` if you only want errors to fail the run."
                    .into(),
            )],
        }
        .into());
    }

    if has_error {
        Ok(1)
    } else {
        Ok(0)
    }
}
