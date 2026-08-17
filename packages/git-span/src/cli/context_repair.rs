//! Descriptor-rooted, journaled repair for `git span context --fix`.

use super::context::{
    ClosedContextCapture, ContextDocument, ContextExtent, ContextMutation, ContextScope,
    ContextSnapshot, canonicalize_path, capture_snapshot, close_context_capture, merge_scopes,
    normalize_scopes, parse_context_address, render_document, resolve_snapshot, select_context,
};
use anyhow::{Context, Result, ensure};
use git_span_core::{RK64_ALGORITHM, cheap_fingerprint_with_extent, rk64_to_hex};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::descriptor_authority::{
    DirectoryPolicy, RecoveryAuthority, RetainedDirectory, SpanRootAuthority,
};
use crate::span_file::SpanFile;
use crate::types::{AnchorExtent, AnchorResolved, AnchorStatus, DriftSource, EngineOptions};

const JOURNAL_VERSION: u32 = 3;
const JOURNAL_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const RECOVERY_PENDING: &str = "recovery.pending";
static BOUNDARY_STEP: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum JournalState {
    Prepared,
    Committed,
    Delivered,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct JournalEntry {
    name: String,
    original: String,
    planned: String,
    temporary: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RepairJournal {
    version: u32,
    operation_id: String,
    request_digest: String,
    scope_digest: String,
    created_unix_secs: u64,
    state: JournalState,
    applied: usize,
    addresses: Vec<String>,
    entries: Vec<JournalEntry>,
    response: ContextDocument,
}

#[derive(Debug, Deserialize, Serialize)]
struct RecoveryMarker {
    version: u32,
    operation_id: String,
    scope_digest: String,
    span_root: String,
    temporaries: Vec<MarkerTemporary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct MarkerTemporary {
    target_relative: String,
    relative: String,
    planned_digest: String,
    original: MarkerOriginal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum MarkerOriginal {
    Absent,
    Present { digest: String },
}

#[derive(Debug)]
struct PlannedSpan {
    name: String,
    original: String,
    planned: SpanFile,
}

/// Run a repair while the caller supplies the publication barrier. The
/// closure is invoked after the durable span bytes match the precomputed
/// response and before the journal becomes committed.
pub(super) fn execute(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
    operation_id: uuid::Uuid,
    publication_runtime: Option<&RetainedDirectory>,
    mut publish: impl FnMut(&ContextDocument) -> Result<()>,
) -> Result<ContextDocument> {
    let _domain = super::recovery_domain::acquire(repo, super::recovery_domain::Mode::Exclusive)?;
    let authority = SpanRootAuthority::open(
        crate::git::work_dir(repo)?,
        span_root,
        DirectoryPolicy::Existing,
    )?;
    let recovery = RecoveryAuthority::open(
        crate::git::git_dir(repo),
        crate::git::work_dir(repo)?,
        span_root,
    )?;
    let recovery_directory = recovery.directory()?;
    let journal_directory = recovery_directory.descend(
        std::path::Path::new("journal"),
        DirectoryPolicy::Private { mode: 0o700 },
    )?;
    expire_delivered_journals(&journal_directory)?;

    let digest = request_digest(addresses)?;
    let journal_leaf = journal_name(operation_id);
    if let Some(bytes) = journal_directory.read_optional(&journal_leaf)? {
        let mut journal: RepairJournal =
            serde_json::from_slice(&bytes).context("decode context repair journal")?;
        ensure!(
            journal.version == JOURNAL_VERSION,
            "unsupported context repair journal version"
        );
        ensure!(
            journal.operation_id == operation_id.to_string()
                && journal.request_digest == digest
                && journal.scope_digest == recovery.scope_digest(),
            "context operation ID is already bound to a different normalized request or recovery scope"
        );
        match journal.state {
            JournalState::Committed | JournalState::Delivered => {
                verify_persisted_response(repo, span_root, addresses, &journal.response)?;
                publish(&journal.response)?;
                authority.validate_bindings()?;
                validate_publication_runtime(publication_runtime)?;
                recovery.validate_bindings()?;
                clear_recovery_pending(
                    &recovery_directory,
                    operation_id,
                    recovery.scope_digest(),
                    span_root,
                )?;
                return Ok(journal.response);
            }
            JournalState::Prepared => {
                recover_prepared(
                    repo,
                    span_root,
                    &authority,
                    &journal_directory,
                    &journal_leaf,
                    &mut journal,
                )?;
                verify_persisted_response(repo, span_root, addresses, &journal.response)?;
                publish(&journal.response)?;
                boundary("generation-publication")?;
                authority.validate_bindings()?;
                validate_publication_runtime(publication_runtime)?;
                recovery.validate_bindings()?;
                journal.state = JournalState::Committed;
                persist_journal(&journal_directory, &journal_leaf, &journal)?;
                boundary("journal-committed")?;
                authority.validate_bindings()?;
                validate_publication_runtime(publication_runtime)?;
                recovery.validate_bindings()?;
                clear_recovery_pending(
                    &recovery_directory,
                    operation_id,
                    recovery.scope_digest(),
                    span_root,
                )?;
                return Ok(journal.response);
            }
        }
    }

    let (planned, response, capture) = plan_repair(repo, span_root, addresses, &authority)?;
    // The response is fully serialized and bounded before the first span temp
    // is created. This is the command-level transaction's immutable result.
    let _ = render_document(&response)?;
    revalidate_capture(repo, span_root, &capture)?;

    let targets = planned
        .iter()
        .map(|span| authority.target(&span.name, DirectoryPolicy::Existing))
        .collect::<Result<Vec<_>>>()?;
    // The `_domain` exclusive repository lock, held for the whole of
    // `execute()`, already covers this read-modify-write against concurrent
    // mutations of these spans — no per-span lock is taken here.

    let mut entries = Vec::with_capacity(planned.len());
    for (index, (span, target)) in planned.iter().zip(&targets).enumerate() {
        let temporary = format!(".context-{operation_id}-{index}.tmp");
        target.parent.unlink_if_exists(OsStr::new(&temporary))?;
        let mut file = target.parent.create_file(OsStr::new(&temporary), 0o644)?;
        let planned_bytes = span.planned.serialize();
        file.write_all(planned_bytes.as_bytes())?;
        file.sync_all()?;
        boundary(&format!("span-temp-fsync:{index}"))?;
        entries.push(JournalEntry {
            name: span.name.clone(),
            original: span.original.clone(),
            planned: planned_bytes,
            temporary,
        });
    }

    let mut journal = RepairJournal {
        version: JOURNAL_VERSION,
        operation_id: operation_id.to_string(),
        request_digest: digest,
        scope_digest: recovery.scope_digest().to_owned(),
        created_unix_secs: unix_now(),
        state: JournalState::Prepared,
        applied: 0,
        addresses: addresses.to_vec(),
        entries,
        response,
    };
    mark_recovery_pending(
        &recovery_directory,
        operation_id,
        recovery.scope_digest(),
        span_root,
        &journal.entries,
    )?;
    boundary("recovery-marker-persisted")?;
    persist_journal(&journal_directory, &journal_leaf, &journal)?;
    boundary("journal-prepared")?;

    apply_prepared_retained(&targets, &journal_directory, &journal_leaf, &mut journal)?;
    verify_persisted_response(repo, span_root, addresses, &journal.response)?;
    publish(&journal.response)?;
    boundary("generation-publication")?;
    authority.validate_bindings()?;
    validate_publication_runtime(publication_runtime)?;
    recovery.validate_bindings()?;
    validate_targets(&targets)?;
    journal.state = JournalState::Committed;
    persist_journal(&journal_directory, &journal_leaf, &journal)?;
    boundary("journal-committed")?;
    authority.validate_bindings()?;
    validate_publication_runtime(publication_runtime)?;
    recovery.validate_bindings()?;
    validate_targets(&targets)?;
    clear_recovery_pending(
        &recovery_directory,
        operation_id,
        recovery.scope_digest(),
        span_root,
    )?;
    Ok(journal.response)
}

/// Resolve the exact private journal named by the repository-wide pending
/// marker. A clean reader never traverses the stable recovery tree.
pub(super) fn pending_recovery(
    repo: &gix::Repository,
    span_root: &str,
) -> Result<Option<RecoveryAuthority>> {
    let git_directory = RetainedDirectory::open_canonical(crate::git::git_dir(repo))?;
    let marker_directory = git_directory.descend(
        std::path::Path::new("span"),
        DirectoryPolicy::Create { mode: 0o755 },
    )?;
    let Some(bytes) = marker_directory.read_optional(OsStr::new(RECOVERY_PENDING))? else {
        return Ok(None);
    };
    let marker: RecoveryMarker =
        serde_json::from_slice(&bytes).context("decode context repair recovery marker")?;
    ensure!(
        marker.version == JOURNAL_VERSION,
        "unsupported context recovery marker version"
    );
    if marker.span_root != span_root {
        return Ok(None);
    }
    let recovery = RecoveryAuthority::open(
        crate::git::git_dir(repo),
        crate::git::work_dir(repo)?,
        span_root,
    )?;
    ensure!(
        marker.scope_digest == recovery.scope_digest(),
        "context recovery marker belongs to a different canonical worktree or span root"
    );
    Ok(Some(recovery))
}

/// Finish every prepared transaction while the caller holds the repository
/// recovery domain exclusively. Committed responses are intentionally left
/// replayable; only prepared span bytes are settled here.
pub(super) fn recover_pending_locked(
    repo: &gix::Repository,
    span_root: &str,
    recovery: &RecoveryAuthority,
) -> Result<()> {
    let recovery_directory = recovery.directory()?;
    let marker_directory = recovery_marker_directory(&recovery_directory)?;
    let Some(marker_bytes) = marker_directory.read_optional(OsStr::new(RECOVERY_PENDING))? else {
        return Ok(());
    };
    let marker: RecoveryMarker = serde_json::from_slice(&marker_bytes)
        .context("decode context repair recovery marker during recovery")?;
    ensure!(
        marker.version == JOURNAL_VERSION,
        "unsupported context recovery marker version"
    );
    if marker.span_root != span_root {
        return Ok(());
    }
    ensure!(
        marker.scope_digest == recovery.scope_digest(),
        "context recovery marker belongs to a different canonical worktree or span root"
    );
    let operation_id = marker
        .operation_id
        .parse::<uuid::Uuid>()
        .context("context recovery marker has an invalid operation ID")?;
    let Some(authority) = SpanRootAuthority::open_optional(crate::git::work_dir(repo)?, span_root)?
    else {
        anyhow::bail!("context repair recovery marker exists without its span root")
    };
    let journal_directory = recovery_directory.descend(
        std::path::Path::new("journal"),
        DirectoryPolicy::Private { mode: 0o700 },
    )?;
    let leaf = journal_name(operation_id);
    let Some(bytes) = journal_directory.read_optional(&leaf)? else {
        abort_unjournaled_preparation(&authority, &journal_directory, operation_id, &marker)?;
        authority.validate_bindings()?;
        recovery.validate_bindings()?;
        return clear_recovery_pending(
            &recovery_directory,
            operation_id,
            recovery.scope_digest(),
            span_root,
        );
    };
    let mut journal: RepairJournal =
        serde_json::from_slice(&bytes).context("decode context repair journal for recovery")?;
    ensure!(
        journal.version == JOURNAL_VERSION,
        "unsupported context repair journal version"
    );
    ensure!(
        journal.operation_id == marker.operation_id
            && journal.scope_digest == recovery.scope_digest()
            && marker.temporaries == marker_temporaries(&journal.entries),
        "context recovery marker does not match its stable journal"
    );
    if journal.state == JournalState::Prepared {
        recover_prepared(
            repo,
            span_root,
            &authority,
            &journal_directory,
            &leaf,
            &mut journal,
        )?;
        verify_persisted_response(repo, span_root, &journal.addresses, &journal.response)?;
        authority.validate_bindings()?;
        recovery.validate_bindings()?;
        journal.state = JournalState::Committed;
        persist_journal(&journal_directory, &leaf, &journal)?;
        authority.validate_bindings()?;
        recovery.validate_bindings()?;
    }
    clear_recovery_pending(
        &recovery_directory,
        operation_id,
        recovery.scope_digest(),
        span_root,
    )
}

/// Mark a committed response delivered. A dropped stdout/RPC leaves it in the
/// committed state so a later process can replay it with the same ID.
pub(super) fn acknowledge(
    repo: &gix::Repository,
    span_root: &str,
    operation_id: uuid::Uuid,
    addresses: &[String],
) -> Result<()> {
    let recovery = RecoveryAuthority::open(
        crate::git::git_dir(repo),
        crate::git::work_dir(repo)?,
        span_root,
    )?;
    let journal_directory = recovery.directory()?.descend(
        std::path::Path::new("journal"),
        DirectoryPolicy::Private { mode: 0o700 },
    )?;
    let leaf = journal_name(operation_id);
    let Some(bytes) = journal_directory.read_optional(&leaf)? else {
        anyhow::bail!("context repair response journal disappeared before acknowledgement")
    };
    let mut journal: RepairJournal = serde_json::from_slice(&bytes)?;
    ensure!(
        journal.version == JOURNAL_VERSION
            && journal.operation_id == operation_id.to_string()
            && journal.scope_digest == recovery.scope_digest()
            && journal.request_digest == request_digest(addresses)?,
        "context operation ID request changed before acknowledgement"
    );
    ensure!(
        journal.state != JournalState::Prepared,
        "cannot acknowledge an uncommitted context repair"
    );
    journal.state = JournalState::Delivered;
    persist_journal(&journal_directory, &leaf, &journal)?;
    recovery.validate_bindings()
}

fn plan_repair(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
    authority: &SpanRootAuthority,
) -> Result<(Vec<PlannedSpan>, ContextDocument, ClosedContextCapture)> {
    let snapshot = capture_snapshot(repo, span_root, authority)?;
    let scopes = normalize_scopes(repo, addresses, &snapshot)?;
    let query_paths = addresses
        .iter()
        .map(|address| {
            parse_context_address(address).and_then(|(path, _)| canonicalize_path(&path))
        })
        .collect::<Result<Vec<_>>>()?;
    let capture = close_context_capture(repo, span_root, &snapshot, authority, query_paths)?;

    let pre = select_context(
        scopes.clone(),
        capture.resolved.clone(),
        ContextMutation::default(),
    );
    let selected = pre
        .spans
        .iter()
        .map(|span| span.name.as_str())
        .collect::<BTreeSet<_>>();
    let mut overlay = snapshot.definitions.clone();
    let mut planned = Vec::new();
    let mut mutation = ContextMutation {
        requested: true,
        ..ContextMutation::default()
    };

    for resolved in capture
        .resolved
        .iter()
        .filter(|span| selected.contains(span.name.as_str()))
    {
        let target = authority.target(&resolved.name, DirectoryPolicy::Existing)?;
        let original = target.parent.read_optional(&target.leaf)?.ok_or_else(|| {
            anyhow::anyhow!(
                "selected span `{}` has no writable worktree definition",
                resolved.name
            )
        })?;
        let original = String::from_utf8(original).context("span definition is not UTF-8")?;
        let mut span_file = SpanFile::parse(&original)?;
        let counts = plan_span(repo, resolved, &mut span_file)?;
        if counts.updated == 0 && counts.removed == 0 {
            continue;
        }
        mutation.spans_touched += 1;
        mutation.anchors_updated += counts.updated;
        mutation.anchors_removed += counts.removed;
        mutation.identities_collapsed += counts.collapsed;
        let replacement = crate::types::span_from_file(&resolved.name, &span_file);
        let slot = overlay
            .iter_mut()
            .find(|(name, _)| name == &resolved.name)
            .ok_or_else(|| anyhow::anyhow!("selected span disappeared from repair overlay"))?;
        slot.1 = replacement;
        planned.push(PlannedSpan {
            name: resolved.name.clone(),
            original,
            planned: span_file,
        });
    }
    mutation.rewritten = !planned.is_empty();
    planned.sort_by(|left, right| left.name.cmp(&right.name));
    let post = resolve_snapshot(
        repo,
        &ContextSnapshot {
            definitions: overlay,
        },
    )?;
    let response = select_context(scopes, post, mutation);
    Ok((planned, response, capture))
}

#[derive(Default)]
struct PlanCounts {
    updated: usize,
    removed: usize,
    collapsed: usize,
}

#[derive(Clone)]
struct OrdinalPlan {
    destination: (String, u32, u32),
    content_hash: String,
}

fn plan_span(
    repo: &gix::Repository,
    resolved: &crate::types::SpanResolved,
    file: &mut SpanFile,
) -> Result<PlanCounts> {
    ensure!(
        file.anchors.len() == resolved.anchors.len(),
        "span `{}` changed between resolution and ordinal repair planning",
        resolved.name
    );
    let mut plans = vec![None; file.anchors.len()];
    for (ordinal, (record, anchor)) in file.anchors.iter().zip(&resolved.anchors).enumerate() {
        ensure!(
            record_identity(record) == location_identity(&anchor.anchored),
            "span `{}` ordinal {ordinal} no longer matches its resolved anchor",
            resolved.name
        );
        let repairable = match anchor.status {
            AnchorStatus::Moved => anchor.fuzzy_successors.first().is_none_or(|candidate| {
                candidate.confidence >= EngineOptions::full().fuzzy_threshold
            }),
            AnchorStatus::Changed => anchor.content_equivalent,
            _ => false,
        };
        if !repairable {
            continue;
        }
        let Some(current) = &anchor.current else {
            continue;
        };
        let content_hash = match anchor.status {
            AnchorStatus::Moved if anchor.fuzzy_successors.is_empty() => {
                record.content_hash.clone()
            }
            _ => repair_hash(repo, anchor)?,
        };
        plans[ordinal] = Some(OrdinalPlan {
            destination: location_identity(current),
            content_hash,
        });
    }

    // Decide convergence from all final ordinals at once. This makes swaps and
    // longer cycles independent of mutation order and preserves duplicate
    // source identities as distinct ordinals until the final grouping.
    let mut final_groups: BTreeMap<(String, u32, u32), Vec<usize>> = BTreeMap::new();
    for (ordinal, record) in file.anchors.iter().enumerate() {
        final_groups
            .entry(
                plans[ordinal]
                    .as_ref()
                    .map_or_else(|| record_identity(record), |plan| plan.destination.clone()),
            )
            .or_default()
            .push(ordinal);
    }
    let mut remove = BTreeSet::new();
    let mut collapsed = 0;
    for ordinals in final_groups.values().filter(|ordinals| ordinals.len() > 1) {
        let hashes = ordinals
            .iter()
            .map(|ordinal| {
                plans[*ordinal]
                    .as_ref()
                    .map_or(file.anchors[*ordinal].content_hash.as_str(), |plan| {
                        plan.content_hash.as_str()
                    })
            })
            .collect::<BTreeSet<_>>();
        if hashes.len() != 1 {
            for ordinal in ordinals {
                plans[*ordinal] = None;
            }
            continue;
        }
        collapsed += 1;
        for ordinal in ordinals.iter().skip(1) {
            remove.insert(*ordinal);
        }
    }

    let mut counts = PlanCounts {
        collapsed,
        ..PlanCounts::default()
    };
    let mut rewritten = Vec::with_capacity(file.anchors.len() - remove.len());
    for (ordinal, mut record) in file.anchors.drain(..).enumerate() {
        if remove.contains(&ordinal) {
            counts.removed += 1;
            continue;
        }
        if let Some(plan) = &plans[ordinal]
            && (record_identity(&record) != plan.destination
                || record.content_hash != plan.content_hash)
        {
            record.path = plan.destination.0.clone();
            record.start_line = plan.destination.1;
            record.end_line = plan.destination.2;
            record.algorithm = RK64_ALGORITHM.to_owned();
            record.content_hash = plan.content_hash.clone();
            counts.updated += 1;
        }
        rewritten.push(record);
    }
    file.anchors = rewritten;
    Ok(counts)
}

fn repair_hash(repo: &gix::Repository, anchor: &AnchorResolved) -> Result<String> {
    let current = anchor
        .current
        .as_ref()
        .context("repairable anchor omitted current location")?;
    let path = current.path.to_string_lossy();
    let source = anchor
        .layer_sources
        .iter()
        .copied()
        .min_by_key(|source| match source {
            DriftSource::Head => 1,
            DriftSource::Index => 2,
            DriftSource::Worktree => 3,
        })
        .or(anchor.source)
        .context("repairable anchor omitted source provenance")?;
    match source {
        DriftSource::Worktree => Ok(super::commit::hash_anchor_content(
            repo,
            &path,
            &current.extent,
            None,
            &crate::git::index_entries(repo)?,
        )?
        .1),
        DriftSource::Head => {
            let head = repo.rev_parse_single("HEAD")?.detach().to_string();
            Ok(super::commit::hash_anchor_content(
                repo,
                &path,
                &current.extent,
                Some(&head),
                &crate::git::index_entries(repo)?,
            )?
            .1)
        }
        DriftSource::Index => {
            let entry = crate::git::index_entries(repo)?
                .into_iter()
                .find(|entry| {
                    entry.path == path && entry.stage == gix::index::entry::Stage::Unconflicted
                })
                .context("repair source is absent from the index")?;
            let bytes = crate::git::read_blob_bytes(repo, &entry.oid.to_string())?;
            validate_extent(&bytes, &current.extent)?;
            Ok(rk64_to_hex(cheap_fingerprint_with_extent(
                &bytes,
                &current.extent,
            )))
        }
    }
}

fn validate_extent(bytes: &[u8], extent: &AnchorExtent) -> Result<()> {
    if let AnchorExtent::LineRange { start, end } = extent {
        let text = std::str::from_utf8(bytes).context("line repair source is not UTF-8")?;
        let lines = text.lines().count() as u32;
        ensure!(
            *start >= 1 && *end >= *start && *end <= lines,
            "repair extent is outside its source content"
        );
    }
    Ok(())
}

fn record_identity(record: &crate::span_file::AnchorRecord) -> (String, u32, u32) {
    (record.path.clone(), record.start_line, record.end_line)
}

fn location_identity(location: &crate::types::AnchorLocation) -> (String, u32, u32) {
    let (start, end) = match location.extent {
        AnchorExtent::WholeFile => (0, 0),
        AnchorExtent::LineRange { start, end } => (start, end),
    };
    (
        location.path.to_string_lossy().replace('\\', "/"),
        start,
        end,
    )
}

fn request_digest(addresses: &[String]) -> Result<String> {
    let mut by_path: BTreeMap<String, Vec<ContextExtent>> = BTreeMap::new();
    for address in addresses {
        let (path, extent) = parse_context_address(address)?;
        by_path
            .entry(canonicalize_path(&path)?)
            .or_default()
            .push(extent);
    }
    let scopes: Vec<ContextScope> = merge_scopes(by_path)?;
    let bytes = serde_json::to_vec(&(super::context::CONTEXT_SCHEMA_VERSION, true, scopes))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn revalidate_capture(
    repo: &gix::Repository,
    span_root: &str,
    capture: &ClosedContextCapture,
) -> Result<()> {
    match crate::resolver::core::capture::revalidate_with_extra_paths(
        repo,
        span_root,
        EngineOptions::full(),
        &capture.paths,
        &capture.token,
    )? {
        crate::resolver::core::capture::Revalidation::Unchanged => Ok(()),
        crate::resolver::core::capture::Revalidation::Changed { field } => {
            anyhow::bail!("repository {field} changed before context repair commit")
        }
    }
}

fn verify_persisted_response(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
    persisted: &ContextDocument,
) -> Result<()> {
    let authority = SpanRootAuthority::open(
        crate::git::work_dir(repo)?,
        span_root,
        DirectoryPolicy::Existing,
    )?;
    let snapshot = capture_snapshot(repo, span_root, &authority)?;
    let scopes = normalize_scopes(repo, addresses, &snapshot)?;
    let query_paths = addresses
        .iter()
        .map(|address| {
            parse_context_address(address).and_then(|(path, _)| canonicalize_path(&path))
        })
        .collect::<Result<Vec<_>>>()?;
    let capture = close_context_capture(repo, span_root, &snapshot, &authority, query_paths)?;
    let actual = select_context(scopes, capture.resolved, persisted.mutation.clone());
    ensure!(
        actual == *persisted,
        "durable context repair state does not match its prepared response"
    );
    Ok(())
}

fn validate_targets(targets: &[crate::descriptor_authority::SpanTarget]) -> Result<()> {
    for target in targets {
        target.parent.validate_path_binding()?;
    }
    Ok(())
}

fn validate_publication_runtime(runtime: Option<&RetainedDirectory>) -> Result<()> {
    if let Some(runtime) = runtime {
        runtime.validate_path_binding()?;
    }
    Ok(())
}

fn apply_prepared_retained(
    targets: &[crate::descriptor_authority::SpanTarget],
    journal_directory: &RetainedDirectory,
    journal_leaf: &OsStr,
    journal: &mut RepairJournal,
) -> Result<()> {
    ensure!(
        targets.len() == journal.entries.len(),
        "prepared target count changed"
    );
    for (index, target) in targets
        .iter()
        .enumerate()
        .take(journal.entries.len())
        .skip(journal.applied)
    {
        let entry = &journal.entries[index];
        let current = target
            .parent
            .read_optional(&target.leaf)?
            .context("span disappeared during prepared context repair")?;
        ensure!(
            current == entry.original.as_bytes(),
            "span `{}` diverged after context repair was prepared; preserving external bytes",
            entry.name
        );
        target
            .parent
            .rename(OsStr::new(&entry.temporary), &target.leaf)?;
        boundary(&format!("span-rename:{index}"))?;
        target.parent.open_file(&target.leaf, false)?.sync_all()?;
        boundary(&format!("span-file-fsync:{index}"))?;
        target.parent.sync()?;
        boundary(&format!("span-directory-fsync:{index}"))?;
        journal.applied = index + 1;
        persist_journal(journal_directory, journal_leaf, journal)?;
        boundary(&format!("journal-progress:{index}"))?;
    }
    Ok(())
}

fn recover_prepared(
    repo: &gix::Repository,
    span_root: &str,
    authority: &SpanRootAuthority,
    journal_directory: &RetainedDirectory,
    journal_leaf: &OsStr,
    journal: &mut RepairJournal,
) -> Result<()> {
    let _ = (repo, span_root);
    // Called only from `execute()` and `recover_pending_locked()`, both of
    // which already hold the exclusive repository lock for their whole
    // duration — no per-entry lock is taken here.
    let targets = journal
        .entries
        .iter()
        .map(|entry| authority.target(&entry.name, DirectoryPolicy::Existing))
        .collect::<Result<Vec<_>>>()?;
    let current = targets
        .iter()
        .map(|target| {
            target
                .parent
                .read_optional(&target.leaf)?
                .context("span disappeared during context repair recovery")
        })
        .collect::<Result<Vec<_>>>()?;

    // A prepared transaction is still abortable. If any target now contains
    // third-party bytes, restore only this transaction's already-published
    // planned bytes and leave every external byte untouched. Inspecting the
    // complete set before writing prevents a retry from advancing farther
    // before discovering the divergence.
    if let Some((divergent, _)) = journal.entries.iter().zip(&current).find(|(entry, bytes)| {
        bytes.as_slice() != entry.original.as_bytes()
            && bytes.as_slice() != entry.planned.as_bytes()
    }) {
        for ((entry, target), bytes) in journal.entries.iter().zip(&targets).zip(&current) {
            if bytes.as_slice() == entry.planned.as_bytes() {
                target
                    .parent
                    .atomic_write(&target.leaf, entry.original.as_bytes(), 0o644)?;
            }
        }
        journal.applied = 0;
        persist_journal(journal_directory, journal_leaf, journal)?;
        anyhow::bail!(
            "span `{}` diverged from both original and planned repair bytes; rolled back transaction-owned bytes and preserved the external edit",
            divergent.name
        );
    }

    for (index, ((entry, target), current)) in journal
        .entries
        .iter()
        .zip(&targets)
        .zip(current)
        .enumerate()
    {
        if current == entry.planned.as_bytes() {
            journal.applied = journal.applied.max(index + 1);
            continue;
        }
        debug_assert_eq!(current, entry.original.as_bytes());
        target
            .parent
            .atomic_write(&target.leaf, entry.planned.as_bytes(), 0o644)?;
        journal.applied = index + 1;
        persist_journal(journal_directory, journal_leaf, journal)?;
    }
    Ok(())
}

/// Abort the only phase that may durably expose a recovery marker without a
/// journal. Every recorded span temp must still contain its prepared bytes
/// and every live target must still have its original presence and content.
/// Any mismatch means a rename or external mutation could have occurred, so
/// the marker and all transaction residue are retained and recovery fails
/// closed.
fn abort_unjournaled_preparation(
    authority: &SpanRootAuthority,
    journal_directory: &RetainedDirectory,
    operation_id: uuid::Uuid,
    marker: &RecoveryMarker,
) -> Result<()> {
    let root = authority.root()?;
    let mut seen_paths = BTreeSet::new();
    let mut seen_targets = BTreeSet::new();
    let mut seen_indexes = BTreeSet::new();
    let mut validated = Vec::with_capacity(marker.temporaries.len());
    for temporary in &marker.temporaries {
        ensure!(
            seen_paths.insert(temporary.relative.clone()),
            "unjournaled context repair marker repeats a temporary path"
        );
        ensure!(
            seen_targets.insert(temporary.target_relative.clone()),
            "unjournaled context repair marker repeats a live target path"
        );
        let (directory, leaf, index) = marker_temporary_target(&root, operation_id, temporary)?;
        ensure!(
            seen_indexes.insert(index),
            "unjournaled context repair marker repeats a temporary index"
        );
        let bytes = directory.read_optional(&leaf)?.with_context(|| {
            format!(
                "cannot prove unjournaled context repair stayed before mutation: temporary `{}` is absent",
                temporary.relative
            )
        })?;
        ensure!(
            blake3::hash(&bytes).to_hex().as_str() == temporary.planned_digest,
            "cannot prove unjournaled context repair stayed before mutation: temporary `{}` changed",
            temporary.relative
        );
        let target = authority.target(&temporary.target_relative, DirectoryPolicy::Existing)?;
        let target_relative = std::path::Path::new(&temporary.target_relative);
        let temporary_relative = std::path::Path::new(&temporary.relative);
        ensure!(
            target_relative.parent() == temporary_relative.parent(),
            "unjournaled context repair marker separates a temporary from its live target"
        );
        let live = target.parent.read_optional(&target.leaf)?;
        match &temporary.original {
            MarkerOriginal::Absent => ensure!(
                live.is_none(),
                "cannot prove unjournaled context repair stayed before mutation: originally absent target `{}` now exists",
                temporary.target_relative
            ),
            MarkerOriginal::Present { digest } => {
                validate_marker_digest(digest, "original target")?;
                let live = live.with_context(|| {
                    format!(
                        "cannot prove unjournaled context repair stayed before mutation: original target `{}` is absent",
                        temporary.target_relative
                    )
                })?;
                ensure!(
                    blake3::hash(&live).to_hex().as_str() == digest,
                    "cannot prove unjournaled context repair stayed before mutation: target `{}` differs from its original bytes",
                    temporary.target_relative
                );
            }
        }
        validated.push((directory, leaf));
    }
    ensure!(
        seen_indexes.iter().copied().eq(0..marker.temporaries.len()),
        "unjournaled context repair marker has a non-contiguous temporary set"
    );

    for (directory, leaf) in validated {
        ensure!(
            directory.unlink_if_exists(&leaf)?,
            "context repair temporary disappeared while aborting unjournaled preparation"
        );
        directory.sync()?;
    }

    let journal_prefix = format!(".{}.", journal_name(operation_id).to_string_lossy());
    let mut removed_journal_temporary = false;
    for relative in journal_directory.regular_file_names()? {
        let Some(leaf) = relative.file_name() else {
            continue;
        };
        let leaf = leaf.to_string_lossy();
        if relative.components().count() == 1
            && leaf.starts_with(&journal_prefix)
            && leaf.ends_with(".tmp")
        {
            journal_directory.unlink(relative.as_os_str())?;
            removed_journal_temporary = true;
        }
    }
    if removed_journal_temporary {
        journal_directory.sync()?;
    }
    Ok(())
}

fn marker_temporary_target(
    root: &RetainedDirectory,
    operation_id: uuid::Uuid,
    temporary: &MarkerTemporary,
) -> Result<(RetainedDirectory, OsString, usize)> {
    validate_marker_digest(&temporary.planned_digest, "temporary")?;
    let relative = std::path::Path::new(&temporary.relative);
    ensure!(
        relative.components().count() > 0
            && relative
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_))),
        "unjournaled context repair marker has an unsafe temporary path"
    );
    let leaf = relative
        .file_name()
        .context("unjournaled context repair temporary has no leaf")?;
    let leaf_text = leaf
        .to_str()
        .context("unjournaled context repair temporary leaf is not UTF-8")?;
    let prefix = format!(".context-{operation_id}-");
    let index_text = leaf_text
        .strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix(".tmp"))
        .context("unjournaled context repair marker names an unrelated temporary")?;
    let index = index_text
        .parse::<usize>()
        .context("unjournaled context repair temporary index is invalid")?;
    ensure!(
        index.to_string() == index_text,
        "unjournaled context repair temporary index is not canonical"
    );
    let parent = relative
        .parent()
        .context("unjournaled context repair temporary has no parent")?;
    let directory = if parent.as_os_str().is_empty() {
        root.try_clone()?
    } else {
        root.descend(parent, DirectoryPolicy::Existing)?
    };
    Ok((directory, leaf.to_os_string(), index))
}

fn validate_marker_digest(digest: &str, subject: &str) -> Result<()> {
    ensure!(
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "unjournaled context repair marker has an invalid {subject} digest"
    );
    Ok(())
}

fn persist_journal(
    directory: &RetainedDirectory,
    leaf: &OsStr,
    journal: &RepairJournal,
) -> Result<()> {
    directory.atomic_write(leaf, &serde_json::to_vec(journal)?, 0o600)?;
    directory.sync()
}

fn recovery_marker_directory(recovery: &RetainedDirectory) -> Result<RetainedDirectory> {
    let (context, _) = recovery
        .parent()?
        .context("context repair authority has no context parent")?;
    let (span, _) = context
        .parent()?
        .context("context repair authority has no repository span parent")?;
    Ok(span)
}

fn marker_temporaries(entries: &[JournalEntry]) -> Vec<MarkerTemporary> {
    entries
        .iter()
        .map(|entry| {
            let relative = entry.name.rsplit_once('/').map_or_else(
                || entry.temporary.clone(),
                |(parent, _)| format!("{parent}/{}", entry.temporary),
            );
            MarkerTemporary {
                target_relative: entry.name.clone(),
                relative,
                planned_digest: blake3::hash(entry.planned.as_bytes()).to_hex().to_string(),
                original: marker_original(Some(entry.original.as_bytes())),
            }
        })
        .collect()
}

fn marker_original(bytes: Option<&[u8]>) -> MarkerOriginal {
    match bytes {
        Some(bytes) => MarkerOriginal::Present {
            digest: blake3::hash(bytes).to_hex().to_string(),
        },
        None => MarkerOriginal::Absent,
    }
}

fn mark_recovery_pending(
    recovery: &RetainedDirectory,
    operation_id: uuid::Uuid,
    scope_digest: &str,
    span_root: &str,
    entries: &[JournalEntry],
) -> Result<()> {
    let marker = RecoveryMarker {
        version: JOURNAL_VERSION,
        operation_id: operation_id.to_string(),
        scope_digest: scope_digest.to_owned(),
        span_root: span_root.to_owned(),
        temporaries: marker_temporaries(entries),
    };
    let directory = recovery_marker_directory(recovery)?;
    if let Some(bytes) = directory.read_optional(OsStr::new(RECOVERY_PENDING))? {
        let existing: RecoveryMarker = serde_json::from_slice(&bytes)
            .context("decode existing context repair recovery marker")?;
        ensure!(
            existing.version == marker.version
                && existing.operation_id == marker.operation_id
                && existing.scope_digest == marker.scope_digest
                && existing.span_root == marker.span_root
                && existing.temporaries == marker.temporaries,
            "another context repair remains prepared and must be recovered before mutation"
        );
    }
    directory.atomic_write(
        OsStr::new(RECOVERY_PENDING),
        &serde_json::to_vec(&marker)?,
        0o600,
    )?;
    directory.sync()
}

fn clear_recovery_pending(
    recovery: &RetainedDirectory,
    operation_id: uuid::Uuid,
    scope_digest: &str,
    span_root: &str,
) -> Result<()> {
    let marker_directory = recovery_marker_directory(recovery)?;
    let Some(bytes) = marker_directory.read_optional(OsStr::new(RECOVERY_PENDING))? else {
        return Ok(());
    };
    let marker: RecoveryMarker = serde_json::from_slice(&bytes)
        .context("decode context repair recovery marker while clearing it")?;
    if marker.version != JOURNAL_VERSION
        || marker.operation_id != operation_id.to_string()
        || marker.scope_digest != scope_digest
        || marker.span_root != span_root
    {
        return Ok(());
    }
    if marker_directory.unlink_if_exists(OsStr::new(RECOVERY_PENDING))? {
        marker_directory.sync()?;
    }
    Ok(())
}

fn expire_delivered_journals(directory: &RetainedDirectory) -> Result<()> {
    let now = unix_now();
    for relative in directory.regular_file_names()? {
        let Some(leaf) = relative.file_name() else {
            continue;
        };
        if relative.components().count() != 1 || !leaf.to_string_lossy().starts_with("operation-") {
            continue;
        }
        let Some(bytes) = directory.read_optional(leaf)? else {
            continue;
        };
        let Ok(journal) = serde_json::from_slice::<RepairJournal>(&bytes) else {
            continue;
        };
        if journal.state == JournalState::Delivered
            && now.saturating_sub(journal.created_unix_secs) > JOURNAL_TTL_SECS
        {
            directory.unlink(leaf)?;
            directory.sync()?;
        }
    }
    Ok(())
}

fn journal_name(operation_id: uuid::Uuid) -> OsString {
    OsString::from(format!("operation-{operation_id}.json"))
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn boundary(name: &str) -> Result<()> {
    let step = BOUNDARY_STEP.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(directory) = std::env::var("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_DIR")
        && std::env::var("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_BOUNDARY")
            .ok()
            .as_deref()
            == Some(name)
    {
        let safe_name = name.replace([':', '/'], "-");
        let directory = std::path::Path::new(&directory);
        let token = uuid::Uuid::new_v4().to_string();
        let ready = directory.join(format!("repair-{safe_name}.ready"));
        let release = directory.join(format!("repair-{safe_name}.release"));
        std::fs::write(&ready, &token)?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            if std::fs::read_to_string(&release).ok().as_deref() == Some(token.as_str()) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        ensure!(
            std::fs::read_to_string(&release).ok().as_deref() == Some(token.as_str()),
            "context repair boundary `{name}` timed out"
        );
    }
    if std::env::var("GIT_SPAN_CONTEXT_TEST_DIE_AFTER")
        .ok()
        .as_deref()
        == Some(name)
        || std::env::var("GIT_SPAN_CONTEXT_TEST_DIE_AT_STEP")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            == Some(step)
    {
        std::process::exit(86);
    }
    ensure!(
        std::env::var("GIT_SPAN_CONTEXT_TEST_FAIL_AFTER")
            .ok()
            .as_deref()
            != Some(name),
        "injected context repair failure after {name}"
    );
    Ok(())
}
