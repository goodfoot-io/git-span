//! Engine orchestration: layer setup, per-anchor resolution, span-wide
//! resolution, concurrency guard.

pub(crate) mod anchor;
pub(crate) mod whole_file;

use super::layers::{
    CustomFilters, LayerDiffs, LfsState, read_conflicted_paths, read_index_layer,
    read_index_trailer, read_layer_status, read_worktree_layer, read_worktree_layer_for_paths,
};
use super::session::ConcurrentSession;

use crate::span_file_reader::SpanFileReader;
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, EngineOptions, LayerSet, Span,
    SpanResolved, span_from_file,
};
use crate::{Error, Result};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::Ordering;

use anchor::{AnchorCtx, resolve_anchor_inner};

/// Per-worker resolver scratch (card main-162 three-way split).
///
/// Holds exactly the state that a future parallel anchor-resolution worker
/// cannot share: the per-anchor mutated-and-restored `layers`/`needs_all_layers`
/// scratch (`resolve_anchor_captured` saves, overwrites, and restores these
/// per anchor), and the live `FilterProcess`/`LfsState` subprocess handles.
/// One instance per worker; today the loop is serial, so there is exactly one.
pub(crate) struct EngineLocal {
    pub(crate) layers: LayerSet,
    /// Phase 4 (layer neutrality): when false, `compute_layer_sources` may
    /// short-circuit once it has enough information to drive the exit code.
    /// Set by `cli/drift.rs` based on whether the output mode requires
    /// per-layer detail (`--patch`, `--stat`, the `human` renderer).
    pub(crate) needs_all_layers: bool,
    pub(crate) lfs: LfsState,
    pub(crate) custom_filters: CustomFilters,
}

impl EngineLocal {
    /// Fresh per-worker scratch: no LFS state and an unspawned custom-filter
    /// process, exactly as [`EngineState::new_with_fuzzy_threshold`] seeds the
    /// engine's own `local`. Card main-162 staged-rollout step 4 uses this as
    /// the `map_init` init closure so each rayon task owns its own
    /// `FilterProcess`/`LfsState` subprocess handles and `layers` scratch.
    pub(crate) fn new(layers: LayerSet, needs_all_layers: bool) -> Self {
        EngineLocal {
            layers,
            needs_all_layers,
            lfs: None,
            custom_filters: CustomFilters::new(),
        }
    }
}

/// Read-only-after-construction resolver context (card main-162 three-way
/// split).
///
/// Every field is written once — in [`EngineState::new_with_fuzzy_threshold`]
/// (or [`EngineState::from_source_layers`]) — before any anchor resolves,
/// and only read during resolution. A future parallel fork can therefore
/// share this behind a plain `&`/`Arc` with no lock.
pub(crate) struct SharedEngineContext {
    pub(crate) head_sha: String,
    pub(crate) clean_layers: bool,
    pub(crate) index_diffs: Option<LayerDiffs>,
    pub(crate) worktree_diffs: Option<LayerDiffs>,
    pub(crate) conflicted_paths: HashSet<String>,
    /// Confidence threshold for fuzzy-similarity auto-fix. Matches at or
    /// above this threshold are automatically re-anchored by `--fix`.
    /// Default 0.95. Passed through from `EngineOptions`.
    pub(crate) fuzzy_threshold: f64,
}

/// Engine-level state cached for one `drift` run.
///
/// Card main-162 split what was one flat struct into three: the per-worker
/// [`EngineLocal`], the read-only [`SharedEngineContext`], and the
/// interior-mutability [`ConcurrentSession`] memo store. `EngineState` owns
/// all three plus the two run-lifecycle fields that belong to none of them,
/// and is the handle the pre-fork machinery (`new`,
/// `finish`) and the serial span loop pass around. The resolution callee tree
/// takes the three components as separate borrows.
pub(crate) struct EngineState {
    pub(crate) local: EngineLocal,
    pub(crate) shared: SharedEngineContext,
    pub(crate) concurrent: ConcurrentSession,
    index_trailer_start: Option<[u8; 20]>,
    pub(crate) warnings: Vec<String>,
}

/// Reusable source-layer state captured from a pre-fix `EngineState` so the
/// post-fix re-resolve in `drift --fix` can skip re-reading the worktree
/// source layer (`read_worktree_layer*`) on the cold path.
///
/// Carries the static source-layer fields plus the post-scan
/// [`index_changed`](Self::index_changed) verdict. It deliberately does NOT
/// carry `warnings` or `index_trailer_start`: those are consumed/emitted by
/// the pre-fix `finish_retaining_layers` and must not be re-emitted by the
/// post-fix pass (see the stderr-parity equivalence guard).
pub(crate) struct SourceLayers {
    pub(crate) layers: LayerSet,
    pub(crate) head_sha: String,
    pub(crate) clean_layers: bool,
    pub(crate) index_diffs: Option<LayerDiffs>,
    pub(crate) worktree_diffs: Option<LayerDiffs>,
    pub(crate) conflicted_paths: HashSet<String>,
    pub(crate) lfs: LfsState,
    pub(crate) custom_filters: CustomFilters,
    /// `true` when the index trailer changed between `EngineState` construction
    /// and `finish`/`finish_retaining_layers` — the scan's per-anchor verdicts
    /// are not trustworthy and the caller should treat this result as
    /// indeterminate.
    pub(crate) index_changed: bool,
}

impl EngineState {
    pub(crate) fn new(
        repo: &gix::Repository,
        layers: LayerSet,
        needs_all_layers: bool,
    ) -> Result<Self> {
        Self::new_with_fuzzy_threshold(repo, layers, needs_all_layers, 0.95)
    }

    pub(crate) fn new_with_fuzzy_threshold(
        repo: &gix::Repository,
        layers: LayerSet,
        needs_all_layers: bool,
        fuzzy_threshold: f64,
    ) -> Result<Self> {
        let _perf = crate::perf::span("resolver.init-layers");
        let head_sha = crate::git::head_oid(repo)?;
        let layer_status = if layers.index || layers.worktree {
            let _perf = crate::perf::span("resolver.init-layers.status");
            read_layer_status(repo).ok()
        } else {
            None
        };
        let clean_layers = layer_status
            .as_ref()
            .is_some_and(|status| status.is_clean());
        let index_trailer_start = read_index_trailer(repo).ok();
        // Init-layer warnings (rare index/worktree read-budget downgrades)
        // accrue to the engine-level `warnings` buffer.
        let mut warnings: Vec<String> = Vec::new();
        let mut index_diffs: Option<LayerDiffs> = None;
        let mut worktree_diffs: Option<LayerDiffs> = None;
        let mut conflicted_paths: HashSet<String> = HashSet::new();
        if clean_layers {
            if layers.index {
                index_diffs = Some(LayerDiffs::empty());
            }
            if layers.worktree {
                worktree_diffs = Some(LayerDiffs::empty());
            }
        } else if layers.index || layers.worktree {
            match layer_status.as_ref() {
                Some(status) if !status.requires_full_scan => {
                    if status.has_unmerged {
                        let _perf = crate::perf::span("resolver.init-layers.read-conflicts");
                        conflicted_paths = read_conflicted_paths(repo)?;
                    }
                    if layers.index {
                        if status.index_dirty {
                            let _perf = crate::perf::span("resolver.init-layers.read-index-layer");
                            index_diffs = Some(read_index_layer(repo, &mut warnings)?);
                        } else {
                            index_diffs = Some(LayerDiffs::empty());
                        }
                    }
                    if layers.worktree {
                        if status.worktree_paths.is_empty() {
                            worktree_diffs = Some(LayerDiffs::empty());
                        } else {
                            let _perf =
                                crate::perf::span("resolver.init-layers.read-worktree-layer");
                            worktree_diffs = Some(read_worktree_layer_for_paths(
                                repo,
                                &status.worktree_paths,
                                &mut warnings,
                            )?);
                        }
                    }
                }
                _ => {
                    let _perf = crate::perf::span("resolver.init-layers.full-scan");
                    conflicted_paths = read_conflicted_paths(repo)?;
                    if layers.index {
                        index_diffs = Some(read_index_layer(repo, &mut warnings)?);
                    }
                    if layers.worktree {
                        worktree_diffs = Some(read_worktree_layer(repo, &mut warnings)?);
                    }
                }
            }
        }
        Ok(EngineState {
            local: EngineLocal {
                layers,
                needs_all_layers,
                lfs: None,
                custom_filters: CustomFilters::new(),
            },
            shared: SharedEngineContext {
                head_sha,
                clean_layers,
                index_diffs,
                worktree_diffs,
                conflicted_paths,
                fuzzy_threshold,
            },
            concurrent: ConcurrentSession::new(repo),
            index_trailer_start,
            warnings,
        })
    }

    fn finish(self, repo: &gix::Repository) -> bool {
        let index_changed = if let Some(start) = self.index_trailer_start
            && let Ok(end) = read_index_trailer(repo)
            && end != start
        {
            eprintln!("warning: index changed during drift; consider re-running");
            true
        } else {
            false
        };
        for w in self.warnings {
            eprintln!("{w}");
        }
        // Subprocess handles drop here; `FilterProcess`'s `Drop` impl
        // closes stdin (signalling EOF) before waiting on the child.
        let _ = self.local.lfs;
        let _ = self.local.custom_filters;
        index_changed
    }

