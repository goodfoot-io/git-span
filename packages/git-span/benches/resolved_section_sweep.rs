//! Synthetic size sweep for `[resolved]` three-way merge lookup scaling.
//!
//! Fixtures have unequal sides so the no-op shortcut cannot satisfy the merge.
//! Their construction is outside every timed region. Each size is reduced to a
//! robust median after discarding its warmup sample, then adjacent-size scaling
//! exponents are checked with the same threshold and jitter band as the broader
//! resolver size sweep.

use criterion::{BenchmarkId, Criterion, SamplingMode, criterion_group, criterion_main};
use git_span_core::span_file::{
    ResolveCommand, ResolvedRecord, SpanFile, resolve_resolved_section,
};
use std::time::{Duration, Instant};

const SIZES: &[usize] = &[256, 1024, 4096, 16_384];
const EXPONENT_THRESHOLD: f64 = 1.5;
const EXPONENT_BAND: f64 = 0.15;
const REPS: usize = 9;

struct Fixture {
    base: SpanFile,
    ours: SpanFile,
    theirs: SpanFile,
}

fn record(side: &str, index: usize) -> ResolvedRecord {
    ResolvedRecord {
        timestamp: "2026-08-14T00:00:00Z".into(),
        command: ResolveCommand::Add,
        path: format!("src/{side}-{index:05}.rs"),
        start_line: index as u32 + 1,
        end_line: index as u32 + 1,
        algorithm: "rk64".into(),
        content_hash: format!("{index:016x}"),
    }
}

fn span(resolved: Vec<ResolvedRecord>) -> SpanFile {
    SpanFile {
        anchors: Vec::new(),
        why: String::new(),
        resolved,
        config: Default::default(),
    }
}

fn build_fixture(size: usize) -> Fixture {
    // The shared base identities force genuine three-way lookups. Each side
    // also contributes a deterministic, disjoint tail, with deliberately
    // unequal lengths to keep every fixture away from the no-op fast path.
    let base = span((0..size).map(|i| record("shared", i)).collect());
    let mut ours_records = base.resolved.clone();
    ours_records.extend((0..size / 4).map(|i| record("ours", i)));
    let mut theirs_records = base.resolved.clone();
    theirs_records.extend((0..size / 2).map(|i| record("theirs", i)));

    Fixture {
        base,
        ours: span(ours_records),
        theirs: span(theirs_records),
    }
}

fn time_merge(fixture: &Fixture) -> Duration {
    let start = Instant::now();
    let result = resolve_resolved_section(
        Some(std::hint::black_box(&fixture.base)),
        std::hint::black_box(&fixture.ours),
        std::hint::black_box(&fixture.theirs),
    );
    let elapsed = start.elapsed();
    std::hint::black_box(result);
    elapsed
}

fn robust_median_ms(samples: &[f64]) -> f64 {
    let mut measured = samples[1..].to_vec();
    measured.sort_by(|a, b| a.partial_cmp(b).expect("duration cannot be NaN"));
    let middle = measured.len() / 2;
    if measured.len() % 2 == 0 {
        (measured[middle - 1] + measured[middle]) / 2.0
    } else {
        measured[middle]
    }
}

fn check_exponents(medians_ms: &[f64]) {
    println!("\n=== Resolved section sweep (robust median, warmup discarded) ===");
    println!("{:<10} {:>12}", "records", "median_ms");
    for (size, median) in SIZES.iter().zip(medians_ms) {
        println!("{size:<10} {median:>12.3}");
    }

    let fail_at = EXPONENT_THRESHOLD + EXPONENT_BAND;
    let mut breaches = Vec::new();
    for (sizes, times) in SIZES.windows(2).zip(medians_ms.windows(2)) {
        let exponent = (times[1] / times[0]).ln() / (sizes[1] as f64 / sizes[0] as f64).ln();
        println!("{}->{:<6} exponent {exponent:.4}", sizes[0], sizes[1]);
        if exponent > fail_at {
            breaches.push(format!(
                "{}->{} exponent {exponent:.4} > {fail_at:.2}",
                sizes[0], sizes[1]
            ));
        }
    }

    assert!(
        breaches.is_empty(),
        "[resolved_section_sweep] super-linear growth detected:\n  - {}",
        breaches.join("\n  - ")
    );
}

fn resolved_section_sweep(c: &mut Criterion) {
    let fixtures: Vec<Fixture> = SIZES.iter().map(|&size| build_fixture(size)).collect();
    let medians_ms: Vec<f64> = fixtures
        .iter()
        .map(|fixture| {
            let samples: Vec<f64> = (0..REPS)
                .map(|_| time_merge(fixture).as_secs_f64() * 1000.0)
                .collect();
            robust_median_ms(&samples)
        })
        .collect();
    check_exponents(&medians_ms);

    let mut group = c.benchmark_group("resolved_section_sweep");
    group.sampling_mode(SamplingMode::Flat);
    group.sample_size(10);
    for (&size, fixture) in SIZES.iter().zip(&fixtures) {
        group.bench_with_input(BenchmarkId::from_parameter(size), fixture, |b, fixture| {
            b.iter(|| {
                std::hint::black_box(resolve_resolved_section(
                    Some(std::hint::black_box(&fixture.base)),
                    std::hint::black_box(&fixture.ours),
                    std::hint::black_box(&fixture.theirs),
                ))
            });
        });
    }
    group.finish();
}

criterion_group!(benches, resolved_section_sweep);
criterion_main!(benches);
