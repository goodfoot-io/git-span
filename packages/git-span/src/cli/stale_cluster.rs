//! Stale-span clustering — `git span stale --cluster`.
//!
//! Stub phase (card main-168 Phase 1): declares the contract only. See
//! `plans/bounded-rename-chain.md` ("Clustering design") for the union-find algorithm
//! this will implement — connected components over the run's stale spans,
//! with an edge between two spans whenever they share an anchored file
//! (stale or healthy anchor). Not yet implemented; `cluster_stale_spans`
//! panics via `todo!()` and is not called by anything yet.

/// One connected component of stale spans that share at least one anchored
/// file, transitively.
pub struct StaleCluster {
    /// Member span names, sorted for deterministic output.
    pub spans: Vec<String>,
    /// Anchored paths shared by 2+ member spans, sorted.
    pub shared_files: Vec<String>,
}

/// Partition `stale_span_names` into connected components by shared anchored
/// file. `full_anchor_paths` maps each span name to the full set of paths it
/// anchors (stale or healthy) — not just its currently-stale anchors — per
/// `plans/bounded-rename-chain.md`.
///
/// Not implemented yet: this is a Phase 1 contract stub.
pub fn cluster_stale_spans(
    stale_span_names: &std::collections::BTreeSet<String>,
    full_anchor_paths: &std::collections::HashMap<String, std::collections::BTreeSet<String>>,
) -> Vec<StaleCluster> {
    let _ = (stale_span_names, full_anchor_paths);
    todo!("implemented in a later phase")
}
