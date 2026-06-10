//! `git-mesh-core` — the pure, gix-free kernel of git-mesh.
//!
//! This crate owns the parts of git-mesh that operate on **bytes and
//! text**, not on a repository: the anchor [`AnchorExtent`] shape, the
//! content-hash freshness rule ([`hash_bytes_with_extent`] /
//! [`sha256_hex`]), and a stateless content-hash move matcher
//! ([`scan_for_content_hash`]). None of its public API mentions gix,
//! SQLite, or any I/O — callers supply bytes and the kernel computes.
//!
//! git-mesh re-exports every item below from its original public path, so
//! the extraction is invisible to git-mesh's existing callers. Downstream
//! consumers (e.g. the wiki CLI) depend on this leaf for the shared
//! contract and drive their own orchestration, normalization, and caching
//! on top of it.
//!
//! ## Hashing contract
//!
//! A line-range anchor hashes the `\n`-joined slice of lines
//! `[start, end]` (1-based, inclusive); a whole-file anchor hashes the
//! full byte buffer. The digest is SHA-256, lowercase hex, **with no
//! `sha256:` prefix** — the prefix is a storage convention, applied by
//! callers, not part of the digest.

use sha2::{Digest, Sha256};
use std::sync::{Arc, OnceLock};

pub mod error;
pub mod mesh_file;
pub mod validation;

pub use error::{Error, Result};
pub use validation::{
    MESH_NAME_RULE, RESERVED_MESH_NAMES, validate_anchor_id, validate_mesh_name,
    validate_mesh_name_shape, validate_repo_relative_path,
};

/// The extent of a pinned anchor: either the whole file, or an inclusive
/// 1-based line range.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum AnchorExtent {
    WholeFile,
    LineRange { start: u32, end: u32 },
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    SHA256_HEX_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/// Test instrumentation: count every [`sha256_hex`] call so tests can
/// assert that non-canonical wants short-circuit before any hashing.
pub static SHA256_HEX_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Hash `bytes` per the anchor's `extent`. Whole-file extents hash the
/// full byte buffer; line ranges hash the `\n`-joined slice of lines
/// `[start, end]` (1-based, inclusive).
///
/// Returns the lowercase hex SHA-256 digest (no `sha256:` prefix). This
/// is the canonicalization every git-mesh and consumer freshness check
/// must agree on — share it rather than re-implement it.
///
/// For a line range this scans only for the two newline offsets that bound
/// the requested region (stopping at `end`) and, on the common
/// LF-and-UTF-8 fast path, hashes a contiguous slice of the original buffer
/// with **no intermediate allocation** — neither a `Vec<&str>` over the
/// whole file nor a per-call `join`. CRLF, bare-CR, or non-UTF-8 regions
/// fall back to the canonical `lines().join("\n")` path so the digest is
/// byte-identical in every case. Callers checking many anchors against one
/// file should build a [`LineIndex`] once and use [`hash_extent_indexed`]
/// to amortize the newline scan.
pub fn hash_bytes_with_extent(bytes: &[u8], extent: &AnchorExtent) -> String {
    match extent {
        AnchorExtent::WholeFile => sha256_hex(bytes),
        AnchorExtent::LineRange { start, end } => match line_range_region(bytes, *start, *end) {
            Some((rs, re)) => canonical_region(bytes, rs, re, *start, *end, sha256_hex),
            None => sha256_hex(b""),
        },
    }
}

/// Window height (line count) of an inclusive 1-based `LineRange`, or `0` for a
/// degenerate extent that selects no content. An extent is degenerate when
/// `start == 0` (no 1-based line) or `end < start` (empty range); both hash as
/// the empty string on the [`hash_bytes_with_extent`] side, so the scan family
/// must agree by treating them as a zero-height window (the reachable
/// `span == 0` guard). Computed before any arithmetic, so `start == 0,
/// end == u32::MAX` can never overflow.
fn line_range_span(start: u32, end: u32) -> usize {
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
        // content, matching `line_range_span` and the scan family.
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
    span: usize,
    wins: impl Fn(usize) -> Option<(usize, usize)>,
    mut scan_one: impl FnMut(&str, &LineIndex, (usize, usize), &mut Vec<Location>),
    out: &mut Vec<Location>,
) {
    for (path, idx) in files {
        let n = idx.line_count();
        if n < span {
            continue;
        }
        let Some(w) = wins(n) else { continue };
        scan_one(path, idx, w, out);
    }
}

