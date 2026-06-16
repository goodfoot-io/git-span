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

/// Build a tiny isolated repo whose single mesh anchors a file that lives
/// *inside* `.mesh/` (an interior-anchor corpus). The real `.mesh/` corpus has
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

    // Everything under `.mesh/` is parsed as a mesh file (the loader recurses),
    // so an interior anchor must point at an actual MESH file — a mesh whose
    // anchor's path is itself inside `.mesh/`. Step 1: commit a plain mesh
    // `target` anchoring a normal source file, so `.mesh/target` exists with
    // stable committed content.
    let extent = git_mesh_core::AnchorExtent::LineRange { start: 1, end: 5 };
    let mk_hash = |bytes: &[u8]| {
        git_mesh_core::rk64_to_hex(git_mesh_core::cheap_fingerprint_with_extent(bytes, &extent))
    };

    let src_body: String = (0..20).map(|n| format!("source line {n}\n")).collect();
    fs::write(p.join("src.txt"), &src_body).expect("write src");
    fs::create_dir_all(p.join(".mesh")).expect("create .mesh");
    let target_mf = git_mesh::mesh_file::MeshFile {
        anchors: vec![git_mesh::mesh_file::AnchorRecord {
            path: "src.txt".to_string(),
            start_line: 1,
            end_line: 5,
            algorithm: git_mesh_core::RK64_ALGORITHM.into(),
            content_hash: mk_hash(src_body.as_bytes()),
        }],
        why: "interior-anchor corpus: ordinary target mesh".to_string(),
    };
    fs::write(p.join(".mesh").join("target"), target_mf.serialize()).expect("write target mesh");
    git(&["add", "-A"]);
    git(&["commit", "-m", "interior-anchor corpus: target mesh"]);

    // Step 2: commit a mesh `interior` whose anchor points INSIDE `.mesh/` — at
    // the committed bytes of `.mesh/target`. content_hash is the BARE 16-hex
    // rk64; the `algorithm` field supplies the `rk64` token so the serialized
    // address line is the canonical `.mesh/target#L1-L5 rk64:<16hex>`, and the
    // anchor resolves fresh against the now-committed `.mesh/target`.
    let target_bytes = fs::read(p.join(".mesh").join("target")).expect("read target mesh");
    let interior_mf = git_mesh::mesh_file::MeshFile {
        anchors: vec![git_mesh::mesh_file::AnchorRecord {
            path: ".mesh/target".to_string(),
            start_line: 1,
            end_line: 5,
            algorithm: git_mesh_core::RK64_ALGORITHM.into(),
            content_hash: mk_hash(&target_bytes),
        }],
        why: "interior-anchor corpus: anchor points inside .mesh/".to_string(),
    };
    fs::write(p.join(".mesh").join("interior"), interior_mf.serialize())
        .expect("write interior mesh");
    git(&["add", "-A"]);
    git(&["commit", "-m", "interior-anchor corpus: interior mesh"]);

    BenchRepo { _tmp: tmp, path: p }
}

/// Make the clone's working tree DIRTY by modifying one tracked file that is
/// NOT under `.mesh/` (so the change is an "unrelated source" edit, not a
/// mesh-file edit). Returns `true` if a file was dirtied, `false` if no
/// suitable tracked file exists (the cell then skips).
///
/// A dirty source edit forces `stale_meshes_cached` past the warm-clean
/// early-return onto the warm-dirty / dirty-overlay path, where non-dirty-set
/// meshes are rendered from the committed baseline. This is the path whose
/// byte-for-byte parity with the cache-off effective resolution this cell
/// guards. (Dirtying any tracked file is sufficient: even if the edited file
/// happens to be anchored, the remaining committed meshes are non-affected and
/// exercise the divergence.)
fn dirty_one_tracked_file(repo: &Path) -> bool {
    let out = Command::new("git")
        .current_dir(repo)
        .args(["ls-files", "--", ":!.mesh/"])
        .output()
        .expect("git ls-files");
    let listing = String::from_utf8_lossy(&out.stdout);
    let target = listing
        .lines()
        .find(|p| !p.is_empty() && !p.starts_with(".mesh/"));
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

/// Every `--format` value `git mesh stale` accepts (mirrors the
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
/// ground truth.
fn assert_oracle_stale_warm(repo: &Path) {
    for fmt in STALE_FORMATS {
        delete_cache(repo);
        prime_cache(repo);
        let args = ["stale", "--no-exit-code", "--format", fmt];
        // Ground truth: cache disabled. Warm run: cache primed above, kept.
        let ground_truth = capture_stdout(repo, &args, true);
        let cached_output = capture_stdout(repo, &args, false);
        if cached_output != ground_truth {
            let gt_str = String::from_utf8_lossy(&ground_truth);
            let cached_str = String::from_utf8_lossy(&cached_output);
            panic!(
                "[real_corpus] ORACLE FAIL for 'stale-warm[--format {fmt}]':\n\
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

/// Interior-anchor corpus cell: a mesh anchored inside `.mesh/`. The real
/// `.mesh/` corpus has no interior anchor, so without this cell a cache
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
/// baseline that the dirty path renders for non-affected meshes (a populated
/// `current.blob` and a "changed" vs "changed in the working tree" drift label)
/// could diverge from the effective cache-off ground truth unnoticed. Dirtying
/// the clone forces every subsequent stale run onto the dirty path.
fn bench_dirty_tree_oracle(c: &mut Criterion) {
    let repo = match setup_bench_repo() {
        Some(r) => r,
        None => return,
    };
    if !dirty_one_tracked_file(&repo.path) {
        eprintln!("[real_corpus] SKIP dirty-tree oracle: no non-.mesh tracked file to dirty");
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
        eprintln!("[real_corpus] scoreboard empty (all cells skipped — no .mesh/)");
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
    bench_list,
    bench_tree,
    bench_show,
    bench_history,
    bench_stale_cold,
    bench_stale_warm,
    bench_interior_anchor,
    bench_dirty_tree_oracle,
    bench_report
);
criterion_main!(benches);
