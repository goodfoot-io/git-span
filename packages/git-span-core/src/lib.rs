//! `git-span-core` — the pure, gix-free kernel of git-span.
//!
//! This crate owns the parts of git-span that operate on **bytes and
//! text**, not on a repository: the anchor [`AnchorExtent`] shape, and a
//! stateless rk64 content-fingerprint move matcher
//! ([`scan_for_content_hash_rk64`] / [`scan_indexed_rk64`]). None of its
//! public API mentions gix, SQLite, or any I/O — callers supply bytes and
//! the kernel computes.
//!
//! git-span re-exports every item below from its original public path, so
//! the extraction is invisible to git-span's existing callers.
//!
//! ## Fingerprint contract
//!
//! A line-range anchor fingerprints the `\n`-joined slice of lines
//! `[start, end]` (1-based, inclusive); a whole-file anchor fingerprints the
//! full byte buffer. The fingerprint is the 64-bit rk64 polynomial hash
//! ([`cheap_fingerprint_with_extent`]), encoded as 16 lowercase hex digits
//! by [`rk64_to_hex`], stored as an `rk64:<hex>` token.

use std::sync::{Arc, OnceLock};

pub mod error;
pub mod span_file;
pub mod validation;

pub use error::{Error, Result};
pub use span_file::{SpanMergeResult, UnresolvedAnchor, has_conflict_markers, merge_span_files};
pub use validation::{
    SPAN_NAME_RULE, RESERVED_SPAN_NAMES, validate_anchor_id, validate_span_name,
    validate_span_name_shape, validate_repo_relative_path,
};

/// The extent of a pinned anchor: either the whole file, or an inclusive
/// 1-based line range.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum AnchorExtent {
    WholeFile,
    LineRange { start: u32, end: u32 },
}

/// Window height (line count) of an inclusive 1-based `LineRange`, or `0` for a
/// degenerate extent that selects no content. An extent is degenerate when
/// `start == 0` (no 1-based line) or `end < start` (empty range); both
/// fingerprint as the empty content (fingerprint `0`), so the scan family
/// must agree by treating them as a zero-height window (the reachable
/// `extent == 0` guard). Computed before any arithmetic, so `start == 0,
/// end == u32::MAX` can never overflow.
fn line_range_extent(start: u32, end: u32) -> usize {
    if start == 0 || end < start {
        return 0;
    }
    (end - start + 1) as usize
}

/// Byte offsets `[start, end)` of the canonical hash region for the
/// inclusive 1-based line range `[start_line, end_line]`, clamped to EOF
/// per `str::lines` line counting. `None` when the range selects no line
/// (the caller then hashes the empty string, matching `[].join("\n")`).
///
/// Allocation-free: a single forward pass that stops as soon as the
/// `end`-terminating newline is seen.
///
/// `LineIndex::region` is the indexed equivalent; the test
/// `line_range_region_and_lineindex_region_agree` cross-checks the two
/// implementations against every test vector and range so they cannot drift
/// independently.
fn line_range_region(bytes: &[u8], start_line: u32, end_line: u32) -> Option<(usize, usize)> {
    if start_line == 0 {
        // `start == 0` has no 1-based line; a degenerate extent selects no
        // content, matching `line_range_extent` and the scan family.
        return None;
    }
    let lo = start_line.saturating_sub(1) as usize; // 0-based first wanted line
    let hi = end_line as usize; // exclusive last wanted line (pre-clamp)
    if lo >= hi {
        // `end` selects no line (e.g. `end == 0` or `end < start`), matching
        // the reference's `lo < hi` guard before clamping.
        return None;
    }

    let len = bytes.len();
    // A non-empty buffer not ending in `\n` has an unterminated final line;
    // one ending in `\n` does not (matching `str::lines`).
    let trailing = !bytes.is_empty() && bytes[len - 1] != b'\n';

    let mut region_start: Option<usize> = if lo == 0 { Some(0) } else { None };
    let mut region_end: Option<usize> = None;
    let mut nl = 0usize; // count of '\n' seen so far
    let mut last_nl: Option<usize> = None;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            // This is the `(nl + 1)`-th newline: it ends line `nl` at `i` and
            // starts line `nl + 1` at `i + 1`.
            if nl + 1 == lo {
                region_start = Some(i + 1);
            }
            if nl + 1 == hi {
                region_end = Some(i);
            }
            nl += 1;
            last_nl = Some(i);
            if region_end.is_some() {
                break; // found the `end`-terminating newline — stop early.
            }
        }
    }

    let line_count = nl + usize::from(trailing);
    if lo >= line_count {
        // `start` is past every line — an empty range.
        return None;
    }
    let rs = region_start.expect("region_start set for lo < line_count");
    // `region_end == None` means the range runs to (or past) EOF: the last
    // wanted line is the final line, whose content ends at EOF when it is
    // unterminated, or at the last newline when the buffer ends in `\n`.
    let re = region_end.unwrap_or(if trailing {
        len
    } else {
        last_nl.expect("a terminated non-empty range has a final newline")
    });
    Some((rs, re))
}

/// Apply `digest` to the canonical content of buffer region `[rs, re)`.
/// On the LF-and-UTF-8 fast path the region is byte-identical to the
/// canonical `lines[lo..hi].join("\n")`, so `digest` runs directly on the
/// slice with no allocation. Otherwise (`\r` present, or invalid UTF-8
/// that `from_utf8_lossy` would rewrite) `digest` receives the
/// `canonical_join_bytes` fallback so the output is byte-identical.
fn canonical_region<T>(
    bytes: &[u8], rs: usize, re: usize, start: u32, end: u32,
    digest: impl FnOnce(&[u8]) -> T,
) -> T {
    let slice = &bytes[rs..re];
    if is_lf_and_utf8_clean(slice) {
        digest(slice)
    } else {
        digest(&canonical_join_bytes(bytes, start, end))
    }
}

/// True when a buffer region can be hashed directly as the canonical
/// content. The fast path is valid only when the region contains no `\r`
/// (CRLF would otherwise leak `\r` bytes that `str::lines` strips) and is
/// valid UTF-8 (otherwise `from_utf8_lossy` would rewrite bytes to U+FFFD
/// before hashing).
fn is_lf_and_utf8_clean(slice: &[u8]) -> bool {
    !slice.contains(&b'\r') && std::str::from_utf8(slice).is_ok()
}

/// The reference canonicalization, materialized: `from_utf8_lossy` the whole
/// buffer, split with `str::lines`, take the inclusive 1-based `[start, end]`
/// slice (clamped to EOF), and `join("\n")`. These are the exact bytes the
/// digest is taken over on the fallback path; both the hash and the cheap
/// fingerprint canonicalize through here so they never disagree.
fn canonical_join_bytes(bytes: &[u8], start: u32, end: u32) -> Vec<u8> {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    slice.join("\n").into_bytes()
}

/// One place a stored content hash was found in the caller-supplied
/// files. For a whole-file match `start_line` and `end_line` are both
/// `0` (the whole-file convention); for a line range they are the 1-based
/// inclusive bounds of the matching window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// Nearest-window ordering: stable sort by distance from the 1-based `near`
/// line, ties toward the lower start line. `start_line` and `near` are both
/// 1-based, so the window that starts on the `near` line is distance 0.
fn sort_near(out: &mut [Location], near: u32) {
    out.sort_by_key(|l| (l.start_line.abs_diff(near), l.start_line));
}

/// Build a fresh [`LineIndex`] for each (path, bytes) file — the byte-slice
/// entry points' shared front door.
fn build_indexed(files: &[(String, Vec<u8>)]) -> Vec<(String, LineIndex<'_>)> {
    files
        .iter()
        .map(|(path, bytes)| (path.clone(), LineIndex::build(bytes)))
        .collect()
}

/// Emit a whole-file `Location { 0, 0 }` for every file whose bytes satisfy
/// `keep`. `bytes_of` projects each file element to its buffer.
fn whole_file_matches<T>(
    files: &[(String, T)],
    bytes_of: impl Fn(&T) -> &[u8],
    keep: impl Fn(&[u8]) -> bool,
) -> Vec<Location> {
    files
        .iter()
        .filter(|(_, t)| keep(bytes_of(t)))
        .map(|(path, _)| Location {
            path: path.clone(),
            start_line: 0,
            end_line: 0,
        })
        .collect()
}

