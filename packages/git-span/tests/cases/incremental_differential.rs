//! Card main-157 Phase 4, sub-scope 4C: CLI-level differential parity for the
//! incremental-miss execution path (`GIT_SPAN_CACHE_STORE_V3` + an ancestor
//! generation).
//!
//! Phase 4B proved the incremental affected-set/reuse logic white-box, in
//! process, against `capture_resolution_core` directly (see
//! `src/resolver/incremental/tests.rs`). This suite proves the missing thing:
//! that a *real `git span stale` invocation* served by the incremental path
//! emits output byte-identical to the cache-off oracle across real git-history
//! transitions and every output format — the property the card's correctness
//! contract actually promises a user.
//!
//! ## Shape of each scenario
//!
//! 1. Build a Fresh multi-span corpus at commit **A** (some Fresh spans that
//!    the incremental path can reuse, plus one committed-drifted span so the
//!    oracle output is non-empty and parity is meaningful).
//! 2. Publish an ancestor generation at A under `GIT_SPAN_CACHE_STORE_V3=1`,
//!    then snapshot the store so every later run starts from an **A-only**
//!    store (no B generation) — forcing the exact read to miss and the
//!    incremental path to engage on every format, not just the first.
//! 3. Apply the scenario's transition to reach commit/state **B**.
//! 4. For each of human / porcelain / JSON: restore the A-only store, run
//!    `git span stale` under the cache-off oracle and under the new store, and
//!    assert byte-identical stdout AND identical process exit code.
//!
//! Every subprocess isolates global/system git config to `/dev/null` (as in
//! `store_v3_differential`) so an installed `filter.lfs` cannot make the token
//! persistence-ineligible and suppress the ancestor publish.
//!
//! ## A real divergence this suite surfaced (committed rename)
//!
//! The committed-rename scenario is **not** byte-identical to cache-off, and
//! the divergence reproduces in the new-store *cold* path too (it is therefore
//! not a Phase 4A/4B defect — the incremental reconstruction equals the cold
//! build exactly; `rename_incremental_output_equals_cold_new_store` proves it).
//! Root cause: `project_effective_anchor` in `resolver/core/project.rs` lists
//! BOTH the worktree and HEAD layers in `layer_sources` for an anchor that
//! relocated identically at both layers (a committed `git mv` with a clean
//! worktree), and the renderer emits one finding per layer source — so the new
//! store reports a duplicate `MOVED W` + `MOVED H` finding where the legacy
//! oracle collapses the identical move to a single `MOVED W`. That code is
//! Phase 3 and is outside 4C's file ownership, so the parity assertion is
//! encoded (demanding the correct, collapsed output) but `#[ignore]`d pending
//! the Phase 3 fix. See `notes/phase-4-latency-measurement.md` in the card repo
//! for the full repro and disposition.

use crate::support::TestRepo;

use anyhow::Result;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

const SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");
const FORMATS: &[&str] = &["human", "porcelain", "json"];
const STORE_SUFFIXES: &[&str] = &["", "-wal", "-shm"];

#[derive(Clone, Copy)]
enum Mode {
    /// Every persistent tier disabled — the ground-truth oracle.
    Disabled,
    /// The new store (exact → incremental → cold), the path under test.
    NewStore,
}

/// Run `git span <args>` in `repo` under `mode`, global/system git config
/// isolated. Returns `(stdout, stderr, exit_code)`. `perf` toggles
/// `GIT_SPAN_PERF` so the cache-path hit-class trace lands on stderr.
fn run(repo: &Path, args: &[&str], mode: Mode, perf: bool) -> (String, String, i32) {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).args(args);
    cmd.env("GIT_CONFIG_GLOBAL", "/dev/null");
    cmd.env("GIT_CONFIG_SYSTEM", "/dev/null");
    match mode {
        Mode::Disabled => {
            cmd.env("GIT_SPAN_CACHE", "0");
            cmd.env("GIT_SPAN_CACHE_V2", "0");
        }
        Mode::NewStore => {
            cmd.env("GIT_SPAN_CACHE_STORE_V3", "1");
        }
    }
    if perf {
        cmd.env("GIT_SPAN_PERF", "1");
    }
    let out = cmd
        .output()
        .unwrap_or_else(|e| panic!("spawn git-span {args:?}: {e}"));
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
        out.status.code().unwrap_or(-1),
    )
}

