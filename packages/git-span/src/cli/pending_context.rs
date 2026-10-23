//! Read-only, comparison-aware membership with complete current span evidence.

use super::{PendingContextArgs, PendingInspection, context};
use crate::types::{AnchorExtent, AnchorResolved, EngineOptions, LayerSet, SpanResolved};
use anyhow::{Context, Result, ensure};
use context::{ContextDocument, ContextMutation, ContextSnapshot, EvidencePaths};
use std::{
    collections::BTreeSet,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_PATHS: usize = 4096;
const MAX_ARGUMENT_BYTES: usize = 65536;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Comparison {
    Staged,
    Unstaged,
    Head,
}
#[derive(Clone, Debug, Eq, PartialEq)]
struct Change {
    comparison: Comparison,
    old_path: String,
    new_path: String,
    old_ranges: Vec<(u32, u32)>,
    new_ranges: Vec<(u32, u32)>,
    whole: bool,
}
#[derive(Debug)]
struct Selection {
    comparisons: Vec<Comparison>,
    options: Vec<String>,
    paths: Vec<String>,
    untracked: bool,
    ignored: bool,
}

// Git emits NUL-separated key/newline/value records in precedence order.
// A key without a newline is a bare boolean; the last occurrence wins.
fn config_value<'a>(configuration: &'a [u8], key: &[u8]) -> Option<Option<&'a [u8]>> {
    configuration
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let newline = record.iter().position(|byte| *byte == b'\n');
            let (name, value) = match newline {
                Some(offset) => (&record[..offset], Some(&record[offset + 1..])),
                None => (record, None),
            };
            name.eq_ignore_ascii_case(key).then_some(value)
        })
        .next_back()
}

fn config_boolean(value: Option<&[u8]>) -> Result<bool> {
    let Some(value) = value else {
        return Ok(true);
    };
    let value = std::str::from_utf8(value)
        .context("boolean configuration is not UTF-8")?
        .trim()
        .to_ascii_lowercase();
    match value.as_str() {
        "true" | "yes" | "on" => Ok(true),
        "false" | "no" | "off" | "" => Ok(false),
        _ => value
            .parse::<i64>()
            .map(|number| number != 0)
            .context("invalid boolean configuration"),
    }
}

fn relative_selection(configuration: &[u8]) -> Result<bool> {
    config_value(configuration, b"diff.relative")
        .map(config_boolean)
        .transpose()
        .map(|value| value.unwrap_or(false))
        .context("invalid diff.relative configuration")
}

fn untracked_selection(configuration: &[u8]) -> Result<bool> {
    match config_value(configuration, b"status.showUntrackedFiles") {
        None | Some(Some(b"normal" | b"all")) => Ok(true),
        Some(value) => {
            config_boolean(value).context("invalid status.showUntrackedFiles configuration")
        }
    }
}