/// Drive a per-file windowed scan: for each file with enough lines, compute its
/// window bounds and run `scan_one`, accumulating into `out`. `wins` maps a
/// file's line count to its `(win_lo, win_hi)` window range, returning `None`
/// to skip the file.
fn scan_files(
    files: &[(String, LineIndex)],
    extent: usize,
    wins: impl Fn(usize) -> Option<(usize, usize)>,
    mut scan_one: impl FnMut(&str, &LineIndex, (usize, usize), &mut Vec<Location>),
    out: &mut Vec<Location>,
) {
    for (path, idx) in files {
        let n = idx.line_count();
        if n < extent {
            continue;
        }
        let Some(w) = wins(n) else { continue };
        scan_one(path, idx, w, out);
    }
}

/// Cached rolling-fingerprint prefix hashes and powers for the file bytes.
/// These are a pure function of the bytes and are computed at most once per
/// `LineIndex` lifetime.
struct PrefixTables {
    ph: Vec<u64>,
    pow: Vec<u64>,
}

/// Files larger than this threshold skip precomputed prefix-hash tables
/// and fall back to per-window `horner` (O(N.S) time, O(1) extra memory).
/// Bounds peak table memory to ~512 MiB (2 × 8 B × 32M).  Source-code
/// files (the common anchor target) are virtually always under this limit.
pub const PREFILTER_TABLES_MAX_BYTES: usize = 32 * 1024 * 1024; // 32 MiB

/// A reusable, allocation-cheap line index over a byte buffer: the start
/// and content-end (terminator-excluded) offset of every line, derived once
/// with a single newline scan. Line counting matches `str::lines` exactly —
/// a `\r\n` or `\n` ends a line and a trailing line terminator yields no
/// final empty line.
///
/// Callers that read a file once and test **many** anchors against it build
/// the index once and reuse it across [`cheap_fingerprint_indexed`] and
/// [`scan_indexed_rk64`], paying the newline scan a single time instead of once
/// per anchor and once per window scan. The byte-slice entry points
/// ([`cheap_fingerprint_with_extent`], [`scan_for_content_hash_rk64`]) are thin
/// wrappers that build a fresh index, so no existing caller has to change.
#[derive(Clone)]
pub struct LineIndex<'a> {
    bytes: &'a [u8],
    /// Start offset of each line.
    starts: Vec<u32>,
    /// Content end (exclusive of the `\n`/`\r\n` terminator) of each line.
    ends: Vec<u32>,
    /// Lazily-computed prefix-hash and power tables for the rolling
    /// fingerprint prefilter.  Populated on first prefiltered scan of an
    /// LF-clean file within the size threshold.  Shared across clones via
    /// `Arc` — at most one set of tables per file per `LineIndex` lifetime.
    ///
    /// Files exceeding [`PREFILTER_TABLES_MAX_BYTES`] never allocate these
    /// tables; the scan falls back to per-window `horner`.
    fp_tables: Arc<OnceLock<PrefixTables>>,
    /// `true` when the buffer contains no `\r` bytes and is valid UTF-8.
    /// Computed once at build time so that both scan inner loops avoid
    /// re-scanning the whole buffer per call.
    lf_clean: bool,
}

impl<'a> LineIndex<'a> {
    /// Build the line index for `bytes` with one forward newline scan.
    ///
    /// Line offsets are stored as `u32`, so the buffer must be at most
    /// `u32::MAX` (just under 4 GiB) bytes. A larger buffer is **refused**
    /// (panic) rather than indexed with silently truncated offsets: the crate's
    /// contract is fail-closed, and a wrapped offset would produce a
    /// syntactically valid but semantically wrong digest. Supporting ≥ 4 GiB
    /// files is out of scope; detecting them is required.
    pub fn build(bytes: &'a [u8]) -> LineIndex<'a> {
        assert!(
            bytes.len() <= u32::MAX as usize,
            "git-span-core: buffer of {} bytes exceeds the supported size of {} bytes \
             (LineIndex stores u32 line offsets); files of 4 GiB or larger are not indexable",
            bytes.len(),
            u32::MAX,
        );
        let mut starts = Vec::new();
        let mut ends = Vec::new();
        let mut seg = 0usize;
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' {
                starts.push(seg as u32);
                ends.push(i as u32);
                seg = i + 1;
            }
        }
        // A trailing segment with no terminating newline is the final,
        // unterminated line; a buffer ending in `\n` has none (matching
        // `str::lines`).
        if seg < bytes.len() {
            starts.push(seg as u32);
            ends.push(bytes.len() as u32);
        }
        let lf_clean = !bytes.contains(&b'\r') && std::str::from_utf8(bytes).is_ok();
        LineIndex { bytes, starts, ends, fp_tables: Arc::new(OnceLock::new()), lf_clean }
    }

    /// The underlying buffer.
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    /// Number of lines, per `str::lines` counting.
    pub fn line_count(&self) -> usize {
        self.starts.len()
    }

    /// Byte offsets `[start, end)` of the canonical region for the inclusive
    /// 1-based line range, clamped to the line count. `None` for an empty
    /// range.
    ///
    /// `line_range_region` is the allocation-free equivalent; the test
    /// `line_range_region_and_lineindex_region_agree` cross-checks the two
    /// implementations against every test vector and range so they cannot drift
    /// independently.
    fn region(&self, start: u32, end: u32) -> Option<(usize, usize)> {
        if start == 0 || start > end {
            // Degenerate extent (`start == 0` or `end < start`): no content,
            // matching `line_range_extent` and `line_range_region`.
            return None;
        }
        let lo = start.saturating_sub(1) as usize;
        let hi = (end as usize).min(self.line_count());
        if lo >= hi {
            return None;
        }
        Some((self.starts[lo] as usize, self.ends[hi - 1] as usize))
    }

    /// Returns cached fingerprint tables if the file is within the size
    /// threshold, computing them lazily on first call.  Returns `None`
    /// for files exceeding [`PREFILTER_TABLES_MAX_BYTES`], so the caller
    /// falls back to per-window `horner` (O(N.S) time, O(1) memory).
    fn prefilter_tables(&self) -> Option<&PrefixTables> {
        if self.bytes.len() > PREFILTER_TABLES_MAX_BYTES {
            return None;
        }
        Some(self.fp_tables.get_or_init(|| {
            let (ph, pow) = prefix_hashes_and_powers(self.bytes);
            PrefixTables { ph, pow }
        }))
    }
}

// --- Cheap (rk64) content fingerprint ---
//
// A polynomial (Rabin–Karp) rolling hash over the canonical content of an
// anchor's extent. This is git-span's sole content-identity fingerprint: a
// non-cryptographic, deterministic function of the canonical bytes, stored
// as the `rk64:<hex>` token and compared directly — there is no stronger
// digest backing it.

/// The stored algorithm name for an rk64 fingerprint anchor: a line-format
/// token of `rk64:<hex>` where `<hex>` is [`rk64_to_hex`] of the `u64`. This
/// is an opaque `<algorithm>:<hash>` token to [`span_file::SpanFile::parse`],
/// so it rides the existing line format with no parser change; consumers that
/// adopt rk64 identity store it under this name.
pub const RK64_ALGORITHM: &str = "rk64";

/// Canonical hex encoding of an rk64 fingerprint for the stored
/// `rk64:<hex>` token: **lowercase, zero-padded to 16 digits, big-endian**
/// (most-significant nibble first), i.e. `format!("{fp:016x}")`. Pair with
/// [`rk64_from_hex`] so a writer and any reader agree on the exact bytes.
pub fn rk64_to_hex(fp: u64) -> String {
    format!("{fp:016x}")
}

/// Parse the canonical [`rk64_to_hex`] encoding back to a `u64`. Returns
/// `None` for anything other than exactly 16 lowercase hex digits, so a
/// malformed or non-canonical token is rejected rather than silently
/// mis-decoded.
pub fn rk64_from_hex(s: &str) -> Option<u64> {
    if s.len() != 16 || !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    u64::from_str_radix(s, 16).ok()
}