/// The `.git/span` directory that holds the new store.
fn store_dir(repo: &Path) -> std::path::PathBuf {
    repo.join(".git").join("span")
}

/// Snapshot the new-store db files (`store.db` + WAL/SHM sidecars) into memory,
/// so a later `restore_store` forces every run to start from this exact state.
fn snapshot_store(repo: &Path) -> BTreeMap<&'static str, Vec<u8>> {
    let dir = store_dir(repo);
    let mut snap = BTreeMap::new();
    for suffix in STORE_SUFFIXES {
        let p = dir.join(format!("store.db{suffix}"));
        if let Ok(bytes) = std::fs::read(&p) {
            snap.insert(*suffix, bytes);
        }
    }
    assert!(
        snap.contains_key(""),
        "expected an ancestor store.db to have been published"
    );
    snap
}

/// Restore the store to a prior snapshot: delete any current db files, then
/// write the snapshotted bytes back. Leaves the store holding exactly the
/// ancestor generation captured by `snapshot_store`.
fn restore_store(repo: &Path, snap: &BTreeMap<&'static str, Vec<u8>>) {
    let dir = store_dir(repo);
    for suffix in STORE_SUFFIXES {
        let _ = std::fs::remove_file(dir.join(format!("store.db{suffix}")));
    }
    for (suffix, bytes) in snap {
        std::fs::write(dir.join(format!("store.db{suffix}")), bytes).expect("restore store db");
    }
}

/// Build a Fresh three-span corpus and commit it, then commit a drift to one
/// span's anchored file so the oracle reports a finding. Returns the repo with
/// HEAD at commit **A**, plus a commit-graph.
///
/// * `alpha` → `src/a.txt#L1-L3` (Fresh, reusable)
/// * `beta`  → `src/b.txt#L1-L3` (Fresh, reusable)
/// * `gamma` → `src/d.txt#L1-L3` (committed-drifted → reported, widen-marked)
fn build_base_corpus() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("src/a.txt", "a1\na2\na3\n")?;
    repo.write_file("src/b.txt", "b1\nb2\nb3\n")?;
    repo.write_file("src/d.txt", "d1\nd2\nd3\n")?;
    repo.commit_all("seed")?;

    // Real `git span add`/`why` compute the canonical rk64 fingerprint, so each
    // anchor is genuinely Fresh at creation (unlike the sha256 support helper).
    repo.run_span(["add", "alpha", "src/a.txt#L1-L3"])?;
    repo.run_span(["why", "alpha", "-m", "why alpha"])?;
    repo.run_span(["add", "beta", "src/b.txt#L1-L3"])?;
    repo.run_span(["why", "beta", "-m", "why beta"])?;
    repo.run_span(["add", "gamma", "src/d.txt#L1-L3"])?;
    repo.run_span(["why", "gamma", "-m", "why gamma"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "spans"])?;

    // Drift gamma's committed content so the oracle reports it (clean worktree).
    repo.write_file("src/d.txt", "D1_CHANGED\nd2\nd3\n")?;
    repo.commit_all("drift d")?;
    repo.write_commit_graph()?;
    Ok(repo)
}

/// Publish an ancestor generation at the current HEAD via the new store, then
/// snapshot the resulting store. The `stale` exit code is intentionally
/// ignored — a drifted corpus exits non-zero and that is fine.
fn publish_and_snapshot(repo: &TestRepo) -> BTreeMap<&'static str, Vec<u8>> {
    let _ = run(repo.path(), &["stale"], Mode::NewStore, false);
    snapshot_store(repo.path())
}

