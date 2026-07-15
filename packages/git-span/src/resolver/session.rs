//! `ResolveSession` — engine-wide shared state for one `stale` run.
//!
//! The reverse-indexed HEAD walk (built by [`ResolveSession::build_reverse_walk`])
//! runs once and produces per-anchor commit deltas. Each anchor's classifier
//! consumes its slice of the walk output instead of running its own per-anchor
//! walk. The session is constructed once at the top of the `stale` CLI path and
//! threaded through `resolve_anchor_inner`. There is no caching across runs —
//! the session lives only for the duration of one engine call and is dropped
//! when it returns.

use crate::Result;
use crate::git;
use crate::perf;
use crate::resolver::bloom::CommitGraphBloom;
use crate::resolver::timeline::{PathInterner, PathTimeline, PathTimelineKey, build_timeline};
use crate::resolver::walker::{self, NS};
use crate::types::{Anchor, CopyDetection, DriftSource};
use git_span_core::LineIndex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// A line index that owns its backing bytes, cacheable in the resolver session.
///
/// Must be stored behind a `Box` (or other heap allocation) so the byte buffer
/// never moves after the index is built — the [`LineIndex`] borrows from it.
/// Rebuilding the index per anchor on the same file is the central cost Tier 2
/// amortizes away.
///
/// The inner [`LineIndex`] lazily allocates prefix-hash and power tables
/// (~16 bytes per file byte) on the first prefiltered scan.  Files exceeding
/// [`git_span_core::PREFILTER_TABLES_MAX_BYTES`] (32 MiB) skip this allocation
/// and fall back to per-window hashing.  Tables live for the [`ResolveSession`]
/// lifetime and are evicted with the line-index cache.
pub(crate) struct CachedLineIndex {
    bytes: Vec<u8>,
    /// Lazily built; `None` until the first `get()` call.  The inner
    /// `LineIndex<'static>` borrows from `self.bytes` and is sound only
    /// because `CachedLineIndex` lives in a `Box` (pinned).
    idx: Option<LineIndex<'static>>,
}

impl CachedLineIndex {
    pub(crate) fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, idx: None }
    }

    /// Return a [`LineIndex`] borrowing from the cached bytes, building it
    /// on first call.  Subsequent calls return the pre-built index.
    pub(crate) fn get(&mut self) -> &LineIndex<'_> {
        if self.idx.is_none() {
            let idx = LineIndex::build(&self.bytes);
            // SAFETY: CachedLineIndex is always stored in a `Box`, so
            // `self.bytes` never moves.  The transmute extends the borrow
            // lifetime to `'static`; all returned references are bounded
            // by `&mut self`.
            let idx: LineIndex<'static> = unsafe { std::mem::transmute(idx) };
            self.idx = Some(idx);
        }
        self.idx.as_ref().unwrap()
    }

}

/// One per-commit slice of the shared walk: `(parent_sha, commit_sha,
/// name_status_entries)`. Produced by the reverse-indexed walk once per
/// commit that touches a tracked path. The hunk math
/// (`walker::advance_with_entries`) is still per-anchor — that's the work
/// that genuinely depends on the anchor's path.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CommitDelta {
    pub(crate) parent: String,
    pub(crate) commit: String,
    pub(crate) entries: Vec<NS>,
}

/// Maps each tracked path to the set of anchors that depend on it,
/// enabling a single reverse-indexed walk to fan out per-commit
/// path-change results to every affected anchor.
#[derive(Debug, Clone)]
pub(crate) struct AnchorReverseIndex {
    /// Every (path, anchor_sha) pair that any span anchors against.
    /// Keyed by path so a per-commit "did this commit touch P?" answer
    /// can fan out to every (span, anchor_id) waiting on P.
    pub(crate) by_path: HashMap<Vec<u8>, Vec<AnchorRef>>,
    /// Union of all anchor_sha values — the walk's stop set.
    /// A commit is "interesting" iff it touches some path in by_path
    /// AND lies between HEAD and some anchor_sha still being resolved.
    pub(crate) anchor_shas: HashSet<gix::ObjectId>,
}

#[derive(Debug, Clone)]
pub(crate) struct AnchorRef {
    pub(crate) span_name: String,
    pub(crate) anchor_id: String,
    pub(crate) anchor_sha: gix::ObjectId,
}

impl AnchorReverseIndex {
    /// Build the reverse index from all spans' anchors in a single pass.
    /// `spans` is the list of (span_name, span) pairs being resolved.
    pub(crate) fn from_spans(spans: &[(String, crate::types::Span)]) -> Self {
        let mut by_path: HashMap<Vec<u8>, Vec<AnchorRef>> = HashMap::new();
        let mut anchor_shas: HashSet<gix::ObjectId> = HashSet::new();

        for (span_name, span) in spans {
            for (anchor_id, anchor) in &span.anchors {
                let sha = match gix::ObjectId::from_hex(anchor.anchor_sha.as_bytes()) {
                    Ok(oid) => oid,
                    Err(_) => continue, // skip malformed SHAs
                };
                anchor_shas.insert(sha);
                by_path
                    .entry(anchor.path.as_bytes().to_vec())
                    .or_default()
                    .push(AnchorRef {
                        span_name: span_name.clone(),
                        anchor_id: anchor_id.clone(),
                        anchor_sha: sha,
                    });
            }
        }

        Self {
            by_path,
            anchor_shas,
        }
    }
}

/// Output of the single reverse-indexed HEAD walk.
///
/// Produced by [`ResolveSession::build_reverse_walk`] and consumed by
/// `resolve_at_head_shared` / `follow_path_to_head_shared`.
pub(crate) struct ReverseWalkOutput {
    /// HEAD oid at walk time.
    pub(crate) head_sha: String,
    /// Per-anchor commit deltas (oldest-first), keyed by `(span_name, anchor_id)`.
    ///
    /// Each vec contains only the commits that touch that anchor's path,
    /// including commits where the path was renamed (the entries include
    /// the `Renamed` NS variant so downstream consumers can follow the trail).
    pub(crate) per_anchor_deltas: HashMap<(String, String), Vec<Arc<CommitDelta>>>,
}

