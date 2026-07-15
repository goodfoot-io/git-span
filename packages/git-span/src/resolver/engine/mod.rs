//! Engine orchestration: layer setup, per-anchor resolution, span-wide
//! resolution, concurrency guard.

pub(crate) mod anchor;
pub(crate) mod whole_file;

use super::layers::{
    CustomFilters, LayerDiffs, LfsState, is_custom_filter_configured, read_conflicted_paths,
    read_index_layer, read_index_trailer, read_layer_status, read_worktree_layer,
    read_worktree_layer_for_paths,
};
use super::session::ResolveSession;

use crate::span_file_reader::SpanFileReader;
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, EngineOptions, LayerSet, Span,
    SpanResolved, span_from_file,
};
use crate::{Error, Result};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::str::FromStr;

use anchor::resolve_anchor_inner;

/// Engine-level state cached for one `stale` run.
pub(crate) struct EngineState {
    pub(crate) layers: LayerSet,
    pub(crate) head_sha: String,
    pub(crate) clean_layers: bool,
    pub(crate) index_diffs: Option<LayerDiffs>,
    pub(crate) worktree_diffs: Option<LayerDiffs>,
    pub(crate) conflicted_paths: HashSet<String>,
    index_trailer_start: Option<[u8; 20]>,
    pub(crate) warnings: Vec<String>,
    pub(crate) lfs: LfsState,
    pub(crate) custom_filters: CustomFilters,
    /// Shared state including the reverse-indexed walk output, layer
    /// caches, and perf counters.
    pub(crate) session: ResolveSession,
    /// Phase 4: when false, `compute_layer_sources` may short-circuit
    /// once it has enough information to drive the exit code. Set by
    /// `cli/stale.rs` based on whether the output mode requires per-layer
    /// detail (`--patch`, `--stat`, the `human` renderer).
    pub(crate) needs_all_layers: bool,
    /// Confidence threshold for fuzzy-similarity auto-fix. Matches at or
    /// above this threshold are automatically re-anchored by `--fix`.
    /// Default 0.95. Passed through from `EngineOptions`.
    pub(crate) fuzzy_threshold: f64,
    /// Per-command memo for anchor commit reachability. This avoids
    /// scanning all refs once per anchor in large repositories.
    commit_reachability: HashMap<String, bool>,
    /// Per-command memo for `.gitattributes` filter-driver lookups, keyed
    /// by `rel_path`. The workdir is constant per `EngineState`, so the
    /// repo handle is implicit. A cached `None` means "no driver / fail
    /// closed" (matches the pre-memo behavior on plumbing error).
    filter_attrs: HashMap<String, Option<String>>,
}

/// Reusable source-layer state captured from a pre-fix `EngineState` so the
/// post-fix re-resolve in `stale --fix` can skip re-reading the worktree
/// source layer (`read_worktree_layer*`) on the cold path.
///
/// Carries ONLY the static source-layer fields. It deliberately does NOT
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
}

impl EngineState {
    pub(crate) fn new(repo: &gix::Repository, layers: LayerSet, needs_all_layers: bool) -> Result<Self> {
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
        let mut s = EngineState {
            layers,
            head_sha,
            clean_layers,
            index_diffs: None,
            worktree_diffs: None,
            conflicted_paths: HashSet::new(),
            index_trailer_start,
            warnings: Vec::new(),
            lfs: None,
            custom_filters: HashMap::new(),
            session: ResolveSession::new(repo),
            needs_all_layers,
            fuzzy_threshold,
            commit_reachability: HashMap::new(),
            filter_attrs: HashMap::new(),
        };
        if clean_layers {
            if layers.index {
                s.index_diffs = Some(LayerDiffs::empty());
            }
            if layers.worktree {
                s.worktree_diffs = Some(LayerDiffs::empty());
            }
        } else if layers.index || layers.worktree {
            match layer_status.as_ref() {
                Some(status) if !status.requires_full_scan => {
                    if status.has_unmerged {
                        let _perf = crate::perf::span("resolver.init-layers.read-conflicts");
                        s.conflicted_paths = read_conflicted_paths(repo)?;
                    }
                    if layers.index {
                        if status.index_dirty {
                            let _perf = crate::perf::span("resolver.init-layers.read-index-layer");
                            s.index_diffs = Some(read_index_layer(repo, &mut s.warnings)?);
                        } else {
                            s.index_diffs = Some(LayerDiffs::empty());
                        }
                    }
                    if layers.worktree {
                        if status.worktree_paths.is_empty() {
                            s.worktree_diffs = Some(LayerDiffs::empty());
                        } else {
                            let _perf =
                                crate::perf::span("resolver.init-layers.read-worktree-layer");
                            s.worktree_diffs = Some(read_worktree_layer_for_paths(
                                repo,
                                &status.worktree_paths,
                                &mut s.warnings,
                            )?);
                        }
                    }
                }
                _ => {
                    let _perf = crate::perf::span("resolver.init-layers.full-scan");
                    s.conflicted_paths = read_conflicted_paths(repo)?;
                    if layers.index {
                        s.index_diffs = Some(read_index_layer(repo, &mut s.warnings)?);
                    }
                    if layers.worktree {
                        s.worktree_diffs = Some(read_worktree_layer(repo, &mut s.warnings)?);
                    }
                }
            }
        }
        Ok(s)
    }

    pub(crate) fn commit_reachable(
        &mut self,
        repo: &gix::Repository,
        commit: &str,
    ) -> Result<bool> {
        if commit == self.head_sha {
            self.commit_reachability.insert(commit.to_string(), true);
            return Ok(true);
        }
        if let Some(reachable) = self.commit_reachability.get(commit) {
            return Ok(*reachable);
        }
        // HEAD-relative: per drift-label spec, "orphaned (no sha)" applies
        // when the anchor commit is not in HEAD's history, even if another
        // ref still keeps it alive (e.g. after `checkout --orphan`).
        let reachable = crate::git::commit_reachable_from_head(repo, commit)?;
        self.commit_reachability
            .insert(commit.to_string(), reachable);
        Ok(reachable)
    }