/// Polynomial base for the cheap fingerprint (the FNV-64 prime — odd, so the
/// rolling subtraction below is exact over wrapping `u64` arithmetic).
const FP_BASE: u64 = 0x0000_0100_0000_01b3;

/// Per-byte value mapped into the polynomial. Adding one keeps a leading `\0`
/// from vanishing (a zero byte would otherwise contribute nothing and shift
/// silently), so distinct content is less likely to collide.
#[inline]
fn fp_byte(b: u8) -> u64 {
    (b as u64).wrapping_add(1)
}

/// Horner polynomial hash of `bytes`: `Σ fp_byte(bytes[i]) · BASE^(len-1-i)`,
/// over wrapping `u64`. `horner(b"") == 0`. This is the canonical fingerprint
/// of an already-canonicalized content slice; the rolling scan reproduces it
/// per window via prefix hashes.
fn horner(bytes: &[u8]) -> u64 {
    let mut h = 0u64;
    for &b in bytes {
        h = h.wrapping_mul(FP_BASE).wrapping_add(fp_byte(b));
    }
    h
}


/// Cheap (non-cryptographic) fingerprint of an extent's canonical content:
/// LF-normalized `lines().join("\n")` for line ranges; the full buffer for
/// whole-file extents. This `u64` is git-span's sole content-identity
/// fingerprint, encoded as the `rk64:<hex>` token and compared directly —
/// there is no stronger digest confirming it. Empty extents (a range
/// selecting no line) fingerprint to `0`, matching the empty canonical
/// content.
pub fn cheap_fingerprint_with_extent(bytes: &[u8], extent: &AnchorExtent) -> u64 {
    match extent {
        AnchorExtent::WholeFile => horner(bytes),
        AnchorExtent::LineRange { start, end } => match line_range_region(bytes, *start, *end) {
            Some((rs, re)) => canonical_region(bytes, rs, re, *start, *end, horner),
            None => 0,
        },
    }
}

/// [`cheap_fingerprint_with_extent`] over a prebuilt [`LineIndex`]. Produces
/// an identical `u64`; the only difference is that the newline scan is already
/// paid for.
pub fn cheap_fingerprint_indexed(idx: &LineIndex, extent: &AnchorExtent) -> u64 {
    match extent {
        AnchorExtent::WholeFile => horner(idx.bytes),
        AnchorExtent::LineRange { start, end } => match idx.region(*start, *end) {
            Some((rs, re)) => canonical_region(idx.bytes, rs, re, *start, *end, horner),
            None => 0,
        },
    }
}

/// Compute line-level Jaccard similarity between two byte buffers.
///
/// Both buffers are split into lines, then each line is whitespace-normalized
/// (split on whitespace and rejoined). The similarity is `|A ∩ B| / |A ∪ B|`
/// over the multiset of normalized lines, returning 0.0–1.0.
///
/// The `extent_a` parameter indicates whether `a` was sourced from a
/// whole-file or line-range anchor, allowing the caller to verify
/// canonicalization; the similarity computation itself treats both buffers
/// identically.
pub fn jaccard_similarity(a: &[u8], b: &[u8], _extent_a: &AnchorExtent) -> f64 {
    let lines_a = normalize_lines_jaccard(a);
    let lines_b = normalize_lines_jaccard(b);

    // Count frequencies in A using &str borrowing from lines_a / lines_b
    let mut freq_a: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for line in &lines_a {
        *freq_a.entry(line.as_str()).or_default() += 1;
    }

    let mut freq_b: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for line in &lines_b {
        *freq_b.entry(line.as_str()).or_default() += 1;
    }

    let mut intersection = 0usize;
    let mut union = 0usize;

    for (line, &ca) in &freq_a {
        let cb = freq_b.get(line).copied().unwrap_or(0);
        intersection += ca.min(cb);
        union += ca.max(cb);
    }
    for (_line, &cb) in &freq_b {
        if !freq_a.contains_key(_line) {
            union += cb;
        }
    }

    if union == 0 {
        return 0.0;
    }
    intersection as f64 / union as f64
}

/// Split `bytes` into lines, whitespace-normalize each line, and collect into
/// `Vec<String>`. Used by [`jaccard_similarity`] and extracted so the anchored
/// lines can be normalized once and cached across many candidate windows.
fn normalize_lines_jaccard(bytes: &[u8]) -> Vec<String> {
    let s = String::from_utf8_lossy(bytes);
    s.lines()
        .map(|l| l.split_whitespace().collect::<Vec<&str>>().join(" "))
        .collect()
}

/// Intern `s` into `interner`, returning its stable `u32` id (assigning the
/// next id on first sight). Shared by [`jaccard_window_scan`] so the
/// anchored and candidate line sets are compared by exact-equality integer
/// id rather than by re-hashing/re-comparing strings per window.
fn intern_line(interner: &mut std::collections::HashMap<String, u32>, s: String) -> u32 {
    let next = interner.len() as u32;
    *interner.entry(s).or_insert(next)
}

/// Whitespace-normalize and intern every line of `lines` into `interner`,
/// returning the per-line interned ids alongside a parallel bitmap of
/// whether each line was RAW-empty (`""`) before normalization.
///
/// Exists so a caller that scans the SAME candidate lines against many
/// different anchored texts (e.g. one Jaccard scan per drifted anchor over a
/// shared corpus of candidate files) can normalize and intern each candidate
/// file's lines exactly once and reuse the result — see
/// [`jaccard_window_scan_interned`]. `interner` must be the SAME map across
/// every call whose resulting ids are compared against each other (ids from
/// independently-built interners are not meaningfully comparable).
///
/// The raw-empty bitmap is required by [`jaccard_window_scan_interned`]'s
/// trailing-window special case (see that function's doc comment): a
/// whitespace-only line normalizes to `""` too, but is not raw-empty, and
/// the two cases are not distinguishable from the normalized id alone.
pub fn intern_normalized_lines(
    lines: &[&str],
    interner: &mut std::collections::HashMap<String, u32>,
) -> (Vec<u32>, Vec<bool>) {
    let mut ids = Vec::with_capacity(lines.len());
    let mut raw_empty = Vec::with_capacity(lines.len());
    for &l in lines {
        raw_empty.push(l.is_empty());
        let norm = l.split_whitespace().collect::<Vec<&str>>().join(" ");
        ids.push(intern_line(interner, norm));
    }
    (ids, raw_empty)
}

