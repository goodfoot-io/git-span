//! Allocation-scaling witness for [`merge_span_files`].
//!
//! This is deliberately a standalone integration target containing one
//! measuring thread: the counting allocator installed here counts every
//! allocation in this process, so isolation from other tests is what makes
//! the measurement valid under plain multi-threaded `cargo test`.
//!
//! Contract: for a merge whose anchors all share one path (the span-file
//! norm — many line-range anchors per file), the kernel's allocation count
//! must scale with the number of *distinct* strings, not with anchor count.
//! Duplicating a record or re-cloning a shared field must cost a refcount
//! bump, not a heap allocation.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

use git_span_core::span_file::{merge_span_files, AnchorRecord, SpanFile};

/// N line-range anchors sharing ONE path, distinct extents and hashes so
/// nothing collapses; ours == theirs so the merge resolves cleanly.
fn span_with(n: usize) -> SpanFile {
    let mut anchors = Vec::with_capacity(n);
    for i in 1..=n as u32 {
        anchors.push(AnchorRecord {
            path: "src/main.rs".to_string(),
            start_line: i,
            end_line: i + 5,
            algorithm: "rk64".to_string(),
            content_hash: format!("{i:016x}"),
        });
    }
    SpanFile {
        anchors,
        why: String::new(),
        resolved: Vec::new(),
        config: Default::default(),
    }
}

fn merge_allocations(n: usize) -> usize {
    let ours = span_with(n);
    let theirs = span_with(n);
    let before = ALLOCS.load(Ordering::SeqCst);
    let result = merge_span_files(None, &ours, &theirs, &[]);
    let after = ALLOCS.load(Ordering::SeqCst);
    assert_eq!(result.merged.anchors.len(), n, "clean merge keeps every anchor");
    after - before
}

#[test]
#[ignore = "baseline is linear (~15 allocs/anchor) until the Arc<str> switch lands"]
fn merge_allocations_scale_with_distinct_strings_not_anchor_count() {
    // Warmup settles lazy per-thread allocator/RandomState initialization
    // so its one-time cost cannot pollute either measurement.
    let _ = merge_allocations(8);

    let small = merge_allocations(200);
    let large = merge_allocations(1600);
    let ratio = large as f64 / small as f64;
    assert!(
        ratio < 4.0,
        "merge allocations scaled {ratio:.2}x for an 8x anchor-count increase \
         (small={small}, large={large}): record duplication still copies bytes"
    );
}