fn selection(configuration: &[u8], args: &PendingContextArgs) -> Result<Selection> {
    ensure!(
        args.arguments.len() <= MAX_PATHS
            && args.arguments.iter().map(String::len).sum::<usize>() <= MAX_ARGUMENT_BYTES,
        "pending-context argument limit exceeded"
    );
    let status = args.inspection == PendingInspection::Status;
    let mut selected = Selection {
        comparisons: if status {
            vec![Comparison::Staged, Comparison::Unstaged]
        } else {
            vec![Comparison::Unstaged]
        },
        options: Vec::new(),
        paths: Vec::new(),
        untracked: status && untracked_selection(configuration)?,
        ignored: false,
    };
    let mut args = args.arguments.iter().peekable();
    while let Some(arg) = args.next() {
        if arg == "--" {
            selected.paths.extend(args.cloned());
            break;
        }
        let value = arg.split_once('=').map(|(_, value)| value);
        let name = arg.split('=').next().expect("split always yields one item");
        if status {
            match name {
                "-s" | "--short" | "--porcelain" | "-b" | "--branch" | "--show-stash" | "-z"
                | "--null" | "--long" | "--column" | "--no-column" | "--ahead-behind"
                | "--no-ahead-behind" | "--renames" | "--no-renames" => continue,
                "-u" | "--untracked-files" => {
                    let value = value.unwrap_or("all");
                    ensure!(
                        matches!(value, "no" | "normal" | "all"),
                        "unsupported status untracked-files value: {value}"
                    );
                    selected.untracked = value != "no";
                    continue;
                }
                "--ignored" => {
                    let value = value.unwrap_or("traditional");
                    ensure!(
                        matches!(value, "traditional" | "matching" | "no"),
                        "unsupported status ignored value: {value}"
                    );
                    selected.ignored = value != "no";
                    continue;
                }
                "-uno" | "-unormal" | "-uall" => {
                    selected.untracked = name != "-uno";
                    continue;
                }
                _ if !arg.starts_with('-') => {
                    selected.paths.push(arg.clone());
                    continue;
                }
                _ => anyhow::bail!("unsupported pending-context status option: {arg}"),
            }
        }
        match name {
            "--staged" | "--cached" => {
                ensure!(
                    selected.comparisons != [Comparison::Head],
                    "unsupported combined HEAD/cached comparison"
                );
                selected.comparisons = vec![Comparison::Staged];
            }
            "HEAD" => {
                ensure!(
                    selected.comparisons == [Comparison::Unstaged],
                    "unsupported repeated or staged HEAD comparison"
                );
                selected.comparisons = vec![Comparison::Head];
            }
            "--diff-filter" => {
                selected.options.push(arg.clone());
                if value.is_none() {
                    selected
                        .options
                        .push(args.next().context("diff-filter requires a value")?.clone());
                }
            }
            "--no-renames" | "--find-renames" => selected.options.push(arg.clone()),
            "-p"
            | "--patch"
            | "-s"
            | "--no-patch"
            | "-u"
            | "--raw"
            | "--patch-with-raw"
            | "--patch-with-stat"
            | "--numstat"
            | "--shortstat"
            | "--dirstat"
            | "--dirstat-by-file"
            | "--cumulative"
            | "--name-only"
            | "--name-status"
            | "--stat"
            | "--compact-summary"
            | "--summary"
            | "--quiet"
            | "--exit-code"
            | "--color"
            | "--no-color"
            | "--no-prefix"
            | "--default-prefix"
            | "--src-prefix"
            | "--dst-prefix"
            | "--line-prefix"
            | "--inter-hunk-context"
            | "--stat-width"
            | "--stat-name-width"
            | "--stat-graph-width"
            | "--stat-count"
            | "--word-diff"
            | "--word-diff-regex"
            | "--color-words"
            | "-z"
            | "--abbrev"
            | "--full-index" => {
                if value.is_none()
                    && matches!(
                        name,
                        "--src-prefix"
                            | "--dst-prefix"
                            | "--line-prefix"
                            | "--inter-hunk-context"
                            | "--stat-width"
                            | "--stat-name-width"
                            | "--stat-graph-width"
                            | "--stat-count"
                            | "--word-diff-regex"
                    )
                {
                    let _ = args
                        .next()
                        .context("presentation option requires a value")?;
                }
            }
            "-U" | "--unified" => {
                if value.is_none() {
                    let _ = args.next().context("context width requires a value")?;
                }
            }
            _ if arg.starts_with("-U") && arg[2..].parse::<u32>().is_ok() => {}
            _ if arg.starts_with("-M") => selected.options.push(arg.clone()),
            _ => anyhow::bail!(
                "unsupported pending-context diff argument: {arg}; paths require -- and only HEAD is supported as a reference"
            ),
        }
    }
    Ok(selected)
}

