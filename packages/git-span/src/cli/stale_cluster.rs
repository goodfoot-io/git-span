//! Stale-span clustering — `git span stale --cluster`.
//!
//! Connected components over the run's stale spans, with an edge between
//! two spans whenever they share an anchored file (stale or healthy anchor).
//! See `plans/bounded-rename-chain.md` ("Clustering design").

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
/// Plain union-find: two spans merge whenever their `full_anchor_paths`
/// entries intersect. `shared_files` is not carried from whichever edge
/// happened to merge a group — it is recomputed after grouping, as every
/// path anchored by 2+ of that group's final members, so a transitive chain
/// bridged by two different files reports both bridges.
///
/// Only `stale_span_names` (a `BTreeSet`, so already sorted) is iterated;
/// `full_anchor_paths` is only ever probed via `.get()` by name, never
/// iterated, so output ordering does not depend on the input `HashMap`'s
/// iteration order.
pub fn cluster_stale_spans(
    stale_span_names: &std::collections::BTreeSet<String>,
    full_anchor_paths: &std::collections::HashMap<String, std::collections::BTreeSet<String>>,
) -> Vec<StaleCluster> {
    use std::collections::{BTreeMap, BTreeSet};

    let names: Vec<&String> = stale_span_names.iter().collect();
    let n = names.len();
    let mut parent: Vec<usize> = (0..n).collect();

    fn find(parent: &mut [usize], x: usize) -> usize {
        if parent[x] != x {
            parent[x] = find(parent, parent[x]);
        }
        parent[x]
    }
    fn union(parent: &mut [usize], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[rb] = ra;
        }
    }

    let empty: BTreeSet<String> = BTreeSet::new();
    for (i, name_i) in names.iter().enumerate() {
        let paths_i = full_anchor_paths.get(name_i.as_str()).unwrap_or(&empty);
        for (j, name_j) in names.iter().enumerate().skip(i + 1) {
            let paths_j = full_anchor_paths.get(name_j.as_str()).unwrap_or(&empty);
            if paths_i.intersection(paths_j).next().is_some() {
                union(&mut parent, i, j);
            }
        }
    }

    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }

    let mut clusters: Vec<StaleCluster> = groups
        .into_values()
        .map(|members| {
            let spans: Vec<String> = members.iter().map(|&i| names[i].clone()).collect();
            let mut file_counts: BTreeMap<&str, usize> = BTreeMap::new();
            for &i in &members {
                if let Some(paths) = full_anchor_paths.get(names[i].as_str()) {
                    for p in paths {
                        *file_counts.entry(p.as_str()).or_insert(0) += 1;
                    }
                }
            }
            let shared_files: Vec<String> = file_counts
                .into_iter()
                .filter(|&(_, count)| count >= 2)
                .map(|(p, _)| p.to_string())
                .collect();
            StaleCluster { spans, shared_files }
        })
        .collect();

    clusters.sort_by(|a, b| a.spans.cmp(&b.spans));
    clusters
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, HashMap};

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
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
