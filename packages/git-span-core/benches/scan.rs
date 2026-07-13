//! Content-hash matcher benchmark.
//!
//! Reproduces the wiki CLI's measured hot path: a single stale line-range
//! anchor scanned across a large LF source file. The `reference` group runs
//! the pre-optimization `lines().join("\n")` matcher; the `optimized` group
//! runs the shipped [`scan_for_content_hash`]. The ratio between them is the
//! ">=5x on a single stale anchor into a 2500-line file" success criterion.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use git_span_core::{
    AnchorExtent, LineIndex, Location, cheap_fingerprint_with_extent, scan_for_content_hash,
    scan_for_content_hash_near_radius, scan_indexed_prefiltered, sha256_hex,
};

/// A representative ~2500-line LF source file (~40 bytes/line).
fn big_file() -> Vec<u8> {
    let mut s = String::new();
    for i in 0..2500 {
        s.push_str(&format!(
            "    let value_{i} = compute_something({i}, offset);\n"
        ));
    }
    s.into_bytes()
}

/// The pre-optimization matcher, kept here as the baseline to compare against.
fn reference_scan(
    files: &[(String, Vec<u8>)],
    content_hash: &str,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    match extent {
        AnchorExtent::WholeFile => unreachable!("benchmark uses line ranges"),
        AnchorExtent::LineRange { start, end } => {
            let extent = (end.saturating_sub(start) + 1) as usize;
            let mut out: Vec<Location> = Vec::new();
            for (path, bytes) in files {
                let text = String::from_utf8_lossy(bytes);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() < extent {
                    continue;
                }
                for win in 0..=(lines.len() - extent) {
                    let slice_text = lines[win..win + extent].join("\n");
                    if sha256_hex(slice_text.as_bytes()) == want {
                        out.push(Location {
                            path: path.clone(),
                            start_line: (win as u32) + 1,
                            end_line: (win as u32) + extent as u32,
                        });
                    }
                }
            }
            if let Some(near) = near {
                let near0 = near.saturating_sub(1);
                out.sort_by_key(|l| (l.start_line.abs_diff(near0), l.start_line));
            }
            out
        }
    }
}

