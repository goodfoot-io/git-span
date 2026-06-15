//! Phase 6 — Synthetic size sweep: detects super-linear scaling in the cold
//! uncached resolver path.
//!
//! ## What is measured
//!
//! `stale_meshes` called with `EngineOptions::full()` and both
//! `GIT_MESH_CACHE_V2=0` and `GIT_MESH_CACHE=0` set, so every iteration
//! exercises the cold algorithmic path (`stale_meshes_inner`).  A warm cache
//! hit would measure cache machinery rather than the relocation scan and
//! reverse-walk bookkeeping that are the historical super-linear hazards.
//!
//! ## Sizes
//!
//! `[25, 150, 600, 2000]` meshes × `[with_commit_graph, without_commit_graph]`.
//!
//! ## Super-linearity gate
//!
//! After collecting latencies the bench computes the scaling exponent for
//! each adjacent pair (25→150, 150→600, 600→2000):
//!
//! ```text
//! exponent = log(t_B / t_A) / log(size_B / size_A)
//! ```
//!
//! If any exponent exceeds **1.5** the bench panics with a message naming
//! the offending pair.  All exponents and raw latencies are printed so
//! margins are visible even when passing.
//!
//! ## Invocation
//!
//! `cargo bench --bench size_sweep --features bench-corpus`
//!
//! This bench is **not** in `yarn validate` or default `yarn bench`.  The
//! 2000-mesh cold resolve is slow by design — that is the point.

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use git_mesh::{EngineOptions, stale_meshes};
use std::time::{Duration, Instant};

// -------------------------------------------------------------------------
// Sizes to sweep
// -------------------------------------------------------------------------

const SIZES: &[usize] = &[25, 150, 600, 2000];

// Exponent threshold: log(t_B/t_A) / log(size_B/size_A) > 1.5 → super-linear
const EXPONENT_THRESHOLD: f64 = 1.5;

// -------------------------------------------------------------------------
// Fixture
// -------------------------------------------------------------------------

struct Fixture {
    _dir: tempfile::TempDir,
    repo_path: std::path::PathBuf,
}

fn build_fixture(mesh_count: usize, with_commit_graph: bool) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path().to_path_buf();
    // Seed is stable; same seed + mesh_count → same commit SHAs.
    let seed: u64 = 0xdeadbeefcafe1234;
    git_mesh::bench_corpus::generate(&p, seed, mesh_count, with_commit_graph)
        .unwrap_or_else(|e| panic!("generate({mesh_count}, {with_commit_graph}): {e}"));
    Fixture {
        _dir: dir,
        repo_path: p,
    }
}

// -------------------------------------------------------------------------
// Cold resolver timing
// -------------------------------------------------------------------------

/// Time a single cold `stale_meshes` call.
///
/// Both `GIT_MESH_CACHE_V2` and `GIT_MESH_CACHE` must be `"0"` in the
/// environment before calling this (set once in `sweep_group`).
fn time_cold_stale(repo_path: &std::path::Path) -> Duration {
    let repo = gix::open(repo_path).expect("gix::open");
    let t0 = Instant::now();
    let out = stale_meshes(&repo, ".mesh", EngineOptions::full()).expect("stale_meshes");
    let elapsed = t0.elapsed();
    std::hint::black_box(out);
    elapsed
}

// -------------------------------------------------------------------------
// Scaling-exponent gate
// -------------------------------------------------------------------------