/// Maps path bytes to the indexes of anchors currently tracking that path,
/// and is mutated only when commits rename or copy a tracked path. Replaces
/// the old "scan every active anchor for every commit" inner loop in
/// [`ResolveSession::build_reverse_walk`].
///
/// Phase 0 of the three-phase plan: the previous walk had an anchor-quadratic
/// `O(C * A)` bookkeeping loop. `PathIndex` reduces the per-commit cost to
/// `O(P * B + E_c + matches)` (distinct active paths probed against the Bloom
/// filter plus actual rename/copy fan-out work).
pub(crate) struct PathIndex {
    /// Path bytes -> indexes (into `per_anchor`) of anchors tracking that path.
    by_path: HashMap<Arc<[u8]>, Vec<u32>>,
    /// Distinct paths currently tracked by at least one active anchor. Used as
    /// the Bloom probe set per commit. Maintained as a vector for cheap
    /// iteration; `active_pos` is the parallel position map for `swap_remove`.
    active_paths: Vec<Arc<[u8]>>,
    active_pos: HashMap<Arc<[u8]>, usize>,
    /// `path_of[i]` is the current tracked path for the anchor at `per_anchor[i]`.
    path_of: Vec<Arc<[u8]>>,
    /// Counter: number of rename/copy path updates applied. Reported via the
    /// `resolver.build-walk.path-index-renames` perf span/counter.
    pub(crate) rename_updates: u64,
}

impl PathIndex {
    pub(crate) fn new(per_anchor: &[AnchorWalkState]) -> Self {
        let mut by_path: HashMap<Arc<[u8]>, Vec<u32>> = HashMap::new();
        let mut active_paths: Vec<Arc<[u8]>> = Vec::new();
        let mut active_pos: HashMap<Arc<[u8]>, usize> = HashMap::new();
        let mut path_of: Vec<Arc<[u8]>> = Vec::with_capacity(per_anchor.len());
        for (i, state) in per_anchor.iter().enumerate() {
            let key: Arc<[u8]> = state.current_path.clone();
            let bucket = by_path.entry(key.clone()).or_default();
            bucket.push(i as u32);
            if !active_pos.contains_key(&key) {
                active_pos.insert(key.clone(), active_paths.len());
                active_paths.push(key.clone());
            }
            path_of.push(key);
        }
        Self {
            by_path,
            active_paths,
            active_pos,
            path_of,
            rename_updates: 0,
        }
    }

    pub(crate) fn active_paths(&self) -> &[Arc<[u8]>] {
        &self.active_paths
    }

    pub(crate) fn anchors_for_path(&self, path: &[u8]) -> Option<&[u32]> {
        self.by_path.get(path).map(|v| v.as_slice())
    }

    fn remove_path_if_empty(&mut self, path: &Arc<[u8]>) {
        let still_present = self
            .by_path
            .get(path)
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        if still_present {
            return;
        }
        self.by_path.remove(path);
        if let Some(pos) = self.active_pos.remove(path) {
            let last = self.active_paths.len() - 1;
            self.active_paths.swap_remove(pos);
            if pos != last {
                let moved = self.active_paths[pos].clone();
                self.active_pos.insert(moved, pos);
            }
        }
    }

    /// Move `anchor_idx` from its current tracked path to `new_path`. Called
    /// when a commit renames or copies the tracked path. Maintains
    /// `active_paths` via `swap_remove` so iteration order is unstable but
    /// the set semantics are preserved.
    pub(crate) fn rename(&mut self, anchor_idx: u32, new_path: Arc<[u8]>) {
        let old_path = self.path_of[anchor_idx as usize].clone();
        if old_path == new_path {
            return;
        }
        self.rename_updates += 1;
        if let Some(bucket) = self.by_path.get_mut(&old_path)
            && let Some(pos) = bucket.iter().position(|&i| i == anchor_idx)
        {
            bucket.swap_remove(pos);
        }
        self.remove_path_if_empty(&old_path);

        let bucket = self.by_path.entry(new_path.clone()).or_default();
        bucket.push(anchor_idx);
        if !self.active_pos.contains_key(&new_path) {
            self.active_pos
                .insert(new_path.clone(), self.active_paths.len());
            self.active_paths.push(new_path.clone());
        }
        self.path_of[anchor_idx as usize] = new_path;
    }

    /// Drop an anchor entirely (used when its `anchor_sha` is observed in
    /// the walk and the anchor should no longer accumulate deltas).
    pub(crate) fn deactivate(&mut self, anchor_idx: u32) {
        let path = self.path_of[anchor_idx as usize].clone();
        if let Some(bucket) = self.by_path.get_mut(&path)
            && let Some(pos) = bucket.iter().position(|&i| i == anchor_idx)
        {
            bucket.swap_remove(pos);
        }
        self.remove_path_if_empty(&path);
    }
}

