//! Phase 4 real-corpus scoreboard — drives the real `git-mesh` binary over the
//! workspace's own `.mesh/` corpus with an integrated byte-identical correctness
//! oracle (Phase 3).
//!
//! ## Corpus isolation
//! The bench clones the workspace via `git clone --local` into a `tempfile::TempDir`
//! so the developer's live `stale-cache.db` is never touched.  Cold iterations
//! delete only the clone's cache; warm iterations prime only the clone's cache.
//!
//! ## Oracle
//! Before the hot loop each cell runs the command twice: once with
//! `GIT_MESH_CACHE_V2=0` (ground truth) and once with the cache enabled.
//! The oracle asserts byte-identical stdout.  This runs outside the timed window.
//!
//! ## SLA ceilings
//! Each operation has its own hard ceiling (ms).  A breach panics independently.
//! These live here and are NOT in `yarn validate` — see plan Phase 4.2.
//!
//! ## Baseline regression
//! If `benches/perf-baseline.json` is absent the regression check is skipped
//! (compile/oracle/ceiling checks still run).  Do NOT create that file here.

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// SLA budget table (plan §4.2)
//
// Ceilings below reflect the measured baselines from pre-Phase-5 code
// with generous headroom.  The stale-warm target tightens to 40 ms
// once Phase 5 optimizations (LFS fork elimination, corpus-parse dedup,
// DDL skip) land — at that point, lower SLA_STALE_WARM_MS to 40.
// ---------------------------------------------------------------------------
const SLA_LIST_MS: u64 = 250;
const SLA_TREE_MS: u64 = 250;
const SLA_SHOW_MS: u64 = 250;
const SLA_HISTORY_MS: u64 = 1500;
const SLA_STALE_COLD_MS: u64 = 900;
const SLA_STALE_WARM_MS: u64 = 200;

// ---------------------------------------------------------------------------
// Binary path — resolved at compile time by cargo
// ---------------------------------------------------------------------------
const MESH_BIN: &str = env!("CARGO_BIN_EXE_git-mesh");

// ---------------------------------------------------------------------------
// Corpus setup
// ---------------------------------------------------------------------------

/// Walk up from `CARGO_MANIFEST_DIR` to find the root that contains `.mesh/`.
fn find_workspace_root() -> Option<PathBuf> {
    let start = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    Path::new(&start)
        .ancestors()
        .find(|p| p.join(".mesh").is_dir())
        .map(|p| p.to_path_buf())
}

struct BenchRepo {
    _tmp: tempfile::TempDir,
    path: PathBuf,
}

