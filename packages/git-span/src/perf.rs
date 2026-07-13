//! Opt-in performance logging for CLI operation groups.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn init(cli_enabled: bool) {
    ENABLED.store(cli_enabled || env_enabled(), Ordering::Relaxed);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

fn env_enabled() -> bool {
    match std::env::var("GIT_SPAN_PERF") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

pub struct Span {
    label: &'static str,
    start: Option<Instant>,
}

impl Span {
    pub fn new(label: &'static str) -> Self {
        Self {
            label,
            start: enabled().then(Instant::now),
        }
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        let Some(start) = self.start else {
            return;
        };
        let elapsed = start.elapsed();
        eprintln!(
            "git-span perf: {} {:.3} ms",
            self.label,
            elapsed.as_secs_f64() * 1000.0
        );
    }
}

pub fn span(label: &'static str) -> Span {
    Span::new(label)
}

pub fn counter(label: &str, value: u64) {
    if !enabled() {
        return;
    }
    eprintln!("git-span perf: {label} {value}");
}

/// Emit a free-form annotation line in the `--perf` output.
///
/// Used to add context (e.g., tier-ordering legends) that does not map to a
/// numeric counter.  No-ops when perf output is disabled.
pub fn note(text: &str) {
    if !enabled() {
        return;
    }
    eprintln!("git-span perf: {text}");
}

// ── Subroutine-level counters ──────────────────────────────────────────────
//
// Process-global counters incremented from deep call sites that have no
// direct access to `ResolveSession`. The `git span stale` CLI invokes
// `reset()` at the top of `stale_spans` and reads the values back inside
// the perf-emit block; output is only meaningful for a single resolver run
// per process invocation.

static GIX_OPEN_CALLS: AtomicU64 = AtomicU64::new(0);
/// Count of `attr_for` invocations. Each call probes gix's cached attribute
/// stack; the underlying `gix::index::File` is loaded from disk at most once
/// per `gix::Repository` instance, so this counter does not measure disk I/O.
static ATTR_FOR_CALLS: AtomicU64 = AtomicU64::new(0);
static IS_ANCESTOR_SUBPROCESS_CALLS: AtomicU64 = AtomicU64::new(0);
static IS_ANCESTOR_MEMO_HITS: AtomicU64 = AtomicU64::new(0);
static L1_HITS: AtomicU64 = AtomicU64::new(0);
static L1_MISSES: AtomicU64 = AtomicU64::new(0);
static L2_HITS: AtomicU64 = AtomicU64::new(0);
static L2_MISSES: AtomicU64 = AtomicU64::new(0);
static L2_READ_NS: AtomicU64 = AtomicU64::new(0);
static L2_WRITE_NS: AtomicU64 = AtomicU64::new(0);
static L2_BYTES_READ: AtomicU64 = AtomicU64::new(0);
static L2_BYTES_WRITTEN: AtomicU64 = AtomicU64::new(0);

// ── `git span list` corpus-load counters ────────────────────────────────────
//
// Phases of `load_all_spans_in` (3-layer name discovery + per-span
// read/parse) and the per-layer byte volume parsed. These are incremented
// from deep call sites that have no `run_list` handle. They are reset at the
// top of `run_list` and read back in the list-path emit block, exactly like
// the resolver subroutine counters above; values are meaningful for a single
// list invocation per process.
static LIST_DISCOVER_NS: AtomicU64 = AtomicU64::new(0);
static LIST_PARSE_NS: AtomicU64 = AtomicU64::new(0);
static LIST_GLOB_SCAN_NS: AtomicU64 = AtomicU64::new(0);
static LIST_SPANS_DISCOVERED: AtomicU64 = AtomicU64::new(0);
static LIST_SPANS_PARSED: AtomicU64 = AtomicU64::new(0);
static LIST_BYTES_PARSED: AtomicU64 = AtomicU64::new(0);
static LIST_LAYER_READS: AtomicU64 = AtomicU64::new(0);

// ── `git span stale --fix` phase counters ────────────────────────────────────
//
// Attribution for the `--fix`-specific delta over plain `stale`. `--fix` does
// three things on top of a read-only scan: (1) a PRE-fix resolve to find drift,
// (2) `apply_fix` which rewrites `.span/` files (each rewritten anchor recomputes
// a content hash), and (3) a POST-fix re-resolve/splice of the rewritten spans
// to render the final view. These wall-clock and count counters split the delta
// across those phases. Unlike the resolver `session.*` counters (reset per
// `stale_spans_inner` run), these MUST survive across BOTH the pre- and post-fix
// resolve passes within one `--fix` invocation, so they are reset once at the top
// of `run_stale` and read back in the `fix.*` emit block at its end. Values are
// meaningful for a single `stale --fix` invocation per process.
static FIX_PRE_RESOLVE_NS: AtomicU64 = AtomicU64::new(0);
static FIX_APPLY_NS: AtomicU64 = AtomicU64::new(0);
static FIX_POST_RESOLVE_NS: AtomicU64 = AtomicU64::new(0);
static FIX_REWRITABLE_ANCHORS: AtomicU64 = AtomicU64::new(0);
static FIX_HASH_CALLS: AtomicU64 = AtomicU64::new(0);
static FIX_SPANS_REWRITTEN: AtomicU64 = AtomicU64::new(0);

pub fn record_gix_open() {
    if !enabled() {
        return;
    }
    GIX_OPEN_CALLS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_attr_for_call() {
    if !enabled() {
        return;
    }
    ATTR_FOR_CALLS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_is_ancestor_subprocess() {
    if !enabled() {
        return;
    }
    IS_ANCESTOR_SUBPROCESS_CALLS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_is_ancestor_memo_hit() {
    if !enabled() {
        return;
    }
    IS_ANCESTOR_MEMO_HITS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_l1_hit() {
    if !enabled() {
        return;
    }
    L1_HITS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_l1_miss() {
    if !enabled() {
        return;
    }
    L1_MISSES.fetch_add(1, Ordering::Relaxed);
}

pub fn record_l2_hit() {
    if !enabled() {
        return;
    }
    L2_HITS.fetch_add(1, Ordering::Relaxed);
}

pub fn record_l2_miss() {
    if !enabled() {
        return;
    }
    L2_MISSES.fetch_add(1, Ordering::Relaxed);
}

pub fn record_l2_bytes_read(n: u64) {
    if !enabled() {
        return;
    }
    L2_BYTES_READ.fetch_add(n, Ordering::Relaxed);
}

pub fn record_l2_bytes_written(n: u64) {
    if !enabled() {
        return;
    }
    L2_BYTES_WRITTEN.fetch_add(n, Ordering::Relaxed);
}

pub fn time_l2_read<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    if !enabled() {
        return f();
    }
    let t = Instant::now();
    let r = f();
    L2_READ_NS.fetch_add(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
    r
}

pub fn time_l2_write<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    if !enabled() {
        return f();
    }
    let t = Instant::now();
    let r = f();
    L2_WRITE_NS.fetch_add(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
    r
}

/// Time the 3-layer span-name discovery phase of a corpus load and record
/// how many names it found. No-ops when perf is disabled (returns `f()`
/// without touching `Instant`).
pub fn time_list_discover<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    if !enabled() {
        return f();
    }
    let t = Instant::now();
    let r = f();
    LIST_DISCOVER_NS.fetch_add(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
    r
}

/// Time the read+parse phase of a corpus load (one call wraps the whole
/// per-span `read_effective` loop).
pub fn time_list_parse<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    if !enabled() {
        return f();
    }
    let t = Instant::now();
    let r = f();
    LIST_PARSE_NS.fetch_add(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
    r
}

/// Time a single glob scan over the flat path index. Called once per glob
/// argument; the accumulated total is reported as `list.glob-scan-us`.
pub fn time_list_glob_scan<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    if !enabled() {
        return f();
    }
    let t = Instant::now();
    let r = f();
    LIST_GLOB_SCAN_NS.fetch_add(t.elapsed().as_nanos() as u64, Ordering::Relaxed);
    r
}

pub fn record_list_spans_discovered(n: u64) {
    if !enabled() {
        return;
    }
    LIST_SPANS_DISCOVERED.fetch_add(n, Ordering::Relaxed);
}

pub fn record_list_span_parsed() {
    if !enabled() {
        return;
    }
    LIST_SPANS_PARSED.fetch_add(1, Ordering::Relaxed);
}

/// Record the byte length of a single span file's content as it is read from
/// its winning layer (worktree / index / HEAD) during a corpus load.
pub fn record_list_bytes_parsed(bytes: u64) {
    if !enabled() {
        return;
    }
    LIST_BYTES_PARSED.fetch_add(bytes, Ordering::Relaxed);
}

/// Record one actual span-file content read during a corpus load. Called once
/// per real read in the `read_effective` layer chain (worktree / index / HEAD),
/// so the total is the filesystem-independent proxy for `git span list` I/O
/// cost. If `read_effective` reads exactly one (winning) layer per span this
/// equals `list.spans-parsed`; a higher count would reveal redundant layer
/// reads per span.
pub fn record_list_layer_read() {
    if !enabled() {
        return;
    }
    LIST_LAYER_READS.fetch_add(1, Ordering::Relaxed);
}

pub fn list_discover_us() -> u64 {
    LIST_DISCOVER_NS.load(Ordering::Relaxed) / 1_000
}
pub fn list_parse_us() -> u64 {
    LIST_PARSE_NS.load(Ordering::Relaxed) / 1_000
}
pub fn list_glob_scan_us() -> u64 {
    LIST_GLOB_SCAN_NS.load(Ordering::Relaxed) / 1_000
}
pub fn list_spans_discovered() -> u64 {
    LIST_SPANS_DISCOVERED.load(Ordering::Relaxed)
}
pub fn list_spans_parsed() -> u64 {
    LIST_SPANS_PARSED.load(Ordering::Relaxed)
}
pub fn list_bytes_parsed() -> u64 {
    LIST_BYTES_PARSED.load(Ordering::Relaxed)
}
pub fn list_layer_reads() -> u64 {
    LIST_LAYER_READS.load(Ordering::Relaxed)
}

/// Reset the `git span list` corpus-load counters. Called at the top of
/// `run_list` so the emit block reports values from a single list invocation.
pub fn reset_list_counters() {
    LIST_DISCOVER_NS.store(0, Ordering::Relaxed);
    LIST_PARSE_NS.store(0, Ordering::Relaxed);
    LIST_GLOB_SCAN_NS.store(0, Ordering::Relaxed);
    LIST_SPANS_DISCOVERED.store(0, Ordering::Relaxed);
    LIST_SPANS_PARSED.store(0, Ordering::Relaxed);
    LIST_BYTES_PARSED.store(0, Ordering::Relaxed);
    LIST_LAYER_READS.store(0, Ordering::Relaxed);
}

// ── `git span stale --fix` phase timers / counters ───────────────────────────
//
// The three phase wall-clocks are recorded as raw nanosecond deltas rather than
// via a closure-style `time_*` wrapper: each phase in `run_stale` is a large
// block that propagates errors with `?`, which a `FnOnce` closure cannot do
// cleanly. The caller takes one `Instant` (only when `args.fix && enabled()`,
// keeping the off path zero-cost) and feeds the elapsed nanoseconds here.

/// Record the PRE-fix stale resolve wall-clock (the pass that finds drift before
/// any span file is rewritten), in nanoseconds.
pub fn record_fix_pre_resolve_ns(ns: u64) {
    if !enabled() {
        return;
    }
    FIX_PRE_RESOLVE_NS.fetch_add(ns, Ordering::Relaxed);
}

/// Record the `apply_fix` wall-clock — the rewrite+hash+coalesce work that edits
/// `.span/` files, EXCLUDING the post-fix re-resolve that follows it — in
/// nanoseconds.
pub fn record_fix_apply_ns(ns: u64) {
    if !enabled() {
        return;
    }
    FIX_APPLY_NS.fetch_add(ns, Ordering::Relaxed);
}

/// Record the POST-fix re-resolve/splice wall-clock (named scope or bare scan),
/// which produces the final rendered view, in nanoseconds.
pub fn record_fix_post_resolve_ns(ns: u64) {
    if !enabled() {
        return;
    }
    FIX_POST_RESOLVE_NS.fetch_add(ns, Ordering::Relaxed);
}

/// Record one anchor actually rewritten by `apply_fix`'s per-anchor loop.
pub fn record_fix_rewritable_anchor() {
    if !enabled() {
        return;
    }
    FIX_REWRITABLE_ANCHORS.fetch_add(1, Ordering::Relaxed);
}

/// Record one `hash_anchor_content` invocation made during `apply_fix`
/// (per-anchor rewrite loop) or `coalesce_line_ranges`.
pub fn record_fix_hash_call() {
    if !enabled() {
        return;
    }
    FIX_HASH_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// Record the count of span files rewritten to disk by `apply_fix` (the size of
/// its `rewritten_span_names` set). Added once per `--fix` invocation.
pub fn record_fix_spans_rewritten_count(n: u64) {
    if !enabled() {
        return;
    }
    FIX_SPANS_REWRITTEN.fetch_add(n, Ordering::Relaxed);
}

pub fn fix_pre_resolve_us() -> u64 {
    FIX_PRE_RESOLVE_NS.load(Ordering::Relaxed) / 1_000
}
pub fn fix_apply_us() -> u64 {
    FIX_APPLY_NS.load(Ordering::Relaxed) / 1_000
}
pub fn fix_post_resolve_us() -> u64 {
    FIX_POST_RESOLVE_NS.load(Ordering::Relaxed) / 1_000
}
pub fn fix_rewritable_anchors() -> u64 {
    FIX_REWRITABLE_ANCHORS.load(Ordering::Relaxed)
}
pub fn fix_hash_calls() -> u64 {
    FIX_HASH_CALLS.load(Ordering::Relaxed)
}
pub fn fix_spans_rewritten() -> u64 {
    FIX_SPANS_REWRITTEN.load(Ordering::Relaxed)
}

/// Reset the `git span stale --fix` phase counters. Called once at the top of
/// `run_stale` so the `fix.*` emit block reports values from a single `--fix`
/// invocation, accumulated across BOTH the pre- and post-fix resolve passes.
pub fn reset_fix_counters() {
    FIX_PRE_RESOLVE_NS.store(0, Ordering::Relaxed);
    FIX_APPLY_NS.store(0, Ordering::Relaxed);
    FIX_POST_RESOLVE_NS.store(0, Ordering::Relaxed);
    FIX_REWRITABLE_ANCHORS.store(0, Ordering::Relaxed);
    FIX_HASH_CALLS.store(0, Ordering::Relaxed);
    FIX_SPANS_REWRITTEN.store(0, Ordering::Relaxed);
}

pub fn gix_open_calls() -> u64 {
    GIX_OPEN_CALLS.load(Ordering::Relaxed)
}
pub fn attr_for_calls() -> u64 {
    ATTR_FOR_CALLS.load(Ordering::Relaxed)
}
pub fn is_ancestor_subprocess_calls() -> u64 {
    IS_ANCESTOR_SUBPROCESS_CALLS.load(Ordering::Relaxed)
}
pub fn is_ancestor_memo_hits() -> u64 {
    IS_ANCESTOR_MEMO_HITS.load(Ordering::Relaxed)
}
pub fn l1_hits() -> u64 {
    L1_HITS.load(Ordering::Relaxed)
}
pub fn l1_misses() -> u64 {
    L1_MISSES.load(Ordering::Relaxed)
}
pub fn l2_hits() -> u64 {
    L2_HITS.load(Ordering::Relaxed)
}
pub fn l2_misses() -> u64 {
    L2_MISSES.load(Ordering::Relaxed)
}
pub fn l2_read_us() -> u64 {
    L2_READ_NS.load(Ordering::Relaxed) / 1_000
}
pub fn l2_write_us() -> u64 {
    L2_WRITE_NS.load(Ordering::Relaxed) / 1_000
}
pub fn l2_bytes_read() -> u64 {
    L2_BYTES_READ.load(Ordering::Relaxed)
}
pub fn l2_bytes_written() -> u64 {
    L2_BYTES_WRITTEN.load(Ordering::Relaxed)
}
/// One row of per-anchor trace data emitted when `--perf-trace <path>` is set.
pub struct TraceRow {
    pub span: String,
    pub anchor_id: String,
    pub anchor_sha: String,
    pub path: String,
    pub wall_us: u128,
    pub fast_path: bool,
    pub status: &'static str,
}

/// Reset all subroutine-level counters. Called at the top of `stale_spans`
/// so the emit block reports values from a single resolver run.
pub fn reset_subroutine_counters() {
    GIX_OPEN_CALLS.store(0, Ordering::Relaxed);
    ATTR_FOR_CALLS.store(0, Ordering::Relaxed);
    IS_ANCESTOR_SUBPROCESS_CALLS.store(0, Ordering::Relaxed);
    IS_ANCESTOR_MEMO_HITS.store(0, Ordering::Relaxed);
    L1_HITS.store(0, Ordering::Relaxed);
    L1_MISSES.store(0, Ordering::Relaxed);
    L2_HITS.store(0, Ordering::Relaxed);
    L2_MISSES.store(0, Ordering::Relaxed);
    L2_READ_NS.store(0, Ordering::Relaxed);
    L2_WRITE_NS.store(0, Ordering::Relaxed);
    L2_BYTES_READ.store(0, Ordering::Relaxed);
    L2_BYTES_WRITTEN.store(0, Ordering::Relaxed);
}