/// Engine-wide shared state: session-scoped caches and counters for one
/// `stale` run.
pub(crate) struct ResolveSession {
    pub(crate) reverse_walk_output: Option<ReverseWalkOutput>,
    /// Session-scoped memo for the changed-path Bloom filter handle. The
    /// commit-graph file is constant for the life of a session, but
    /// `build_reverse_walk` runs once per resolve batch — under chunked
    /// parallel resolution that is many times per session. `None` = not yet
    /// probed; `Some(None)` = probed, no commit-graph Bloom data available.
    bloom_memo: Option<Option<CommitGraphBloom>>,
    /// Counter: drift-locus cache hits.
    pub(crate) drift_locus_hits: u64,
    /// Counter: drift-locus cache misses.
    pub(crate) drift_locus_misses: u64,
    /// Counter: per-path filter-attribute memo hits. Populated by
    /// `EngineState::filter_short_circuit` on cached `(rel_path)` reads.
    pub(crate) filter_attr_hits: u64,
    /// Counter: per-path filter-attribute memo misses (first lookup per
    /// distinct path). On a warm `stale` run, this equals the number of
    /// distinct paths probed across all anchors in the session.
    pub(crate) filter_attr_misses: u64,
    /// Per-session set of commit ObjectIds known to be ancestors of HEAD.
    /// Populated by every commit observed during a `drift_locus` `rev_walk`
    /// (those are ancestors of HEAD by construction since the walk runs
    /// `HEAD..anchor`). An in-memory, per-run memo — never persisted.
    pub(crate) known_head_ancestors:
        std::collections::HashMap<gix::ObjectId, std::collections::HashSet<gix::ObjectId>>,
    /// Session-scoped blob OID memo: `(commit_sha, path) → blob_oid`.
    ///
    /// `path_blob_at` requires a tree traversal for every `(commit, path)`
    /// pair. Many anchors in a span share the same underlying files and
    /// commit history, so the same pair is requested repeatedly across
    /// anchors. This memo eliminates the redundant traversals within a
    /// single `stale` run; it does not persist across invocations.
    pub(crate) blob_oid_memo: HashMap<(String, String), Option<String>>,
    /// HEAD sha whose tree has been bulk-enumerated into `blob_oid_memo`
    /// by [`warm_head_blob_memo`](Self::warm_head_blob_memo). `None`
    /// until the first relocation scan asks for it.
    head_blob_memo_warmed_for: Option<String>,
    /// Counters: anchors classified by terminal status. Updated from the
    /// per-anchor loop in `engine::resolve_loaded_span_with_state` after each
    /// `resolve_anchor_inner` call.
    pub(crate) anchors_fresh: u64,
    pub(crate) anchors_moved: u64,
    pub(crate) anchors_changed: u64,
    pub(crate) anchors_orphaned: u64,
    pub(crate) anchors_merge_conflict: u64,
    pub(crate) anchors_unavailable: u64,
    /// Counter: anchors skipped entirely via [`can_skip_clean_head_pinned_span`]
    /// (the whole span was clean and pinned at HEAD). These anchors are not
    /// resolved individually, but they are counted toward `anchors_total`.
    pub(crate) anchors_skipped_clean_head: u64,
    /// Counter: anchors that returned via [`clean_head_fast_path`] (early
    /// return). The remainder went through the full layer-comparison path
    /// (`anchors_total - anchors_fast_path_hits - anchors_skipped_clean_head
    ///  == anchors_full_resolution`).
    pub(crate) anchors_fast_path_hits: u64,
    /// Counter: anchors that went through the full per-layer resolution
    /// (`resolve_anchor_inner` past the fast-path).
    pub(crate) anchors_full_resolution: u64,
    /// Per-anchor wall-clock (microseconds), one entry per `resolve_anchor_inner`
    /// invocation. Sorted at end-of-run to compute `p50` / `p95` percentiles.
    /// Dropped immediately after emit; ~8 bytes per anchor.
    pub(crate) per_anchor_us: Vec<u128>,
    /// When `Some`, accumulates one `TraceRow` per anchor for `--perf-trace` CSV
    /// output. Remains `None` unless `enable_trace()` is called before resolution.
    pub(crate) per_anchor_trace: Option<Vec<crate::perf::TraceRow>>,
    /// Reverse-indexed walk: commits where Bloom said "definitely no tracked path changed".
    pub(crate) walk_bloom_skips: u64,
    /// Reverse-indexed walk: paths Bloom said "maybe" but tree-diff showed unchanged.
    pub(crate) walk_bloom_false_positives: u64,
    /// Reverse-indexed walk: commits that ran a tree-diff.
    pub(crate) walk_tree_diffs: u64,
    /// Reverse-indexed walk: total commits visited.
    pub(crate) walk_commits_visited: u64,
    /// Reverse-indexed walk: wall-clock ms to build the AnchorReverseIndex.
    pub(crate) reverse_index_build_ms: u64,
    /// Warnings accumulated during the reverse-indexed walk (rename budget
    /// notes, etc.). Forwarded to `EngineState::finish` for stderr output.
    pub(crate) warnings: Vec<String>,
    /// Phase 1: per-session `PathTimeline` cache keyed by
    /// `(path, head_blob_oid, copy_detection, anchor_sha)`. Timelines are
    /// currently anchor-scoped because they are built from per-anchor delta
    /// slices.
    pub(crate) timelines: HashMap<PathTimelineKey, Arc<PathTimeline>>,
    pub(crate) timeline_cache_hits: u64,
    pub(crate) timeline_cache_misses: u64,
    /// Phase 1: shared path-byte interner used while building timelines.
    pub(crate) timeline_paths: PathInterner,
    /// Counter: candidate-path content reads performed inside the
    /// file-backed cross-path relocation scan
    /// (`find_relocated_range_in_paths`). Without amortization this counts
    /// every per-anchor read of every scanned candidate path — i.e. roughly
    /// `O(drifted_absent_anchors × tracked_paths)` on a repo where many
    /// anchored paths were committed-renamed. With per-session memoization,
    /// it collapses to the number of distinct `(path, layer)` pairs actually
    /// read, regardless of anchor count.
    pub(crate) relocation_candidate_reads: u64,
    /// Session-scoped memo for candidate-path texts read during the file-backed
    /// cross-path relocation scan. Keyed by `(path, layer)` — the same path at
    /// different layers (worktree vs index vs HEAD blob) may have different
    /// contents within a single resolve run, but for any one layer the content
    /// is constant and the read can be shared across every anchor that scans it.
    /// `None` value means the read was attempted and failed (e.g. worktree
    /// `fs::read` error); subsequent lookups for that key short-circuit without
    /// retrying. Only counts toward `relocation_candidate_reads` on memo miss.
    pub(crate) relocation_text_memo: HashMap<(String, crate::types::DriftSource), Option<String>>,
    /// Session-scoped line-index cache keyed by `(path, layer)`.  Each
    /// distinct `(path, layer)` pair is read once and indexed once
    /// regardless of how many anchors touch that file.  Values are `Box`ed
    /// so the byte buffer is pinned — the inner [`LineIndex`] borrows from
    /// it (see [`CachedLineIndex`]).
    pub(crate) line_index_cache: HashMap<(String, DriftSource), Box<CachedLineIndex>>,
    /// Counter: line-index cache hits (subsequent anchors on a previously
    /// indexed path+layer).
    pub(crate) line_index_hits: u64,
    /// Counter: line-index cache misses (first anchor on a path+layer,
    /// i.e. the file read + index build).
    pub(crate) line_index_misses: u64,
}

