//! Phase 3 step 8: warm-run SLA benchmark for `git mesh stale`.
//!
//! Two scenarios:
//!   cold — delete `<git_dir>/mesh/cache/` before each iteration
//!   warm — measure subsequent runs after a priming cold run
//!
//! The warm mean must be `< 40 ms` before the SLA appears in user-facing copy.

use criterion::{Criterion, SamplingMode, criterion_group, criterion_main};
use git_mesh::{EngineOptions, stale_meshes};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

struct Fixture {
    _dir: tempfile::TempDir,
    repo_path: PathBuf,
}

/// Build a fixture with ≥9 meshes / ≥22 anchors across multiple files.
///
/// Layout:
///   - 12 source files, each with 30 lines
///   - 9 meshes, each covering 3 files with ~3 anchors each (27 anchors total)
///   - 10 commits that mutate the files so the resolver has real work to cache
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

    let mesh_bin = env!("CARGO_BIN_EXE_git-mesh");
    let mesh = |args: &[&str]| {
        let out = Command::new(mesh_bin)
            .current_dir(&p)
            .args(args)
            .output()
            .expect("git-mesh");
        assert!(out.status.success(), "git-mesh {args:?} failed: {out:?}");
    };

    // 9 meshes, each with 3 anchors across different files (27 anchors total).
    for m in 0..9u32 {
        let slug = format!("mesh-{m}");
        let f0 = format!("src-{}.txt#L1-L10", m % 12);
        let f1 = format!("src-{}.txt#L11-L20", (m + 1) % 12);
        let f2 = format!("src-{}.txt#L21-L30", (m + 2) % 12);
        mesh(&["add", &slug, &f0, &f1, &f2]);
        mesh(&["why", &slug, "-m", &format!("mesh {m} covers files around {m}")]);
        mesh(&["commit", &slug]);
    }

    // 10 mutations so caching has meaningful history to walk.
    for round in 0..10u32 {
        for i in 0..12u32 {
            let body: String = (0..30)
                .map(|n| format!("round{round}_line{i}_{n}\n"))
                .collect();
            fs::write(p.join(format!("src-{i}.txt")), body).expect("write");
        }
        git(&["add", "."]);
        git(&[
            "commit",
            "-m",
            &format!("mutate round {round}"),
        ]);
    }

    Fixture {
        _dir: dir,
        repo_path: p,
    }
}

/// Path to the SQLite cache directory inside a repo's `.git`.
fn cache_dir(repo_path: &std::path::Path) -> PathBuf {
    repo_path.join(".git").join("mesh").join("cache")
}

/// Delete and recreate the cache directory to simulate a cold start.
fn clear_cache(repo_path: &std::path::Path) {
    let dir = cache_dir(repo_path);
    if dir.exists() {
        fs::remove_dir_all(&dir).expect("remove cache");
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
            let out = stale_meshes(&repo, EngineOptions::committed_only()).expect("stale");
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
        stale_meshes(&repo, EngineOptions::committed_only()).expect("prime");
    }
    let mut g = c.benchmark_group("stale");
    g.bench_function("warm", |b| {
        b.iter(|| {
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_meshes(&repo, EngineOptions::committed_only()).expect("stale");
            std::hint::black_box(out);
        });
    });
    g.finish();
}

/// Warm run with the SQLite cache disabled (`GIT_MESH_CACHE=0`).
///
/// Documents the relative gap between cached and uncached warm paths.
/// The warm-no-cache mean minus the warm mean is the cache's contribution.
fn bench_warm_no_cache(c: &mut Criterion) {
    let f = build_fixture();
    // Prime filesystem and gix object store with a cold run (cache disabled).
    {
        clear_cache(&f.repo_path);
        // SAFETY: bench process is single-threaded; no other threads read
        // GIT_MESH_CACHE concurrently.
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var("GIT_MESH_CACHE", "0");
        }
        let repo = gix::open(&f.repo_path).expect("open repo");
        stale_meshes(&repo, EngineOptions::committed_only()).expect("prime");
    }
    let mut g = c.benchmark_group("stale");
    g.bench_function("warm-no-cache", |b| {
        b.iter(|| {
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_meshes(&repo, EngineOptions::committed_only()).expect("stale");
            std::hint::black_box(out);
        });
    });
    g.finish();
    #[allow(unused_unsafe)]
    unsafe {
        std::env::remove_var("GIT_MESH_CACHE");
    }
}

criterion_group!(benches, bench_cold, bench_warm, bench_warm_no_cache);
criterion_main!(benches);
