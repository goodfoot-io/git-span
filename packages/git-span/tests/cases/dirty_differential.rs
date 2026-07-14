//! Card main-157 Phase 5, sub-scope 5B: CLI-level differential parity for the
//! dirty-overlay execution path (`GIT_SPAN_CACHE_STORE_V3` + a same-HEAD
//! baseline generation).
//!
//! Phase 5A proved the dirty affected-set / reuse logic white-box, in process,
//! against `capture_resolution_core` directly (see
//! `src/resolver/dirty/tests.rs`). This suite proves the missing thing: that a
//! *real `git span stale` invocation* over an uncommitted staged/worktree
//! overlay emits output byte-identical to the cache-off oracle across every
//! required dirty state and every output format — the property the card's
//! correctness contract actually promises a user, and the class of proof that
//! caught a genuine Phase 3 projection defect in Phase 4C that no amount of
//! in-process testing had found.
//!
//! ## Shape of each scenario
//!
//! 1. Build a Fresh multi-span corpus and commit it, committing a drift to one
//!    span's source so the oracle output is non-empty and parity is meaningful.
//! 2. Publish a baseline generation at the current HEAD under
//!    `GIT_SPAN_CACHE_STORE_V3=1` (the dirty tier's `load_head_baseline` is a
//!    HEAD-*inclusive* lookup — it reuses a generation at the SAME HEAD), then
//!    snapshot the store so every later run starts from that baseline-only
//!    store, forcing the exact read to miss and the dirty tier to engage on
//!    every format.
//! 3. Apply the scenario's *uncommitted* transition (worktree edit, staged
//!    change, dirty span definition, conflict, …). HEAD does not move; only the
//!    worktree/index differs.
//! 4. For each of human / porcelain / JSON: restore the baseline-only store,
//!    run `git span stale` under the cache-off oracle and under the new store,
//!    and assert byte-identical stdout AND identical exit code (and, for the
//!    fault scenarios, stderr too).
//!
//! Every subprocess isolates global/system git config to `/dev/null` (as in
//! `incremental_differential`) so an installed `filter.lfs` cannot make the
//! token persistence-ineligible and suppress the baseline publish.
//!
//! ## A real divergence this suite surfaced (whole-file multi-layer drift)
//!
//! While porting the `.gitignore` divergence against the *real* workspace
//! corpus, this suite surfaced a genuine divergence that is **not**
//! dirty-tier-specific: a WHOLE-FILE anchor whose content drifts from its
//! recorded fingerprint at every layer (HEAD == index == worktree, clean
//! worktree) renders as THREE per-layer findings under cache-off
//! (INDEX/WORKTREE/HEAD; the human view collapses to the deepest —
//! "changed in the working tree" — with `current.blob` populated), but the new
//! store's shared cold `capture_resolution_core` → projection path emits a
//! single HEAD-sourced finding with `current.blob: None` → "changed". It
//! reproduces on the new-store COLD path with an empty store and a clean
//! worktree, so it is rooted in the shared Phase 3 capture/projection
//! (`resolver/engine` + `resolver/core`), outside 5B's file ownership — exactly
//! the shape of Phase 4C's committed-rename defect. The parity assertion is
//! encoded (demanding the correct, per-layer output) but `#[ignore]`d pending
//! the upstream fix; `whole_file_multilayer_drift_blocked_upstream` below is the
//! minimal reproduction. Line-range anchors (used by every non-ignored scenario
//! here, and by every Phase 3/4 differential test) drift at a single layer and
//! are byte-identical on both paths, so the dirty tier itself is fully proven.
//!
//! See the card-repo report for the full repro and disposition.

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
    /// The new store (exact → incremental → dirty → cold), the path under test.
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
        "expected a baseline store.db to have been published"
    );
    snap
}

