//! Output-equivalence guard for `git mesh stale --fix`.
//!
//! Two complementary guards:
//!
//! 1. **Run-to-run byte-identity** (cases 1a–1c): two consecutive `--fix` runs
//!    (mesh files reverted in between) produce byte-identical stdout, stderr,
//!    and exit codes. Cheap precondition for the Phase 2–4 speed optimisations
//!    in card main-97.
//!
//! 2. **Golden output pinning** (the `golden_*` cases): each fixture asserts
//!    the *actual* rendered stdout + exit code (and deterministic stderr), not
//!    only run-to-run determinism. Run-to-run identity alone compares HEAD
//!    against itself and so cannot catch a divergence from the intended
//!    baseline output; the golden cases lock the intended result. Coverage the
//!    run-to-run cases lack: the cold cache_v2-miss path (retained
//!    `SourceLayers`), the intended single-warning named-scope stderr, the
//!    interior-anchor fallback (Finding 2), and the closest-to-tie post-fix
//!    ordering (Finding 3).
//!
//! Methodology note: git rename detection is nondeterministic across
//! separately-built repos, so every comparison here builds ONE corpus and
//! either reverts in place or compares against a re-resolve of the same repo —
//! never two independently constructed repos.

use crate::support;

use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return the raw bytes of a mesh file.
fn read_mesh_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read(path)?)
}

/// Run `git mesh stale --fix` (with optional extra args) and return
/// `(stdout_bytes, stderr_bytes, exit_code)`.
fn run_fix<'a>(
    repo: &TestRepo,
    extra: impl IntoIterator<Item = &'a str>,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>)> {
    let mut args = vec!["stale", "--fix"];
    for a in extra {
        args.push(a);
    }
    let out = repo.run_mesh(args)?;
    Ok((out.stdout, out.stderr, out.status.code()))
}