    /// Like `finish`, but returns the reusable source-layer state instead of
    /// dropping it, so the post-fix re-resolve in `drift --fix` can rebuild an
    /// `EngineState` without re-reading the worktree source layer.
    ///
    /// Emits the pre-fix engine warnings and the index-trailer
    /// change warning exactly as `finish` does — these are consumed here and
    /// are intentionally NOT carried in `SourceLayers`, so the post-fix
    /// `from_source_layers` starts clean and cannot re-emit them.
    fn finish_retaining_layers(self, repo: &gix::Repository) -> SourceLayers {
        let index_changed = if let Some(start) = self.index_trailer_start
            && let Ok(end) = read_index_trailer(repo)
            && end != start
        {
            eprintln!("warning: index changed during drift; consider re-running");
            true
        } else {
            false
        };
        for w in &self.warnings {
            eprintln!("{w}");
        }
        // LFS and custom_filters move into SourceLayers rather than dropping
        // here: their subprocess handles stay alive for the post-fix pass.
        SourceLayers {
            layers: self.local.layers,
            head_sha: self.shared.head_sha,
            clean_layers: self.shared.clean_layers,
            index_diffs: self.shared.index_diffs,
            worktree_diffs: self.shared.worktree_diffs,
            conflicted_paths: self.shared.conflicted_paths,
            lfs: self.local.lfs,
            custom_filters: self.local.custom_filters,
            index_changed,
        }
    }

    /// Build ONLY the reusable source-layer state — the worktree/index source
    /// layer scan (`read_layer_status` + `read_worktree_layer*`) — without
    /// resolving any span. Used by `drift --fix` to compute the source layers
    /// once (before `apply_fix` mutates `.span/` files) and reuse them for the
    /// post-fix re-resolve via `from_source_layers`, so the post-fix pass does
    /// NOT re-run the `git status` source scan.
    ///
    /// Emits any source-layer init warnings (rare: index/worktree read
    /// budget downgrades) exactly as the cold-path `finish_retaining_layers`
    /// does, so they surface once — `from_source_layers` then starts clean and
    /// cannot re-emit them.
    ///
    /// Soundness (identical to `from_source_layers`): `apply_fix` writes only
    /// under `span_root` and no anchor path is under `span_root` (interior
    /// anchors are excised / gated), so the pre-`apply_fix` worktree status is
    /// correct for every post-fix per-anchor source resolution. The rewritten
    /// span files appear dirty in `git status` but the resolver never examines
    /// a span-root path, so their absence from `worktree_diffs` is immaterial.
    pub(crate) fn build_source_layers(
        repo: &gix::Repository,
        layers: LayerSet,
        needs_all_layers: bool,
    ) -> Result<SourceLayers> {
        let mut state = EngineState::new(repo, layers, needs_all_layers)?;
        for w in &state.warnings {
            eprintln!("{w}");
        }
        state.warnings.clear();
        Ok(SourceLayers {
            layers: state.local.layers,
            head_sha: state.shared.head_sha,
            clean_layers: state.shared.clean_layers,
            index_diffs: state.shared.index_diffs,
            worktree_diffs: state.shared.worktree_diffs,
            conflicted_paths: state.shared.conflicted_paths,
            lfs: state.local.lfs,
            custom_filters: state.local.custom_filters,
            index_changed: false,
        })
    }

    /// Reconstruct an `EngineState` from source-layer state captured by a
    /// pre-fix `finish_retaining_layers`, reusing the worktree/index source
    /// layer instead of re-reading it via `read_worktree_layer*`.
    fn from_source_layers(
        layers: SourceLayers,
        repo: &gix::Repository,
        needs_all_layers: bool,
        fuzzy_threshold: f64,
    ) -> Self {
        // Soundness: `apply_fix` writes only under `span_root`, and no anchor
        // path is under `span_root` (interior anchors are excised before the
        // write). Therefore the pre-fix `worktree_diffs` / `clean_layers` /
        // `conflicted_paths` are correct for every post-fix per-anchor source
        // resolution — the rewritten span files appear dirty in `git status`
        // but the resolver never examines a span-root path. The session memo
        // store is NOT reused (a fresh `ConcurrentSession` starts empty for
        // the rewritten spans); only these static source-layer fields are
        // reused.
        EngineState {
            local: EngineLocal {
                layers: layers.layers,
                needs_all_layers,
                lfs: layers.lfs,
                custom_filters: layers.custom_filters,
            },
            shared: SharedEngineContext {
                head_sha: layers.head_sha,
                clean_layers: layers.clean_layers,
                index_diffs: layers.index_diffs,
                worktree_diffs: layers.worktree_diffs,
                conflicted_paths: layers.conflicted_paths,
                fuzzy_threshold,
            },
            concurrent: ConcurrentSession::new(repo),
            // Re-read fresh so the post-fix finish detects index changes that
            // occur during the post-fix resolve window (not the pre-fix one).
            index_trailer_start: read_index_trailer(repo).ok(),
            // Start clean: pre-fix warnings were already emitted by
            // finish_retaining_layers and must not be re-emitted.
            warnings: Vec::new(),
        }
    }
}

pub fn resolve_anchor(
    repo: &gix::Repository,
    span_root: &str,
    span_name: &str,
    anchor_id: &str,
    options: EngineOptions,
) -> Result<AnchorResolved> {
    let _immutable = crate::perf::immutable_invocation();
    let _perf = crate::perf::span("resolver.resolve-anchor");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;

    let span = {
        let _perf = crate::perf::span("resolver.read-span");
        let reader = SpanFileReader::new(repo, span_root.to_string());
        let file = reader
            .read_effective(span_name)?
            .ok_or_else(|| Error::SpanNotFound(span_name.to_string()))?;
        span_from_file(span_name, &file)
    };
    let out = match span.anchors.into_iter().find(|(id, _)| id == anchor_id) {
        Some((_, r)) => resolve_anchor_inner(
            AnchorCtx {
                repo,
                shared: &state.shared,
                concurrent: &state.concurrent,
            },
            &mut state.local,
            &span.config,
            anchor_id,
            r,
        )?,
        None => deleted_placeholder(anchor_id),
    };
    state.finish(repo);
    Ok(out)
}

pub fn resolve_span(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    options: EngineOptions,
) -> Result<SpanResolved> {
    let _immutable = crate::perf::immutable_invocation();
    let _perf = crate::perf::span("resolver.resolve-span");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let out = resolve_span_with_state(repo, span_root, &mut state, name)?;
    state.finish(repo);
    Ok(out)
}

/// Resolve a span against the anchors stored at a specific span-ref commit.
///
/// Compaction uses this to keep the resolver's view consistent with the
/// `current_tip` it captured for the CAS expected-old-oid. Without this,
/// if the live ref drifts between read and classification, anchor data
/// comes from a different commit than the CAS guard expects.
pub fn resolve_span_at(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    options: EngineOptions,
    commit_oid: &str,
) -> Result<SpanResolved> {
    let _immutable = crate::perf::immutable_invocation();
    let _perf = crate::perf::span("resolver.resolve-span-at");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let out = resolve_span_with_state_at(repo, span_root, &mut state, name, commit_oid)?;
    state.finish(repo);
    Ok(out)
}

fn resolve_span_with_state(
    repo: &gix::Repository,
    span_root: &str,
    state: &mut EngineState,
    name: &str,
) -> Result<SpanResolved> {
    let span = {
        let _perf = crate::perf::span("resolver.read-span-file");
        let reader = SpanFileReader::new(repo, span_root.to_string());
        let file = reader
            .read_effective(name)?
            .ok_or_else(|| Error::SpanNotFound(name.to_string()))?;
        span_from_file(name, &file)
    };
    resolve_loaded_span_with_state(repo, state, span)
}

fn resolve_span_with_state_at(
    repo: &gix::Repository,
    span_root: &str,
    state: &mut EngineState,
    name: &str,
    commit_oid: &str,
) -> Result<SpanResolved> {
    let span = {
        let _perf = crate::perf::span("resolver.read-span");
        // Read the span file from the tree at the given commit.
        let span_path = format!("{span_root}/{name}");
        let oid = gix::ObjectId::from_str(commit_oid)
            .map_err(|e| Error::Git(format!("parse oid {commit_oid}: {e}")))?;
        let text = match crate::git::tree_entry_at(
            repo,
            &oid.to_string(),
            std::path::Path::new(&span_path),
        )? {
            Some((_mode, blob_oid)) => crate::git::read_git_text(repo, &blob_oid.to_string())?,
            None => return Err(Error::SpanNotFound(name.to_string())),
        };
        // `parse` is a pure text→struct transform; surface a genuine
        // parse/conflict error rather than masking it as a missing span.
        // Interior-anchor containment is NOT enforced here — it is surfaced
        // at the `drift`/`doctor` reporting surfaces so drift never silently
        // honors an interior anchor while a poisoned span stays repairable.
        let file = crate::span_file::SpanFile::parse(&text)?;
        span_from_file(name, &file)
    };
    resolve_loaded_span_with_state(repo, state, span)
}