/// Restore the store to a prior snapshot: delete any current db files, then
/// write the snapshotted bytes back. Leaves the store holding exactly the
/// baseline generation captured by `snapshot_store`.
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
/// span's source so the oracle reports a finding. Returns the repo with HEAD at
/// the drift commit.
///
/// * `alpha`   → `src/a.txt#L1-L3` (Fresh; the span each scenario dirties)
/// * `beta`    → `src/b.txt#L1-L3` (Fresh, clean → reused)
/// * `epsilon` → `src/e.txt#L1-L3` (Fresh, clean → reused)
/// * `gamma`   → `src/c.txt#L1-L3` (committed-drifted → reported)
///
/// `gamma`'s committed drift both keeps the oracle output non-empty (so the
/// `.gitignore` scenario is meaningful) and makes `gamma` widen-marked, so the
/// dirty tier conservatively re-resolves it alongside the dirtied `alpha`; the
/// two Fresh clean siblings `beta`/`epsilon` are the reused set (reused = 2,
/// resolved = 2).
///
/// All anchors are line ranges (`#L1-L3`): a line-range committed drift renders
/// a single HEAD-sourced finding on BOTH the cache-off and new-store paths (the
/// whole-file multi-layer divergence documented in the module header does not
/// apply), so every scenario below is a clean test of the DIRTY tier rather than
/// of the orthogonal upstream projection defect.
fn build_base_corpus() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("src/a.txt", "a-1\na-2\na-3\na-4\n")?;
    repo.write_file("src/b.txt", "b-1\nb-2\nb-3\nb-4\n")?;
    repo.write_file("src/c.txt", "c-1\nc-2\nc-3\nc-4\n")?;
    repo.write_file("src/e.txt", "e-1\ne-2\ne-3\ne-4\n")?;
    repo.commit_all("seed")?;

    // Real `git span add`/`why` compute the canonical rk64 fingerprint, so each
    // anchor is genuinely Fresh at creation.
    repo.run_span(["add", "alpha", "src/a.txt#L1-L3"])?;
    repo.run_span(["why", "alpha", "-m", "why alpha"])?;
    repo.run_span(["add", "beta", "src/b.txt#L1-L3"])?;
    repo.run_span(["why", "beta", "-m", "why beta"])?;
    repo.run_span(["add", "epsilon", "src/e.txt#L1-L3"])?;
    repo.run_span(["why", "epsilon", "-m", "why epsilon"])?;
    repo.run_span(["add", "gamma", "src/c.txt#L1-L3"])?;
    repo.run_span(["why", "gamma", "-m", "why gamma"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "spans"])?;

    // Drift gamma's committed source so the oracle reports it (clean worktree).
    repo.write_file("src/c.txt", "c-1CHANGED\nc-2\nc-3\nc-4\n")?;
    repo.commit_all("drift c")?;
    repo.write_commit_graph()?;
    Ok(repo)
}

/// Publish a baseline generation at the current HEAD via the new store, then
/// snapshot the resulting store. The `stale` exit code is intentionally
/// ignored — a drifted corpus exits non-zero and that is fine.
fn publish_and_snapshot(repo: &TestRepo) -> BTreeMap<&'static str, Vec<u8>> {
    let _ = run(repo.path(), &["stale"], Mode::NewStore, false);
    snapshot_store(repo.path())
}

/// Assert cache-off and the new store are byte-identical (stdout + exit code)
/// across every format, restoring the baseline-only store before each run so
/// the new store is exercised from the same starting state every time.
///
/// Returns the concatenated new-store `--perf` stderr so a caller can assert
/// which cache-path class served the runs (dirty vs exact vs miss).
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

