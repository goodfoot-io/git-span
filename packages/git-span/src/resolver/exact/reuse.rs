//! Per-span reuse rows and the reverse path index (card main-157 Phase 4A).
//!
//! Phase 3 published one compact render-ready [`StaleSummary`](super::StaleSummary)
//! per generation and left [`GenerationInput::rows`](crate::resolver::store::GenerationInput)
//! / `path_index` empty (`super::publish_if_eligible`). Phase 4's incremental
//! path needs the *layer-neutral* detail back — one reusable
//! [`SpanCore`](crate::resolver::core::resolution::SpanCore) per span — so an
//! unrelated commit can reuse every unchanged span's resolution instead of
//! re-resolving the whole corpus. This module is the normalization boundary:
//! it turns a resolved [`ResolutionCore`] into the store's row model and back,
//! byte-identically.
//!
//! ## What one generation stores
//!
//! * **One `span-core` row per span** (`ROW_KIND_SPAN_CORE`), keyed by span
//!   name, whose payload is `bincode(`[`ReuseSpanRow`]`)` — the full `SpanCore`
//!   plus one derived bit, `needs_widen`.
//! * **The reverse path index**: one `(source_path -> span name)` entry per
//!   anchored path, so a later dirty phase can find spans by changed path
//!   without decoding every row. (Phase 4B derives its affected set from the
//!   reconstructed cores' own anchor paths, which is equivalent; the index is
//!   populated now for the schema's stated intent and the Phase 5 dirty path.)
//!
//! ## The `needs_widen` bit — the correctness landmine
//!
//! [`find_relocated_range_in_paths`](crate::resolver::engine) enumerates *every*
//! tracked path when a file-backed anchor's content no longer matches at its
//! anchored path (drifted / relocated / deleted). A brand-new file introduced
//! by an otherwise-unrelated commit can therefore become a relocation (or
//! copy) target and flip such an anchor's result. So a span that is drifted at
//! *any* layer, or uses `follow_moves`, or resolves under a repo/commit-wide
//! copy pool, is NOT safe to reuse merely because its own anchored paths did
//! not change — it must be re-resolved whenever ANY tracked path changed.
//! `needs_widen` records exactly that per span; Phase 4B unions every
//! widen-marked span into the affected set whenever the changed-path set is
//! non-empty.
//!
//! `SameCommit` copy detection (the only copy mode the current file-backed span
//! model can express — `types::span_from_file` hard-codes
//! `DEFAULT_COPY_DETECTION = SameCommit`) is deliberately treated as *local*:
//! its copy search is bounded to the commits along the anchored path's own
//! history, which descendant-ancestry + path-stability already stabilizes. Only
//! the genuinely global modes (`AnyFileInCommit` / `AnyFileInRepo`) force a
//! widen, and that contribution is supplied by the caller via
//! `global_copy_widen` (derived from the whole-invocation
//! [`StateToken::copy_detection`](crate::resolver::core::token::StateToken)),
//! because `SpanCore` does not itself carry the per-span copy mode. If the span
//! model ever gains a per-span global copy mode, that path already fails closed:
//! the token's max copy mode widens *all* spans.

