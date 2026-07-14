//! Phase 4 real-corpus scoreboard — drives the real `git-span` binary over the
//! workspace's own `.span/` corpus with an integrated byte-identical correctness
//! oracle (Phase 3).
//!
//! ## Corpus isolation
//! The bench clones the workspace via `git clone --local` into a `tempfile::TempDir`
//! so the developer's live `stale-cache.db` is never touched.  Cold iterations
//! delete only the clone's cache; warm iterations prime only the clone's cache.
//!
//! ## Oracle
//! Before the hot loop each cell runs the command twice: once with EVERY
//! persistent cache tier disabled (`GIT_SPAN_CACHE=0` AND
//! `GIT_SPAN_CACHE_V2=0` — ground truth) and once with the cache enabled.
//! The oracle asserts byte-identical stdout, a matching stderr contract, and
//! a matching exit status. This runs outside the timed window.
//!
//! ## Gates (collect-all-then-assert)
//! Each cell records a ROBUST median (warmup sample discarded) into a shared
//! scoreboard rather than asserting inline. The final `bench_report` step
//! prints the full scoreboard and evaluates two gates per op:
//!   - an absolute per-op ceiling (coarse guard against gross regression), and
//!   - a baseline-relative no-regression rule that is meaningfully TIGHTER than
//!     the ceiling (`baseline_median*(1+margin)+noise_floor`).
//!
//! ALL breaches are reported together and the bench fails ONCE at the end; one
//! noisy op never aborts the rest of the run. These gates are NOT in
//! `yarn validate` — see plan Phase 4.2.
//!
//! ## Baseline regression
//! If `benches/perf-baseline.json` is absent the regression rule is skipped
//! (the ceiling rule still runs).

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// SLA budget table (plan §4.2) — PROCESS-LEVEL ceilings
//
// All ceilings here are PROCESS-LEVEL: each measurement includes ~17ms binary
// startup + ~12ms gix::discover + corpus parse on top of the core work.  These
// are NOT the same as the in-process 40ms warm-clean SLA, which is enforced
// separately in benches/stale_warm.rs.
//
// Re-measured medians on this host (2026-06-15, POST-F6 — synthetic and real
// anchors resolve via canonical rk64; the corpus is genuinely fresh, so cold
// stale now does full resolution rather than short-circuiting):
//   list:        ~11–16 ms
//   tree:        ~10–16 ms
//   show:         ~7–10 ms
//   history:    ~130–176 ms
//   stale-cold: ~150–216 ms  (high variance under concurrent-build load)
//   stale-warm:  ~21–27 ms
//
// Ceilings are a COARSE guard set at ~2.5–3× the median to catch gross 2–3×
// regressions while ignoring host noise; the baseline-relative regression rule
// in perf-baseline.json is the tight signal and sits BELOW each ceiling. The
// stale-cold ceiling is 500ms: its ~180ms operating point under load needs the
// 35% regression band (≈246ms) to sit meaningfully below the ceiling, which a
// 250ms ceiling could not provide; 500ms still catches a gross >2.5× regression
// and is well within the plan's 900ms cold budget. The stale-warm ceiling is
// 200ms — NOT 40ms; 40ms is the in-process SLA in stale_warm.rs.
// ---------------------------------------------------------------------------
const SLA_LIST_MS: u64 = 250;    // post-F6 ~11–16ms; coarse guard, plan budget 250ms
const SLA_TREE_MS: u64 = 250;    // post-F6 ~10–16ms; coarse guard, plan budget 250ms
const SLA_SHOW_MS: u64 = 250;    // post-F6 ~7–10ms; coarse guard, plan budget 250ms
const SLA_HISTORY_MS: u64 = 750; // post-F6 ~130–176ms; coarse guard ~4× median
const SLA_STALE_COLD_MS: u64 = 500; // post-F6 ~150–216ms under load; coarse guard, below plan's 900ms budget
const SLA_STALE_WARM_MS: u64 = 200; // post-F6 ~21–27ms; coarse guard; NOT the in-process 40ms SLA
// `list <glob>` does the same corpus parse as bare `list` plus a glob filter, so
// its operating point tracks `list`; the same 250ms coarse guard applies to all
// three glob variants (selective subset, broad most-of-corpus, nomatch).
const SLA_LIST_GLOB_MS: u64 = 250; // mirrors SLA_LIST_MS; glob filter is cheap on top of the parse
// `stale --fix` does a full cold resolve AND rewrites every drifted span file on
// disk; it is strictly heavier than read-only `stale-cold` (~150–216ms under
// load). 1500ms is a generous coarse guard (~7–10× the read-only cold median)
// pending an orchestrator measurement of the real operating point.
const SLA_STALE_FIX_MS: u64 = 1500;
// `startup` measures pure process spawn with NO repo work: `git-span --version`
// parses args and exits before discovering a repo or loading the corpus. It
// isolates the fixed process-spawn cost so the other ops can be read as
// `work ≈ op_median − startup_median`. The ceiling is generous (100ms) — this
// cell is a baseline reference, not a tight gate, and carries no perf-baseline
// entry (the orchestrator owns baselines).
const SLA_STARTUP_MS: u64 = 100;

// ---------------------------------------------------------------------------
// Binary path — resolved at compile time by cargo
// ---------------------------------------------------------------------------
const SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");

// ---------------------------------------------------------------------------
// Corpus setup
// ---------------------------------------------------------------------------

/// Walk up from `CARGO_MANIFEST_DIR` to find the root that contains `.span/`.
fn find_workspace_root() -> Option<PathBuf> {
    let start = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    Path::new(&start)
        .ancestors()
        .find(|p| p.join(".span").is_dir())
        .map(|p| p.to_path_buf())
}

struct BenchRepo {
    _tmp: tempfile::TempDir,
    path: PathBuf,
}

/// Clone the workspace into a temp dir and return the isolated repo.
/// Returns `None` if the workspace has no `.span/` (skips all cells).
fn setup_bench_repo() -> Option<BenchRepo> {
    let workspace_root = match find_workspace_root() {
        Some(r) => r,
        None => {
            eprintln!("[real_corpus] SKIP: no .span/ directory found walking up from CARGO_MANIFEST_DIR");
            return None;
        }
    };

    let tmp = tempfile::TempDir::new().expect("tempdir");
    // `--local` uses hardlinks when src and dst share the same filesystem.
    // Fall back to `--no-hardlinks` (still a local clone, just copies objects)
    // when a cross-device situation prevents hardlinks.
    let src_str = workspace_root
        .to_str()
        .expect("workspace root is valid UTF-8");
    let dst_str = tmp.path().to_str().expect("tmp path is valid UTF-8");

    let status = Command::new("git")
        .args(["clone", "--local", src_str, dst_str])
        .status()
        .expect("spawn git clone");

    if !status.success() {
        // Retry without hardlinks (cross-device tmp or different filesystem).
        let status2 = Command::new("git")
            .args(["clone", "--no-hardlinks", src_str, dst_str])
            .status()
            .expect("spawn git clone --no-hardlinks");
        if !status2.success() {
            panic!(
                "[real_corpus] git clone failed (--local and --no-hardlinks both failed); \
                 exit code {:?}",
                status2.code()
            );
        }
    }

    let path = tmp.path().to_path_buf();
    Some(BenchRepo { _tmp: tmp, path })
}