/// Every subprocess is read-only and independently bounded, including pipes.
fn git(cwd: &Path, args: &[String], budget: Instant) -> Result<Vec<u8>> {
    ensure!(
        budget.elapsed() < Duration::from_secs(20),
        "pending-context collection deadline exceeded"
    );
    let mut child = Command::new("git")
        .current_dir(cwd)
        .args(["--no-optional-locks", "-c", "core.fsmonitor=false"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("start pending-context Git query")?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let output = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let start = Instant::now();
    let exit = loop {
        if let Some(exit) = child.try_wait()? {
            break exit;
        }
        if start.elapsed() > Duration::from_secs(10) || budget.elapsed() > Duration::from_secs(20) {
            child.kill()?;
            child.wait()?;
            anyhow::bail!("pending-context Git query deadline exceeded");
        }
        std::thread::sleep(Duration::from_millis(2));
    };
    let output = output
        .join()
        .map_err(|_| anyhow::anyhow!("pending-context output reader panicked"))??;
    let errors = errors
        .join()
        .map_err(|_| anyhow::anyhow!("pending-context error reader panicked"))??;
    ensure!(
        output.len() <= MAX_BYTES && errors.len() <= 65536,
        "pending-context Git query exceeded output bound"
    );
    ensure!(
        exit.success(),
        "pending-context Git query failed: {}",
        String::from_utf8_lossy(&errors).trim()
    );
    Ok(output)
}

fn diff_args(comparison: Comparison) -> Vec<String> {
    let mut args = vec![
        "diff".into(),
        "--no-ext-diff".into(),
        "--no-textconv".into(),
        "--no-color".into(),
        "--no-relative".into(),
    ];
    match comparison {
        Comparison::Staged => args.push("--cached".into()),
        Comparison::Head => args.push("HEAD".into()),
        Comparison::Unstaged => {}
    }
    args
}
fn path(bytes: &[u8]) -> Result<String> {
    let path = std::str::from_utf8(bytes)
        .context("pending-context requires UTF-8 paths")?
        .to_owned();
    crate::span_root::validate_repo_relative_path("pending-context path", &path)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(path)
}
fn hunk_range(value: &str) -> Result<Option<(u32, u32)>> {
    let (start, count) = value.split_once(',').unwrap_or((value, "1"));
    let start = start
        .parse::<u32>()
        .context("invalid pending diff hunk start")?;
    let count = count
        .parse::<u32>()
        .context("invalid pending diff hunk count")?;
    if count == 0 {
        return Ok(None);
    }
    Ok(Some((
        start,
        start
            .checked_add(count - 1)
            .context("pending diff hunk overflow")?,
    )))
}
fn changes(
    repo: &gix::Repository,
    cwd: &Path,
    selected: &Selection,
    budget: Instant,
) -> Result<Vec<Change>> {
    let root = crate::git::work_dir(repo)?;
    let mut changes = Vec::new();
    let mut collection_bytes = 0usize;
    for &comparison in &selected.comparisons {
        let mut args = diff_args(comparison);
        args.extend(selected.options.iter().cloned());
        args.extend(["--raw".into(), "-z".into(), "--".into()]);
        args.extend(selected.paths.iter().cloned());
        let raw = git(cwd, &args, budget)?;
        collection_bytes += raw.len();
        let mut records = raw.split(|b| *b == 0).filter(|part| !part.is_empty());
        while let Some(header) = records.next() {
            ensure!(
                changes.len() < MAX_PATHS,
                "pending-context path limit exceeded"
            );
            let header = std::str::from_utf8(header).context("invalid pending raw metadata")?;
            let fields: Vec<_> = header.split_whitespace().collect();
            ensure!(
                fields.len() == 5 && fields[0].starts_with(':'),
                "unsupported pending raw record"
            );
            let status = fields[4];
            let old_path = path(records.next().context("missing pending raw path")?)?;
            let new_path = if status.starts_with(['R', 'C']) {
                path(
                    records
                        .next()
                        .context("missing pending rename destination")?,
                )?
            } else {
                old_path.clone()
            };
            let mut change = Change {
                comparison,
                old_path,
                new_path,
                old_ranges: Vec::new(),
                new_ranges: Vec::new(),
                whole: !status.starts_with('M')
                    && !status.starts_with('R')
                    && !status.starts_with('C')
                    || status == "R100"
                    || status == "C100"
                    || fields[0].trim_start_matches(':') != fields[1],
            };
            if !change.whole {
                let mut args = diff_args(comparison);
                args.extend(selected.options.iter().cloned());
                args.extend([
                    "--patch".into(),
                    "--unified=0".into(),
                    "--inter-hunk-context=0".into(),
                    "--src-prefix=a/".into(),
                    "--dst-prefix=b/".into(),
                    "--".into(),
                    format!(":(literal){}", change.old_path),
                ]);
                if change.old_path != change.new_path {
                    args.push(format!(":(literal){}", change.new_path));
                }
                let patch = git(root, &args, budget)?;
                collection_bytes = collection_bytes
                    .checked_add(patch.len())
                    .context("pending collection size overflow")?;
                ensure!(
                    collection_bytes <= MAX_BYTES,
                    "pending-context collection exceeded byte limit"
                );
                let patch = std::str::from_utf8(&patch)
                    .context("pending-context requires UTF-8 patch evidence")?;
                for line in patch.lines().filter(|line| line.starts_with("@@ ")) {
                    let mut fields = line.split_whitespace();
                    let _ = fields.next();
                    let old = fields
                        .next()
                        .and_then(|s| s.strip_prefix('-'))
                        .context("invalid old pending hunk")?;
                    let new = fields
                        .next()
                        .and_then(|s| s.strip_prefix('+'))
                        .context("invalid new pending hunk")?;
                    if let Some(range) = hunk_range(old)? {
                        change.old_ranges.push(range);
                    }
                    if let Some(range) = hunk_range(new)? {
                        change.new_ranges.push(range);
                    }
                }
                change.whole = change.old_ranges.is_empty() && change.new_ranges.is_empty();
            }
            changes.push(change);
        }
    }
    for ignored in [false, true] {
        if !selected.untracked || (ignored && !selected.ignored) {
            continue;
        }
        let mut args = vec![
            "ls-files".into(),
            "--full-name".into(),
            "--others".into(),
            "--exclude-standard".into(),
            "-z".into(),
        ];
        if ignored {
            args.push("--ignored".into());
        }
        args.push("--".into());
        args.extend(selected.paths.iter().cloned());
        let output = git(cwd, &args, budget)?;
        for name in output.split(|b| *b == 0).filter(|p| !p.is_empty()) {
            ensure!(
                changes.len() < MAX_PATHS,
                "pending-context path limit exceeded"
            );
            let path = path(name)?;
            changes.push(Change {
                comparison: Comparison::Unstaged,
                old_path: path.clone(),
                new_path: path,
                old_ranges: vec![],
                new_ranges: vec![],
                whole: true,
            });
        }
    }
    Ok(changes)
}

fn touches(
    anchor: &AnchorResolved,
    path: &str,
    ranges: &[(u32, u32)],
    whole: bool,
) -> Result<bool> {
    let location = if whole {
        anchor.current.as_ref().unwrap_or(&anchor.anchored)
    } else if let Some(current) = &anchor.current {
        current
    } else {
        ensure!(
            anchor.anchored.path.to_str() != Some(path)
                || !matches!(
                    anchor.status,
                    crate::types::AnchorStatus::ContentUnavailable(_)
                ),
            "pending-context comparison location unavailable for {path}"
        );
        // Recorded addresses identify declarations, not absent layer content.
        return Ok(false);
    };
    if location.path.to_str() != Some(path) {
        return Ok(false);
    }
    if whole || location.extent == AnchorExtent::WholeFile {
        return Ok(true);
    }
    Ok(match location.extent {
        AnchorExtent::WholeFile => true,
        AnchorExtent::LineRange { start, end } => {
            ranges.iter().any(|&(s, e)| start <= e && s <= end)
        }
    })
}
fn selected_span(
    span: &SpanResolved,
    head: &SpanResolved,
    index: &SpanResolved,
    changes: &[Change],
) -> Result<bool> {
    for change in changes {
        let (old, new) = match change.comparison {
            Comparison::Staged => (head, index),
            Comparison::Unstaged => (index, span),
            Comparison::Head => (head, span),
        };
        for (projection, path, ranges) in [
            (old, change.old_path.as_str(), change.old_ranges.as_slice()),
            (new, change.new_path.as_str(), change.new_ranges.as_slice()),
        ] {
            for anchor in &projection.anchors {
                if touches(anchor, path, ranges, change.whole)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

/// Collect a coherent complete document, or fail without partial output.
///
/// Selection uses the requested Git comparison; returned scopes/overlaps are
/// empty because comparison-layer membership is not context-address overlap.
pub fn pending_context(
    repo: &gix::Repository,
    args: &PendingContextArgs,
    span_root: &str,
) -> Result<ContextDocument> {
    for variable in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
    ] {
        ensure!(
            std::env::var_os(variable).is_none(),
            "pending-context does not support alternate repository environment {variable}"
        );
    }
    ensure!(
        repo.rev_parse_single("HEAD").is_ok(),
        "pending-context unavailable: unborn or unresolved HEAD"
    );
    crate::git::reject_replacement_topology(repo)?;
    let cwd = std::env::current_dir()?.canonicalize()?;
    let root = crate::git::work_dir(repo)?.canonicalize()?;
    ensure!(
        cwd.starts_with(&root),
        "pending-context cwd is outside the repository worktree"
    );
    if std::env::var_os("GIT_SPAN_PENDING_TEST_PAUSE_BEFORE_CONFIG").is_some() {
        context::context_test_checkpoint(repo, "pending-before-config")?;
    }
    let budget = Instant::now();
    // Selection-only configuration is outside the resolver's cache token.
    // Bind it independently without exposing potentially sensitive values.
    let configuration = git(
        &cwd,
        &["config".into(), "--null".into(), "--list".into()],
        budget,
    )?;
    ensure!(
        !relative_selection(&configuration)?,
        "pending-context does not support diff.relative=true"
    );
    let selected = selection(&configuration, args)?;
    let first = changes(repo, &cwd, &selected, budget)?;
    let paths: BTreeSet<_> = first
        .iter()
        .flat_map(|c| [c.old_path.clone(), c.new_path.clone()])
        .collect();
    let authority =
        crate::descriptor_authority::SpanRootAuthority::open_optional(&root, span_root)?;
    let snapshot = match &authority {
        Some(authority) => context::capture_snapshot(repo, span_root, authority)?,
        None => ContextSnapshot {
            definitions: Vec::new(),
        },
    };
    let (resolved, covered, token) = if let Some(authority) = &authority {
        let capture = context::close_context_capture(repo, span_root, &snapshot, authority, paths)?;
        (capture.resolved, capture.paths, capture.token)
    } else {
        let token = crate::resolver::core::capture::capture_state_token_with_extra_paths(
            repo,
            span_root,
            EngineOptions::full(),
            &paths,
            None,
        )?;
        (Vec::new(), paths, token)
    };
    let captured = changes(repo, &cwd, &selected, budget)?;
    ensure!(
        first == captured,
        "pending-context selected changes changed during collection"
    );
    let head = crate::resolver::resolve_loaded_spans(
        repo,
        &snapshot.definitions,
        EngineOptions::committed_only(),
    )?;
    let index = crate::resolver::resolve_loaded_spans(
        repo,
        &snapshot.definitions,
        EngineOptions {
            layers: LayerSet {
                index: true,
                worktree: false,
                staged_span: true,
            },
            ..EngineOptions::full()
        },
    )?;
    let evidence = EvidencePaths::new(&token);
    let mut spans = Vec::new();
    for span in resolved {
        let head = head
            .iter()
            .find(|s| s.name == span.name)
            .context("missing HEAD span projection")?;
        let index = index
            .iter()
            .find(|s| s.name == span.name)
            .context("missing index span projection")?;
        if selected_span(&span, head, index, &captured)? {
            spans.push(context::context_span_from_resolved(
                span,
                Vec::new(),
                &evidence,
            ));
        }
    }
    spans.sort_by(|a, b| a.name.cmp(&b.name));
    let document = ContextDocument {
        schema_version: context::CONTEXT_SCHEMA_VERSION,
        scopes: Vec::new(),
        mutation: ContextMutation::default(),
        spans,
    };
    let _ = context::render_document(&document)?;
    ensure!(
        captured == changes(repo, &cwd, &selected, budget)?,
        "pending-context selected changes changed during collection"
    );
    if let Some(authority) = &authority {
        ensure!(
            snapshot == context::capture_snapshot(repo, span_root, authority)?,
            "pending-context span definitions changed during collection"
        );
    }
    ensure!(
        configuration
            == git(
                &cwd,
                &["config".into(), "--null".into(), "--list".into()],
                budget
            )?,
        "pending-context Git configuration changed during collection"
    );
    match crate::resolver::core::capture::revalidate_with_extra_paths(
        repo,
        span_root,
        EngineOptions::full(),
        &covered,
        &token,
    )? {
        crate::resolver::core::capture::Revalidation::Unchanged => {}
        crate::resolver::core::capture::Revalidation::Changed { field } => {
            anyhow::bail!("pending-context repository {field} changed during collection")
        }
    }
    Ok(document)
}

/// Print exactly one schema-v2 document after successful complete collection.
pub fn run_pending_context(
    repo: &gix::Repository,
    args: PendingContextArgs,
    span_root: &str,
) -> Result<i32> {
    let document = pending_context(repo, &args, span_root)?;
    let bytes = context::render_document(&document)?;
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(0)
}