/// Assert cache-off and the new store are byte-identical (stdout + exit code)
/// across every format, restoring the ancestor-only store before each run so
/// the new store is exercised from the same starting state every time.
///
/// Returns the concatenated new-store `--perf` stderr so a caller can assert
/// which cache-path class served the runs (incremental vs cold vs exact).
fn assert_parity_all_formats(
    repo: &TestRepo,
    snap: &BTreeMap<&'static str, Vec<u8>>,
    scenario: &str,
) -> String {
    let mut perf = String::new();
    for fmt in FORMATS {
        let args = ["stale", "--format", fmt];

        restore_store(repo.path(), snap);
        let (disabled, _, dis_code) = run(repo.path(), &args, Mode::Disabled, false);

        restore_store(repo.path(), snap);
        let (new_store, new_err, new_code) = run(repo.path(), &args, Mode::NewStore, true);
        perf.push_str(&new_err);

        assert_eq!(
            new_store, disabled,
            "[{scenario}/{fmt}] new-store stdout != cache-off oracle\n\
             --- oracle ---\n{disabled}\n--- new store ---\n{new_store}"
        );
        assert_eq!(
            new_code, dis_code,
            "[{scenario}/{fmt}] new-store exit code {new_code} != oracle {dis_code}"
        );
    }
    perf
}

// ─────────────────────────────────────────────────────────────────────────────
// Reuse scenarios: the incremental path must engage AND match the oracle.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn unrelated_commit_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // A commit that no span anchors.
    repo.write_file("README.md", "unrelated change\n")?;
    repo.commit_all("unrelated")?;
    repo.write_commit_graph()?;

    let perf = assert_parity_all_formats(&repo, &snap, "unrelated");
    assert!(
        perf.contains("cache-path.hit-class: incremental"),
        "unrelated commit must be served by the incremental path:\n{perf}"
    );
    Ok(())
}

#[test]
fn changed_anchored_path_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Change alpha's anchored file via a commit → alpha now drifts too.
    repo.write_file("src/a.txt", "A1_CHANGED\na2x\na3x\n")?;
    repo.commit_all("change a")?;
    repo.write_commit_graph()?;

    let perf = assert_parity_all_formats(&repo, &snap, "changed-anchored-path");
    assert!(
        perf.contains("cache-path.hit-class: incremental"),
        "a changed anchored path with unaffected siblings must engage the incremental path:\n{perf}"
    );
    Ok(())
}

#[test]
fn span_definition_only_change_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Rewrite alpha's span definition (its `why`) only — no source change.
    repo.run_span(["why", "alpha", "-m", "why alpha UPDATED"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span def change"])?;
    repo.write_commit_graph()?;

    let perf = assert_parity_all_formats(&repo, &snap, "span-definition-only");
    assert!(
        perf.contains("cache-path.hit-class: incremental"),
        "a span-definition-only change must engage the incremental path:\n{perf}"
    );
    Ok(())
}

#[test]
fn copy_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Copy beta's anchored file to a new path. Under the default local
    // (`SameCommit`) copy detection, a Fresh span whose own path is unchanged
    // must be reused — and must still match the oracle.
    let contents = std::fs::read_to_string(repo.path().join("src/b.txt"))?;
    repo.write_file("src/b_copy.txt", &contents)?;
    repo.commit_all("copy b")?;
    repo.write_commit_graph()?;

    let perf = assert_parity_all_formats(&repo, &snap, "copy");
    assert!(
        perf.contains("cache-path.hit-class: incremental"),
        "a copy that adds an unrelated path must engage the incremental path:\n{perf}"
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Degrade scenarios: the incremental path finds no reusable ancestor (or the
// state matches an existing generation) and correctly falls back. Output must
// still match the oracle exactly.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn branch_switch_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // A feature branch that diverged BEFORE A: A is not in its ancestry, so no
    // stored generation is reusable → degrade to the cold build.
    repo.run_git(["checkout", "-b", "feature", "HEAD~2"])?;
    repo.write_file("src/b.txt", "x\ny\nz\n")?;
    repo.commit_all("feature change b")?;
    repo.write_commit_graph()?;

    assert_parity_all_formats(&repo, &snap, "branch-switch");
    Ok(())
}

#[test]
fn reset_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Add a commit, then hard-reset back onto A.
    repo.write_file("later.md", "later\n")?;
    repo.commit_all("later")?;
    repo.run_git(["reset", "--hard", "HEAD~1"])?;
    repo.write_commit_graph()?;

    assert_parity_all_formats(&repo, &snap, "reset");
    Ok(())
}

#[test]
fn rebase_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Feature branched at A, rebased onto a new main commit. A remains an
    // ancestor of the rebased tip, so the incremental path can still reuse it.
    repo.run_git(["checkout", "-b", "feat"])?;
    repo.write_file("feat.txt", "f1\nf2\n")?;
    repo.commit_all("feat commit")?;
    repo.run_git(["checkout", "main"])?;
    repo.write_file("main_extra.txt", "m1\n")?;
    repo.commit_all("main extra")?;
    repo.run_git(["checkout", "feat"])?;
    repo.run_git(["rebase", "main"])?;
    repo.write_commit_graph()?;

    assert_parity_all_formats(&repo, &snap, "rebase");
    Ok(())
}

