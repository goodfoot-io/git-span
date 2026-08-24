//! Delete / move / doctor handlers — file-backed model.

use crate::cli::format::{DESTRUCTIVE_TAG, IDEMPOTENT_TAG};
use crate::cli::{CliError, DeleteArgs, DoctorArgs, NextStep};
use crate::span::structural::delete_span_in;
use crate::span_file_reader::SpanFileReader;
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn run_delete(repo: &gix::Repository, args: DeleteArgs, span_root: &str) -> Result<i32> {
    delete_span_in(repo, &args.name, span_root).map_err(|e| CliError {
        subcommand: "delete",
        summary: format!("cannot delete `{}`.", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git span list".into())],
    })?;
    println!("Deleted `{}`.{}", args.name, DESTRUCTIVE_TAG);
    println!();
    println!("Run `git span list` to confirm the span is gone, then commit the change.");
    Ok(0)
}

pub fn run_doctor(repo: &gix::Repository, _args: DoctorArgs, span_root: &str) -> Result<i32> {
    // File-backed model: spans are ordinary tracked files. The only
    // health check that remains is that every visible span parses.
    let reader = SpanFileReader::new(repo, span_root.to_string());
    let names = reader.list_span_names()?;
    let n_spans = names.len();
    let mut findings: Vec<String> = Vec::new();
    // One capture for the whole per-span health scan (card main-290).
    let layers = crate::span_file_reader::LayerSnapshot::default();
    for name in &names {
        match reader.read_effective_with_layers(name, &layers) {
            Ok(Some(_file)) => {}
            Ok(None) => {} // deletion tombstone — skip silently
            Err(e) => findings.push(format!("span `{name}` failed to parse: {e}")),
        }
    }

    // Reserved-name surfacing: the reserved list grows between releases, so a
    // span created under a legal name can wake up carrying one that is now
    // reserved. Such a span still reads, but every write to it (`add`,
    // `remove`, `why`) refuses — an audit command that stayed silent would
    // leave the user to discover it mid-edit, with no hint that the *name* is
    // the problem. Report it here, with the escape.
    for name in &names {
        if !crate::validation::is_reserved_span_name(name) {
            continue;
        }
        let retired = crate::validation::retired_replacement(name)
            .map(|replacement| {
                format!(" `{name}` was retired as a subcommand; `git span {replacement}` replaced it.")
            })
            .unwrap_or_default();
        findings.push(format!(
            "span `{name}` carries a name reserved by this version of git-span, so it can be \
             read and deleted but not edited (`add`, `remove`, and `why` refuse it).{retired} \
             Rename it — `git mv {span_root}/{name} {span_root}/<new-name>` — or drop it with \
             `git span delete {name}`."
        ));
    }

    // Interior-anchor surfacing: a span that parses cleanly may still carry a
    // hand-edited anchor pointing inside the span root. Surface each such
    // anchor as a loud, actionable, per-span finding (parse stays pure so the
    // span remains repairable via `git span remove`/`delete`).
    for v in crate::cli::interior_anchor::scan_interior_anchors(repo, span_root)? {
        findings.push(v.report_block(span_root));
    }

    // Duplicate-identity surfacing, on the same model: a span that parses
    // cleanly may still carry two records for one `(path, start_line,
    // end_line)`. Nothing about that is ill-formed, so it slips past parse
    // and validate alike, and only shows itself later — as one identity
    // drifting in two states when the records disagree, or as a silently
    // doubled record when they agree. Name it here, with the command that
    // repairs *that* finding: `add` when the anchored path is still there,
    // `drift --fix` when it is not.
    for d in crate::cli::duplicate_identity::scan_duplicate_identities(repo, span_root)? {
        findings.push(d.report_block(span_root));
    }

    // Merge-driver registration checks: `.span/` conflicts collapse in place
    // during `git merge` only when the committed repository-root
    // `.gitattributes` effectively sets `merge=span` for `<span_root>/**`
    // *and* the per-clone git config names the driver. The two are
    // independent — git distributes one and not the other — so each missing
    // half is its own finding. Both are report-only: doctor surfaces the gap
    // but never writes these files; registration stays manual by design (see
    // storage-model.md). Both checks are vacuous when the span root does not
    // exist — the same gate the legacy-lock cleanup uses — because a repo
    // with no `.span/` directory cannot receive `.span/` conflicts, so there
    // is nothing to register for.
    if crate::git::work_dir(repo)?.join(span_root).exists() {
        if let Some(finding) = missing_merge_span_gitattributes_finding(repo, span_root)? {
            findings.push(finding);
        }
        if let Some(finding) = missing_merge_span_driver_finding(repo, span_root) {
            findings.push(finding);
        }
    }

    // Legacy lock cleanup: older builds of git-span serialized mutations
    // with one advisory lock per span (`.span-lock-<hash>` at a
    // hierarchical span's parent, `.<name>.lock` for a flat span, or
    // `.<leaf>.context.lock` beside a leaf under context repair). All
    // mutating commands now serialize through a single repository-wide
    // lock under the git directory instead, so any of these files still
    // sitting in the span root is leftover residue from before the
    // upgrade. Doctor removes it — it is safe to delete unconditionally:
    // doctor itself runs under that same shared repository lock, and no
    // current build creates, waits on, or otherwise depends on these
    // paths existing.
    let removed_locks = clean_legacy_lock_files(repo, span_root, &mut findings)?;

    let exit = if findings.is_empty() {
        println!(
            "span doctor: {n_spans} {} checked, no findings.{IDEMPOTENT_TAG}",
            if n_spans == 1 { "span" } else { "spans" }
        );
        0
    } else {
        println!("# span doctor");
        println!();
        let n_findings = findings.len();
        println!(
            "{n_spans} {} checked, {n_findings} {}.",
            if n_spans == 1 { "span" } else { "spans" },
            if n_findings == 1 {
                "finding"
            } else {
                "findings"
            }
        );
        println!();
        println!("## Findings");
        println!();
        for f in &findings {
            println!("- ERROR — {f}");
        }
        1
    };

    if !removed_locks.is_empty() {
        println!();
        println!("## Cleanup");
        println!();
        for path in &removed_locks {
            println!(
                "- removed stale lock file `{path}` left by an earlier git-span; locks now live under the git directory"
            );
        }
    }

    println!();
    report_store_diagnostics(repo);
    Ok(exit)
}

/// Report a missing `<span_root>/** merge=span` rule in the committed
/// repository-root `.gitattributes`, or `None` when the rule is effectively
/// in force.
///
/// "Committed" is the measured truth, not the worktree: the card defines
/// registration as a committed, shared rule, so an uncommitted paste does
/// not count — the finding (and its advice, "add … and commit it") stays
/// until the rule reaches HEAD. The file is read from the HEAD tree via
/// [`crate::git::tree_entry_at`]; an unborn HEAD or a missing file reads as
/// no rule.
///
/// The scan mirrors git's attribute precedence within this one file:
/// patterns are evaluated in order and the *last* matching line that
/// mentions `merge` decides the attribute — `-merge` unsets it, `merge=…`
/// sets it, and a matching line that does not mention `merge` leaves it
/// untouched. Both the plain and root-anchored pattern forms
/// (`{span_root}/**` and `/{span_root}/**`) count: git treats them as
/// equivalent in a repository-root file. A `!`-negated pattern never
/// applies its attributes, so such lines are skipped, as are the
/// trailing-slash directory form and any other pattern shape (they match
/// nothing git would consult for files under the root).
///
/// Scope note: git also consults `$GIT_DIR/info/attributes`, global
/// attributes files, and `.gitattributes` files deeper in the tree (e.g.
/// the span-root file git-span itself manages with `* text eol=lf`). The
/// card scopes this check to the repository-root file — the distributed
/// half — so those sources are deliberately not read: a per-clone
/// registration or a deeper-file override is a different configuration
/// state, not the shared rule this finding exists to enforce. Doctor only
/// reports; it never writes this file.
fn missing_merge_span_gitattributes_finding(
    repo: &gix::Repository,
    span_root: &str,
) -> Result<Option<String>> {
    let contents = match crate::git::tree_entry_at(repo, "HEAD", Path::new(".gitattributes"))? {
        Some((_mode, oid)) => crate::git::read_git_text(repo, &oid.to_string())?,
        None => String::new(),
    };
    let pattern = format!("{span_root}/**");
    let anchored_pattern = format!("/{span_root}/**");
    // Last matching line that mentions `merge` wins: None — no matching line
    // has mentioned it yet; Some(None) — the deciding line unsets it;
    // Some(Some(value)) — the deciding line sets it to `value`.
    let mut merge_state: Option<Option<&str>> = None;
    for line in contents.lines() {
        let mut tokens = line.split_whitespace();
        let Some(pattern_token) = tokens.next() else {
            continue;
        };
        if pattern_token.starts_with('!') {
            // A negated pattern never applies its attributes.
            continue;
        }
        if pattern_token != pattern && pattern_token != anchored_pattern {
            continue;
        }
        for token in tokens {
            if token == "-merge" {
                merge_state = Some(None);
            } else if let Some(value) = token.strip_prefix("merge=") {
                merge_state = Some(Some(value));
            }
        }
    }
    if matches!(merge_state, Some(Some("span"))) {
        return Ok(None);
    }
    Ok(Some(format!(
        "no `merge=span` for `{pattern}` in the committed repository-root `.gitattributes`, so \
         git merges files under `{span_root}/` with its line merge instead of collapsing them — \
         add this line to `.gitattributes` and commit it: `{pattern} merge=span` (registration \
         is optional; without it, `git span drift --fix` restores the same state after a merge)"
    )))
}

/// Report a missing `merge.span.driver` git config key, or `None` when the
/// driver is registered anywhere git would see it. The merged snapshot
/// (system + global + local) is deliberately the source of truth: a driver
/// registered in global config collapses conflicts exactly as well as one in
/// the local file, so only total absence is a finding. Doctor only reports;
/// it never writes `.git/config`.
///
/// Paste-safety: the quoted `[merge "span"]` block is the *last* copyable
/// thing in the finding — the optionality note lives in the prose above it,
/// so a user selecting from the block to the end of the output pastes
/// exactly the block and nothing that `.git/config` would misparse. That is
/// load-bearing: the prose contains backticked tokens with `=` (e.g.
/// `` `merge=span` ``) that git config would read as a key/value, and a bare
/// line after the block would be an unexpected token that invalidates the
/// entire config, breaking every git command until hand-repair.
fn missing_merge_span_driver_finding(repo: &gix::Repository, span_root: &str) -> Option<String> {
    if crate::git::config_string(repo, "merge.span.driver").is_some() {
        return None;
    }
    Some(format!(
        "the `merge.span.driver` git config key is not set, so git merges files under \
         `{span_root}/` with its line merge instead of collapsing them — add this block to \
         `.git/config` (registration is optional; without it, `git span drift --fix` restores \
         the same state after a merge):\n\n\
         [merge \"span\"]\n    name = git-span structural span merge\n    driver = git span \
         merge-driver %O %A %B %L"
    ))
}

/// A file is legacy lock residue iff its basename matches `.span-lock-*`
/// (the hierarchical-span lock), or starts with `.` and ends with `.lock`
/// (`.<name>.lock` for a flat span, `.<leaf>.context.lock` for context
/// repair). Never matches `.gitattributes`, `.gitignore`, `.hookignore`, or
/// a `.*.tmp` atomic-write temp file.
fn is_legacy_lock_name(name: &str) -> bool {
    name.starts_with(".span-lock-") || (name.starts_with('.') && name.ends_with(".lock"))
}

/// Remove every legacy lock artifact under `span_root`, returning the
/// `<span_root>/<relative path>` of each file removed, in a stable order.
///
/// This is best-effort maintenance, not a mutation, so it deliberately does
/// not go through `SpanRootAuthority`/`RetainedDirectory`: that guard's
/// fail-closed symlink refusal is correct for a read-modify-write on a
/// span file, but here it would abort the whole audit over exactly the
/// residue this function exists to clean up. Cards worktree provisioning
/// symlinks untracked files — including these same legacy lock files —
/// from the main checkout into each worktree, so a lock-named symlink is
/// an expected real-world shape here, not a hazard. The walk instead uses
/// plain `std::fs::read_dir` with `symlink_metadata` on each entry: it
/// never follows a symlink and never descends into a symlinked directory,
/// and a matching lock-named symlink is removed as a directory entry
/// (`remove_file`, i.e. `unlink`) — the link only, never whatever it
/// points at.
///
/// Any I/O error hit while walking or removing becomes a doctor finding
/// (pushed onto `findings`, forcing exit 1) instead of aborting the audit
/// early: doctor's job is to report the repository's health, and one
/// unreadable or unremovable stray file must never suppress every other
/// finding.
///
/// One exception: `doctor` dispatches under `Mode::Shared`, so concurrent
/// `git span doctor` runs can enumerate the same stale entry — the loser's
/// `symlink_metadata`/`remove_file` then races the winner's `remove_file`
/// and observes `NotFound`. That is not damage, it is confirmation the
/// entry is already gone, so a `NotFound` from either call is treated as
/// benign and skipped silently: not counted as removed by this process,
/// and never turned into a finding.
///
/// Non-existence of the span root is not an error here — a repository with
/// no `.span/` directory yet has nothing to clean.
fn clean_legacy_lock_files(
    repo: &gix::Repository,
    span_root: &str,
    findings: &mut Vec<String>,
) -> Result<Vec<String>> {
    let root = crate::git::work_dir(repo)?.join(span_root);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut removed = Vec::new();
    let mut stack = vec![(root, PathBuf::new())];
    while let Some((dir, relative)) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => {
                findings.push(format!(
                    "could not clean legacy lock file `{span_root}/{}`: {e}",
                    relative.display()
                ));
                continue;
            }
        };
        let mut children = Vec::new();
        for entry in entries {
            match entry {
                Ok(entry) => children.push(entry),
                Err(e) => findings.push(format!(
                    "could not clean legacy lock file `{span_root}/{}`: {e}",
                    relative.display()
                )),
            }
        }
        children.sort_by_key(std::fs::DirEntry::file_name);

        for entry in children {
            let name = entry.file_name();
            let entry_relative = relative.join(&name);
            let Some(name) = name.to_str() else {
                continue;
            };
            let metadata = match entry.path().symlink_metadata() {
                Ok(m) => m,
                // Doctor runs under `Mode::Shared` (readers may run
                // concurrently), so two `git span doctor` processes can
                // both enumerate the same stale entry; the loser's `stat`
                // races the winner's `remove_file` below and observes
                // `NotFound`. That is not damage — it is confirmation the
                // file is already gone — so it is silently skipped rather
                // than reported as a finding.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    findings.push(format!(
                        "could not clean legacy lock file `{span_root}/{}`: {e}",
                        entry_relative.display()
                    ));
                    continue;
                }
            };
            if metadata.is_dir() {
                // Never descend into a symlinked directory — only a real
                // directory can hold further legacy artifacts.
                if !metadata.file_type().is_symlink() {
                    stack.push((entry.path(), entry_relative));
                }
                continue;
            }
            if !is_legacy_lock_name(name) {
                continue;
            }
            if let Err(e) = std::fs::remove_file(entry.path()) {
                // Same benign race as the `symlink_metadata` case above: a
                // concurrent `git span doctor` run already removed this
                // exact entry between our `read_dir` and our `unlink`. The
                // repository ends up in the state this function wants
                // either way, so this is not reported as removed (we did
                // not remove it) nor as a finding (nothing is wrong).
                if e.kind() != std::io::ErrorKind::NotFound {
                    findings.push(format!(
                        "could not clean legacy lock file `{span_root}/{}`: {e}",
                        entry_relative.display()
                    ));
                }
                continue;
            }
            removed.push(format!("{span_root}/{}", entry_relative.display()));
        }
    }
    removed.sort();
    Ok(removed)
}

/// Report the persistent store's on-disk size as a plain diagnostic, plus any
/// corruption/schema-mismatch recovery this open performed (card main-157
/// Phase 6B). Health diagnostics only — never changes the doctor exit code.
///
/// Reads the store non-invasively: if the database file does not yet exist it
/// reports that without creating one, so `doctor` never materializes a store
/// as a side effect.
fn report_store_diagnostics(repo: &gix::Repository) {
    use crate::resolver::store::schema::DB_BASENAME;

    let db_path = crate::git::common_dir(repo).join("span").join(DB_BASENAME);

    println!("## Store");
    println!();

    if !db_path.exists() {
        println!("- No persistent store yet at `{}`.", db_path.display());
        return;
    }

    match crate::resolver::store::CacheStore::open(repo) {
        Ok(store) => match store.database_size_bytes() {
            Ok(size) => {
                println!("- On-disk size: {size} bytes.");
                if let Some(reason) = store.recovered_on_open() {
                    println!("- Recovered from a quarantined database on open: {reason:?}.");
                }
            }
            Err(e) => println!("- Size unavailable: {e}."),
        },
        Err(e) => println!("- Present but could not be opened: {e}."),
    }
}
