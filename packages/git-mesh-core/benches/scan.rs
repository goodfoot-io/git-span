//! Content-hash matcher benchmark.
//!
//! Reproduces the wiki CLI's measured hot path: a single stale line-range
//! anchor scanned across a large LF source file. The `reference` group runs
//! the pre-optimization `lines().join("\n")` matcher; the `optimized` group
//! runs the shipped [`scan_for_content_hash`]. The ratio between them is the
//! ">=5x on a single stale anchor into a 2500-line file" success criterion.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use git_mesh_core::{
    AnchorExtent, Location, scan_for_content_hash, scan_for_content_hash_near_radius, sha256_hex,
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
            let span = (end.saturating_sub(start) + 1) as usize;
            let mut out: Vec<Location> = Vec::new();
            for (path, bytes) in files {
                let text = String::from_utf8_lossy(bytes);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() < span {
                    continue;
                }
                for win in 0..=(lines.len() - span) {
                    let slice_text = lines[win..win + span].join("\n");
                    if sha256_hex(slice_text.as_bytes()) == want {
                        out.push(Location {
                            path: path.clone(),
                            start_line: (win as u32) + 1,
                            end_line: (win as u32) + span as u32,
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
    let span = 40u32;
    let old_start = 200u32; // the anchor's recorded start (`near`)
    let new_start = 206u32; // where the block actually moved to
    let text = String::from_utf8(bytes.clone()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    let win = new_start as usize - 1;
    let want = sha256_hex(lines[win..win + span as usize].join("\n").as_bytes());
    let extent = AnchorExtent::LineRange {
        start: old_start,
        end: old_start + span - 1,
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
        });
    group.finish();
}

criterion_group!(benches, bench_scan);
criterion_main!(benches);