/// List the span names present in the clone by reading `.span/` entries.
fn list_span_names(repo: &Path) -> Vec<String> {
    let span_dir = repo.join(".span");
    let mut names: Vec<String> = fs::read_dir(&span_dir)
        .unwrap_or_else(|e| panic!("read_dir .span: {e}"))
        .filter_map(|e| {
            let e = e.expect("dir entry");
            // Skip hidden files and the stale-cache dir; span names are plain files
            if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                e.file_name().to_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort();
    names
}

/// Build a tiny isolated repo whose single span anchors a file that lives
/// *inside* `.span/` (an interior-anchor corpus). The real `.span/` corpus has
/// no such shape, so this cell is the only one that exercises whether the cache
/// renders an interior anchor byte-identically to the cache-off ground truth.
///
/// The anchor's content hash is the canonical `rk64:<16hex>` token over the
/// committed bytes, so the anchor resolves fresh on a clean tree.
fn setup_interior_anchor_repo() -> BenchRepo {
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let p = tmp.path().to_path_buf();
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .current_dir(&p)
            .args(args)
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    git(&["init", "--initial-branch=main"]);
    git(&["config", "user.name", "Bench"]);
    git(&["config", "user.email", "bench@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);

    // Everything under `.span/` is parsed as a span file (the loader recurses),
    // so an interior anchor must point at an actual SPAN file — a span whose
    // anchor's path is itself inside `.span/`. Step 1: commit a plain span
    // `target` anchoring a normal source file, so `.span/target` exists with
    // stable committed content.
    let extent = git_span_core::AnchorExtent::LineRange { start: 1, end: 5 };
    let mk_hash = |bytes: &[u8]| {
        git_span_core::rk64_to_hex(git_span_core::cheap_fingerprint_with_extent(bytes, &extent))
    };

    let src_body: String = (0..20).map(|n| format!("source line {n}\n")).collect();
    fs::write(p.join("src.txt"), &src_body).expect("write src");
    fs::create_dir_all(p.join(".span")).expect("create .span");
    let target_mf = git_span::span_file::SpanFile {
        anchors: vec![git_span::span_file::AnchorRecord {
            path: "src.txt".to_string(),
            start_line: 1,
            end_line: 5,
            algorithm: git_span_core::RK64_ALGORITHM.into(),
            content_hash: mk_hash(src_body.as_bytes()),
        }],
        why: "interior-anchor corpus: ordinary target span".to_string(),
    };
    fs::write(p.join(".span").join("target"), target_mf.serialize()).expect("write target span");
    git(&["add", "-A"]);
    git(&["commit", "-m", "interior-anchor corpus: target span"]);

    // Step 2: commit a span `interior` whose anchor points INSIDE `.span/` — at
    // the committed bytes of `.span/target`. content_hash is the BARE 16-hex
    // rk64; the `algorithm` field supplies the `rk64` token so the serialized
    // address line is the canonical `.span/target#L1-L5 rk64:<16hex>`, and the
    // anchor resolves fresh against the now-committed `.span/target`.
    let target_bytes = fs::read(p.join(".span").join("target")).expect("read target span");
    let interior_mf = git_span::span_file::SpanFile {
        anchors: vec![git_span::span_file::AnchorRecord {
            path: ".span/target".to_string(),
            start_line: 1,
            end_line: 5,
            algorithm: git_span_core::RK64_ALGORITHM.into(),
            content_hash: mk_hash(&target_bytes),
        }],
        why: "interior-anchor corpus: anchor points inside .span/".to_string(),
    };
    fs::write(p.join(".span").join("interior"), interior_mf.serialize())
        .expect("write interior span");
    git(&["add", "-A"]);
    git(&["commit", "-m", "interior-anchor corpus: interior span"]);

    BenchRepo { _tmp: tmp, path: p }
}

/// Make the clone's working tree DIRTY by modifying one tracked file that is
/// NOT under `.span/` (so the change is an "unrelated source" edit, not a
/// span-file edit). Returns `true` if a file was dirtied, `false` if no
/// suitable tracked file exists (the cell then skips).
///
/// A dirty source edit forces `stale_spans_cached` past the warm-clean
/// early-return onto the warm-dirty / dirty-overlay path, where non-dirty-set
/// spans are rendered from the committed baseline. This is the path whose
/// byte-for-byte parity with the cache-off effective resolution this cell
/// guards. (Dirtying any tracked file is sufficient: even if the edited file
/// happens to be anchored, the remaining committed spans are non-affected and
/// exercise the divergence.)
fn dirty_one_tracked_file(repo: &Path) -> bool {
    let out = Command::new("git")
        .current_dir(repo)
        .args(["ls-files", "--", ":!.span/"])
        .output()
        .expect("git ls-files");
    let listing = String::from_utf8_lossy(&out.stdout);
    let target = listing
        .lines()
        .find(|p| !p.is_empty() && !p.starts_with(".span/"));
    let Some(rel) = target else {
        return false;
    };
    let path = repo.join(rel);
    let mut bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    // Append a byte the resolver will see as a worktree edit. A trailing
    // newline keeps the file textually valid and changes its worktree blob,
    // which is all the dirty-set detection needs.
    bytes.push(b'\n');
    fs::write(&path, &bytes).expect("write dirtied file");
    true
}

// ---------------------------------------------------------------------------
// stale --fix drift fixture
// ---------------------------------------------------------------------------

/// Anchored source files the `stale-fix` cell perturbs to manufacture drift.
/// Each is a real source file that several corpus anchors point at (verified
/// against `git span list`), so a one-line shift at the top moves every anchor
/// in those files past its committed line range — `--fix` then re-anchors them.
/// All three live under `packages/git-span/src/` and are tracked in the corpus.
const STALE_FIX_DRIFT_FILES: &[&str] = &[
    "packages/git-span/src/cli/mod.rs",
    "packages/git-span/src/main.rs",
    "packages/git-span/src/validation.rs",
];

/// Insert a blank line at the TOP of each `STALE_FIX_DRIFT_FILES` entry in the
/// clone, shifting every anchor in those files down one line so the resolver
/// classifies them as `Moved`/`Changed`. Returns `false` (cell skips) if any
/// target file is missing — the real corpus always has them, so this is a guard.
fn drift_stale_fix_sources(repo: &Path) -> bool {
    for rel in STALE_FIX_DRIFT_FILES {
        let path = repo.join(rel);
        let Ok(orig) = fs::read(&path) else {
            return false;
        };
        // Prepend one newline: a deterministic, textually-valid edit that shifts
        // every line (and thus every anchor's range) down by exactly one.
        let mut perturbed = Vec::with_capacity(orig.len() + 1);
        perturbed.push(b'\n');
        perturbed.extend_from_slice(&orig);
        fs::write(&path, &perturbed).unwrap_or_else(|e| panic!("perturb {rel}: {e}"));
    }
    true
}

/// Recursively copy `src` directory into `dst` (which is created fresh). A small
/// `std::fs`-only deep copy used to snapshot/restore the dirtied baseline; the
/// bench has no `fs_extra` dependency.
fn copy_dir_recursive(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap_or_else(|e| panic!("create_dir_all {}: {e}", dst.display()));
    for entry in fs::read_dir(src).unwrap_or_else(|e| panic!("read_dir {}: {e}", src.display())) {
        let entry = entry.expect("dir entry");
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type().expect("file_type").is_dir() {
            copy_dir_recursive(&from, &to);
        } else {
            fs::copy(&from, &to).unwrap_or_else(|e| panic!("copy {}: {e}", from.display()));
        }
    }
}

/// Snapshot of the dirtied-but-unfixed state the `stale-fix` cell restores
/// before every timed `--fix` invocation: the whole `.span/` tree plus the
/// perturbed source files, captured ONCE outside the timed region.
struct FixBaseline {
    _tmp: tempfile::TempDir,
    span_snapshot: PathBuf,
    source_snapshots: Vec<(PathBuf, PathBuf)>, // (live path in repo, snapshot path)
}

/// Capture the dirtied baseline (call after `drift_stale_fix_sources`): copies
/// the clone's `.span/` tree and each perturbed source file into a temp dir.
fn snapshot_fix_baseline(repo: &Path) -> FixBaseline {
    let tmp = tempfile::TempDir::new().expect("fix-baseline tempdir");
    let root = tmp.path();
    let span_snapshot = root.join("span");
    copy_dir_recursive(&repo.join(".span"), &span_snapshot);
    let source_snapshots = STALE_FIX_DRIFT_FILES
        .iter()
        .enumerate()
        .map(|(i, rel)| {
            let live = repo.join(rel);
            let snap = root.join(format!("src-{i}"));
            fs::copy(&live, &snap).unwrap_or_else(|e| panic!("snapshot {rel}: {e}"));
            (live, snap)
        })
        .collect();
    FixBaseline {
        _tmp: tmp,
        span_snapshot,
        source_snapshots,
    }
}

/// Restore the clone to the dirtied baseline: replace `.span/` with the snapshot
/// and rewrite every perturbed source file. Runs OUTSIDE the timed window so
/// each timed `--fix` starts from the identical dirtied-but-unfixed state.
fn restore_fix_baseline(repo: &Path, baseline: &FixBaseline) {
    let span_dir = repo.join(".span");
    if span_dir.exists() {
        fs::remove_dir_all(&span_dir).unwrap_or_else(|e| panic!("remove .span: {e}"));
    }
    copy_dir_recursive(&baseline.span_snapshot, &span_dir);
    for (live, snap) in &baseline.source_snapshots {
        fs::copy(snap, live).unwrap_or_else(|e| panic!("restore {}: {e}", live.display()));
    }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/// `<git_dir>/span/stale-cache.db` inside the clone — the `resolver/cache_v2`
/// SQLite tier, gated by `GIT_SPAN_CACHE_V2`.
fn cache_db_path(repo: &Path) -> PathBuf {
    repo.join(".git").join("span").join("stale-cache.db")
}

/// `<git_dir>/span/cache` inside the clone — the `resolver/cache` filesystem
/// tier, gated by `GIT_SPAN_CACHE`. Sibling to, NOT inside, `cache_db_path()`.
fn fs_cache_dir(repo: &Path) -> PathBuf {
    repo.join(".git").join("span").join("cache")
}

/// Delete EVERY persistent cache tier so a subsequent run is genuinely cold:
/// the SQLite database (plus WAL/SHM sidecars) and the filesystem cache
/// directory. Deleting only the SQLite file (the historical behavior here)
/// left the filesystem tier warm and any "cold" measurement or oracle run
/// downstream of it was not actually cold — see
/// `notes/investigation-question-log.md` Step 2, "Does the documented
/// cache-off oracle provide ground truth?".
fn delete_cache(repo: &Path) {
    let db = cache_db_path(repo);
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", db.display()));
        if path.exists() {
            fs::remove_file(&path).unwrap_or_else(|e| panic!("delete {}: {e}", path.display()));
        }
    }
    let fs_dir = fs_cache_dir(repo);
    if fs_dir.exists() {
        fs::remove_dir_all(&fs_dir).unwrap_or_else(|e| panic!("delete {}: {e}", fs_dir.display()));
    }
}

/// Run `git span stale --no-exit-code` to prime the cache.
fn prime_cache(repo: &Path) {
    let out = Command::new(SPAN_BIN)
        .current_dir(repo)
        .args(["stale", "--no-exit-code"])
        .output()
        .expect("prime stale");
    if !out.status.success() {
        eprintln!(
            "[real_corpus] cache prime stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/// Full captured result of one oracle invocation: stdout, stderr, and exit
/// status, so `assert_oracle` can compare all three between cache-on and
/// cache-off rather than stdout alone.
struct OracleOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i32>,
}

/// Run a command against the clone. When `cache_off` is set, ground truth
/// MUST disable every currently-existing persistent cache tier — both
/// `GIT_SPAN_CACHE` (the `resolver/cache` filesystem tier) and
/// `GIT_SPAN_CACHE_V2` (the `resolver/cache_v2` SQLite tier). Setting only
/// `GIT_SPAN_CACHE_V2=0` (the historical behavior here) left the filesystem
/// tier live, so a "cache-disabled" run could still be served partly from
/// cache — see `notes/investigation-question-log.md` Step 2, "Does the
/// documented cache-off oracle provide ground truth?".
fn run_oracle(repo: &Path, args: &[&str], cache_off: bool) -> OracleOutput {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).args(args);
    if cache_off {
        cmd.env("GIT_SPAN_CACHE", "0");
        cmd.env("GIT_SPAN_CACHE_V2", "0");
    }
    let out = cmd.output().unwrap_or_else(|e| panic!("spawn git-span {args:?}: {e}"));
    // Some commands exit non-zero when there is drift; that is fine for the oracle
    // — the exit CODE itself is compared below, just not asserted to be 0.
    OracleOutput {
        stdout: out.stdout,
        stderr: out.stderr,
        exit_code: out.status.code(),
    }
}

/// Capture stdout of a command run against the clone. Thin wrapper over
/// `run_oracle` for call sites that only need stdout (e.g. subset-consistency
/// checks that don't assert byte-identity).
fn capture_stdout(repo: &Path, args: &[&str], cache_off: bool) -> Vec<u8> {
    run_oracle(repo, args, cache_off).stdout
}

/// Assert that cache-on output equals cache-off output for the given args.
/// Compares stdout, the stderr contract, and exit status: none of these
/// oracle invocations pass `--perf`/`--perf-trace` (the only documented
/// source of intentional cache-state-dependent stderr output — see
/// `packages/git-span/docs/profiling.md`), so stderr is expected to be
/// byte-identical between cache-on and cache-off exactly like stdout.
fn assert_oracle(repo: &Path, op_name: &str, args: &[&str]) {
    // For stale cold oracle: ensure cache is absent for both runs.
    delete_cache(repo);
    let ground_truth = run_oracle(repo, args, true);
    delete_cache(repo);
    let cached = run_oracle(repo, args, false);

    if cached.stdout != ground_truth.stdout {
        let gt_str = String::from_utf8_lossy(&ground_truth.stdout);
        let cached_str = String::from_utf8_lossy(&cached.stdout);
        panic!(
            "[real_corpus] ORACLE FAIL (stdout) for '{op_name}':\n\
             --- ground_truth (cache off) ---\n{gt_str}\n\
             --- cached_output (cache on) ---\n{cached_str}"
        );
    }
    if cached.exit_code != ground_truth.exit_code {
        panic!(
            "[real_corpus] ORACLE FAIL (exit status) for '{op_name}': \
             cache-off exited {:?}, cache-on exited {:?}",
            ground_truth.exit_code, cached.exit_code
        );
    }
    if cached.stderr != ground_truth.stderr {
        let gt_str = String::from_utf8_lossy(&ground_truth.stderr);
        let cached_str = String::from_utf8_lossy(&cached.stderr);
        panic!(
            "[real_corpus] ORACLE FAIL (stderr) for '{op_name}':\n\
             --- ground_truth (cache off) ---\n{gt_str}\n\
             --- cached_output (cache on) ---\n{cached_str}"
        );
    }
}

/// Span names a `git span list [glob]` human run reported, parsed from the
/// `## <name>` block headers in its stdout. Used by the list-glob subset oracle
/// to assert a glob's matched spans are a subset of the bare-`list` corpus
/// WITHOUT depending on the exact human block layout.
fn list_block_names(stdout: &[u8]) -> std::collections::BTreeSet<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|l| l.strip_prefix("## ").map(|n| n.trim().to_string()))
        .collect()
}

/// Oracle for a `git span list <glob>` cell.
///
/// 1. DETERMINISM (the required part, mirroring the bare-`list` oracle): the
///    command's stdout is byte-identical with the cache live vs every
///    persistent cache tier disabled (`GIT_SPAN_CACHE=0` AND
///    `GIT_SPAN_CACHE_V2=0`). For `list` this is a determinism check, which is
///    exactly what the existing `list` cell asserts.
/// 2. SUBSET CONSISTENCY (cheap, span-name level): the spans a glob reports are
///    a subset of the bare-`list` corpus. `expect_proper_nonempty` additionally
///    asserts the matched set is non-empty AND strictly smaller than the whole
///    corpus (true for the selective and broad globs); the nomatch glob produces
///    empty stdout, so its matched set is the empty subset.
fn assert_oracle_list_glob(repo: &Path, op_name: &str, glob: &str, expect_proper_nonempty: bool) {
    // 1. Determinism: cache-on vs cache-off stdout must be byte-identical.
    let args = ["list", glob];
    assert_oracle(repo, op_name, &args);

    // 2. Subset consistency at the span-name level.
    let glob_names = list_block_names(&capture_stdout(repo, &args, false));
    let bare_names = list_block_names(&capture_stdout(repo, &["list"], false));
    assert!(
        glob_names.is_subset(&bare_names),
        "[real_corpus] ORACLE FAIL for '{op_name}': globbed spans are not a subset of bare `list`:\n\
         glob-only spans: {:?}",
        glob_names.difference(&bare_names).collect::<Vec<_>>()
    );
    if expect_proper_nonempty {
        assert!(
            !glob_names.is_empty(),
            "[real_corpus] ORACLE FAIL for '{op_name}': glob '{glob}' matched no spans \
             but was expected to match a non-empty subset"
        );
        assert!(
            glob_names.len() < bare_names.len(),
            "[real_corpus] ORACLE FAIL for '{op_name}': glob '{glob}' matched ALL {} spans \
             but was expected to match a PROPER subset",
            bare_names.len()
        );
    } else {
        assert!(
            glob_names.is_empty(),
            "[real_corpus] ORACLE FAIL for '{op_name}': nomatch glob '{glob}' matched spans {:?}",
            glob_names
        );
    }
}

/// Every `--format` value `git span stale` accepts (mirrors the
/// `StaleFormat` value-enum in `src/cli/mod.rs`, kebab-cased). The oracle
/// compares cache-on vs cache-off for ALL of these, not just the default
/// human output: only `json` currently exposes the divergent `current.blob`
/// field, but enforcing byte-identity across every format means a future
/// format-only divergence cannot hide.
const STALE_FORMATS: &[&str] = &["human", "porcelain", "json", "junit", "github-actions"];

/// Oracle for cold stale across ALL output formats. Cache is absent for both
/// runs of each format.
fn assert_oracle_stale_cold_all_formats(repo: &Path) {
    for fmt in STALE_FORMATS {
        let op = format!("stale-cold[--format {fmt}]");
        assert_oracle(repo, &op, &["stale", "--no-exit-code", "--format", fmt]);
    }
}

/// Oracle for warm stale across ALL output formats: prime the cache once,
/// then for each format compare a warm cache-on run against a cache-off
/// ground truth. Compares stdout, the stderr contract, and exit status —
/// see `assert_oracle`'s doc comment for why stderr is expected to match.
fn assert_oracle_stale_warm(repo: &Path) {
    for fmt in STALE_FORMATS {
        delete_cache(repo);
        prime_cache(repo);
        let args = ["stale", "--no-exit-code", "--format", fmt];
        // Ground truth: cache disabled (every tier). Warm run: cache primed above, kept.
        let ground_truth = run_oracle(repo, &args, true);
        let cached = run_oracle(repo, &args, false);
        let op = format!("stale-warm[--format {fmt}]");
        if cached.stdout != ground_truth.stdout {
            let gt_str = String::from_utf8_lossy(&ground_truth.stdout);
            let cached_str = String::from_utf8_lossy(&cached.stdout);
            panic!(
                "[real_corpus] ORACLE FAIL (stdout) for '{op}':\n\
                 --- ground_truth (cache off) ---\n{gt_str}\n\
                 --- cached_output (cache on) ---\n{cached_str}"
            );
        }
        if cached.exit_code != ground_truth.exit_code {
            panic!(
                "[real_corpus] ORACLE FAIL (exit status) for '{op}': \
                 cache-off exited {:?}, cache-on exited {:?}",
                ground_truth.exit_code, cached.exit_code
            );
        }
        if cached.stderr != ground_truth.stderr {
            let gt_str = String::from_utf8_lossy(&ground_truth.stderr);
            let cached_str = String::from_utf8_lossy(&cached.stderr);
            panic!(
                "[real_corpus] ORACLE FAIL (stderr) for '{op}':\n\
                 --- ground_truth (cache off) ---\n{gt_str}\n\
                 --- cached_output (cache on) ---\n{cached_str}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Robust statistics
// ---------------------------------------------------------------------------
//
// On a shared devcontainer host, an arithmetic MEAN over ~10 samples is
// dominated by occasional multi-hundred-ms stalls from concurrent cargo
// builds in sibling worktrees. A single such stall pulls the mean far above
// the true central tendency and false-trips a fixed ceiling. We therefore:
//   - discard one warmup sample (cold page cache / JIT-less but cold gix
//     object store on the first invocation), and
//   - report the MEDIAN, which is unaffected by a minority of outlier stalls.
// The median over (N-1) samples is the statistic every gate evaluates.

/// Median (ms) of accumulated samples after discarding the single lowest-index
/// warmup sample. Returns 0.0 for an empty input. The median is computed ONCE
/// over the FULL set of samples a cell accumulated across every criterion
/// invocation — not per-invocation — so a single concurrent-build stall in one
/// invocation is an outlier the median absorbs rather than a verdict on its own.
fn robust_median_ms(samples_ms: &[f64]) -> f64 {
    let body = if samples_ms.len() > 1 {
        &samples_ms[1..]
    } else {
        samples_ms
    };
    if body.is_empty() {
        return 0.0;
    }
    let mut ms: Vec<f64> = body.to_vec();
    ms.sort_by(|a, b| a.partial_cmp(b).expect("no NaN durations"));
    let n = ms.len();
    if n % 2 == 1 {
        ms[n / 2]
    } else {
        (ms[n / 2 - 1] + ms[n / 2]) / 2.0
    }
}

// ---------------------------------------------------------------------------
// Scoreboard — COLLECT-ALL-THEN-ASSERT
// ---------------------------------------------------------------------------
//
// Each cell ACCUMULATES its raw per-invocation samples into this global
// scoreboard instead of asserting inline. Criterion invokes a cell's
// `iter_custom` closure many times (warmup + measurement); every sample from
// every invocation lands in the same per-op buffer. A final reporting step
// (`bench_report`, registered last) computes ONE robust median per op over the
// full buffer, prints the scoreboard, evaluates every ceiling and the
// baseline-relative no-regression rule, and reports ALL breaches together —
// failing with a non-zero exit at the end if any real breach is found. One
// noisy invocation can never abort the rest of the run, and because the median
// spans every invocation a lone concurrent-build stall is absorbed as an
// outlier rather than judged in isolation.

/// Accumulated raw samples (ms) and the absolute ceiling for one op.
struct CellSamples {
    op: String,
    samples_ms: Vec<f64>,
    ceiling_ms: u64,
}

fn scoreboard() -> &'static std::sync::Mutex<Vec<CellSamples>> {
    static SCOREBOARD: std::sync::OnceLock<std::sync::Mutex<Vec<CellSamples>>> =
        std::sync::OnceLock::new();
    SCOREBOARD.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Append a cell invocation's raw samples to the op's accumulating buffer.
fn record_samples(op: &str, samples: &[Duration], ceiling_ms: u64) {
    let mut board = scoreboard().lock().expect("scoreboard mutex");
    let entry = if let Some(existing) = board.iter_mut().find(|r| r.op == op) {
        existing
    } else {
        board.push(CellSamples {
            op: op.to_string(),
            samples_ms: Vec::new(),
            ceiling_ms,
        });
        board.last_mut().expect("just pushed")
    };
    entry
        .samples_ms
        .extend(samples.iter().map(|d| d.as_secs_f64() * 1000.0));
}

// ---------------------------------------------------------------------------
// Layer-reads advisory board — ADVISORY ONLY (never a gate)
// ---------------------------------------------------------------------------
//
// The deterministic, filesystem-independent I/O proxy for `git span list`:
// the number of individual span-file content reads (`list.layer-reads`) and
// the spans parsed (`list.spans-parsed`) for each list cell, captured by one
// extra `GIT_SPAN_PERF=1` invocation OUTSIDE the timed region. `bench_report`
// prints one advisory line per op; absent counters render as `n/a`. This is a
// regression-tracking signal, NOT a gated assertion.

/// One list cell's captured layer-reads advisory: the op name and the two
/// parsed counts (`None` when the corresponding perf line was absent).
struct LayerReadsAdvisory {
    op: String,
    layer_reads: Option<u64>,
    spans_parsed: Option<u64>,
}

fn layer_reads_board() -> &'static std::sync::Mutex<Vec<LayerReadsAdvisory>> {
    static BOARD: std::sync::OnceLock<std::sync::Mutex<Vec<LayerReadsAdvisory>>> =
        std::sync::OnceLock::new();
    BOARD.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Record one list cell's captured layer-reads advisory for `bench_report`.
fn record_layer_reads(op: &str, layer_reads: Option<u64>, spans_parsed: Option<u64>) {
    layer_reads_board()
        .lock()
        .expect("layer-reads board mutex")
        .push(LayerReadsAdvisory {
            op: op.to_string(),
            layer_reads,
            spans_parsed,
        });
}

/// Baseline entry parsed from perf-baseline.json.
struct Baseline {
    median_ms: f64,
    noise_floor_ms: f64,
}

/// Read perf-baseline.json (median-schema) if present; `None` skips the
/// regression rule but never the ceiling rule.
fn load_baselines() -> Option<serde_json::Value> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let baseline_path = Path::new(&manifest).join("benches").join("perf-baseline.json");
    if !baseline_path.exists() {
        return None;
    }
    let contents = fs::read_to_string(&baseline_path)
        .unwrap_or_else(|e| panic!("read perf-baseline.json: {e}"));
    Some(serde_json::from_str(&contents).unwrap_or_else(|e| panic!("parse perf-baseline.json: {e}")))
}

fn baseline_for(json: &serde_json::Value, op: &str) -> Option<Baseline> {
    let entry = json.get(op)?;
    let median_ms = entry
        .get("median_ms")
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| panic!("perf-baseline.json: '{op}'.median_ms missing or not f64"));
    let noise_floor_ms = entry
        .get("noise_floor_ms")
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| panic!("perf-baseline.json: '{op}'.noise_floor_ms missing or not f64"));
    Some(Baseline {
        median_ms,
        noise_floor_ms,
    })
}

// Baseline-relative regression margin. A real regression in this codebase is a
// structural change (an extra corpus parse, a reintroduced per-run fork) that
// moves the median by a large, repeatable fraction — not the few-percent jitter
// of host noise. 35% sits above run-to-run median variance yet well below a 2x
// structural regression, so it flags real signals without false-tripping. The
// small additive `noise_floor_ms` per op (from perf-baseline.json) absorbs
// sub-millisecond medians where a percentage margin alone would be too tight.
// This baseline-relative threshold is MEANINGFULLY TIGHTER than the absolute
// per-op ceiling (which is ~2.5-3x the median), so a sub-ceiling structural
// regression still fails the regression rule rather than passing silently.
const REGRESSION_MARGIN: f64 = 0.35;

// ---------------------------------------------------------------------------
// Measured iter_custom helper
// ---------------------------------------------------------------------------

/// Time `n` process invocations of `args` (with no env override), returning all samples.
fn time_invocations(repo: &Path, args: &[&str], n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            let t0 = Instant::now();
            let out = Command::new(SPAN_BIN)
                .current_dir(repo)
                .args(args)
                .output()
                .unwrap_or_else(|e| panic!("spawn git-span {args:?}: {e}"));
            let elapsed = t0.elapsed();
            if !out.status.success() {
                // stale exits non-zero when drift is present; allow that.
                let _ignore = out.status.code();
            }
            elapsed
        })
        .collect()
}

/// Time `n` pure process-spawn invocations: `git-span --version`. `--version`
/// parses args and exits before discovering a repo or loading any corpus, so
/// the working directory is irrelevant — the temp dir keeps the spawn shape
/// identical to the other cells (`current_dir` set, output captured) while
/// measuring ONLY fixed process-spawn cost.
fn time_startup(dir: &Path, n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            let t0 = Instant::now();
            let out = Command::new(SPAN_BIN)
                .current_dir(dir)
                .arg("--version")
                .output()
                .expect("spawn git-span --version");
            let elapsed = t0.elapsed();
            assert!(
                out.status.success(),
                "git-span --version exited non-zero: {:?}",
                out.status.code()
            );
            elapsed
        })
        .collect()
}