/// Find every place `content_hash` (under `extent`'s shape) occurs in the
/// caller-supplied file contents.
///
/// The matcher is pure and **caller-fed**: it never selects candidates,
/// opens a repository, or caches. The caller decides which files to pass
/// — typically the anchor's own file first, then a change set — and the
/// kernel only matches.
///
/// `content_hash` may be given bare or `sha256:`-prefixed; the prefix is
/// normalized away before comparison.
///
/// For a [`AnchorExtent::LineRange`] the window height is the extent's
/// line count and every window of that height is scanned in each file.
/// `near` biases the returned order toward the occurrence whose start is
/// closest to that 1-based line — same-file callers pass the anchor's old
/// start so a small edit-shift surfaces the nearest window first; ties
/// break toward the lower start line. `near: None` yields pure positional
/// order. A [`AnchorExtent::WholeFile`] extent ignores `near` and matches
/// whole files.
///
/// Returns **all** matches; disambiguation and any auto-fix policy are the
/// caller's. No gix, no SQLite, no I/O.
pub fn scan_for_content_hash(
    files: &[(String, Vec<u8>)],
    content_hash: &str,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    // A whole-file scan hashes each candidate buffer outright, so building a
    // line index for every file would be pure waste — match directly.
    if let AnchorExtent::WholeFile = extent {
        let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
        // A non-canonical `want` can never match a lowercase-hex digest, so
        // short-circuit before any SHA-256 work.
        let Some(target) = decode_lower_hex32(want) else { return Vec::new() };
        return whole_file_matches(files, |b| b.as_slice(), |b| {
            let mut h = Sha256::new();
            h.update(b);
            h.finalize().as_slice() == target.as_slice()
        });
    }
    let indexed = build_indexed(files);
    scan_indexed(&indexed, content_hash, extent, near)
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
/// the index once and reuse it across [`hash_extent_indexed`] and
/// [`scan_indexed`], paying the newline scan a single time instead of once
/// per anchor and once per window scan. The byte-slice entry points
/// ([`hash_bytes_with_extent`], [`scan_for_content_hash`]) are thin wrappers
/// that build a fresh index, so no existing caller has to change.
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
            "git-mesh-core: buffer of {} bytes exceeds the supported size of {} bytes \
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
        LineIndex { bytes, starts, ends, fp_tables: Arc::new(OnceLock::new()) }
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
            // matching `line_range_span` and `line_range_region`.
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

/// [`hash_bytes_with_extent`] over a prebuilt [`LineIndex`]. Produces a
/// byte-identical digest; the only difference is that the newline scan is
/// already paid for.
pub fn hash_extent_indexed(idx: &LineIndex, extent: &AnchorExtent) -> String {
    match extent {
        AnchorExtent::WholeFile => sha256_hex(idx.bytes),
        AnchorExtent::LineRange { start, end } => match idx.region(*start, *end) {
            Some((rs, re)) => canonical_region(idx.bytes, rs, re, *start, *end, sha256_hex),
            None => sha256_hex(b""),
        },
    }
}

// --- Cheap-fingerprint prefilter for the fail-closed uniqueness check ---
//
// A polynomial (Rabin–Karp) rolling hash over the *same canonical content* as
// the SHA-256 digest. It is a non-cryptographic prefilter only: a window's
// SHA is evaluated solely when its fingerprint equals the caller-stored
// `cheap_fp`, so a fingerprint collision costs one extra SHA and never a wrong
// answer. The SHA remains the single source of truth, which keeps the
// whole-file occurrence count — and therefore the caller's fail-closed
// ambiguity guarantee — exact while paying the per-window SHA only at genuine
// candidates.

/// The stored algorithm name for an rk64 fingerprint anchor: a line-format
/// token of `rk64:<hex>` where `<hex>` is [`rk64_to_hex`] of the `u64`. This
/// is an opaque `<algorithm>:<hash>` token to [`mesh_file::MeshFile::parse`],
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


/// Cheap (non-cryptographic) fingerprint of an extent's canonical content,
/// over the **same** canonicalization as [`hash_bytes_with_extent`]
/// (LF-normalized `lines().join("\n")`; whole-file extents fingerprint the
/// full buffer). The caller stores this `u64` alongside the SHA-256 so later
/// scans can prefilter windows in O(1) each via [`scan_indexed_prefiltered`].
///
/// It is a prefilter only — never a substitute for the SHA. Equal fingerprints
/// do not prove equal content; the scan still confirms each candidate with
/// SHA-256. Empty extents (a range selecting no line) fingerprint to `0`,
/// matching the empty canonical content their digest is taken over.
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

/// Exhaustive, fail-closed match set — the **same** return contract as
/// [`scan_indexed`] (all matches, same `near` ordering, ≥2 ⇒ ambiguous) —
/// reached cheaply via a fingerprint prefilter.
///
/// A rolling polynomial fingerprint is computed per window in O(N·L) total
/// (one prefix-hash pass over each file's bytes, then O(1) per window), and
/// the source-of-truth SHA-256 is evaluated **only** for windows whose
/// fingerprint equals `cheap_fp`. With unique content this is ~1 SHA (plus
/// rare fingerprint collisions) instead of N, while the returned set stays
/// byte-for-byte equal to [`scan_indexed`].
///
/// `cheap_fp` must be the caller-stored [`cheap_fingerprint_with_extent`] of
/// the same canonical content behind `content_hash`. **Correctness does not
/// depend on the fingerprint, only performance:** because every returned
/// location is confirmed by SHA-256, a wrong or stale `cheap_fp` can only
/// *reduce* the set of windows that reach the SHA check — it can never admit a
/// false match. (It can, however, drop true matches, which is why the caller
/// must store the fingerprint of the actual anchored content.) A whole-file
/// extent has no per-window prefilter and defers to [`scan_indexed`].
pub fn scan_indexed_prefiltered(
    files: &[(String, LineIndex)],
    content_hash: &str,
    cheap_fp: u64,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);

    let AnchorExtent::LineRange { start, end } = extent else {
        // A whole-file extent hashes one buffer per file; there is nothing to
        // prefilter, so the exhaustive whole-file matcher is already optimal.
        return scan_indexed(files, content_hash, extent, near);
    };

    let span = line_range_span(start, end);
    if span == 0 {
        return Vec::new();
    }
    let Some(target) = decode_lower_hex32(want) else { return Vec::new() };
    let mut out: Vec<Location> = Vec::new();
    scan_files(
        files,
        span,
        |n| Some((0, n - span)),
        |path, idx, w, out| {
            // Confirm each fingerprint candidate with the authoritative SHA-256.
            let confirm = |slice: &[u8]| {
                let mut h = Sha256::new();
                h.update(slice);
                h.finalize().as_slice() == target.as_slice()
            };
            scan_one_file_fp_filtered(path, idx, span, w, cheap_fp, confirm, out);
        },
        &mut out,
    );
    if let Some(near) = near {
        sort_near(&mut out, near);
    }
    out
}

