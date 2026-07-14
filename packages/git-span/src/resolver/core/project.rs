//! Deterministic projections from `ResolutionCore` to the committed
//! (HEAD-only) and effective (active-layer) `SpanResolved` views. Pure
//! selection/relabeling over already-captured per-layer observations — no
//! repo access, no re-resolution. See `resolver/cache_v2/mod.rs`'s
//! `build_committed_spans` / `build_clean_whole_result`, which this
//! replaces conceptually by resolving once and projecting twice.

use super::resolution::{AnchorCore, DriftLocusCore, LayerObservationCore};
use crate::types::{
    AnchorLocation, AnchorResolved, AnchorStatus, DriftLocus, DriftSource, FuzzySuccessor,
    LayerSet, SpanResolved,
};
use std::path::PathBuf;
use std::str::FromStr;

fn to_anchor_location(loc: &super::resolution::LocationCore) -> AnchorLocation {
    let blob = loc
        .blob
        .as_deref()
        .map(|s| gix::ObjectId::from_str(s).expect("core: stored blob oid must be valid hex"));
    AnchorLocation {
        path: PathBuf::from(&loc.path),
        extent: loc.extent.into(),
        blob,
    }
}

fn to_fuzzy_successors(v: &[super::resolution::FuzzySuccessorCore]) -> Vec<FuzzySuccessor> {
    v.iter()
        .map(|f| FuzzySuccessor {
            path: f.path.clone(),
            start: f.start,
            end: f.end,
            confidence: f64::from(f.confidence_bps) / 10_000.0,
        })
        .collect()
}

/// Build one projected `AnchorResolved` from a single selected layer
/// observation plus the anchor's layer-neutral fields. Shared by
/// `project_committed` and `project_effective` (via `project_effective`
/// with different `layers`) so both views assemble through exactly one
/// field-mapping path.
fn project_anchor(
    core: &AnchorCore,
    obs: &LayerObservationCore,
    source: Option<DriftSource>,
    layer_sources: Vec<DriftSource>,
) -> AnchorResolved {
    let locus = if matches!(source, Some(DriftSource::Head)) {
        core.locus.as_ref().map(|l| match l {
            DriftLocusCore::ChangedAt(oid) => DriftLocus::ChangedAt(
                gix::ObjectId::from_str(oid).expect("core: stored locus oid must be valid hex"),
            ),
            DriftLocusCore::OrphanedAt(oid) => DriftLocus::OrphanedAt(
                gix::ObjectId::from_str(oid).expect("core: stored locus oid must be valid hex"),
            ),
        })
    } else {
        None
    };
    AnchorResolved {
        anchor_id: core.anchor_id.clone(),
        anchor_sha: core.anchor_sha.clone(),
        anchored: to_anchor_location(&core.anchored),
        current: obs.current.as_ref().map(to_anchor_location),
        status: obs.status.clone(),
        content_equivalent: obs.content_equivalent,
        source,
        layer_sources,
        locus,
        fuzzy_successors: to_fuzzy_successors(&obs.fuzzy_successors),
    }
}

/// Project the committed (HEAD-only) view: every anchor is resolved as if
/// `EngineOptions::committed_only()` had run — the Head observation is the
/// only one ever selected, matching today's `build_committed_spans`. This
/// is exactly `project_effective` specialized to `LayerSet::committed_only()`
/// (Head is always evaluated regardless of `LayerSet` — see
/// `crate::types::LayerSet`'s doc: "HEAD is always on").
pub(crate) fn project_committed(core: &super::resolution::ResolutionCore) -> Vec<SpanResolved> {
    project_effective(core, LayerSet::committed_only())
}

