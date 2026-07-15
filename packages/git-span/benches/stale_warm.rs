//! Phase 3 step 8: warm-run SLA benchmark for `git span stale`.
//!
//! Two scenarios:
//!   cold — clear the one persistent cache before each iteration: the SQLite
//!          store (`<git_dir>/span/store.db[-wal|-shm]`), the only cache after
//!          the Phase 7 cutover deleted both legacy tiers. Deleting the store
//!          (plus its WAL/SHM sidecars) is a genuine cold start.
//!   warm — measure subsequent runs after a priming cold run
//!
//! The warm mean must be `< 40 ms` before the SLA appears in user-facing copy.

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use git_span::{EngineOptions, stale_spans};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

struct Fixture {
    _dir: tempfile::TempDir,
    repo_path: PathBuf,
}

/// Build a fixture with ≥9 spans / ≥22 anchors across multiple files.
///
/// Layout:
///   - 12 source files, each with 30 lines
///   - 10 commits that mutate the files so the resolver has real history to walk
///   - 9 spans (27 anchors total) anchored AFTER the mutations, against the
///     final committed content, so every anchor resolves FRESH
fn build_fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path().to_path_buf();
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

    // Create 12 source files, each 30 lines.
    for i in 0..12u32 {
        let body: String = (0..30).map(|n| format!("line{i}_{n}\n")).collect();
        fs::write(p.join(format!("src-{i}.txt")), body).expect("write");
    }
    git(&["add", "."]);
    git(&["commit", "-m", "seed"]);

    // 10 mutations so the warm cache has meaningful history to walk.
    //
    // These run BEFORE the spans are anchored so the anchors hash the FINAL
    // (post-mutation) committed content and resolve FRESH. Anchoring against
    // the seed content and then mutating would leave every anchor `— changed`,
    // i.e. the all-changed fiction F6 calls out — the warm path would then
    // measure a changed workload, not the fresh corpus this fixture documents.
    for round in 0..10u32 {
        for i in 0..12u32 {
            let body: String = (0..30)
                .map(|n| format!("round{round}_line{i}_{n}\n"))
                .collect();
            fs::write(p.join(format!("src-{i}.txt")), body).expect("write");
        }
        git(&["add", "."]);
        git(&["commit", "-m", &format!("mutate round {round}")]);
    }

    // 9 spans, each with 3 anchors across different files (27 anchors total).
    // Build all span files via library API so renamed symbols fail at compile time.
    fs::create_dir_all(p.join(".span")).expect("create .span");
    for m in 0..9u32 {
        let slug = format!("span-{m}");
        let file_indices = [m % 12, (m + 1) % 12, (m + 2) % 12];
        let ranges: [(u32, u32); 3] = [(1, 10), (11, 20), (21, 30)];

        let mut records = Vec::new();
        for (fi, (start, end)) in file_indices.iter().zip(ranges.iter()) {
            let filename = format!("src-{fi}.txt");
            let body = fs::read(p.join(&filename)).expect("read file");
            // Canonical rk64 anchor over the SAME LineRange extent the anchor
            // declares, fed the committed bytes. `content_hash` is the BARE
            // 16-hex rk64 value; the `algorithm` field supplies the `rk64`
            // token, so the serialized address line is the canonical
            // `<path>#L<s>-L<e> rk64:<16hex>` and resolves fresh on this tree.
            // The prior `format!("sha256:{}", sha256_hex(..))` with
            // `algorithm: "rk64"` produced the malformed `rk64:sha256:<64hex>`,
            // so every anchor resolved `— changed` and the warm fixture
            // measured an all-changed fiction instead of the fresh corpus it
            // documents.
            let extent = git_span_core::AnchorExtent::LineRange {
                start: *start,
                end: *end,
            };
            let fp = git_span_core::cheap_fingerprint_with_extent(&body, &extent);
            let hash = git_span_core::rk64_to_hex(fp);
            records.push(git_span::span_file::AnchorRecord {
                path: filename,
                start_line: *start,
                end_line: *end,
                algorithm: git_span_core::RK64_ALGORITHM.into(),
                content_hash: hash,
            });
        }

        let mf = git_span::span_file::SpanFile {
            anchors: records,
            why: format!("span {m} covers files around {m}"),
        };
        fs::write(p.join(".span").join(&slug), mf.serialize()).expect("write span file");
    }
    git(&["add", ".span"]);
    git(&["commit", "-m", "add spans"]);

    Fixture {
        _dir: dir,
        repo_path: p,
    }
}

/// Path to the one active SQLite store (`resolver/store`) inside a repo's
/// `.git`. This is the sole persistent cache after the Phase 7 cutover.
fn store_db(repo_path: &std::path::Path) -> PathBuf {
    repo_path.join(".git").join("span").join("store.db")
}

