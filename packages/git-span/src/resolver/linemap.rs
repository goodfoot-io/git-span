//! Phase 2: Composed `LineMap` — sorted, non-overlapping old→new line
//! intervals built from per-commit hunks and composable across commits.
//!
//! A `LineMap` represents the line-coordinate transformation a single
//! commit (or a composition of commits) applies to a file. Each segment
//! is either an *identity-shifted* segment (unchanged region, where new
//! = old + shift) or a *replacement* segment (a hunk's old↔new pairing,
//! which may have an empty old or new side for pure insert/delete).
//!
//! `project_range` replicates `walker::apply_hunks_to_range`'s overlap
//! expansion semantics exactly so it can serve as a drop-in for the
//! per-anchor projection in `PathTimeline`.

use crate::perf;
use crate::resolver::timeline::Hunk;
use std::sync::atomic::{AtomicU64, Ordering};

/// One half-open segment in the line map. Both `old_*` and `new_*` use
/// 1-based inclusive coordinates *except* when the segment is a pure
/// insert (empty old) or pure delete (empty new), in which case the
/// empty side stores `start == 0` and `end == 0` as a marker.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LineSegment {
    /// Inclusive 1-based start of the old range (0 marks empty).
    pub(crate) old_start: u32,
    /// Inclusive 1-based end of the old range (0 marks empty).
    pub(crate) old_end: u32,
    /// Inclusive 1-based start of the new range (0 marks empty).
    pub(crate) new_start: u32,
    /// Inclusive 1-based end of the new range (0 marks empty).
    pub(crate) new_end: u32,
    /// Identity-shifted (unchanged content, line-by-line) when `true`;
    /// otherwise this segment represents a replacement / insert / delete.
    pub(crate) identity: bool,
    /// Anchor old coordinate for inserts; when `old_start == 0` (pure
    /// insert), the hunk reports an `os` value relative to the parent
    /// blob that callers use to decide "before vs inside" the range.
    /// For non-insert segments this equals `old_start`.
    pub(crate) insert_anchor_old: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct LineMap {
    pub(crate) segments: Vec<LineSegment>,
    /// `prefix[i]` is the sum of fold deltas of `segments[..i]` in list
    /// order (`fold_delta`; identity segments contribute 0). Lets
    /// projection apply a whole skipped run prefix with one subtraction.
    pub(crate) prefix: Vec<i64>,
    /// Aligned with `segments`, scoped per run: `pmax[i]` is the maximum
    /// of `pivot_key(seg) - (prefix[i] - prefix[run_start])` over the
    /// run's indices up to `i`. That value is the segment's shift-test
    /// boundary translated into the query's initial window coordinates,
    /// so the first run index whose shift test can fail — accounting for
    /// window movement caused by earlier shifts — is the first index
    /// with `pmax >= s`. Each run's `pmax` is monotone, which admits
    /// binary search. The search may land slightly early (an earlier,
    /// larger key lowers nothing); landing early is always safe because
    /// everything from the pivot on is folded by the real sequential
    /// logic, while landing late would misclassify an overlapping
    /// segment as a shift.
    pub(crate) pmax: Vec<i64>,
    /// Half-open `[start, end)` ranges into `segments`, one per source
    /// map. Each run is internally sorted and disjoint by old
    /// coordinates (so once a segment falls entirely right of the
    /// window, the rest of the run cannot re-enter it). Across runs the
    /// order is *application* order (`compose` concatenates);
    /// coordinates from different runs are never compared, so runs must
    /// never be reordered geometrically.
    pub(crate) runs: Vec<(u32, u32)>,
}

/// Net shift a segment applies when it lies fully left of the projected
/// window: new-side length minus old-side length (0 for identity).
fn fold_delta(seg: &LineSegment) -> i64 {
    let oc: i64 = if seg.old_start == 0 {
        0
    } else {
        (seg.old_end - seg.old_start + 1) as i64
    };
    let nc: i64 = if seg.new_start == 0 {
        0
    } else {
        (seg.new_end - seg.new_start + 1) as i64
    };
    nc - oc
}

