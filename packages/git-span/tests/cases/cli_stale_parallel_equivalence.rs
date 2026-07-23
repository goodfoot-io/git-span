//! Thread-count / cache-state equivalence guard for the **cache-enabled
//! cold-miss** resolution path (card main-162, staged-rollout step 5).
//!
//! ## Why this file exists (it is not a rename of the existing perf guard)
//!
//! [`cli_stale_fix_perf_equivalence.rs`](tests/cases/cli_stale_fix_perf_equivalence.rs)
//! drives every run with `GIT_SPAN_CACHE=0`. That bypass routes through
//! `resolve_loaded_span_with_state` — a *different* loop from the one this card
//! parallelizes. The loop card main-162 forks over rayon is
//! [`capture_resolution_core`](src/resolver/engine/mod.rs#L716), reached only on
//! a **cache-enabled cold miss** via
//! [`resolver::exact::cold_miss`](src/resolver/exact/mod.rs#L601). So the
//! existing suite gives zero regression coverage for the code this card
//! actually changed. These cases exercise that path directly: they never set
//! `GIT_SPAN_CACHE=0` on the runs under test (a cleared on-disk store forces the
//! cold miss), and they pin its output against three independent oracles.
//!
//! ## What is asserted (the dev-context.md correctness matrix, plus threads)
//!
//! For a mixed-status corpus of ~120 anchors (well above the cold path's
//! [`COLD_STALE_MIN_ANCHORS_PER_TASK`](src/resolver/engine/mod.rs) so rayon
//! really forks into multiple tasks), across `{human, porcelain, json}`:
//!
//! * cache-enabled **cold** (parallel `capture_resolution_core`) == cache-off
//!   `GIT_SPAN_CACHE=0` **ground truth** — the parallel loop agrees with the
//!   no-cache oracle byte-for-byte;
//! * cache-enabled **warm** (exact-hit replay) == the same ground truth;
//! * `RAYON_NUM_THREADS=1` == default thread count == an explicit multi-thread
//!   count, byte-identical in every direction (dev-context.md's explicit
//!   addition for this card);
//! * a **dirty-tree** pass (append to a tracked source, compare cache-off vs
//!   warm, restore).
//!
//! A dedicated **error-path** case exercises the Phase 4 error-path-identity
//! fix under real concurrency: two anchors, at the first and last positions of
//! the input-anchor order, each fail resolution (their tracked worktree path is
//! replaced by a directory, so the worktree read returns a hard `Err` rather
//! than a drift classification). The serial loop's early-return `?` surfaces
//! the *first-in-input-order* error; the parallel collect must reproduce that
//! exactly — same message, same exit code — regardless of which worker finishes
//! first. A naive `.collect::<Result<_,_>>()` would surface whichever error a
//! work-stealing thread produced first in *completion* order and could diverge
//! between thread counts; this asserts it does not.
//!
//! A **stress** case reruns the full cold-vs-ground comparison many times under
//! the default (multi-thread) pool. The corpus is built with many anchors
//! sharing one deleted path (`deleted_locus_memo` / single-flight contention)
//! and many anchors resolving through one relocation candidate
//! (`JaccardCorpus` / `relocation_text_memo` contention); a race that merely
//! failed to manifest on one run shows up as a diff on some iteration.
//!
//! Methodology note (shared with the existing perf guard): git rename detection
//! is nondeterministic across separately-built repos, so every comparison here
//! builds ONE corpus and compares runs of that same repo — never two
//! independently constructed repos.

use crate::support;

use anyhow::Result;
use std::process::Command;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// A single `git span stale` invocation's captured output.
struct Run {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    code: Option<i32>,
}

/// Run `git span stale --no-exit-code --format <format>` in `repo`.
///
/// `threads` sets `RAYON_NUM_THREADS` (the real, functioning thread-count knob
/// once Phase 5 removes the single-thread pin); `None` leaves it unset so the
/// global pool defaults to machine parallelism. `cache_off` toggles the
/// `GIT_SPAN_CACHE=0` ground-truth bypass — the runs *under test* leave it off
/// so a cleared store forces the cache-enabled cold miss through
/// `capture_resolution_core`.
fn run_stale(repo: &TestRepo, format: &str, threads: Option<&str>, cache_off: bool) -> Result<Run> {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
    cmd.current_dir(repo.path());
    cmd.args(["stale", "--no-exit-code", "--format", format]);
    if let Some(t) = threads {
        cmd.env("RAYON_NUM_THREADS", t);
    }
    if cache_off {
        cmd.env("GIT_SPAN_CACHE", "0");
    }
    let out = cmd.output()?;
    Ok(Run {
        stdout: out.stdout,
        stderr: out.stderr,
        code: out.status.code(),
    })
}