impl ResolveSession {
    pub(crate) fn new(_repo: &gix::Repository) -> Self {
        Self {
            reverse_walk_output: None,
            bloom_memo: None,
            drift_locus_hits: 0,
            drift_locus_misses: 0,
            filter_attr_hits: 0,
            filter_attr_misses: 0,
            known_head_ancestors: std::collections::HashMap::new(),
            blob_oid_memo: HashMap::new(),
            head_blob_memo_warmed_for: None,
            anchors_fresh: 0,
            anchors_moved: 0,
            anchors_changed: 0,
            anchors_orphaned: 0,
            anchors_merge_conflict: 0,
            anchors_unavailable: 0,
            anchors_skipped_clean_head: 0,
            anchors_fast_path_hits: 0,
            anchors_full_resolution: 0,
            per_anchor_us: Vec::new(),
            per_anchor_trace: None,
            walk_bloom_skips: 0,
            walk_bloom_false_positives: 0,
            walk_tree_diffs: 0,
            walk_commits_visited: 0,
            reverse_index_build_ms: 0,
            warnings: Vec::new(),
            timelines: HashMap::new(),
            timeline_cache_hits: 0,
            timeline_cache_misses: 0,
            timeline_paths: PathInterner::new(),
            relocation_candidate_reads: 0,
            relocation_text_memo: HashMap::new(),
            line_index_cache: HashMap::new(),
            line_index_hits: 0,
            line_index_misses: 0,
        }
    }

    pub(crate) fn enable_trace(&mut self) {
        self.per_anchor_trace = Some(Vec::new());
    }

    /// Resolve the blob OID of `path` at `head_sha`, memoized through the
    /// session-scoped `blob_oid_memo`. HEAD is constant for the whole run,
    /// so each distinct `(head_sha, path)` pair is tree-walked at most once.
    /// `None` means "path absent in that tree" (fail-closed, mirroring the
    /// `PathNotInTree` arm of the prior un-memoed callers).
    pub(crate) fn head_blob_oid(
        &mut self,
        repo: &gix::Repository,
        head_sha: &str,
        path: &str,
    ) -> Result<Option<String>> {
        let key = (head_sha.to_string(), path.to_string());
        if let Some(blob) = self.blob_oid_memo.get(&key) {
            return Ok(blob.clone());
        }
        let blob = match git::path_blob_at(repo, head_sha, path) {
            Ok(blob) => Some(blob),
            Err(crate::Error::PathNotInTree { .. }) => None,
            Err(e) => return Err(e),
        };
        self.blob_oid_memo.insert(key, blob.clone());
        Ok(blob)
    }

    /// Bulk-fill `blob_oid_memo` with every blob path at `head_sha` via one
    /// breadth-first tree enumeration. The cross-file relocation scan probes
    /// HEAD presence for every index entry; without warming, each first
    /// probe is a root-to-leaf tree traversal (`O(paths × depth)` tree
    /// lookups per session). One enumeration visits each tree object once
    /// and turns every present-path probe into a memo hit; absent paths
    /// still fall through to `head_blob_oid`'s authoritative per-path
    /// lookup, so results are identical with or without warming.
    ///
    /// Idempotent per `head_sha`; enumeration failure is silently skipped
    /// (the per-path traversal path remains correct).
    pub(crate) fn warm_head_blob_memo(&mut self, repo: &gix::Repository, head_sha: &str) {
        if self.head_blob_memo_warmed_for.as_deref() == Some(head_sha) {
            return;
        }
        let pairs = (|| -> Result<Vec<(String, String)>> {
            let oid = gix::ObjectId::from_hex(head_sha.as_bytes())
                .map_err(|e| crate::Error::Git(format!("parse HEAD {head_sha}: {e}")))?;
            let commit = repo
                .find_commit(oid)
                .map_err(|e| crate::Error::Git(format!("find HEAD commit: {e}")))?;
            let tree = commit
                .tree()
                .map_err(|e| crate::Error::Git(format!("HEAD tree: {e}")))?;
            walker::tree_blob_paths(&tree)
        })();
        let Ok(pairs) = pairs else {
            return;
        };
        for (path, oid) in pairs {
            self.blob_oid_memo
                .entry((head_sha.to_string(), path))
                .or_insert(Some(oid));
        }
        self.head_blob_memo_warmed_for = Some(head_sha.to_string());
    }

    /// Get or build a [`CachedLineIndex`] for `(path, layer)`, building it
    /// from `bytes` on first access (the miss path).  Subsequent calls for
    /// the same key return the pre-built index directly (hit path; `bytes`
    /// is dropped unused).
    pub(crate) fn get_or_build_line_index(
        &mut self,
        bytes: Vec<u8>,
        path: &str,
        layer: DriftSource,
    ) -> &mut CachedLineIndex {
        let key = (path.to_string(), layer);
        if self.line_index_cache.contains_key(&key) {
            self.line_index_hits += 1;
        } else {
            self.line_index_misses += 1;
            self.line_index_cache
                .insert(key.clone(), Box::new(CachedLineIndex::new(bytes)));
        }
        self.line_index_cache.get_mut(&key).unwrap()
    }

    /// Retrieve an already-built [`CachedLineIndex`] for `(path, layer)`.
    /// Returns `None` when no entry exists — the caller should fall back to
    /// [`get_or_build_line_index`].
    pub(crate) fn get_line_index(
        &mut self,
        path: &str,
        layer: DriftSource,
    ) -> Option<&mut CachedLineIndex> {
        let key = (path.to_string(), layer);
        self.line_index_cache.get_mut(&key).map(|b| &mut **b)
    }

    pub(crate) fn anchors_total(&self) -> u64 {
        self.anchors_fresh
            + self.anchors_moved
            + self.anchors_changed
            + self.anchors_orphaned
            + self.anchors_merge_conflict
            + self.anchors_unavailable
            + self.anchors_skipped_clean_head
    }