/// The coordinate a segment's shift test compares against the window
/// start: the old-side end, or the anchor for pure inserts (empty old
/// side).
fn pivot_key(seg: &LineSegment) -> i64 {
    if seg.old_start == 0 {
        seg.insert_anchor_old as i64
    } else {
        seg.old_end as i64
    }
}

/// Precompute the projection indexes over `segments` tiled by `runs`:
/// global prefix-delta sums plus per-run pivot maxima (see `LineMap`).
fn build_indexes(segments: &[LineSegment], runs: &[(u32, u32)]) -> (Vec<i64>, Vec<i64>) {
    let mut prefix = Vec::with_capacity(segments.len() + 1);
    prefix.push(0i64);
    for seg in segments {
        let last = prefix.last().copied().unwrap_or(0);
        prefix.push(last + fold_delta(seg));
    }
    let mut pmax = vec![0i64; segments.len()];
    for &(rs, re) in runs {
        let (rs, re) = (rs as usize, re as usize);
        let base = prefix[rs];
        let mut run_max = i64::MIN;
        for (i, seg) in segments.iter().enumerate().take(re).skip(rs) {
            run_max = run_max.max(pivot_key(seg) - (prefix[i] - base));
            pmax[i] = run_max;
        }
    }
    (prefix, pmax)
}

/// Reindex `runs` after identity segments have been dropped from
/// `segments`: each run's bounds shift down by the number of dropped
/// predecessors. Order within and across runs is preserved.
fn compact_runs(segments: &[LineSegment], runs: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut out = Vec::with_capacity(runs.len());
    let mut kept = 0u32;
    let mut cursor = 0usize;
    for &(rs, re) in runs {
        let (rs, re) = (rs as usize, re as usize);
        while cursor < rs {
            if !segments[cursor].identity {
                kept += 1;
            }
            cursor += 1;
        }
        let start = kept;
        while cursor < re {
            if !segments[cursor].identity {
                kept += 1;
            }
            cursor += 1;
        }
        out.push((start, kept));
    }
    out
}

impl LineMap {
    pub(crate) fn empty() -> Self {
        Self {
            segments: Vec::new(),
            prefix: Vec::new(),
            pmax: Vec::new(),
            runs: Vec::new(),
        }
    }

    /// Build a per-commit `LineMap` from hunks. The hunks are the same
    /// `(old_start, old_count, new_start, new_count)` tuples
    /// `walker::compute_hunks` produces.
    pub(crate) fn from_hunks(hunks: &[Hunk], old_line_count: u32, new_line_count: u32) -> LineMap {
        let _span = perf::span("linemap.from-hunks");
        let mut segments: Vec<LineSegment> = Vec::with_capacity(hunks.len() * 2 + 1);

        let mut old_cursor: u32 = 1;
        let mut new_cursor: u32 = 1;

        for &(os, oc, ns, nc) in hunks {
            // Emit identity-shifted segment covering `[old_cursor,
            // hunk_old_start - 1]` when non-empty. For pure-insert hunks
            // `os` is the anchor (parent-side "line just before the
            // insertion"), so identity region runs up through `os`.
            let identity_end_old = if oc == 0 {
                // Pure insert: identity region covers up through `os`
                // inclusive (insert sits *after* old line `os`).
                os
            } else {
                os.saturating_sub(1)
            };

            if old_cursor <= identity_end_old {
                let shift_new_start = new_cursor;
                let len = identity_end_old - old_cursor + 1;
                segments.push(LineSegment {
                    old_start: old_cursor,
                    old_end: identity_end_old,
                    new_start: shift_new_start,
                    new_end: shift_new_start + len - 1,
                    identity: true,
                    insert_anchor_old: old_cursor,
                });
                new_cursor += len;
                old_cursor = identity_end_old + 1;
            }

            // Emit the replacement / insert / delete segment.
            let (o_start, o_end) = if oc == 0 { (0, 0) } else { (os, os + oc - 1) };
            let (n_start, n_end) = if nc == 0 { (0, 0) } else { (ns, ns + nc - 1) };
            segments.push(LineSegment {
                old_start: o_start,
                old_end: o_end,
                new_start: n_start,
                new_end: n_end,
                identity: false,
                insert_anchor_old: os,
            });

            if oc > 0 {
                old_cursor = os + oc;
            }
            if nc > 0 {
                new_cursor = ns + nc;
            }
        }

        // Trailing identity region.
        if old_cursor <= old_line_count {
            let len = old_line_count - old_cursor + 1;
            segments.push(LineSegment {
                old_start: old_cursor,
                old_end: old_line_count,
                new_start: new_cursor,
                new_end: new_cursor + len - 1,
                identity: true,
                insert_anchor_old: old_cursor,
            });
        }

        let _ = new_line_count;

        MAPS_BUILT.fetch_add(1, Ordering::Relaxed);
        SEGMENTS_TOTAL.fetch_add(segments.len() as u64, Ordering::Relaxed);

        let len = segments.len() as u32;
        let (prefix, pmax) = build_indexes(&segments, &[(0, len)]);
        LineMap {
            prefix,
            pmax,
            runs: vec![(0, len)],
            segments,
        }
    }