fn check_exponents(label: &str, sizes: &[usize], means_ms: &[f64]) {
    assert_eq!(sizes.len(), means_ms.len());

    println!("\n=== Size sweep: {label} ===");
    println!("{:<8} {:>12}", "size", "mean_ms");
    for (s, m) in sizes.iter().zip(means_ms.iter()) {
        println!("{:<8} {:>12.2}", s, m);
    }

    println!("\n{:<14} {:>10}", "pair", "exponent");
    let mut max_exponent: f64 = 0.0;
    let mut max_pair = String::new();

    for i in 0..sizes.len().saturating_sub(1) {
        let size_a = sizes[i] as f64;
        let size_b = sizes[i + 1] as f64;
        let t_a = means_ms[i];
        let t_b = means_ms[i + 1];

        if t_a <= 0.0 || t_b <= 0.0 {
            println!("{}→{}: skipped (zero latency)", sizes[i], sizes[i + 1]);
            continue;
        }

        let exponent = (t_b / t_a).ln() / (size_b / size_a).ln();
        let pair_label = format!("{}→{}", sizes[i], sizes[i + 1]);
        println!("{:<14} {:>10.4}", pair_label, exponent);

        if exponent > max_exponent {
            max_exponent = exponent;
            max_pair = pair_label;
        }
    }
    println!();

    if max_exponent > EXPONENT_THRESHOLD {
        panic!(
            "[size_sweep/{label}] super-linear growth detected: \
             {max_pair} exponent = {max_exponent:.4} (threshold {EXPONENT_THRESHOLD})"
        );
    }
}

// -------------------------------------------------------------------------
// Criterion bench group
// -------------------------------------------------------------------------

fn sweep_group(c: &mut Criterion, label: &str, with_commit_graph: bool) {
    // Force cold uncached resolver path for every stale_meshes() call in this
    // process.  Both switches must be set:
    //   GIT_MESH_CACHE_V2=0  — disables the SQLite v2 cache
    //   GIT_MESH_CACHE=0     — disables the older in-memory cache
    // Safety: this bench is single-threaded (criterion runs one bench at a
    // time) and these vars are set once before any timing begins.
    #[allow(deprecated)]
    unsafe {
        std::env::set_var("GIT_MESH_CACHE_V2", "0");
        std::env::set_var("GIT_MESH_CACHE", "0");
    }

    // Build all fixtures ONCE, outside the criterion timing loop.
    let fixtures: Vec<Fixture> = SIZES
        .iter()
        .map(|&n| build_fixture(n, with_commit_graph))
        .collect();

    // Collect one warm-up timing per size outside criterion to drive the
    // exponent gate.  Criterion's own measurements provide the official
    // latency numbers printed in the report; these pre-measurements are
    // solely for the super-linearity check.
    let pre_means_ms: Vec<f64> = fixtures
        .iter()
        .zip(SIZES.iter())
        .map(|(f, &mesh_count)| {
            // Take a few measurements and average them for the exponent gate.
            let reps = if mesh_count >= 600 { 3 } else { 5 };
            let total: Duration = (0..reps).map(|_| time_cold_stale(&f.repo_path)).sum();
            total.as_secs_f64() * 1000.0 / reps as f64
        })
        .collect();

    // Check exponents before entering the criterion loop so a detected
    // regression panics immediately (not after criterion's warmup phases).
    check_exponents(label, SIZES, &pre_means_ms);

    // Now run the criterion measurement loop for official timing output.
    let mut group = c.benchmark_group(format!("size_sweep/{label}"));
    group.sampling_mode(SamplingMode::Flat);

    for (&mesh_count, fixture) in SIZES.iter().zip(fixtures.iter()) {
        // criterion's minimum sample_size is 10; use that for all sizes.
        // The exponent gate already ran before this loop so wall-clock from
        // criterion's warmup is the dominant cost here, not the gate.
        group.sample_size(10);

        let bench_id = format!("{mesh_count}_meshes");
        group.bench_function(&bench_id, |b| {
            b.iter_custom(|iters| {
                (0..iters).map(|_| time_cold_stale(&fixture.repo_path)).sum()
            });
        });
    }

    group.finish();
}

fn bench_with_graph(c: &mut Criterion) {
    sweep_group(c, "with_commit_graph", true);
}

fn bench_without_graph(c: &mut Criterion) {
    sweep_group(c, "without_commit_graph", false);
}

criterion_group!(benches, bench_with_graph, bench_without_graph);
criterion_main!(benches);