/// Run `git span list [glob]` ONCE against the clone with `GIT_SPAN_PERF=1` and
/// return the `(list.layer-reads, list.spans-parsed)` counts parsed from the
/// perf lines on stderr. Either value is `None` if its line is absent (the
/// advisory printer renders `n/a` rather than panicking). Run OUTSIDE any timed
/// region — it adds a perf-logging invocation that does not belong in a sample.
fn capture_list_layer_reads(repo: &Path, glob: Option<&str>) -> (Option<u64>, Option<u64>) {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).env("GIT_SPAN_PERF", "1").arg("list");
    if let Some(g) = glob {
        cmd.arg(g);
    }
    let out = cmd.output().expect("spawn git-span list (perf capture)");
    let stderr = String::from_utf8_lossy(&out.stderr);
    let parse = |key: &str| -> Option<u64> {
        // Perf lines look like: `git-span perf: list.layer-reads 49`. Find the
        // line carrying the key, then parse the first integer that follows it.
        stderr.lines().find_map(|line| {
            let idx = line.find(key)?;
            line[idx + key.len()..]
                .split_whitespace()
                .next()
                .and_then(|n| n.parse::<u64>().ok())
        })
    };
    (parse("list.layer-reads"), parse("list.spans-parsed"))
}

/// Format an `Option<u64>` count as a decimal or `n/a` for the advisory line.
fn fmt_count(v: Option<u64>) -> String {
    v.map(|n| n.to_string()).unwrap_or_else(|| "n/a".to_string())
}