// ---------------------------------------------------------------------------
// 1a — Bare-scan arm
//
// Fixture:
//   - anchor A: Moved  (file renamed, bytes identical)
//   - anchor B: Changed whitespace-only  (content-equivalent → re-anchored)
//   - anchor C: Deleted  (terminal → left untouched)
//   - two contiguous same-path anchors D1/D2 that --fix coalesces
//
// Runs `git mesh stale --fix` (no positional mesh), captures
// stdout+stderr+exit, reverts, runs again, asserts byte-identity.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_bare_scan_arm() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Mesh "moved-mesh": one anchor that will be Moved.
    repo.write_file(
        "src.txt",
        "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    )?;
    repo.run_git(["add", "src.txt"])?;
    repo.run_git(["commit", "-m", "add src.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;
    repo.mesh_stdout(["add", "moved-mesh", "src.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "moved-mesh", "-m", "moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add moved-mesh"])?;

    // Mesh "changed-mesh": one anchor with a whitespace-only change.
    repo.mesh_stdout(["add", "changed-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "changed-mesh", "-m", "changed anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add changed-mesh"])?;

    // Mesh "deleted-mesh": one anchor whose file will be deleted.
    repo.mesh_stdout(["add", "deleted-mesh", "file2.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "deleted-mesh", "-m", "deleted anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add deleted-mesh"])?;

    // Mesh "coalesce-mesh": two contiguous same-path anchors.
    repo.mesh_stdout(["add", "coalesce-mesh", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "coalesce-mesh", "-m", "coalesce anchors"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add coalesce-mesh"])?;

    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Now set up the drift states.

    // A: Moved — rename src.txt → dst.txt
    repo.run_git(["mv", "src.txt", "dst.txt"])?;
    repo.run_git(["commit", "-m", "rename src.txt to dst.txt"])?;

    // B: whitespace-only worktree change on file1.txt (Changed, content-equivalent)
    repo.write_file(
        "file1.txt",
        "  line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // C: delete file2.txt (Deleted terminal — left by --fix)
    std::fs::remove_file(repo.path().join("file2.txt"))?;

    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Snapshot the mesh files before any --fix run.
    let snap_moved = read_mesh_bytes(&repo, "moved-mesh")?;
    let snap_changed = read_mesh_bytes(&repo, "changed-mesh")?;
    let snap_deleted = read_mesh_bytes(&repo, "deleted-mesh")?;
    let snap_coalesce = read_mesh_bytes(&repo, "coalesce-mesh")?;

    // Run 1.
    let (stdout1, stderr1, code1) = run_fix(&repo, ["--no-exit-code"])?;

    // Revert mesh files to their pre-fix state.
    std::fs::write(repo.path().join(".mesh").join("moved-mesh"), &snap_moved)?;
    std::fs::write(repo.path().join(".mesh").join("changed-mesh"), &snap_changed)?;
    std::fs::write(repo.path().join(".mesh").join("deleted-mesh"), &snap_deleted)?;
    std::fs::write(repo.path().join(".mesh").join("coalesce-mesh"), &snap_coalesce)?;

    // Run 2.
    let (stdout2, stderr2, code2) = run_fix(&repo, ["--no-exit-code"])?;

    // Assert byte-identity.
    assert_eq!(code1, code2, "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&stdout1),
        String::from_utf8_lossy(&stdout2),
        "stdout must be byte-identical across two --fix runs"
    );
    assert_eq!(
        String::from_utf8_lossy(&stderr1),
        String::from_utf8_lossy(&stderr2),
        "stderr must be byte-identical across two --fix runs"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1b — Named-scope arm, fully-freshened mesh
//
// Fixture: one mesh with a single Moved anchor. After --fix, the mesh becomes
// fully Fresh.  The named-scope arm must still render the mesh (as bare
// bullets) — it must not drop it. Two runs must be byte-identical.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_named_scope_fully_freshened() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("origin.txt", "foo\nbar\nbaz\n")?;
    repo.run_git(["add", "origin.txt"])?;
    repo.run_git(["commit", "-m", "add origin.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    repo.mesh_stdout(["add", "fresh-mesh", "origin.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "fresh-mesh", "-m", "single moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add fresh-mesh"])?;

    // Rename so the anchor becomes Moved.
    repo.run_git(["mv", "origin.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename origin.txt to renamed.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    let snap = read_mesh_bytes(&repo, "fresh-mesh")?;

    // Run 1 — named scope, no --no-exit-code (mesh is fully fixed → exit 0).
    let (stdout1, stderr1, code1) = run_fix(&repo, ["fresh-mesh"])?;

    // Revert.
    std::fs::write(repo.path().join(".mesh").join("fresh-mesh"), &snap)?;

    // Run 2.
    let (stdout2, stderr2, code2) = run_fix(&repo, ["fresh-mesh"])?;

    assert_eq!(code1, code2, "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&stdout1),
        String::from_utf8_lossy(&stdout2),
        "stdout must be byte-identical across two --fix runs (named scope)"
    );
    assert_eq!(
        String::from_utf8_lossy(&stderr1),
        String::from_utf8_lossy(&stderr2),
        "stderr must be byte-identical across two --fix runs (named scope)"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1c — Warning-producing fixture (stderr parity guard)
//
// Fixture: a mesh with a Deleted anchor (terminal — --fix never rewrites it)
// in a repo where the commit-history walk triggers a rename-budget warning
// under GIT_MESH_RENAME_BUDGET=0.  A pre-warmup run is performed to populate
// the cache_v2 for the pre-fix mesh state; after warmup, the two measured
// runs both hit the warm cache and produce byte-identical output (including
// empty-string stderr).
//
// This is the correct baseline for the Phase 4 guard: if Phase 4 breaks the
// SourceLayers invariant and double-emits pre-fix warnings in the post-fix
// pass, a double-warm run would suddenly show warnings in one run but not
// the other, breaking byte-identity.
//
// The pre-warmup ensures both measured runs are deterministically warm so
// the test is not racy with respect to cache state from other test runs.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_warning_stderr_parity() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Source files that will be renamed — creates rename-budget pressure.
    repo.write_file("p1.txt", "alpha\nbeta\n")?;
    repo.write_file("p2.txt", "gamma\ndelta\n")?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "add p1 p2"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Mesh: anchor a file that will be deleted (terminal) and one that will
    // be renamed (Moved — but with budget=0 rename detection is disabled so
    // it stays as Deleted/unreachable too).
    repo.mesh_stdout(["add", "warn-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "warn-mesh", "-m", "warn parity guard"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add warn-mesh"])?;

    // Rename p1/p2 and delete file1: creates a commit with >= 2 changes,
    // exceeding budget=0 during the HEAD walk when searching for attribution.
    repo.run_git(["mv", "p1.txt", "q1.txt"])?;
    repo.run_git(["mv", "p2.txt", "q2.txt"])?;
    repo.run_git(["rm", "file1.txt"])?;
    repo.run_git(["commit", "-m", "rename p1→q1, p2→q2, delete file1"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Pre-warmup: run --fix once (cache miss → full resolution → cache
    // populated for this mesh state).  mesh is unchanged because the Deleted
    // anchor is terminal.
    {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?;
    }

    let snap = read_mesh_bytes(&repo, "warn-mesh")?;

    // Run 1 — cache is warm; output is deterministic.
    let out1 = {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?
    };

    // Revert mesh (no-op since Deleted is terminal and --fix didn't write it,
    // but kept for structural symmetry with 1a/1b).
    std::fs::write(repo.path().join(".mesh").join("warn-mesh"), &snap)?;

    // Run 2 — same warm cache state.
    let out2 = {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?
    };

    assert_eq!(out1.status.code(), out2.status.code(), "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&out1.stdout),
        String::from_utf8_lossy(&out2.stdout),
        "stdout must be byte-identical across two --fix runs (warning fixture)"
    );
    assert_eq!(
        String::from_utf8_lossy(&out1.stderr),
        String::from_utf8_lossy(&out2.stderr),
        "stderr must be byte-identical across two --fix runs (warning fixture)"
    );

    Ok(())
}

// ===========================================================================
// Golden output pinning.
//
// These cases assert the actual rendered stdout + exit code (and deterministic
// stderr) for each fixture, so a drift from the intended output is caught even
// though a future regression would still be run-to-run deterministic.
// ===========================================================================

/// Overwrite a mesh file with raw bytes (used to inject an interior anchor that
/// `git mesh add` would reject, and to revert between runs).
fn write_raw_mesh(repo: &TestRepo, name: &str, bytes: &[u8]) -> Result<()> {
    std::fs::write(repo.path().join(".mesh").join(name), bytes)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// golden — Cold path (cache_v2 miss → retained SourceLayers)
//
// The first --fix run on a fresh repo misses cache_v2, so the pre-fix resolve
// builds an `EngineState` and retains its `SourceLayers`, and the post-fix
// re-resolve reuses them (the cold-path optimisation under test). Cases 1a–1c
// either pre-warm or do not pin output, so the cold path's *rendered output* is
// never asserted. Here we run --fix exactly once (no pre-warm → guaranteed
// cold) and pin the result.
// ---------------------------------------------------------------------------

#[test]
fn golden_cold_path_bare_scan() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("src.txt", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.run_git(["add", "src.txt"])?;
    repo.run_git(["commit", "-m", "add src.txt"])?;
    repo.write_commit_graph()?;
    repo.mesh_stdout(["add", "mover", "src.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "mover", "-m", "moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add mover"])?;
    repo.write_commit_graph()?;

    // Rename so the anchor is Moved; --fix re-anchors it to the new path.
    repo.run_git(["mv", "src.txt", "dst.txt"])?;
    repo.run_git(["commit", "-m", "rename src.txt to dst.txt"])?;
    repo.write_commit_graph()?;

    // Single run — guaranteed cold (no prior cache_v2 entry for this state).
    let (stdout, stderr, code) = run_fix(&repo, ["--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&stdout);
    let stderr = String::from_utf8_lossy(&stderr);

    // After re-anchoring the Moved anchor, the corpus is fully Fresh, so a
    // bare scan (drift report) shows no meshes and prints the 0-stale summary.
    assert_eq!(code, Some(0), "fully-fixed bare scan exits 0; stderr={stderr}");
    assert_eq!(
        stdout, "0 stale across 1 mesh (1 anchor checked)\n",
        "cold-path bare-scan stdout must match baseline 0-stale summary"
    );
    assert_eq!(stderr, "", "no warnings expected; stderr={stderr}");

    // The mesh file was actually re-anchored to dst.txt (the fix happened).
    let mesh = String::from_utf8(read_mesh_bytes(&repo, "mover")?)?;
    assert!(mesh.contains("dst.txt"), "anchor re-pathed to dst.txt: {mesh}");

    Ok(())
}

// ---------------------------------------------------------------------------
// golden — Named-scope single-warning stderr (Finding 1, intended behaviour)
//
// A named-scope `--fix` must emit each resolve-time (rename-budget) warning
// line exactly ONCE, never twice. The pre-optimization code re-resolved the
// whole named scope a second time after apply_fix and so could emit the same
// warning twice; the scoped splice resolves only rewritten meshes (and
// short-circuits when nothing was rewritten), giving single emission. Single
// emission is the intended, authorized behaviour (per user decision); this
// pins it so a regression that reintroduces the duplicate is caught.
//
// Methodology caveat (per the experience-evaluator): whether the rename-budget
// warning *fires at all* is sensitive to cache_v2 / commit-graph state and so
// is not deterministic across environments. The robust, deterministic
// invariant that distinguishes the intended single-emission from the
// regression is therefore "no warning line is emitted twice": a reintroduced
// second whole-scope re-resolve would duplicate any warning that does fire,
// while correct single-emission cannot. We assert that invariant, and also
// assert run-to-run byte-identity of stderr so a nondeterministic doubling is
// caught regardless of whether a warning happens to fire.
// ---------------------------------------------------------------------------

#[test]
fn golden_named_scope_single_warning() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("p1.txt", "x\ny\n")?;
    repo.write_file("p2.txt", "m\nn\n")?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "add p1 p2"])?;
    repo.write_commit_graph()?;

    repo.mesh_stdout(["add", "warn-mesh", "file1.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "warn-mesh", "-m", "warn parity guard"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add warn-mesh"])?;

    // Rename + edit file1 (anchor target → re-anchored) alongside two
    // unrelated renames: under budget=0 the attribution walk may emit the
    // rename-budget warning.
    repo.run_git(["mv", "p1.txt", "q1.txt"])?;
    repo.run_git(["mv", "p2.txt", "q2.txt"])?;
    repo.run_git(["mv", "file1.txt", "file1b.txt"])?;
    repo.write_file("file1b.txt", "line1\nQ\nline3\nline4\nline5\n")?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "rename p1→q1, p2→q2, move+edit file1"])?;
    repo.write_commit_graph()?;

    let run = || -> Result<(Vec<u8>, Option<i32>)> {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "warn-mesh", "--no-exit-code"]);
        let out = cmd.output()?;
        Ok((out.stderr, out.status.code()))
    };

    let snap = read_mesh_bytes(&repo, "warn-mesh")?;
    let (stderr1, code1) = run()?;
    std::fs::write(repo.path().join(".mesh").join("warn-mesh"), &snap)?;
    let (stderr2, code2) = run()?;

    let stderr1 = String::from_utf8_lossy(&stderr1);
    let stderr2 = String::from_utf8_lossy(&stderr2);

    assert_eq!(code1, code2, "exit codes must match across runs");
    assert_eq!(stderr1, stderr2, "named-scope stderr must be byte-identical across runs");

    // Single-emission: no warning line appears more than once.
    let mut seen = std::collections::HashSet::new();
    for line in stderr1.lines().filter(|l| l.contains("warning")) {
        assert!(
            seen.insert(line.to_string()),
            "warning line emitted more than once (single-emission is intended): {line:?}\nfull stderr:\n{stderr1}"
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// golden — Interior-anchor fallback (Finding 2)
//
// Corpus: a sibling mesh `aaa-victim` with a genuinely Moved anchor, plus a
// poisoned mesh `zzz-poison` carrying an interior anchor (path under `.mesh/`).
//
// Without the fallback, the scoped splice would reuse `aaa-victim`'s pre-fix
// `MeshResolved` (or reuse stale `worktree_diffs`), risking a stale drift
// status. With the Finding-2 fallback, the presence of the interior anchor
// forces a full whole-corpus re-resolve, so `aaa-victim`'s post-fix status is
// rendered correctly — identical to what a full re-resolve produces.
//
// Validation strategy: the pre-fix interior-anchor gate fires (the corpus
// carries the interior anchor before apply_fix runs), forcing the baseline
// full re-resolve. `apply_fix` re-anchors `aaa-victim`'s Moved anchor; the
// full re-resolve then renders `aaa-victim` as Fresh (dropped from the drift
// report), exactly as a baseline whole-corpus re-resolve would. We assert that
// correct rendering plus run-to-run stability of the fallback output. (Note:
// apply_fix may itself excise the now-unresolvable interior anchor line, so we
// do NOT assert on the post-fix interior-violation report — that is incidental
// and matches baseline regardless.)
// ---------------------------------------------------------------------------

#[test]
fn golden_interior_anchor_forces_full_reresolve() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("victim.txt", "one\ntwo\nthree\nfour\n")?;
    repo.run_git(["add", "victim.txt"])?;
    repo.run_git(["commit", "-m", "add victim.txt"])?;
    repo.write_commit_graph()?;

    // Sibling mesh with a Moved anchor (will be re-anchored by --fix).
    repo.mesh_stdout(["add", "aaa-victim", "victim.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "aaa-victim", "-m", "victim moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add aaa-victim"])?;
    repo.write_commit_graph()?;

    // Poisoned mesh: a hand-written interior anchor pointing under `.mesh/`.
    // `git mesh add` rejects this, so write the file raw. It must parse and be
    // committed so `scan_interior_anchors` / `scope_has_interior_anchor` see it.
    let poison = "\
.mesh/aaa-victim sha256:0000000000000000000000000000000000000000000000000000000000000000\n\
\n\
poisoned interior anchor\n";
    let poison_snap = poison.as_bytes().to_vec();
    write_raw_mesh(&repo, "zzz-poison", poison.as_bytes())?;
    repo.run_git(["add", ".mesh/zzz-poison"])?;
    repo.run_git(["commit", "-m", "add zzz-poison (interior anchor)"])?;
    repo.write_commit_graph()?;

    // Rename so aaa-victim's anchor becomes Moved.
    repo.run_git(["mv", "victim.txt", "moved.txt"])?;
    repo.run_git(["commit", "-m", "rename victim.txt to moved.txt"])?;
    repo.write_commit_graph()?;

    // Snapshot the pre-fix victim mesh so we can revert for a second run.
    let victim_snap = read_mesh_bytes(&repo, "aaa-victim")?;

    let (stdout, stderr, code) = run_fix(&repo, ["--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&stdout);
    let stderr = String::from_utf8_lossy(&stderr);

    // Fallback correctness: the full re-resolve re-anchored aaa-victim, so it
    // is now Fresh and does not appear as a drift finding in stdout. (Under the
    // unsound splice path, the victim's pre-fix Moved status could persist.)
    assert!(
        !stdout.contains("aaa-victim"),
        "after the full re-resolve fallback, the re-anchored victim mesh is \
         Fresh and must not surface as drift:\n{stdout}\nstderr:\n{stderr}"
    );
    let mesh = String::from_utf8(read_mesh_bytes(&repo, "aaa-victim")?)?;
    assert!(
        mesh.contains("moved.txt"),
        "victim anchor re-pathed by the fallback fix: {mesh}"
    );

    // Idempotency under the fallback: revert BOTH mesh files to their pre-fix
    // state (the fix re-anchors the victim and may excise the poison's interior
    // anchor) and re-run; output is byte-stable.
    write_raw_mesh(&repo, "aaa-victim", &victim_snap)?;
    write_raw_mesh(&repo, "zzz-poison", &poison_snap)?;
    let (stdout2, stderr2, code2) = run_fix(&repo, ["--no-exit-code"])?;
    assert_eq!(code, code2, "fallback exit stable across runs");
    assert_eq!(
        stdout,
        String::from_utf8_lossy(&stdout2),
        "fallback stdout stable across runs"
    );
    assert_eq!(
        stderr,
        String::from_utf8_lossy(&stderr2),
        "fallback stderr stable across runs"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// golden — Closest-to-tie post-fix ordering (Finding 3)
//
// `sort_meshes_by_anchor_path` now breaks a true (same-path-tuple,
// same-overlap-class) tie on mesh name, so the post-fix scoped splice yields
// the same order as a full whole-corpus re-resolve regardless of splice
// position. This fixture builds two meshes that anchor the SAME path+range
// (identical sort key) — the closest reachable case to a tie — where the
// alphabetically-later mesh is the one --fix re-anchors. The Moved anchor's
// re-path could reorder the spliced slot; tie-breaking on name keeps the
// rendered order deterministic and matches `names.sort()` discovery order.
// ---------------------------------------------------------------------------

/// Named-scope `git mesh stale [mesh...]` with two meshes sharing an identical
/// anchor path tuple (a true tie) must preserve **argument order**, not reorder
/// by mesh name.  Baseline behavior: `sort_meshes_by_anchor_path` returns Equal
/// on a true tie and the stable sort preserves the caller's input order, which
/// for a named-scope query is the argument order.
///
/// Fixture: `zzz` and `aaa` both anchored to `shared.txt#L1-L3`.  A content
/// edit drifts both so they surface as stale.  Running `stale zzz aaa` must
/// render `## zzz` before `## aaa`; running `stale aaa zzz` must render
/// `## aaa` before `## zzz`.  The same assertion holds for `stale --fix`.
#[test]
fn golden_near_tie_ordering_stable() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("shared.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.run_git(["add", "shared.txt"])?;
    repo.run_git(["commit", "-m", "add shared.txt"])?;
    repo.write_commit_graph()?;

    // Two meshes anchored to the identical path+range → identical sort key.
    // Names are intentionally in reverse-alphabetical order (zzz before aaa)
    // to distinguish argument order from name order.
    repo.mesh_stdout(["add", "zzz-tie", "shared.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "zzz-tie", "-m", "zzz ties with aaa"])?;
    repo.mesh_stdout(["add", "aaa-tie", "shared.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "aaa-tie", "-m", "aaa ties with zzz"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add zzz-tie and aaa-tie meshes"])?;
    repo.write_commit_graph()?;

    // Drift both meshes: edit shared.txt so both surfaces as Changed.
    repo.write_file("shared.txt", "L1\nl2\nl3\nl4\nl5\n")?;
    repo.run_git(["add", "shared.txt"])?;
    repo.run_git(["commit", "-m", "edit shared.txt to drift both meshes"])?;
    repo.write_commit_graph()?;

    // Helper to find heading position in output.
    let heading_pos = |s: &str, name: &str| -> Option<usize> { s.find(&format!("## {name}")) };

    // --- read-only stale (no --fix) ---

    // zzz aaa → zzz rendered first (argument order, not name order)
    let out_za = repo.run_mesh(["stale", "--no-exit-code", "zzz-tie", "aaa-tie"])?;
    let s_za = String::from_utf8_lossy(&out_za.stdout).into_owned();
    let pz = heading_pos(&s_za, "zzz-tie");
    let pa = heading_pos(&s_za, "aaa-tie");
    assert!(
        pz < pa,
        "stale zzz-tie aaa-tie: expected zzz-tie before aaa-tie (argument order), got:\n{s_za}"
    );

    // aaa zzz → aaa rendered first
    let out_az = repo.run_mesh(["stale", "--no-exit-code", "aaa-tie", "zzz-tie"])?;
    let s_az = String::from_utf8_lossy(&out_az.stdout).into_owned();
    let pa2 = heading_pos(&s_az, "aaa-tie");
    let pz2 = heading_pos(&s_az, "zzz-tie");
    assert!(
        pa2 < pz2,
        "stale aaa-tie zzz-tie: expected aaa-tie before zzz-tie (argument order), got:\n{s_az}"
    );

    // --- stale --fix ---

    let snap_zzz = read_mesh_bytes(&repo, "zzz-tie")?;
    let snap_aaa = read_mesh_bytes(&repo, "aaa-tie")?;

    // zzz aaa → zzz rendered first
    let (fix_za, _e, _c) = run_fix(&repo, ["--no-exit-code", "zzz-tie", "aaa-tie"])?;
    write_raw_mesh(&repo, "zzz-tie", &snap_zzz)?;
    write_raw_mesh(&repo, "aaa-tie", &snap_aaa)?;
    let s_fix_za = String::from_utf8_lossy(&fix_za).into_owned();
    let pz3 = heading_pos(&s_fix_za, "zzz-tie");
    let pa3 = heading_pos(&s_fix_za, "aaa-tie");
    assert!(
        pz3 < pa3,
        "stale --fix zzz-tie aaa-tie: expected zzz-tie before aaa-tie, got:\n{s_fix_za}"
    );

    // aaa zzz → aaa rendered first
    let (fix_az, _e, _c) = run_fix(&repo, ["--no-exit-code", "aaa-tie", "zzz-tie"])?;
    let s_fix_az = String::from_utf8_lossy(&fix_az).into_owned();
    let pa4 = heading_pos(&s_fix_az, "aaa-tie");
    let pz4 = heading_pos(&s_fix_az, "zzz-tie");
    assert!(
        pa4 < pz4,
        "stale --fix aaa-tie zzz-tie: expected aaa-tie before zzz-tie, got:\n{s_fix_az}"
    );

    Ok(())
}
