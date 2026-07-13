//! Seeded, deterministic corpus generator for benchmarks.
//!
//! This module is gated behind the `bench-corpus` Cargo feature so it is
//! never included in the default or release build.  Both the
//! `bench-corpus-gen` binary and the `size_sweep` benchmark enable the
//! feature via `required-features`.
//!
//! # Determinism
//!
//! Given the same `seed` and `span_count`, `generate` always produces
//! byte-identical commits (same SHAs).  This requires:
//! - File contents derived purely from `seed` + per-span index (no rand/time).
//! - All six git identity/date env vars pinned on every commit.
//!
//! # Content hashes
//!
//! Hashes are the canonical **rk64** token (`rk64:<16hex>`) that `git span
//! add`/`commit` writes — computed via
//! [`git_span_core::cheap_fingerprint_with_extent`] +
//! [`git_span_core::rk64_to_hex`] over the same `LineRange` extent the anchor
//! covers, fed the *committed* file bytes.  Because the bytes hashed are
//! exactly the bytes at HEAD, a freshly generated corpus resolves **fresh**
//! (the resolver recomputes the same rk64 over the unchanged HEAD content and
//! the tokens match).  An earlier version used
//! `format!("sha256:{}", sha256_hex(...))` with `algorithm: "rk64"`, which
//! serialized to the malformed double-prefixed `rk64:sha256:<64hex>` — every
//! anchor then resolved `— changed`, so the size-sweep/warm fixtures measured
//! an all-changed fiction instead of the fresh corpus they document.  The
//! `freshly_generated_corpus_resolves_fresh` test below guards against that
//! regression.

#[cfg(feature = "bench-corpus")]
use std::path::Path;
#[cfg(feature = "bench-corpus")]
use std::process::Command;

/// Generate a deterministic git repository at `dir` containing `span_count`
/// spans.
///
/// # Arguments
///
/// * `dir` — the directory (must already exist) that will become a git repo.
/// * `seed` — a 64-bit seed that drives all file content.  Same seed →
///   same content → same commit SHAs.
/// * `span_count` — how many spans (and source files) to create.
/// * `with_commit_graph` — when `true`, runs
///   `git commit-graph write --reachable --changed-paths` after all commits.
///
/// # Errors
///
/// Returns an error if any git command fails or any file I/O fails.
#[cfg(feature = "bench-corpus")]
pub fn generate(
    dir: &Path,
    seed: u64,
    span_count: usize,
    with_commit_graph: bool,
) -> anyhow::Result<()> {
    // -----------------------------------------------------------------------
    // Helper: run a git command in `dir`, fail on non-zero exit.
    // -----------------------------------------------------------------------
    let git = |args: &[&str]| -> anyhow::Result<()> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()?;
        anyhow::ensure!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(())
    };

    // Helper: run a git commit with all six identity/date env vars pinned so
    // the resulting commit SHA is fully reproducible regardless of machine
    // git config.
    let git_commit = |msg: &str| -> anyhow::Result<()> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", msg])
            .env("GIT_AUTHOR_DATE", "2024-01-01T00:00:00+00:00")
            .env("GIT_COMMITTER_DATE", "2024-01-01T00:00:00+00:00")
            .env("GIT_AUTHOR_NAME", "Bench")
            .env("GIT_AUTHOR_EMAIL", "bench@example.com")
            .env("GIT_COMMITTER_NAME", "Bench")
            .env("GIT_COMMITTER_EMAIL", "bench@example.com")
            .output()?;
        anyhow::ensure!(
            out.status.success(),
            "git commit {:?} failed: {}",
            msg,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(())
    };

    // -----------------------------------------------------------------------
    // Init repo with a stable identity so commits work without global config.
    // -----------------------------------------------------------------------
    git(&["init", "--initial-branch=main"])?;
    git(&["config", "user.name", "Bench"])?;
    git(&["config", "user.email", "bench@example.com"])?;
    git(&["config", "commit.gpgsign", "false"])?;

    // -----------------------------------------------------------------------
    // Create source files — content is derived from (seed XOR span_index).
    // Each file gets LINES_PER_FILE lines; each line is deterministic.
    // -----------------------------------------------------------------------
    const LINES_PER_FILE: u32 = 20;

    for i in 0..span_count {
        let file_seed = seed ^ (i as u64).wrapping_mul(0x9e3779b97f4a7c15);
        let filename = format!("file_{i}.txt");
        let mut buf = String::new();
        for ln in 0..LINES_PER_FILE {
            let val = file_seed
                .wrapping_add(ln as u64)
                .wrapping_mul(0x6364136223846793);
            buf.push_str(&format!("line{ln}_{val:016x}\n"));
        }
        std::fs::write(dir.join(&filename), &buf)?;
    }

    git(&["add", "-A"])?;
    git_commit("seed: source files")?;

    // -----------------------------------------------------------------------
    // Create .span/ directory and one span file per source file.
    // Each span anchors lines 1-5 of its source file with a real content hash.
    // -----------------------------------------------------------------------
    let span_dir = dir.join(".span");
    std::fs::create_dir_all(&span_dir)?;

    for i in 0..span_count {
        let filename = format!("file_{i}.txt");
        let bytes = std::fs::read(dir.join(&filename))?;

        // Anchor lines 1-5 with the canonical rk64 token the resolver verifies
        // against.  Fingerprint the committed bytes over the SAME LineRange
        // extent the anchor declares.  `content_hash` is the BARE 16-hex rk64
        // value; the `algorithm` field supplies the `rk64` token, so the
        // serialized address line `<path>#L1-L5 rk64:<16hex>` is canonical and
        // a fresh resolve recomputes an identical token.  (Setting content_hash
        // to `rk64:<hex>` here would double the prefix → `rk64:rk64:<hex>`.)
        let extent = git_span_core::AnchorExtent::LineRange { start: 1, end: 5 };
        let fp = git_span_core::cheap_fingerprint_with_extent(&bytes, &extent);
        let hash = git_span_core::rk64_to_hex(fp);

        let mf = crate::span_file::SpanFile {
            anchors: vec![crate::span_file::AnchorRecord {
                path: filename.clone(),
                start_line: 1,
                end_line: 5,
                algorithm: git_span_core::RK64_ALGORITHM.into(),
                content_hash: hash,
            }],
            why: format!("bench span {i}"),
        };

        let span_name = format!("span-{i}");
        std::fs::write(span_dir.join(&span_name), mf.serialize())?;
    }

    git(&["add", ".span"])?;
    git_commit("seed: spans")?;

    // -----------------------------------------------------------------------
    // Optionally build commit-graph with Bloom filters.
    // Without --changed-paths the graph-present variant still tree-diffs
    // every commit, making both variants identical under sweep.
    // -----------------------------------------------------------------------
    if with_commit_graph {
        git(&["commit-graph", "write", "--reachable", "--changed-paths"])?;
    }

    Ok(())
}