    /// Project `[start, end]` (1-based inclusive) through the map. The
    /// semantics replicate `walker::apply_hunks_to_range` so this can be
    /// used as a drop-in for the per-anchor projection path.
    pub(crate) fn project_range(&self, start: u32, end: u32) -> Option<(u32, u32)> {
        if !perf::enabled() {
            return self.project_range_inner(start, end);
        }
        let t0 = std::time::Instant::now();
        let res = self.project_range_inner(start, end);
        PROJECT_US.fetch_add(t0.elapsed().as_micros() as u64, Ordering::Relaxed);
        res
    }

    fn project_range_inner(&self, start: u32, end: u32) -> Option<(u32, u32)> {
        // Apply the same overlap-expanding rule as
        // `apply_hunks_to_range`: visit replacement segments in
        // application order and fold `(s, e)` through them; identity
        // segments contribute nothing.
        //
        // Per run, everything strictly before the *pivot* can only take
        // the shift branch of the fold — its pivot key, translated by the
        // cumulative delta of earlier shifts (which is what `pmax`
        // precomputes), sits below the window start. Those shifts collapse
        // into one prefix-sum lookup; the pivot search may land slightly
        // early (never late), which only means a few segments are folded
        // normally instead of skipped. From the pivot on, the sequential
        // fold runs verbatim until a segment falls entirely right of the
        // window: runs are sorted and disjoint by old coordinates, so the
        // rest of the run cannot re-enter it. Cross-run order stays
        // application order (`compose` concatenates maps in different
        // coordinate spaces), never geometric.

        let mut s = start as i64;
        let mut e = end as i64;
        for &(run_start, run_end) in &self.runs {
            let (rs, re) = (run_start as usize, run_end as usize);
            let pivot = self.pmax[rs..re].partition_point(|&m| m < s);
            if pivot > 0 {
                let skipped = self.prefix[rs + pivot] - self.prefix[rs];
                s += skipped;
                e += skipped;
            }
            for seg in &self.segments[rs + pivot..re] {
                if seg.identity {
                    continue;
                }
                let oc: i64 = if seg.old_start == 0 {
                    0
                } else {
                    (seg.old_end - seg.old_start + 1) as i64
                };
                let nc: i64 = if seg.new_start == 0 {
                    0
                } else {
                    (seg.new_end - seg.new_start + 1) as i64
                };
                let os: i64 = seg.insert_anchor_old as i64;
                let delta = nc - oc;
                if oc == 0 {
                    if os < s {
                        s += delta;
                        e += delta;
                    } else if os >= e {
                        // no effect
                    } else {
                        e += delta;
                    }
                    continue;
                }
                let old_last = os + oc - 1;
                if old_last < s {
                    s += delta;
                    e += delta;
                } else if os > e {
                    // Entirely right of the window; the rest of this
                    // sorted run is too.
                    break;
                } else {
                    let new_last = if nc == 0 { os } else { os + nc - 1 };
                    s = (s.min(os)).max(1);
                    e = new_last.max(e + delta);
                }
            }
        }
        let s = s.max(1) as u32;
        let e = e.max(s as i64) as u32;
        Some((s, e))
    }