use std::collections::{BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::resolver::core::resolution::{ResolutionCore, SpanCore};
use crate::resolver::store::{GenerationRow, PathIndexEntry};
use crate::types::AnchorStatus;

/// Row-kind discriminant for a per-span reuse row. A distinct constant so a
/// future row kind (e.g. an immutable parsed span blob) can coexist and be
/// filtered on read.
pub(crate) const ROW_KIND_SPAN_CORE: u32 = 1;

/// The persisted per-span reuse payload: the layer-neutral [`SpanCore`] plus
/// the derived global-widen bit. `SpanCore` round-trips byte-identically
/// through bincode (it derives `Serialize`/`Deserialize`); wrapping it adds the
/// one bit the incremental affected-set computation needs without a second row.
#[derive(Serialize, Deserialize)]
struct ReuseSpanRow {
    core: SpanCore,
    needs_widen: bool,
}

/// Whether one resolved span must be widened to "any tracked path changed"
/// sensitivity. See the module docs: drifted at any layer, `follow_moves`, or
/// a global copy pool.
pub(crate) fn span_needs_widen(span: &SpanCore, global_copy_widen: bool) -> bool {
    global_copy_widen || span.follow_moves || span_is_drifted(span)
}

/// Whether any anchor of a span shows drift at any observed layer — the exact
/// condition under which the live resolver may run the all-tracked-paths
/// relocation/copy-target scan.
fn span_is_drifted(span: &SpanCore) -> bool {
    span.anchors.iter().any(|(_, a)| {
        a.head.status != AnchorStatus::Fresh
            || a.index.status != AnchorStatus::Fresh
            || a.worktree.status != AnchorStatus::Fresh
            || a.full.status != AnchorStatus::Fresh
    })
}

/// The set of span names that must be widened, given the whole-invocation
/// global-copy signal.
pub(crate) fn compute_widen(core: &ResolutionCore, global_copy_widen: bool) -> HashSet<String> {
    core.spans
        .iter()
        .filter(|s| span_needs_widen(s, global_copy_widen))
        .map(|s| s.name.clone())
        .collect()
}

/// Normalize a resolved [`ResolutionCore`] into the store's row model: one
/// `span-core` row per span (in `core.spans` order, which is the canonical
/// stored order) plus the reverse `(source_path -> span name)` index. `widen`
/// is the set of span names for which `needs_widen` is stored `true`.
pub(crate) fn core_to_reuse_rows(
    core: &ResolutionCore,
    widen: &HashSet<String>,
) -> (Vec<GenerationRow>, Vec<PathIndexEntry>) {
    let mut rows = Vec::with_capacity(core.spans.len());
    let mut path_index = Vec::new();
    // Dedup (path, span) pairs so a span anchoring the same path twice yields
    // one index entry (publish also `INSERT OR IGNORE`s, but keep the input
    // clean and deterministic).
    let mut seen_index: BTreeSet<(String, String)> = BTreeSet::new();

    for span in &core.spans {
        let payload = bincode::serialize(&ReuseSpanRow {
            core: span.clone(),
            needs_widen: widen.contains(&span.name),
        })
        .expect("serialize ReuseSpanRow");
        rows.push(GenerationRow {
            row_kind: ROW_KIND_SPAN_CORE,
            row_key: span.name.clone(),
            payload,
        });

        for (_, anchor) in &span.anchors {
            let key = (anchor.anchored.path.clone(), span.name.clone());
            if seen_index.insert(key) {
                path_index.push(PathIndexEntry {
                    source_path: anchor.anchored.path.clone(),
                    row_key: span.name.clone(),
                });
            }
        }
    }

    (rows, path_index)
}

/// Reconstruct a [`ResolutionCore`] from persisted reuse rows — the inverse of
/// [`core_to_reuse_rows`]. Rows are already verified and returned in stored
/// (ordinal) order by [`get_generation`](crate::resolver::store::CacheStore);
/// span order is therefore preserved. A row that fails to decode is skipped
/// (fail-safe: its span simply won't be reusable and Phase 4B re-resolves it),
/// never trusted.
pub(crate) fn reuse_rows_to_core(rows: &[GenerationRow]) -> ResolutionCore {
    let spans = rows
        .iter()
        .filter(|r| r.row_kind == ROW_KIND_SPAN_CORE)
        .filter_map(|r| bincode::deserialize::<ReuseSpanRow>(&r.payload).ok())
        .map(|r| r.core)
        .collect();
    ResolutionCore { spans }
}

/// The set of span names whose stored `needs_widen` bit is `true`. Used by the
/// incremental affected-set computation to union widen-marked spans in whenever
/// any tracked path changed. Undecodable rows are ignored (their spans are
/// treated as non-reusable by [`reuse_rows_to_core`] anyway).
pub(crate) fn reuse_rows_widen(rows: &[GenerationRow]) -> HashSet<String> {
    rows.iter()
        .filter(|r| r.row_kind == ROW_KIND_SPAN_CORE)
        .filter_map(|r| bincode::deserialize::<ReuseSpanRow>(&r.payload).ok())
        .filter(|r| r.needs_widen)
        .map(|r| r.core.name)
        .collect()
}
