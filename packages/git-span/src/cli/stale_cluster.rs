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
#[derive(Debug, Clone, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, HashMap};

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn singleton_with_no_shared_file_is_independent() {
        let stale = set(&["alpha"]);
        let mut full = HashMap::new();
        full.insert("alpha".to_string(), set(&["a.rs"]));

        let clusters = cluster_stale_spans(&stale, &full);
        assert_eq!(clusters.len(), 1, "a singleton must still be reported, not omitted");
        assert_eq!(clusters[0].spans, vec!["alpha".to_string()]);
        assert!(
            clusters[0].shared_files.is_empty(),
            "a singleton has no file shared with any other member"
        );
    }

    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn two_spans_sharing_one_file_form_one_cluster() {
        let stale = set(&["alpha", "beta"]);
        let mut full = HashMap::new();
        full.insert("alpha".to_string(), set(&["shared.rs"]));
        full.insert("beta".to_string(), set(&["shared.rs"]));

        let clusters = cluster_stale_spans(&stale, &full);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].spans, vec!["alpha".to_string(), "beta".to_string()]);
        assert_eq!(clusters[0].shared_files, vec!["shared.rs".to_string()]);
    }

    /// A–B–C, connected transitively through two *different* shared files
    /// (A–B via `x.rs`, B–C via `y.rs`). The group must merge into one
    /// 3-member cluster, and `shared_files` must be recomputed over the
    /// FINAL group membership — listing both bridging files — rather than
    /// carrying only whichever single union-find edge happened to merge the
    /// group first.
    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn transitive_chain_via_two_different_files_lists_both_bridges() {
        let stale = set(&["a", "b", "c"]);
        let mut full = HashMap::new();
        full.insert("a".to_string(), set(&["x.rs"]));
        full.insert("b".to_string(), set(&["x.rs", "y.rs"]));
        full.insert("c".to_string(), set(&["y.rs"]));

        let clusters = cluster_stale_spans(&stale, &full);
        assert_eq!(clusters.len(), 1, "a transitive chain must merge into one cluster");
        assert_eq!(
            clusters[0].spans,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
        assert_eq!(
            clusters[0].shared_files,
            vec!["x.rs".to_string(), "y.rs".to_string()],
            "shared_files must list BOTH bridging files, not just the one \
             union-find edge that happened to merge the group"
        );
    }

    /// `full_anchor_paths` carries every anchored path for a span, stale or
    /// healthy. Two stale spans must still cluster together through a file
    /// that is currently a *healthy* (non-stale) anchor for one of them.
    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn shared_file_via_a_healthy_anchor_still_clusters() {
        let stale = set(&["alpha", "beta"]);
        let mut full = HashMap::new();
        // alpha is stale via `drift.rs`; its anchor on `shared.rs` is
        // currently healthy, but the path still bridges to beta.
        full.insert("alpha".to_string(), set(&["drift.rs", "shared.rs"]));
        full.insert("beta".to_string(), set(&["shared.rs"]));

        let clusters = cluster_stale_spans(&stale, &full);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].spans, vec!["alpha".to_string(), "beta".to_string()]);
        assert_eq!(clusters[0].shared_files, vec!["shared.rs".to_string()]);
    }

    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn unrelated_spans_form_separate_clusters() {
        let stale = set(&["alpha", "beta"]);
        let mut full = HashMap::new();
        full.insert("alpha".to_string(), set(&["a.rs"]));
        full.insert("beta".to_string(), set(&["b.rs"]));

        let clusters = cluster_stale_spans(&stale, &full);
        assert_eq!(clusters.len(), 2, "unrelated spans must not merge");
        let mut spans_per_cluster: Vec<Vec<String>> =
            clusters.iter().map(|c| c.spans.clone()).collect();
        spans_per_cluster.sort();
        assert_eq!(
            spans_per_cluster,
            vec![vec!["alpha".to_string()], vec!["beta".to_string()]]
        );
        assert!(clusters.iter().all(|c| c.shared_files.is_empty()));
    }

    /// Two logically-identical `full_anchor_paths` maps, built by inserting
    /// their keys in different orders (`HashMap` iteration order is
    /// hash-based, not insertion-order, so these two instances already
    /// iterate differently from each other). `cluster_stale_spans` must
    /// still produce byte-identical output — including cluster order and
    /// per-cluster member order — regardless of which map's iteration order
    /// it happened to walk.
    #[test]
    #[ignore = "card main-168 Phase 3: cluster_stale_spans not implemented yet"]
    fn ordering_is_deterministic_across_shuffled_input_maps() {
        let stale = set(&["a", "b", "c", "d"]);

        let mut full1 = HashMap::new();
        full1.insert("a".to_string(), set(&["x.rs"]));
        full1.insert("b".to_string(), set(&["x.rs", "y.rs"]));
        full1.insert("c".to_string(), set(&["y.rs"]));
        full1.insert("d".to_string(), set(&["z.rs"]));

        let mut full2 = HashMap::new();
        full2.insert("d".to_string(), set(&["z.rs"]));
        full2.insert("c".to_string(), set(&["y.rs"]));
        full2.insert("b".to_string(), set(&["x.rs", "y.rs"]));
        full2.insert("a".to_string(), set(&["x.rs"]));

        let clusters1 = cluster_stale_spans(&stale, &full1);
        let clusters2 = cluster_stale_spans(&stale, &full2);
        assert_eq!(
            clusters1, clusters2,
            "identical logical input must produce byte-identical cluster output \
             (order included) regardless of the input HashMap's iteration order"
        );

        // Repeating the call against the very same map is equally stable.
        let clusters1_again = cluster_stale_spans(&stale, &full1);
        assert_eq!(clusters1, clusters1_again);
    }
}
