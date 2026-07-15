//! Card main-157 F6 regression: an uncommitted (untracked/gitignored) span
//! file must not disable caching for the ENTIRE committed corpus.
//!
//! The former `has_uncommitted_span_files` gate returned
//! [`ExactAttempt::Bypass`](crate) — a full, uncached authoritative resolve of
//! the whole corpus — whenever ANY worktree span file was absent at HEAD. Two
//! ordinary states hit it on every invocation: the documented authoring
//! workflow (`git span add <slug>` leaves an uncommitted `.span` file until
//! `git add .span && git commit`) and any repo carrying a gitignored/local
//! work-in-progress span. Throughout those windows every `git span stale` was a
//! cold resolve of the committed corpus — a measured ~60x per-invocation
//! penalty on large corpora, versus the pre-cutover cache which routed
//! uncommitted spans through a dirty overlay.
//!
//! The fix makes an uncommitted span a *keyed* input rather than an
//! unobservable one:
//! [`capture_state_token`](../../../src/resolver/core/capture.rs) folds every
//! worktree-only span file's path and anchored source paths into the token's
//! relevant set (so its worktree/index identity enters the canonical key) and
//! its config into the effective copy-detection. A span absent at HEAD always
//! reads dirty, so the dirty tier re-resolves exactly that span while the
//! committed corpus keeps its exact/dirty-tier reuse.
//!
//! This suite pins both halves of the contract against a *real* `git span
//! stale` invocation:
//!
//! * **Correctness** — output is byte-identical to the `GIT_SPAN_CACHE=0`
//!   oracle across every format while an uncommitted span is present, added,
//!   and after it is deleted (no stale replay of the deleted span).
//! * **Performance** — the committed corpus is served from the dirty tier's
//!   reuse (`cache-path.dirty-reused-spans`), NOT fully re-resolved, and the
//!   run is no longer a whole-store bypass.

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
    /// The store (exact → incremental → dirty → cold), the path under test.
    NewStore,
}

/// Run `git span <args>` in `repo` under `mode`, global/system git config
/// isolated (so an installed `filter.lfs` cannot make the token
/// persistence-ineligible and suppress the baseline publish). Returns
/// `(stdout, stderr, exit_code)`; `perf` toggles `GIT_SPAN_PERF` so the
/// cache-path trace lands on stderr.
fn run(repo: &Path, args: &[&str], mode: Mode, perf: bool) -> (String, String, i32) {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).args(args);
    cmd.env("GIT_CONFIG_GLOBAL", "/dev/null");
    cmd.env("GIT_CONFIG_SYSTEM", "/dev/null");
    if let Mode::Disabled = mode {
        cmd.env("GIT_SPAN_CACHE", "0");
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

fn store_dir(repo: &Path) -> std::path::PathBuf {
    repo.join(".git").join("span")
}

/// Snapshot the store db files so a later `restore_store` forces every run to
/// start from this exact baseline-only state (the exact read misses and the
/// dirty tier engages on every format).
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

fn restore_store(repo: &Path, snap: &BTreeMap<&'static str, Vec<u8>>) {
    let dir = store_dir(repo);
    for suffix in STORE_SUFFIXES {
        let _ = std::fs::remove_file(dir.join(format!("store.db{suffix}")));
    }
    for (suffix, bytes) in snap {
        std::fs::write(dir.join(format!("store.db{suffix}")), bytes).expect("restore store db");
    }
}

/// Build and commit a Fresh three-span corpus (`alpha`/`beta`/`gamma`, all
/// clean at a clean HEAD), leaving the worktree clean. No committed drift: the
/// committed spans are Fresh, so they are neither reported nor widen-marked, and
/// the dirty tier reuses ALL of them verbatim — making the reuse count exact and
/// robust. HEAD carries a commit-graph for the reverse-indexed walker.
fn build_committed_corpus() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("src/a.txt", "a-1\na-2\na-3\na-4\n")?;
    repo.write_file("src/b.txt", "b-1\nb-2\nb-3\nb-4\n")?;
    repo.write_file("src/c.txt", "c-1\nc-2\nc-3\nc-4\n")?;
    repo.write_file("src/n.txt", "n-1\nn-2\nn-3\nn-4\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "alpha", "src/a.txt#L1-L3"])?;
    repo.run_span(["why", "alpha", "-m", "why alpha"])?;
    repo.run_span(["add", "beta", "src/b.txt#L1-L3"])?;
    repo.run_span(["why", "beta", "-m", "why beta"])?;
    repo.run_span(["add", "gamma", "src/c.txt#L1-L3"])?;
    repo.run_span(["why", "gamma", "-m", "why gamma"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "spans"])?;
    repo.write_commit_graph()?;
    Ok(repo)
}

/// Publish a baseline generation at the current HEAD (a rows-bearing baseline
/// the dirty tier's `load_head_baseline` reuses), then snapshot the store.
fn publish_and_snapshot(repo: &TestRepo) -> BTreeMap<&'static str, Vec<u8>> {
    let _ = run(repo.path(), &["stale"], Mode::NewStore, false);
    snapshot_store(repo.path())
}