/// Time cold stale invocations (delete cache before each).
fn time_stale_cold(repo: &Path, n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            delete_cache(repo);
            let t0 = Instant::now();
            let _out = Command::new(SPAN_BIN)
                .current_dir(repo)
                .args(["stale", "--no-exit-code"])
                .output()
                .expect("spawn stale cold");
            t0.elapsed()
        })
        .collect()
}

/// Time warm stale invocations (prime once, then measure repeated runs).
fn time_stale_warm(repo: &Path, n: u64) -> Vec<Duration> {
    delete_cache(repo);
    prime_cache(repo);
    (0..n)
        .map(|_| {
            let t0 = Instant::now();
            let _out = Command::new(SPAN_BIN)
                .current_dir(repo)
                .args(["stale", "--no-exit-code"])
                .output()
                .expect("spawn stale warm");
            t0.elapsed()
        })
        .collect()
}

/// Time warm-DIRTY stale invocations: prime the cache ONCE on the
/// already-dirtied tree, then measure repeated runs. Each run takes the
/// warm-dirty path (a primed cache plus a dirty worktree), which renders the
/// committed baseline for unaffected spans and overlays the dirty set — the
/// path this card optimizes to scale with dirty-span count, not corpus size.
/// The caller dirties the tree BEFORE calling this.
fn time_dirty_tree_stale_warm(repo: &Path, n: u64) -> Vec<Duration> {
    delete_cache(repo);
    prime_cache(repo);
    (0..n)
        .map(|_| {
            let t0 = Instant::now();
            let _out = Command::new(SPAN_BIN)
                .current_dir(repo)
                .args(["stale", "--no-exit-code"])
                .output()
                .expect("spawn stale warm-dirty");
            t0.elapsed()
        })
        .collect()
}

