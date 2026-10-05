//! Deterministic projections from `ResolutionCore` to the committed
//! (HEAD-only) and effective (active-layer) `SpanResolved` views. Pure
//! selection/relabeling over already-captured per-layer observations — no
//! repo access, no re-resolution. Replaces, conceptually, the legacy
//! `resolver/cache_v2/mod.rs`'s `build_committed_spans` /
//! `build_clean_whole_result` (deleted at cutover in `0a8bf95e`) by
//! resolving once and projecting twice.

use super::resolution::{AnchorCore, LayerObservationCore};
use crate::types::{
    AnchorExtent, AnchorResolved, AnchorStatus, DriftSource, LayerSet, SpanResolved,
};

/// Build one projected `AnchorResolved` from a single selected layer
/// observation plus the anchor's layer-neutral fields. Every view —
/// committed (`LayerSet::committed_only()`) or effective — assembles through
/// `project_effective` and this one field-mapping path.
fn project_anchor(
    core: &AnchorCore,
    obs: &LayerObservationCore,
    source: Option<DriftSource>,
    layer_sources: Vec<DriftSource>,
) -> AnchorResolved {
    // Only a `Deleted` anchor carries a locus (the commit that removed or
    // renamed its path). A view in which the anchor is not `Deleted` — e.g.
    // the worktree restored the path — drops it.
    let locus = if obs.status == AnchorStatus::Deleted {
        core.locus.clone()
    } else {
        None
    };
    AnchorResolved {
        anchor_id: core.anchor_id.clone(),
        stored_hash: core.stored_hash.clone(),
        anchored: core.anchored.clone(),
        current: obs.current.clone(),
        status: obs.status.clone(),
        content_equivalent: obs.content_equivalent,
        source,
        layer_sources,
        locus,
        fuzzy_successors: obs.fuzzy_successors.clone(),
        moved_uncommitted: obs.moved_uncommitted,
    }
}

/// Project the effective (active-layer) view for `layers`. Selects the
/// shallowest *enabled* layer that shows drift as the primary source
/// (Worktree, then Index, then Head — matching the current resolver's
/// `deepest_layer` precedence in `resolver/engine/anchor.rs`), and lists
/// every enabled drifting layer in `layer_sources` in the SAME order the
/// live resolver's [`compute_layer_sources`] emits. The order depends on the
/// extent: Worktree → Index → Head for line ranges, Index → Worktree → Head for
/// whole files. `drift_output` renders one `Finding` per entry in list order,
/// so single-pass capture must remain byte-identical to direct resolution when
/// both Index and Worktree drift.
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
                why: span.why.clone(),
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

    // Emit drifting layers in the SAME order the live resolver does, which
    // differs by extent because the two anchor kinds define drift differently:
    // line-range anchors compare each layer to its next-deeper neighbor and
    // `resolver/engine/anchor.rs`'s `compute_layer_sources` lists them
    // Worktree → Index → Head; whole-file anchors compare each layer absolutely
    // to the stored fingerprint and `resolver/engine/whole_file.rs` lists them
    // Index → Worktree → Head. Matching this order is load-bearing: the drift
    // renderer emits one `Finding` per `layer_sources` entry in list order, so a
    // whole-file anchor that drifts at every layer (clean worktree, content
    // changed vs the fingerprint) must project I → W → H to stay byte-identical
    // to direct resolution.
    let whole_file = matches!(anchor.anchored.extent, AnchorExtent::WholeFile);
    let mut layer_sources = Vec::with_capacity(3);
    if whole_file {
        if index_drifts {
            layer_sources.push(DriftSource::Index);
        }
        if worktree_drifts {
            layer_sources.push(DriftSource::Worktree);
        }
    } else {
        if worktree_drifts {
            layer_sources.push(DriftSource::Worktree);
        }
        if index_drifts {
            layer_sources.push(DriftSource::Index);
        }
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