/// Run `git span stale` (default `human`) capturing its *error-path* outcome,
/// with an optional `RAYON_NUM_THREADS`. No `--no-exit-code`: a hard resolution
/// error must surface its non-zero exit code.
fn run_stale_erroring(repo: &TestRepo, threads: Option<&str>) -> Result<Run> {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
    cmd.current_dir(repo.path());
    cmd.args(["stale"]);
    if let Some(t) = threads {
        cmd.env("RAYON_NUM_THREADS", t);
    }
    let out = cmd.output()?;
    Ok(Run {
        stdout: out.stdout,
        stderr: out.stderr,
        code: out.status.code(),
    })
}

/// Delete the SQLite cache store so the next cache-enabled run is a guaranteed
/// cold miss (`.git/span`, i.e. `<common_dir>/span`). No-op if absent.
fn clear_store(repo: &TestRepo) -> Result<()> {
    let store = repo.path().join(".git").join("span");
    if store.exists() {
        std::fs::remove_dir_all(store)?;
    }
    Ok(())
}

/// A 60-line file body whose every line is unique (`<tag>-lineN`), so anchored
/// slices hash-compare distinctly and no coincidental match masks drift.
fn body(tag: &str) -> String {
    (1..=60).map(|i| format!("{tag}-line{i}\n")).collect()
}

/// Thirty non-overlapping two-line anchor addresses on `path`
/// (`path#L1-L2`, `path#L3-L4`, … `path#L59-L60`).
fn thirty_anchors(path: &str) -> Vec<String> {
    (1..=30)
        .map(|k| format!("{path}#L{}-L{}", 2 * k - 1, 2 * k))
        .collect()
}

/// Add one span with a batch of anchors, give it a `--why`, and stage+commit
/// the `.span` file.
fn add_span(repo: &TestRepo, name: &str, anchors: &[String]) -> Result<()> {
    let mut args: Vec<String> = vec!["add".into(), name.into()];
    args.extend(anchors.iter().cloned());
    repo.span_stdout(args)?;
    repo.span_stdout(["why", name, name])?;
    Ok(())
}

/// Build the mixed-status stress corpus and return it.
///
/// Four 60-line files, 30 anchors each (120 total, > `COLD_STALE_MIN_ANCHORS_PER_TASK`):
/// `keep.txt` stays **Fresh**; `edit.txt` is content-edited (**Changed**);
/// `doomed.txt` is deleted (30 **Deleted** anchors sharing one deleted path —
/// `deleted_locus_memo`/single-flight contention); `orig.txt` is `git mv`d to
/// `relocated.txt` (30 **Moved** anchors resolving through one relocation
/// candidate — `JaccardCorpus`/`relocation_text_memo` contention).
fn build_mixed_corpus() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    // gc.auto=0 keeps object reads off the packer during resolution — matches
    // the deterministic-object-store assumption the other resolver tests use.
    repo.run_git(["config", "gc.auto", "0"])?;

    repo.write_file("keep.txt", &body("keep"))?;
    repo.write_file("edit.txt", &body("edit"))?;
    repo.write_file("doomed.txt", &body("doomed"))?;
    repo.write_file("orig.txt", &body("orig"))?;
    repo.commit_all("seed source files")?;
    repo.write_commit_graph()?;

    add_span(&repo, "fresh", &thirty_anchors("keep.txt"))?;
    add_span(&repo, "changed", &thirty_anchors("edit.txt"))?;
    add_span(&repo, "deleted", &thirty_anchors("doomed.txt"))?;
    add_span(&repo, "moved", &thirty_anchors("orig.txt"))?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "add spans"])?;
    repo.write_commit_graph()?;

    // Drift the corpus: content-edit edit.txt, delete doomed.txt, rename
    // orig.txt -> relocated.txt.
    repo.write_file("edit.txt", &body("EDITED"))?;
    repo.run_git(["rm", "-q", "doomed.txt"])?;
    repo.run_git(["mv", "orig.txt", "relocated.txt"])?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "drift: edit, delete, rename"])?;
    repo.write_commit_graph()?;

    Ok(repo)
}

fn as_str(b: &[u8]) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(b)
}

// ---------------------------------------------------------------------------
// Full format × cache-state × thread-count matrix.
// ---------------------------------------------------------------------------