    /// Probe `.gitattributes` for a custom `filter=<name>` driver on
    /// `path`, returning `Some(name)` when the driver is unknown
    /// (fail-loud short-circuit). Memoized per-`EngineState`: the first
    /// query for a path performs the full `attr_for` lookup; later
    /// queries are O(1) `HashMap` reads. Reuses the caller's repo handle
    /// instead of re-opening per call.
    pub(crate) fn filter_short_circuit(
        &mut self,
        repo: &gix::Repository,
        path: &str,
    ) -> Result<Option<String>> {
        let name = match self.filter_attribute_value(repo, path)? {
            Some(n) => n,
            None => return Ok(None),
        };
        if crate::types::is_core_filter(&name) {
            return Ok(None);
        }
        if is_custom_filter_configured(repo, &name) {
            return Ok(None);
        }
        Ok(Some(name))
    }

    /// LFS check routed through the per-state `filter_attrs` memo. The
    /// deepest-layer LFS short-circuit in `resolve_anchor_inner` runs once
    /// per anchor, but the `filter` attribute is a per-path fact — each
    /// distinct path pays one attribute-stack probe per state instead of
    /// one per anchor. Bare repo or any attribute-read failure → `false`.
    pub(crate) fn is_lfs_path_memo(&mut self, repo: &gix::Repository, path: &str) -> bool {
        if crate::git::work_dir(repo).is_err() {
            return false;
        }
        matches!(
            self.filter_attribute_value(repo, path),
            Ok(Some(ref n)) if n == "lfs"
        )
    }

    fn filter_attribute_value(
        &mut self,
        repo: &gix::Repository,
        path: &str,
    ) -> Result<Option<String>> {
        if let Some(cached) = self.filter_attrs.get(path) {
            self.session.filter_attr_hits += 1;
            return Ok(cached.clone());
        }
        self.session.filter_attr_misses += 1;
        // Fail-closed: any plumbing error caches `None` so subsequent
        // reads of the same path return the same answer (matches the
        // un-memoed behavior in `path_filter_attribute_with_repo`).
        let value = crate::types::path_filter_attribute_with_repo(repo, std::path::Path::new(path))
            .unwrap_or(None);
        self.filter_attrs.insert(path.to_string(), value.clone());
        Ok(value)
    }

    pub(crate) fn head_blob_at(
        &mut self,
        repo: &gix::Repository,
        path: &str,
    ) -> Result<Option<String>> {
        // Delegate to the single session-scoped `blob_oid_memo` (keyed by
        // `(commit_sha, path)`) so there is exactly one source of truth for
        // HEAD blob OIDs. `head_sha` is constant for the run.
        let head_sha = self.head_sha.clone();
        self.session.head_blob_oid(repo, &head_sha, path)
    }

    fn finish(mut self, repo: &gix::Repository) {
        // Forward session warnings (rename budget, budget downgrade, etc.)
        // from the reverse-indexed walk into the engine's warning buffer.
        self.warnings.append(&mut self.session.warnings);
        if let Some(start) = self.index_trailer_start
            && let Ok(end) = read_index_trailer(repo)
            && end != start
        {
            eprintln!("warning: index changed during stale; consider re-running");
        }
        for w in self.warnings {
            eprintln!("{w}");
        }
        // Subprocess handles drop here; `FilterProcess`'s `Drop` impl
        // closes stdin (signalling EOF) before waiting on the child.
        let _ = self.lfs;
        let _ = self.custom_filters;
    }

    /// Like `finish`, but returns the reusable source-layer state instead of
    /// dropping it, so the post-fix re-resolve in `stale --fix` can rebuild an
    /// `EngineState` without re-reading the worktree source layer.
    ///
    /// Emits the pre-fix session + engine warnings and the index-trailer
    /// change warning exactly as `finish` does — these are consumed here and
    /// are intentionally NOT carried in `SourceLayers`, so the post-fix
    /// `from_source_layers` starts clean and cannot re-emit them.
    fn finish_retaining_layers(mut self, repo: &gix::Repository) -> SourceLayers {
        // Forward session warnings (rename budget, budget downgrade, etc.)
        // from the reverse-indexed walk into the engine's warning buffer.
        self.warnings.append(&mut self.session.warnings);
        if let Some(start) = self.index_trailer_start
            && let Ok(end) = read_index_trailer(repo)
            && end != start
        {
            eprintln!("warning: index changed during stale; consider re-running");
        }
        for w in &self.warnings {
            eprintln!("{w}");
        }
        // LFS and custom_filters move into SourceLayers rather than dropping
        // here: their subprocess handles stay alive for the post-fix pass.
        SourceLayers {
            layers: self.layers,
            head_sha: self.head_sha,
            clean_layers: self.clean_layers,
            index_diffs: self.index_diffs,
            worktree_diffs: self.worktree_diffs,
            conflicted_paths: self.conflicted_paths,
            lfs: self.lfs,
            custom_filters: self.custom_filters,
        }
    }