#[cfg(all(test, feature = "bench-corpus"))]
mod tests {
    use super::*;
    use crate::types::AnchorStatus;
    use crate::{EngineOptions, resolve_span, stale_spans};

    /// A freshly generated corpus must resolve with every anchor `Fresh`.
    ///
    /// This is the F6 guard: an anchor written with a malformed
    /// `rk64:sha256:<64hex>` token (the prior bug) resolves `Changed`, so the
    /// fixtures would silently measure an all-changed fiction.  Asserting the
    /// intended fresh drift profile here fails loudly if the canonical-token
    /// computation ever drifts from what the resolver verifies against.
    ///
    /// Two checks, complementary:
    ///   1. `stale_spans` (the staleness scan) returns NO stale spans — i.e.
    ///      the whole corpus is clean.
    ///   2. `resolve_span` per span returns the full anchor set, every anchor
    ///      `Fresh` — proving (1) is "no drift", not "no anchors".
    #[test]
    fn freshly_generated_corpus_resolves_fresh() {
        let dir = tempfile::tempdir().expect("tempdir");
        let span_count = 8;
        generate(dir.path(), 0x1234_5678_9abc_def0, span_count, false)
            .expect("generate corpus");

        let repo = gix::open(dir.path()).expect("open repo");

        // 1. The staleness scan reports nothing stale on a fresh corpus.
        let stale = stale_spans(&repo, ".span", EngineOptions::full()).expect("stale");
        assert!(
            stale.is_empty(),
            "fresh corpus should have no stale spans, got {} stale: {:?}",
            stale.len(),
            stale.iter().map(|m| &m.name).collect::<Vec<_>>()
        );

        // 2. Resolve each span fully and assert every anchor is Fresh.
        let mut total_anchors = 0usize;
        for i in 0..span_count {
            let name = format!("span-{i}");
            let resolved = resolve_span(&repo, ".span", &name, EngineOptions::full())
                .unwrap_or_else(|e| panic!("resolve_span {name}: {e}"));
            assert!(
                !resolved.anchors.is_empty(),
                "span {name} has no anchors to check"
            );
            for a in &resolved.anchors {
                total_anchors += 1;
                assert_eq!(
                    a.status,
                    AnchorStatus::Fresh,
                    "anchor {} in span {name} resolved {:?}, expected Fresh \
                     (canonical rk64 token must match committed HEAD content)",
                    a.anchor_id,
                    a.status
                );
            }
        }
        assert_eq!(total_anchors, span_count, "one anchor per span expected");
    }
}