    /// Build the reverse-indexed walk: one pass from HEAD, Bloom-gated,
    /// that produces per-anchor commit deltas for every anchor in every span.
    ///
    /// The walk tracks per-anchor current paths through rename chains:
    /// when a commit renames an anchor's path from A to B, subsequent commits
    /// query the Bloom filter for B (the new name).
    ///
    /// Terminates when every `anchor_sha` in the reverse index has been observed
    /// (passed in the walk) or the walk reaches the root.
    ///
    /// The output is stored internally on `self.reverse_walk_output` so that
    /// consumers (`resolve_at_head_shared`, `follow_path_to_head_shared`) can
    /// read it without callers having to thread it through every signature.
    ///
    /// ## Commit-graph is optional
    ///
    /// The changed-path Bloom filter accelerates the walk but is not a
    /// correctness gate: an ordinary repo (fresh `git init` + commit, no
    /// gc, no opt-in `core.commitGraph`) has no commit-graph file, which
    /// is a normal state, not an error. When absent the walk runs
    /// without it (tree-diffing every commit). Absence is never surfaced
    /// as a fatal error or a plumbing instruction.
    pub(crate) fn build_reverse_walk(
        &mut self,
        repo: &gix::Repository,
        spans: &[(String, crate::types::Span)],
    ) -> Result<()> {
        let _span_total = perf::span("resolver.build-walk");

        // 1. Build the reverse index and per-anchor state.
        let t0 = std::time::Instant::now();
        let reverse_index;
        let mut per_anchor: Vec<AnchorWalkState>;
        let mut path_index;
        let max_copy;
        let head_sha;
        let head_oid;
        {
            let _span_index = perf::span("resolver.build-walk.index");
            reverse_index = AnchorReverseIndex::from_spans(spans);

            // Most permissive copy_detection across all spans.
            max_copy = spans
                .iter()
                .map(|(_, m)| m.config.copy_detection)
                .max()
                .unwrap_or(CopyDetection::Off);

            // Initialize per-anchor state.
            per_anchor = Vec::new();
            for (span_name, span) in spans {
                for (anchor_id, anchor) in &span.anchors {
                    let sha = match gix::ObjectId::from_hex(anchor.anchor_sha.as_bytes()) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    per_anchor.push(AnchorWalkState {
                        span_name: span_name.clone(),
                        anchor_id: anchor_id.clone(),
                        anchor_sha: sha,
                        current_path: Arc::from(anchor.path.as_bytes()),
                        deltas: Vec::new(),
                        anchor_passed: false,
                    });
                }
            }

            path_index = PathIndex::new(&per_anchor);

            head_sha = git::head_oid(repo)?;
            head_oid = gix::ObjectId::from_hex(head_sha.as_bytes())
                .map_err(|e| crate::Error::Git(format!("parse HEAD: {e}")))?;
        }
        self.reverse_index_build_ms = t0.elapsed().as_millis() as u64;

        // 2. Open the Bloom filter if one exists. The changed-path Bloom
        // filter is a pure walk accelerator, not a correctness gate: an
        // ordinary repo (fresh `git init` + commit, no gc, no opt-in
        // `core.commitGraph`) has no commit-graph file, and that is a
        // normal state — not an error. When absent we walk without it,
        // tree-diffing every commit (the loop below already treats a
        // missing per-commit Bloom position as "maybe changed").
        let bloom: Option<CommitGraphBloom> = match self.bloom_memo.take() {
            Some(b) => b,
            None => {
                let _span_bloom = perf::span("resolver.build-walk.bloom-open");
                CommitGraphBloom::open(repo).ok()
            }
        };

        // 3. Walk from HEAD reverse-chronologically.
        let mut stop_set: HashSet<gix::ObjectId> = reverse_index.anchor_shas;

        {
            let _span_walk = perf::span("resolver.build-walk.walk");
            let walk = repo
                .rev_walk([head_oid])
                .sorting(gix::revision::walk::Sorting::BreadthFirst)
                .all()
                .map_err(|e| crate::Error::Git(format!("rev walk: {e}")))?;

            for info in walk {
                let info = info.map_err(|e| crate::Error::Git(format!("rev walk commit: {e}")))?;
                let commit_oid = info.id;

                // Stop-set handling: when a commit equals an anchor_sha, mark
                // every anchor with that sha as passed and remove them from
                // the path index so they no longer contribute to Bloom probes
                // or fan-out.
                if stop_set.remove(&commit_oid) {
                    for (i, state) in per_anchor.iter_mut().enumerate() {
                        if !state.anchor_passed && state.anchor_sha == commit_oid {
                            state.anchor_passed = true;
                            path_index.deactivate(i as u32);
                        }
                    }
                }
                if stop_set.is_empty() {
                    break;
                }

                self.walk_commits_visited += 1;

                if path_index.active_paths().is_empty() {
                    continue;
                }

                // Bloom filter gate: probe distinct active paths only.
                // When the commit is not in the commit-graph, fall back to
                // assuming all tracked paths may have changed (correctness:
                // the Bloom filter is an optimization, not a gate).
                let positives: Vec<Arc<[u8]>> = match bloom
                    .as_ref()
                    .and_then(|b| b.commit_position(&commit_oid).map(|pos| (b, pos)))
                {
                    Some((b, commit_pos)) => {
                        let v: Vec<Arc<[u8]>> = path_index
                            .active_paths()
                            .iter()
                            .filter(|p| b.maybe_contains(commit_pos, p))
                            .cloned()
                            .collect();
                        if v.is_empty() {
                            self.walk_bloom_skips += 1;
                            continue;
                        }
                        v
                    }
                    None => path_index.active_paths().to_vec(),
                };

                // Bloom says "maybe" for at least one path — run tree-diff.
                self.walk_tree_diffs += 1;

                let commit_sha_str = commit_oid.to_string();
                let commit_obj = repo
                    .find_commit(commit_oid)
                    .map_err(|e| crate::Error::Git(format!("find commit {commit_oid}: {e}")))?;
                let parent_oid = match commit_obj.parent_ids().next() {
                    Some(p) => p.detach(),
                    None => continue, // root commit — nothing older to diff against.
                };
                let parent_sha_str = parent_oid.to_string();

                let entries = walker::name_status(
                    repo,
                    &parent_sha_str,
                    &commit_sha_str,
                    max_copy,
                    &mut self.warnings,
                )?;

                // Count Bloom false positives: paths Bloom said "maybe" that
                // do not appear in the actual tree-diff result. Built lazily
                // (only when there were Bloom positives that mattered).
                if !positives.is_empty() {
                    let mut actual_paths: HashSet<&[u8]> = HashSet::new();
                    for e in &entries {
                        match e {
                            NS::Added { path } | NS::Modified { path } | NS::Deleted { path } => {
                                actual_paths.insert(path.as_bytes());
                            }
                            NS::Renamed { from, to } | NS::Copied { from, to } => {
                                actual_paths.insert(from.as_bytes());
                                actual_paths.insert(to.as_bytes());
                            }
                        }
                    }
                    for bp in &positives {
                        if !actual_paths.contains(bp.as_ref()) {
                            self.walk_bloom_false_positives += 1;
                        }
                    }
                }

                // Fan out via the path index. Collect rename/copy follow-ups
                // first so the path index can be mutated after the entry loop
                // without invalidating its iterators.
                let delta = Arc::new(CommitDelta {
                    parent: parent_sha_str,
                    commit: commit_sha_str,
                    entries,
                });

                // (affected_path, target_path_for_rename_or_copy_or_None)
                let mut renames: Vec<(u32, Arc<[u8]>)> = Vec::new();
                for entry in &delta.entries {
                    let (source_bytes, target_bytes): (&[u8], Option<&[u8]>) = match entry {
                        NS::Added { path } | NS::Modified { path } | NS::Deleted { path } => {
                            (path.as_bytes(), None)
                        }
                        NS::Renamed { from, to } | NS::Copied { from, to } => {
                            (from.as_bytes(), Some(to.as_bytes()))
                        }
                    };

                    // Snapshot anchor indexes for this path so the borrow on
                    // `path_index.by_path` is released before we record renames.
                    let anchor_idxs: Vec<u32> = match path_index.anchors_for_path(source_bytes) {
                        Some(v) => v.to_vec(),
                        None => continue,
                    };

                    let new_path: Option<Arc<[u8]>> = target_bytes.map(Arc::from);

                    for anchor_idx in anchor_idxs {
                        let state = &mut per_anchor[anchor_idx as usize];
                        if state.anchor_passed {
                            continue;
                        }
                        state.deltas.push(Arc::clone(&delta));
                        if let Some(new_path) = &new_path {
                            renames.push((anchor_idx, Arc::clone(new_path)));
                        }
                    }
                }

                for (anchor_idx, new_path) in renames {
                    // Skip renames for anchors that became passed during this
                    // commit's stop-set handling (defensive — `deactivate`
                    // already removed them from by_path, but anchor_passed is
                    // the authoritative gate).
                    if per_anchor[anchor_idx as usize].anchor_passed {
                        continue;
                    }
                    per_anchor[anchor_idx as usize].current_path = Arc::clone(&new_path);
                    path_index.rename(anchor_idx, new_path);
                }
            }
        }

        // 4. Finalize: reverse each anchor's deltas to oldest-first.
        let per_anchor_deltas;
        {
            let _span_finalize = perf::span("resolver.build-walk.finalize");
            let mut map: HashMap<(String, String), Vec<Arc<CommitDelta>>> = HashMap::new();
            for state in per_anchor {
                let mut deltas = state.deltas;
                deltas.reverse();
                map.insert((state.span_name, state.anchor_id), deltas);
            }
            per_anchor_deltas = map;
        }

        // Emit a perf counter for rename/copy fan-out updates in `PathIndex`.
        // This is the `R` term in the post-Phase-0 walk complexity.
        {
            let _span_renames = perf::span("resolver.build-walk.path-index-renames");
            perf::counter(
                "resolver.build-walk.path-index-renames",
                path_index.rename_updates,
            );
        }

        // Park the Bloom handle for the next walk in this session.
        //
        // Multiple walks per session (one per stolen chunk in the parallel
        // baseline build) also means `self.timelines` outlives a single walk.
        // That is sound only while every span shares one `copy_detection`
        // (`span_from_file` hard-codes the default), because
        // `PathTimelineKey` does not key on the walk's `max_copy`. If
        // per-span `copy_detection` ever becomes configurable, clear or
        // re-key `self.timelines` here.
        self.bloom_memo = Some(bloom);

        self.reverse_walk_output = Some(ReverseWalkOutput {
            head_sha,
            per_anchor_deltas,
        });

        Ok(())
    }
}