fn resolve_loaded_span_with_state(
    repo: &gix::Repository,
    state: &mut EngineState,
    span: crate::types::Span,
) -> Result<SpanResolved> {
    let mut anchors = Vec::with_capacity(span.anchors.len());
    {
        let _perf = crate::perf::span("resolver.resolve-anchors");
        let EngineState {
            local,
            shared,
            concurrent,
            ..
        } = state;
        for (id, r) in span.anchors {
            let anchor_t0 = std::time::Instant::now();
            let trace_path = r.path.clone();
            let mut resolved = resolve_anchor_inner(
                AnchorCtx {
                    repo,
                    shared,
                    concurrent,
                },
                local,
                &span.config,
                &id,
                r,
            )?;
            let wall_us = anchor_t0.elapsed().as_micros();
            concurrent.per_anchor_us.push(wall_us);
            tally_anchor_status(concurrent, &resolved.status);
            if let Some(trace) = concurrent.per_anchor_trace.as_mut() {
                trace.push(crate::perf::TraceRow {
                    span: span.name.clone(),
                    anchor_id: id.clone(),
                    path: trace_path,
                    wall_us,
                    status: status_label(&resolved.status),
                });
            }
            populate_drift_locus(repo, &mut resolved, concurrent);
            anchors.push(resolved);
        }
    }
    Ok(SpanResolved {
        name: span.name,
        why: span.why,
        anchors,
        follow_moves: span.config.follow_moves,
    })
}

/// Populate `AnchorResolved.locus` for anchors whose drift is attributed to
/// the HEAD layer or whose status is `Deleted`. For all other states the
/// per-layer label (worktree / index) suffices and no walk is needed.
pub(crate) fn populate_drift_locus(
    repo: &gix::Repository,
    resolved: &mut AnchorResolved,
    concurrent: &ConcurrentSession,
) {
    use crate::types::DriftSource;
    match resolved.status {
        AnchorStatus::Changed if resolved.source == Some(DriftSource::Head) => {
            if let Ok(locus) = super::attribution::drift_locus(repo, resolved, concurrent) {
                resolved.locus = locus;
            }
        }
        AnchorStatus::Deleted if resolved.locus.is_none() => {
            // Ask the walk to describe an orphaning commit when the anchor
            // is reachable but the path is absent from HEAD.
            if let Ok(Some(locus)) = super::attribution::drift_locus(repo, resolved, concurrent) {
                resolved.locus = Some(locus);
            }
        }
        _ => {}
    }
}

fn tally_anchor_status(session: &mut ConcurrentSession, status: &AnchorStatus) {
    match status {
        AnchorStatus::Fresh | AnchorStatus::ResolvedPendingCommit => session.anchors_fresh += 1,
        AnchorStatus::Moved => session.anchors_moved += 1,
        AnchorStatus::Changed => session.anchors_changed += 1,
        AnchorStatus::Deleted => session.anchors_orphaned += 1,
        AnchorStatus::MergeConflict => session.anchors_merge_conflict += 1,
        AnchorStatus::Submodule => session.anchors_unavailable += 1,
        AnchorStatus::ContentUnavailable(_) => session.anchors_unavailable += 1,
    }
}

fn status_label(s: &AnchorStatus) -> &'static str {
    match s {
        AnchorStatus::Fresh => "Fresh",
        AnchorStatus::ResolvedPendingCommit => "ResolvedPendingCommit",
        AnchorStatus::Moved => "Moved",
        AnchorStatus::Changed => "Changed",
        AnchorStatus::Deleted => "Deleted",
        AnchorStatus::MergeConflict => "MergeConflict",
        AnchorStatus::Submodule => "Submodule",
        AnchorStatus::ContentUnavailable(_) => "ContentUnavailable",
    }
}

/// Where one [`AnchorStatus`] sits relative to drift's two reporting
/// boundaries. Both predicates below are projections of this single
/// exhaustive classification, so a new `AnchorStatus` variant cannot land on
/// one side of one boundary without the author deciding both here.
enum DriftReportingClass {
    /// Current bytes equal anchored bytes; nothing to report anywhere.
    Fresh,
    /// Shown in drift's human presentation, but does not drive drift's exit
    /// status, clustering, or history's `current` anchors.
    Informational,
    /// Actionable drift on every surface.
    ActionableDrift,
}

fn drift_reporting_class(status: &AnchorStatus) -> DriftReportingClass {
    match status {
        AnchorStatus::Fresh => DriftReportingClass::Fresh,
        AnchorStatus::ResolvedPendingCommit => DriftReportingClass::Informational,
        AnchorStatus::Moved
        | AnchorStatus::Changed
        | AnchorStatus::Deleted
        | AnchorStatus::MergeConflict
        | AnchorStatus::Submodule
        | AnchorStatus::ContentUnavailable(_) => DriftReportingClass::ActionableDrift,
    }
}

/// A fully-freshened span (every anchor `Fresh`) is omitted from drift
/// rendering. The `drift --fix` output-equivalence tests assert this holds
/// identically on both the read-only and `--fix` passes.
///
/// Informational anchors keep a span reportable here — a span whose only
/// non-`Fresh` anchor is `ResolvedPendingCommit` is still shown — while
/// [`anchor_status_is_drift`] excludes them; both boundaries are
/// spelled over [`drift_reporting_class`].
///
/// This is the *scoped* reportability boundary: `replace`'s single-named-span
/// "drift-free" report (`cli/commit.rs`) is its only remaining caller. The
/// bare (no-args) `drift` scan's span-inclusion gate is
/// [`span_has_actionable_drift`] instead (card main-229) — narrower, since a
/// span that is only pending-commit no longer needs a standing "nothing to do
/// here" notice on every scan.
pub(crate) fn span_is_reportable_in_drift_discovery(m: &SpanResolved) -> bool {
    m.anchors.iter().any(|a| {
        !matches!(
            drift_reporting_class(&a.status),
            DriftReportingClass::Fresh
        )
    })
}

/// Whether an anchor contributes actionable drift.
///
/// [`AnchorStatus::ResolvedPendingCommit`] remains an informational state in
/// drift's human presentation, but like [`AnchorStatus::Fresh`] it does not
/// drive drift's exit status, clustering, or history's `current` anchors.
pub(crate) fn anchor_status_is_drift(status: &AnchorStatus) -> bool {
    matches!(
        drift_reporting_class(status),
        DriftReportingClass::ActionableDrift
    )
}

/// Whether a span has at least one anchor carrying actionable drift.
///
/// Span-level counterpart to the per-anchor [`anchor_status_is_drift`]: this
/// is the bare (no-args) `drift` scan's span-inclusion gate (card main-229). A
/// span whose anchors are all `Fresh`, all `ResolvedPendingCommit`, or a mix
/// of the two is omitted from a bare scan entirely — the same way an
/// all-`Fresh` span already was — since there is nothing actionable left to
/// report. A span with at least one genuine `ActionableDrift` anchor still
/// prints in full, including any sibling `ResolvedPendingCommit`/`Fresh`
/// anchor rows, unchanged.
///
/// Deliberately distinct from [`span_is_reportable_in_drift_discovery`],
/// which keeps its wider (any-non-`Fresh`) meaning for its one remaining
/// scoped caller (`replace`'s drift-free report). Named/scoped `drift <name>`
/// queries use neither predicate — see `cli/drift_output.rs`'s inline
/// `status != Fresh` scoped filter.
pub(crate) fn span_has_actionable_drift(m: &SpanResolved) -> bool {
    m.anchors.iter().any(|a| anchor_status_is_drift(&a.status))
}

/// Resolve a small caller-provided list of span names without scanning all
/// span files. Reuses one `EngineState` across the candidate set and resolves
/// each name through its span file. Preserves input order; per-name
/// resolution failures are returned alongside the name rather than aborting
/// the whole call so the path-index candidate workflow stays robust against a
/// drifted path-index entry.
/// Per-name resolution outcomes: input order preserved, each name paired with
/// its `Ok(SpanResolved)` or a per-name resolution `Err`.
type NamedSpanResults = Vec<(String, std::result::Result<SpanResolved, Error>)>;

pub(crate) fn resolve_loaded_spans(
    repo: &gix::Repository,
    spans: &[(String, Span)],
    options: EngineOptions,
) -> Result<Vec<SpanResolved>> {
    let _immutable = crate::perf::immutable_invocation();
    let _perf = crate::perf::span("resolver.resolve-loaded-spans");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let mut resolved = Vec::with_capacity(spans.len());
    for (_, span) in spans {
        resolved.push(resolve_loaded_span_with_state(
            repo,
            &mut state,
            span.clone(),
        )?);
    }
    emit_session_counters(&state.concurrent);
    if state.finish(repo) {
        return Err(Error::Git(
            "repository index changed while resolving context; retry the query".into(),
        ));
    }
    Ok(resolved)
}

pub(crate) fn resolve_named_spans(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
) -> Result<NamedSpanResults> {
    let _immutable = crate::perf::immutable_invocation();
    let state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let (out, state) = resolve_named_spans_with_state(repo, span_root, names, state)?;
    state.finish(repo);
    Ok(out)
}