/// Project the effective (active-layer) view for `layers`. Selects the
/// shallowest *enabled* layer that shows drift as the primary source
/// (Worktree, then Index, then Head — matching the current resolver's
/// `deepest_layer` precedence in `resolver/engine/anchor.rs`), and lists
/// every enabled drifting layer in `layer_sources` in the SAME order the
/// live resolver's [`compute_layer_sources`] emits — Worktree, then Index,
/// then Head. (The `AnchorResolved::layer_sources` doc's "Index → Worktree
/// → Head" wording contradicts that function's actual runtime output; the
/// runtime order is authoritative, since `stale_output` renders one
/// `Finding` per entry in list order and single-pass capture must be
/// byte-identical to direct resolution when both Index and Worktree drift.)
///
/// [`compute_layer_sources`]: crate::resolver::engine::anchor
pub(crate) fn project_effective(
    core: &super::resolution::ResolutionCore,
    layers: LayerSet,
) -> Vec<SpanResolved> {
    core.spans
        .iter()
        .map(|span| {
            let anchors = span
                .anchors
                .iter()
                .map(|(_, anchor)| project_effective_anchor(anchor, layers))
                .collect();
            SpanResolved {
                name: span.name.clone(),
                message: span.message.clone(),
                anchors,
                follow_moves: span.follow_moves,
            }
        })
        .collect()
}

fn project_effective_anchor(anchor: &AnchorCore, layers: LayerSet) -> AnchorResolved {
    let index_drifts = layers.index && anchor.index.shows_drift();
    let worktree_drifts = layers.worktree && anchor.worktree.shows_drift();
    let head_drifts = anchor.head.shows_drift();

    let mut layer_sources = Vec::with_capacity(3);
    if worktree_drifts {
        layer_sources.push(DriftSource::Worktree);
    }
    if index_drifts {
        layer_sources.push(DriftSource::Index);
    }
    if head_drifts {
        layer_sources.push(DriftSource::Head);
    }

    // Primary source: shallowest enabled drifting layer, worktree first —
    // matches `resolver/engine/anchor.rs`'s `deepest_layer` precedence.
    let source = if worktree_drifts {
        Some(DriftSource::Worktree)
    } else if index_drifts {
        Some(DriftSource::Index)
    } else if head_drifts {
        Some(DriftSource::Head)
    } else {
        None
    };

    // Rendered `current`/`status`/`content_equivalent`/`fuzzy_successors` come
    // from the DEEPEST enabled layer's observation, NOT from the drift-source
    // layer's — the two differ (e.g. a HEAD-sourced `Changed` with a clean
    // worktree renders the worktree `current`, blob `None`, not the Head blob).
    // `source`/`layer_sources` above still carry the drift attribution. See
    // `AnchorCore::full` (card main-157 sub-scope 3C fix). When the worktree
    // layer is enabled the effective view is `anchor.full`; otherwise (the
    // committed / HEAD-only projection) the deepest enabled layer is Head.
    let obs = if layers.worktree {
        &anchor.full
    } else {
        match source {
            Some(DriftSource::Index) => &anchor.index,
            _ => &anchor.head,
        }
    };

    // A `Moved` anchor carries exactly ONE drift source in the live resolver:
    // every relocation arm in `resolver/engine/anchor.rs` and
    // `resolver/engine/whole_file.rs` sets `layer_sources = vec![deepest]` (or
    // `vec![]`) — attributing the move to the single deepest enabled drifting
    // layer, NOT listing every layer whose absolute view relocated ("MOVED
    // means bytes are equal; keep the single-row shape", design requirement 4).
    // The per-layer capture, by contrast, records each layer's absolute
    // observation, so a committed `git mv` seen with a clean worktree yields a
    // Moved observation at BOTH the Head layer (head-vs-anchor) and the Worktree
    // layer (the full run's deepest-layer attribution). Emitting both duplicates
    // the finding (`MOVED W` + `MOVED H`) where direct resolution renders one
    // (`MOVED W`). Collapse to the single primary source — the deepest enabled
    // drifting layer, which is exactly what the live resolver's `deepest_layer`
    // attribution picks — whenever the RENDERED status (the deepest-enabled-
    // layer observation) is `Moved`. This is a pure `Moved`-only correction:
    // `Changed` keeps its full relative `layer_sources` list, since the live
    // resolver genuinely emits one `Changed` finding per relatively-drifting
    // layer. A `Moved` where a shallower layer introduced a genuinely different
    // relocation still collapses to that deepest layer's single finding — again
    // matching the live resolver, which reports only the deepest layer's move.
    if matches!(obs.status, AnchorStatus::Moved) {
        layer_sources = source.into_iter().collect();
    }

    project_anchor(anchor, obs, source, layer_sources)
}