/// Per-anchor walk state maintained during the reverse-indexed walk.
///
/// Tracks the current path (updated through renames) and whether the
/// anchor_sha has been passed in the walk.
pub(crate) struct AnchorWalkState {
    span_name: String,
    anchor_id: String,
    anchor_sha: gix::ObjectId,
    /// The path we are currently tracking for this anchor. Updated when
    /// a rename/copy entry matches. Owned as `Arc<[u8]>` so the same
    /// bytes can also live as a key in `PathIndex.active_paths`/`by_path`
    /// without redundant allocations.
    current_path: Arc<[u8]>,
    /// Accumulated commit deltas (newest-first during the walk; reversed
    /// to oldest-first in the output). The walk fans the same
    /// `Arc<CommitDelta>` to every affected anchor without cloning the
    /// underlying `entries` vector.
    deltas: Vec<Arc<CommitDelta>>,
    /// Set to true once the walk passes this anchor's anchor_sha. After
    /// that point, no more deltas are recorded for this anchor.
    anchor_passed: bool,
}

/// Shared replacement for `walker::resolve_at_head`. Consumes deltas from
/// the session's reverse-indexed walk output instead of running its own
/// rev_walk + per-commit `name_status`. The hunk math (per-commit blob
/// diff for the tracked path) is still per-anchor — that's the work that
/// genuinely depends on the anchor's path.
pub(crate) fn resolve_at_head_shared(
    repo: &gix::Repository,
    session: &mut ResolveSession,
    r: &Anchor,
    span_name: &str,
    anchor_id: &str,
    _warnings: &mut Vec<String>,
) -> Result<Option<walker::Tracked>> {
    use crate::types::AnchorExtent;
    let (rstart, rend) = match r.extent {
        AnchorExtent::LineRange { start, end } => (start, end),
        AnchorExtent::WholeFile => (1, 1),
    };
    // Clone the walk data so we can release the borrow on
    // `session.reverse_walk_output` and then freely access
    // `session.blob_oid_memo` during the hunk loop.
    let (head_sha, deltas) = {
        let output = session
            .reverse_walk_output
            .as_ref()
            .ok_or_else(|| crate::Error::Git("reverse walk not built".into()))?;
        let head_sha = output.head_sha.clone();
        let deltas = output
            .per_anchor_deltas
            .get(&(span_name.to_string(), anchor_id.to_string()))
            .cloned()
            .unwrap_or_default();
        (head_sha, deltas)
    };

    // Phase 1: route projection through a `PathTimeline`. The timeline is
    // built from this anchor's delta slice, so the cache key includes
    // `anchor_sha`; anchors with the same current path/HEAD blob but different
    // replay windows must not share an entry.
    //
    // Copy detection is keyed off the anchor's span config when available;
    // when it isn't threaded through, we fall back to the most permissive
    // setting used by the reverse-indexed walk. The walk recorded entries
    // under the most-permissive copy_detection in `build_reverse_walk`, so
    // using that here is safe.
    // The reverse-indexed walk recorded entries under the most-permissive
    // copy_detection across all spans; using SameCommit here is a safe
    // default for cache identity since the entry stream already reflects
    // any wider detection the walk performed.
    let copy_detection = CopyDetection::SameCommit;

    let head_blob_oid_hex: Option<String> = session.head_blob_oid(repo, &head_sha, &r.path)?;
    let head_blob_oid: Option<gix::ObjectId> = head_blob_oid_hex
        .as_deref()
        .and_then(|s| gix::ObjectId::from_hex(s.as_bytes()).ok());

    let key = PathTimelineKey {
        path: Arc::from(r.path.as_bytes()),
        head_blob_oid,
        copy_detection,
        anchor_sha: r.anchor_sha.clone(),
    };

    let timeline_arc: Arc<PathTimeline> = if let Some(existing) = session.timelines.get(&key) {
        session.timeline_cache_hits += 1;
        Arc::clone(existing)
    } else {
        session.timeline_cache_misses += 1;
        let tl = build_timeline(
            repo,
            r.path.as_bytes(),
            &deltas,
            head_blob_oid,
            copy_detection,
            &mut session.timeline_paths,
            &mut session.blob_oid_memo,
        )?;
        let arc = Arc::new(tl);
        session.timelines.insert(key, Arc::clone(&arc));
        arc
    };

    let loc = match timeline_arc.project_by_linemap(rstart, rend) {
        Some(loc) => loc,
        None => return Ok(None),
    };

    // Common no-rename case: `loc.path` equals the anchor path, so the
    // HEAD-presence answer is exactly the OID we already resolved above —
    // no second tree walk needed. Otherwise resolve `loc.path` through the
    // shared memo.
    let loc_present = if loc.path == r.path {
        head_blob_oid_hex.is_some()
    } else {
        session.head_blob_oid(repo, &head_sha, &loc.path)?.is_some()
    };
    if !loc_present {
        return Ok(None);
    }
    Ok(Some(loc))
}