/// Clear the one persistent cache to simulate a cold start: the SQLite store
/// database plus its WAL/SHM sidecar files. There is a single tier now (the
/// cutover deleted both legacy caches), so this is a true cold start.
fn clear_cache(repo_path: &std::path::Path) {
    let db = store_db(repo_path);
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", db.display()));
        if path.exists() {
            fs::remove_file(&path).unwrap_or_else(|e| panic!("remove {}: {e}", path.display()));
        }
    }
}

fn bench_cold(c: &mut Criterion) {
    let f = build_fixture();
    let mut g = c.benchmark_group("stale");
    // Cold runs are slow; 10 samples keeps total bench time reasonable.
    g.sample_size(10);
    g.sampling_mode(SamplingMode::Flat);
    g.bench_function("cold", |b| {
        b.iter(|| {
            clear_cache(&f.repo_path);
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale");
            std::hint::black_box(out);
        });
    });
    g.finish();
}

fn bench_warm(c: &mut Criterion) {
    let f = build_fixture();
    // Prime the cache with one cold run before measuring.
    {
        clear_cache(&f.repo_path);
        let repo = gix::open(&f.repo_path).expect("open repo");
        stale_spans(&repo, ".span", EngineOptions::full()).expect("prime");
    }

    // ---------------------------------------------------------------------------
    // In-process warm-clean SLA gate (40 ms hard ceiling).
    //
    // This is NOT a process-level budget — it measures only the cache machinery
    // (lazy LFS, single config snapshot, DDL-skip) with no process-spawn overhead.
    // The gate runs N iterations outside Criterion's window and evaluates the
    // MEDIAN (warmup sample discarded), not the arithmetic mean. On a shared
    // devcontainer host a single concurrent-build stall would pull a mean over
    // 30 samples above the ceiling and false-trip; the median is unaffected by a
    // minority of outlier stalls, so it distinguishes a real warm-clean
    // regression from host noise.
    // ---------------------------------------------------------------------------
    {
        const SLA_WARM_MS: f64 = 40.0;
        const N: u32 = 30;
        let mut samples_ms: Vec<f64> = (0..N)
            .map(|_| {
                let repo = gix::open(&f.repo_path).expect("open repo");
                let t0 = std::time::Instant::now();
                let out = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale");
                let elapsed = t0.elapsed();
                std::hint::black_box(out);
                elapsed.as_secs_f64() * 1000.0
            })
            .collect();
        // Discard the first (warmup) sample, then take the median.
        let body = &mut samples_ms[1..];
        body.sort_by(|a, b| a.partial_cmp(b).expect("no NaN durations"));
        let n = body.len();
        let median_ms = if n % 2 == 1 {
            body[n / 2]
        } else {
            (body[n / 2 - 1] + body[n / 2]) / 2.0
        };
        if median_ms > SLA_WARM_MS {
            panic!(
                "[stale_warm] warm-clean SLA breach: median {median_ms:.1} ms > {SLA_WARM_MS} ms \
                 (in-process median over {} iterations, warmup discarded; \
                 this is NOT process-level overhead)",
                N - 1
            );
        }
    }

    let mut g = c.benchmark_group("stale");
    g.bench_function("warm", |b| {
        b.iter(|| {
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale");
            std::hint::black_box(out);
        });
    });
    g.finish();
}

/// Warm run with the cache disabled (`GIT_SPAN_CACHE=0`).
///
/// After the Phase 7 cutover `GIT_SPAN_CACHE=0` is the single "disable all
/// caching" switch: it bypasses the one SQLite store entirely (there is no
/// longer any separate tier to leave live). This benchmark therefore measures
/// a genuinely cache-disabled warm path.
///
/// Documents the relative gap between the cached and fully-uncached warm paths.
/// The warm-no-cache mean minus the warm mean is the store's whole
/// contribution.
fn bench_warm_no_cache(c: &mut Criterion) {
    let f = build_fixture();
    // Prime filesystem and gix object store with a cold run (cache disabled).
    {
        clear_cache(&f.repo_path);
        // SAFETY: bench process is single-threaded; no other threads read
        // GIT_SPAN_CACHE concurrently.
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var("GIT_SPAN_CACHE", "0");
        }
        let repo = gix::open(&f.repo_path).expect("open repo");
        stale_spans(&repo, ".span", EngineOptions::full()).expect("prime");
    }
    let mut g = c.benchmark_group("stale");
    g.bench_function("warm-no-cache", |b| {
        b.iter(|| {
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale");
            std::hint::black_box(out);
        });
    });
    g.finish();
    #[allow(unused_unsafe)]
    unsafe {
        std::env::remove_var("GIT_SPAN_CACHE");
    }
}

criterion_group!(benches, bench_cold, bench_warm, bench_warm_no_cache);
criterion_main!(benches);