/// Find every window whose rk64 fingerprint
/// ([`cheap_fingerprint_with_extent`]) equals `cheap_fp`, with **no SHA-256
/// confirmation** — the 64-bit fingerprint is the sole content identity.
///
/// Same return contract as [`scan_indexed`] — all matches, same `near`
/// ordering, ≥2 ⇒ ambiguous — but a returned location is a window whose
/// *fingerprint* matches, not one proven byte-identical. Callers accept a
/// ~`2⁻⁶⁴`-per-comparison chance that a hit is a fingerprint collision rather
/// than the anchored content.
///
/// rk64 is a 64-bit, **non-cryptographic**, linear (polynomial/Rabin–Karp)
/// fingerprint — fine for prefiltering or for content where a rare wrong/missed
/// match is self-correcting (e.g. documentation-link tracking), but **not** a
/// content-integrity hash. For byte-exact matching use [`scan_indexed`] or the
/// SHA-confirmed [`scan_indexed_prefiltered`]. The work is the prefilter's
/// rolling pass with the verify step removed: O(N·L) per file, no SHA-256,
/// pure and caller-fed. A whole-file extent matches whole files by their
/// fingerprint (the rk64 of the full buffer).
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
            let span = line_range_span(start, end);
            if span == 0 {
                return Vec::new();
            }
            let mut out: Vec<Location> = Vec::new();
            scan_files(
                files,
                span,
                |n| Some((0, n - span)),
                |path, idx, w, out| {
                    // No SHA verify: a matching fingerprint is the match.
                    scan_one_file_fp_filtered(path, idx, span, w, cheap_fp, |_| true, out);
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

/// [`scan_indexed_rk64`] over `Vec<u8>` inputs, building each [`LineIndex`]
/// internally — mirrors the [`scan_for_content_hash`]/[`scan_indexed`] pair for
/// callers that have not already indexed their files.
pub fn scan_for_content_hash_rk64(
    files: &[(String, Vec<u8>)],
    cheap_fp: u64,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    let indexed = build_indexed(files);
    scan_indexed_rk64(&indexed, cheap_fp, extent, near)
}

/// Scan one file's `span`-high windows, emitting a [`Location`] for every
/// window whose rolling polynomial fingerprint equals `cheap_fp` **and** that
/// `confirm` accepts. On the LF-and-UTF-8 fast path a single prefix-hash pass
/// over the buffer makes each window's fingerprint an O(1) subtraction;
/// `\r`/non-UTF-8 files fingerprint the canonical lossy join per window so
/// results stay byte-identical to the reference matcher. `confirm` receives the
/// window's canonical content bytes — the SHA-confirmed prefilter passes a
/// digest check, the rk64-only matcher passes `|_| true`.
fn scan_one_file_fp_filtered(
    path: &str,
    idx: &LineIndex,
    span: usize,
    wins: (usize, usize),
    cheap_fp: u64,
    mut confirm: impl FnMut(&[u8]) -> bool,
    out: &mut Vec<Location>,
) {
    let (win_lo, win_hi) = wins;
    let bytes = idx.bytes;
    let simple = is_lf_and_utf8_clean(bytes);

    if simple {
        // Prefix hashes `ph[k] = horner(bytes[0..k])` and powers `pow[i] =
        // BASE^i` give every window's fingerprint as `ph[re] - ph[rs]·pow[re-rs]`
        // in O(1) — the rolling reduction of recomputing `horner` per window.
        // For files under the size threshold the tables are cached on the
        // `LineIndex`; larger files fall back to per-window `horner`.
        let tables = idx.prefilter_tables();
        for win in win_lo..=win_hi {
            let rs = idx.starts[win] as usize;
            let re = idx.ends[win + span - 1] as usize;
            let fp = match tables {
                Some(t) => t.ph[re].wrapping_sub(t.ph[rs].wrapping_mul(t.pow[re - rs])),
                None => horner(&bytes[rs..re]),
            };
            if fp == cheap_fp && confirm(&bytes[rs..re]) {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + span as u32,
                });
            }
        }
    } else {
        let text = String::from_utf8_lossy(bytes);
        let lines: Vec<&str> = text.lines().collect();
        for win in win_lo..=win_hi {
            let joined = lines[win..win + span].join("\n");
            if horner(joined.as_bytes()) == cheap_fp && confirm(joined.as_bytes()) {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + span as u32,
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

/// [`scan_for_content_hash`] over prebuilt [`LineIndex`] values. Identical
/// matches, ordering, and ambiguity semantics; callers reusing one index
/// across many anchors avoid re-splitting each file per scan.
pub fn scan_indexed(
    files: &[(String, LineIndex)],
    content_hash: &str,
    extent: AnchorExtent,
    near: Option<u32>,
) -> Vec<Location> {
    let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);

    match extent {
        AnchorExtent::WholeFile => {
            let Some(target) = decode_lower_hex32(want) else { return Vec::new() };
            whole_file_matches(files, |idx| idx.bytes, |b| {
                let mut h = Sha256::new();
                h.update(b);
                h.finalize().as_slice() == target.as_slice()
            })
        }
        AnchorExtent::LineRange { start, end } => {
            let span = line_range_span(start, end);
            if span == 0 {
                return Vec::new();
            }
            // Decode the wanted digest once so each window compares 32 bytes
            // instead of formatting a fresh 64-char hex string. A non-canonical
            // `want` can never equal a real lowercase-hex digest, so
            // short-circuit before any window iteration.
            let Some(target) = decode_lower_hex32(want) else { return Vec::new() };
            let mut out: Vec<Location> = Vec::new();
            scan_files(
                files,
                span,
                |n| Some((0, n - span)),
                |path, idx, w, out| {
                    scan_one_file(path, idx, span, w, &target, out);
                },
                &mut out,
            );
            if let Some(near) = near {
                // Stable sort over windows already collected in ascending
                // (path, start) order, so equal distances keep the lower
                // start line first — matching git-mesh's nearest-window
                // preference.
                sort_near(&mut out, near);
            }
            out
        }
    }
}

/// Bounded same-file variant of [`scan_for_content_hash`]: scan only the
/// windows whose 1-based start line falls within `radius` lines of `near`.
///
/// A same-file shift detection (`near = old_start`) almost always finds the
/// relocated window within a few lines of where it used to be, so scanning a
/// `near ± radius` band instead of the whole file turns an O(N·S) pass into
/// O(radius·S). This is the measured hot path's biggest lever: callers that
/// follow the same-file probe with a full change-set pass
/// ([`scan_for_content_hash`] with `near = None`) keep exact move-follow
/// coverage — a block displaced by more than `radius` within its own file is
/// still found by the (unbounded) change-set scan, since a dirty file is in
/// the change set.
///
/// **This is opt-in and intentionally narrower than the exhaustive matcher:**
/// it returns only matches inside the band (ordered nearest-first, ties
/// toward the lower start line). For exhaustive, semantics-preserving
/// matching use [`scan_for_content_hash`].
pub fn scan_for_content_hash_near_radius(
    files: &[(String, Vec<u8>)],
    content_hash: &str,
    extent: AnchorExtent,
    near: u32,
    radius: u32,
) -> Vec<Location> {
    let indexed = build_indexed(files);
    scan_indexed_near_radius(&indexed, content_hash, extent, near, radius)
}

/// [`scan_for_content_hash_near_radius`] over prebuilt [`LineIndex`] values.
pub fn scan_indexed_near_radius(
    files: &[(String, LineIndex)],
    content_hash: &str,
    extent: AnchorExtent,
    near: u32,
    radius: u32,
) -> Vec<Location> {
    let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    let AnchorExtent::LineRange { start, end } = extent else {
        // A whole-file extent has no notion of a line band; defer to the
        // exhaustive whole-file matcher.
        return scan_indexed(files, content_hash, extent, None);
    };

    let span = line_range_span(start, end);
    if span == 0 {
        return Vec::new();
    }
    let Some(target) = decode_lower_hex32(want) else { return Vec::new() };
    // The window whose 1-based start line is `s` has window index `s - 1`.
    // Bound the band to `[near - radius, near + radius]` in start-line space.
    let near0 = near.saturating_sub(1) as usize; // 0-based center window index
    let band = radius as usize;
    let mut out: Vec<Location> = Vec::new();
    scan_files(
        files,
        span,
        |n| {
            let last_win = n - span;
            let win_lo = near0.saturating_sub(band);
            let win_hi = (near0 + band).min(last_win);
            (win_lo <= win_hi).then_some((win_lo, win_hi))
        },
        |path, idx, w, out| {
            scan_one_file(path, idx, span, w, &target, out);
        },
        &mut out,
    );
    sort_near(&mut out, near);
    out
}

/// Scan one file for every `span`-high window whose canonical content hashes
/// to the wanted digest, appending matches in ascending start order.
///
/// LF-and-UTF-8-clean files (the overwhelmingly common case) take the fast
/// path: each window is a contiguous buffer slice hashed with no allocation
/// and compared against the decoded 32-byte target. Files containing `\r`
/// or invalid UTF-8 fall back to the canonical `lines().join("\n")` loop so
/// results are byte-identical to the reference matcher.
fn scan_one_file(
    path: &str,
    idx: &LineIndex,
    span: usize,
    wins: (usize, usize),
    target: &[u8; 32],
    out: &mut Vec<Location>,
) {
    let (win_lo, win_hi) = wins;
    let bytes = idx.bytes;
    let simple = is_lf_and_utf8_clean(bytes);

    if simple {
        for win in win_lo..=win_hi {
            let rs = idx.starts[win] as usize;
            let re = idx.ends[win + span - 1] as usize;
            let slice = &bytes[rs..re];
            let mut h = Sha256::new();
            h.update(slice);
            if h.finalize().as_slice() == target.as_slice() {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + span as u32,
                });
            }
        }
    } else {
        let text = String::from_utf8_lossy(bytes);
        let lines: Vec<&str> = text.lines().collect();
        for win in win_lo..=win_hi {
            let slice_text = lines[win..win + span].join("\n");
            let mut h = Sha256::new();
            h.update(slice_text.as_bytes());
            if h.finalize().as_slice() == target.as_slice() {
                out.push(Location {
                    path: path.to_string(),
                    start_line: (win as u32) + 1,
                    end_line: (win as u32) + span as u32,
                });
            }
        }
    }
}

/// Decode 64 lowercase-hex characters into 32 bytes. Returns `None` for any
/// other length or any non-`[0-9a-f]` character, so the caller falls back to
/// string comparison and preserves the exact (lowercase-only) matching
/// behavior of the reference matcher.
fn decode_lower_hex32(s: &str) -> Option<[u8; 32]> {
    let b = s.as_bytes();
    if b.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, slot) in out.iter_mut().enumerate() {
        let hi = lower_hex_val(b[2 * i])?;
        let lo = lower_hex_val(b[2 * i + 1])?;
        *slot = (hi << 4) | lo;
    }
    Some(out)
}