    /// Build ONLY the reusable source-layer state — the worktree/index source
    /// layer scan (`read_layer_status` + `read_worktree_layer*`) — without
    /// resolving any span. Used by `stale --fix` to compute the source layers
    /// once (before `apply_fix` mutates `.span/` files) and reuse them for the
    /// post-fix re-resolve via `from_source_layers`, so the post-fix pass does
    /// NOT re-run the `git status` source scan.
    ///
    /// Emits any source-layer init warnings (rare: index/worktree read
    /// budget downgrades) exactly as the cold-path `finish_retaining_layers`
    /// does, so they surface once — `from_source_layers` then starts clean and
    /// cannot re-emit them. A freshly built state has no session warnings yet,
    /// so only the `EngineState::new` init warnings are forwarded.
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
            layers: state.layers,
            head_sha: state.head_sha,
            clean_layers: state.clean_layers,
            index_diffs: state.index_diffs,
            worktree_diffs: state.worktree_diffs,
            conflicted_paths: state.conflicted_paths,
            lfs: state.lfs,
            custom_filters: state.custom_filters,
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
        // but the resolver never examines a span-root path. The reverse-walk
        // is NOT reused (a fresh `ResolveSession` rebuilds it for the
        // rewritten spans); only these static source-layer fields are reused.
        EngineState {
            layers: layers.layers,
            head_sha: layers.head_sha,
            clean_layers: layers.clean_layers,
            index_diffs: layers.index_diffs,
            worktree_diffs: layers.worktree_diffs,
            conflicted_paths: layers.conflicted_paths,
            // Re-read fresh so the post-fix finish detects index changes that
            // occur during the post-fix resolve window (not the pre-fix one).
            index_trailer_start: read_index_trailer(repo).ok(),
            // Start clean: pre-fix warnings were already emitted by
            // finish_retaining_layers and must not be re-emitted.
            warnings: Vec::new(),
            lfs: layers.lfs,
            custom_filters: layers.custom_filters,
            session: ResolveSession::new(repo),
            needs_all_layers,
            fuzzy_threshold,
            commit_reachability: HashMap::new(),
            filter_attrs: HashMap::new(),
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
    // Build the reverse-indexed walk so resolve_anchor_inner can consume
    // per-anchor deltas from the shared session.  resolve_anchor_inner
    // delegates to resolve_at_head_shared / follow_path_to_head_shared,
    // both of which read from session.reverse_walk_output.
    state
        .session
        .build_reverse_walk(repo, &[(span_name.to_string(), span.clone())])?;
    let out = match span.anchors.into_iter().find(|(id, _)| id == anchor_id) {
        Some((_, r)) => {
            resolve_anchor_inner(repo, &mut state, &span.config, span_name, anchor_id, r)?
        }
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
    let _perf = crate::perf::span("resolver.resolve-span");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let out = resolve_span_with_state(repo, span_root, &mut state, name, options)?;
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
    let _perf = crate::perf::span("resolver.resolve-span-at");
    let mut state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let out = resolve_span_with_state_at(repo, span_root, &mut state, name, commit_oid, options)?;
    state.finish(repo);
    Ok(out)
}

fn resolve_span_with_state(
    repo: &gix::Repository,
    span_root: &str,
    state: &mut EngineState,
    name: &str,
    options: EngineOptions,
) -> Result<SpanResolved> {
    let span = {
        let _perf = crate::perf::span("resolver.read-span-file");
        let reader = SpanFileReader::new(repo, span_root.to_string());
        let file = reader
            .read_effective(name)?
            .ok_or_else(|| Error::SpanNotFound(name.to_string()))?;
        span_from_file(name, &file)
    };
    resolve_loaded_span_with_state(repo, state, span, options)
}

fn resolve_span_with_state_at(
    repo: &gix::Repository,
    span_root: &str,
    state: &mut EngineState,
    name: &str,
    commit_oid: &str,
    options: EngineOptions,
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
        // at the `stale`/`doctor` reporting surfaces so drift never silently
        // honors an interior anchor while a poisoned span stays repairable.
        let file = crate::span_file::SpanFile::parse(&text)?;
        span_from_file(name, &file)
    };
    resolve_loaded_span_with_state(repo, state, span, options)
}

fn resolve_loaded_span_with_state(
    repo: &gix::Repository,
    state: &mut EngineState,
    span: crate::types::Span,
    options: EngineOptions,
) -> Result<SpanResolved> {
    let mut anchors = Vec::with_capacity(span.anchors.len());
    let mut filtered_by_since: usize = 0;
    // Build the reverse-indexed walk if not already built by a batch caller.
    // The walk spans all anchors in this span and produces per-anchor commit
    // deltas consumed by resolve_at_head_shared.
    {
        let _perf = crate::perf::span("resolver.prepare-groups");
        if state.session.reverse_walk_output.is_none() {
            let spans = [(span.name.clone(), span.clone())];
            state.session.build_reverse_walk(repo, &spans)?;
        }
    }
    {
        let _perf = crate::perf::span("resolver.resolve-anchors");
        for (id, r) in span.anchors {
            // Since-filter: in the file-backed model anchor_sha is empty, so the
            // filter is a no-op unless a non-empty anchor_sha is present.
            if let Some(since_oid) = options.since
                && !r.anchor_sha.is_empty()
                && !anchor_at_or_after(repo, &r.anchor_sha, since_oid)
            {
                filtered_by_since += 1;
                continue;
            }
            let anchor_t0 = std::time::Instant::now();
            let trace_anchor_sha = r.anchor_sha.clone();
            let trace_path = r.path.clone();
            let fast_path_before = state.session.anchors_fast_path_hits;
            let mut resolved =
                resolve_anchor_inner(repo, &mut *state, &span.config, &span.name, &id, r)?;
            let wall_us = anchor_t0.elapsed().as_micros();
            state.session.per_anchor_us.push(wall_us);
            tally_anchor_status(&mut state.session, &resolved.status);
            if let Some(trace) = state.session.per_anchor_trace.as_mut() {
                trace.push(crate::perf::TraceRow {
                    span: span.name.clone(),
                    anchor_id: id.clone(),
                    anchor_sha: trace_anchor_sha,
                    path: trace_path,
                    wall_us,
                    fast_path: state.session.anchors_fast_path_hits > fast_path_before,
                    status: status_label(&resolved.status),
                });
            }
            populate_drift_locus(repo, &mut resolved, &mut state.session);
            anchors.push(resolved);
        }
    }
    if filtered_by_since > 0
        && let Some(since_oid) = options.since
    {
        state.warnings.push(format!(
            "filtered {filtered_by_since} anchors anchored before {}",
            since_oid
        ));
    }
    Ok(SpanResolved {
        name: span.name,
        message: span.message,
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
    session: &mut super::session::ResolveSession,
) {
    use crate::types::DriftSource;
    match resolved.status {
        AnchorStatus::Changed if resolved.source == Some(DriftSource::Head) => {
            if let Ok(locus) = super::attribution::drift_locus(repo, resolved, session) {
                resolved.locus = locus;
            }
        }
        AnchorStatus::Deleted if resolved.locus.is_none() => {
            // Ask the walk to describe an orphaning commit when the anchor
            // is reachable but the path is absent from HEAD.
            if let Ok(Some(locus)) = super::attribution::drift_locus(repo, resolved, session) {
                resolved.locus = Some(locus);
            }
        }
        _ => {}
    }
}

fn tally_anchor_status(session: &mut super::session::ResolveSession, status: &AnchorStatus) {
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

fn emit_timeline_cache_counters(session: &super::session::ResolveSession) {
    crate::perf::counter("timeline.cache-hits", session.timeline_cache_hits);
    crate::perf::counter("timeline.cache-misses", session.timeline_cache_misses);
    crate::perf::counter("timeline.cache-entries", session.timelines.len() as u64);
}

pub(crate) fn span_is_reportable_in_stale_discovery(m: &SpanResolved) -> bool {
    m.anchors.iter().any(|a| a.status != AnchorStatus::Fresh)
}

/// Resolve a small caller-provided list of span names without scanning all
/// span files. Reuses one `EngineState` across the candidate set and resolves
/// each name through its span file. Preserves input order; per-name
/// resolution failures are returned alongside the name rather than aborting
/// the whole call so the path-index candidate workflow stays robust against a
/// stale path-index entry.
/// Per-name resolution outcomes: input order preserved, each name paired with
/// its `Ok(SpanResolved)` or a per-name resolution `Err`.
type NamedSpanResults = Vec<(String, std::result::Result<SpanResolved, Error>)>;

pub(crate) fn resolve_named_spans(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
) -> Result<NamedSpanResults> {
    let state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let (out, _) = resolve_named_spans_with_state(repo, span_root, names, options, state, false)?;
    Ok(out)
}

/// Single-pass, layer-neutral capture (card main-157 Phase 3A). Resolve every
/// named span ONCE and assemble a [`ResolutionCore`] whose every anchor holds
/// three independent per-layer observations (Head / Index / Worktree), instead
/// of resolving twice — once committed, once effective — and merging the two
/// collapsed views (the `resolver/core/tests.rs::anchor_core_from_dual`
/// stand-in this replaces, which could not express simultaneous Index +
/// Worktree drift).
///
/// This is additive instrumentation: it neither alters nor is reachable from
/// the default resolution path (`resolve_named_spans` / `stale_spans_*`).
/// Capture always observes all three layers regardless of any eventual view,
/// so the core is genuinely layer-neutral; `super::core::project` reconstructs
/// the committed or effective `SpanResolved` from it by pure selection.
pub(crate) fn capture_resolution_core(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
) -> Result<crate::resolver::core::resolution::ResolutionCore> {
    use crate::resolver::core::resolution::{DefinitionOrdinal, ResolutionCore, SpanCore};

    let _perf = crate::perf::span("resolver.capture-resolution-core");
    let mut state =
        EngineState::new_with_fuzzy_threshold(repo, LayerSet::full(), true, 0.95)?;

    let span_pairs: Vec<(String, Span)> =
        crate::span::read::read_effective_each_parallel(repo, span_root, names)
            .into_iter()
            .zip(names)
            .filter_map(|(outcome, name)| outcome.ok().flatten().map(|span| (name.clone(), span)))
            .collect();
    if !span_pairs.is_empty() {
        state.session.build_reverse_walk(repo, &span_pairs)?;
    }

    let mut spans = Vec::with_capacity(span_pairs.len());
    for (name, span) in span_pairs {
        debug_assert_eq!(name, span.name);
        let mut anchors = Vec::with_capacity(span.anchors.len());
        // Ordinal identity for duplicate anchor addresses: the position among
        // definitions sharing the same address (anchor_id), in stored order.
        let mut occurrences: HashMap<String, u32> = HashMap::new();
        for (id, r) in span.anchors {
            let anchor_core =
                anchor::resolve_anchor_captured(repo, &mut state, &span.config, &span.name, &id, r)?;
            let source_ordinal = {
                let n = occurrences.entry(id.clone()).or_insert(0);
                let v = *n;
                *n += 1;
                v
            };
            let definition_digest = DefinitionOrdinal::digest_definition(
                &anchor_core.anchor_id,
                &anchor_core.anchor_sha,
                &anchor_core.anchored.path,
                anchor_core.anchored.extent,
            );
            let ordinal = DefinitionOrdinal {
                span_identity: span.name.clone(),
                source_ordinal,
                definition_digest,
            };
            anchors.push((ordinal, anchor_core));
        }
        spans.push(SpanCore {
            name: span.name.clone(),
            message: span.message.clone(),
            follow_moves: span.config.follow_moves,
            anchors,
        });
    }
    state.finish(repo);
    Ok(ResolutionCore { spans })
}

/// Build the reusable source-layer state (worktree/index `git status` scan)
/// without resolving any span. Used by `stale --fix` to compute the source
/// layers once before `apply_fix` mutates `.span/`, then reuse them for the
/// post-fix re-resolve so the post-fix pass skips its own source scan.
pub(crate) fn build_source_layers(
    repo: &gix::Repository,
    options: EngineOptions,
) -> Result<SourceLayers> {
    EngineState::build_source_layers(repo, options.layers, options.needs_all_layers)
}

/// Like `resolve_named_spans`, but reuses source-layer state captured by a
/// pre-fix `stale_spans_retaining_source_layers` instead of re-reading the
/// worktree source layer via `EngineState::new`. Used by the cold-path
/// post-fix re-resolve in `stale --fix` to skip a second `read-worktree-layer`.
pub(crate) fn resolve_named_spans_with_source_layers(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
    source_layers: SourceLayers,
) -> Result<NamedSpanResults> {
    let state = EngineState::from_source_layers(
        source_layers,
        repo,
        options.needs_all_layers,
        options.fuzzy_threshold,
    );
    let (out, _) = resolve_named_spans_with_state(repo, span_root, names, options, state, false)?;
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
    let state = EngineState::new_with_fuzzy_threshold(
        repo,
        options.layers,
        options.needs_all_layers,
        options.fuzzy_threshold,
    )?;
    let (out, layers) =
        resolve_named_spans_with_state(repo, span_root, names, options, state, true)?;
    Ok((out, layers.expect("retain_layers=true yields Some(SourceLayers)")))
}

pub(crate) fn resolve_named_spans_with_state(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
    mut state: EngineState,
    retain_layers: bool,
) -> Result<(NamedSpanResults, Option<SourceLayers>)> {
    let _perf = crate::perf::span("resolver.resolve-named-spans");

    // Build the reverse-indexed walk once across all named spans so that
    // per-anchor commit deltas are available to every per-span resolver call.
    {
        let _perf = crate::perf::span("resolver.read-span-pairs");
        let span_pairs: Vec<(String, Span)> =
            crate::span::read::read_effective_each_parallel(repo, span_root, names)
                .into_iter()
                .zip(names)
                .filter_map(|(outcome, name)| {
                    outcome.ok().flatten().map(|span| (name.clone(), span))
                })
                .collect();
        if !span_pairs.is_empty() {
            state.session.build_reverse_walk(repo, &span_pairs)?;
        }
    }

    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let resolved = resolve_span_with_state(repo, span_root, &mut state, name, options);
        out.push((name.clone(), resolved));
    }
    // Emit walk perf counters matching stale_spans_inner so named-span
    // resolution is observable through the same perf counter interface.
    emit_session_walk_counters(&state.session);
    let source_layers = if retain_layers {
        Some(state.finish_retaining_layers(repo))
    } else {
        state.finish(repo);
        None
    };
    Ok((out, source_layers))
}

/// Emit the per-session walk/cache perf counters shared by every batch
/// resolution surface (`stale_spans_inner`, named-span resolution, and
/// each parallel baseline worker).
fn emit_session_walk_counters(session: &super::session::ResolveSession) {
    crate::perf::counter("session.walk-bloom-skips", session.walk_bloom_skips);
    crate::perf::counter(
        "session.walk-bloom-false-positives",
        session.walk_bloom_false_positives,
    );
    crate::perf::counter("session.walk-tree-diffs", session.walk_tree_diffs);
    crate::perf::counter("session.walk-commits-visited", session.walk_commits_visited);
    crate::perf::counter(
        "session.reverse-index-build-ms",
        session.reverse_index_build_ms,
    );
    crate::perf::counter(
        "session.relocation-candidate-reads",
        session.relocation_candidate_reads,
    );
    crate::perf::counter("session.line-index-hits", session.line_index_hits);
    crate::perf::counter("session.line-index-misses", session.line_index_misses);
    crate::resolver::timeline::emit_counters();
    emit_timeline_cache_counters(session);
    crate::resolver::linemap::emit_counters();
}

/// A unit of work for the parallel baseline build: either a pre-parsed span
/// a worker must resolve, or a result already decided on the main thread
/// (read error / missing span file).
enum ParallelSlot {
    Resolve(Span),
    Done(std::result::Result<SpanResolved, Error>),
}

/// Resolve `names` in parallel across up to `thread_count` workers using a
/// work-stealing chunk queue. Returns per-name results in input order,
/// matching `resolve_named_spans` semantics (a missing span file yields
/// `Err(SpanNotFound)` for that name).
///
/// Span files are read and parsed once on the calling thread; workers share
/// the parsed corpus. Each worker owns one `EngineState` for its lifetime,
/// so session caches (blob OIDs, line indexes, relocation texts) amortize
/// across every chunk that worker steals. Chunks are deliberately smaller
/// than `names.len() / thread_count`: static contiguous partitioning lets
/// one expensive run of spans (e.g. a cluster of relocation-scanning
/// anchors) serialize behind a single straggler thread while its siblings
/// exit early.
pub(crate) fn resolve_named_spans_parallel(
    repo: &gix::Repository,
    span_root: &str,
    names: &[String],
    options: EngineOptions,
    thread_count: usize,
) -> Result<NamedSpanResults> {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let _perf = crate::perf::span("resolver.resolve-named-spans-parallel");

    // Read every span file concurrently, then map each raw outcome to a slot.
    let slots: Vec<(String, ParallelSlot)> = {
        let _perf = crate::perf::span("resolver.read-span-pairs");
        crate::span::read::read_effective_each_parallel(repo, span_root, names)
            .into_iter()
            .zip(names)
            .map(|(outcome, name)| {
                let slot = match outcome {
                    Ok(Some(span)) => ParallelSlot::Resolve(span),
                    Ok(None) => ParallelSlot::Done(Err(Error::SpanNotFound(name.clone()))),
                    Err(e) => ParallelSlot::Done(Err(e)),
                };
                (name.clone(), slot)
            })
            .collect()
    };

    // Chunk granularity: a few chunks per worker balances stealing overhead
    // (one reverse walk per chunk) against straggler smoothing.
    let thread_count = thread_count.max(1);
    let chunk_size = names.len().div_ceil(thread_count * 4).max(1);
    let chunk_count = names.len().div_ceil(chunk_size);
    let workers = thread_count.min(chunk_count);

    let next_chunk = AtomicUsize::new(0);
    let resolved: Mutex<Vec<(usize, std::result::Result<SpanResolved, Error>)>> =
        Mutex::new(Vec::new());
    let fatal: Mutex<Option<Error>> = Mutex::new(None);

    std::thread::scope(|s| {
        for _ in 0..workers {
            let repo = repo.clone();
            let slots = &slots;
            let next_chunk = &next_chunk;
            let resolved = &resolved;
            let fatal = &fatal;
            s.spawn(move || {
                let _perf = crate::perf::span("resolver.resolve-named-spans");
                let mut state = match EngineState::new(
                    &repo,
                    options.layers,
                    options.needs_all_layers,
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        fatal.lock().unwrap().get_or_insert(e);
                        return;
                    }
                };
                let mut out: Vec<(usize, std::result::Result<SpanResolved, Error>)> =
                    Vec::new();
                loop {
                    if fatal.lock().unwrap().is_some() {
                        break;
                    }
                    let chunk_idx = next_chunk.fetch_add(1, Ordering::Relaxed);
                    let start = chunk_idx * chunk_size;
                    if start >= slots.len() {
                        break;
                    }
                    let end = (start + chunk_size).min(slots.len());
                    let chunk = &slots[start..end];

                    // Chunk-scoped reverse walk over the pre-parsed spans,
                    // mirroring the per-batch walk in
                    // `resolve_named_spans_with_state`.
                    let walk_pairs: Vec<(String, Span)> = chunk
                        .iter()
                        .filter_map(|(name, slot)| match slot {
                            ParallelSlot::Resolve(m) => Some((name.clone(), m.clone())),
                            ParallelSlot::Done(_) => None,
                        })
                        .collect();
                    if !walk_pairs.is_empty()
                        && let Err(e) = state.session.build_reverse_walk(&repo, &walk_pairs)
                    {
                        fatal.lock().unwrap().get_or_insert(e);
                        break;
                    }

                    for (offset, (_name, slot)) in chunk.iter().enumerate() {
                        let ParallelSlot::Resolve(span) = slot else {
                            continue;
                        };
                        let r = resolve_loaded_span_with_state(
                            &repo,
                            &mut state,
                            span.clone(),
                            options,
                        );
                        out.push((start + offset, r));
                    }
                }
                emit_session_walk_counters(&state.session);
                state.finish(&repo);
                resolved.lock().unwrap().extend(out);
            });
        }
    });

    if let Some(e) = fatal.into_inner().unwrap() {
        return Err(e);
    }

    let mut by_index: std::collections::HashMap<usize, std::result::Result<SpanResolved, Error>> =
        resolved.into_inner().unwrap().into_iter().collect();
    let mut out: NamedSpanResults = Vec::with_capacity(slots.len());
    for (i, (name, slot)) in slots.into_iter().enumerate() {
        match slot {
            ParallelSlot::Done(r) => out.push((name, r)),
            ParallelSlot::Resolve(_) => {
                let r = by_index.remove(&i).expect(
                    "every Resolve slot is processed when no fatal error is recorded",
                );
                out.push((name, r));
            }
        }
    }
    Ok(out)
}

fn stale_spans_inner(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    enable_trace: bool,
    retain_layers: bool,
) -> Result<(Vec<SpanResolved>, Vec<crate::perf::TraceRow>, Option<SourceLayers>)> {
    crate::perf::reset_subroutine_counters();
    crate::resolver::timeline::reset_counters();
    crate::resolver::linemap::reset_counters();
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
        state.session.enable_trace();
    }
    let mut can_skip_clean_head_ns: u128 = 0;
    {
        // Build the reverse-indexed walk once across all spans.
        state.session.build_reverse_walk(repo, &span_pairs)?;

        let _perf = crate::perf::span("resolver.resolve-stale-spans");
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
                    state.session.anchors_skipped_clean_head += span.anchors.len() as u64;
                    continue;
                }
            }
            let resolved = resolve_loaded_span_with_state(repo, &mut state, span, options)?;
            if span_is_reportable_in_stale_discovery(&resolved) {
                out.push(resolved);
            }
        }
    }
    crate::perf::counter(
        "resolver.can-skip-clean-head-us",
        (can_skip_clean_head_ns / 1_000) as u64,
    );
    crate::perf::counter("session.walk-bloom-skips", state.session.walk_bloom_skips);
    crate::perf::counter(
        "session.walk-bloom-false-positives",
        state.session.walk_bloom_false_positives,
    );
    crate::perf::counter("session.walk-tree-diffs", state.session.walk_tree_diffs);
    crate::perf::counter(
        "session.walk-commits-visited",
        state.session.walk_commits_visited,
    );
    crate::perf::counter(
        "session.reverse-index-build-ms",
        state.session.reverse_index_build_ms,
    );
    crate::perf::counter(
        "session.relocation-candidate-reads",
        state.session.relocation_candidate_reads,
    );
    crate::perf::counter("session.line-index-hits", state.session.line_index_hits);
    crate::perf::counter("session.line-index-misses", state.session.line_index_misses);
    crate::perf::counter("session.drift-locus-hits", state.session.drift_locus_hits);
    crate::perf::counter(
        "session.drift-locus-misses",
        state.session.drift_locus_misses,
    );
    crate::resolver::timeline::emit_counters();
    emit_timeline_cache_counters(&state.session);
    crate::resolver::linemap::emit_counters();
    crate::perf::counter("session.filter-attr-hits", state.session.filter_attr_hits);
    crate::perf::counter(
        "session.filter-attr-misses",
        state.session.filter_attr_misses,
    );
    // Category 1: hot-path subroutine counters. `filter-attr-*` come from
    // the engine-state memo (one increment per `filter_short_circuit` call,
    // misses count distinct paths); the remaining counters are process-global
    // and reset at the top of `stale_spans`.
    crate::perf::counter(
        "session.filter-attr-calls",
        state.session.filter_attr_hits + state.session.filter_attr_misses,
    );
    crate::perf::counter(
        "session.filter-attr-distinct-paths",
        state.session.filter_attr_misses,
    );
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
    let anchors_total = state.session.anchors_total();
    crate::perf::counter("session.anchors-total", anchors_total);
    crate::perf::counter("session.anchors-fresh", state.session.anchors_fresh);
    crate::perf::counter("session.anchors-moved", state.session.anchors_moved);
    crate::perf::counter("session.anchors-changed", state.session.anchors_changed);
    crate::perf::counter("session.anchors-orphaned", state.session.anchors_orphaned);
    crate::perf::counter(
        "session.anchors-merge-conflict",
        state.session.anchors_merge_conflict,
    );
    crate::perf::counter(
        "session.anchors-unavailable",
        state.session.anchors_unavailable,
    );
    crate::perf::counter(
        "session.anchors-skipped-clean-head",
        state.session.anchors_skipped_clean_head,
    );
    crate::perf::counter(
        "session.anchors-fast-path-hits",
        state.session.anchors_fast_path_hits,
    );
    crate::perf::counter(
        "session.anchors-full-resolution",
        anchors_total
            .saturating_sub(state.session.anchors_fast_path_hits)
            .saturating_sub(state.session.anchors_skipped_clean_head),
    );
    // Category 3: per-anchor resolution distribution.
    {
        let mut per_anchor = std::mem::take(&mut state.session.per_anchor_us);
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
    let trace_rows = state.session.per_anchor_trace.take().unwrap_or_default();
    let source_layers = if retain_layers {
        Some(state.finish_retaining_layers(repo))
    } else {
        state.finish(repo);
        None
    };
    if out.len() > 1 {
        sort_spans_by_anchor_path(&mut out);
    }
    Ok((out, trace_rows, source_layers))
}