/// Restore the baseline-only store, run `git span stale --format <fmt>` under
/// both the cache-off oracle and the store, and assert byte-identical stdout and
/// exit code across every format. Returns the concatenated store `--perf` stderr
/// so a caller can assert which cache-path class served the runs.
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
            "[{scenario}/{fmt}] store stdout != cache-off oracle\n\
             --- oracle ---\n{disabled}\n--- store ---\n{new_store}"
        );
        assert_eq!(
            new_code, dis_code,
            "[{scenario}/{fmt}] store exit code {new_code} != oracle {dis_code}"
        );
    }
    perf
}

/// THE F6 scenario: one uncommitted span is added over a warm committed corpus.
///
/// The committed corpus (alpha/beta/gamma) stays untouched; a single new,
/// uncommitted span `newbie` is added via `git span add` (never committed) and
/// its worktree source then drifts so the oracle output is non-empty. The store
/// run must:
///
/// * render byte-identically to the cache-off oracle (so the uncommitted span's
///   own finding is correct AND the committed spans are unchanged), and
/// * serve the committed corpus from the dirty tier's reuse — all three clean
///   committed spans reused, only `newbie` freshly resolved — rather than
///   bypassing the whole store to a full cold resolve, which is the regression.
#[test]
fn added_uncommitted_span_reuses_committed_corpus() -> Result<()> {
    let repo = build_committed_corpus()?;
    let snap = publish_and_snapshot(&repo);

    // Author a new span WITHOUT committing it — the documented `git span add`
    // window. It is Fresh at creation, so drift its worktree source to make it a
    // reported finding (the committed spans stay clean and unreported).
    repo.run_span(["add", "newbie", "src/n.txt#L1-L3"])?;
    repo.run_span(["why", "newbie", "-m", "why newbie"])?;
    repo.write_file("src/n.txt", "n-1CHANGED\nn-2x\nn-3x\nn-4\n")?;

    let perf = assert_parity_all_formats(&repo, &snap, "added-uncommitted");

    // The regression is a whole-store bypass; assert it is gone and the dirty
    // tier engaged instead.
    assert!(
        !perf.contains("bypass-reason: uncommitted-span-files"),
        "an uncommitted span must no longer bypass the whole store:\n{perf}"
    );
    assert!(
        perf.contains("cache-path.hit-class: dirty"),
        "the committed corpus must be served by the dirty reuse tier, not a \
         full authoritative bypass:\n{perf}"
    );
    // All three clean committed spans reused; only `newbie` re-resolved.
    assert!(
        perf.contains("cache-path.dirty-reused-spans 3"),
        "the three clean committed spans must be reused from cache, not \
         re-resolved:\n{perf}"
    );
    assert!(
        perf.contains("cache-path.dirty-resolved-spans 1"),
        "only the uncommitted span itself should be freshly resolved:\n{perf}"
    );
    Ok(())
}

