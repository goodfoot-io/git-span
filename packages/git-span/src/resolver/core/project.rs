//! Deterministic projections from `ResolutionCore` to the committed
//! (HEAD-only) and effective (active-layer) `SpanResolved` views. Pure
//! selection/relabeling over already-captured per-layer observations — no
//! repo access, no re-resolution. See `resolver/cache_v2/mod.rs`'s
//! `build_committed_spans` / `build_clean_whole_result`, which this
//! replaces conceptually by resolving once and projecting twice.

use super::resolution::{AnchorCore, DriftLocusCore, LayerObservationCore};
use crate::types::{
    AnchorLocation, AnchorResolved, DriftLocus, DriftSource, FuzzySuccessor, LayerSet, SpanResolved,
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
/// every enabled drifting layer in `layer_sources` using the field's
/// documented order (`crate::types::AnchorResolved::layer_sources`:
/// "shallow-to-deep order (Index → Worktree → Head)").
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
    if index_drifts {
        layer_sources.push(DriftSource::Index);
    }
    if worktree_drifts {
        layer_sources.push(DriftSource::Worktree);
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

    let obs = match source {
        Some(DriftSource::Worktree) => &anchor.worktree,
        Some(DriftSource::Index) => &anchor.index,
        _ => &anchor.head,
    };
    project_anchor(anchor, obs, source, layer_sources)
}
