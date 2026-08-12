//! Delete / move / doctor handlers — file-backed model.

use crate::cli::format::{DESTRUCTIVE_TAG, IDEMPOTENT_TAG};
use crate::cli::{CliError, DeleteArgs, DoctorArgs, NextStep};
use crate::span::structural::delete_span_in;
use crate::span_file_reader::SpanFileReader;
use anyhow::Result;

/// Prune now-empty parent directories of a removed span file, walking up
/// from the deepest segment toward — but never including or past — the
/// span root. A hierarchical span name like `bulk/foo` leaves an empty
/// `<root>/bulk/` directory once its last span is removed; that empty
/// shell is noise in `git status` and the worktree, so collapse it.
///
/// Best-effort: a non-empty directory (another span still lives under it)
/// stops the walk, and any I/O error simply ends pruning without failing
/// the command — the span removal itself already succeeded.
fn prune_empty_parents(repo: &gix::Repository, span_root: &str, name: &str) {
    let Some(workdir) = repo.workdir() else {
        return;
    };
    let root = workdir.join(span_root);
    // The span file lived at `<root>/<name>`; start at its parent.
    let mut dir = root.join(name);
    while dir.pop() {
        // Stop before removing the span root itself or escaping above it.
        if dir == root || !dir.starts_with(&root) {
            break;
        }
        // `remove_dir` only succeeds on an empty directory; a populated
        // parent (sibling span present) ends the walk.
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
    }
}

pub fn run_delete(repo: &gix::Repository, args: DeleteArgs, span_root: &str) -> Result<i32> {
    delete_span_in(repo, &args.name, span_root).map_err(|e| CliError {
        subcommand: "delete",
        summary: format!("cannot delete `{}`.", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git span list".into())],
    })?;
    prune_empty_parents(repo, span_root, &args.name);
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
    for name in &names {
        match reader.read_effective(name) {
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
    // and validate alike and only shows itself as one identity drifting in
    // two states. Name it here, with the one command that repairs it.
    for d in crate::cli::duplicate_identity::scan_duplicate_identities(repo, span_root)? {
        findings.push(d.report_block(span_root));
    }

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

    println!();
    report_store_diagnostics(repo);
    Ok(exit)
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