#[test]
fn no_common_ancestor_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // An orphan branch with an unrelated root: nothing in HEAD's ancestry has a
    // stored generation → degrade to the cold build.
    repo.run_git(["checkout", "--orphan", "unrelated"])?;
    repo.run_git(["rm", "-rf", "--cached", "."])?;
    let _ = std::fs::remove_file(repo.path().join("later.md"));
    repo.write_file("orphan.txt", "o1\no2\n")?;
    repo.write_file("src/a.txt", "a1\na2\na3\n")?;
    repo.write_file("src/b.txt", "b1\nb2\nb3\n")?;
    repo.write_file("src/d.txt", "D1_CHANGED\nd2\nd3\n")?;
    repo.commit_all("orphan root")?;
    repo.write_commit_graph()?;

    assert_parity_all_formats(&repo, &snap, "no-common-ancestor");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Committed rename.
//
// Proven-faithful: the incremental reconstruction is byte-identical to the
// new-store COLD build (4B is correct relative to its contract).
//
// Known divergence vs the cache-off oracle, rooted in Phase 3's projection and
// therefore outside 4C's file ownership — encoded but `#[ignore]`d (below).
// ─────────────────────────────────────────────────────────────────────────────

/// Apply the committed-rename transition to a freshly built, ancestor-published
/// corpus and return `(repo, ancestor snapshot)`.
fn rename_scenario() -> Result<(TestRepo, BTreeMap<&'static str, Vec<u8>>)> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);
    repo.run_git(["mv", "src/a.txt", "src/a_renamed.txt"])?;
    repo.commit_all("rename a")?;
    repo.write_commit_graph()?;
    Ok((repo, snap))
}

/// The incremental path must reconstruct exactly what a new-store COLD build
/// produces for the same state — proving Phase 4B's reuse/affected-set logic is
/// faithful even for a relocation, independent of whether the shared projection
/// matches the cache-off oracle. This passes today.
#[test]
fn rename_incremental_output_equals_cold_new_store() -> Result<()> {
    let (repo, snap) = rename_scenario()?;
    for fmt in FORMATS {
        let args = ["stale", "--format", fmt];

        // Incremental: start from the ancestor-only store.
        restore_store(repo.path(), &snap);
        let (incremental, incr_err, incr_code) = run(repo.path(), &args, Mode::NewStore, true);
        assert!(
            incr_err.contains("cache-path.hit-class: incremental"),
            "[rename/{fmt}] expected the incremental path to serve this run:\n{incr_err}"
        );

        // Cold: wipe the store entirely so the same invocation is a cold build.
        for suffix in STORE_SUFFIXES {
            let _ = std::fs::remove_file(store_dir(repo.path()).join(format!("store.db{suffix}")));
        }
        let (cold, cold_err, cold_code) = run(repo.path(), &args, Mode::NewStore, true);
        assert!(
            cold_err.contains("cache-path.hit-class: miss"),
            "[rename/{fmt}] expected a cold build for the comparison run:\n{cold_err}"
        );

        assert_eq!(
            incremental, cold,
            "[rename/{fmt}] incremental reconstruction must equal the cold build"
        );
        assert_eq!(incr_code, cold_code, "[rename/{fmt}] exit codes must match");
    }
    Ok(())
}