fn lower_hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_range_hash_matches_known_canonicalization() {
        // lines 1..=3 joined by \n, sha256, lowercase hex, no prefix.
        let text = b"a\nb\nc\nd\n";
        let h = hash_bytes_with_extent(text, &AnchorExtent::LineRange { start: 1, end: 3 });
        assert_eq!(h, sha256_hex(b"a\nb\nc"));
        assert_eq!(h.len(), 64);
        assert!(!h.starts_with("sha256:"));
    }

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

    #[test]
    fn whole_file_hash_is_full_buffer() {
        let text = b"a\nb\nc\n";
        assert_eq!(
            hash_bytes_with_extent(text, &AnchorExtent::WholeFile),
            sha256_hex(text)
        );
    }

    #[test]
    fn scan_relocates_block_shifted_within_one_file() {
        // The 3-line block "x/y/z" was anchored at lines 1-3 but a header
        // was inserted above it, shifting it to lines 3-5.
        let hash = sha256_hex(b"x\ny\nz");
        let file = ("a.txt".to_string(), b"h1\nh2\nx\ny\nz\n".to_vec());
        let hits = scan_for_content_hash(
            std::slice::from_ref(&file),
            &hash,
            AnchorExtent::LineRange { start: 1, end: 3 },
            Some(1),
        );
        assert_eq!(
            hits,
            vec![Location {
                path: "a.txt".into(),
                start_line: 3,
                end_line: 5
            }]
        );
    }

    #[test]
    fn scan_relocates_block_moved_to_another_file_in_change_set() {
        let hash = format!("sha256:{}", sha256_hex(b"x\ny\nz"));
        let files = vec![
            ("unchanged.txt".to_string(), b"p\nq\nr\n".to_vec()),
            ("moved-here.txt".to_string(), b"lead\nx\ny\nz\ntail\n".to_vec()),
        ];
        let hits = scan_for_content_hash(&files, &hash, AnchorExtent::LineRange { start: 10, end: 12 }, None);
        assert_eq!(
            hits,
            vec![Location {
                path: "moved-here.txt".into(),
                start_line: 2,
                end_line: 4
            }]
        );
    }

    #[test]
    fn near_biases_toward_closest_window() {
        // Two identical blocks; `near` decides which comes first.
        let hash = sha256_hex(b"d\nd");
        let file = ("a.txt".to_string(), b"d\nd\nx\nd\nd\n".to_vec());
        let near_top =
            scan_for_content_hash(std::slice::from_ref(&file), &hash, AnchorExtent::LineRange { start: 1, end: 2 }, Some(1));
        assert_eq!(near_top[0].start_line, 1);
        let near_bottom =
            scan_for_content_hash(std::slice::from_ref(&file), &hash, AnchorExtent::LineRange { start: 1, end: 2 }, Some(4));
        assert_eq!(near_bottom[0].start_line, 4);
    }

    #[test]
    fn near_window_at_exact_old_start_wins_over_line_above() {
        // Two identical 1-line blocks at start lines 2 and 3. With
        // `near = 3` (the anchor's 1-based old start), the window sitting at
        // the exact old start (line 3, distance 0) must outrank the window
        // one line above (line 2, distance 1). A 0-based sort center would
        // skew every distance toward the line above and flip this order.
        let hash = sha256_hex(b"d");
        let file = ("a.txt".to_string(), b"x\nd\nd\nx\n".to_vec());
        let hits = scan_for_content_hash(
            std::slice::from_ref(&file),
            &hash,
            AnchorExtent::LineRange { start: 3, end: 3 },
            Some(3),
        );
        assert_eq!(hits[0].start_line, 3);
    }

    #[test]
    fn whole_file_scan_matches_whole_files() {
        let hash = sha256_hex(b"whole\ncontent\n");
        let files = vec![
            ("nope.txt".to_string(), b"other\n".to_vec()),
            ("yes.txt".to_string(), b"whole\ncontent\n".to_vec()),
        ];
        let hits = scan_for_content_hash(&files, &hash, AnchorExtent::WholeFile, None);
        assert_eq!(
            hits,
            vec![Location {
                path: "yes.txt".into(),
                start_line: 0,
                end_line: 0
            }]
        );
    }

    // --- Reference implementations (the pre-optimization canonicalization) ---
    //
    // These reproduce the original `lines().join("\n")` matcher verbatim and
    // are the oracle the optimized fast paths must agree with byte-for-byte.

    fn ref_hash(bytes: &[u8], extent: &AnchorExtent) -> String {
        let hashed: Vec<u8> = match extent {
            AnchorExtent::WholeFile => bytes.to_vec(),
            AnchorExtent::LineRange { start, end } => {
                let text = String::from_utf8_lossy(bytes);
                let lines: Vec<&str> = text.lines().collect();
                let lo = (*start as usize).saturating_sub(1);
                let hi = (*end as usize).min(lines.len());
                // A degenerate extent (`start == 0` or `end < start`) selects
                // no content, matching `line_range_region`.
                let slice = if *start != 0 && lo < hi { &lines[lo..hi] } else { &[][..] };
                slice.join("\n").into_bytes()
            }
        };
        sha256_hex(&hashed)
    }

    fn ref_scan(
        files: &[(String, Vec<u8>)],
        content_hash: &str,
        extent: AnchorExtent,
        near: Option<u32>,
    ) -> Vec<Location> {
        let want = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
        match extent {
            AnchorExtent::WholeFile => files
                .iter()
                .filter(|(_, bytes)| sha256_hex(bytes) == want)
                .map(|(path, _)| Location {
                    path: path.clone(),
                    start_line: 0,
                    end_line: 0,
                })
                .collect(),
            AnchorExtent::LineRange { start, end } => {
                let span = line_range_span(start, end);
                if span == 0 {
                    return Vec::new();
                }
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
                    out.sort_by_key(|l| (l.start_line.abs_diff(near), l.start_line));
                }
                out
            }
        }
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
    fn hash_matches_reference_across_vectors_and_ranges() {
        for &bytes in VECTORS {
            assert_eq!(
                hash_bytes_with_extent(bytes, &AnchorExtent::WholeFile),
                ref_hash(bytes, &AnchorExtent::WholeFile),
                "whole-file digest drifted for {bytes:?}"
            );
            let idx = LineIndex::build(bytes);
            for start in 0u32..=8 {
                for end in 0u32..=10 {
                    let extent = AnchorExtent::LineRange { start, end };
                    let expected = ref_hash(bytes, &extent);
                    assert_eq!(
                        hash_bytes_with_extent(bytes, &extent),
                        expected,
                        "hash_bytes_with_extent drifted for {bytes:?} range {start}..={end}"
                    );
                    assert_eq!(
                        hash_extent_indexed(&idx, &extent),
                        expected,
                        "hash_extent_indexed drifted for {bytes:?} range {start}..={end}"
                    );
                }
            }
        }
    }

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

    #[test]
    fn hash_property_fuzz_matches_reference() {
        let mut state = 0x9e3779b97f4a7c15u64;
        for _ in 0..4000 {
            let bytes = random_bytes(&mut state, 40);
            let start = (lcg(&mut state) % 12) as u32;
            let end = (lcg(&mut state) % 12) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let idx = LineIndex::build(&bytes);
            assert_eq!(
                hash_bytes_with_extent(&bytes, &extent),
                ref_hash(&bytes, &extent),
                "fuzz hash drift: bytes={bytes:?} range {start}..={end}"
            );
            assert_eq!(
                hash_extent_indexed(&idx, &extent),
                ref_hash(&bytes, &extent),
                "fuzz indexed-hash drift: bytes={bytes:?} range {start}..={end}"
            );
        }
    }

    #[test]
    fn scan_property_fuzz_matches_reference() {
        let mut state = 0x1234567812345678u64;
        for _ in 0..3000 {
            // A small multi-file change set.
            let files: Vec<(String, Vec<u8>)> = (0..3)
                .map(|i| (format!("f{i}.txt"), random_bytes(&mut state, 30)))
                .collect();
            let start = 1 + (lcg(&mut state) % 6) as u32;
            let end = start + (lcg(&mut state) % 4) as u32;
            let extent = AnchorExtent::LineRange { start, end };

            // Derive the wanted hash from one of the files' windows so real
            // matches occur, but sometimes use a random miss.
            let want = if lcg(&mut state).is_multiple_of(4) {
                sha256_hex(b"definitely-absent-content")
            } else {
                let pick = &files[(lcg(&mut state) as usize) % files.len()].1;
                let span = (end - start + 1) as usize;
                let text = String::from_utf8_lossy(pick);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() >= span {
                    let w = (lcg(&mut state) as usize) % (lines.len() - span + 1);
                    sha256_hex(lines[w..w + span].join("\n").as_bytes())
                } else {
                    sha256_hex(b"no-window")
                }
            };

            let near = if lcg(&mut state).is_multiple_of(2) {
                None
            } else {
                Some((lcg(&mut state) % 12) as u32)
            };

            let expected = ref_scan(&files, &want, extent, near);
            let got = scan_for_content_hash(&files, &want, extent, near);
            assert_eq!(got, expected, "scan drift: files={files:?} want={want} {extent:?} near={near:?}");
        }
    }

    #[test]
    fn scan_handles_crlf_and_non_utf8_files() {
        // CRLF file: the canonical window strips \r\n, so the wanted hash is
        // computed the canonical way and must still be located.
        let want = sha256_hex(b"b\nc");
        let files = vec![("crlf.txt".to_string(), b"a\r\nb\r\nc\r\nd\r\n".to_vec())];
        let hits = scan_for_content_hash(&files, &want, AnchorExtent::LineRange { start: 1, end: 2 }, None);
        assert_eq!(
            hits,
            vec![Location { path: "crlf.txt".into(), start_line: 2, end_line: 3 }]
        );

        // Invalid UTF-8 file routed through the lossy fallback.
        let bytes = b"x\xffy\nz\n".to_vec();
        let lossy = String::from_utf8_lossy(&bytes);
        let first: Vec<&str> = lossy.lines().take(1).collect();
        let want2 = sha256_hex(first[0].as_bytes());
        let files2 = vec![("bad.txt".to_string(), bytes)];
        let hits2 = scan_for_content_hash(&files2, &want2, AnchorExtent::LineRange { start: 1, end: 1 }, None);
        assert_eq!(
            hits2,
            vec![Location { path: "bad.txt".into(), start_line: 1, end_line: 1 }]
        );
    }

    #[test]
    fn near_radius_scan_finds_band_and_skips_far_matches() {
        // Same 2-line block at the top and bottom of a 9-line file.
        let file = (
            "a.txt".to_string(),
            b"d\nd\nx\nx\nx\nx\nx\nd\nd\n".to_vec(),
        );
        let files = std::slice::from_ref(&file);
        let want = sha256_hex(b"d\nd");
        let extent = AnchorExtent::LineRange { start: 1, end: 2 };

        // A wide radius still finds both, nearest-first.
        let wide = scan_for_content_hash_near_radius(files, &want, extent, 1, 100);
        assert_eq!(
            wide,
            scan_for_content_hash(files, &want, extent, Some(1)),
        );
        assert_eq!(wide.len(), 2);

        // A tight radius around line 1 finds only the top block; the bottom
        // block (start line 8) is outside the band.
        let tight = scan_for_content_hash_near_radius(files, &want, extent, 1, 3);
        assert_eq!(
            tight,
            vec![Location { path: "a.txt".into(), start_line: 1, end_line: 2 }]
        );
    }

    #[test]
    fn near_radius_property_matches_filtered_full_scan() {
        let mut state = 0xfeedfacecafef00du64;
        for _ in 0..2000 {
            let bytes = random_bytes(&mut state, 30);
            let file = vec![("f.txt".to_string(), bytes.clone())];
            let start = 1 + (lcg(&mut state) % 5) as u32;
            let end = start + (lcg(&mut state) % 3) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let span = (end - start + 1) as usize;
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            if lines.len() < span {
                continue;
            }
            let w = (lcg(&mut state) as usize) % (lines.len() - span + 1);
            let want = sha256_hex(lines[w..w + span].join("\n").as_bytes());
            let near = 1 + (lcg(&mut state) % 10) as u32;
            let radius = (lcg(&mut state) % 6) as u32;

            let got = scan_for_content_hash_near_radius(&file, &want, extent, near, radius);

            // Oracle: full scan, then keep only matches whose start line is
            // within `radius` of `near`, re-sorted nearest-first.
            let near0 = near.saturating_sub(1);
            let mut expected: Vec<Location> = scan_for_content_hash(&file, &want, extent, Some(near))
                .into_iter()
                .filter(|l| l.start_line.saturating_sub(1).abs_diff(near0) <= radius)
                .collect();
            expected.sort_by_key(|l| (l.start_line.abs_diff(near), l.start_line));

            assert_eq!(got, expected, "radius drift: bytes={bytes:?} {extent:?} near={near} r={radius}");
        }
    }

    #[test]
    fn indexed_scan_matches_byte_slice_scan() {
        let files = vec![
            ("a.txt".to_string(), b"h1\nh2\nx\ny\nz\nx\ny\nz\n".to_vec()),
            ("b.txt".to_string(), b"x\ny\nz\n".to_vec()),
        ];
        let want = sha256_hex(b"x\ny\nz");
        let indexed: Vec<(String, LineIndex)> =
            files.iter().map(|(p, b)| (p.clone(), LineIndex::build(b))).collect();
        for near in [None, Some(1), Some(6)] {
            let extent = AnchorExtent::LineRange { start: 1, end: 3 };
            assert_eq!(
                scan_indexed(&indexed, &want, extent, near),
                scan_for_content_hash(&files, &want, extent, near),
            );
        }
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
        // both their digest *and* their fingerprint must coincide.
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
                    hash_bytes_with_extent(&crlf, &extent),
                    hash_bytes_with_extent(&lf, &extent),
                    "canonical digest drifted between CRLF and LF for {extent:?}"
                );
                assert_eq!(
                    cheap_fingerprint_with_extent(&crlf, &extent),
                    cheap_fingerprint_with_extent(&lf, &extent),
                    "canonical fingerprint drifted between CRLF and LF for {extent:?}"
                );
            }
        }
    }

    #[test]
    fn prefiltered_scan_equals_scan_indexed_with_correct_fingerprint() {
        // With the fingerprint of the actual anchored content, the prefiltered
        // scan must return byte-for-byte the same set as the exhaustive scan,
        // including the fail-closed ≥2 duplicate case.
        let files = vec![
            // Two byte-identical blocks in one file: the fail-closed ambiguity.
            ("dup.txt".to_string(), b"x\ny\nz\nq\nx\ny\nz\n".to_vec()),
            ("other.txt".to_string(), b"x\ny\nz\n".to_vec()),
        ];
        let indexed = index_all(&files);
        let want = sha256_hex(b"x\ny\nz");
        let extent = AnchorExtent::LineRange { start: 1, end: 3 };
        let fp = cheap_fingerprint_with_extent(b"x\ny\nz", &AnchorExtent::WholeFile);
        for near in [None, Some(1), Some(5)] {
            let got = scan_indexed_prefiltered(&indexed, &want, fp, extent, near);
            let expected = scan_indexed(&indexed, &want, extent, near);
            assert_eq!(got, expected, "prefiltered drift near={near:?}");
            // The duplicate makes the whole-file count ≥2 — the guarantee the
            // caller relies on to refuse an ambiguous auto-rewrite.
            let in_dup = got.iter().filter(|l| l.path == "dup.txt").count();
            assert_eq!(in_dup, 2, "fail-closed duplicate count lost");
        }
    }

    #[test]
    fn prefiltered_scan_property_matches_scan_indexed() {
        let mut state = 0xabad1deac0ffee11u64;
        for _ in 0..3000 {
            let files: Vec<(String, Vec<u8>)> = (0..3)
                .map(|i| (format!("f{i}.txt"), random_bytes(&mut state, 30)))
                .collect();
            let indexed = index_all(&files);
            let start = 1 + (lcg(&mut state) % 6) as u32;
            let end = start + (lcg(&mut state) % 4) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let span = (end - start + 1) as usize;

            // Pick a real window so genuine (and possibly duplicated) matches
            // occur, and store the fingerprint of that exact content.
            let pick = &files[(lcg(&mut state) as usize) % files.len()].1;
            let text = String::from_utf8_lossy(pick);
            let lines: Vec<&str> = text.lines().collect();
            if lines.len() < span {
                continue;
            }
            let w = (lcg(&mut state) as usize) % (lines.len() - span + 1);
            let content = lines[w..w + span].join("\n");
            let want = sha256_hex(content.as_bytes());
            let fp = cheap_fingerprint_with_extent(content.as_bytes(), &AnchorExtent::WholeFile);

            let near = if lcg(&mut state).is_multiple_of(2) {
                None
            } else {
                Some((lcg(&mut state) % 12) as u32)
            };

            let expected = scan_indexed(&indexed, &want, extent, near);
            let got = scan_indexed_prefiltered(&indexed, &want, fp, extent, near);
            assert_eq!(
                got, expected,
                "prefiltered drift: files={files:?} {extent:?} near={near:?}"
            );
        }
    }

    #[test]
    fn wrong_fingerprint_only_drops_matches_never_invents_them() {
        // Soundness: a wrong/stale fingerprint can only *reduce* the set that
        // reaches the SHA check. The result is always a subset of the
        // exhaustive scan, and every returned location is a real SHA match —
        // a fingerprint collision can never produce a false positive.
        let mut state = 0x0123456789abcdefu64;
        for _ in 0..3000 {
            let files: Vec<(String, Vec<u8>)> = (0..3)
                .map(|i| (format!("f{i}.txt"), random_bytes(&mut state, 30)))
                .collect();
            let indexed = index_all(&files);
            let start = 1 + (lcg(&mut state) % 6) as u32;
            let end = start + (lcg(&mut state) % 4) as u32;
            let extent = AnchorExtent::LineRange { start, end };
            let span = (end - start + 1) as usize;

            let pick = &files[(lcg(&mut state) as usize) % files.len()].1;
            let text = String::from_utf8_lossy(pick);
            let lines: Vec<&str> = text.lines().collect();
            if lines.len() < span {
                continue;
            }
            let w = (lcg(&mut state) as usize) % (lines.len() - span + 1);
            let want = sha256_hex(lines[w..w + span].join("\n").as_bytes());
            // Deliberately arbitrary fingerprint, unrelated to the content.
            let bogus_fp = lcg(&mut state);

            let truth = scan_indexed(&indexed, &want, extent, None);
            let got = scan_indexed_prefiltered(&indexed, &want, bogus_fp, extent, None);

            for loc in &got {
                assert!(
                    truth.contains(loc),
                    "prefilter invented a non-match {loc:?} (collision must not produce a false positive)"
                );
            }
        }
    }

    #[test]
    fn prefiltered_scan_handles_crlf_and_non_utf8_files() {
        // The fallback path must prefilter and match identically to the
        // canonical reference on `\r`/non-UTF-8 files.
        let files = vec![("crlf.txt".to_string(), b"a\r\nb\r\nc\r\nd\r\n".to_vec())];
        let indexed = index_all(&files);
        let extent = AnchorExtent::LineRange { start: 1, end: 2 };
        let want = sha256_hex(b"a\nb");
        let fp = cheap_fingerprint_with_extent(b"a\nb", &AnchorExtent::WholeFile);
        assert_eq!(
            scan_indexed_prefiltered(&indexed, &want, fp, extent, None),
            scan_indexed(&indexed, &want, extent, None),
        );

        let bytes = b"x\xffy\nz\n".to_vec();
        let files2 = vec![("bad.txt".to_string(), bytes.clone())];
        let indexed2 = index_all(&files2);
        let lossy = String::from_utf8_lossy(&bytes);
        let first: Vec<&str> = lossy.lines().take(1).collect();
        let want2 = sha256_hex(first[0].as_bytes());
        let extent2 = AnchorExtent::LineRange { start: 1, end: 1 };
        let fp2 = cheap_fingerprint_indexed(&indexed2[0].1, &extent2);
        assert_eq!(
            scan_indexed_prefiltered(&indexed2, &want2, fp2, extent2, None),
            scan_indexed(&indexed2, &want2, extent2, None),
        );
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
        let span = line_range_span(start, end);
        if span == 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        for (path, bytes) in files {
            let idx = LineIndex::build(bytes);
            let n = idx.line_count();
            if n < span {
                continue;
            }
            for win in 0..=(n - span) {
                let w = (win as u32) + 1;
                let e = (win as u32) + span as u32;
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
            let span = (end - start + 1) as usize;

            // Mostly target a real window's fingerprint; sometimes a random fp
            // (overwhelmingly a miss) to exercise the empty path.
            let fp = if lcg(&mut state).is_multiple_of(4) {
                lcg(&mut state)
            } else {
                let pick = &files[(lcg(&mut state) as usize) % files.len()].1;
                let text = String::from_utf8_lossy(pick);
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() < span {
                    continue;
                }
                let w = (lcg(&mut state) as usize) % (lines.len() - span + 1);
                cheap_fingerprint_with_extent(
                    lines[w..w + span].join("\n").as_bytes(),
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
    fn rk64_equals_prefiltered_minus_the_sha_step_on_unique_content() {
        // With genuinely unique content (no fingerprint collision in the file),
        // the rk64-only matcher and the SHA-confirmed prefilter agree — the SHA
        // is confirming a match the fingerprint already isolated.
        let files = vec![
            ("a.txt".to_string(), b"h1\nh2\nx\ny\nz\n".to_vec()),
            ("b.txt".to_string(), b"p\nq\nr\ns\n".to_vec()),
        ];
        let indexed = index_all(&files);
        let extent = AnchorExtent::LineRange { start: 1, end: 3 };
        let content = b"x\ny\nz";
        let fp = cheap_fingerprint_with_extent(content, &AnchorExtent::WholeFile);
        let sha = sha256_hex(content);
        for near in [None, Some(1), Some(3)] {
            assert_eq!(
                scan_indexed_rk64(&indexed, fp, extent, near),
                scan_indexed_prefiltered(&indexed, &sha, fp, extent, near),
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
        // `end < start` selects no line, so the digest falls back to the empty
        // string. A scan for that "empty content" must never locate the empty
        // line that happens to hash to the same digest.
        let bytes = b"a\n\nb\n".to_vec();
        let extent = AnchorExtent::LineRange { start: 5, end: 3 };

        let hash = hash_bytes_with_extent(&bytes, &extent);
        assert_eq!(hash, sha256_hex(b""), "end < start must hash as empty content");
        assert_eq!(
            cheap_fingerprint_with_extent(&bytes, &extent),
            0,
            "end < start must fingerprint as empty content",
        );

        let files = vec![("f.txt".to_string(), bytes.clone())];
        let indexed = index_all(&files);
        let fp = cheap_fingerprint_with_extent(&bytes, &extent);

        assert!(scan_for_content_hash(&files, &hash, extent, None).is_empty());
        assert!(scan_indexed(&indexed, &hash, extent, None).is_empty());
        assert!(scan_indexed_prefiltered(&indexed, &hash, fp, extent, None).is_empty());
        assert!(scan_indexed_rk64(&indexed, fp, extent, None).is_empty());
        assert!(scan_indexed_near_radius(&indexed, &hash, extent, 1, 3).is_empty());
    }

    #[test]
    fn degenerate_start_zero_hashes_empty_and_scans_nothing() {
        // `start == 0` is a degenerate extent: it selects no content on the
        // hashing side, and the scan family must agree.
        let bytes = b"a\nb\nc\n".to_vec();
        let extent = AnchorExtent::LineRange { start: 0, end: 3 };

        assert_eq!(
            hash_bytes_with_extent(&bytes, &extent),
            sha256_hex(b""),
            "start == 0 must hash as empty content",
        );
        assert_eq!(
            cheap_fingerprint_with_extent(&bytes, &extent),
            0,
            "start == 0 must fingerprint as empty content",
        );

        let hash = sha256_hex(b"");
        let files = vec![("f.txt".to_string(), bytes.clone())];
        let indexed = index_all(&files);

        assert!(scan_for_content_hash(&files, &hash, extent, None).is_empty());
        assert!(scan_indexed(&indexed, &hash, extent, None).is_empty());
        assert!(scan_indexed_prefiltered(&indexed, &hash, 0, extent, None).is_empty());
        assert!(scan_indexed_rk64(&indexed, 0, extent, None).is_empty());
        assert!(scan_indexed_near_radius(&indexed, &hash, extent, 1, 3).is_empty());
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
        let hash = sha256_hex(b"");

        assert!(scan_for_content_hash(&files, &hash, extent, None).is_empty());
        assert!(scan_indexed(&indexed, &hash, extent, None).is_empty());
        assert!(scan_indexed_prefiltered(&indexed, &hash, 0, extent, None).is_empty());
        assert!(scan_indexed_rk64(&indexed, 0, extent, None).is_empty());
        assert!(scan_indexed_near_radius(&indexed, &hash, extent, 1, 3).is_empty());
    }
}
