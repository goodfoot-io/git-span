//! `git mesh tree` — render a clique-grouped impact tree rooted at the
//! matched anchor paths.
//!
//! The graph construction, clique grouping, expansion, ordering, depth
//! semantics, and rendering are a faithful port of the authoritative
//! prototype `scripts/git-mesh-tree-demo.mjs`. The only thing the CLI
//! changes versus the prototype is the glob/resolution layer: roots are
//! anchor paths matched by the args against the loaded corpus, not the
//! prototype's CWD-relative prefix/`**/*` glob layer.

use std::collections::{BTreeMap, BTreeSet};

use super::{TreeArgs, TreeFormat};
use crate::cli::{CliError, NextStep};

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/// A single node in the clique-grouped impact tree.
#[derive(Debug, serde::Serialize)]
pub struct TreeNode {
    /// The anchor paths that form this clique (comma-separated in human output).
    pub members: Vec<String>,
    /// Expanded children of this clique node.
    pub children: Vec<TreeNode>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git mesh tree`. Returns `Ok(0)` on success.
pub fn run_tree(repo: &gix::Repository, args: TreeArgs, mesh_root: &str) -> anyhow::Result<i32> {
    // Load the corpus exactly once; build the graph from this single snapshot.
    let meshes = crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0;
    let mesh_vec: Vec<crate::types::Mesh> = meshes.into_iter().map(|(_, m)| m).collect();
    let graph = build_graph(&mesh_vec);

    // Resolve args → root anchor paths (graph node keys).
    let roots = resolve_roots(&args.globs, &graph)?;

    let forest = build_forest(&graph, &roots, args.depth);

    match args.format {
        TreeFormat::Human => {
            let mut lines = Vec::new();
            for node in &forest {
                render_node(node, "", &mut lines);
            }
            println!("{}", lines.join("\n"));
        }
        TreeFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&forest)?);
        }
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// Resolution (args → root anchor paths)
// ---------------------------------------------------------------------------

/// Match each arg against the graph's anchor-path node set. A glob arg uses
/// `globset` with literal path separators (mirroring
/// `MeshPathIndex::matching_names_glob`); a non-glob arg uses exact equality.
/// Any arg matching zero anchored paths is collected and surfaced as a
/// fail-closed [`CliError`].
fn resolve_roots(
    args: &[String],
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
) -> anyhow::Result<BTreeSet<String>> {
    let mut roots: BTreeSet<String> = BTreeSet::new();
    let mut unmatched: Vec<String> = Vec::new();

    for arg in args {
        let mut matched = false;
        if crate::mesh::read::is_glob_pattern(arg) {
            let glob = globset::GlobBuilder::new(arg)
                .literal_separator(true)
                .build()?
                .compile_matcher();
            for path in graph.keys() {
                if glob.is_match(path) {
                    roots.insert(path.clone());
                    matched = true;
                }
            }
        } else if graph.contains_key(arg) {
            roots.insert(arg.clone());
            matched = true;
        }
        if !matched {
            unmatched.push(arg.clone());
        }
    }

    if !unmatched.is_empty() {
        return Err(CliError {
            subcommand: "tree",
            summary: "no anchored files matched.".into(),
            what_happened: format!(
                "These arguments matched no anchored path in any mesh: {}.",
                unmatched.join(", ")
            ),
            next_steps: vec![NextStep::Bash("git mesh list".into())],
        }
        .into());
    }

    Ok(roots)
}

// ---------------------------------------------------------------------------
// Forest construction (root cliques + expansion)
// ---------------------------------------------------------------------------

/// Group the matched roots into cliques over the ROOT set only (never the full
/// graph), order them, then expand each into a subtree. Mirrors the prototype's
/// top-level forest construction.
fn build_forest(
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
    roots: &BTreeSet<String>,
    max_depth: usize,
) -> Vec<TreeNode> {
    let mut root_cliques: Vec<Vec<String>> = maximal_cliques(graph, roots)
        .into_iter()
        .map(|clique| order_members(graph, &clique))
        .collect();

    // Order root cliques by total internal weight desc, then first member asc.
    root_cliques.sort_by(|left, right| {
        clique_internal_weight(graph, right)
            .cmp(&clique_internal_weight(graph, left))
            .then_with(|| left[0].cmp(&right[0]))
    });

    root_cliques
        .into_iter()
        .map(|clique| {
            let members_set: BTreeSet<String> = clique.iter().cloned().collect();
            let children = expand_clique(&members_set, graph, &BTreeSet::new(), 0, max_depth);
            TreeNode {
                members: clique,
                children,
            }
        })
        .collect()
}

/// Sum of intra-clique edge weights (each undirected edge counted once).
fn clique_internal_weight(
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
    clique: &[String],
) -> u64 {
    let mut sum = 0;
    for left in clique {
        if let Some(edges) = graph.get(left) {
            for right in clique {
                if left < right {
                    sum += edges.get(right).copied().unwrap_or(0);
                }
            }
        }
    }
    sum
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/// Co-occurrence graph: `graph[a][b]` = edge weight (product of per-mesh
/// occurrence counts for the pair, summed across meshes). Line ranges are
/// collapsed to their file path (anchor extent ignored). Every anchored path
/// is present as a node even if it has no edges.
fn build_graph(meshes: &[crate::types::Mesh]) -> BTreeMap<String, BTreeMap<String, u64>> {
    let mut graph: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();

    for mesh in meshes {
        // Per-mesh occurrence count per path (line range collapsed to path).
        let mut counts: BTreeMap<String, u64> = BTreeMap::new();
        for (_, anchor) in &mesh.anchors {
            *counts.entry(anchor.path.clone()).or_insert(0) += 1;
            graph.entry(anchor.path.clone()).or_default();
        }

        let paths: Vec<&String> = counts.keys().collect();
        for left in 0..paths.len() {
            for right in (left + 1)..paths.len() {
                let weight = counts[paths[left]] * counts[paths[right]];
                add_edge(&mut graph, paths[left], paths[right], weight);
            }
        }
    }

    graph
}

fn add_edge(
    graph: &mut BTreeMap<String, BTreeMap<String, u64>>,
    left: &str,
    right: &str,
    weight: u64,
) {
    if left == right {
        return;
    }
    *graph
        .entry(left.to_string())
        .or_default()
        .entry(right.to_string())
        .or_insert(0) += weight;
    *graph
        .entry(right.to_string())
        .or_default()
        .entry(left.to_string())
        .or_insert(0) += weight;
}

// ---------------------------------------------------------------------------
// Clique enumeration (Bron–Kerbosch with pivot)
// ---------------------------------------------------------------------------

/// Enumerate every maximal clique among `candidates` over the mesh graph
/// (Bron–Kerbosch with a pivot). Returns ALL maximal cliques including
/// singletons; cliques may overlap. Non-greedy. `candidates` is a `BTreeSet`
/// so iteration order — and thus output order — is stable.
fn maximal_cliques(
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
    candidates: &BTreeSet<String>,
) -> Vec<BTreeSet<String>> {
    let in_scope = candidates;

    let neighbors_in_scope = |path: &str| -> BTreeSet<String> {
        let mut result = BTreeSet::new();
        if let Some(edges) = graph.get(path) {
            for neighbor in edges.keys() {
                if in_scope.contains(neighbor) {
                    result.insert(neighbor.clone());
                }
            }
        }
        result
    };

    let mut cliques: Vec<BTreeSet<String>> = Vec::new();
    search(
        &neighbors_in_scope,
        BTreeSet::new(),
        candidates.clone(),
        BTreeSet::new(),
        &mut cliques,
    );
    cliques
}

fn search<F>(
    neighbors_in_scope: &F,
    included: BTreeSet<String>,
    mut remaining: BTreeSet<String>,
    mut excluded: BTreeSet<String>,
    cliques: &mut Vec<BTreeSet<String>>,
) where
    F: Fn(&str) -> BTreeSet<String>,
{
    if remaining.is_empty() && excluded.is_empty() {
        cliques.push(included);
        return;
    }

    // Choose a pivot maximizing reach into `remaining`.
    let mut pivot: Option<String> = None;
    let mut pivot_reach: i64 = -1;
    for candidate in remaining.iter().chain(excluded.iter()) {
        let reach = neighbors_in_scope(candidate)
            .iter()
            .filter(|n| remaining.contains(*n))
            .count() as i64;
        if reach > pivot_reach {
            pivot_reach = reach;
            pivot = Some(candidate.clone());
        }
    }
    let pivot_neighbors = match &pivot {
        Some(p) => neighbors_in_scope(p),
        None => BTreeSet::new(),
    };

    let to_visit: Vec<String> = remaining
        .iter()
        .filter(|v| !pivot_neighbors.contains(*v))
        .cloned()
        .collect();

    for vertex in to_visit {
        let adjacency = neighbors_in_scope(&vertex);
        let mut next_included = included.clone();
        next_included.insert(vertex.clone());
        let next_remaining: BTreeSet<String> =
            remaining.iter().filter(|n| adjacency.contains(*n)).cloned().collect();
        let next_excluded: BTreeSet<String> =
            excluded.iter().filter(|n| adjacency.contains(*n)).cloned().collect();
        search(
            neighbors_in_scope,
            next_included,
            next_remaining,
            next_excluded,
            cliques,
        );
        remaining.remove(&vertex);
        excluded.insert(vertex);
    }
}

// ---------------------------------------------------------------------------
// Member ordering
// ---------------------------------------------------------------------------

/// Order a clique's members by intra-clique weight desc, then path asc.
fn order_members(
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
    clique: &BTreeSet<String>,
) -> Vec<String> {
    let internal_weight = |path: &str| -> u64 {
        let mut sum = 0;
        if let Some(edges) = graph.get(path) {
            for other in clique {
                if other != path {
                    sum += edges.get(other).copied().unwrap_or(0);
                }
            }
        }
        sum
    };
    let mut members: Vec<String> = clique.iter().cloned().collect();
    members.sort_by(|left, right| {
        internal_weight(right)
            .cmp(&internal_weight(left))
            .then_with(|| left.cmp(right))
    });
    members
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/// Expand a clique into its child subtrees. Children are the maximal cliques
/// among the union of members' external neighbors (minus branch ancestors),
/// ordered by strongest link weight back to the parent clique then first path.
/// Per-branch ancestor loop guard prevents a file reappearing below itself.
/// Expansion stops when `depth >= max_depth`.
fn expand_clique(
    members: &BTreeSet<String>,
    graph: &BTreeMap<String, BTreeMap<String, u64>>,
    ancestors: &BTreeSet<String>,
    depth: usize,
    max_depth: usize,
) -> Vec<TreeNode> {
    if depth >= max_depth {
        return Vec::new();
    }

    let mut next_ancestors = ancestors.clone();
    for member in members {
        next_ancestors.insert(member.clone());
    }

    let mut candidates: BTreeSet<String> = BTreeSet::new();
    for member in members {
        if let Some(edges) = graph.get(member) {
            for neighbor in edges.keys() {
                if !next_ancestors.contains(neighbor) {
                    candidates.insert(neighbor.clone());
                }
            }
        }
    }
    if candidates.is_empty() {
        return Vec::new();
    }

    let mut child_cliques: Vec<Vec<String>> = maximal_cliques(graph, &candidates)
        .into_iter()
        .map(|clique| order_members(graph, &clique))
        .collect();

    // Order child cliques by the strongest edge linking back to this clique.
    let link_weight = |clique: &[String]| -> u64 {
        let mut best = 0;
        for member in members {
            if let Some(edges) = graph.get(member) {
                for child in clique {
                    best = best.max(edges.get(child).copied().unwrap_or(0));
                }
            }
        }
        best
    };
    child_cliques.sort_by(|left, right| {
        link_weight(right)
            .cmp(&link_weight(left))
            .then_with(|| left[0].cmp(&right[0]))
    });

    child_cliques
        .into_iter()
        .map(|clique| {
            let clique_set: BTreeSet<String> = clique.iter().cloned().collect();
            let children =
                expand_clique(&clique_set, graph, &next_ancestors, depth + 1, max_depth);
            TreeNode {
                members: clique,
                children,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// Render a node and its descendants into `lines` (nested comma-grouped
/// markdown list, two-space indent per depth, no blank lines).
fn render_node(node: &TreeNode, indent: &str, lines: &mut Vec<String>) {
    lines.push(format!("{indent}- {}", node.members.join(", ")));
    let child_indent = format!("{indent}  ");
    for child in &node.children {
        render_node(child, &child_indent, lines);
    }
}