/// Shared replacement for `whole_file::follow_path_to_head`. Consumes
/// per-commit rename information from the reverse-indexed walk output;
/// runs no rev_walk of its own. Returns `Some(new_path)` if any rename
/// was followed, `None` if the path is unchanged.
pub(crate) fn follow_path_to_head_shared(
    _repo: &gix::Repository,
    session: &mut ResolveSession,
    span_name: &str,
    anchor_id: &str,
    path: &str,
    _warnings: &mut Vec<String>,
) -> Option<String> {
    let output = session.reverse_walk_output.as_ref()?;
    let deltas = output
        .per_anchor_deltas
        .get(&(span_name.to_string(), anchor_id.to_string()))?;
    let mut current = path.to_string();
    for delta in deltas {
        for e in &delta.entries {
            if let NS::Renamed { from, to } | NS::Copied { from, to } = e
                && from == &current
            {
                current = to.clone();
                break;
            }
        }
    }
    if current == path { None } else { Some(current) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_total_includes_skipped_clean_head() {
        let session = ResolveSession {
            reverse_walk_output: None,
            bloom_memo: None,
            drift_locus_hits: 0,
            drift_locus_misses: 0,
            filter_attr_hits: 0,
            filter_attr_misses: 0,
            known_head_ancestors: std::collections::HashMap::new(),
            blob_oid_memo: HashMap::new(),
            head_blob_memo_warmed_for: None,
            anchors_fresh: 0,
            anchors_moved: 0,
            anchors_changed: 0,
            anchors_orphaned: 0,
            anchors_merge_conflict: 0,
            anchors_unavailable: 0,
            anchors_fast_path_hits: 0,
            anchors_full_resolution: 0,
            per_anchor_us: Vec::new(),
            per_anchor_trace: None,
            walk_bloom_skips: 0,
            walk_bloom_false_positives: 0,
            walk_tree_diffs: 0,
            walk_commits_visited: 0,
            reverse_index_build_ms: 0,
            warnings: Vec::new(),
            anchors_skipped_clean_head: 50,
            timelines: HashMap::new(),
            timeline_cache_hits: 0,
            timeline_cache_misses: 0,
            timeline_paths: PathInterner::new(),
            relocation_candidate_reads: 0,
            relocation_text_memo: HashMap::new(),
            line_index_cache: HashMap::new(),
            line_index_hits: 0,
            line_index_misses: 0,
        };

        let total = session.anchors_total();

        // Decomposition identity per card: each anchor is either skipped
        // clean-head, resolved via a per-anchor fast-path, or goes through
        // full resolution.
        let decomposed = session.anchors_skipped_clean_head
            + session.anchors_fast_path_hits
            + session.anchors_full_resolution;
        assert_eq!(
            total, decomposed,
            "anchors-total must equal skipped-clean-head + fast-path-hits + full-resolution"
        );
        assert_eq!(
            total, 50,
            "anchors-total must count anchors that were skipped clean-head"
        );
    }

    #[test]
    fn decomposition_identity_mixed_buckets() {
        let session = ResolveSession {
            reverse_walk_output: None,
            bloom_memo: None,
            drift_locus_hits: 0,
            drift_locus_misses: 0,
            filter_attr_hits: 0,
            filter_attr_misses: 0,
            known_head_ancestors: std::collections::HashMap::new(),
            blob_oid_memo: HashMap::new(),
            head_blob_memo_warmed_for: None,
            anchors_fresh: 0,
            anchors_moved: 3,
            anchors_changed: 2,
            anchors_orphaned: 0,
            anchors_merge_conflict: 0,
            anchors_unavailable: 1,
            anchors_fast_path_hits: 4,
            anchors_full_resolution: 2,
            per_anchor_us: Vec::new(),
            per_anchor_trace: None,
            walk_bloom_skips: 0,
            walk_bloom_false_positives: 0,
            walk_tree_diffs: 0,
            walk_commits_visited: 0,
            reverse_index_build_ms: 0,
            warnings: Vec::new(),
            anchors_skipped_clean_head: 40,
            timelines: HashMap::new(),
            timeline_cache_hits: 0,
            timeline_cache_misses: 0,
            timeline_paths: PathInterner::new(),
            relocation_candidate_reads: 0,
            relocation_text_memo: HashMap::new(),
            line_index_cache: HashMap::new(),
            line_index_hits: 0,
            line_index_misses: 0,
        };

        let total = session.anchors_total();

        // The status-bucket total should account for moved+changed+unavailable = 6.
        // But the decomposition identity is: total == skipped-clean-head + fast-path-hits + full-resolution.
        assert_eq!(
            total,
            session.anchors_fresh
                + session.anchors_moved
                + session.anchors_changed
                + session.anchors_orphaned
                + session.anchors_merge_conflict
                + session.anchors_unavailable
                + session.anchors_skipped_clean_head,
            "anchors-total must include skipped-clean-head alongside per-status buckets"
        );

        let decomposed = session.anchors_skipped_clean_head
            + session.anchors_fast_path_hits
            + session.anchors_full_resolution;
        assert_eq!(
            total, decomposed,
            "anchors-total == skipped-clean-head + fast-path-hits + full-resolution"
        );
        assert_eq!(total, 46);
    }

    // ── PathIndex rename/copy fan-out tests ────────────────────────────────
    //
    // Phase 0 of the three-phase plan replaces the anchor-quadratic walk
    // bookkeeping with `PathIndex`. These tests pin down its rename/copy
    // fan-out semantics independently of any repository fixture.

    fn aws(path: &[u8]) -> AnchorWalkState {
        AnchorWalkState {
            span_name: "m".to_string(),
            anchor_id: "a".to_string(),
            anchor_sha: gix::ObjectId::null(gix::hash::Kind::Sha1),
            current_path: Arc::from(path),
            deltas: Vec::new(),
            anchor_passed: false,
        }
    }

    fn arc_path(p: &[u8]) -> Arc<[u8]> {
        Arc::from(p)
    }

    fn sorted<T: Ord + Clone>(v: &[T]) -> Vec<T> {
        let mut out = v.to_vec();
        out.sort();
        out
    }

    #[test]
    fn path_index_initial_layout_groups_anchors_by_path() {
        let anchors = vec![aws(b"a.rs"), aws(b"b.rs"), aws(b"a.rs")];
        let idx = PathIndex::new(&anchors);

        assert_eq!(sorted(idx.anchors_for_path(b"a.rs").unwrap()), vec![0, 2]);
        assert_eq!(sorted(idx.anchors_for_path(b"b.rs").unwrap()), vec![1]);
        let active: Vec<Vec<u8>> = idx.active_paths().iter().map(|p| p.to_vec()).collect();
        assert_eq!(active.len(), 2);
        assert!(active.iter().any(|p| p == b"a.rs"));
        assert!(active.iter().any(|p| p == b"b.rs"));
        assert_eq!(idx.rename_updates, 0);
    }

    #[test]
    fn path_index_rename_moves_single_anchor_and_keeps_old_bucket() {
        // Two anchors share a path; renaming one must leave the other on the
        // old path. Old bucket stays active because anchor 1 still tracks it.
        let anchors = vec![aws(b"src/a.rs"), aws(b"src/a.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.rename(0, arc_path(b"src/a_renamed.rs"));

        assert_eq!(idx.rename_updates, 1);
        assert_eq!(idx.anchors_for_path(b"src/a.rs").unwrap(), &[1]);
        assert_eq!(idx.anchors_for_path(b"src/a_renamed.rs").unwrap(), &[0]);

        let active: Vec<Vec<u8>> = idx.active_paths().iter().map(|p| p.to_vec()).collect();
        assert_eq!(active.len(), 2);
        assert!(active.iter().any(|p| p == b"src/a.rs"));
        assert!(active.iter().any(|p| p == b"src/a_renamed.rs"));
    }

    #[test]
    fn path_index_rename_last_anchor_drops_old_path_from_active() {
        let anchors = vec![aws(b"only.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.rename(0, arc_path(b"renamed.rs"));

        assert!(idx.anchors_for_path(b"only.rs").is_none());
        assert_eq!(idx.anchors_for_path(b"renamed.rs").unwrap(), &[0]);
        let active: Vec<Vec<u8>> = idx.active_paths().iter().map(|p| p.to_vec()).collect();
        assert_eq!(active, vec![b"renamed.rs".to_vec()]);
    }

    #[test]
    fn path_index_rename_to_same_path_is_noop() {
        let anchors = vec![aws(b"x.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.rename(0, arc_path(b"x.rs"));

        assert_eq!(idx.rename_updates, 0);
        assert_eq!(idx.anchors_for_path(b"x.rs").unwrap(), &[0]);
    }

    #[test]
    fn path_index_rename_into_existing_active_path_merges_buckets() {
        // Models a copy that pulls anchor 0 into the bucket already
        // occupied by anchor 1 (e.g. both anchors now track the same
        // post-rename path).
        let anchors = vec![aws(b"a.rs"), aws(b"b.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.rename(0, arc_path(b"b.rs"));

        assert!(idx.anchors_for_path(b"a.rs").is_none());
        assert_eq!(sorted(idx.anchors_for_path(b"b.rs").unwrap()), vec![0, 1]);
        let active: Vec<Vec<u8>> = idx.active_paths().iter().map(|p| p.to_vec()).collect();
        assert_eq!(active, vec![b"b.rs".to_vec()]);
    }

    #[test]
    fn path_index_deactivate_drops_anchor_and_path_when_last() {
        let anchors = vec![aws(b"a.rs"), aws(b"a.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.deactivate(0);
        assert_eq!(idx.anchors_for_path(b"a.rs").unwrap(), &[1]);

        idx.deactivate(1);
        assert!(idx.anchors_for_path(b"a.rs").is_none());
        assert!(idx.active_paths().is_empty());
    }

    #[test]
    fn path_index_chained_renames_track_through_history() {
        // a.rs -> b.rs -> c.rs. Each step moves the anchor and keeps
        // active_paths in sync.
        let anchors = vec![aws(b"a.rs")];
        let mut idx = PathIndex::new(&anchors);

        idx.rename(0, arc_path(b"b.rs"));
        idx.rename(0, arc_path(b"c.rs"));

        assert_eq!(idx.rename_updates, 2);
        assert!(idx.anchors_for_path(b"a.rs").is_none());
        assert!(idx.anchors_for_path(b"b.rs").is_none());
        assert_eq!(idx.anchors_for_path(b"c.rs").unwrap(), &[0]);
        let active: Vec<Vec<u8>> = idx.active_paths().iter().map(|p| p.to_vec()).collect();
        assert_eq!(active, vec![b"c.rs".to_vec()]);
    }
}