pub fn stale_spans(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<Vec<SpanResolved>> {
    // The SQLite store is the only cache path. On [`ExactAttempt::Resolved`] it
    // rendered the reportable set (already reportable-filtered and sorted). A
    // [`ExactAttempt::Bypass`] — cache disabled, ineligible run, or store fault
    // — falls through to the uncached authoritative resolver directly; there is
    // no legacy cache tier to fall back on.
    if let crate::resolver::exact::ExactAttempt::Resolved { spans, .. } =
        crate::resolver::exact::stale_spans_new_store(repo, span_root, options)?
    {
        return Ok(spans);
    }
    let (spans, _, _) = stale_spans_inner(repo, span_root, options, false, false)?;
    Ok(spans)
}

/// Like `stale_spans`, but on the uncached cold path (store bypass → an
/// `EngineState` is built) it retains the source-layer state so the post-fix
/// re-resolve in `stale --fix` can skip a second `read-worktree-layer`.
///
/// Returns `(spans, Some(source_layers), None)` on the uncached cold path and
/// `(spans, None, Option<whole_result>)` on a store hit. `whole_result` is
/// `Some` whenever the store rendered from its compact summary; it carries the
/// full anchor set and anchor totals so `run_stale` can skip its per-invocation
/// phases.
pub(crate) fn stale_spans_retaining_source_layers(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<(Vec<SpanResolved>, Option<SourceLayers>, Option<crate::resolver::WholeResult>)> {
    // The SQLite store is the only cache path. On a `Resolved` outcome the store
    // rendered the reportable set and hands back the render-ready whole-result
    // so `run_stale` skips its per-invocation corpus reload (count-totals /
    // Fresh-anchor backfill / interior-anchor scan). There is no retained
    // `SourceLayers` (a `--fix` post-pass rebuilds them). A `Bypass` — cache
    // disabled, ineligible run, or store fault — runs the uncached authoritative
    // resolver, retaining its source layers.
    if let crate::resolver::exact::ExactAttempt::Resolved {
        spans,
        whole_result,
    } = crate::resolver::exact::stale_spans_new_store(repo, span_root, options)?
    {
        return Ok((spans, None, whole_result));
    }
    let (spans, _, source_layers) = stale_spans_inner(repo, span_root, options, false, true)?;
    Ok((spans, source_layers, None))
}

pub fn stale_spans_with_trace(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<(Vec<SpanResolved>, Vec<crate::perf::TraceRow>)> {
    let (spans, trace_rows, _) = stale_spans_inner(repo, span_root, options, true, false)?;
    Ok((spans, trace_rows))
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

        // Path tuples identical. Sub-group by extent overlap.
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
/// workspace is dirty. The global `state.clean_layers` is a
/// fast-positive trivial-true shortcut so the genuinely-clean
/// workspace skips the per-path HashMap probes; the same shortcut
/// covers the "no content layers enabled" case.
pub(crate) fn anchor_path_is_layer_clean(state: &EngineState, path: &str) -> bool {
    if state.clean_layers || (!state.layers.index && !state.layers.worktree) {
        return true;
    }
    if state.conflicted_paths.contains(path) {
        return false;
    }
    if state.layers.index
        && state
            .index_diffs
            .as_ref()
            .is_some_and(|d| d.map.contains_key(path))
    {
        return false;
    }
    if state.layers.worktree
        && state
            .worktree_diffs
            .as_ref()
            .is_some_and(|d| d.map.contains_key(path))
    {
        return false;
    }
    true
}

/// Slice 5: returns true when the anchor should pass the `--since`
/// filter. The semantic is "anchored at or after `since`" — i.e.
/// `since` is an ancestor of (or equal to) `anchor_sha`. Anchors that
/// don't parse / aren't reachable fall through as `true` (orphans are
/// not hidden by `--since`).
fn anchor_at_or_after(repo: &gix::Repository, anchor_sha: &str, since: gix::ObjectId) -> bool {
    use std::str::FromStr;
    let Ok(anchor_id) = gix::ObjectId::from_str(anchor_sha) else {
        return true;
    };
    if anchor_id == since {
        return true;
    }
    match repo.merge_base(anchor_id, since) {
        Ok(base) => base.detach() == since,
        Err(_) => true,
    }
}

/// Predicate factory for cross-path relocation when the anchored path is
/// absent from HEAD (a committed `git mv`/deletion).
///
/// Returns a closure `is_rename_target(path) -> bool`. A HEAD-present
/// candidate is only a rename target when it did **not** exist at the
/// point the anchored path last existed — i.e. it is new as of the
/// rename commit (the `git mv` shape). A file that already existed
/// alongside the anchored path (e.g. an unrelated file that happens to
/// share generic lines) is excluded, so a coincidental content match
/// never masquerades as a relocation.
///
/// Implementation: walk HEAD ancestors reverse-chronologically and find
/// the first commit whose tree still contains `anchored_path`. That
/// commit's tree is the "before" reference: any candidate already
/// present there is pre-existing, not a rename destination. When the
/// anchored path is found nowhere in history (defensive), every
/// HEAD-present path is treated as pre-existing (no relocation), which
/// fails closed to `Deleted`.
pub(crate) fn rename_target_predicate(
    repo: &gix::Repository,
    anchored_path: &str,
) -> impl Fn(&gix::Repository, &str) -> bool {
    // The commit-ish whose tree still had `anchored_path` (the state
    // before the rename/deletion). `None` => unknown => treat all
    // HEAD-present paths as pre-existing.
    let before_commit: Option<String> = (|| {
        let head = crate::git::head_oid(repo).ok()?;
        let head_oid = gix::ObjectId::from_hex(head.as_bytes()).ok()?;
        let walk = repo
            .rev_walk([head_oid])
            .sorting(gix::revision::walk::Sorting::ByCommitTime(
                gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
            ))
            .all()
            .ok()?;
        for info in walk {
            let info = info.ok()?;
            let cid = info.id.to_string();
            if crate::git::tree_entry_at(repo, &cid, std::path::Path::new(anchored_path))
                .ok()
                .flatten()
                .is_some()
            {
                return Some(cid);
            }
        }
        None
    })();

    move |repo: &gix::Repository, candidate: &str| -> bool {
        let Some(before) = before_commit.as_ref() else {
            return false;
        };
        // Rename target iff the candidate was absent from the tree that
        // still held the anchored path (it is new as of the rename).
        crate::git::tree_entry_at(repo, before, std::path::Path::new(candidate))
            .ok()
            .flatten()
            .is_none()
    }
}

fn deleted_placeholder(anchor_id: &str) -> AnchorResolved {
    AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: String::new(),
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_span(name: &str, anchors: &[(&str, AnchorExtent)]) -> SpanResolved {
        SpanResolved {
            name: name.to_string(),
            message: String::new(),
            anchors: anchors
                .iter()
                .map(|(path, extent)| AnchorResolved {
                    anchor_id: String::new(),
                    anchor_sha: String::new(),
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
                })
                .collect(),
            follow_moves: false,
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
    /// across an entire `stale` run. Two probes for the same path produce
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
        let mut state = EngineState::new(
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
        let _ = state.filter_short_circuit(&repo, "a.txt").unwrap();
        assert_eq!(state.session.filter_attr_misses, 1);
        assert_eq!(state.session.filter_attr_hits, 0);

        // Repeated lookup for the same path → hit, no new miss.
        let _ = state.filter_short_circuit(&repo, "a.txt").unwrap();
        let _ = state.filter_short_circuit(&repo, "a.txt").unwrap();
        assert_eq!(state.session.filter_attr_misses, 1);
        assert_eq!(state.session.filter_attr_hits, 2);

        // Distinct path → one additional miss.
        let _ = state.filter_short_circuit(&repo, "b.txt").unwrap();
        let _ = state.filter_short_circuit(&repo, "b.txt").unwrap();
        assert_eq!(state.session.filter_attr_misses, 2);
        assert_eq!(state.session.filter_attr_hits, 3);
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
        state.clean_layers = clean_layers;
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
                    intent_to_add: false,
                },
            );
        }
        state.index_diffs = Some(idx);
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
                    intent_to_add: false,
                },
            );
        }
        state.worktree_diffs = Some(wt);
        for p in conflicted {
            state.conflicted_paths.insert((*p).to_string());
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
        assert!(anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
    }

    #[test]
    fn anchor_path_predicate_index_dirty() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &["packages/anchor.rs"], &[], &[]);
        assert!(!anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
    }

    #[test]
    fn anchor_path_predicate_worktree_dirty() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &[], &["packages/anchor.rs"], &[]);
        assert!(!anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
    }

    #[test]
    fn anchor_path_predicate_conflicted() {
        let layers = LayerSet {
            index: true,
            worktree: true,
            staged_span: false,
        };
        let state = state_for_predicate(layers, false, &[], &[], &["packages/anchor.rs"]);
        assert!(!anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
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
        assert!(anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
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
        assert!(anchor_path_is_layer_clean(&state, "packages/anchor.rs"));
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
        assert!(anchor_path_is_layer_clean(&state, "anything.rs"));
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

}
