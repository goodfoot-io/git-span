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
    match std::env::var("GIT_MESH_PERF") {
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
            "git-mesh perf: {} {:.3} ms",
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
    eprintln!("git-mesh perf: {label} {value}");
}

/// Emit a free-form annotation line in the `--perf` output.
///
/// Used to add context (e.g., tier-ordering legends) that does not map to a
/// numeric counter.  No-ops when perf output is disabled.
pub fn note(text: &str) {
    if !enabled() {
        return;
    }
    eprintln!("git-mesh perf: {text}");
}

// ── Subroutine-level counters ──────────────────────────────────────────────
//
// Process-global counters incremented from deep call sites that have no
// direct access to `ResolveSession`. The `git mesh stale` CLI invokes
// `reset()` at the top of `stale_meshes` and reads the values back inside
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

// ── `git mesh list` corpus-load counters ────────────────────────────────────
//
// Phases of `load_all_meshes_in` (3-layer name discovery + per-mesh
// read/parse) and the per-layer byte volume parsed. These are incremented
// from deep call sites that have no `run_list` handle. They are reset at the
// top of `run_list` and read back in the list-path emit block, exactly like
// the resolver subroutine counters above; values are meaningful for a single
// list invocation per process.
static LIST_DISCOVER_NS: AtomicU64 = AtomicU64::new(0);
static LIST_PARSE_NS: AtomicU64 = AtomicU64::new(0);
static LIST_GLOB_SCAN_NS: AtomicU64 = AtomicU64::new(0);
static LIST_MESHES_DISCOVERED: AtomicU64 = AtomicU64::new(0);
static LIST_MESHES_PARSED: AtomicU64 = AtomicU64::new(0);
static LIST_BYTES_PARSED: AtomicU64 = AtomicU64::new(0);
static LIST_LAYER_READS: AtomicU64 = AtomicU64::new(0);

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

/// Time the 3-layer mesh-name discovery phase of a corpus load and record
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
/// per-mesh `read_effective` loop).
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

pub fn record_list_meshes_discovered(n: u64) {
    if !enabled() {
        return;
    }
    LIST_MESHES_DISCOVERED.fetch_add(n, Ordering::Relaxed);
}

pub fn record_list_mesh_parsed() {
    if !enabled() {
        return;
    }
    LIST_MESHES_PARSED.fetch_add(1, Ordering::Relaxed);
}

/// Record the byte length of a single mesh file's content as it is read from
/// its winning layer (worktree / index / HEAD) during a corpus load.
pub fn record_list_bytes_parsed(bytes: u64) {
    if !enabled() {
        return;
    }
    LIST_BYTES_PARSED.fetch_add(bytes, Ordering::Relaxed);
}

/// Record one actual mesh-file content read during a corpus load. Called once
/// per real read in the `read_effective` layer chain (worktree / index / HEAD),
/// so the total is the filesystem-independent proxy for `git mesh list` I/O
/// cost. If `read_effective` reads exactly one (winning) layer per mesh this
/// equals `list.meshes-parsed`; a higher count would reveal redundant layer
/// reads per mesh.
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
pub fn list_meshes_discovered() -> u64 {
    LIST_MESHES_DISCOVERED.load(Ordering::Relaxed)
}
pub fn list_meshes_parsed() -> u64 {
    LIST_MESHES_PARSED.load(Ordering::Relaxed)
}
pub fn list_bytes_parsed() -> u64 {
    LIST_BYTES_PARSED.load(Ordering::Relaxed)
}
pub fn list_layer_reads() -> u64 {
    LIST_LAYER_READS.load(Ordering::Relaxed)
}

/// Reset the `git mesh list` corpus-load counters. Called at the top of
/// `run_list` so the emit block reports values from a single list invocation.
pub fn reset_list_counters() {
    LIST_DISCOVER_NS.store(0, Ordering::Relaxed);
    LIST_PARSE_NS.store(0, Ordering::Relaxed);
    LIST_GLOB_SCAN_NS.store(0, Ordering::Relaxed);
    LIST_MESHES_DISCOVERED.store(0, Ordering::Relaxed);
    LIST_MESHES_PARSED.store(0, Ordering::Relaxed);
    LIST_BYTES_PARSED.store(0, Ordering::Relaxed);
    LIST_LAYER_READS.store(0, Ordering::Relaxed);
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
    pub mesh: String,
    pub anchor_id: String,
    pub anchor_sha: String,
    pub path: String,
    pub wall_us: u128,
    pub fast_path: bool,
    pub status: &'static str,
}

/// Reset all subroutine-level counters. Called at the top of `stale_meshes`
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