fn bench_scan(c: &mut Criterion) {
    let bytes = big_file();
    let files = vec![("scaffold.rs".to_string(), bytes.clone())];

    // A 40-line block anchored at lines 200..=239, now shifted down a few
    // lines — the realistic same-file edit-shift the move-follower probes.
    let extent = 40u32;
    let old_start = 200u32; // the anchor's recorded start (`near`)
    let new_start = 206u32; // where the block actually moved to
    let text = String::from_utf8(bytes.clone()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    let win = new_start as usize - 1;
    let want = sha256_hex(lines[win..win + extent as usize].join("\n").as_bytes());
    let extent = AnchorExtent::LineRange {
        start: old_start,
        end: old_start + extent - 1,
    };

    // Sanity: the exhaustive matcher and the bounded-radius probe agree on
    // the single relocated window.
    let full = scan_for_content_hash(&files, &want, extent, Some(old_start));
    assert_eq!(full, reference_scan(&files, &want, extent, Some(old_start)));
    let radius = 64u32;
    assert_eq!(
        scan_for_content_hash_near_radius(&files, &want, extent, old_start, radius),
        full,
    );

    // The fingerprint prefilter reaches the *exhaustive* (fail-closed) set at
    // near-radius cost: the caller stores the fingerprint of the anchored
    // content and the per-window SHA fires only at genuine candidates.
    let indexed: Vec<(String, LineIndex)> =
        files.iter().map(|(p, b)| (p.clone(), LineIndex::build(b))).collect();
    let cheap_fp =
        cheap_fingerprint_with_extent(lines[win..win + extent as usize].join("\n").as_bytes(), &AnchorExtent::WholeFile);
    assert_eq!(
        scan_indexed_prefiltered(&indexed, &want, cheap_fp, extent, Some(old_start)),
        full,
    );

    let mut group = c.benchmark_group("single_stale_anchor_2500_lines");
    group
        .bench_function("reference_full_scan", |b| {
            b.iter(|| {
                reference_scan(
                    black_box(&files),
                    black_box(&want),
                    black_box(extent),
                    black_box(Some(old_start)),
                )
            })
        })
        .bench_function("optimized_full_scan", |b| {
            b.iter(|| {
                scan_for_content_hash(
                    black_box(&files),
                    black_box(&want),
                    black_box(extent),
                    black_box(Some(old_start)),
                )
            })
        })
        .bench_function("optimized_near_radius", |b| {
            b.iter(|| {
                scan_for_content_hash_near_radius(
                    black_box(&files),
                    black_box(&want),
                    black_box(extent),
                    black_box(old_start),
                    black_box(radius),
                )
            })
        })
        .bench_function("prefiltered_full_scan", |b| {
            b.iter(|| {
                scan_indexed_prefiltered(
                    black_box(&indexed),
                    black_box(&want),
                    black_box(cheap_fp),
                    black_box(extent),
                    black_box(Some(old_start)),
                )
            })
        });
    group.finish();
}

/// Benchmark the per-anchor cost of [`scan_indexed_prefiltered`] when a single
/// shared [`LineIndex`] — with its cached prefix tables — is used for all
/// anchors (warm path), versus building a fresh [`LineIndex`] per anchor (cold
/// baseline). The ratio between these two is the K·O(N) table-construction
/// overhead that cached prefix tables eliminate.
fn bench_many_anchors_one_index(c: &mut Criterion) {
    let bytes = big_file();
    let text = String::from_utf8(bytes.clone()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    let extent = 40u32;

    // A single shared index for the warm-path benchmarks.  The first prefiltered
    // scan lazily populates `fp_tables`; subsequent scans reuse the same tables.
    let idx = LineIndex::build(&bytes);
    let indexed_shared = vec![("scaffold.rs".to_string(), idx)];

    /// Precomputed data for one anchor, assembled by [`make_anchors`].
    struct AnchorBench {
        content_hash: String,
        cheap_fp: u64,
        extent: AnchorExtent,
        near: u32,
    }

    /// Produce `count` anchors spread evenly across the file, each targeting a
    /// distinct line range.  The content hash and fingerprint match the lines at
    /// the anchor's own position (no edit-shift, so the scan finds a single
    /// result per anchor).
    fn make_anchors(lines: &[&str], count: usize, extent: u32) -> Vec<AnchorBench> {
        let n = lines.len();
        let step = (n - extent as usize) / count;
        let mut anchors = Vec::with_capacity(count);
        for i in 0..count {
            let start = (i * step + 1) as u32; // 1-based
            let end = start + extent - 1;
            if end as usize > n {
                break;
            }
            let win = start as usize - 1;
            let content = lines[win..win + extent as usize].join("\n");
            let content_hash = sha256_hex(content.as_bytes());
            let cheap_fp =
                cheap_fingerprint_with_extent(content.as_bytes(), &AnchorExtent::WholeFile);
            anchors.push(AnchorBench {
                content_hash,
                cheap_fp,
                extent: AnchorExtent::LineRange { start, end },
                near: start,
            });
        }
        anchors
    }

    let k10_anchors = make_anchors(&lines, 10, extent);
    let k50_anchors = make_anchors(&lines, 50, extent);

    // Prime the shared index's prefix tables before any measurement, so warm
    // benchmarks do not pay the lazy-init cost even on the first iteration.
    // The `OnceLock` guarantees this populates exactly once for the index's
    // lifetime.
    {
        let a = &k10_anchors[0];
        scan_indexed_prefiltered(
            &indexed_shared,
            &a.content_hash,
            a.cheap_fp,
            a.extent,
            Some(a.near),
        );
    }

    let mut group = c.benchmark_group("many_anchors_one_index");

    // --- K=10: warm path (shared index, cached prefix tables) ---
    for (i, a) in k10_anchors.iter().enumerate() {
        group.bench_function(format!("k10/a{i}/warm"), |b| {
            b.iter(|| {
                scan_indexed_prefiltered(
                    black_box(&indexed_shared),
                    black_box(&a.content_hash),
                    black_box(a.cheap_fp),
                    black_box(a.extent),
                    black_box(Some(a.near)),
                )
            })
        });
    }

    // --- K=10: cold baseline (fresh index per anchor) ---
    //
    // Each iteration builds a new LineIndex from scratch, which reproduces the
    // pre-cache K·O(N) table-construction overhead for every anchor.
    for (i, a) in k10_anchors.iter().enumerate() {
        group.bench_function(format!("k10/a{i}/cold"), |b| {
            b.iter(|| {
                let fresh_idx = LineIndex::build(black_box(&bytes));
                let indexed = vec![("scaffold.rs".to_string(), fresh_idx)];
                scan_indexed_prefiltered(
                    black_box(&indexed),
                    black_box(&a.content_hash),
                    black_box(a.cheap_fp),
                    black_box(a.extent),
                    black_box(Some(a.near)),
                )
            })
        });
    }

    // --- K=50: warm path (shared index, cached prefix tables) ---
    for (i, a) in k50_anchors.iter().enumerate() {
        group.bench_function(format!("k50/a{i}/warm"), |b| {
            b.iter(|| {
                scan_indexed_prefiltered(
                    black_box(&indexed_shared),
                    black_box(&a.content_hash),
                    black_box(a.cheap_fp),
                    black_box(a.extent),
                    black_box(Some(a.near)),
                )
            })
        });
    }

    // --- K=50: cold baseline (fresh index per anchor) ---
    for (i, a) in k50_anchors.iter().enumerate() {
        group.bench_function(format!("k50/a{i}/cold"), |b| {
            b.iter(|| {
                let fresh_idx = LineIndex::build(black_box(&bytes));
                let indexed = vec![("scaffold.rs".to_string(), fresh_idx)];
                scan_indexed_prefiltered(
                    black_box(&indexed),
                    black_box(&a.content_hash),
                    black_box(a.cheap_fp),
                    black_box(a.extent),
                    black_box(Some(a.near)),
                )
            })
        });
    }

    group.finish();
}

criterion_group!(single_stale_anchor_2500_lines, bench_scan);
criterion_group!(many_anchors_one_index, bench_many_anchors_one_index);
criterion_main!(single_stale_anchor_2500_lines, many_anchors_one_index);