/// A repeated identical uncommitted state becomes a plain exact hit: once the
/// dirty tier publishes the (committed + uncommitted) generation under its now
/// fully-keyed canonical key, a second identical invocation reads only the
/// compact summary — no rebuild — while still matching the oracle.
#[test]
fn repeated_uncommitted_state_is_exact_hit() -> Result<()> {
    let repo = build_committed_corpus()?;
    let _ = publish_and_snapshot(&repo);

    repo.run_span(["add", "newbie", "src/n.txt#L1-L3"])?;
    repo.run_span(["why", "newbie", "-m", "why newbie"])?;
    repo.write_file("src/n.txt", "n-1CHANGED\nn-2x\nn-3x\nn-4\n")?;

    // First run publishes the fully-keyed generation for this uncommitted state.
    let (first_out, _, _) = run(repo.path(), &["stale"], Mode::NewStore, false);
    // Second identical run must be a warm exact hit with no cold rebuild.
    let (second_out, second_err, _) = run(repo.path(), &["stale"], Mode::NewStore, true);
    let (oracle, _, _) = run(repo.path(), &["stale"], Mode::Disabled, false);

    assert_eq!(
        second_out, oracle,
        "repeated uncommitted-state run diverged from the cache-off oracle\n\
         --- oracle ---\n{oracle}\n--- store ---\n{second_out}"
    );
    assert_eq!(
        first_out, second_out,
        "the two identical uncommitted-state runs diverged from each other"
    );
    assert!(
        second_err.contains("cache-path.hit-class: exact"),
        "a repeated identical uncommitted state must be a warm exact hit:\n{second_err}"
    );
    assert!(
        !second_err.contains("cache-path.cold-miss-builds"),
        "a repeated identical uncommitted state must not trigger a cold \
         rebuild:\n{second_err}"
    );
    Ok(())
}

/// Correctness backstop: deleting the uncommitted span must drop it from the
/// output without a manual cache clear (the deletion changes the canonical key
/// via the withdrawn worktree-state entry, forcing an exact miss instead of a
/// stale replay), while the committed corpus continues to render identically to
/// the oracle.
#[test]
fn deleted_uncommitted_span_not_replayed_and_corpus_intact() -> Result<()> {
    let repo = build_committed_corpus()?;
    let snap = publish_and_snapshot(&repo);

    repo.run_span(["add", "newbie", "src/n.txt#L1-L3"])?;
    repo.run_span(["why", "newbie", "-m", "why newbie"])?;
    repo.write_file("src/n.txt", "n-1CHANGED\nn-2x\nn-3x\nn-4\n")?;

    // Warm the store with the uncommitted-span state present.
    let _ = run(repo.path(), &["stale"], Mode::NewStore, false);

    // Revert the drift and delete the uncommitted span file.
    repo.write_file("src/n.txt", "n-1\nn-2\nn-3\nn-4\n")?;
    std::fs::remove_file(repo.path().join(".span/newbie"))?;

    // The deleted span must not be replayed, and the committed corpus must match
    // the cache-off oracle byte-for-byte.
    restore_store(repo.path(), &snap);
    let (oracle, _, oracle_code) = run(repo.path(), &["stale"], Mode::Disabled, false);
    let (store, _, store_code) = run(repo.path(), &["stale"], Mode::NewStore, false);

    assert!(
        !store.contains("newbie"),
        "a deleted uncommitted span must not be served from cache:\n{store}"
    );
    assert_eq!(
        store, oracle,
        "store output after deletion diverged from the cache-off oracle\n\
         --- oracle ---\n{oracle}\n--- store ---\n{store}"
    );
    assert_eq!(
        store_code, oracle_code,
        "store exit code {store_code} != oracle {oracle_code} after deletion"
    );
    Ok(())
}
