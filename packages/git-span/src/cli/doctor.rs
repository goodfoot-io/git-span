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

    // Interior-anchor surfacing: a span that parses cleanly may still carry a
    // hand-edited anchor pointing inside the span root. Surface each such
    // anchor as a loud, actionable, per-span finding (parse stays pure so the
    // span remains repairable via `git span remove`/`delete`).
    for v in crate::cli::interior_anchor::scan_interior_anchors(repo, span_root)? {
        findings.push(v.report_block(span_root));
    }

    let exit = if findings.is_empty() {
        println!("span doctor: {n_spans} spans checked, no findings.{IDEMPOTENT_TAG}");
        0
    } else {
        println!("# span doctor");
        println!();
        println!("{n_spans} spans checked, {} findings.", findings.len());
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

/// Report the persistent store's size against its configured quota, plus any
/// corruption/schema-mismatch recovery this open performed (card main-157
/// Phase 6B). Health diagnostics only — never changes the doctor exit code.
///
/// Reads the store non-invasively: if the database file does not yet exist it
/// reports that and the configured cap without creating one, so `doctor` never
/// materializes a store as a side effect. The configured cap comes from the
/// same precedence chain the production quota trigger uses
/// ([`crate::resolver::exact::store_max_bytes`]).
fn report_store_diagnostics(repo: &gix::Repository) {
    use crate::resolver::store::schema::DB_BASENAME;

    let cap = crate::resolver::exact::store_max_bytes(repo);
    let db_path = crate::git::common_dir(repo).join("span").join(DB_BASENAME);

    println!("## Store");
    println!();
    println!("- Configured cap: {cap} bytes.");

    if !db_path.exists() {
        println!("- No persistent store yet at `{}`.", db_path.display());
        return;
    }

    match crate::resolver::store::CacheStore::open(repo) {
        Ok(store) => match store.database_size_bytes() {
            Ok(size) => {
                let pct = size.saturating_mul(100).checked_div(cap).unwrap_or(0);
                println!("- On-disk size: {size} bytes ({pct}% of cap).");
                if let Some(reason) = store.recovered_on_open() {
                    println!("- Recovered from a quarantined database on open: {reason:?}.");
                }
            }
            Err(e) => println!("- Size unavailable: {e}."),
        },
        Err(e) => println!("- Present but could not be opened: {e}."),
    }
}