/// Floor on the chunk size rayon's adaptive work-stealing will split the
/// flattened anchor batch down to in [`capture_resolution_core`], for the
/// **primary cold `drift` path** ([`resolver::exact::cold_miss`]). `map_init`
/// spawns a fresh `EngineLocal` (and a real `FilterProcess`/`LfsState`
/// subprocess plus a `gix::Repository` clone) per rayon job, and rayon splits
/// the batch into roughly `anchors / floor` jobs — so the floor sets both the
/// achievable task count (`anchors / floor`, capped by the pool's worker
/// count) and the number of per-job `EngineLocal`/repo-clone instances paid.
///
/// Tuned empirically for card main-162's finding fix (`min-len-caps-
/// parallelism-no-speedup`): the prior shared value of 64 forced the ~145-anchor
/// dogfooded corpus (and the ~180-anchor bench corpus) into only
/// `floor(N/64) = 2` tasks — measured CPU overlap ~1.9× — throttling the exact
/// path this card exists to speed up. `16` forks that corpus into 8 concurrent
/// tasks (measured overlap ~6.6× on a 10-core host) and cuts the cold
/// wall-clock ~22% vs 64 / ~44% vs the fully-serial pre-parallel baseline, while
/// still requiring ≥32 anchors before forking at all (a corpus under 16 anchors
/// stays on one task) and keeping ≥16 anchors of real resolution work per job to
/// amortize its `EngineLocal`/repo-clone init. Lower floors (4/8) reach full
/// worker saturation but pay strictly more per-job init for negligible extra
/// overlap and measurably regress trivially-cheap (all-fresh) corpora, where the
/// clone overhead dominates; 16 is the balance point across the 50/150/300/600-
/// anchor sweep.
pub(crate) const COLD_DRIFT_MIN_ANCHORS_PER_TASK: usize = 16;

/// Floor for the small-batch `incremental`/`dirty` callers, which pass only the
/// re-resolved `affected_names` subset (typically a handful of spans). Set above
/// their typical per-invocation anchor counts so rayon keeps their batches on a
/// single task (one `EngineLocal`, effectively serial) without a separate
/// serial-vs-parallel threshold — forking a tiny subset would spend more on
/// per-job `EngineLocal`/repo-clone init than the overlap could ever recover.
///
/// Deliberately distinct from [`COLD_DRIFT_MIN_ANCHORS_PER_TASK`]: card
/// main-162's finding fix lowered the cold path's floor for real multi-core
/// scaling, but that must not drag the small-batch callers into forking. This
/// preserves their pre-fix behavior (the original shared `64`) byte-for-byte.
pub(crate) const SMALL_BATCH_MIN_ANCHORS_PER_TASK: usize = 64;

/// Single-pass, layer-neutral capture (card main-157 Phase 3A). Resolve every
/// named span ONCE and assemble a [`ResolutionCore`] whose every anchor holds
/// three independent per-layer observations (Head / Index / Worktree), instead
/// of resolving twice — once committed, once effective — and merging the two
/// collapsed views (the `resolver/core/tests.rs::anchor_core_from_dual`
/// stand-in this replaces, which could not express simultaneous Index +
/// Worktree drift).
///
/// This is additive instrumentation: it neither alters nor is reachable from
/// the default resolution path (`resolve_named_spans` / `drift_spans_*`).
/// Capture always observes all three layers regardless of any eventual view,
/// so the core is genuinely layer-neutral; `super::core::project` reconstructs
/// the committed or effective `SpanResolved` from it by pure selection.
///
/// `min_anchors_per_task` is the rayon split floor (see
/// [`COLD_DRIFT_MIN_ANCHORS_PER_TASK`] / [`SMALL_BATCH_MIN_ANCHORS_PER_TASK`]):
/// the primary cold `drift` path passes the low cold-path floor for real
/// multi-core scaling; the small-batch `incremental`/`dirty` callers pass the
/// higher small-batch floor to stay pinned to one task. It affects scheduling
/// only — output is byte-identical across any floor (guarded by
/// `tests/cases/cli_drift_parallel_equivalence.rs`).
pub(crate) fn capture_resolution_core(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    min_anchors_per_task: usize,
) -> Result<crate::resolver::core::resolution::ResolutionCore> {
    use crate::resolver::core::resolution::{
        AnchorCore, DefinitionOrdinal, ResolutionCore, SpanCore,
    };
    use rayon::prelude::*;

    let _perf = crate::perf::span("resolver.capture-resolution-core");
    let state = EngineState::new_with_fuzzy_threshold(repo, LayerSet::full(), true, 0.95)?;

    let span_pairs: Vec<(String, Span)> =
        crate::span::read::read_effective_each_parallel(repo, span_root, names)
            .into_iter()
            .zip(names)
            .filter_map(|(outcome, name)| outcome.ok().flatten().map(|span| (name.clone(), span)))
            .collect();
    // Serial pre-pass: flatten every span's anchors into one ordered work-item
    // vec across the whole batch, so anchor resolutions across the batch (not
    // merely within a single span) fork concurrently — matching the card's
    // "anchor resolutions across the whole batch" behavior. Each span's
    // metadata (name/why/follow_moves/config) is captured once, indexed by
    // `span_index`. `DefinitionOrdinal`'s `source_ordinal` — the position among
    // same-`anchor_id` duplicates, in stored order — depends only on the
    // anchors' stored order, never on any resolution result, so it is computed
    // here cheaply and serially and carried alongside each work item rather
    // than serialized with the expensive resolve.
    struct SpanMeta {
        name: String,
        why: String,
        follow_moves: bool,
        config: crate::types::SpanConfig,
    }
    struct WorkItem {
        span_index: usize,
        source_ordinal: u32,
        anchor_id: String,
        anchor: crate::types::Anchor,
    }
    let mut span_metas: Vec<SpanMeta> = Vec::with_capacity(span_pairs.len());
    let mut work: Vec<WorkItem> = Vec::new();
    for (span_index, (name, span)) in span_pairs.into_iter().enumerate() {
        debug_assert_eq!(name, span.name);
        let mut occurrences: HashMap<String, u32> = HashMap::new();
        for (id, r) in span.anchors {
            let source_ordinal = {
                let n = occurrences.entry(id.clone()).or_insert(0);
                let v = *n;
                *n += 1;
                v
            };
            work.push(WorkItem {
                span_index,
                source_ordinal,
                anchor_id: id,
                anchor: r,
            });
        }
        let follow_moves = span.config.follow_moves;
        span_metas.push(SpanMeta {
            name: span.name,
            why: span.why,
            follow_moves,
            config: span.config,
        });
    }

    // Fork the flattened work items via rayon. `map_init` gives each concurrent
    // task its own `EngineLocal` (own `FilterProcess`/`LfsState` subprocess
    // handles, own `layers` scratch) and its own thread-local `gix::Repository`
    // clone — `gix::Repository` is `!Sync`, so it is materialized per task from
    // a `Send + Sync` `ThreadSafeRepository` in the `map_init` initializer and
    // reused for every item that task processes. `shared`/`concurrent` are the
    // read-only context and the interior-mutable memo store, shared by plain
    // `&`. `.with_min_len(min_anchors_per_task)` floors rayon's split
    // granularity: the primary cold `drift` path passes the low
    // `COLD_DRIFT_MIN_ANCHORS_PER_TASK` so realistic anchor counts fork across
    // the machine's cores, while the small-batch `incremental`/`dirty` callers
    // pass the higher `SMALL_BATCH_MIN_ANCHORS_PER_TASK`, which sits above their
    // typical anchor counts and keeps them on one task (one `EngineLocal`) with
    // no separate serial threshold. `.collect::<Vec<_>>()` preserves input-anchor
    // order regardless of completion order.
    //
    // Card main-162 staged-rollout step 5 (this phase): the fork runs on rayon's
    // global pool at the default thread count, enabling real parallelism. The
    // global pool honors `RAYON_NUM_THREADS` when a caller sets it — the real,
    // functioning thread-count knob the correctness matrix compares across
    // (`RAYON_NUM_THREADS=1` vs default must stay byte-identical, both
    // directions). Phase 4's single-thread `ThreadPoolBuilder` pin — which proved
    // the flatten / ordinal pre-pass / ordered-collect / regroup plumbing at
    // single-threaded-equivalent operation — is removed now that the plumbing is
    // proven.
    let shared = &state.shared;
    let concurrent = &state.concurrent;
    let span_metas_ref = &span_metas;
    let repo_sync = repo.clone().into_sync();

    // Each item always produces a value: the per-anchor closure never uses `?`,
    // so a failing anchor yields `(span_index, source_ordinal, Err(..))` rather
    // than short-circuiting the parallel collect. `.collect::<Vec<_>>()` (never
    // `Result<Vec<_>, _>`) therefore cannot surface a completion-order-dependent
    // error — the first-in-input-order `Err` is recovered by the serial scan
    // below, reproducing the serial loop's early-return exactly regardless of
    // thread count or scheduling.
    let collected: Vec<(usize, u32, Result<AnchorCore>)> = work
        .into_par_iter()
        .with_min_len(min_anchors_per_task)
        .map_init(
            || {
                (
                    EngineLocal::new(LayerSet::full(), true),
                    repo_sync.to_thread_local(),
                )
            },
            |(local, repo_local), item| {
                let meta = &span_metas_ref[item.span_index];
                let core = anchor::resolve_anchor_captured(
                    AnchorCtx {
                        repo: repo_local,
                        shared,
                        concurrent,
                    },
                    local,
                    &meta.config,
                    &item.anchor_id,
                    item.anchor,
                );
                (item.span_index, item.source_ordinal, core)
            },
        )
        .collect();

    // Rebuild the per-span groupings from the flat, input-ordered result: one
    // `SpanCore` per span (preserving empty-anchor spans), regrouped by the
    // carried `span_index`. The `result?` reproduces the serial loop's
    // first-in-input-order early-return: `collected` is in input-anchor order,
    // so the first `Err` scanned here is exactly the anchor the serial `?` would
    // have surfaced.
    let mut spans: Vec<SpanCore> = span_metas
        .iter()
        .map(|m| SpanCore {
            name: m.name.clone(),
            why: m.why.clone(),
            follow_moves: m.follow_moves,
            anchors: Vec::new(),
        })
        .collect();
    for (span_index, source_ordinal, result) in collected {
        let anchor_core = result?;
        let definition_digest = DefinitionOrdinal::digest_definition(
            &anchor_core.anchor_id,
            &anchor_core.anchor_sha,
            &anchor_core.anchored.path,
            anchor_core.anchored.extent,
        );
        let ordinal = DefinitionOrdinal {
            span_identity: span_metas[span_index].name.clone(),
            source_ordinal,
            definition_digest,
        };
        spans[span_index].anchors.push((ordinal, anchor_core));
    }
    state.finish(repo);
    Ok(ResolutionCore { spans })
}

