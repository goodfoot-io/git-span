//! Phase 6 — Synthetic size sweep: detects super-linear scaling in the cold
//! uncached resolver path.
//!
//! ## What is measured
//!
//! `stale_spans` called with `EngineOptions::full()` and `GIT_SPAN_CACHE=0`
//! set — the single "disable all caching" switch the Phase 7 cutover left as
//! the only cache control — so every iteration exercises the cold algorithmic
//! path (`stale_spans_inner`).  A warm store hit would measure cache machinery
//! rather than the relocation scan and reverse-walk bookkeeping that are the
//! historical super-linear hazards.
//!
//! ## Sizes
//!
//! `[25, 150, 600, 2000]` spans × `[with_commit_graph, without_commit_graph]`.
//!
//! ## Super-linearity gate
//!
//! Each size is measured several times (`reps_for`) and reduced to a ROBUST
//! MEDIAN with the warmup rep discarded — a per-size median, not a mean, so a
//! transient slowdown on the smaller size cannot inflate `t_A` and deflate the
//! exponent below threshold (the false-negative that would mask a real
//! regression). The bench then computes the scaling exponent for each adjacent
//! pair (25→150, 150→600, 600→2000):
//!
//! ```text
//! exponent = log(t_B / t_A) / log(size_B / size_A)
//! ```
//!
//! A pair fails when its exponent exceeds `1.5 + EXPONENT_BAND` (the band
//! absorbs residual jitter without swallowing a genuine super-linear signal).
//! ALL breaching pairs are collected and the bench panics ONCE at the end
//! (collect-all-then-evaluate) so one noisy pair never aborts the sweep. All
//! medians and exponents are printed so margins are visible even when passing.
//!
//! ## Invocation
//!
//! `cargo bench --bench size_sweep --features bench-corpus`
//!
//! This bench is **not** in `yarn validate` or default `yarn bench`.  The
//! 2000-span cold resolve is slow by design — that is the point.

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use git_span::{EngineOptions, stale_spans};
use std::time::{Duration, Instant};

// -------------------------------------------------------------------------
// Sizes to sweep
// -------------------------------------------------------------------------

const SIZES: &[usize] = &[25, 150, 600, 2000];

// Exponent threshold: log(t_B/t_A) / log(size_B/size_A) > 1.5 → super-linear.
const EXPONENT_THRESHOLD: f64 = 1.5;

// Significance band on the exponent. An adjacent pair fails only when its
// exponent exceeds EXPONENT_THRESHOLD + BAND. The band absorbs the residual
// run-to-run jitter that survives the per-size median (a few hundredths of an
// exponent on these sizes) so a clean linear sweep does not false-panic. It is
// deliberately small — the dangerous direction is a FALSE NEGATIVE (a real
// super-linear regression masked by noise), so the band must not be wide enough
// to swallow a genuine >1.5 growth signal.
const EXPONENT_BAND: f64 = 0.15;

// Reps per size, MEDIAN-reduced with the first (warmup) rep discarded. The
// warmup rep pays the cold page-cache / gix object-store open cost that would
// otherwise skew a small-size measurement low and mask growth. Larger sizes use
// fewer reps because each 2000-span cold resolve is expensive; the median over
// the remaining reps is still robust to a single concurrent-build stall. The
// per-size median (not a mean) is what kills the masking failure: a transient
// slowdown on the SMALLER size would inflate t_A under a mean and silently
// deflate the ratio below threshold; the median discards that outlier.
fn reps_for(span_count: usize) -> usize {
    if span_count >= 600 { 5 } else { 7 }
}

/// Median of measured millisecond samples after discarding the first (warmup)
/// sample.
fn robust_median_ms(samples: &[f64]) -> f64 {
    let body = if samples.len() > 1 {
        &samples[1..]
    } else {
        samples
    };
    let mut v: Vec<f64> = body.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN durations"));
    let n = v.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

// -------------------------------------------------------------------------
// Fixture
// -------------------------------------------------------------------------

struct Fixture {
    _dir: tempfile::TempDir,
    repo_path: std::path::PathBuf,
}

fn build_fixture(span_count: usize, with_commit_graph: bool) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path().to_path_buf();
    // Seed is stable; same seed + span_count → same commit SHAs.
    let seed: u64 = 0xdeadbeefcafe1234;
    git_span::bench_corpus::generate(&p, seed, span_count, with_commit_graph)
        .unwrap_or_else(|e| panic!("generate({span_count}, {with_commit_graph}): {e}"));
    Fixture {
        _dir: dir,
        repo_path: p,
    }
}

// -------------------------------------------------------------------------
// Cold resolver timing
// -------------------------------------------------------------------------

/// Time a single cold `stale_spans` call.
///
/// `GIT_SPAN_CACHE` must be `"0"` in the environment before calling this
/// (set once in `sweep_group`) so the store is disabled and the cold path runs.
fn time_cold_stale(repo_path: &std::path::Path) -> Duration {
    let repo = gix::open(repo_path).expect("gix::open");
    let t0 = Instant::now();
    let out = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale_spans");
    let elapsed = t0.elapsed();
    std::hint::black_box(out);
    elapsed
}