    /// Compose two maps `a` then `b`. The result `c` satisfies
    /// `c.project_range(s,e) == b.project_range(a.project_range(s,e))`.
    pub(crate) fn compose(a: &LineMap, b: &LineMap) -> LineMap {
        let t0 = perf::enabled().then(std::time::Instant::now);
        // Concatenate the replacement segments: `a`'s in `a`'s old
        // coordinates, then `b`'s in `b`'s old coordinates after `a`
        // has been applied. Because `project_range_inner` runs the
        // fold itself we can compose by *appending* the second map's
        // replacement segments translated into a common coordinate
        // space. The simpler, correct implementation is to translate
        // `b`'s replacement segments into `a`'s old coordinates using
        // `a`'s inverse, but the fold-based projection does not
        // require that: applying `a`'s segments then `b`'s segments in
        // order yields the same `(s, e)` as projecting through `a`
        // and then through `b`. So composition is concatenation in
        // visit order. Identity segments are dropped (they don't
        // participate in the fold). Each input keeps its own run so
        // projection can binary-search inside it; the cross-run order
        // is application order and must never be reordered.
        let mut segments = Vec::with_capacity(a.segments.len() + b.segments.len());
        for seg in &a.segments {
            if !seg.identity {
                segments.push(*seg);
            }
        }
        let mut runs = compact_runs(&a.segments, &a.runs);
        let a_kept = segments.len() as u32;
        for seg in &b.segments {
            if !seg.identity {
                segments.push(*seg);
            }
        }
        runs.extend(
            compact_runs(&b.segments, &b.runs)
                .into_iter()
                .map(|(rs, re)| (rs + a_kept, re + a_kept)),
        );
        if let Some(t0) = t0 {
            COMPOSE_US.fetch_add(t0.elapsed().as_micros() as u64, Ordering::Relaxed);
        }
        MAPS_BUILT.fetch_add(1, Ordering::Relaxed);
        SEGMENTS_TOTAL.fetch_add(segments.len() as u64, Ordering::Relaxed);
        let (prefix, pmax) = build_indexes(&segments, &runs);
        LineMap {
            prefix,
            pmax,
            runs,
            segments,
        }
    }
}

// ── Counters ────────────────────────────────────────────────────────────────

