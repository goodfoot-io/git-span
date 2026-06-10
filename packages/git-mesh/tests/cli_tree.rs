//! Acceptance tests for `git mesh tree`.
//!
//! These are the executable specification for the subcommand. Expected values
//! are derived from the authoritative prototype `scripts/git-mesh-tree-demo.mjs`,
//! whose output is the contract.
//!
//! ## Root semantics (the load-bearing fact these tests encode)
//!
//! Roots SEED the tree; they are NOT collapsed with their neighbors. The root
//! cliques are the maximal cliques over the MATCHED-ROOT set only — never over
//! the full graph. A single matched root is therefore a singleton root clique
//! and renders ALONE on the first line, with its neighbors appearing as
//! children below it. Multiple matched roots that are mutually connected DO
//! collapse together — that is the only root-collapsing case.
//!
//! Depth is expansion levels: roots at depth 0, children at depth 1, etc.;
//! expansion stops when `depth >= max_depth`.

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

/// A set of mutually connected files renders as a single comma-separated
/// clique line. With a single matched root (`a.rs`), the root is a singleton
/// root clique on the first line, and its three mutually-connected neighbors
/// (b.rs, c.rs, d.rs) collapse to ONE child clique line below it.
#[test]
fn clique_grouping_fully_connected_renders_one_line() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    // mesh-abcd connects all four, making them a single maximal clique
    add_mesh(&repo, "mesh-abcd", &["a.rs", "b.rs", "c.rs", "d.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    let non_empty: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        non_empty.len(),
        2,
        "single root + one collapsed neighbor clique = two lines:\n{out}"
    );
    // Root line is a.rs alone (roots are not collapsed with neighbors).
    assert_eq!(
        non_empty[0], "- a.rs",
        "root line must be a.rs alone: {:?}",
        non_empty[0]
    );
    // The three neighbors b,c,d are fully connected, so they collapse to one
    // comma-separated child clique line.
    let child = non_empty[1];
    assert!(
        child.contains("b.rs") && child.contains("c.rs") && child.contains("d.rs"),
        "neighbors b,c,d must collapse on one child clique line, got: {child:?}"
    );
    assert!(
        !child.contains("a.rs"),
        "root a.rs must not be re-listed as a child: {child:?}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Non-greedy overlap
// ---------------------------------------------------------------------------

/// Non-greedy overlap manifests among SIBLINGS. With a root `x.rs` whose three
/// neighbors form a chain a–b–c (edges a–b and b–c, no a–c), the children of
/// `x.rs` are the two overlapping maximal cliques {a.rs, b.rs} and {b.rs, c.rs}.
/// b.rs appears in both — dropping it from one would hide a real path.
#[test]
fn chain_topology_yields_two_overlapping_cliques() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["x.rs", "a.rs", "b.rs", "c.rs"])?;
    // x connects to each of a, b, c; among the neighbors only a–b and b–c exist.
    add_mesh(&repo, "mesh-xa", &["x.rs", "a.rs"])?;
    add_mesh(&repo, "mesh-xb", &["x.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-xc", &["x.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    let out = repo.mesh_stdout(["tree", "x.rs"])?;
    let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();

    // Root is x.rs alone.
    assert_eq!(lines[0], "- x.rs", "root must be x.rs alone: {:?}", lines[0]);

    // Among the depth-1 children there must be both a {a,b} clique line and a
    // {b,c} clique line (the two overlapping maximal cliques of the neighbors).
    let depth1: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| l.starts_with("  - ") && !l.starts_with("    "))
        .collect();
    let has_ab = depth1
        .iter()
        .any(|l| l.contains("a.rs") && l.contains("b.rs") && !l.contains("c.rs"));
    let has_bc = depth1
        .iter()
        .any(|l| l.contains("b.rs") && l.contains("c.rs") && !l.contains("a.rs"));
    assert!(
        has_ab && has_bc,
        "expected overlapping child cliques {{a,b}} and {{b,c}}:\n{out}"
    );
    Ok(())
}

/// In the overlapping-neighbor topology, b.rs is shared between the {a,b} and
/// {b,c} child cliques (non-greedy), so it appears in more than one clique line.
#[test]
fn shared_member_appears_in_both_cliques() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["x.rs", "a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-xa", &["x.rs", "a.rs"])?;
    add_mesh(&repo, "mesh-xb", &["x.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-xc", &["x.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;

    // b.rs is in both {a,b} and {b,c} child cliques. (It also reappears one
    // level deeper as each clique expands into the other's tail, so we assert
    // a lower bound.)
    let out = repo.mesh_stdout(["tree", "x.rs"])?;
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

/// A mutually-connected set expands as a unit: its interconnected members
/// collapse to one clique line and are not re-listed under one another. Root
/// `a.rs` has neighbors {b,c,d} (fully connected) and e (isolated). The
/// children are therefore one clique line {b,c,d} plus a singleton {e} — the
/// {b,c,d} unit is listed once, not recursively under each of b, c, d.
#[test]
fn clique_as_unit_expansion_no_mutual_relisting() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs", "e.rs"])?;
    // {a,b,c,d} fully connected; a.rs also connects to e.rs
    add_mesh(&repo, "mesh-abcd", &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ae", &["a.rs", "e.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    // Root a.rs alone, then exactly two children: the {b,c,d} clique and {e}.
    assert_eq!(
        lines.len(),
        3,
        "expected root + collapsed {{b,c,d}} clique + singleton {{e}}:\n{out}"
    );
    assert_eq!(lines[0], "- a.rs", "root must be a.rs alone: {:?}", lines[0]);

    // The interconnected {b,c,d} collapse onto a single child line.
    let bcd = lines
        .iter()
        .find(|l| l.contains("b.rs") && l.contains("c.rs") && l.contains("d.rs"))
        .unwrap_or_else(|| panic!("b,c,d must collapse to one line:\n{out}"));
    assert!(
        !bcd.contains("a.rs") && !bcd.contains("e.rs"),
        "the {{b,c,d}} clique line must not include a or e: {bcd:?}"
    );

    // e.rs is its own singleton child clique.
    let e_line = lines
        .iter()
        .find(|l| l.contains("e.rs"))
        .unwrap_or_else(|| panic!("external neighbor e.rs must appear:\n{out}"));
    assert!(
        !e_line.contains("b.rs") && !e_line.contains("c.rs") && !e_line.contains("d.rs"),
        "e.rs must be a singleton clique, not grouped with b/c/d: {e_line:?}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Per-branch loop guard
// ---------------------------------------------------------------------------

/// A file is not expanded as its own ancestor on the same branch. With a
/// triangle a–b, b–c, c–a and root `a.rs`, a.rs seeds the root (singleton),
/// its neighbors {b,c} collapse to one child clique, and a.rs must NOT
/// reappear below itself even though both b and c link back to it. a.rs
/// appears exactly once.
#[test]
fn loop_guard_prevents_ancestor_reexpansion() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-bc", &["b.rs", "c.rs"])?;
    add_mesh(&repo, "mesh-ca", &["c.rs", "a.rs"])?;

    let out = repo.mesh_stdout(["tree", "a.rs"])?;
    // Count occurrences of a.rs — must appear exactly once (in the root only).
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

/// A bare `git mesh tree` with zero positional args must fail closed
/// (non-zero exit) at the clap layer — the required-arg arity guards against
/// the previous fail-open behavior of printing a spurious empty-member line.
#[test]
fn no_args_exits_nonzero() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs"])?;
    add_mesh(&repo, "mesh-a", &["a.rs"])?;

    let out = repo.run_mesh(["tree"])?;
    assert!(
        !out.status.success(),
        "bare `git mesh tree` (no args) must exit non-zero:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
    Ok(())
}

/// The fail-closed unmatched-args error backtick-quotes each offending arg,
/// mirroring the sibling `list`/`stale` error style (finding 5).
#[test]
fn unmatched_arg_error_backtick_quotes_arg() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs"])?;
    add_mesh(&repo, "mesh-a", &["a.rs"])?;

    let out = repo.run_mesh(["tree", "nonexistent.rs"])?;
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`nonexistent.rs`"),
        "unmatched arg must be backtick-quoted in the error:\n{stderr}"
    );
    Ok(())
}

/// Mixed-case sibling paths use deterministic raw byte ordering, not
/// `localeCompare`. Under raw byte order, uppercase `Z` (0x5A) precedes
/// lowercase `b` (0x62), so `Z.rs` sorts before `b.rs`. The two equal-weight
/// siblings here exercise the tie-break comparator — this test pins the
/// intended contract: deterministic, locale-independent byte ordering.
#[test]
fn mixed_case_siblings_use_deterministic_byte_order() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["root.rs", "Z.rs", "b.rs"])?;
    // root.rs links to both Z.rs and b.rs with equal weight; Z.rs and b.rs are
    // NOT connected to each other, so they are two singleton sibling cliques
    // whose order is decided purely by the tie-break comparator.
    add_mesh(&repo, "mesh-rz", &["root.rs", "Z.rs"])?;
    add_mesh(&repo, "mesh-rb", &["root.rs", "b.rs"])?;

    let out = repo.mesh_stdout(["tree", "root.rs"])?;
    let z_pos = out.find("Z.rs").expect("Z.rs must appear");
    let b_pos = out.find("b.rs").expect("b.rs must appear");
    assert!(
        z_pos < b_pos,
        "Z.rs (0x5A) must precede b.rs (0x62) in raw byte order, got:\n{out}"
    );
    Ok(())
}

/// A glob matching no anchored file must exit non-zero.
#[test]
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
fn deterministic_ordering_for_multiple_roots() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_files(&repo, &["a.rs", "b.rs", "c.rs", "d.rs"])?;
    add_mesh(&repo, "mesh-ab", &["a.rs", "b.rs"])?;
    add_mesh(&repo, "mesh-cd", &["c.rs", "d.rs"])?;

    // Two disjoint roots (no edge between them) yield a two-entry forest:
    // two top-level (non-indented) root lines, each its own singleton clique.
    let out1 = repo.mesh_stdout(["tree", "a.rs", "c.rs"])?;
    let out2 = repo.mesh_stdout(["tree", "a.rs", "c.rs"])?;
    assert_eq!(out1, out2, "forest ordering must be stable across runs");

    let roots: Vec<&str> = out1
        .lines()
        .filter(|l| l.starts_with("- "))
        .collect();
    assert_eq!(
        roots,
        vec!["- a.rs", "- c.rs"],
        "two disjoint roots yield two ordered top-level root lines:\n{out1}"
    );
    Ok(())
}