/// Incremental sliding-window Jaccard scan: for every window of `extent`
/// lines in `candidate_lines`, computes **exactly** the confidence
/// [`jaccard_similarity`] would return for `(anchored, window_lines.join("\n"))`,
/// but in amortized O(1) per window slide instead of re-normalizing and
/// re-hashing the whole window every time.
///
/// Returns `(win_start, confidence)` pairs (0-based window start) for every
/// window whose confidence is `>= noise_floor`, in ascending `win_start`
/// order.
///
/// ## Why this is exact, not approximate
///
/// Both the anchored text and every candidate line are whitespace-normalized
/// once (matching [`normalize_lines_jaccard`]'s per-line transform) and
/// interned so line identity becomes exact integer equality. The window
/// then slides by maintaining a running per-id `window_count` and the
/// multiset intersection size `intersection = Σ min(anchored_count[id],
/// window_count[id])`:
/// - a line entering the window increments `window_count[id]`; the
///   intersection grows by 1 iff the pre-increment count was still under
///   the anchored budget (`window_count[id] < anchored_count[id]`);
/// - a line leaving the window decrements `window_count[id]` first; the
///   intersection shrinks by 1 iff the post-decrement count is under budget.
///
/// The multiset union size is `anchored_total + extent - intersection`
/// (inclusion-exclusion over multisets, since the window always has exactly
/// `extent` lines), and `confidence = intersection / union` — dividing the
/// **same two integers** [`jaccard_similarity`]'s from-scratch computation
/// would produce for that window, so the `f64` result is bit-identical.
///
/// Joining a window's lines with `"\n"` and re-splitting via `str::lines()`
/// (what the naive per-window path does before normalizing) reproduces the
/// original `candidate_lines` entries verbatim **with one exception**:
/// `str::lines()` (via `split_terminator('\n')`) drops a trailing empty
/// segment produced by the string ending in the separator, so when a
/// window's *last* raw line is the empty string, the `"\n"`-join makes the
/// joined text end in `"\n"` and that final empty line silently vanishes
/// from the naive multiset — no other position is affected (interior and
/// leading empty lines round-trip intact; only a genuinely trailing one is
/// special-cased by `str::lines()`). `str::lines()` otherwise only ever
/// splits on `\n` and strips one trailing `\r` per resulting piece, and
/// every `candidate_lines` entry already went through that same split once
/// so it can never itself end in `\r`, and whitespace normalization
/// (`split_whitespace().join(" ")`) collapses any interior `\r` as
/// whitespace regardless — so aside from the trailing-empty-line quirk,
/// normalizing `candidate_lines[i]` directly is equivalent to the
/// rejoin-and-resplit-then-normalize the naive path performs.
/// `jaccard_window_scan_matches_naive_reference` below cross-checks this
/// against the naive per-window computation, including empty lines and
/// lone/interior/trailing `\r` inputs.
pub fn jaccard_window_scan(
    anchored: &[u8],
    candidate_lines: &[&str],
    extent: usize,
    noise_floor: f64,
) -> Vec<(usize, f64)> {
    if extent == 0 || candidate_lines.len() < extent {
        return Vec::new();
    }

    let mut interner: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    let anchored_text = String::from_utf8_lossy(anchored);
    let anchored_lines: Vec<&str> = anchored_text.lines().collect();
    let (anchored_ids, _anchored_raw_empty) =
        intern_normalized_lines(&anchored_lines, &mut interner);
    let (candidate_ids, candidate_raw_empty) =
        intern_normalized_lines(candidate_lines, &mut interner);

    jaccard_window_scan_interned(
        &anchored_ids,
        &candidate_ids,
        &candidate_raw_empty,
        extent,
        noise_floor,
    )
}

/// [`jaccard_window_scan`] over PRE-NORMALIZED, PRE-INTERNED line ids.
///
/// `anchored_ids` and `candidate_ids` must have been produced by
/// [`intern_normalized_lines`] against the SAME interner (directly, or
/// transitively via any other call sharing that interner) — this is what
/// lets a caller intern each candidate file's lines once and reuse them
/// across many anchored-side scans (each anchor's content differs, but its
/// ids must be looked up in the same corpus interner for id equality to
/// mean line equality).
///
/// `candidate_raw_empty[i]` records whether the ORIGINAL (pre-normalization)
/// line that `candidate_ids[i]` was interned from was the raw empty string
/// `""`. This is required, not derivable from `candidate_ids` alone, because
/// a whitespace-only line normalizes to `""` too but is not raw-empty — see
/// [`jaccard_window_scan`]'s doc comment for why the trailing-window special
/// case hinges on raw emptiness specifically.
///
/// Produces bit-identical `(win_start, confidence)` pairs to
/// `jaccard_window_scan` when its inputs are the corresponding pre-interned
/// form of the same `anchored`/`candidate_lines`.
pub fn jaccard_window_scan_interned(
    anchored_ids: &[u32],
    candidate_ids: &[u32],
    candidate_raw_empty: &[bool],
    extent: usize,
    noise_floor: f64,
) -> Vec<(usize, f64)> {
    if extent == 0 || candidate_ids.len() < extent {
        return Vec::new();
    }
    debug_assert_eq!(
        candidate_ids.len(),
        candidate_raw_empty.len(),
        "candidate_ids and candidate_raw_empty must be parallel arrays"
    );

    let a_total = anchored_ids.len();
    let mut anchored_count: std::collections::HashMap<u32, usize> =
        std::collections::HashMap::new();
    for &id in anchored_ids {
        *anchored_count.entry(id).or_default() += 1;
    }

    // Confidence for the window currently described by `intersection` /
    // `window_count`, whose last line is at `last_idx`. Reproduces the
    // trailing-empty-line drop documented above: when that RAW line was
    // `""`, the naive multiset excludes it, so this virtually removes one
    // occurrence of its id (without touching the persistent sliding-window
    // state, since that same line is a normal interior member of every
    // other window it participates in) and unions over `extent - 1` lines
    // instead of `extent`.
    let window_confidence = |intersection: usize,
                              window_count: &std::collections::HashMap<u32, usize>,
                              last_idx: usize|
     -> f64 {
        if !candidate_raw_empty[last_idx] {
            let union = a_total + extent - intersection;
            return if union == 0 {
                0.0
            } else {
                intersection as f64 / union as f64
            };
        }
        let last_id = candidate_ids[last_idx];
        let ac = anchored_count.get(&last_id).copied().unwrap_or(0);
        let wc = window_count.get(&last_id).copied().unwrap_or(0);
        // Post-(virtual)-decrement check, matching the real leave-step rule.
        let adjustment = usize::from(wc.saturating_sub(1) < ac);
        let adj_intersection = intersection - adjustment;
        let adj_extent = extent - 1;
        let union = a_total + adj_extent - adj_intersection;
        if union == 0 {
            0.0
        } else {
            adj_intersection as f64 / union as f64
        }
    };

    let mut window_count: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
    let mut intersection: usize = 0;
    let mut results: Vec<(usize, f64)> = Vec::new();

    // Initialize the first window [0, extent) by "entering" every line.
    for &id in &candidate_ids[0..extent] {
        let ac = anchored_count.get(&id).copied().unwrap_or(0);
        let wc = window_count.entry(id).or_insert(0);
        if *wc < ac {
            intersection += 1;
        }
        *wc += 1;
    }
    let conf0 = window_confidence(intersection, &window_count, extent - 1);
    if conf0 >= noise_floor {
        results.push((0, conf0));
    }

    let win_max = candidate_ids.len() - extent;
    for win_start in 1..=win_max {
        // The line leaving the window: decrement first, then check.
        let leaving = candidate_ids[win_start - 1];
        {
            let ac = anchored_count.get(&leaving).copied().unwrap_or(0);
            let wc = window_count
                .get_mut(&leaving)
                .expect("leaving id was inserted when it entered the window");
            *wc -= 1;
            if *wc < ac {
                intersection -= 1;
            }
        }
        // The line entering the window: check first, then increment.
        let entering = candidate_ids[win_start + extent - 1];
        {
            let ac = anchored_count.get(&entering).copied().unwrap_or(0);
            let wc = window_count.entry(entering).or_insert(0);
            if *wc < ac {
                intersection += 1;
            }
            *wc += 1;
        }
        let conf = window_confidence(intersection, &window_count, win_start + extent - 1);
        if conf >= noise_floor {
            results.push((win_start, conf));
        }
    }

    results
}

/// Find every window whose rk64 fingerprint
/// ([`cheap_fingerprint_with_extent`]) equals `cheap_fp` — the 64-bit
/// fingerprint is the sole content identity, with no stronger confirmation.
///
/// All matches, ordered nearest-`near`-first (ties toward the lower start
/// line) when `near` is given, else positional order; ≥2 matches means the
/// content is ambiguous within the scanned files. A returned location is a
/// window whose *fingerprint* matches, not one proven byte-identical.
/// Callers accept a ~`2⁻⁶⁴`-per-comparison chance that a hit is a
/// fingerprint collision rather than the anchored content.
///
/// rk64 is a 64-bit, **non-cryptographic**, linear (polynomial/Rabin–Karp)
/// fingerprint — fine for content where a rare wrong/missed match is
/// self-correcting (e.g. documentation-link tracking), but **not** a
/// content-integrity hash. The work is a rolling pass over each file: O(N·L)
/// per file, pure and caller-fed. A whole-file extent matches whole files by
/// their fingerprint (the rk64 of the full buffer).
pub fn scan_indexed_rk64(
    files: &[(String, LineIndex)],
    cheap_fp: u64,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    match extent {
        AnchorExtent::WholeFile => {
            whole_file_matches(files, |idx| idx.bytes, |b| horner(b) == cheap_fp)
        }
        AnchorExtent::LineRange { start, end } => {
            let extent = line_range_extent(start, end);
            if extent == 0 {
                return Vec::new();
            }
            let mut out: Vec<Location> = Vec::new();
            scan_files(
                files,
                extent,
                |n| Some((0, n - extent)),
                |path, idx, w, out| {
                    // No SHA verify: a matching fingerprint is the match.
                    scan_one_file_fp_filtered(path, idx, extent, w, cheap_fp, |_| true, out);
                },
                &mut out,
            );
            if let Some(near) = near {
                sort_near(&mut out, near);
            }
            out
        }
    }
}