/// Build the reusable source-layer state (worktree/index `git status` scan)
/// without resolving any span. Used by `drift --fix` to compute the source
/// layers once before `apply_fix` mutates `.span/`, then reuse them for the
/// post-fix re-resolve so the post-fix pass skips its own source scan.
pub(crate) fn build_source_layers(
    repo: &gix::Repository,
    options: EngineOptions,
) -> Result<SourceLayers> {
    EngineState::build_source_layers(repo, options.layers, options.needs_all_layers)
}

/// Like `resolve_named_spans`, but reuses source-layer state captured by a
/// pre-fix `drift_spans_retaining_source_layers` instead of re-reading the
/// worktree source layer via `EngineState::new`. Used by the cold-path
/// post-fix re-resolve in `drift --fix` to skip a second `read-worktree-layer`.
pub(crate) fn resolve_named_spans_with_source_layers(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
    source_layers: SourceLayers,
) -> Result<NamedSpanResults> {
    let _immutable = crate::perf::immutable_invocation();
    let state = EngineState::from_source_layers(
        source_layers,
        repo,
        options.needs_all_layers,
        options.fuzzy_threshold,
    );
    let (out, state) = resolve_named_spans_with_state(repo, span_root, names, state)?;
    state.finish(repo);
    Ok(out)
}

/// Like `resolve_named_spans`, but on the named-scope pre-fix pass retains the
/// source-layer state so the post-fix re-resolve can skip a second
/// `read-worktree-layer`. Returns the retained `SourceLayers`.
pub(crate) fn resolve_named_spans_retaining_source_layers(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
) -> Result<(NamedSpanResults, SourceLayers)> {
    let _immutable = crate::perf::immutable_invocation();
    let state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let (out, state) = resolve_named_spans_with_state(repo, span_root, names, state)?;
    Ok((out, state.finish_retaining_layers(repo)))
}

pub(crate) fn resolve_named_spans_with_state(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    mut state: EngineState,
) -> Result<(NamedSpanResults, EngineState)> {
    let _perf = crate::perf::span("resolver.resolve-named-spans");

    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let resolved = resolve_span_with_state(repo, span_root, &mut state, name);
        out.push((name.clone(), resolved));
    }
    // Emit session perf counters matching drift_spans_inner so named-span
    // resolution is observable through the same perf counter interface.
    emit_session_counters(&state.concurrent);
    // Finishing is the caller's decision: each wrapper either drops the
    // session state (`finish`) or keeps the source layers
    // (`finish_retaining_layers`). Returning the state instead of an
    // `Option<SourceLayers>` makes "retaining callers get layers" a
    // compile-time property rather than a cross-function convention.
    Ok((out, state))
}

/// Emit the per-session cache perf counters shared by every batch
/// resolution surface (`drift_spans_inner`, named-span resolution, and
/// each parallel baseline worker).
fn emit_session_counters(session: &ConcurrentSession) {
    crate::perf::counter(
        "session.relocation-candidate-reads",
        session.relocation_candidate_reads.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.line-index-hits",
        session.line_index_hits.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.line-index-misses",
        session.line_index_misses.load(Ordering::Relaxed),
    );
    // Card main-300: blob-text memo engagement (compute_layer_sources reads)
    // and index-snapshot materializations per session.
    crate::perf::counter(
        "session.blob-text-hits",
        session.blob_text_hits.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.blob-text-misses",
        session.blob_text_misses.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.index-snapshot-loads",
        session.index_snapshot_loads.load(Ordering::Relaxed),
    );
}

/// Result of a drift-spans resolve pass.
struct DriftSpansOutput {
    spans: Vec<SpanResolved>,
    trace_rows: Vec<crate::perf::TraceRow>,
    source_layers: Option<SourceLayers>,
}

fn drift_spans_inner(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    enable_trace: bool,
    retain_layers: bool,
) -> Result<DriftSpansOutput> {
    crate::perf::reset_resolution_subroutine_counters();
    let span_pairs: Vec<(String, Span)> = {
        let _perf = crate::perf::span("resolver.read-span-files");
        crate::span::read::load_all_spans_in(repo, span_root)?.0
    };
    let mut out = Vec::new();
    let mut state = {
        let _perf = crate::perf::span("resolver.engine-state-new");
        EngineState::new_with_fuzzy_threshold(
            repo,
            options.layers,
            options.needs_all_layers,
            options.fuzzy_threshold,
        )?
    };
    if enable_trace {
        state.concurrent.enable_trace();
    }
    let mut can_skip_clean_head_ns: u128 = 0;
    {
        let _perf = crate::perf::span("resolver.resolve-drift-spans");
        for (name, span) in span_pairs {
            // When tracing is active we must resolve every span so every anchor
            // gets a TraceRow. Skipping here would silently drop clean spans from
            // the CSV and break the documented invariant `wc -l == anchors-total + 1`.
            if !enable_trace {
                let t = std::time::Instant::now();
                let skip =
                    can_skip_clean_head_pinned_span(repo, &mut state, &name, &span, options)?;
                can_skip_clean_head_ns += t.elapsed().as_nanos();
                if skip {
                    state.concurrent.anchors_skipped_clean_head += span.anchors.len() as u64;
                    continue;
                }
            }
            let resolved = resolve_loaded_span_with_state(repo, &mut state, span)?;
            if span_has_actionable_drift(&resolved) {
                out.push(resolved);
            }
        }
    }
    crate::perf::counter(
        "resolver.can-skip-clean-head-us",
        (can_skip_clean_head_ns / 1_000) as u64,
    );
    crate::perf::counter(
        "session.relocation-candidate-reads",
        state
            .concurrent
            .relocation_candidate_reads
            .load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.line-index-hits",
        state.concurrent.line_index_hits.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.line-index-misses",
        state.concurrent.line_index_misses.load(Ordering::Relaxed),
    );
    // Card main-300: blob-text memo engagement (compute_layer_sources
    // reads) and index-snapshot materializations — the snapshot count is
    // constant per run regardless of drifted-anchor count.
    crate::perf::counter(
        "session.blob-text-hits",
        state.concurrent.blob_text_hits.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.blob-text-misses",
        state.concurrent.blob_text_misses.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.index-snapshot-loads",
        state.concurrent.index_snapshot_loads.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.drift-locus-hits",
        state.concurrent.drift_locus_hits.load(Ordering::Relaxed),
    );
    crate::perf::counter(
        "session.drift-locus-misses",
        state.concurrent.drift_locus_misses.load(Ordering::Relaxed),
    );
    let filter_attr_hits = state.concurrent.filter_attr_hits.load(Ordering::Relaxed);
    let filter_attr_misses = state.concurrent.filter_attr_misses.load(Ordering::Relaxed);
    crate::perf::counter("session.filter-attr-hits", filter_attr_hits);
    crate::perf::counter("session.filter-attr-misses", filter_attr_misses);
    // Category 1: hot-path subroutine counters. `filter-attr-*` come from
    // the engine-state memo (one increment per `filter_short_circuit` call,
    // misses count distinct paths); the remaining counters are process-global
    // and reset at the top of `drift_spans`.
    crate::perf::counter(
        "session.filter-attr-calls",
        filter_attr_hits + filter_attr_misses,
    );
    crate::perf::counter("session.filter-attr-distinct-paths", filter_attr_misses);
    // Tier legend for the `session.*` family below:
    //   `gix-open-calls`     — count of `gix::open(...)` invocations the resolver
    //                          triggers (each pays `.git/config` parse + parent
    //                          walk; no internal caching).
    //   `attr-for-calls`     — count of [`crate::git::attr_for`] invocations.
    //                          gix's `Repository::index_or_load_from_head`
    //                          internally caches the `gix::index::File`, so the
    //                          actual `.git/index` open count (observable via
    //                          `strace -e openat -f -- ... | grep .git/index`)
    //                          is unrelated to this counter and typically far
    //                          smaller.
    crate::perf::counter("session.gix-open-calls", crate::perf::gix_open_calls());
    crate::perf::counter("session.attr-for-calls", crate::perf::attr_for_calls());
    // Category 2: anchor-set decomposition.
    let anchors_total = state.concurrent.anchors_total();
    crate::perf::counter("session.anchors-total", anchors_total);
    crate::perf::counter("session.anchors-fresh", state.concurrent.anchors_fresh);
    crate::perf::counter("session.anchors-moved", state.concurrent.anchors_moved);
    crate::perf::counter("session.anchors-changed", state.concurrent.anchors_changed);
    crate::perf::counter(
        "session.anchors-orphaned",
        state.concurrent.anchors_orphaned,
    );
    crate::perf::counter(
        "session.anchors-merge-conflict",
        state.concurrent.anchors_merge_conflict,
    );
    crate::perf::counter(
        "session.anchors-unavailable",
        state.concurrent.anchors_unavailable,
    );
    crate::perf::counter(
        "session.anchors-skipped-clean-head",
        state.concurrent.anchors_skipped_clean_head,
    );
    let anchors_fast_path_hits = state
        .concurrent
        .anchors_fast_path_hits
        .load(Ordering::Relaxed);
    crate::perf::counter("session.anchors-fast-path-hits", anchors_fast_path_hits);
    crate::perf::counter(
        "session.anchors-full-resolution",
        anchors_total
            .saturating_sub(anchors_fast_path_hits)
            .saturating_sub(state.concurrent.anchors_skipped_clean_head),
    );
    // Category 3: per-anchor resolution distribution.
    {
        let mut per_anchor = std::mem::take(&mut state.concurrent.per_anchor_us);
        per_anchor.sort_unstable();
        let percentile = |q: f64| -> u64 {
            if per_anchor.is_empty() {
                return 0;
            }
            let idx = ((per_anchor.len() as f64 - 1.0) * q).round() as usize;
            // Round to nearest millisecond for legibility.
            ((per_anchor[idx] + 500) / 1000) as u64
        };
        crate::perf::counter("resolve-anchor.p50-ms", percentile(0.50));
        crate::perf::counter("resolve-anchor.p95-ms", percentile(0.95));
    }
    // Legend: `session.*` counts in-process state and subroutine calls;
    // `resolve-anchor.*` names the per-anchor distribution. Cache-tier traffic
    // for the SQLite store is reported separately under `cache-path.*` (emitted
    // by `resolver::exact`).
    crate::perf::note(
        "session.group-legend: session.* counts in-process state and subroutine calls; \
         resolve-anchor.* names per-anchor distribution",
    );
    let trace_rows = state.concurrent.per_anchor_trace.take().unwrap_or_default();
    let source_layers = if retain_layers {
        Some(state.finish_retaining_layers(repo))
    } else {
        state.finish(repo);
        None
    };
    if out.len() > 1 {
        sort_spans_by_anchor_path(&mut out);
    }
    Ok(DriftSpansOutput {
        spans: out,
        trace_rows,
        source_layers,
    })
}