/// Like [`assert_parity_all_formats`] but also compares STDERR byte-for-byte
/// (perf tracing disabled on both runs). Used by fault scenarios where the
/// contract is a matching error/exit on stderr, not just stdout.
fn assert_full_parity_all_formats(
    repo: &TestRepo,
    snap: &BTreeMap<&'static str, Vec<u8>>,
    scenario: &str,
) {
    for fmt in FORMATS {
        let args = ["stale", "--format", fmt];

        restore_store(repo.path(), snap);
        let (dis_out, dis_err, dis_code) = run(repo.path(), &args, Mode::Disabled, false);

        restore_store(repo.path(), snap);
        let (new_out, new_err, new_code) = run(repo.path(), &args, Mode::NewStore, false);

        assert_eq!(
            new_out, dis_out,
            "[{scenario}/{fmt}] stdout diverged\n--- oracle ---\n{dis_out}\n--- new ---\n{new_out}"
        );
        assert_eq!(
            new_err, dis_err,
            "[{scenario}/{fmt}] stderr diverged\n--- oracle ---\n{dis_err}\n--- new ---\n{new_err}"
        );
        assert_eq!(
            new_code, dis_code,
            "[{scenario}/{fmt}] exit code {new_code} != oracle {dis_code}"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unrelated `.gitignore` dirty change — THE original motivating bug
//    (`notes/investigation-question-log.md` Step 3). An unrelated dirty path is
//    not in the token's relevant set, so it does not change the canonical key:
//    the exact-hit tier serves the baseline summary and — crucially — dirtying
//    `.gitignore` no longer *changes* the rendered output, which is what the
//    Step 3 divergence was. This closes the original bug for the new-store path.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn unrelated_gitignore_dirt_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Dirty ONLY an unrelated, uncommitted `.gitignore`.
    repo.write_file(".gitignore", "target/\n*.tmp\n")?;

    let perf = assert_parity_all_formats(&repo, &snap, "unrelated-gitignore");
    // The key is unchanged, so the exact-hit tier serves it (the dirty tier is
    // never reached): this is precisely why the Step 3 divergence cannot recur —
    // an unrelated dirty path renders identically to the clean baseline.
    assert!(
        perf.contains("cache-path.hit-class: exact"),
        "an unrelated .gitignore edit must be served by the exact-hit tier \
         (unchanged canonical key), not re-render differently:\n{perf}"
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Dirty-tier reuse scenarios: the dirty overlay engages (one span re-resolved,
// the clean siblings reused) AND matches the oracle byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────

/// Assert the concatenated perf shows the dirty tier engaged and reused the two
/// clean siblings (alpha is the only dirty-affected span in these scenarios).
fn assert_dirty_tier_reused(perf: &str, scenario: &str) {
    assert!(
        perf.contains("cache-path.hit-class: dirty"),
        "[{scenario}] expected the dirty tier to serve this run:\n{perf}"
    );
    assert!(
        perf.contains("cache-path.dirty-reused-spans 2"),
        "[{scenario}] expected the two clean siblings (beta, gamma) to be reused:\n{perf}"
    );
}

#[test]
fn relevant_dirty_source_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Edit alpha's anchored source in the worktree only (no commit).
    repo.write_file("src/a.txt", "a-1CHANGED\na-2x\na-3x\na-4\n")?;

    let perf = assert_parity_all_formats(&repo, &snap, "relevant-source");
    assert_dirty_tier_reused(&perf, "relevant-source");
    Ok(())
}

#[test]
fn dirty_span_definition_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Rewrite alpha's span definition (its `why`) in the worktree without
    // committing — `git span why` writes `.span/alpha` and leaves it dirty.
    repo.run_span(["why", "alpha", "-m", "why alpha REVISED"])?;

    let perf = assert_parity_all_formats(&repo, &snap, "dirty-span-def");
    assert_dirty_tier_reused(&perf, "dirty-span-def");
    Ok(())
}

#[test]
fn staged_only_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Edit alpha's source and stage it; the worktree matches the index.
    repo.write_file("src/a.txt", "a-1STAGED\na-2s\na-3s\na-4\n")?;
    repo.run_git(["add", "src/a.txt"])?;

    let perf = assert_parity_all_formats(&repo, &snap, "staged-only");
    assert_dirty_tier_reused(&perf, "staged-only");
    Ok(())
}

#[test]
fn staged_plus_worktree_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Stage one edit, then make a further, different worktree edit on top: the
    // index and worktree layers differ from each other and from HEAD.
    repo.write_file("src/a.txt", "a-1STAGED\na-2\na-3\na-4\n")?;
    repo.run_git(["add", "src/a.txt"])?;
    repo.write_file("src/a.txt", "a-1WORKTREE\na-2w\na-3w\na-4\n")?;

    let perf = assert_parity_all_formats(&repo, &snap, "staged-plus-worktree");
    assert_dirty_tier_reused(&perf, "staged-plus-worktree");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Same-size / same-mtime edit: a mutation a naive stat-only cache would miss.
// Proves the resolver keys off real content, not stat metadata — if it trusted
// (size, mtime) the dirty state would be invisible and the exact-hit tier would
// serve the stale clean baseline, diverging from the oracle.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn same_size_same_mtime_edit_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    let a = repo.path().join("src/a.txt");
    // Preserve the exact size and mtime while changing content: "a-1\na-2\na-3\n"
    // → "X-1\nX-2\nX-3\n" is byte-for-byte the same length, and we restore the
    // original mtime so (size, mtime) is unchanged.
    let orig_meta = std::fs::metadata(&a)?;
    let orig_len = orig_meta.len();
    let orig_mtime = filetime_of(&orig_meta);
    repo.write_file("src/a.txt", "X-1\nX-2\nX-3\na-4\n")?;
    let new_len = std::fs::metadata(&a)?.len();
    assert_eq!(new_len, orig_len, "the edit must preserve byte length");
    set_mtime(&a, orig_mtime)?;

    // Non-vacuous premise: the content genuinely changed, so the oracle must
    // report alpha as drifted — otherwise this proves nothing.
    let (oracle, _, _) = run(repo.path(), &["stale", "--format", "porcelain"], Mode::Disabled, false);
    assert!(
        oracle.contains("src/a.txt"),
        "same-size edit must drift alpha under the oracle (else the test is vacuous):\n{oracle}"
    );

    assert_parity_all_formats(&repo, &snap, "same-size-same-mtime");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Ignored / untracked span file: a new `.span/` definition that is not
// committed. It is absent from the baseline, so the dirty tier treats it as
// affected (re-resolved) and the committed siblings are reused. Output must
// still match the oracle exactly.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn untracked_span_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // A brand-new, uncommitted span anchoring an existing source (Fresh).
    repo.run_span(["add", "delta", "src/b.txt#L2-L4"])?;
    repo.run_span(["why", "delta", "-m", "why delta"])?;

    assert_parity_all_formats(&repo, &snap, "untracked-span");
    Ok(())
}

#[test]
fn ignored_span_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // A new span whose file is matched by `.gitignore` (untracked + ignored).
    repo.write_file(".gitignore", ".span/delta\n")?;
    repo.run_span(["add", "delta", "src/b.txt#L2-L4"])?;
    repo.run_span(["why", "delta", "-m", "why delta"])?;

    assert_parity_all_formats(&repo, &snap, "ignored-span");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge conflict on a relevant (anchored) path: the conflicted index (stages
// 1/2/3) makes alpha's path dirty. Output must match the oracle across formats.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn conflict_parity() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/a.txt", "base-a1\na2\na3\na4\n")?;
    repo.write_file("src/b.txt", "base-b1\nb2\nb3\nb4\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "alpha", "src/a.txt#L1-L3"])?;
    repo.run_span(["why", "alpha", "-m", "why alpha"])?;
    repo.run_span(["add", "beta", "src/b.txt#L1-L3"])?;
    repo.run_span(["why", "beta", "-m", "why beta"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "spans"])?;

    // Diverge a.txt on `other`.
    repo.run_git(["checkout", "-b", "other"])?;
    repo.write_file("src/a.txt", "other-a1\nother-a2\nother-a3\na4\n")?;
    repo.commit_all("other change")?;

    // On main, change a.txt AND re-anchor alpha Fresh at main HEAD.
    repo.run_git(["checkout", "main"])?;
    repo.write_file("src/a.txt", "main-a1\nmain-a2\nmain-a3\na4\n")?;
    repo.run_span(["add", "alpha", "src/a.txt#L1-L3"])?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "main change"])?;
    repo.write_commit_graph()?;

    // Baseline at the clean main HEAD, then force a conflicting merge.
    let snap = publish_and_snapshot(&repo);
    // A conflicting merge exits non-zero; that is expected, so bypass
    // `run_git` (which asserts success) and let it fail.
    let _ = Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "other"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("spawn git merge");

    assert_full_parity_all_formats(&repo, &snap, "conflict");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Unreadable file: alpha's anchored source is replaced by a directory (a typed
// `Unreadable`, distinct from `Absent`). Resolving over it is a hard resolver
// error; the new store must surface it IDENTICALLY to the authoritative full
// resolve — a resolver error stays an error, never masked as a stale/fresh
// cache result (`notes/correctness-contract.md` "Fail-Closed"). stderr and exit
// code are compared, not just stdout.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn unreadable_file_parity() -> Result<()> {
    let repo = build_base_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Replace alpha's anchored file with a directory: an unreadable worktree
    // state that both paths must error on identically.
    std::fs::remove_file(repo.path().join("src/a.txt"))?;
    std::fs::create_dir(repo.path().join("src/a.txt"))?;

    assert_full_parity_all_formats(&repo, &snap, "unreadable");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Changing-index race: the index moves between generations. A first dirty state
// B1 is resolved and its generation published; the index is then moved to a
// DIFFERENT dirty state B2 at the same HEAD. The new store must render B2
// correctly and never serve the stale B1 generation.
//
// This is the CLI-observable consequence of the dirty tier's `revalidate()`
// discard-on-torn-read integration: the index is part of the canonical key, so
// a moved index yields a different key and B1's generation is never reused for
// B2. A genuine mid-invocation tear (state mutating between capture and publish)
// is exercised in-process by Phase 5A's `fire_after_build_hook`
// (`revalidate → Bypass`); this asserts the end-to-end property — output tracks
// the live index byte-for-byte against cache-off — that the discard guarantees.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn changing_index_race_parity() -> Result<()> {
    let repo = build_base_corpus()?;

    // Dirty state B1: stage an edit to alpha's source, then publish its dirty
    // generation through the new store.
    repo.write_file("src/a.txt", "a-1B1\na-2\na-3\na-4\n")?;
    repo.run_git(["add", "src/a.txt"])?;
    let _ = run(repo.path(), &["stale"], Mode::NewStore, false);
    // Snapshot the store — it now holds the baseline AND the B1 dirty generation.
    let snap = snapshot_store(repo.path());

    // Move the index to a DIFFERENT dirty state B2 at the same HEAD.
    repo.write_file("src/a.txt", "a-1B2-different\na-2\na-3\na-4\n")?;
    repo.run_git(["add", "src/a.txt"])?;

    // The new store must render B2, never reuse B1's stale generation.
    assert_parity_all_formats(&repo, &snap, "changing-index-race");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKED (upstream, Phase 3 shared capture/projection — outside 5B ownership):
// whole-file anchor drifted at all layers.
//
// Minimal reproduction of the divergence described in the module header. A
// WHOLE-FILE anchor whose content differs from its recorded fingerprint at
// HEAD == index == worktree (clean worktree) renders as THREE per-layer findings
// under cache-off (the human view: "changed in the working tree"), but the new
// store's shared cold `capture_resolution_core` → projection path emits a single
// HEAD-sourced "changed". It reproduces on the new-store COLD path (empty store,
// clean worktree — the dirty tier is not even reached), so the fix lives in
// `resolver/engine` / `resolver/core`, outside 5B's file ownership. Encoded as
// the correct contract (byte-identity with cache-off) but `#[ignore]`d pending
// the upstream fix, mirroring Phase 4C's `rename_matches_oracle_*_blocked`.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
#[ignore = "BLOCKED upstream (card main-157): a whole-file anchor drifted at all \
            layers renders 3 per-layer findings under cache-off but 1 HEAD-sourced \
            finding via the new store's shared cold capture/projection \
            (resolver/engine + resolver/core) — outside 5B's dirty/mod.rs \
            ownership. See the 5B report."]
fn whole_file_multilayer_drift_blocked_upstream() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("foo.txt", "V1\nline2\nline3\n")?;
    repo.commit_all("seed")?;
    // Whole-file anchor (no line range) records the V1 fingerprint.
    repo.run_span(["add", "s", "foo.txt"])?;
    repo.run_span(["why", "s", "-m", "why s"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span"])?;
    // Commit a drift so HEAD == index == worktree all differ from the fingerprint
    // (clean worktree).
    repo.write_file("foo.txt", "V2_CHANGED\nline2\nline3\n")?;
    repo.commit_all("drift")?;
    repo.write_commit_graph()?;

    // COLD new store (empty) vs cache-off, clean worktree — the dirty tier is
    // not reached; the divergence is entirely upstream.
    for fmt in FORMATS {
        let args = ["stale", "--format", fmt];
        let _ = std::fs::remove_dir_all(store_dir(repo.path()));
        let (disabled, _, dis_code) = run(repo.path(), &args, Mode::Disabled, false);
        let _ = std::fs::remove_dir_all(store_dir(repo.path()));
        let (new_store, _, new_code) = run(repo.path(), &args, Mode::NewStore, false);
        assert_eq!(
            new_store, disabled,
            "[whole-file/{fmt}] new-store stdout != cache-off oracle\n\
             --- oracle ---\n{disabled}\n--- new store ---\n{new_store}"
        );
        assert_eq!(new_code, dis_code, "[whole-file/{fmt}] exit code mismatch");
    }
    Ok(())
}

// ── Small cross-platform mtime helpers (integration tests must not reference
//    std::os::unix directly — see scripts/validate.sh guardrail; these mirror
//    the pattern in tests/support/mod.rs). ──────────────────────────────────

fn filetime_of(meta: &std::fs::Metadata) -> std::time::SystemTime {
    meta.modified().expect("mtime")
}

fn set_mtime(path: &Path, mtime: std::time::SystemTime) -> std::io::Result<()> {
    // `File::set_modified` is portable and needs no platform-specific imports.
    let f = std::fs::OpenOptions::new().write(true).open(path)?;
    f.set_modified(mtime)
}