/// Time `stale --fix` invocations. State reset is OUTSIDE the timed region:
/// before each sample the clone is restored to the dirtied baseline (so every
/// invocation does the same rewrite work), and ONLY the `git span stale --fix`
/// process is timed. `--fix` requires `--format human`; `--no-exit-code` keeps a
/// drift exit from being treated as failure.
fn time_stale_fix(repo: &Path, baseline: &FixBaseline, n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            restore_fix_baseline(repo, baseline);
            delete_cache(repo); // each sample is a cold fix, matching stale-cold
            let t0 = Instant::now();
            let _out = Command::new(SPAN_BIN)
                .current_dir(repo)
                .args(["stale", "--fix", "--no-exit-code"])
                .output()
                .expect("spawn stale --fix");
            t0.elapsed()
        })
        .collect()
}

/// Idempotence oracle for `stale --fix` (the important correctness gate). On a
/// SEPARATE throwaway clone — so it never perturbs the timing clone — manufacture
/// drift, run `--fix` once, snapshot the rewritten `.span/` tree, run `--fix` a
/// SECOND time, and assert the `.span/` tree is byte-identical: a second fix
/// makes NO further changes. (The second run still REPORTS the anchors as
/// moved-vs-committed-source — the source files stay perturbed — so a "zero
/// fixed" stdout assertion would not hold; on-disk idempotence is the invariant
/// that does, and is what we assert.)
fn assert_oracle_stale_fix_idempotent() {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return, // no .span/: nothing to check (cell also skips)
    };
    if !drift_stale_fix_sources(&repo.path) {
        eprintln!("[real_corpus] SKIP stale-fix idempotence oracle: drift source files missing");
        return;
    }

    let run_fix = || {
        Command::new(SPAN_BIN)
            .current_dir(&repo.path)
            .args(["stale", "--fix", "--no-exit-code"])
            .output()
            .expect("spawn stale --fix (oracle)");
    };

    // First fix: re-anchors the drifted spans in place.
    run_fix();
    let snap_tmp = tempfile::TempDir::new().expect("idempotence snapshot tempdir");
    let after_first = snap_tmp.path().join("span-after-fix1");
    copy_dir_recursive(&repo.path.join(".span"), &after_first);

    // Second fix on the now-fixed clone must change nothing on disk.
    run_fix();

    let mut diffs: Vec<String> = Vec::new();
    assert_dirs_byte_identical(&after_first, &repo.path.join(".span"), Path::new(""), &mut diffs);
    if !diffs.is_empty() {
        panic!(
            "[real_corpus] ORACLE FAIL for 'stale-fix' (idempotence): a second --fix changed \
             {} span path(s):\n  - {}",
            diffs.len(),
            diffs.join("\n  - ")
        );
    }
}

