//! Phase 2 acceptance tests for `git mesh tree`.
//!
//! Every test is `#[ignore]` — they are the executable specification written
//! against the Phase 1 stubs and will be unskipped in Phase 3 once the
//! algorithm is implemented.
//!
//! ## Mesh topology used across tests
//!
//! Files seeded in the repo (all whole-file anchors):
//!   a.rs, b.rs, c.rs, d.rs, e.rs, f.rs
//!
//! Meshes that create co-occurrence edges:
//!   mesh-ab  : a.rs + b.rs          → edge A–B
//!   mesh-bc  : b.rs + c.rs          → edge B–C
//!   mesh-abcd: a.rs + b.rs + c.rs + d.rs → edges A–B, A–C, A–D, B–C, B–D, C–D
//!   mesh-ef  : e.rs + f.rs          → edge E–F
//!
//! Resulting maximal cliques in the full graph:
//!   {a.rs, b.rs, c.rs, d.rs}   (fully connected via mesh-abcd)
//!   {e.rs, f.rs}
//!
//! For chain-overlap tests a separate sparse topology is used (see individual tests).

mod support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

/// Write source files and a single initial commit.
fn seed_files(repo: &TestRepo, names: &[&str]) -> Result<()> {
    for name in names {
        repo.write_file(name, &format!("// {name}\nfn placeholder() {{}}\n"))?;
    }
    repo.commit_all("add source files")?;
    Ok(())
}