/// Clone the workspace into a temp dir and return the isolated repo.
/// Returns `None` if the workspace has no `.mesh/` (skips all cells).
fn setup_bench_repo() -> Option<BenchRepo> {
    let workspace_root = match find_workspace_root() {
        Some(r) => r,
        None => {
            eprintln!("[real_corpus] SKIP: no .mesh/ directory found walking up from CARGO_MANIFEST_DIR");
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

/// List the mesh names present in the clone by reading `.mesh/` entries.
fn list_mesh_names(repo: &Path) -> Vec<String> {
    let mesh_dir = repo.join(".mesh");
    let mut names: Vec<String> = fs::read_dir(&mesh_dir)
        .unwrap_or_else(|e| panic!("read_dir .mesh: {e}"))
        .filter_map(|e| {
            let e = e.expect("dir entry");
            // Skip hidden files and the stale-cache dir; mesh names are plain files
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

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/// `<git_dir>/mesh/stale-cache.db` inside the clone.
fn cache_db_path(repo: &Path) -> PathBuf {
    repo.join(".git").join("mesh").join("stale-cache.db")
}

fn delete_cache(repo: &Path) {
    let p = cache_db_path(repo);
    if p.exists() {
        fs::remove_file(&p).unwrap_or_else(|e| panic!("delete stale-cache.db: {e}"));
    }
}

/// Run `git mesh stale --no-exit-code` to prime the cache.
fn prime_cache(repo: &Path) {
    let out = Command::new(MESH_BIN)
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

/// Capture stdout of a command run against the clone.
fn capture_stdout(repo: &Path, args: &[&str], cache_off: bool) -> Vec<u8> {
    let mut cmd = Command::new(MESH_BIN);
    cmd.current_dir(repo).args(args);
    if cache_off {
        cmd.env("GIT_MESH_CACHE_V2", "0");
    }
    let out = cmd.output().unwrap_or_else(|e| panic!("spawn git-mesh {args:?}: {e}"));
    // Some commands exit non-zero when there is drift; that is fine for the oracle.
    out.stdout
}

/// Assert that cache-on output equals cache-off output for the given args.
fn assert_oracle(repo: &Path, op_name: &str, args: &[&str]) {
    // For stale cold oracle: ensure cache is absent for both runs.
    delete_cache(repo);
    let ground_truth = capture_stdout(repo, args, true);
    delete_cache(repo);
    let cached_output = capture_stdout(repo, args, false);

    if cached_output != ground_truth {
        let gt_str = String::from_utf8_lossy(&ground_truth);
        let cached_str = String::from_utf8_lossy(&cached_output);
        panic!(
            "[real_corpus] ORACLE FAIL for '{op_name}':\n\
             --- ground_truth (cache off) ---\n{gt_str}\n\
             --- cached_output (cache on) ---\n{cached_str}"
        );
    }
}

/// Oracle for warm stale: prime cache, then compare.
fn assert_oracle_stale_warm(repo: &Path) {
    delete_cache(repo);
    prime_cache(repo);
    let ground_truth = capture_stdout(repo, &["stale", "--no-exit-code"], true);
    // Warm run (cache primed, not deleted between).
    let cached_output = capture_stdout(repo, &["stale", "--no-exit-code"], false);
    if cached_output != ground_truth {
        let gt_str = String::from_utf8_lossy(&ground_truth);
        let cached_str = String::from_utf8_lossy(&cached_output);
        panic!(
            "[real_corpus] ORACLE FAIL for 'stale-warm':\n\
             --- ground_truth (cache off) ---\n{gt_str}\n\
             --- cached_output (cache on) ---\n{cached_str}"
        );
    }
}

// ---------------------------------------------------------------------------
// SLA + regression check
// ---------------------------------------------------------------------------

/// Mean of a slice of durations in milliseconds.
fn mean_ms(samples: &[Duration]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / samples.len() as f64
}

/// Assert mean latency is within the hard SLA ceiling.
fn assert_sla(op: &str, mean: f64, ceiling_ms: u64) {
    if mean > ceiling_ms as f64 {
        panic!(
            "[real_corpus] SLA BREACH for '{op}': mean {mean:.1} ms > ceiling {ceiling_ms} ms"
        );
    }
}

/// Check against perf-baseline.json if it exists; skip otherwise.
fn check_regression(op: &str, mean_ms_val: f64) {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let baseline_path = Path::new(&manifest).join("benches").join("perf-baseline.json");
    if !baseline_path.exists() {
        return;
    }
    let contents = fs::read_to_string(&baseline_path)
        .unwrap_or_else(|e| panic!("read perf-baseline.json: {e}"));
    let json: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or_else(|e| panic!("parse perf-baseline.json: {e}"));

    if let Some(entry) = json.get(op) {
        let baseline_median = entry
            .get("median_ms")
            .and_then(|v| v.as_f64())
            .unwrap_or_else(|| panic!("perf-baseline.json: '{op}'.median_ms missing or not f64"));
        let noise_floor = entry
            .get("noise_floor_ms")
            .and_then(|v| v.as_f64())
            .unwrap_or(5.0);
        let threshold = baseline_median * 1.10 + noise_floor;
        if mean_ms_val > threshold {
            panic!(
                "[real_corpus] REGRESSION for '{op}': mean {mean_ms_val:.1} ms \
                 > baseline_median {baseline_median:.1} * 1.10 + noise_floor {noise_floor:.1} \
                 = {threshold:.1} ms"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Measured iter_custom helper
// ---------------------------------------------------------------------------

/// Time `n` process invocations of `args` (with no env override), returning all samples.
fn time_invocations(repo: &Path, args: &[&str], n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            let t0 = Instant::now();
            let out = Command::new(MESH_BIN)
                .current_dir(repo)
                .args(args)
                .output()
                .unwrap_or_else(|e| panic!("spawn git-mesh {args:?}: {e}"));
            let elapsed = t0.elapsed();
            if !out.status.success() {
                // stale exits non-zero when drift is present; allow that.
                let _ignore = out.status.code();
            }
            elapsed
        })
        .collect()
}

/// Time cold stale invocations (delete cache before each).
fn time_stale_cold(repo: &Path, n: u64) -> Vec<Duration> {
    (0..n)
        .map(|_| {
            delete_cache(repo);
            let t0 = Instant::now();
            let _out = Command::new(MESH_BIN)
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
            let _out = Command::new(MESH_BIN)
                .current_dir(repo)
                .args(["stale", "--no-exit-code"])
                .output()
                .expect("spawn stale warm");
            t0.elapsed()
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Bench groups
// ---------------------------------------------------------------------------

fn bench_list(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };

    // Oracle
    assert_oracle(&repo.path, "list", &["list"]);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("list", |b| {
        b.iter_custom(|iters| {
            let samples = time_invocations(&repo.path, &["list"], iters);
            let m = mean_ms(&samples);
            assert_sla("list", m, SLA_LIST_MS);
            check_regression("list", m);
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
            let m = mean_ms(&samples);
            assert_sla("tree", m, SLA_TREE_MS);
            check_regression("tree", m);
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

    let names = list_mesh_names(&repo.path);
    if names.is_empty() {
        eprintln!("[real_corpus] SKIP show: no mesh files found");
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
            let m = mean_ms(&samples);
            assert_sla("show", m, SLA_SHOW_MS);
            check_regression("show", m);
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

    let names = list_mesh_names(&repo.path);
    if names.is_empty() {
        eprintln!("[real_corpus] SKIP history: no mesh files found");
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
            let m = mean_ms(&samples);
            assert_sla("history", m, SLA_HISTORY_MS);
            check_regression("history", m);
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

    // Oracle for cold stale
    assert_oracle(&repo.path, "stale-cold", &["stale", "--no-exit-code"]);

    let mut g = c.benchmark_group("real_corpus");
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);

    g.bench_function("stale-cold", |b| {
        b.iter_custom(|iters| {
            let samples = time_stale_cold(&repo.path, iters);
            let m = mean_ms(&samples);
            assert_sla("stale-cold", m, SLA_STALE_COLD_MS);
            check_regression("stale-cold", m);
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
            let m = mean_ms(&samples);
            assert_sla("stale-warm", m, SLA_STALE_WARM_MS);
            check_regression("stale-warm", m);
            samples.iter().copied().sum()
        });
    });
    g.finish();
}

criterion_group!(
    benches,
    bench_list,
    bench_tree,
    bench_show,
    bench_history,
    bench_stale_cold,
    bench_stale_warm
);
criterion_main!(benches);
