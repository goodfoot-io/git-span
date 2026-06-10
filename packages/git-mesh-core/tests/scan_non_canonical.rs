//! Reproduction tests for non-canonical `content_hash` inputs.
//!
//! `decode_lower_hex32` rejects digests with wrong length, uppercase letters,
//! or non-hex characters and returns `None`. The scan functions keep the
//! rejected `want` string alongside the `None` target and fall through to
//! `sha256_hex(slice) == want` per window — a comparison that can **never**
//! succeed for non-canonical input, yet still performs full SHA-256 hashing
//! and hex formatting on every window.
//!
//! Every test below asserts that the result is empty (the correct answer).
//! After the fix the same tests will also exercise the short-circuit that
//! returns before any window iteration.

use git_mesh_core::{
    AnchorExtent, LineIndex, SHA256_HEX_CALLS, cheap_fingerprint_with_extent,
    scan_for_content_hash, scan_indexed, scan_indexed_prefiltered,
    scan_for_content_hash_near_radius,
};

// ---------------------------------------------------------------------------
// Non-canonical digests — inputs that `decode_lower_hex32` correctly rejects.
// ---------------------------------------------------------------------------

/// 64-char UPPERCASE hex string — `lower_hex_val` rejects `A`-`F`.
const UPPERCASE: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/// 63 chars — wrong length for a 32-byte digest.
const TRUNCATED: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// 64 chars with `x` (not `0-9a-f`).
const NON_HEX: &str = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/// All three non-canonical variants.
const NON_CANONICAL: &[&str; 3] = &[UPPERCASE, TRUNCATED, NON_HEX];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_file(name: &str, content: &[u8]) -> (String, Vec<u8>) {
    (name.to_string(), content.to_vec())
}

fn index_file<'a>(name: &str, content: &'a [u8]) -> (String, LineIndex<'a>) {
    (name.to_string(), LineIndex::build(content))
}

fn reset_counter() -> usize {
    SHA256_HEX_CALLS.swap(0, std::sync::atomic::Ordering::Relaxed)
}