/// [`scan_indexed_rk64`] against a single already-built [`LineIndex`], taken
/// by reference. Same match/ordering contract, restricted to one file.
///
/// Exists so a caller holding one cached [`LineIndex`] (e.g. a session-scoped
/// per-`(path, layer)` cache) doesn't have to satisfy `scan_indexed_rk64`'s
/// `&[(String, LineIndex)]` shape by cloning the index — `LineIndex::clone`
/// duplicates its `starts`/`ends` offset vectors (O(line count)), which is
/// pure waste when there is only one file to scan and it is already indexed.
/// `path` is used only to label returned [`Location`]s.
pub fn scan_indexed_rk64_one(
    path: &str,
    idx: &LineIndex,
    cheap_fp: u64,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    match extent {
        AnchorExtent::WholeFile => {
            if horner(idx.bytes) == cheap_fp {
                vec![Location {
                    path: path.to_string(),
                    start_line: 0,
                    end_line: 0,
                }]
            } else {
                Vec::new()
            }
        }
        AnchorExtent::LineRange { start, end } => {
            let extent = line_range_extent(start, end);
            if extent == 0 {
                return Vec::new();
            }
            let n = idx.line_count();
            if n < extent {
                return Vec::new();
            }
            let mut out: Vec<Location> = Vec::new();
            // No SHA verify: a matching fingerprint is the match (mirrors
            // `scan_indexed_rk64`'s per-file body exactly).
            scan_one_file_fp_filtered(path, idx, extent, (0, n - extent), cheap_fp, |_| true, &mut out);
            if let Some(near) = near {
                sort_near(&mut out, near);
            }
            out
        }
    }
}

/// [`scan_indexed_rk64`] over `Vec<u8>` inputs, building each [`LineIndex`]
/// internally, for callers that have not already indexed their files.
pub fn scan_for_content_hash_rk64(
    files: &[(String, Vec<u8>)],
    cheap_fp: u64,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    let indexed = build_indexed(files);
    scan_indexed_rk64(&indexed, cheap_fp, extent, near)
}

/// Scan one file's `extent`-high windows, emitting a [`Location`] for every
/// window whose rolling polynomial fingerprint equals `cheap_fp` **and** that
/// `confirm` accepts. On the LF-and-UTF-8 fast path a single prefix-hash pass
/// over the buffer makes each window's fingerprint an O(1) subtraction;
/// `\r`/non-UTF-8 files fingerprint the canonical lossy join per window so
/// results stay byte-identical to the reference matcher. `confirm` receives the
/// window's canonical content bytes; the rk64-only matcher passes `|_| true`.
fn scan_one_file_fp_filtered(
    path: &str,
    idx: &LineIndex,
    extent: usize,
    wins: (usize, usize),
    cheap_fp: u64,
    mut confirm: impl FnMut(&[u8]) -> bool,
    out: &mut Vec<Location>,
) {
    let (win_lo, win_hi) = wins;
    let bytes = idx.bytes;
    let simple = idx.lf_clean;

    if simple {
        // Prefix hashes `ph[k] = horner(bytes[0..k])` and powers `pow[i] =
        // BASE^i` give every window's fingerprint as `ph[re] - ph[rs]·pow[re-rs]`
        // in O(1) — the rolling reduction of recomputing `horner` per window.
        // For files under the size threshold the tables are cached on the
        // `LineIndex`; larger files fall back to per-window `horner`.
        let tables = idx.prefilter_tables();
        for win in win_lo..=win_hi {
            let rs = idx.starts[win] as usize;
            let re = idx.ends[win + extent - 1] as usize;
            let fp = match tables {
                Some(t) => t.ph[re].wrapping_sub(t.ph[rs].wrapping_mul(t.pow[re - rs])),
                None => horner(&bytes[rs..re]),
            };
            if fp == cheap_fp && confirm(&bytes[rs..re]) {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + extent as u32,
                });
            }
        }
    } else {
        let text = String::from_utf8_lossy(bytes);
        let lines: Vec<&str> = text.lines().collect();
        for win in win_lo..=win_hi {
            let joined = lines[win..win + extent].join("\n");
            if horner(joined.as_bytes()) == cheap_fp && confirm(joined.as_bytes()) {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + extent as u32,
                });
            }
        }
    }
}