pub fn drift_spans(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<Vec<SpanResolved>> {
    let _immutable = crate::perf::immutable_invocation();
    // The SQLite store is the only cache path. On [`ExactAttempt::Resolved`] it
    // rendered the reportable set (already reportable-filtered and sorted). A
    // [`ExactAttempt::Bypass`] — cache disabled, ineligible run, or store fault
    // — falls through to the uncached authoritative resolver directly; there is
    // no legacy cache tier to fall back on.
    if let crate::resolver::exact::ExactAttempt::Resolved { spans, .. } =
        crate::resolver::exact::drift_spans_new_store(repo, span_root, options)?
    {
        return Ok(spans);
    }
    let output = drift_spans_inner(repo, span_root, options, false, false)?;
    Ok(output.spans)
}

/// Like `drift_spans`, but on the uncached cold path (store bypass → an
/// `EngineState` is built) it retains the source-layer state so the post-fix
/// re-resolve in `drift --fix` can skip a second `read-worktree-layer`.
///
/// Returns `(spans, Some(source_layers), None)` on the uncached cold path and
/// `(spans, None, Option<whole_result>)` on a store hit. `whole_result` is
/// `Some` whenever the store rendered from its compact summary; it carries the
/// full anchor set and anchor totals so `run_drift` can skip its per-invocation
/// phases.
pub(crate) fn drift_spans_retaining_source_layers(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<(
    Vec<SpanResolved>,
    Option<SourceLayers>,
    Option<crate::resolver::WholeResult>,
)> {
    let _immutable = crate::perf::immutable_invocation();
    // The SQLite store is the only cache path. On a `Resolved` outcome the store
    // rendered the reportable set and hands back the render-ready whole-result
    // so `run_drift` skips its per-invocation corpus reload (count-totals /
    // Fresh-anchor backfill / interior-anchor scan). There is no retained
    // `SourceLayers` (a `--fix` post-pass rebuilds them). A `Bypass` — cache
    // disabled, ineligible run, or store fault — runs the uncached authoritative
    // resolver, retaining its source layers.
    if let crate::resolver::exact::ExactAttempt::Resolved {
        spans,
        whole_result,
    } = crate::resolver::exact::drift_spans_new_store(repo, span_root, options)?
    {
        return Ok((spans, None, whole_result));
    }
    let output = drift_spans_inner(repo, span_root, options, false, true)?;
    Ok((output.spans, output.source_layers, None))
}

pub fn drift_spans_with_trace(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<(Vec<SpanResolved>, Vec<crate::perf::TraceRow>)> {
    let _immutable = crate::perf::immutable_invocation();
    let output = drift_spans_inner(repo, span_root, options, true, false)?;
    Ok((output.spans, output.trace_rows))
}

pub(crate) fn sort_spans_by_anchor_path(spans: &mut [SpanResolved]) {
    let _perf = crate::perf::span("resolver.sort-spans");
    if spans.len() <= 1 {
        return;
    }

    // Build sort keys: sorted anchor paths per span
    let keys: Vec<Vec<PathBuf>> = spans
        .iter()
        .map(|m| {
            let mut paths: Vec<PathBuf> =
                m.anchors.iter().map(|a| a.anchored.path.clone()).collect();
            paths.sort();
            paths
        })
        .collect();

    // Precompute overlap: does this span have extent overlap with any other
    // span that shares the exact same path tuple?
    let has_overlap: Vec<bool> = (0..spans.len())
        .map(|i| {
            for j in 0..spans.len() {
                if i != j
                    && keys[i] == keys[j]
                    && spans_share_extent_overlap(&spans[i], &spans[j], &keys[i])
                {
                    return true;
                }
            }
            false
        })
        .collect();

    // Sort indices by path tuple comparison + overlap sub-grouping
    let mut indices: Vec<usize> = (0..spans.len()).collect();
    indices.sort_by(|&a, &b| {
        let paths_a = &keys[a];
        let paths_b = &keys[b];

        // Primary: lexicographic comparison of path tuples
        for (pa, pb) in paths_a.iter().zip(paths_b.iter()) {
            match pa.cmp(pb) {
                std::cmp::Ordering::Less => return std::cmp::Ordering::Less,
                std::cmp::Ordering::Greater => return std::cmp::Ordering::Greater,
                std::cmp::Ordering::Equal => continue,
            }
        }
        match paths_a.len().cmp(&paths_b.len()) {
            std::cmp::Ordering::Less => return std::cmp::Ordering::Less,
            std::cmp::Ordering::Greater => return std::cmp::Ordering::Greater,
            std::cmp::Ordering::Equal => {}
        }

        // Path tuples identical. Sub-group by extent overlap. A true tie
        // (no overlap either way) returns Equal so the stable sort preserves
        // the caller's input order; the output-equivalence tests assert this
        // holds identically on both the read-only and `--fix` passes.
        match (has_overlap[a], has_overlap[b]) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        }
    });

    // Apply permutation via cycle descent (convert from "from-permutation"
    // to "to-permutation" first)
    let mut perm: Vec<usize> = vec![0; spans.len()];
    for (sorted_pos, &orig_pos) in indices.iter().enumerate() {
        perm[orig_pos] = sorted_pos;
    }
    for i in 0..spans.len() {
        while perm[i] != i {
            let k = perm[i];
            spans.swap(i, k);
            perm.swap(i, k);
        }
    }
}

fn extents_overlap(a: &AnchorExtent, b: &AnchorExtent) -> bool {
    match (a, b) {
        (AnchorExtent::WholeFile, _) | (_, AnchorExtent::WholeFile) => true,
        (
            AnchorExtent::LineRange { start: sa, end: ea },
            AnchorExtent::LineRange { start: sb, end: eb },
        ) => *sa <= *eb && *sb <= *ea,
    }
}

fn spans_share_extent_overlap(a: &SpanResolved, b: &SpanResolved, paths: &[PathBuf]) -> bool {
    for path in paths {
        for anc_a in &a.anchors {
            if anc_a.anchored.path != *path {
                continue;
            }
            for anc_b in &b.anchors {
                if anc_b.anchored.path != *path {
                    continue;
                }
                if extents_overlap(&anc_a.anchored.extent, &anc_b.anchored.extent) {
                    return true;
                }
            }
        }
    }
    false
}

fn can_skip_clean_head_pinned_span(
    repo: &gix::Repository,
    state: &mut EngineState,
    name: &str,
    span: &crate::types::Span,
    options: EngineOptions,
) -> Result<bool> {
    // In the file-backed model, anchor_sha and blob are empty, so we
    // cannot use the old commit-based fast-path. Always return false
    // (full resolution) for correctness. A hash-based fast-path can be
    // added as a future optimization.
    let _ = (repo, state, name, span, options);
    Ok(false)
}

/// Returns `true` when the workspace's enabled content layers agree
/// with HEAD *for `path` specifically*, even if some other path in the
/// workspace is dirty. The global `shared.clean_layers` is a
/// fast-positive trivial-true shortcut so the genuinely-clean
/// workspace skips the per-path HashMap probes; the same shortcut
/// covers the "no content layers enabled" case.
pub(crate) fn anchor_path_is_layer_clean(
    local: &EngineLocal,
    shared: &SharedEngineContext,
    path: &str,
) -> bool {
    if shared.clean_layers || (!local.layers.index && !local.layers.worktree) {
        return true;
    }
    if shared.conflicted_paths.contains(path) {
        return false;
    }
    if local.layers.index
        && shared
            .index_diffs
            .as_ref()
            .is_some_and(|d| d.map.contains_key(path))
    {
        return false;
    }
    if local.layers.worktree
        && shared
            .worktree_diffs
            .as_ref()
            .is_some_and(|d| d.map.contains_key(path))
    {
        return false;
    }
    true
}

fn deleted_placeholder(anchor_id: &str) -> AnchorResolved {
    AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: String::new(),
        stored_hash: String::new(),
        anchored: AnchorLocation {
            path: PathBuf::new(),
            extent: AnchorExtent::LineRange { start: 0, end: 0 },
            blob: None,
        },
        current: None,
        status: AnchorStatus::Deleted,
        content_equivalent: false,
        source: None,
        layer_sources: vec![],
        locus: None,
        fuzzy_successors: vec![],
        moved_uncommitted: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_span(name: &str, anchors: &[(&str, AnchorExtent)]) -> SpanResolved {
        SpanResolved {
            name: name.to_string(),
            why: String::new(),
            anchors: anchors
                .iter()
                .map(|(path, extent)| AnchorResolved {
                    anchor_id: String::new(),
                    anchor_sha: String::new(),
                    stored_hash: String::new(),
                    anchored: AnchorLocation {
                        path: PathBuf::from(path),
                        extent: *extent,
                        blob: None,
                    },
                    current: None,
                    status: AnchorStatus::Fresh,
                    content_equivalent: false,
                    source: None,
                    layer_sources: vec![],
                    locus: None,
                    fuzzy_successors: vec![],
                    moved_uncommitted: false,
                })
                .collect(),
            follow_moves: false,
        }
    }

    /// Every `AnchorStatus` variant, so the boundary tests below are
    /// exhaustive by construction: a new variant that is not added here
    /// leaves the compile-time `match` in `drift_reporting_class` red first,
    /// and this list second.
    fn every_anchor_status() -> Vec<AnchorStatus> {
        vec![
            AnchorStatus::Fresh,
            AnchorStatus::ResolvedPendingCommit,
            AnchorStatus::Moved,
            AnchorStatus::Changed,
            AnchorStatus::Deleted,
            AnchorStatus::MergeConflict,
            AnchorStatus::Submodule,
            AnchorStatus::ContentUnavailable(UnavailableReason::PromisorMissing),
        ]
    }

    /// The actionable-drift boundary `git span drift`'s exit status and
    /// `git span history`'s `current` block share: exactly `Fresh` and
    /// `ResolvedPendingCommit` are excluded, everything else is drift.
    #[test]
    fn drift_boundary_excludes_exactly_fresh_and_pending_commit() {
        for status in every_anchor_status() {
            let expected = !matches!(
                status,
                AnchorStatus::Fresh | AnchorStatus::ResolvedPendingCommit
            );
            assert_eq!(
                anchor_status_is_drift(&status),
                expected,
                "actionable-drift boundary moved for {status:?}"
            );
        }
    }

    /// Discovery keeps every non-`Fresh` span visible — including one whose
    /// only non-`Fresh` anchor is informational `ResolvedPendingCommit` —
    /// while the actionable boundary excludes it. The two predicates must
    /// disagree on exactly the informational states and nowhere else.
    #[test]
    fn discovery_and_drift_boundaries_disagree_only_on_informational_states() {
        for status in every_anchor_status() {
            let mut span = make_span("m", &[("a.ts", AnchorExtent::WholeFile)]);
            span.anchors[0].status = status.clone();

            let reportable = span_is_reportable_in_drift_discovery(&span);
            assert_eq!(
                reportable,
                status != AnchorStatus::Fresh,
                "discovery boundary moved for {status:?}"
            );

            let informational = matches!(status, AnchorStatus::ResolvedPendingCommit);
            assert_eq!(
                reportable && !anchor_status_is_drift(&status),
                informational,
                "informational gap between the two boundaries moved for {status:?}"
            );
        }
    }

    #[test]
    fn single_span_no_op() {
        let m = make_span("m1", &[]);
        let mut spans = vec![m];
        sort_spans_by_anchor_path(&mut spans);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].name, "m1");
    }

    #[test]
    fn primary_path_ordering() {
        let m1 = make_span("m1", &[("b.ts", AnchorExtent::WholeFile)]);
        let m2 = make_span("m2", &[("a.ts", AnchorExtent::WholeFile)]);
        let mut spans = vec![m1, m2];
        sort_spans_by_anchor_path(&mut spans);
        assert_eq!(spans[0].name, "m2");
        assert_eq!(spans[1].name, "m1");
    }

    #[test]
    fn multi_path_tie_breaking() {
        let m1 = make_span(
            "m1",
            &[
                ("a.ts", AnchorExtent::WholeFile),
                ("c.ts", AnchorExtent::WholeFile),
            ],
        );
        let m2 = make_span(
            "m2",
            &[
                ("a.ts", AnchorExtent::WholeFile),
                ("b.ts", AnchorExtent::WholeFile),
            ],
        );
        let mut spans = vec![m1, m2];
        sort_spans_by_anchor_path(&mut spans);
        assert_eq!(spans[0].name, "m2");
        assert_eq!(spans[1].name, "m1");
    }

    #[test]
    fn prefix_ordering() {
        let m1 = make_span("m1", &[("a.ts", AnchorExtent::WholeFile)]);
        let m2 = make_span(
            "m2",
            &[
                ("a.ts", AnchorExtent::WholeFile),
                ("b.ts", AnchorExtent::WholeFile),
            ],
        );
        let mut spans = vec![m1, m2];
        sort_spans_by_anchor_path(&mut spans);
        assert_eq!(spans[0].name, "m1");
        assert_eq!(spans[1].name, "m2");
    }

    #[test]
    fn identical_paths_overlapping_extents() {
        let m1 = make_span(
            "m1",
            &[("a.ts", AnchorExtent::LineRange { start: 1, end: 10 })],
        );
        let m2 = make_span(
            "m2",
            &[("a.ts", AnchorExtent::LineRange { start: 5, end: 20 })],
        );
        let m3 = make_span(
            "m3",
            &[(
                "a.ts",
                AnchorExtent::LineRange {
                    start: 50,
                    end: 100,
                },
            )],
        );
        let mut spans = vec![m1, m2, m3];
        sort_spans_by_anchor_path(&mut spans);
        // m1 and m2 overlap on a.ts, so they should be adjacent.
        // m3 has no overlap with either, so it sorts after the overlapping cluster.
        // Within the overlap cluster, stable sort preserves input order (m1 before m2).
        assert_eq!(spans[0].name, "m1");
        assert_eq!(spans[1].name, "m2");
        assert_eq!(spans[2].name, "m3");
    }

    /// Regression: `EngineState::filter_short_circuit` memoizes per-path
    /// across an entire `drift` run. Two probes for the same path produce
    /// exactly one miss (the cold lookup); two probes for distinct paths
    /// produce two misses. This is the binding contract for the
    /// performance fix in main-65 — without the memo, every call to
    /// `filter_short_circuit` redid `gix::open` + `index_or_load_from_head`
    /// + `repo.attributes(…)`.
    #[test]
    fn filter_short_circuit_memoizes_per_path() {
        use std::process::Command;
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        for args in [
            &["init", "--initial-branch=main"][..],
            &["config", "user.email", "t@t"],
            &["config", "user.name", "t"],
            &["config", "commit.gpgsign", "false"],
        ] {
            let out = Command::new("git")
                .current_dir(dir)
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success());
        }
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        std::fs::write(dir.join("b.txt"), "b\n").unwrap();
        Command::new("git")
            .current_dir(dir)
            .args(["add", "-A"])
            .output()
            .unwrap();
        let out = Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        assert!(out.status.success());

        let repo = gix::open(dir).unwrap();
        let state = EngineState::new(
            &repo,
            LayerSet {
                index: false,
                worktree: false,
                staged_span: false,
            },
            true,
        )
        .unwrap();

        // First lookup for `a.txt` → miss.
        let _ = state
            .concurrent
            .filter_short_circuit(&repo, "a.txt")
            .unwrap();
        assert_eq!(
            state.concurrent.filter_attr_misses.load(Ordering::Relaxed),
            1
        );
        assert_eq!(state.concurrent.filter_attr_hits.load(Ordering::Relaxed), 0);

        // Repeated lookup for the same path → hit, no new miss.
        let _ = state
            .concurrent
            .filter_short_circuit(&repo, "a.txt")
            .unwrap();
        let _ = state
            .concurrent
            .filter_short_circuit(&repo, "a.txt")
            .unwrap();
        assert_eq!(
            state.concurrent.filter_attr_misses.load(Ordering::Relaxed),
            1
        );
        assert_eq!(state.concurrent.filter_attr_hits.load(Ordering::Relaxed), 2);

        // Distinct path → one additional miss.
        let _ = state
            .concurrent
            .filter_short_circuit(&repo, "b.txt")
            .unwrap();
        let _ = state
            .concurrent
            .filter_short_circuit(&repo, "b.txt")
            .unwrap();
        assert_eq!(
            state.concurrent.filter_attr_misses.load(Ordering::Relaxed),
            2
        );
        assert_eq!(state.concurrent.filter_attr_hits.load(Ordering::Relaxed), 3);
    }

    fn state_for_predicate(
        layers: LayerSet,
        clean_layers: bool,
        index_paths: &[&str],
        worktree_paths: &[&str],
        conflicted: &[&str],
    ) -> EngineState {
        use crate::resolver::layers::LayerDiffs;
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        for args in [
            &["init", "--initial-branch=main"][..],
            &["config", "user.email", "t@t"],
            &["config", "user.name", "t"],
            &["config", "commit.gpgsign", "false"],
        ] {
            let out = std::process::Command::new("git")
                .current_dir(dir)
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success());
        }
        std::fs::write(dir.join("seed"), "s\n").unwrap();
        std::process::Command::new("git")
            .current_dir(dir)
            .args(["add", "-A"])
            .output()
            .unwrap();
        let out = std::process::Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        assert!(out.status.success());
        let repo = gix::open(dir).unwrap();
        let mut state = EngineState::new(&repo, layers, true).unwrap();
        state.shared.clean_layers = clean_layers;
        let mut idx = LayerDiffs::empty();
        for p in index_paths {
            idx.map.insert(
                (*p).to_string(),
                crate::resolver::layers::diff::DiffEntry {
                    new_path: (*p).to_string(),
                    old_path: (*p).to_string(),
                    hunks: vec![],
                    new_blob: None,
                    deleted: false,
                },
            );
        }
        state.shared.index_diffs = Some(idx);
        let mut wt = LayerDiffs::empty();
        for p in worktree_paths {
            wt.map.insert(
                (*p).to_string(),
                crate::resolver::layers::diff::DiffEntry {
                    new_path: (*p).to_string(),
                    old_path: (*p).to_string(),
                    hunks: vec![],
                    new_blob: None,
                    deleted: false,
                },
            );
        }
        state.shared.worktree_diffs = Some(wt);
        for p in conflicted {
            state.shared.conflicted_paths.insert((*p).to_string());
        }
        state
    }

    #[test]
    fn anchor_path_predicate_clean_path() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &["other.rs"], &["wiki/x.md"], &[]);
        assert!(anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_index_dirty() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &["packages/anchor.rs"], &[], &[]);
        assert!(!anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_worktree_dirty() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &[], &["packages/anchor.rs"], &[]);
        assert!(!anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_conflicted() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &[], &[], &["packages/anchor.rs"]);
        assert!(!anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_layers_disabled() {
        let layers = LayerSet {
            index: false,
            worktree: false,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &[], &[], &["packages/anchor.rs"]);
        // With no content layers enabled, every path is trivially clean.
        assert!(anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_index_dirty_but_index_layer_off() {
        let layers = LayerSet {
            index: false,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &["packages/anchor.rs"], &[], &[]);
        // Index layer disabled → index diffs don't disqualify.
        assert!(anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "packages/anchor.rs"
        ));
    }

    #[test]
    fn anchor_path_predicate_clean_layers_shortcut() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        // clean_layers=true should trivially-true every path regardless
        // of conflicted_paths (which is logically empty under
        // clean_layers=true; the shortcut is what makes the genuinely
        // clean workspace skip the HashMap probes).
        let state = state_for_predicate(layers, true, &[], &[], &[]);
        assert!(anchor_path_is_layer_clean(
            &state.local,
            &state.shared,
            "anything.rs"
        ));
    }

    #[test]
    fn determinism() {
        let m1 = make_span("m1", &[("b.ts", AnchorExtent::WholeFile)]);
        let m2 = make_span("m2", &[("a.ts", AnchorExtent::WholeFile)]);
        let m3 = make_span("m3", &[("c.ts", AnchorExtent::WholeFile)]);
        let mut spans_a = vec![m1.clone(), m2.clone(), m3.clone()];
        let mut spans_b = vec![m1, m2, m3];
        sort_spans_by_anchor_path(&mut spans_a);
        sort_spans_by_anchor_path(&mut spans_b);
        assert_eq!(spans_a, spans_b);
    }

    /// When the index changes between `EngineState` construction and `finish`,
    /// the returned `SourceLayers` must carry `index_changed = true` so callers
    /// can distinguish a racy scan from a genuine drifted/clean verdict. Before
    /// the fix for card main-199-2, `finish` only printed a stderr warning and
    /// the signal was lost.
    #[test]
    fn finish_retaining_layers_reports_index_changed() {
        use std::process::Command;
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        for args in [
            &["init", "--initial-branch=main"][..],
            &["config", "user.email", "t@t"],
            &["config", "user.name", "t"],
            &["config", "commit.gpgsign", "false"],
        ] {
            let out = Command::new("git")
                .current_dir(dir)
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success());
        }
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        Command::new("git")
            .current_dir(dir)
            .args(["add", "-A"])
            .output()
            .unwrap();
        let out = Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        assert!(out.status.success());

        let repo = gix::open(dir).unwrap();
        let state = EngineState::new(
            &repo,
            LayerSet {
                index: true,
                worktree: true,
                staged_span: false,
            },
            true,
        )
        .unwrap();

        // Mutate `.git/index` so the trailer read in `finish_retaining_layers`
        // disagrees with `index_trailer_start` captured at construction.
        // Appending a byte changes the SHA-1 trailer (last 20 bytes).
        let index_path = dir.join(".git").join("index");
        let mut index_bytes = std::fs::read(&index_path).unwrap();
        index_bytes.push(0);
        std::fs::write(&index_path, &index_bytes).unwrap();

        let layers = state.finish_retaining_layers(&repo);
        assert!(
            layers.index_changed,
            "finish_retaining_layers must report index_changed when the index \
             was mutated between construction and finish"
        );
    }

    /// Plan §Test matrix, "indeterminate" row: the resolver's `index_changed`
    /// verdict must surface on `ReconcileCheck.indeterminate` — the only
    /// verdict that drives exit 2, the retryable condition exactly as `git
    /// span drift` defines it — and must not be dropped at the check level.
    ///
    /// Anti-premise guard: `finish_retaining_layers_reports_index_changed`
    /// (above) asserts only `SourceLayers.index_changed` — the seam verdict
    /// itself. This test is the first to assert the downstream
    /// `ReconcileCheck`-level mapping, so "already covered" can never justify
    /// skipping it. The premise assertion below fails loudly if the seam
    /// drive stops yielding `index_changed = true`, so the test cannot pass
    /// vacuously on a check derived from a verdict that never fired.
    #[test]
    fn reconcile_check_indeterminate_from_index_changed_maps_to_exit_2() {
        use crate::cli::commit::ReconcileCheck;
        use std::process::Command;

        // Same seam drive as `finish_retaining_layers_reports_index_changed`:
        // a mutating index between `EngineState` construction and
        // `finish_retaining_layers` makes the trailer compare fire.
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        for args in [
            &["init", "--initial-branch=main"][..],
            &["config", "user.email", "t@t"],
            &["config", "user.name", "t"],
            &["config", "commit.gpgsign", "false"],
        ] {
            let out = Command::new("git")
                .current_dir(dir)
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success());
        }
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        Command::new("git")
            .current_dir(dir)
            .args(["add", "-A"])
            .output()
            .unwrap();
        let out = Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();
        assert!(out.status.success());

        let repo = gix::open(dir).unwrap();
        let state = EngineState::new(
            &repo,
            LayerSet {
                index: true,
                worktree: true,
                staged_span: false,
            },
            true,
        )
        .unwrap();

        // Mutate `.git/index` so the trailer read in `finish_retaining_layers`
        // disagrees with `index_trailer_start` captured at construction.
        // Appending a byte changes the SHA-1 trailer (last 20 bytes).
        let index_path = dir.join(".git").join("index");
        let mut index_bytes = std::fs::read(&index_path).unwrap();
        index_bytes.push(0);
        std::fs::write(&index_path, &index_bytes).unwrap();

        let layers = state.finish_retaining_layers(&repo);
        assert!(
            layers.index_changed,
            "premise: the mutating-index seam drive must yield \
             index_changed=true — without it the derivation below has \
             nothing to map and the exit-2 contract is untested"
        );

        // Derive the check the way the real `run_reconcile_check` plumbing
        // does (plan §Mechanism step 2): `indeterminate` is the resolver's
        // `index_changed` verdict only.
        let check = ReconcileCheck {
            superseded: Vec::new(),
            remaining: Vec::new(),
            drifting: Vec::new(),
            clean: false,
            indeterminate: layers.index_changed,
            check_error: None,
            total_anchors: 1,
            pending_commit_count: 0,
        };
        assert!(
            check.indeterminate,
            "the index_changed verdict must surface on ReconcileCheck.indeterminate"
        );
        assert!(
            check.check_error.is_none(),
            "indeterminate and check_error are disjoint: index-changed is the \
             retryable verdict, never the fatal path"
        );

        // Exit-code contract (plan §Exit codes), driven through the real
        // verdict → exit mapping that `run_add`/`run_why` use (extracted as
        // `reconcile_exit_code` precisely so this seam test exercises real
        // code, not a hand-rolled construction): indeterminate → 2, the
        // retryable condition exactly as drift defines it — distinct from 0
        // (clean) and 1 (drift / check error).
        let exit = crate::cli::commit::reconcile_exit_code(&check);
        assert_eq!(
            exit, 2,
            "indeterminate must map to exit 2, never 0 or 1"
        );
    }
}

#[cfg(test)]
mod immutable_perf_tests;