static MAPS_BUILT: AtomicU64 = AtomicU64::new(0);
static SEGMENTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static COMPOSE_US: AtomicU64 = AtomicU64::new(0);
static PROJECT_US: AtomicU64 = AtomicU64::new(0);
static PROJECT_FALLBACKS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn record_fallback() {
    PROJECT_FALLBACKS.fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn reset_counters() {
    MAPS_BUILT.store(0, Ordering::Relaxed);
    SEGMENTS_TOTAL.store(0, Ordering::Relaxed);
    COMPOSE_US.store(0, Ordering::Relaxed);
    PROJECT_US.store(0, Ordering::Relaxed);
    PROJECT_FALLBACKS.store(0, Ordering::Relaxed);
}

pub(crate) fn emit_counters() {
    perf::counter("linemap.maps-built", MAPS_BUILT.load(Ordering::Relaxed));
    perf::counter(
        "linemap.segments-total",
        SEGMENTS_TOTAL.load(Ordering::Relaxed),
    );
    perf::counter("linemap.compose-us", COMPOSE_US.load(Ordering::Relaxed));
    perf::counter("linemap.project-us", PROJECT_US.load(Ordering::Relaxed));
    perf::counter(
        "linemap.project-fallbacks",
        PROJECT_FALLBACKS.load(Ordering::Relaxed),
    );
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolver::walker::apply_hunks_to_range;

    /// Golden: a single-commit map matches `apply_hunks_to_range`.
    fn assert_golden(hunks: &[Hunk], old_lc: u32, new_lc: u32, start: u32, end: u32) {
        let map = LineMap::from_hunks(hunks, old_lc, new_lc);
        let expected = apply_hunks_to_range(hunks, start, end);
        let got = map.project_range(start, end).unwrap();
        assert_eq!(
            got, expected,
            "hunks={hunks:?} range=({start},{end}) old_lc={old_lc} new_lc={new_lc}"
        );
    }

    #[test]
    fn insert_before_range() {
        // Insert 3 lines before line 5..7 (old has 10 lines).
        // compute_hunks emits a pure-insert with os=0 (anchor before
        // line 1). Simulate that here.
        let hunks: Vec<Hunk> = vec![(0, 0, 1, 3)];
        assert_golden(&hunks, 10, 13, 5, 7);
    }

    #[test]
    fn insert_inside_range() {
        // Insert 2 lines after old line 6 (inside range 5..=7).
        let hunks: Vec<Hunk> = vec![(6, 0, 7, 2)];
        assert_golden(&hunks, 10, 12, 5, 7);
    }

    #[test]
    fn delete_before_range() {
        // Delete old lines 1..=2.
        let hunks: Vec<Hunk> = vec![(1, 2, 0, 0)];
        assert_golden(&hunks, 10, 8, 6, 8);
    }

    #[test]
    fn delete_inside_range() {
        // Delete old line 6.
        let hunks: Vec<Hunk> = vec![(6, 1, 0, 0)];
        assert_golden(&hunks, 10, 9, 5, 7);
    }

    #[test]
    fn replace_overlapping_start() {
        // Replace old lines 4..=6 with 2 new lines.
        let hunks: Vec<Hunk> = vec![(4, 3, 4, 2)];
        assert_golden(&hunks, 10, 9, 5, 7);
    }

    #[test]
    fn replace_overlapping_end() {
        let hunks: Vec<Hunk> = vec![(6, 3, 6, 2)];
        assert_golden(&hunks, 10, 9, 5, 7);
    }

    #[test]
    fn whole_range_deleted() {
        // Delete old lines 5..=7.
        let hunks: Vec<Hunk> = vec![(5, 3, 0, 0)];
        assert_golden(&hunks, 10, 7, 5, 7);
    }

    #[test]
    fn multi_hunk_property() {
        // Multiple hunks, range parity.
        let hunks: Vec<Hunk> = vec![(2, 1, 2, 3), (8, 2, 10, 0)];
        assert_golden(&hunks, 10, 11, 5, 7);
    }

    /// Composition matches sequential projection through two maps.
    #[test]
    fn compose_two_commits() {
        let h1: Vec<Hunk> = vec![(2, 0, 2, 2)]; // insert 2 lines after line 1
        let h2: Vec<Hunk> = vec![(5, 1, 0, 0)]; // delete one line
        let m1 = LineMap::from_hunks(&h1, 10, 12);
        let m2 = LineMap::from_hunks(&h2, 12, 11);
        let composed = LineMap::compose(&m1, &m2);

        // Project (4, 6) through composed.
        let composed_out = composed.project_range(4, 6).unwrap();
        // Project (4, 6) through m1 then m2.
        let mid = m1.project_range(4, 6).unwrap();
        let seq_out = m2.project_range(mid.0, mid.1).unwrap();
        // And via apply_hunks_to_range chain.
        let mid_h = apply_hunks_to_range(&h1, 4, 6);
        let seq_h = apply_hunks_to_range(&h2, mid_h.0, mid_h.1);

        assert_eq!(composed_out, seq_out);
        assert_eq!(seq_out, seq_h);
    }
}