/// Build the prefix-hash and power tables for `bytes` in one pass. `ph` has
/// length `bytes.len() + 1` with `ph[0] = 0` and `ph[k+1] = ph[k]·BASE +
/// fp_byte(bytes[k])`; `pow[i] = BASE^i` for `i in 0..=bytes.len()`. Then
/// `horner(bytes[a..b]) == ph[b] - ph[a]·pow[b-a]` over wrapping `u64`.
fn prefix_hashes_and_powers(bytes: &[u8]) -> (Vec<u64>, Vec<u64>) {
    let n = bytes.len();
    let mut ph = Vec::with_capacity(n + 1);
    let mut pow = Vec::with_capacity(n + 1);
    ph.push(0u64);
    pow.push(1u64);
    for (i, &b) in bytes.iter().enumerate() {
        ph.push(ph[i].wrapping_mul(FP_BASE).wrapping_add(fp_byte(b)));
        pow.push(pow[i].wrapping_mul(FP_BASE));
    }
    (ph, pow)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A buffer whose byte offsets exceed `u32::MAX` cannot be represented in
    /// the `u32` offset store, so `LineIndex::build` must refuse it (fail
    /// closed) rather than silently truncate offsets and produce wrong line
    /// boundaries. Regression for the offset-truncation defect (card
    /// main-113). Requires ~4 GiB of RAM.
    #[test]
    #[should_panic(expected = "exceeds the supported size")]
    fn build_refuses_buffer_larger_than_u32_offsets() {
        // One byte past `u32::MAX` so the final newline's offset cannot be
        // represented as a `u32`; pre-guard, `i as u32` wraps to a small value.
        let len = u32::MAX as usize + 2;
        let mut bytes = vec![b'a'; len];
        *bytes.last_mut().unwrap() = b'\n';
        let _ = LineIndex::build(&bytes);
    }

    // --- Hand-built test vectors over every endings/UTF-8 case ---

    const VECTORS: &[&[u8]] = &[
        b"",
        b"\n",
        b"a",
        b"a\n",
        b"a\nb\nc",
        b"a\nb\nc\n",
        b"a\n\nb\n",            // blank line
        b"a\r\nb\r\nc\r\n",     // CRLF
        b"a\r\nb\nc\r\n",       // mixed endings
        b"a\rb\nc\n",           // bare CR (not a line ending)
        b"line\xffwith\nbad\n", // invalid UTF-8 (lone 0xFF)
        b"only-no-newline",
        b"\n\n\n",
        b"x\ny\nz\nx\ny\nz\n", // repeated block (ambiguity)
    ];

    #[test]
    fn line_range_region_and_lineindex_region_agree() {
        for &bytes in VECTORS {
            let idx = LineIndex::build(bytes);
            for start in 0u32..=8 {
                for end in 0u32..=10 {
                    assert_eq!(
                        line_range_region(bytes, start, end),
                        idx.region(start, end),
                        "region mismatch for {bytes:?} range {start}..={end}"
                    );
                }
            }
        }
    }

    // Tiny deterministic LCG so the fuzz is reproducible without `rand`.
    fn lcg(state: &mut u64) -> u64 {
        *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        *state
    }

    fn random_bytes(state: &mut u64, max_len: usize) -> Vec<u8> {
        let len = (lcg(state) as usize) % (max_len + 1);
        (0..len)
            .map(|_| {
                // Bias toward newlines, CR, and a stray high byte so the
                // tricky paths are exercised often.
                match lcg(state) % 8 {
                    0 | 1 => b'\n',
                    2 => b'\r',
                    3 => 0xff,
                    n => b'a' + (n as u8 - 4),
                }
            })
            .collect()
    }

    // --- Cheap-fingerprint prefilter ---

    fn index_all(files: &[(String, Vec<u8>)]) -> Vec<(String, LineIndex<'_>)> {
        files
            .iter()
            .map(|(p, b)| (p.clone(), LineIndex::build(b)))
            .collect()
    }

    #[test]
    fn fingerprint_byte_slice_and_indexed_agree_across_vectors() {
        // The two entry points must produce identical fingerprints for every
        // endings/UTF-8 case and range, exactly as the hash entry points do.
        for &bytes in VECTORS {
            let idx = LineIndex::build(bytes);
            assert_eq!(
                cheap_fingerprint_with_extent(bytes, &AnchorExtent::WholeFile),
                cheap_fingerprint_indexed(&idx, &AnchorExtent::WholeFile),
                "whole-file fingerprint disagreed for {bytes:?}"
            );
            for start in 0u32..=8 {
                for end in 0u32..=10 {
                    let extent = AnchorExtent::LineRange { start, end };
                    assert_eq!(
                        cheap_fingerprint_with_extent(bytes, &extent),
                        cheap_fingerprint_indexed(&idx, &extent),
                        "fingerprint disagreed for {bytes:?} range {start}..={end}"
                    );
                }
            }
        }
    }

    #[test]
    fn fingerprint_canonicalizes_like_the_hash() {
        // A CRLF file and its LF-normalized twin share canonical content, so
        // their fingerprint must coincide.
        let crlf = b"a\r\nb\r\nc\r\n".to_vec();
        let lf = b"a\nb\nc\n".to_vec();
        for extent in [
            AnchorExtent::WholeFile,
            AnchorExtent::LineRange { start: 1, end: 2 },
            AnchorExtent::LineRange { start: 2, end: 3 },
        ] {
            if let AnchorExtent::LineRange { .. } = extent {
                // Whole-file hashes raw bytes (CRLF differs); only line ranges
                // canonicalize, so compare those.
                assert_eq!(
                    cheap_fingerprint_with_extent(&crlf, &extent),
                    cheap_fingerprint_with_extent(&lf, &extent),
                    "canonical fingerprint drifted between CRLF and LF for {extent:?}"
                );
            }
        }
    }

    // --- rk64-only (SHA-free) matcher ---

    /// Reference: every window whose rk64 fingerprint equals `fp`, in ascending
    /// (path, start) order, re-sorted nearest-first when `near` is given.
    fn ref_rk64(
        files: &[(String, Vec<u8>)],
        fp: u64,
        extent: AnchorExtent,
        near: Option<u32>,
    ) -> Vec<Location> {
        let AnchorExtent::LineRange { start, end } = extent else {
            return files
                .iter()
                .filter(|(_, b)| cheap_fingerprint_with_extent(b, &AnchorExtent::WholeFile) == fp)
                .map(|(p, _)| Location { path: p.clone(), start_line: 0, end_line: 0 })
                .collect();
        };
        let extent = line_range_extent(start, end);
        if extent == 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        for (path, bytes) in files {
            let idx = LineIndex::build(bytes);
            let n = idx.line_count();
            if n < extent {
                continue;
            }
            for win in 0..=(n - extent) {
                let w = (win as u32) + 1;
                let e = (win as u32) + extent as u32;
                let wfp = cheap_fingerprint_indexed(&idx, &AnchorExtent::LineRange { start: w, end: e });
                if wfp == fp {
                    out.push(Location { path: path.clone(), start_line: w, end_line: e });
                }
            }
        }
        if let Some(near) = near {
            out.sort_by_key(|l| (l.start_line.abs_diff(near), l.start_line));
        }
        out
    }

    #[test]
    fn rk64_matches_duplicated_windows_fail_closed() {
        // Two identical blocks ⇒ ≥2 fingerprint hits ⇒ the caller's ambiguity
        // rule refuses the rewrite. No SHA is consulted.
        let files = vec![("dup.txt".to_string(), b"x\ny\nz\nq\nx\ny\nz\n".to_vec())];
        let extent = AnchorExtent::LineRange { start: 1, end: 3 };
        let fp = cheap_fingerprint_with_extent(b"x\ny\nz", &AnchorExtent::WholeFile);
        let hits = scan_for_content_hash_rk64(&files, fp, extent, None);
        assert_eq!(
            hits,
            vec![
                Location { path: "dup.txt".into(), start_line: 1, end_line: 3 },
                Location { path: "dup.txt".into(), start_line: 5, end_line: 7 },
            ]
        );
    }

    #[test]
    fn rk64_property_matches_fingerprint_filter_reference() {
        let mut state = 0x5151515151515151u64;
        for _ in 0..3000 {
            let files: Vec<(String, Vec<u8>)> = (0..3)
                .map(|i| (format!("f{i}.txt"), random_bytes(&mut state, 30)))
                .collect();
            let indexed = index_all(&files);
            let start = 1 + (lcg(&mut state) % 6) as u32;
            let end = start + (lcg(&mut state) % 4) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let extent_lines = (end - start + 1) as usize;

            // Mostly target a real window's fingerprint; sometimes a random fp
            // (overwhelmingly a miss) to exercise the empty path.
            let fp = if lcg(&mut state).is_multiple_of(4) {
                lcg(&mut state)
            } else {
                let pick = &files[(lcg(&mut state) as usize) % files.len()].1;
                let text = String::from_utf8_lossy(pick);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() < extent_lines {
                    continue;
                }
                let w = (lcg(&mut state) as usize) % (lines.len() - extent_lines + 1);
                cheap_fingerprint_with_extent(
                    lines[w..w + extent_lines].join("\n").as_bytes(),
                    &AnchorExtent::WholeFile,
                )
            };

            let near = if lcg(&mut state).is_multiple_of(2) {
                None
            } else {
                Some((lcg(&mut state) % 12) as u32)
            };

            assert_eq!(
                scan_indexed_rk64(&indexed, fp, extent, near),
                ref_rk64(&files, fp, extent, near),
                "rk64 drift: files={files:?} {extent:?} near={near:?}"
            );
        }
    }

    #[test]
    fn rk64_whole_file_matches_by_fingerprint() {
        let files = vec![
            ("yes.txt".to_string(), b"whole\ncontent\n".to_vec()),
            ("no.txt".to_string(), b"other\n".to_vec()),
        ];
        let fp = cheap_fingerprint_with_extent(b"whole\ncontent\n", &AnchorExtent::WholeFile);
        assert_eq!(
            scan_for_content_hash_rk64(&files, fp, AnchorExtent::WholeFile, None),
            vec![Location { path: "yes.txt".into(), start_line: 0, end_line: 0 }],
        );
    }

    #[test]
    fn rk64_hex_roundtrips_and_is_canonical() {
        for fp in [0u64, 1, 0xff, 0x1234_5678_9abc_def0, u64::MAX, FP_BASE] {
            let hex = rk64_to_hex(fp);
            assert_eq!(hex.len(), 16, "must be zero-padded to 16 digits");
            assert_eq!(hex, hex.to_lowercase(), "must be lowercase");
            assert_eq!(rk64_from_hex(&hex), Some(fp), "must round-trip");
        }
        // Big-endian: the most-significant nibble leads.
        assert_eq!(rk64_to_hex(0x1), "0000000000000001");
        assert_eq!(rk64_to_hex(0xf000_0000_0000_0000), "f000000000000000");
        // Non-canonical inputs are rejected, not silently coerced.
        assert_eq!(rk64_from_hex("1"), None, "wrong length");
        assert_eq!(rk64_from_hex("00000000000000001"), None, "17 digits");
        assert_eq!(rk64_from_hex("0000000000ABCDEF"), None, "uppercase");
        assert_eq!(rk64_from_hex("000000000000000g"), None, "non-hex");
        assert_eq!(RK64_ALGORITHM, "rk64");
    }

    // --- Degenerate line-range extents: hashing and scanning must agree that
    // a degenerate extent (`end < start`, `start == 0`, or extreme bounds)
    // selects no content, so a scan for it locates nothing and no input panics.

    #[test]
    fn degenerate_end_before_start_hashes_empty_and_scans_nothing() {
        // `end < start` selects no line, so the fingerprint falls back to the
        // empty-content value. A scan for that must never locate a match.
        let bytes = b"a\n\nb\n".to_vec();
        let extent = AnchorExtent::LineRange { start: 5, end: 3 };

        assert_eq!(
            cheap_fingerprint_with_extent(&bytes, &extent),
            0,
            "end < start must fingerprint as empty content",
        );

        let files = vec![("f.txt".to_string(), bytes.clone())];
        let indexed = index_all(&files);
        let fp = cheap_fingerprint_with_extent(&bytes, &extent);

        assert!(scan_indexed_rk64(&indexed, fp, extent, None).is_empty());
    }

    #[test]
    fn degenerate_start_zero_hashes_empty_and_scans_nothing() {
        // `start == 0` is a degenerate extent: it selects no content on the
        // hashing side, and the scan family must agree.
        let bytes = b"a\nb\nc\n".to_vec();
        let extent = AnchorExtent::LineRange { start: 0, end: 3 };

        assert_eq!(
            cheap_fingerprint_with_extent(&bytes, &extent),
            0,
            "start == 0 must fingerprint as empty content",
        );

        let files = vec![("f.txt".to_string(), bytes.clone())];
        let indexed = index_all(&files);

        assert!(scan_indexed_rk64(&indexed, 0, extent, None).is_empty());
    }

    #[test]
    fn degenerate_extreme_bounds_do_not_overflow() {
        // `start == 0, end == u32::MAX` makes `end - start + 1` overflow a
        // `u32`: a panic in debug builds, a wrap to `0` in release. An absurd
        // extent is still just an extent — every scan must return cleanly.
        let bytes = b"a\nb\nc\n".to_vec();
        let files = vec![("f.txt".to_string(), bytes.clone())];
        let indexed = index_all(&files);
        let extent = AnchorExtent::LineRange { start: 0, end: u32::MAX };

        assert!(scan_indexed_rk64(&indexed, 0, extent, None).is_empty());
    }

    // --- Jaccard similarity ---

    #[test]
    fn jaccard_identical_content_scores_one() {
        let text = b"fn hello() {\n    let x = 1;\n    return x;\n}\n";
        let extent = AnchorExtent::LineRange { start: 1, end: 4 };
        let score = jaccard_similarity(text, text, &extent);
        assert!(
            (score - 1.0).abs() < 1e-9,
            "identical content should score 1.0, got {score}"
        );
    }

    #[test]
    fn jaccard_disjoint_content_scores_zero() {
        // Truly disjoint: no shared normalized lines at all.
        let a = b"aaaaa bbbbb\nccccc ddddd\n";
        let b = b"eeeee fffff\nggggg hhhhh\n";
        let extent = AnchorExtent::LineRange { start: 1, end: 2 };
        let score = jaccard_similarity(a, b, &extent);
        assert!(
            score < 1e-9,
            "disjoint content should score 0.0, got {score}"
        );
    }

    #[test]
    fn jaccard_typical_move_and_edit() {
        // 3 lines, 1 changed (variable rename on line 2).
        // Intersection: {"a()", "}"} → 2 lines.
        // Union: {"a()", "x = 1;", "y = 1;", "}"} → 4 distinct lines.
        // score = 2/4 = 0.50.
        let a = b"a()\nx = 1;\n}\n";
        let b = b"a()\ny = 1;\n}\n";
        let extent = AnchorExtent::LineRange { start: 1, end: 3 };
        let score = jaccard_similarity(a, b, &extent);
        assert!(
            (score - 0.50).abs() < 0.01,
            "1-line edit in 3 should score ~0.50, got {score}"
        );
    }

    #[test]
    fn jaccard_single_line_edge_case() {
        let a = b"let x = 1;";
        let b = b"let y = 2;";
        let extent = AnchorExtent::LineRange { start: 1, end: 1 };
        let score = jaccard_similarity(a, b, &extent);
        // Single line, both lines differ
        assert!(
            (score - 0.0).abs() < 1e-9,
            "single differing line should score 0.0, got {score}"
        );
    }

    #[test]
    fn jaccard_empty_content_scores_zero() {
        let a = b"";
        let b = b"some content\n";
        let extent = AnchorExtent::LineRange { start: 1, end: 1 };
        let score = jaccard_similarity(a, b, &extent);
        assert!(
            (score - 0.0).abs() < 1e-9,
            "empty content should score 0.0, got {score}"
        );
    }

    #[test]
    fn jaccard_whitespace_differences_normalized() {
        // Same tokens with only whitespace differences.
        // Note: `( )` vs `()` differ because parentheses are not whitespace.
        // Use function calls where only internal spaces differ.
        let a = b"hello    world\nfoo  bar  baz\nend\n";
        let b = b"hello world\nfoo bar baz\nend\n";
        let extent = AnchorExtent::LineRange { start: 1, end: 3 };
        let score = jaccard_similarity(a, b, &extent);
        assert!(
            (score - 1.0).abs() < 1e-9,
            "whitespace-only differences should score 1.0, got {score}"
        );
    }

    // --- jaccard_window_scan: parity with the naive per-window reference ---

    /// The pre-optimization per-window computation: slide a window, join
    /// with `"\n"`, and call [`jaccard_similarity`] fresh each time. This is
    /// what `find_similar_ranges` did before `jaccard_window_scan` and is
    /// the oracle the incremental scan must agree with bit-for-bit.
    fn naive_window_scan(
        anchored: &[u8],
        candidate_lines: &[&str],
        extent: usize,
        noise_floor: f64,
    ) -> Vec<(usize, f64)> {
        if extent == 0 || candidate_lines.len() < extent {
            return Vec::new();
        }
        let extent_marker = AnchorExtent::LineRange { start: 1, end: extent as u32 };
        let win_max = candidate_lines.len() - extent;
        let mut out = Vec::new();
        for w in 0..=win_max {
            let joined = candidate_lines[w..w + extent].join("\n");
            let confidence = jaccard_similarity(anchored, joined.as_bytes(), &extent_marker);
            if confidence >= noise_floor {
                out.push((w, confidence));
            }
        }
        out
    }

    /// Cross-checks `jaccard_window_scan` against `naive_window_scan` with
    /// `noise_floor = 0.0` (every window kept) so full result vectors —
    /// including exact `f64` confidences — must match, plus a second pass at
    /// the real `0.50` noise floor to confirm the filter behaves the same.
    fn assert_window_scan_matches_naive(anchored: &[u8], candidate_lines: &[&str], extent: usize) {
        for noise_floor in [0.0, 0.50] {
            let got = jaccard_window_scan(anchored, candidate_lines, extent, noise_floor);
            let want = naive_window_scan(anchored, candidate_lines, extent, noise_floor);
            assert_eq!(
                got, want,
                "jaccard_window_scan drifted from naive reference: anchored={anchored:?} \
                 candidate_lines={candidate_lines:?} extent={extent} noise_floor={noise_floor}"
            );
        }
    }

    #[test]
    fn jaccard_window_scan_matches_naive_reference() {
        // Repeated lines (multiset counting, not set counting).
        assert_window_scan_matches_naive(
            b"x\ny\nx\n",
            &["x", "y", "x", "z", "x", "y", "x"],
            3,
        );
        // Whitespace variants collapse to the same normalized line.
        assert_window_scan_matches_naive(
            b"hello   world\nfoo\n",
            &["hello world", "foo", "bar", "hello     world", "foo"],
            2,
        );
        // Empty lines participate as their own (empty-string) identity.
        assert_window_scan_matches_naive(
            b"a\n\nb\n",
            &["a", "", "b", "", "a", "", "c"],
            3,
        );
        // Unicode content (multi-byte chars, combining marks).
        assert_window_scan_matches_naive(
            "café\n日本語\n".as_bytes(),
            &["café", "日本語", "other", "café", "日本語"],
            2,
        );
        // A lone '\r' inside a line (not a line terminator) — split_whitespace
        // treats it as whitespace on both the naive rejoin-then-resplit path
        // and the direct-normalize path.
        assert_window_scan_matches_naive(
            b"a\rb\nc\n",
            &["a\rb", "c", "d", "a\rb"],
            2,
        );
        // A trailing '\r' on a line — cannot arise from a real `str::lines()`
        // split, but the function must still agree with the naive rejoin
        // path if handed one directly (defensive equivalence check).
        assert_window_scan_matches_naive(
            b"x\n",
            &["x\r", "y", "x\r"],
            2,
        );
        // extent larger than the candidate file: both sides return empty.
        assert_window_scan_matches_naive(b"a\nb\n", &["a", "b"], 5);
        // extent == 1: every single line is its own window.
        assert_window_scan_matches_naive(b"a\n", &["a", "b", "a", "c", "a"], 1);
        // extent == 0: degenerate, both sides empty.
        assert_eq!(jaccard_window_scan(b"a\n", &["a", "b"], 0, 0.0), Vec::new());
    }

    #[test]
    fn jaccard_window_scan_property_fuzz_matches_naive() {
        let mut state = 0xabad1deaabad1deau64;
        let alphabet = ["foo", "bar", "baz  qux", "  spaced  out ", "", "foo\rbar", "unicode 日本"];
        for _ in 0..500 {
            let a_len = 1 + (lcg(&mut state) as usize) % 5;
            let anchored_lines: Vec<&str> = (0..a_len)
                .map(|_| alphabet[(lcg(&mut state) as usize) % alphabet.len()])
                .collect();
            let anchored = anchored_lines.join("\n").into_bytes();

            let c_len = (lcg(&mut state) as usize) % 12;
            let candidate_lines: Vec<&str> = (0..c_len)
                .map(|_| alphabet[(lcg(&mut state) as usize) % alphabet.len()])
                .collect();
            let extent = 1 + (lcg(&mut state) as usize) % 5;

            assert_window_scan_matches_naive(&anchored, &candidate_lines, extent);
        }
    }

    /// Simulates the session-scoped usage pattern `jaccard_window_scan_interned`
    /// is designed for: a single candidate corpus interned ONCE into a shared
    /// interner, then scanned against several *different* anchored texts (as
    /// if each were a separate drifted anchor in the same resolve session).
    /// Each interned-path result must exactly match calling the byte-based
    /// `jaccard_window_scan` fresh for that same (anchored, candidate) pair —
    /// proving that reusing ids assigned across unrelated prior calls (here,
    /// prior anchored-side interning) doesn't perturb the multiset math,
    /// since only id *equality*, never id *value*, is ever inspected.
    #[test]
    fn jaccard_window_scan_interned_matches_fresh_scan_across_shared_corpus() {
        let candidate_lines: Vec<&str> = vec![
            "alpha", "beta", "gamma", "alpha", "delta", "beta", "gamma", "epsilon", "alpha",
            "beta",
        ];
        let extent = 3;
        let noise_floor = 0.0;

        let mut interner: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        let (candidate_ids, candidate_raw_empty) =
            intern_normalized_lines(&candidate_lines, &mut interner);

        let anchored_texts: &[&[u8]] = &[
            b"alpha\nbeta\ngamma\n",
            b"zzz\nalpha\nbeta\n",
            b"gamma\nepsilon\nalpha\n",
            b"nothing\nmatches\nhere\n",
        ];

        for anchored in anchored_texts {
            // Interning this anchored text's lines mutates the SHARED interner
            // (assigning fresh ids for any word not already seen by a
            // previous iteration or by the candidate corpus above) — exactly
            // as a real session would accumulate ids across anchors.
            let anchored_text = String::from_utf8_lossy(anchored);
            let anchored_lines: Vec<&str> = anchored_text.lines().collect();
            let (anchored_ids, _) = intern_normalized_lines(&anchored_lines, &mut interner);

            let got = jaccard_window_scan_interned(
                &anchored_ids,
                &candidate_ids,
                &candidate_raw_empty,
                extent,
                noise_floor,
            );
            let want = jaccard_window_scan(anchored, &candidate_lines, extent, noise_floor);
            assert_eq!(
                got, want,
                "interned scan drifted from fresh byte-based scan: anchored={anchored:?}"
            );
        }
    }

    /// A whitespace-only line (e.g. `"   "`) normalizes to the same `""` id
    /// as a genuinely raw-empty line, but [`intern_normalized_lines`] must
    /// still report it as NOT raw-empty in its bitmap — this is what lets
    /// [`jaccard_window_scan_interned`]'s trailing-window special case tell
    /// the two apart (only a truly raw-empty trailing line triggers the
    /// naive-reference's "drop the empty line" adjustment).
    #[test]
    fn intern_normalized_lines_distinguishes_raw_empty_from_whitespace_only() {
        let lines = ["a", "", "   ", "\t", "b"];
        let mut interner: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        let (ids, raw_empty) = intern_normalized_lines(&lines, &mut interner);

        assert_eq!(raw_empty, vec![false, true, false, false, false]);
        // "", "   ", and "\t" all normalize to the same empty-string id.
        assert_eq!(ids[1], ids[2]);
        assert_eq!(ids[1], ids[3]);
        // But that shared normalized id is distinct from "a" and "b".
        assert_ne!(ids[0], ids[1]);
        assert_ne!(ids[4], ids[1]);

        // And this distinction changes real scan results: a candidate whose
        // trailing line is whitespace-only must NOT get the empty-line-drop
        // adjustment that a truly-raw-empty trailing line gets.
        let anchored = b"a\nb\n";
        let candidate_whitespace_trailing = ["a", "b", "   "];
        let candidate_raw_empty_trailing = ["a", "b", ""];
        let with_whitespace =
            jaccard_window_scan(anchored, &candidate_whitespace_trailing, 3, 0.0);
        let with_raw_empty = jaccard_window_scan(anchored, &candidate_raw_empty_trailing, 3, 0.0);
        assert_ne!(
            with_whitespace, with_raw_empty,
            "whitespace-only trailing line must not be treated as raw-empty"
        );
    }

    // --- scan_indexed_rk64_one: parity with scan_indexed_rk64 on one file ---

    #[test]
    fn scan_indexed_rk64_one_matches_scan_indexed_rk64() {
        let mut state = 0x0ddc0ffee0ddc0ffu64;
        for _ in 0..2000 {
            let bytes = random_bytes(&mut state, 40);
            let idx = LineIndex::build(&bytes);
            let start = 1 + (lcg(&mut state) % 6) as u32;
            let end = start + (lcg(&mut state) % 4) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let extent_lines = line_range_extent(start, end);

            let fp = if lcg(&mut state).is_multiple_of(4) || extent_lines == 0 {
                lcg(&mut state)
            } else {
                let text = String::from_utf8_lossy(&bytes);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() < extent_lines {
                    continue;
                }
                let w = (lcg(&mut state) as usize) % (lines.len() - extent_lines + 1);
                cheap_fingerprint_with_extent(
                    lines[w..w + extent_lines].join("\n").as_bytes(),
                    &AnchorExtent::WholeFile,
                )
            };
            let near = if lcg(&mut state).is_multiple_of(2) {
                None
            } else {
                Some((lcg(&mut state) % 12) as u32)
            };

            let indexed = [("f.txt".to_string(), idx.clone())];
            let expected = scan_indexed_rk64(&indexed, fp, extent, near);
            let got = scan_indexed_rk64_one("f.txt", &idx, fp, extent, near);
            assert_eq!(got, expected, "scan_indexed_rk64_one drift: bytes={bytes:?} {extent:?} near={near:?}");
        }

        // Whole-file extent.
        let files = vec![
            ("yes.txt".to_string(), b"whole\ncontent\n".to_vec()),
            ("no.txt".to_string(), b"other\n".to_vec()),
        ];
        let fp = cheap_fingerprint_with_extent(b"whole\ncontent\n", &AnchorExtent::WholeFile);
        for (path, bytes) in &files {
            let idx = LineIndex::build(bytes);
            let indexed = [(path.clone(), idx.clone())];
            let expected = scan_indexed_rk64(&indexed, fp, AnchorExtent::WholeFile, None);
            let got = scan_indexed_rk64_one(path, &idx, fp, AnchorExtent::WholeFile, None);
            assert_eq!(got, expected);
        }
    }
}