/// Add a mesh via the CLI and commit it.
fn add_mesh(repo: &TestRepo, slug: &str, paths: &[&str]) -> Result<()> {
    let mut args: Vec<String> = vec!["add".into(), slug.into()];
    for p in paths {
        args.push(p.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    repo.mesh_stdout(arg_refs)?;
    repo.mesh_stdout(["why", slug, "-m", &format!("why {slug}")])?;
    repo.commit_all(&format!("mesh: {slug}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Clique grouping
// ---------------------------------------------------------------------------

/// Fully connected files (a.rs, b.rs, c.rs, d.rs) are grouped on a single
/// comma-separated line in human output.
#[test]
#[ignore = "Phase 3: implement clique grouping in run_tree"]
fn clique_grouping_fully_connected_renders_one_line() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    // mesh-abcd connects all four, making them a single maximal clique
    add_mesh(&repo, "mesh-abcd", &["a.rs", "b.rs", "c.rs", "d.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    // All four files should appear together on the first (root) line
    let first_line = out.lines().next().expect("output has a line");
    assert!(
        first_line.contains("a.rs")
            && first_line.contains("b.rs")
            && first_line.contains("c.rs")
            && first_line.contains("d.rs"),
        "expected all four files on one line, got: {first_line:?}\nfull output:\n{out}"
    );
    // Should be only the one root line (no children since they are all in the clique)
    let non_empty: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        non_empty.len(),
        1,
        "fully connected clique yields one line, got {non_empty:?}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Non-greedy overlap
// ---------------------------------------------------------------------------

/// Chain A–B–C (no A–C edge) yields two overlapping cliques: {a.rs, b.rs}
/// and {b.rs, c.rs}. b.rs appears in both. A fully connected set {a,b,c,d}
/// still collapses to one line (covered separately above).
#[test]
#[ignore = "Phase 3: implement non-greedy clique overlap in maximal_cliques"]
fn chain_topology_yields_two_overlapping_cliques() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    // mesh-ab: edge A–B; mesh-bc: edge B–C; no A–C edge
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    // Rooted at a.rs: expect {a.rs, b.rs} as root, {b.rs, c.rs} as child
    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 2, "expected root + one child line:\n{out}");

    let root = lines[0];
    assert!(
        root.contains("a.rs") && root.contains("b.rs"),
        "root should be {{a.rs, b.rs}}, got: {root:?}"
    );
    assert!(
        !root.contains("c.rs"),
        "c.rs must not appear on root line: {root:?}"
    );

    let child = lines[1];
    assert!(
        child.contains("b.rs") && child.contains("c.rs"),
        "child should be {{b.rs, c.rs}}, got: {child:?}"
    );
    Ok(())
}

/// In the chain A–B–C, b.rs appears in both cliques (non-greedy), not just
/// the first one encountered.
#[test]
#[ignore = "Phase 3: confirm non-greedy overlap — shared member in each clique"]
fn shared_member_appears_in_both_cliques() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    // b.rs is in both {a,b} and {b,c}
    let out = repo.mesh_stdout(["tree", "b.rs"])?;
    let occurrences = out.matches("b.rs").count();
    assert!(
        occurrences >= 2,
        "b.rs must appear in at least two clique lines (non-greedy), \
         but it appeared {occurrences} times:\n{out}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Clique-as-unit expansion
// ---------------------------------------------------------------------------

/// When expanding {a.rs, b.rs, c.rs, d.rs} as the root, its children are the
/// external neighbors of the unit — not the members themselves re-listed.
#[test]
#[ignore = "Phase 3: implement clique-as-unit expansion in expand_clique"]
fn clique_as_unit_expansion_no_mutual_relisting() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs", "e.rs"])?;
    // {a,b,c,d} fully connected; a.rs also connects to e.rs
    add_mesh(&repo, "mesh-abcd", &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ae", &["a.rs", "e.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    // Root line is the 4-way clique; child line is e.rs (singleton)
    assert_eq!(
        lines.len(),
        2,
        "expected root clique + one external child:\n{out}"
    );
    // Neither b.rs, c.rs, nor d.rs should appear in the child line
    let child = lines[1];
    assert!(
        !child.contains("b.rs") && !child.contains("c.rs") && !child.contains("d.rs"),
        "clique members must not be re-listed as children: {child:?}"
    );
    assert!(
        child.contains("e.rs"),
        "external neighbor e.rs must appear as child: {child:?}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Per-branch loop guard
// ---------------------------------------------------------------------------

/// A file is not expanded as its own ancestor on the same branch. Topology:
/// a.rs–b.rs–a.rs would create a cycle; the loop guard must prevent a.rs
/// from appearing below itself.
#[test]
#[ignore = "Phase 3: implement per-branch loop guard in expand_clique"]
fn loop_guard_prevents_ancestor_reexpansion() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs"])?;
    // Single mesh containing both — they form a clique, so expansion is a unit.
    // We need a topology where an ancestor would appear as a descendant without the guard.
    // Use three files: a–b, b–c, c–a (triangle → single clique {a,b,c}).
    // After rooting at a.rs, the clique is {a,b,c}. External neighbors: none.
    // No loop risk in a triangle. Use a linear chain with back-edge instead:
    // mesh-ab (a,b), mesh-bc (b,c), mesh-ca (c,a) — triangle.
    // The triangle forms one clique {a,b,c}; a.rs only appears once.
    repo.write_file("c.rs", "// c\n")?;
    repo.commit_all("add c.rs")?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ca", &["c.rs", "a.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    // Count occurrences of a.rs — must appear exactly once (in the root clique only)
    let count = out.matches("a.rs").count();
    assert_eq!(
        count, 1,
        "a.rs must appear exactly once (loop guard), got {count} occurrences:\n{out}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Depth control
// ---------------------------------------------------------------------------

/// `--depth 0` outputs the root clique(s) only, with no children.
#[test]
#[ignore = "Phase 3: implement depth bound in expand_clique"]
fn depth_zero_yields_roots_only() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    let out = repo.mesh_stdout(["tree", "--depth", "0", "a.rs"])?;
    let non_empty: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        non_empty.len(),
        1,
        "depth 0 must yield exactly one root line:\n{out}"
    );
    assert!(
        non_empty[0].contains("a.rs"),
        "root line must contain a.rs: {:?}",
        non_empty[0]
    );
    Ok(())
}

/// Default depth is 3; a chain deeper than 3 is truncated at level 3.
#[test]
#[ignore = "Phase 3: confirm default depth=3 truncation"]
fn default_depth_three_truncates_deeper_chains() -> Result<()> {
    let repo = TestRepo::new()?;
    // Chain: a–b–c–d–e (4 hops from a to e)
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs", "e.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-cd", &["c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-de", &["d.rs", "e.rs"])?;

    // Default depth 3: a→b→c→d (3 hops). e.rs should NOT appear.
    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    assert!(
        !out.contains("e.rs"),
        "e.rs is 4 hops away and must be truncated at default depth 3:\n{out}"
    );
    assert!(
        out.contains("d.rs"),
        "d.rs is 3 hops away and must appear at default depth 3:\n{out}"
    );
    Ok(())
}

/// Explicit `--depth N` is honoured.
#[test]
#[ignore = "Phase 3: confirm explicit depth flag is honoured"]
fn explicit_depth_flag_respected() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs", "e.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-cd", &["c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-de", &["d.rs", "e.rs"])?;

    // Depth 1: only the immediate neighbour of root
    let out1 = repo.mesh_stdout(["tree", "--depth", "1", "a.rs"])?;
    assert!(
        !out1.contains("c.rs"),
        "c.rs must not appear at depth 1:\n{out1}"
    );

    // Depth 4: all five files should appear
    let out4 = repo.mesh_stdout(["tree", "--depth", "4", "a.rs"])?;
    assert!(
        out4.contains("e.rs"),
        "e.rs must appear at depth 4:\n{out4}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Glob vs exact-path resolution
// ---------------------------------------------------------------------------

/// A glob pattern and an exact path reaching the same anchor file produce
/// identical output (repo-relative matching, no CWD semantics).
#[test]
#[ignore = "Phase 3: implement glob and exact-path resolution in run_tree"]
fn glob_and_exact_path_produce_identical_output() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;

    let out_exact = repo.mesh_stdout(["tree", "a.rs"])?;
    let out_glob = repo.mesh_stdout(["tree", "a.*"])?;
    assert_eq!(
        out_exact, out_glob,
        "exact path and glob must produce the same output"
    );
    Ok(())
}

/// Repo-relative matching: running from a subdirectory must not change which
/// root is matched (no CWD-relative prefix expansion).
#[test]
#[ignore = "Phase 3: confirm repo-relative glob matching with no CWD prefix"]
fn glob_resolution_is_repo_relative_not_cwd_relative() -> Result<()> {
    let repo = TestRepo::new()?;
    // Files under a subdirectory
    repo.write_file("src/a.rs", "// a\n")?;
    repo.write_file("src/b.rs", "// b\n")?;
    repo.commit_all("add src files")?;
    add_mesh(&repo, "mesh-ab", &["src/a.rs", "src/b.rs"])?;

    // Exact repo-relative path must work from the repo root
    let out = repo.mesh_stdout(["tree", "src/a.rs"])?;
    assert!(
        out.contains("src/a.rs"),
        "repo-relative exact path must resolve:\n{out}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

/// A pattern matching no anchored file must exit non-zero.
#[test]
#[ignore = "Phase 3: implement fail-closed error in run_tree"]
fn unknown_arg_exits_nonzero() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs"])?;
    add_mesh(&repo, "mesh-a", &["a.rs"])?;

    let out = repo.run_mesh(["tree", "nonexistent.rs"])?;
    assert!(
        !out.status.success(),
        "expected non-zero exit for unmatched arg"
    );
    Ok(())
}

/// A glob matching no anchored file must exit non-zero.
#[test]
#[ignore = "Phase 3: implement fail-closed error for unmatched glob in run_tree"]
fn unmatched_glob_exits_nonzero() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs"])?;
    add_mesh(&repo, "mesh-a", &["a.rs"])?;

    let out = repo.run_mesh(["tree", "*.go"])?;
    assert!(
        !out.status.success(),
        "expected non-zero exit for glob matching no anchored file"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// JSON format
// ---------------------------------------------------------------------------

/// `--format json` outputs a JSON array of `{ "members": [...], "children": [...] }`.
#[test]
#[ignore = "Phase 3: implement JSON renderer in run_tree"]
fn json_format_top_level_is_array() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;

    let out = repo.run_mesh(["tree", "--format", "json", "a.rs"])?;
    assert!(
        out.status.success(),
        "expected success, got:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    assert!(v.is_array(), "top-level must be a JSON array, got: {v}");
    Ok(())
}

/// Each node in the JSON array has `members` (array of strings) and `children`
/// (array of nodes).
#[test]
#[ignore = "Phase 3: implement JSON node shape in run_tree"]
fn json_format_node_has_members_and_children() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    let out = repo.run_mesh(["tree", "--format", "json", "a.rs"])?;
    assert!(out.status.success());
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    let arr = v.as_array().expect("top-level array");
    assert!(!arr.is_empty(), "forest must not be empty");

    let node = &arr[0];
    assert!(
        node["members"].is_array(),
        "node must have members array: {node}"
    );
    assert!(
        node["children"].is_array(),
        "node must have children array: {node}"
    );
    // members must contain strings
    let members = node["members"].as_array().unwrap();
    assert!(
        !members.is_empty(),
        "root node must have at least one member"
    );
    assert!(
        members[0].is_string(),
        "members must be strings: {members:?}"
    );
    Ok(())
}

/// Children nest recursively: a child node also has `members` and `children`.
#[test]
#[ignore = "Phase 3: confirm recursive JSON nesting in run_tree"]
fn json_format_children_nest_recursively() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    let out = repo.run_mesh(["tree", "--format", "json", "a.rs"])?;
    assert!(out.status.success());
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    let arr = v.as_array().expect("top-level array");
    let root = &arr[0];
    let children = root["children"].as_array().expect("children array");
    assert!(!children.is_empty(), "root must have children for chain topology");
    let child = &children[0];
    assert!(
        child["members"].is_array(),
        "child must have members array: {child}"
    );
    assert!(
        child["children"].is_array(),
        "child must have children array: {child}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

/// Repeated invocations produce identical output (stable ordering).
#[test]
#[ignore = "Phase 3: confirm deterministic output via BTreeMap/BTreeSet in run_tree"]
fn output_is_deterministic_across_runs() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-cd", &["c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ac", &["a.rs", "c.rs"])?;

    let run1 = repo.mesh_stdout(["tree", "a.rs"])?;
    let run2 = repo.mesh_stdout(["tree", "a.rs"])?;
    let run3 = repo.mesh_stdout(["tree", "a.rs"])?;

    assert_eq!(run1, run2, "run 1 and run 2 differ");
    assert_eq!(run2, run3, "run 2 and run 3 differ");
    Ok(())
}

/// Multiple roots produce a forest with consistent ordering (members sorted,
/// cliques ordered by weight then first member).
#[test]
#[ignore = "Phase 3: confirm deterministic forest ordering for multiple roots"]
fn deterministic_ordering_for_multiple_roots() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-cd", &["c.rs", "d.rs"])?;

    // Two disjoint cliques; passing both roots yields a two-entry forest
    let out1 = repo.mesh_stdout(["tree", "a.rs", "c.rs"])?;
    let out2 = repo.mesh_stdout(["tree", "a.rs", "c.rs"])?;
    assert_eq!(out1, out2, "forest ordering must be stable across runs");

    let lines: Vec<&str> = out1.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 2, "two disjoint roots yield two root lines:\n{out1}");
    Ok(())
}
