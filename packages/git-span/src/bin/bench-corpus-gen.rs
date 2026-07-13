//! Standalone binary that materialises a synthetic git corpus for benchmarks.
//!
//! Usage:
//!   bench-corpus-gen <output-dir> <seed> <span-count> [--with-commit-graph]
//!
//! * `output-dir`  — directory that will be created and become the git repo.
//! * `seed`        — u64 seed; same seed + same span-count → same commit SHAs.
//! * `span-count`  — number of source files and span files to create.
//! * `--with-commit-graph` — when present, runs
//!   `git commit-graph write --reachable --changed-paths` after seeding.
//!
//! This binary is gated behind the `bench-corpus` feature and is
//! registered with `test = false, bench = false` in Cargo.toml so it
//! never influences the release build or the test harness.

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "Usage: bench-corpus-gen <output-dir> <seed> <span-count> [--with-commit-graph]"
        );
        std::process::exit(1);
    }

    let output_dir = std::path::PathBuf::from(&args[1]);
    let seed: u64 = args[2]
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid seed: {e}"))?;
    let span_count: usize = args[3]
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid span-count: {e}"))?;
    let with_commit_graph = args.iter().any(|a| a == "--with-commit-graph");

    std::fs::create_dir_all(&output_dir)?;

    git_span::bench_corpus::generate(&output_dir, seed, span_count, with_commit_graph)?;

    // Print the HEAD SHA so callers can verify determinism.
    let out = std::process::Command::new("git")
        .current_dir(&output_dir)
        .args(["rev-parse", "HEAD"])
        .output()?;
    anyhow::ensure!(out.status.success(), "git rev-parse HEAD failed");
    let sha = String::from_utf8(out.stdout)?.trim().to_string();
    println!("{sha}");

    Ok(())
}
