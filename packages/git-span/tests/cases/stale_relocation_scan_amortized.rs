//! Regression test for the per-anchor cross-path relocation scan.
//!
//! On a repo where many anchored files were committed-renamed (`git mv`),
//! every drifted-absent anchor falls into
//! [`find_relocated_range_in_paths`](../src/resolver/engine/anchor.rs#L130).
//! That function iterates the index and, for each HEAD-present candidate
//! that passes the rename-target predicate, reads the candidate's content
//! and hash-scans it for the stored anchor window. The reads are *not*
//! amortized across anchors: K renamed anchors each read up to K candidate
//! texts, producing the O(K²) blow-up the bug report observed as the real
//! cost of `git span stale` on large spanned repos.
//!
//! The deterministic invariant the amortization must satisfy:
//!     `session.relocation-candidate-reads` is linear in the number of
//!     distinct candidate paths, not quadratic in the anchor count.
//!
//! This test commits K renamed anchored files, runs `git span stale`, and
//! asserts the counter stays under a linear bound. Against the un-amortized
//! code the counter is ~K·K; against the amortized fix it is bounded by the
//! number of distinct candidate paths.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Number of independently-anchored, independently-renamed files. Chosen
/// large enough that the quadratic/linear gap is unambiguous (K·K = 64
/// vs ~K = 8) but small enough to keep the test fast.
const K: usize = 8;

#[test]
fn relocation_scan_reads_are_linear_in_candidate_paths() -> Result<()> {
    let repo = TestRepo::new()?;

    // Seed K distinct files, each with a unique anchored slice so the
    // relocation scan must hash-compare per candidate (no coincidental
    // matches mask the read fan-out).
    for i in 0..K {
        let body = format!("anchor-{i}-l1\nanchor-{i}-l2\nanchor-{i}-l3\ntail-{i}\n");
        repo.write_file(&format!("src/file{i:02}.txt"), &body)?;
    }
    repo.commit_all("seed K anchored files")?;

    // Anchor a line range in each file in its own span.
    for i in 0..K {
        let span = format!("m{i:02}");
        let pinned = format!("src/file{i:02}.txt#L1-L3");
        repo.run_span(["add", &span, &pinned])?;
        repo.run_span(["why", &span, "seed"])?;
    }
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "seed spans"])?;
    repo.write_commit_graph()?;

    // Committed `git mv` each anchored file to a new path. The original
    // anchored path becomes absent at HEAD, forcing every anchor through
    // `find_relocated_range_in_paths` on resolve. Renames are named so the
    // matching twin sorts last in path order, maximising the read count
    // per anchor against the un-amortized code.
    for i in 0..K {
        let from = format!("src/file{i:02}.txt");
        let to = format!("src/zrenamed_{i:02}.txt");
        repo.run_git(["mv", &from, &to])?;
    }
    repo.run_git(["commit", "-m", "rename all anchored files"])?;
    repo.write_commit_graph()?;

    // Run `git span stale` with perf counters enabled.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(["stale", "--no-exit-code"])
        .env("GIT_SPAN_PERF", "1")
        .env("GIT_SPAN_CACHE", "0")
        .output()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Sanity: every anchor must report `moved` to its renamed twin, so we
    // know the relocation scan actually ran rather than short-circuiting.
    for i in 0..K {
        let dest = format!("src/zrenamed_{i:02}.txt");
        assert!(
            stdout.contains(&dest),
            "anchor {i} must resolve `moved` to {dest}; stdout=\n{stdout}\nstderr=\n{stderr}"
        );
    }

    let reads = parse_counter(&stderr, "session.relocation-candidate-reads");
    let linear_bound = (2 * K) as u64;
    assert!(
        reads <= linear_bound,
        "session.relocation-candidate-reads must be linear in candidate paths \
         (≤ {linear_bound} for K={K}), but got {reads} — the per-anchor \
         relocation scan is not amortized across the batch.\nstderr=\n{stderr}"
    );

    Ok(())
}

fn parse_counter(stderr: &str, label: &str) -> u64 {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("git-span perf: ")
            && let Some(value_str) = rest.strip_prefix(&format!("{label} "))
            && let Ok(v) = value_str.trim().parse::<u64>()
        {
            return v;
        }
    }
    panic!("counter `{label}` not found in stderr:\n{stderr}");
}