/// The correct end-to-end contract: a committed rename served by the new store
/// must be byte-identical to the cache-off oracle. Before the Phase 3 collapse
/// fix the new store emitted a duplicate `MOVED` finding (worktree + HEAD
/// layers) that the oracle renders as one; `project_effective_anchor` in
/// `resolver/core/project.rs` now collapses a `Moved` anchor to its single
/// deepest-layer source, matching the live resolver's invariant that every
/// `Moved` classification carries exactly one `layer_sources` entry.
#[test]
fn rename_matches_oracle_known_divergence_blocked() -> Result<()> {
    let (repo, snap) = rename_scenario()?;
    assert_parity_all_formats(&repo, &snap, "rename");
    Ok(())
}

/// Regression guard for the `Moved` collapse being *relative*, not a blanket
/// "drop everything but HEAD". A committed `git mv` relocates alpha's content
/// to `src/a_renamed.txt` lines 1-3 (the HEAD-layer move); an uncommitted
/// worktree edit then prepends two lines, relocating the SAME content to lines
/// 3-5 in the worktree (a genuinely different move introduced only at the
/// worktree layer, with a different `current` target than the HEAD move). The
/// live resolver reports one finding — the deepest enabled layer's move, sourced
/// `WORKTREE` with `current` at lines 3-5 — never the HEAD-layer 1-3 move and
/// never both. porcelain columns render the *anchored* location (`src/a.txt`
/// 1-3) for every layer, so only JSON's `current`/`source` distinguishes the
/// two moves: the guard asserts on JSON that the surviving finding is the
/// worktree's divergent move, proving the collapse keeps the correct layer
/// rather than folding onto the shallower layer's target range.
#[test]
fn rename_with_further_worktree_move_collapses_to_worktree_finding() -> Result<()> {
    let (repo, snap) = rename_scenario()?;

    // Uncommitted worktree edit: prepend two lines so alpha's anchored content
    // (a1/a2/a3) shifts to worktree lines 3-5, distinct from its committed
    // rename target range (1-3).
    repo.write_file("src/a_renamed.txt", "pre1\npre2\na1\na2\na3\n")?;

    restore_store(repo.path(), &snap);
    let disabled = run(repo.path(), &["stale", "--format", "json"], Mode::Disabled, false).0;

    // Non-vacuous premise: the oracle reports exactly one relocation for alpha
    // (a duplicate, uncollapsed projection would emit a second MOVED sourced
    // from HEAD), sourced from the WORKTREE layer, with `current` at the
    // worktree target range 3-5 (not the HEAD-layer 1-3).
    assert_eq!(
        disabled.matches("\"MOVED\"").count(),
        1,
        "oracle must report exactly one MOVED finding for the divergent rename:\n{disabled}"
    );
    assert!(
        disabled.contains("\"WORKTREE\""),
        "the single MOVED finding must be sourced from the divergent worktree layer:\n{disabled}"
    );
    assert!(
        disabled.contains("\"start\": 3") && disabled.contains("\"end\": 5"),
        "the surviving finding's `current` must be the worktree move target (3-5):\n{disabled}"
    );

    assert_parity_all_formats(&repo, &snap, "rename-further-worktree-move");
    Ok(())
}