// -------------------------------------------------------------------------
// Scaling-exponent gate
// -------------------------------------------------------------------------

/// Evaluate the per-adjacent-pair scaling exponent on per-size ROBUST MEDIANS.
///
/// COLLECT-ALL-THEN-EVALUATE: every pair is computed and printed, ALL
/// breaching pairs are collected, and the function panics ONCE at the end with
/// the full list — a single noisy pair never aborts the sweep before the rest
/// is reported. A pair fails only when its exponent exceeds
/// `EXPONENT_THRESHOLD + EXPONENT_BAND` (the band tolerates residual jitter that
/// survives the median without swallowing a genuine super-linear signal).
fn check_exponents(label: &str, sizes: &[usize], medians_ms: &[f64]) {
    assert_eq!(sizes.len(), medians_ms.len());

    println!("\n=== Size sweep: {label} (per-size robust median, warmup discarded) ===");
    println!("{:<8} {:>12}", "size", "median_ms");
    for (s, m) in sizes.iter().zip(medians_ms.iter()) {
        println!("{:<8} {:>12.2}", s, m);
    }

    let fail_at = EXPONENT_THRESHOLD + EXPONENT_BAND;
    println!(
        "\n{:<14} {:>10}   (fail if exponent > {:.2} = {:.1} + band {:.2})",
        "pair", "exponent", fail_at, EXPONENT_THRESHOLD, EXPONENT_BAND
    );

    let mut breaches: Vec<String> = Vec::new();

    for i in 0..sizes.len().saturating_sub(1) {
        let size_a = sizes[i] as f64;
        let size_b = sizes[i + 1] as f64;
        let t_a = medians_ms[i];
        let t_b = medians_ms[i + 1];

        if t_a <= 0.0 || t_b <= 0.0 {
            println!("{}→{}: skipped (zero latency)", sizes[i], sizes[i + 1]);
            continue;
        }

        let exponent = (t_b / t_a).ln() / (size_b / size_a).ln();
        let pair_label = format!("{}→{}", sizes[i], sizes[i + 1]);
        println!("{:<14} {:>10.4}", pair_label, exponent);

        if exponent > fail_at {
            breaches.push(format!(
                "{pair_label} exponent = {exponent:.4} > {fail_at:.2} \
                 (threshold {EXPONENT_THRESHOLD} + band {EXPONENT_BAND})"
            ));
        }
    }
    println!();

    if !breaches.is_empty() {
        panic!(
            "[size_sweep/{label}] super-linear growth detected ({} pair(s); \
             all pairs were still measured):\n  - {}",
            breaches.len(),
            breaches.join("\n  - ")
        );
    }
}

// -------------------------------------------------------------------------
// Criterion bench group
// -------------------------------------------------------------------------

fn sweep_group(c: &mut Criterion, label: &str, with_commit_graph: bool) {
    // Force cold uncached resolver path for every stale_spans() call in this
    // process. One switch disables the one cache:
    //   GIT_SPAN_CACHE=0  — the single "disable all caching" control; bypasses
    //                       the SQLite store entirely (Phase 7 cutover).
    // Safety: this bench is single-threaded (criterion runs one bench at a
    // time) and this var is set once before any timing begins.
    #[allow(deprecated)]
    unsafe {
        std::env::set_var("GIT_SPAN_CACHE", "0");
    }

    // Build all fixtures ONCE, outside the criterion timing loop.
    let fixtures: Vec<Fixture> = SIZES
        .iter()
        .map(|&n| build_fixture(n, with_commit_graph))
        .collect();

    // Collect per-size ROBUST MEDIANS (warmup rep discarded) outside criterion
    // to drive the exponent gate. Criterion's own measurements provide the
    // official latency numbers printed in the report; these pre-measurements
    // are solely for the super-linearity check. A median (not a mean) is what
    // prevents a transient slowdown on a smaller size from inflating t_A and
    // deflating the exponent below threshold — the false-negative direction the
    // gate must guard against.
    let pre_medians_ms: Vec<f64> = fixtures
        .iter()
        .zip(SIZES.iter())
        .map(|(f, &span_count)| {
            let reps = reps_for(span_count);
            let samples: Vec<f64> = (0..reps)
                .map(|_| time_cold_stale(&f.repo_path).as_secs_f64() * 1000.0)
                .collect();
            robust_median_ms(&samples)
        })
        .collect();

    // All sizes are measured above; evaluate the full exponent gate here
    // (collect-all-then-evaluate) before the criterion loop so a real
    // regression fails fast without first paying criterion's warmup phases.
    check_exponents(label, SIZES, &pre_medians_ms);

    // Now run the criterion measurement loop for official timing output.
    let mut group = c.benchmark_group(format!("size_sweep/{label}"));
    group.sampling_mode(SamplingMode::Flat);

    for (&span_count, fixture) in SIZES.iter().zip(fixtures.iter()) {
        // criterion's minimum sample_size is 10; use that for all sizes.
        // The exponent gate already ran before this loop so wall-clock from
        // criterion's warmup is the dominant cost here, not the gate.
        group.sample_size(10);

        let bench_id = format!("{span_count}_spans");
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
