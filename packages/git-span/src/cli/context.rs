//! Exact, batched dependency-context query.

use crate::cli::ContextArgs;
use crate::types::{AnchorExtent, AnchorStatus, DriftSource, EngineOptions, Span, SpanResolved};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io::Write;
use std::path::Path;

pub const CONTEXT_SCHEMA_VERSION: u32 = 1;
pub const MAX_CONTEXT_ADDRESSES: usize = 4096;
pub const MAX_CONTEXT_DETAIL_BYTES: usize = 4096;
pub const MAX_CONTEXT_JSON_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContextExtent {
    Whole,
    Lines { start: u32, end: u32 },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct ContextScope {
    pub path: String,
    pub extent: ContextExtent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextLocation {
    pub path: String,
    pub extent: ContextExtent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextOverlapBasis {
    Anchored,
    Current,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextAnchorIdentity {
    pub ordinal: usize,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextOverlap {
    pub scope: usize,
    pub anchor: ContextAnchorIdentity,
    pub basis: ContextOverlapBasis,
    pub location: ContextLocation,
    pub intersection: ContextExtent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextSource {
    Worktree,
    Index,
    Head,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextUnavailableReason {
    LfsNotFetched,
    LfsNotInstalled,
    PromisorMissing,
    SparseExcluded,
    FilterFailed,
    IoError,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextStatus {
    Fresh,
    ResolvedPendingCommit,
    Moved,
    Changed,
    Deleted,
    Conflict,
    Submodule,
    ContentUnavailable {
        reason: ContextUnavailableReason,
        detail: Value,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextAnchor {
    pub ordinal: usize,
    pub id: String,
    pub anchored: ContextLocation,
    pub current: Option<ContextLocation>,
    pub status: ContextStatus,
    pub source: Option<ContextSource>,
    pub sources: Vec<ContextSource>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextSpan {
    pub name: String,
    pub why: Option<String>,
    pub overlaps: Vec<ContextOverlap>,
    pub anchors: Vec<ContextAnchor>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextMutation {
    pub requested: bool,
    pub rewritten: bool,
    pub spans_touched: usize,
    pub anchors_updated: usize,
    pub anchors_removed: usize,
    pub identities_collapsed: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextDocument {
    pub schema_version: u32,
    pub scopes: Vec<ContextScope>,
    pub mutation: ContextMutation,
    pub spans: Vec<ContextSpan>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContextSnapshot {
    definitions: Vec<(String, Span)>,
}

struct ClosedContextCapture {
    resolved: Vec<SpanResolved>,
    paths: BTreeSet<String>,
    token: crate::resolver::core::token::StateToken,
}

pub(crate) struct ContextServiceSeed {
    pub(crate) spans: Vec<ContextSpan>,
    pub(crate) known_paths: BTreeSet<String>,
    pub(crate) external_watch_roots: BTreeSet<std::path::PathBuf>,
}

fn capture_snapshot(
    repo: &gix::Repository,
    span_root: &str,
    authority: &crate::descriptor_authority::SpanRootAuthority,
) -> Result<ContextSnapshot> {
    let (definitions, conflicted) =
        crate::span::read::load_all_spans_strict_in(repo, span_root, authority)?;
    if !conflicted.is_empty() {
        let names = conflicted
            .iter()
            .map(|(name, _)| format!("`{name}`"))
            .collect::<Vec<_>>()
            .join(", ");
        anyhow::bail!(
            "context requires one coherent span corpus, but conflicted definitions were found: {names}"
        );
    }
    Ok(ContextSnapshot { definitions })
}

fn resolve_snapshot(
    repo: &gix::Repository,
    snapshot: &ContextSnapshot,
) -> Result<Vec<SpanResolved>> {
    crate::resolver::resolve_loaded_spans(repo, &snapshot.definitions, EngineOptions::full())
        .map_err(Into::into)
}

fn resolved_paths(resolved: &[SpanResolved]) -> BTreeSet<String> {
    resolved
        .iter()
        .flat_map(|span| {
            span.anchors.iter().flat_map(|anchor| {
                std::iter::once(normalized_location_path(&anchor.anchored))
                    .chain(anchor.current.as_ref().map(normalized_location_path))
            })
        })
        .collect()
}

fn close_context_capture(
    repo: &gix::Repository,
    span_root: &str,
    snapshot: &ContextSnapshot,
    authority: &crate::descriptor_authority::SpanRootAuthority,
    query_paths: impl IntoIterator<Item = String>,
) -> Result<ClosedContextCapture> {
    let discovery = resolve_snapshot(repo, snapshot)?;
    let mut paths = resolved_paths(&discovery);
    paths.extend(query_paths);
    context_test_checkpoint(repo, "after-discovery")?;

    let token = crate::resolver::core::capture::capture_state_token_with_extra_paths(
        repo,
        span_root,
        EngineOptions::full(),
        &paths,
        None,
    )?;
    let closed_snapshot = capture_snapshot(repo, span_root, authority)?;
    anyhow::ensure!(
        closed_snapshot == *snapshot,
        "span definitions changed while resolving context"
    );
    context_test_checkpoint(repo, "after-capture")?;

    let resolved = resolve_snapshot(repo, &closed_snapshot)?;
    let final_paths = resolved_paths(&resolved);
    let new_paths = final_paths.difference(&paths).cloned().collect::<Vec<_>>();
    anyhow::ensure!(
        new_paths.is_empty(),
        "resolver discovered uncaptured current destination(s) while resolving context: {}",
        new_paths.join(", ")
    );
    context_test_checkpoint(repo, "after-render")?;
    match crate::resolver::core::capture::revalidate_with_extra_paths(
        repo,
        span_root,
        EngineOptions::full(),
        &paths,
        &token,
    )? {
        crate::resolver::core::capture::Revalidation::Unchanged => {}
        crate::resolver::core::capture::Revalidation::Changed { field } => {
            anyhow::bail!("repository {field} changed while resolving context")
        }
    }
    Ok(ClosedContextCapture {
        resolved,
        paths,
        token,
    })
}

fn parse_context_address(address: &str) -> Result<(String, ContextExtent)> {
    anyhow::ensure!(!address.is_empty(), "context path must not be empty");
    anyhow::ensure!(
        !address
            .chars()
            .any(|character| matches!(character, '*' | '?' | '[' | ']' | '{' | '}')),
        "context addresses are exact paths, not globs: `{address}`"
    );
    if let Some(hash) = address.rfind("#L") {
        let fragment = &address[hash + 2..];
        if fragment.contains("-L") {
            let (path, start, end) = crate::cli::parse_range_address(address)?;
            return Ok((path, ContextExtent::Lines { start, end }));
        }
    }
    Ok((address.to_owned(), ContextExtent::Whole))
}

fn canonicalize_path(path: &str) -> Result<String> {
    let normalized = path.replace('\\', "/");
    anyhow::ensure!(
        !normalized.starts_with('/')
            && !normalized
                .as_bytes()
                .get(1)
                .is_some_and(|second| *second == b':'),
        "context path must be repository-relative: `{path}`"
    );
    let mut components = Vec::new();
    for component in normalized.split('/') {
        match component {
            "" | "." => {}
            ".." => anyhow::bail!("context path must not contain `..`: `{path}`"),
            other => components.push(other),
        }
    }
    anyhow::ensure!(!components.is_empty(), "context path must not be empty");
    Ok(components.join("/"))
}

fn raw_query_paths(addresses: &[String]) -> Result<Vec<String>> {
    addresses
        .iter()
        .map(|address| {
            parse_context_address(address).and_then(|(path, _)| canonicalize_path(&path))
        })
        .collect()
}

fn normalize_scopes(
    repo: &gix::Repository,
    addresses: &[String],
    snapshot: &ContextSnapshot,
) -> Result<Vec<ContextScope>> {
    anyhow::ensure!(
        !addresses.is_empty(),
        "context requires at least one address"
    );
    anyhow::ensure!(
        addresses.len() <= MAX_CONTEXT_ADDRESSES,
        "context accepts at most {MAX_CONTEXT_ADDRESSES} addresses (got {})",
        addresses.len()
    );

    let snapshot_paths: HashSet<&str> = snapshot
        .definitions
        .iter()
        .flat_map(|(_, span)| span.anchors.iter().map(|(_, anchor)| anchor.path.as_str()))
        .collect();
    let index_paths: HashSet<String> = crate::git::index_entries(repo)?
        .into_iter()
        .map(|entry| entry.path)
        .collect();
    let head = repo
        .rev_parse_single("HEAD")
        .ok()
        .map(|id| id.detach().to_string());
    let workdir = repo
        .workdir()
        .context("bare repositories are not supported")?;

    let mut by_path: BTreeMap<String, Vec<ContextExtent>> = BTreeMap::new();
    for address in addresses {
        let (raw_path, extent) = parse_context_address(address)?;
        let path = canonicalize_path(&raw_path)?;
        crate::span_root::validate_repo_relative_path("context path", &path)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let exists = workdir.join(&path).exists()
            || index_paths.contains(&path)
            || snapshot_paths.contains(path.as_str())
            || head.as_ref().is_some_and(|head| {
                crate::git::tree_entry_at(repo, head, Path::new(&path))
                    .ok()
                    .flatten()
                    .is_some()
            });
        anyhow::ensure!(
            exists,
            "context path `{path}` does not exist in the worktree, index, HEAD, or span snapshot"
        );
        by_path.entry(path).or_default().push(extent);
    }

    let mut scopes = Vec::new();
    for (path, mut extents) in by_path {
        if extents.contains(&ContextExtent::Whole) {
            scopes.push(ContextScope {
                path,
                extent: ContextExtent::Whole,
            });
            continue;
        }
        extents.sort();
        let mut merged: Vec<ContextExtent> = Vec::with_capacity(extents.len());
        for extent in extents {
            let ContextExtent::Lines { start, end } = extent else {
                unreachable!("whole-file scopes were handled above")
            };
            match merged.last_mut() {
                Some(ContextExtent::Lines { end: prior_end, .. }) if start <= *prior_end => {
                    *prior_end = (*prior_end).max(end);
                }
                _ => merged.push(ContextExtent::Lines { start, end }),
            }
        }
        scopes.extend(merged.into_iter().map(|extent| ContextScope {
            path: path.clone(),
            extent,
        }));
    }
    crate::perf::counter("context.input-scopes", scopes.len() as u64);
    Ok(scopes)
}

fn normalized_location_path(location: &crate::types::AnchorLocation) -> String {
    location.path.to_string_lossy().replace('\\', "/")
}

fn location_from_domain(location: &crate::types::AnchorLocation) -> ContextLocation {
    ContextLocation {
        path: normalized_location_path(location),
        extent: match location.extent {
            AnchorExtent::WholeFile => ContextExtent::Whole,
            AnchorExtent::LineRange { start, end } => ContextExtent::Lines { start, end },
        },
    }
}

fn intersection(scope: &ContextScope, location: &ContextLocation) -> Option<ContextExtent> {
    if scope.path != location.path {
        return None;
    }
    match (&scope.extent, &location.extent) {
        (ContextExtent::Whole, ContextExtent::Whole) => Some(ContextExtent::Whole),
        (ContextExtent::Whole, ContextExtent::Lines { start, end })
        | (ContextExtent::Lines { start, end }, ContextExtent::Whole) => {
            Some(ContextExtent::Lines {
                start: *start,
                end: *end,
            })
        }
        (
            ContextExtent::Lines {
                start: scope_start,
                end: scope_end,
            },
            ContextExtent::Lines {
                start: location_start,
                end: location_end,
            },
        ) => {
            let start = (*scope_start).max(*location_start);
            let end = (*scope_end).min(*location_end);
            (start <= end).then_some(ContextExtent::Lines { start, end })
        }
    }
}

fn context_source(source: DriftSource) -> ContextSource {
    match source {
        DriftSource::Head => ContextSource::Head,
        DriftSource::Index => ContextSource::Index,
        DriftSource::Worktree => ContextSource::Worktree,
    }
}

fn bounded_detail(detail: &str) -> (&str, bool) {
    if detail.len() <= MAX_CONTEXT_DETAIL_BYTES {
        return (detail, false);
    }
    let mut end = MAX_CONTEXT_DETAIL_BYTES;
    while !detail.is_char_boundary(end) {
        end -= 1;
    }
    (&detail[..end], true)
}

fn context_status(status: &AnchorStatus) -> ContextStatus {
    use crate::types::UnavailableReason;
    match status {
        AnchorStatus::Fresh => ContextStatus::Fresh,
        AnchorStatus::ResolvedPendingCommit => ContextStatus::ResolvedPendingCommit,
        AnchorStatus::Moved => ContextStatus::Moved,
        AnchorStatus::Changed => ContextStatus::Changed,
        AnchorStatus::Deleted => ContextStatus::Deleted,
        AnchorStatus::MergeConflict => ContextStatus::Conflict,
        AnchorStatus::Submodule => ContextStatus::Submodule,
        AnchorStatus::ContentUnavailable(reason) => {
            let (reason, detail) = match reason {
                UnavailableReason::LfsNotFetched => {
                    (ContextUnavailableReason::LfsNotFetched, Value::Null)
                }
                UnavailableReason::LfsNotInstalled => {
                    (ContextUnavailableReason::LfsNotInstalled, Value::Null)
                }
                UnavailableReason::PromisorMissing => {
                    (ContextUnavailableReason::PromisorMissing, Value::Null)
                }
                UnavailableReason::SparseExcluded => {
                    (ContextUnavailableReason::SparseExcluded, Value::Null)
                }
                UnavailableReason::FilterFailed { filter } => {
                    let (filter, truncated) = bounded_detail(filter);
                    let mut detail = json!({"filter": filter});
                    if truncated {
                        detail["truncated"] = Value::Bool(true);
                    }
                    (ContextUnavailableReason::FilterFailed, detail)
                }
                UnavailableReason::IoError { message } => {
                    let (message, truncated) = bounded_detail(message);
                    let mut detail = json!({"message": message});
                    if truncated {
                        detail["truncated"] = Value::Bool(true);
                    }
                    (ContextUnavailableReason::IoError, detail)
                }
            };
            ContextStatus::ContentUnavailable { reason, detail }
        }
    }
}

fn context_span_from_resolved(span: SpanResolved, overlaps: Vec<ContextOverlap>) -> ContextSpan {
    let why = (!span.why.trim().is_empty()).then_some(span.why.clone());
    let anchors = span
        .anchors
        .into_iter()
        .enumerate()
        .map(|(ordinal, anchor)| ContextAnchor {
            ordinal,
            id: anchor.anchor_id,
            anchored: location_from_domain(&anchor.anchored),
            current: anchor.current.as_ref().map(location_from_domain),
            status: context_status(&anchor.status),
            source: anchor.source.map(context_source),
            sources: anchor
                .layer_sources
                .into_iter()
                .map(context_source)
                .collect(),
        })
        .collect();
    ContextSpan {
        name: span.name,
        why,
        overlaps,
        anchors,
    }
}

fn select_context(
    scopes: Vec<ContextScope>,
    resolved: Vec<SpanResolved>,
    mutation: ContextMutation,
) -> ContextDocument {
    let spans_considered = resolved.len() as u64;
    let mut spans = Vec::new();
    let mut anchors_considered = 0_u64;
    let mut anchors_selected = 0_u64;
    for span in resolved {
        let mut overlaps = Vec::new();
        for (ordinal, anchor) in span.anchors.iter().enumerate() {
            anchors_considered += 1;
            let anchored = location_from_domain(&anchor.anchored);
            for (scope_index, scope) in scopes.iter().enumerate() {
                if let Some(intersection) = intersection(scope, &anchored) {
                    overlaps.push(ContextOverlap {
                        scope: scope_index,
                        anchor: ContextAnchorIdentity {
                            ordinal,
                            id: anchor.anchor_id.clone(),
                        },
                        basis: ContextOverlapBasis::Anchored,
                        location: anchored.clone(),
                        intersection,
                    });
                }
                if let Some(current) = anchor.current.as_ref().map(location_from_domain)
                    && current != anchored
                    && let Some(intersection) = intersection(scope, &current)
                {
                    overlaps.push(ContextOverlap {
                        scope: scope_index,
                        anchor: ContextAnchorIdentity {
                            ordinal,
                            id: anchor.anchor_id.clone(),
                        },
                        basis: ContextOverlapBasis::Current,
                        location: current,
                        intersection,
                    });
                }
            }
        }
        if overlaps.is_empty() {
            continue;
        }
        overlaps.sort_by(|left, right| {
            (left.scope, left.anchor.ordinal, left.basis).cmp(&(
                right.scope,
                right.anchor.ordinal,
                right.basis,
            ))
        });
        anchors_selected += overlaps
            .iter()
            .map(|overlap| overlap.anchor.ordinal)
            .collect::<HashSet<_>>()
            .len() as u64;
        spans.push(context_span_from_resolved(span, overlaps));
    }
    spans.sort_by(|left, right| left.name.cmp(&right.name));
    crate::perf::counter("context.spans-considered", spans_considered);
    crate::perf::counter("context.spans-selected", spans.len() as u64);
    crate::perf::counter("context.anchors-considered", anchors_considered);
    crate::perf::counter("context.anchors-selected", anchors_selected);
    ContextDocument {
        schema_version: CONTEXT_SCHEMA_VERSION,
        scopes,
        mutation,
        spans,
    }
}

pub(crate) fn build_service_seed(
    repo: &gix::Repository,
    span_root: &str,
) -> Result<ContextServiceSeed> {
    let authority = crate::descriptor_authority::SpanRootAuthority::open(
        crate::git::work_dir(repo)?,
        span_root,
        crate::descriptor_authority::DirectoryPolicy::Existing,
    )?;
    let snapshot = capture_snapshot(repo, span_root, &authority)?;
    let capture =
        close_context_capture(repo, span_root, &snapshot, &authority, std::iter::empty())?;
    let mut known_paths = capture.paths.clone();
    known_paths.extend(
        crate::git::index_entries(repo)?
            .into_iter()
            .map(|entry| entry.path),
    );
    if let Ok(head) = repo.head_commit()
        && let Ok(tree) = head.tree()
        && let Ok(paths) = crate::resolver::walker::tree_all_paths(&tree)
    {
        known_paths.extend(paths);
    }

    let workdir = crate::git::work_dir(repo)?.to_path_buf();
    let mut external_watch_roots = BTreeSet::new();
    for dependency in &capture.token.filters {
        let Ok(parts) = shell_words::split(&dependency.command) else {
            continue;
        };
        let Some(program) = parts.first() else {
            continue;
        };
        let candidate = Path::new(program);
        let resolved = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else if program.contains('/') {
            workdir.join(candidate)
        } else {
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .map(|directory| directory.join(candidate))
                .find(|path| path.is_file())
                .unwrap_or_else(|| workdir.join(candidate))
        };
        if let Some(parent) = resolved.parent() {
            external_watch_roots.insert(parent.to_path_buf());
        }
    }

    let spans = capture
        .resolved
        .into_iter()
        .map(|span| context_span_from_resolved(span, Vec::new()))
        .collect();
    Ok(ContextServiceSeed {
        spans,
        known_paths,
        external_watch_roots,
    })
}

pub(crate) fn normalize_service_scopes(
    addresses: &[String],
    known_paths: &BTreeSet<String>,
    workdir: &Path,
) -> Result<Vec<ContextScope>> {
    anyhow::ensure!(
        !addresses.is_empty(),
        "context requires at least one address"
    );
    anyhow::ensure!(
        addresses.len() <= MAX_CONTEXT_ADDRESSES,
        "context accepts at most {MAX_CONTEXT_ADDRESSES} addresses (got {})",
        addresses.len()
    );
    let mut by_path: BTreeMap<String, Vec<ContextExtent>> = BTreeMap::new();
    for address in addresses {
        let (raw_path, extent) = parse_context_address(address)?;
        let path = canonicalize_path(&raw_path)?;
        crate::span_root::validate_repo_relative_path("context path", &path)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        anyhow::ensure!(
            known_paths.contains(&path) || workdir.join(&path).exists(),
            "context path `{path}` does not exist in the worktree, index, HEAD, or span snapshot"
        );
        by_path.entry(path).or_default().push(extent);
    }
    merge_scopes(by_path)
}

fn merge_scopes(by_path: BTreeMap<String, Vec<ContextExtent>>) -> Result<Vec<ContextScope>> {
    let mut scopes = Vec::new();
    for (path, mut extents) in by_path {
        if extents.contains(&ContextExtent::Whole) {
            scopes.push(ContextScope {
                path,
                extent: ContextExtent::Whole,
            });
            continue;
        }
        extents.sort();
        let mut merged: Vec<ContextExtent> = Vec::with_capacity(extents.len());
        for extent in extents {
            let ContextExtent::Lines { start, end } = extent else {
                unreachable!("whole-file scopes were handled above")
            };
            match merged.last_mut() {
                Some(ContextExtent::Lines { end: prior_end, .. }) if start <= *prior_end => {
                    *prior_end = (*prior_end).max(end);
                }
                _ => merged.push(ContextExtent::Lines { start, end }),
            }
        }
        scopes.extend(merged.into_iter().map(|extent| ContextScope {
            path: path.clone(),
            extent,
        }));
    }
    anyhow::ensure!(
        scopes.len() <= MAX_CONTEXT_ADDRESSES,
        "context normalized to more than {MAX_CONTEXT_ADDRESSES} scopes"
    );
    Ok(scopes)
}

pub(crate) fn context_intersection(
    scope: &ContextScope,
    location: &ContextLocation,
) -> Option<ContextExtent> {
    intersection(scope, location)
}

fn render_document(document: &ContextDocument) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(document)?;
    bytes.push(b'\n');
    anyhow::ensure!(
        bytes.len() <= MAX_CONTEXT_JSON_BYTES,
        "context response exceeds the {MAX_CONTEXT_JSON_BYTES}-byte JSON limit"
    );
    Ok(bytes)
}

fn context_test_checkpoint(_repo: &gix::Repository, checkpoint: &str) -> Result<()> {
    let Ok(directory) = std::env::var("GIT_SPAN_CONTEXT_TEST_HOOK_DIR") else {
        return Ok(());
    };
    let directory = Path::new(&directory);
    let token = uuid::Uuid::new_v4().to_string();
    std::fs::write(directory.join(format!("{checkpoint}.ready")), &token)?;
    let release = directory.join(format!("{checkpoint}.release"));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        if std::fs::read_to_string(&release).ok().as_deref() == Some(token.as_str()) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    anyhow::bail!("context test checkpoint `{checkpoint}` timed out")
}

fn run_context_read_only(
    repo: &gix::Repository,
    addresses: &[String],
    span_root: &str,
) -> Result<ContextDocument> {
    let Some(authority) = crate::descriptor_authority::SpanRootAuthority::open_optional(
        crate::git::work_dir(repo)?,
        span_root,
    )?
    else {
        let scopes = normalize_scopes(
            repo,
            addresses,
            &ContextSnapshot {
                definitions: Vec::new(),
            },
        )?;
        return Ok(select_context(
            scopes,
            Vec::new(),
            ContextMutation::default(),
        ));
    };
    let query_paths = raw_query_paths(addresses)?;
    let mut last_error = None;
    for attempt in 0..2 {
        let snapshot = capture_snapshot(repo, span_root, &authority)?;
        let scopes = normalize_scopes(repo, addresses, &snapshot)?;
        match close_context_capture(repo, span_root, &snapshot, &authority, query_paths.clone()) {
            Ok(capture) => {
                let _proof = (&capture.paths, &capture.token);
                return Ok(select_context(
                    scopes,
                    capture.resolved,
                    ContextMutation::default(),
                ));
            }
            Err(error) if attempt == 0 => last_error = Some(error),
            Err(error) => return Err(error),
        }
    }
    Err(last_error.expect("two-attempt loop records its first error"))
}

pub fn run_context(repo: &gix::Repository, args: ContextArgs, span_root: &str) -> Result<i32> {
    if args.fix {
        anyhow::bail!("context --fix is not implemented yet")
    }
    let document =
        match super::context_service::query(repo, span_root, &args.addresses).unwrap_or(None) {
            Some((document, counters)) => {
                crate::perf::counter("context.service-generation-hits", counters.generation_hits);
                crate::perf::counter("context.service-corpus-loads", counters.corpus_loads);
                crate::perf::counter("context.service-resolver-passes", counters.resolver_passes);
                crate::perf::counter("context.service-invalidations", counters.invalidations);
                crate::perf::counter(
                    "context.service-watcher-overflows",
                    counters.watcher_overflows,
                );
                crate::perf::counter("context.service-stale-fallbacks", counters.stale_fallbacks);
                crate::perf::counter("context.service-epoch-checks", counters.epoch_checks);
                crate::perf::counter("context.service-rows-decoded", counters.rows_decoded);
                crate::perf::counter("context.service-rpc-connect-us", counters.rpc_connect_us);
                crate::perf::counter(
                    "context.service-watcher-drain-us",
                    counters.watcher_drain_us,
                );
                crate::perf::counter("context.service-total-us", counters.total_latency_us);
                document
            }
            None => {
                crate::perf::counter("context.strict-fallbacks", 1);
                let _guard =
                    super::recovery_domain::acquire(repo, super::recovery_domain::Mode::Shared)?;
                run_context_read_only(repo, &args.addresses, span_root)?
            }
        };
    let bytes = render_document(&document)?;
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(0)
}