/// Recursively assert two directory trees are byte-identical, collecting every
/// divergent relative path into `diffs` (rather than panicking on the first).
fn assert_dirs_byte_identical(a: &Path, b: &Path, rel: &Path, diffs: &mut Vec<String>) {
    let mut a_entries: Vec<_> = fs::read_dir(a)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", a.display()))
        .map(|e| e.expect("dir entry").file_name())
        .collect();
    let mut b_entries: Vec<_> = fs::read_dir(b)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", b.display()))
        .map(|e| e.expect("dir entry").file_name())
        .collect();
    a_entries.sort();
    b_entries.sort();
    if a_entries != b_entries {
        diffs.push(format!(
            "{}: entry set differs ({:?} vs {:?})",
            rel.display(),
            a_entries,
            b_entries
        ));
        return;
    }
    for name in a_entries {
        let pa = a.join(&name);
        let pb = b.join(&name);
        let child_rel = rel.join(&name);
        if pa.is_dir() {
            assert_dirs_byte_identical(&pa, &pb, &child_rel, diffs);
        } else {
            let ba = fs::read(&pa).unwrap_or_else(|e| panic!("read {}: {e}", pa.display()));
            let bb = fs::read(&pb).unwrap_or_else(|e| panic!("read {}: {e}", pb.display()));
            if ba != bb {
                diffs.push(child_rel.display().to_string());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Bench groups
// ---------------------------------------------------------------------------

/// `startup` cell: pure process-spawn cost via `git-span --version`, which
/// parses args and exits without discovering a repo or loading the corpus. It
/// needs no `.span/` corpus, so it runs against a throwaway temp dir and is
/// never skipped. Recording its median lets the other ops be read as
/// `work ≈ op_median − startup_median`. No perf-baseline entry — the
/// orchestrator owns baselines — and the ceiling is a generous reference guard.
fn bench_startup(c: &mut Criterion) {
    let tmp = tempfile::TempDir::new().expect("startup tempdir");
    let dir = tmp.path();

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("startup", |b| {
        b.iter_custom(|iters| {
            let samples = time_startup(dir, iters);
            record_samples("startup", &samples, SLA_STARTUP_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_list(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    // Oracle
    assert_oracle(&repo.path, "list", &["list"]);

    // Advisory: capture the deterministic `list.layer-reads` and
    // `list.spans-parsed` counts for bare `list` (one extra perf-enabled
    // invocation, OUTSIDE the timed region). Printed near the scoreboard for
    // regression tracking; not a gated assertion.
    let (bare_reads, bare_spans) = capture_list_layer_reads(&repo.path, None);
    record_layer_reads("list", bare_reads, bare_spans);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("list", |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["list"], iters);
            record_samples("list", &samples, SLA_LIST_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_tree(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    // Oracle: tree requires at least one path argument — use "src/" which is a common root.
    // If src/ doesn't exist in this repo, fall back to a path that does.
    let tree_arg = if repo.path.join("src").is_dir() {
        "src/"
    } else if repo.path.join("packages").is_dir() {
        "packages/"
    } else {
        "."
    };

    assert_oracle(&repo.path, "tree", &["tree", tree_arg]);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("tree", |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["tree", tree_arg], iters);
            record_samples("tree", &samples, SLA_TREE_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_show(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    let names = list_span_names(&repo.path);
    if names.is_empty() {
        eprintln!("[real_corpus] SKIP show: no span files found");
        return;
    }
    let first = names[0].clone();

    assert_oracle(&repo.path, "show", &["show", &first]);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("show", |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["show", &first], iters);
            record_samples("show", &samples, SLA_SHOW_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_history(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    let names = list_span_names(&repo.path);
    if names.is_empty() {
        eprintln!("[real_corpus] SKIP history: no span files found");
        return;
    }
    let first = names[0].clone();

    assert_oracle(&repo.path, "history", &["history", &first]);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("history", |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["history", &first], iters);
            record_samples("history", &samples, SLA_HISTORY_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_stale_cold(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    // Oracle for cold stale across every output format (human, porcelain,
    // json, junit, github-actions). json is the format that historically
    // diverged cache-on vs cache-off via current.blob; the others are
    // regression insurance.
    assert_oracle_stale_cold_all_formats(&repo.path);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("stale-cold", |b| {
        b.iter_custom(|iters| {
            let samples = time_stale_cold(&repo.path, iters);
            record_samples("stale-cold", &samples, SLA_STALE_COLD_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_stale_warm(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    // Oracle for warm stale
    assert_oracle_stale_warm(&repo.path);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("stale-warm", |b| {
        b.iter_custom(|iters| {
            let samples = time_stale_warm(&repo.path, iters);
            record_samples("stale-warm", &samples, SLA_STALE_WARM_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

/// Interior-anchor corpus cell: a span anchored inside `.span/`. The real
/// `.span/` corpus has no interior anchor, so without this cell a cache
/// divergence specific to interior-anchor rendering would escape the oracle.
/// Compares cache-on vs cache-off across every stale output format both cold
/// and warm.
fn bench_interior_anchor(c: &mut Criterion) {
    let repo = setup_interior_anchor_repo();

    // Cold + warm oracle across all formats.
    assert_oracle_stale_cold_all_formats(&repo.path);
    assert_oracle_stale_warm(&repo.path);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);
    g.bench_function("interior-anchor-stale-cold", |b| {
        b.iter_custom(|iters| time_stale_cold(&repo.path, iters).iter().copied().sum());
    });
    g.finish();
}

/// Dirty-tree oracle cell: clone the real corpus, DIRTY one unrelated tracked
/// source file, then assert cache-on == cache-off across every stale format,
/// both cold and warm. The clean clone the other cells use never reaches the
/// warm-DIRTY / dirty-overlay path, so without this cell the committed_only
/// baseline that the dirty path renders for non-affected spans (a populated
/// `current.blob` and a "changed" vs "changed in the working tree" drift label)
/// could diverge from the effective cache-off ground truth unnoticed. Dirtying
/// the clone forces every subsequent stale run onto the dirty path.
fn bench_dirty_tree_oracle(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };
    if !dirty_one_tracked_file(&repo.path) {
        eprintln!("[real_corpus] SKIP dirty-tree oracle: no non-.span tracked file to dirty");
        return;
    }

    // Cold + warm oracle across all formats, now on a DIRTY working tree.
    assert_oracle_stale_cold_all_formats(&repo.path);
    assert_oracle_stale_warm(&repo.path);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);
    g.bench_function("dirty-tree-stale-cold", |b| {
        b.iter_custom(|iters| time_stale_cold(&repo.path, iters).iter().copied().sum());
    });
    // Warm-dirty timing cell: the path this card optimizes. Primed cache + dirty
    // tree, recorded under `dirty-tree-stale-warm` against the same per-op SLA
    // ceiling as warm-clean (`SLA_STALE_WARM_MS`) and gated by the
    // `dirty-tree-stale-warm` perf-baseline no-regression rule.
    g.bench_function("dirty-tree-stale-warm", |b| {
        b.iter_custom(|iters| {
            let samples = time_dirty_tree_stale_warm(&repo.path, iters);
            record_samples("dirty-tree-stale-warm", &samples, SLA_STALE_WARM_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

// ---------------------------------------------------------------------------
// list <glob> cells
// ---------------------------------------------------------------------------
//
// Globs chosen against the real corpus (verified via `git span list`):
//   selective: `packages/git-span/src/resolver/**` — matches a small subset
//              (~5 of 49 spans), the resolver subsystem.
//   broad:     `packages/**` — matches most spans (~37 of 49); a handful of
//              spans anchor only top-level files (CLAUDE.md, README.md, wiki/…)
//              and are correctly excluded, so even "broad" is a proper subset.
//   nomatch:   `zzz-nonexistent/**` — matches nothing; the command prints a
//              helpful message to STDERR, leaves stdout empty, and exits
//              non-zero (fail-closed). Empty stdout is deterministic across
//              cache-on/off, satisfying the determinism oracle.

/// A `git span list <glob>` cell: oracle (determinism + span-name subset), then
/// timed invocations recorded under `op` with `SLA_LIST_GLOB_MS`.
fn bench_list_glob(c: &mut Criterion, op: &str, glob: &str, expect_proper_nonempty: bool) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    assert_oracle_list_glob(&repo.path, op, glob, expect_proper_nonempty);

    // Advisory: capture the deterministic `list.layer-reads` /
    // `list.spans-parsed` counts for this glob (one extra perf-enabled
    // invocation, OUTSIDE the timed region). Printed near the scoreboard.
    let (reads, spans) = capture_list_layer_reads(&repo.path, Some(glob));
    record_layer_reads(op, reads, spans);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);
    g.bench_function(op, |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["list", glob], iters);
            record_samples(op, &samples, SLA_LIST_GLOB_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

fn bench_list_glob_selective(c: &mut Criterion) {
    bench_list_glob(
        c,
        "list-glob-selective",
        "packages/git-span/src/resolver/**",
        true,
    );
}

fn bench_list_glob_broad(c: &mut Criterion) {
    bench_list_glob(c, "list-glob-broad", "packages/**", true);
}

fn bench_list_glob_nomatch(c: &mut Criterion) {
    bench_list_glob(c, "list-glob-nomatch", "zzz-nonexistent/**", false);
}

/// `stale --fix` cell: a mutating command. The idempotence oracle runs first on
/// a SEPARATE throwaway clone; then this cell manufactures drift on its own
/// clone, snapshots the dirtied baseline ONCE, and times repeated cold `--fix`
/// runs that each restore the baseline OUTSIDE the timed window.
fn bench_stale_fix(c: &mut Criterion) {
    // Idempotence oracle on its own throwaway clone (does not touch timing clone).
    assert_oracle_stale_fix_idempotent();

    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };
    if !drift_stale_fix_sources(&repo.path) {
        eprintln!("[real_corpus] SKIP stale-fix: drift source files missing");
        return;
    }
    let baseline = snapshot_fix_baseline(&repo.path);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);
    g.bench_function("stale-fix", |b| {
        b.iter_custom(|iters| {
            let samples = time_stale_fix(&repo.path, &baseline, iters);
            record_samples("stale-fix", &samples, SLA_STALE_FIX_MS);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

/// Final step: print the full scoreboard and evaluate every gate at once.
///
/// COLLECT-ALL-THEN-ASSERT: each cell above only RECORDED its robust median.
/// Here we evaluate, for every recorded cell, both
///   1. the absolute per-op ceiling (a coarse guard against gross regression),
///      and
///   2. the baseline-relative no-regression rule
///      `median > baseline_median*(1+REGRESSION_MARGIN) + noise_floor_ms`
///      (the tight, structural-regression signal),
///
/// collecting ALL breaches and panicking ONCE at the end with the full list.
/// A single noisy op therefore never aborts the rest of the run, while a real
/// breach still fails the bench with a non-zero exit.
///
/// Registered LAST in the criterion group so every cell has recorded by the
/// time it runs.
fn bench_report(_c: &mut Criterion) {
    let results = scoreboard().lock().expect("scoreboard mutex");
    if results.is_empty() {
        eprintln!("[real_corpus] scoreboard empty (all cells skipped — no .span/)");
        return;
    }

    let baselines = load_baselines();

    println!(
        "\n=== real_corpus scoreboard (robust median over all samples, warmup discarded) ==="
    );
    println!(
        "{:<14} {:>8} {:>12} {:>12} {:>16}",
        "op", "n", "median_ms", "ceiling_ms", "regress_thresh_ms"
    );

    let mut breaches: Vec<String> = Vec::new();

    for r in results.iter() {
        let median_ms = robust_median_ms(&r.samples_ms);
        let n = r.samples_ms.len();
        let baseline = baselines.as_ref().and_then(|j| baseline_for(j, &r.op));
        let regress_thresh = baseline
            .as_ref()
            .map(|b| b.median_ms * (1.0 + REGRESSION_MARGIN) + b.noise_floor_ms);
        let thresh_str = match regress_thresh {
            Some(t) => format!("{t:.1}"),
            None => "-".to_string(),
        };
        println!(
            "{:<14} {:>8} {:>12.1} {:>12} {:>16}",
            r.op, n, median_ms, r.ceiling_ms, thresh_str
        );

        // 1. Absolute ceiling (coarse guard).
        if median_ms > r.ceiling_ms as f64 {
            breaches.push(format!(
                "CEILING '{}': median {:.1} ms (n={}) > ceiling {} ms",
                r.op, median_ms, n, r.ceiling_ms
            ));
        }
        // 2. Baseline-relative regression (tight, structural signal).
        if let (Some(t), Some(b)) = (regress_thresh, baseline.as_ref())
            && median_ms > t
        {
            breaches.push(format!(
                "REGRESSION '{}': median {:.1} ms (n={}) > baseline_median {:.1} * {:.2} \
                 + noise_floor {:.1} = {:.1} ms",
                r.op,
                median_ms,
                n,
                b.median_ms,
                1.0 + REGRESSION_MARGIN,
                b.noise_floor_ms,
                t
            ));
        }
    }
    println!();

    // Advisory layer-reads line (deterministic I/O proxy; NOT a gate). Renders
    // each captured list cell as `op=<reads>(<spans>)`, or `n/a` when a counter
    // line was absent. Printed even when no cells captured (then it is empty).
    let advisories = layer_reads_board().lock().expect("layer-reads board mutex");
    if !advisories.is_empty() {
        let cells: Vec<String> = advisories
            .iter()
            .map(|a| {
                format!(
                    "{}={}({})",
                    a.op,
                    fmt_count(a.layer_reads),
                    fmt_count(a.spans_parsed)
                )
            })
            .collect();
        println!(
            "list-cell layer-reads (reads(spans), advisory only): {}",
            cells.join(" ")
        );
        println!();
    }

    if !breaches.is_empty() {
        panic!(
            "[real_corpus] {} gate breach(es) detected (all cells were still measured):\n  - {}",
            breaches.len(),
            breaches.join("\n  - ")
        );
    }
}

criterion_group!(
    benches,
    bench_startup,
    bench_list,
    bench_tree,
    bench_show,
    bench_history,
    bench_stale_cold,
    bench_stale_warm,
    bench_interior_anchor,
    bench_dirty_tree_oracle,
    bench_list_glob_selective,
    bench_list_glob_broad,
    bench_list_glob_nomatch,
    bench_stale_fix,
    bench_report
);
criterion_main!(benches);