fn read_counter() -> usize {
    SHA256_HEX_CALLS.load(std::sync::atomic::Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Reproduction test: MUST FAIL before the fix
//
// A non-canonical `want` can never match any lowercase-hex window digest, so
// no SHA-256 computation should occur. Today the scan functions still hash
// every window for the string-compare fallback — this test detects that waste.
// ---------------------------------------------------------------------------

#[test]
fn non_canonical_want_performs_no_sha256_work() {
    // Multi-window file so the waste is measurable (and the test fails hard).
    let content: Vec<u8> = (0..100).flat_map(|i| format!("line{i}\n").into_bytes()).collect();
    let files = vec![make_file("a.txt", &content)];

    for &want in NON_CANONICAL {
        reset_counter();
        let result = scan_for_content_hash(
            &files, want,
            AnchorExtent::LineRange { start: 1, end: 3 },
            None,
        );
        assert!(result.is_empty());
        let calls = read_counter();
        assert_eq!(
            calls, 0,
            "non-canonical want {want:.20}.. should short-circuit before any SHA-256; got {calls} sha256_hex calls"
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 1: scan_for_content_hash with line-range extent
//
// This exercises scan_one_file's fast path (LF-clean buffer). The fast path
// uses `match target { Some(t) => .., None => sha256_hex(slice) == want }`.
// When target is None the string comparison is a guaranteed miss, but every
// window still pays for a full SHA-256.
// ---------------------------------------------------------------------------

#[test]
fn scan_one_file_fast_path_returns_empty_for_non_canonical_want() {
    // LF-clean 3-line content — always takes the fast path.
    let files = vec![make_file("a.txt", b"x\ny\nz\n")];
    for &want in NON_CANONICAL {
        let result = scan_for_content_hash(
            &files, want,
            AnchorExtent::LineRange { start: 1, end: 3 },
            None,
        );
        assert!(
            result.is_empty(),
            "scan_one_file fast path: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 2: scan_for_content_hash with whole-file extent
//
// This goes through `whole_file_matches` which does
// `sha256_hex(b) == want` per file — naive string comparison with no
// `decode_lower_hex32` call at all.
// ---------------------------------------------------------------------------

#[test]
fn whole_file_string_compare_returns_empty_for_non_canonical_want() {
    let files = vec![make_file("a.txt", b"x\ny\nz\n")];
    for &want in NON_CANONICAL {
        let result = scan_for_content_hash(&files, want, AnchorExtent::WholeFile, None);
        assert!(
            result.is_empty(),
            "whole-file scan: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 3: scan_indexed_prefiltered with non-canonical want
//
// The confirm closure checks `match &target { Some(t) => ..,
// None => sha256_hex(slice) == want }`. When target is None the
// fingerprint-matched windows still pay SHA-256.
// ---------------------------------------------------------------------------

#[test]
fn prefiltered_confirm_returns_empty_for_non_canonical_want() {
    // Content where the first 3-line window has a known fingerprint, so the
    // confirm closure is actually exercised (fingerprint-matched windows).
    let content = b"x\ny\nz\nq\n";
    let indexed = vec![index_file("a.txt", content)];
    let fp = cheap_fingerprint_with_extent(b"x\ny\nz", &AnchorExtent::WholeFile);
    let extent = AnchorExtent::LineRange { start: 1, end: 3 };

    for &want in NON_CANONICAL {
        let result = scan_indexed_prefiltered(&indexed, want, fp, extent, None);
        assert!(
            result.is_empty(),
            "prefiltered scan: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 4: scan_one_file CRLF fallback
//
// The CRLF path *always* goes through `sha256_hex(...) == want` per
// window — it never looks at `target` at all.
// ---------------------------------------------------------------------------

#[test]
fn scan_one_file_crlf_fallback_returns_empty_for_non_canonical_want() {
    let files = vec![make_file("crlf.txt", b"a\r\nb\r\nc\r\nd\r\n")];
    for &want in NON_CANONICAL {
        let result = scan_for_content_hash(
            &files, want,
            AnchorExtent::LineRange { start: 1, end: 2 },
            None,
        );
        assert!(
            result.is_empty(),
            "CRLF fallback: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 5: scan_indexed with line-range extent (same fallback as path 1)
// ---------------------------------------------------------------------------

#[test]
fn indexed_scan_returns_empty_for_non_canonical_want() {
    let content = b"x\ny\nz\n".to_vec();
    let indexed = vec![index_file("a.txt", &content)];
    for &want in NON_CANONICAL {
        let result = scan_indexed(
            &indexed, want,
            AnchorExtent::LineRange { start: 1, end: 3 },
            None,
        );
        assert!(
            result.is_empty(),
            "indexed scan: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// Code path 6: scan_for_content_hash_near_radius (the bounded band variant)
// ---------------------------------------------------------------------------

#[test]
fn near_radius_scan_returns_empty_for_non_canonical_want() {
    let files = vec![make_file("a.txt", b"x\ny\nz\n")];
    for &want in NON_CANONICAL {
        let result = scan_for_content_hash_near_radius(
            &files, want,
            AnchorExtent::LineRange { start: 1, end: 3 },
            2, 5,
        );
        assert!(
            result.is_empty(),
            "near-radius scan: non-canonical want {want:.20}.. should return empty",
        );
    }
}

// ---------------------------------------------------------------------------
// sha256:-prefixed non-canonical hashes
// ---------------------------------------------------------------------------

#[test]
fn sha256_prefixed_line_range_returns_empty_for_non_canonical_want() {
    let files = vec![make_file("a.txt", b"x\ny\nz\n")];
    for &want in NON_CANONICAL {
        let prefixed = format!("sha256:{want}");
        let result = scan_for_content_hash(
            &files, &prefixed,
            AnchorExtent::LineRange { start: 1, end: 3 },
            None,
        );
        assert!(
            result.is_empty(),
            "sha256:-prefixed non-canonical want should return empty",
        );
    }
}

#[test]
fn sha256_prefixed_whole_file_returns_empty_for_non_canonical_want() {
    let files = vec![make_file("a.txt", b"x\ny\nz\n")];
    for &want in NON_CANONICAL {
        let prefixed = format!("sha256:{want}");
        let result = scan_for_content_hash(&files, &prefixed, AnchorExtent::WholeFile, None);
        assert!(
            result.is_empty(),
            "sha256:-prefixed non-canonical whole-file scan should return empty",
        );
    }
}