#[test]
fn cache_enabled_cold_miss_matches_ground_truth_across_formats_and_threads() -> Result<()> {
    let repo = build_mixed_corpus()?;

    for format in ["human", "porcelain", "json"] {
        // Ground truth: GIT_SPAN_CACHE=0 (the no-cache oracle).
        let ground = run_stale(&repo, format, None, true)?;

        // Cache-enabled COLD miss (parallel capture_resolution_core), default
        // pool. Populates the store as a side effect.
        clear_store(&repo)?;
        let cold_default = run_stale(&repo, format, None, false)?;
        // Cache-enabled WARM replay (exact hit), default pool.
        let warm_default = run_stale(&repo, format, None, false)?;

        // Cache-enabled cold miss at RAYON_NUM_THREADS=1 (the pinned single
        // worker) and at an explicit multi-thread count.
        clear_store(&repo)?;
        let cold_one = run_stale(&repo, format, Some("1"), false)?;
        clear_store(&repo)?;
        let cold_many = run_stale(&repo, format, Some("8"), false)?;

        // Parallel cold miss agrees with the no-cache oracle, byte-for-byte.
        assert_eq!(
            as_str(&cold_default.stdout),
            as_str(&ground.stdout),
            "[{format}] cache-enabled cold-miss stdout must match GIT_SPAN_CACHE=0 ground truth"
        );
        assert_eq!(
            as_str(&cold_default.stderr),
            as_str(&ground.stderr),
            "[{format}] cache-enabled cold-miss stderr must match ground truth"
        );
        assert_eq!(
            cold_default.code, ground.code,
            "[{format}] cold-miss exit code must match ground truth"
        );

        // Warm exact-hit replay also matches ground truth.
        assert_eq!(
            as_str(&warm_default.stdout),
            as_str(&ground.stdout),
            "[{format}] warm exact-hit stdout must match ground truth"
        );
        assert_eq!(warm_default.code, ground.code, "[{format}] warm exit code");

        // Thread-count identity, both directions: 1 == default and default ==
        // many, hence 1 == many by transitivity — every pairing is asserted
        // against the shared ground-truth string above and each other here.
        assert_eq!(
            as_str(&cold_one.stdout),
            as_str(&cold_default.stdout),
            "[{format}] RAYON_NUM_THREADS=1 cold stdout must equal default-thread cold stdout"
        );
        assert_eq!(
            as_str(&cold_default.stdout),
            as_str(&cold_one.stdout),
            "[{format}] default-thread cold stdout must equal RAYON_NUM_THREADS=1 cold stdout"
        );
        assert_eq!(
            as_str(&cold_many.stdout),
            as_str(&cold_one.stdout),
            "[{format}] multi-thread cold stdout must equal single-thread cold stdout"
        );
        assert_eq!(
            (as_str(&cold_one.stderr), cold_one.code),
            (as_str(&cold_many.stderr), cold_many.code),
            "[{format}] cold stderr + exit code must be thread-count invariant"
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Dirty-tree pass: cache-off vs warm, per dev-context.md's matrix.
// ---------------------------------------------------------------------------

#[test]
fn dirty_tree_cache_off_matches_warm_across_formats() -> Result<()> {
    let repo = build_mixed_corpus()?;

    // Append a line to a tracked source anchored by the Fresh span, making the
    // worktree dirty relative to HEAD.
    let keep = repo.path().join("keep.txt");
    let mut dirty = std::fs::read_to_string(&keep)?;
    dirty.push_str("keep-appended\n");
    std::fs::write(&keep, &dirty)?;

    for format in ["human", "porcelain", "json"] {
        // Warm the cache-enabled path for the dirty state.
        clear_store(&repo)?;
        let _ = run_stale(&repo, format, None, false)?;
        let warm = run_stale(&repo, format, None, false)?;
        let cache_off = run_stale(&repo, format, None, true)?;

        assert_eq!(
            as_str(&cache_off.stdout),
            as_str(&warm.stdout),
            "[{format}] dirty-tree cache-off stdout must match warm cache-enabled stdout"
        );
        assert_eq!(
            cache_off.code, warm.code,
            "[{format}] dirty-tree exit code parity"
        );
    }

    // Restore the tracked file.
    repo.run_git(["checkout", "--", "keep.txt"])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Error-path identity under real concurrency (Phase 4 fix).
// ---------------------------------------------------------------------------

/// Build a corpus with two anchors that fail resolution with a hard `Err`
/// (their tracked worktree path is replaced by a directory, so the worktree
/// read fails with `EISDIR` rather than classifying as drift). `aaa-err` sorts
/// first among span names and `zzz-err` last, so the first-in-input-order error
/// is deterministically `aaa-err`'s `a.txt`. Bulk Fresh anchors in the middle
/// push the batch above `COLD_STALE_MIN_ANCHORS_PER_TASK` so rayon forks for real.
fn build_error_corpus() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.run_git(["config", "gc.auto", "0"])?;

    repo.write_file("a.txt", &body("a"))?;
    repo.write_file("z.txt", &body("z"))?;
    repo.write_file("keep.txt", &body("keep"))?;
    repo.commit_all("seed error-corpus files")?;
    repo.write_commit_graph()?;

    add_span(&repo, "aaa-err", &["a.txt#L1-L3".to_string()])?;
    add_span(&repo, "mmm-fresh", &thirty_anchors("keep.txt"))?;
    add_span(&repo, "zzz-err", &["z.txt#L1-L3".to_string()])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "add error-corpus spans"])?;
    repo.write_commit_graph()?;

    // Replace each erroring anchor's tracked file with a directory of the same
    // name so the worktree read returns a hard I/O error.
    for f in ["a.txt", "z.txt"] {
        let p = repo.path().join(f);
        std::fs::remove_file(&p)?;
        std::fs::create_dir(&p)?;
        std::fs::write(p.join("inner"), b"x")?;
    }
    Ok(repo)
}

#[test]
fn error_path_surfaces_first_input_order_error_identically_across_threads() -> Result<()> {
    let repo = build_error_corpus()?;

    // The parallel collect must never surface a completion-order-dependent
    // error; repeat so an unlucky schedule that reversed two completions would
    // eventually diverge if the first-in-input-order scan were not enforced.
    let mut baseline: Option<Run> = None;
    for iter in 0..24 {
        // Alternate thread counts so single- and multi-thread pools are both
        // exercised, in both orders relative to the baseline.
        let threads = if iter % 2 == 0 { Some("8") } else { Some("1") };
        clear_store(&repo)?;
        let run = run_stale_erroring(&repo, threads)?;

        // A hard resolution error: non-zero exit, empty stdout, error on stderr.
        assert_eq!(
            run.code,
            Some(1),
            "iter {iter}: a hard resolution error must exit 1; stderr={}",
            as_str(&run.stderr)
        );
        // First-in-input-order error is aaa-err's `a.txt`, never zzz-err's
        // `z.txt` — regardless of which worker finished first.
        let stderr = as_str(&run.stderr);
        assert!(
            stderr.contains("a.txt"),
            "iter {iter}: the surfaced error must be the first-in-input-order anchor `a.txt`; got: {stderr}"
        );
        assert!(
            !stderr.contains("z.txt"),
            "iter {iter}: the later anchor `z.txt`'s error must never win the race; got: {stderr}"
        );

        match &baseline {
            None => baseline = Some(run),
            Some(b) => {
                assert_eq!(
                    as_str(&run.stderr),
                    as_str(&b.stderr),
                    "iter {iter}: error stderr must be byte-identical across thread counts (both directions)"
                );
                assert_eq!(
                    run.code, b.code,
                    "iter {iter}: error exit code must be thread-count invariant"
                );
                assert_eq!(
                    as_str(&run.stdout),
                    as_str(&b.stdout),
                    "iter {iter}: error stdout must be thread-count invariant"
                );
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Stress: repeat the cold-vs-ground comparison under real parallelism.
// ---------------------------------------------------------------------------

/// Number of stress iterations. A single passing run cannot rule out a race
/// that merely did not manifest that time; rerunning the whole comparison many
/// times turns a nondeterministic divergence into a near-certain diff.
const STRESS_ITERS: usize = 50;

#[test]
fn stress_shared_contention_no_divergence_over_iterations() -> Result<()> {
    let repo = build_mixed_corpus()?;

    // Ground-truth oracle per format is deterministic — compute once.
    let ground: Vec<(&str, Vec<u8>, Option<i32>)> = ["human", "porcelain", "json"]
        .into_iter()
        .map(|f| -> Result<_> {
            let r = run_stale(&repo, f, None, true)?;
            Ok((f, r.stdout, r.code))
        })
        .collect::<Result<_>>()?;

    for iter in 0..STRESS_ITERS {
        for (format, ground_stdout, ground_code) in &ground {
            // Cold miss on the default (multi-thread) pool: the contended
            // parallel path under test.
            clear_store(&repo)?;
            let run = run_stale(&repo, format, None, false)?;
            assert_eq!(
                as_str(&run.stdout),
                as_str(ground_stdout),
                "[{format}] iter {iter}/{STRESS_ITERS}: parallel cold-miss diverged from ground truth"
            );
            assert_eq!(
                run.code, *ground_code,
                "[{format}] iter {iter}/{STRESS_ITERS}: parallel cold-miss exit code diverged"
            );
        }
    }

    Ok(())
}
