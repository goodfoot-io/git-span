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
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/// Hash `bytes` per the anchor's `extent`. Whole-file extents hash the
/// full byte buffer; line ranges hash the `\n`-joined slice of lines
/// `[start, end]` (1-based, inclusive).
///
/// Returns the lowercase hex SHA-256 digest (no `sha256:` prefix). This
/// is the canonicalization every git-mesh and consumer freshness check
/// must agree on — share it rather than re-implement it.
pub fn hash_bytes_with_extent(bytes: &[u8], extent: &AnchorExtent) -> String {
    let hashed: Vec<u8> = match extent {
        AnchorExtent::WholeFile => bytes.to_vec(),
        AnchorExtent::LineRange { start, end } => {
            let text = String::from_utf8_lossy(bytes);
            let lines: Vec<&str> = text.lines().collect();
            let lo = (*start as usize).saturating_sub(1);
            let hi = (*end as usize).min(lines.len());
            let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
            slice.join("\n").into_bytes()
        }
    };
    let mut hasher = Sha256::new();
    hasher.update(&hashed);
    let result = hasher.finalize();
    result.iter().map(|b| format!("{b:02x}")).collect()
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
            let span = (end.saturating_sub(start) + 1) as usize;
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
                let near0 = near.saturating_sub(1);
                // Stable sort over windows already collected in ascending
                // (path, start) order, so equal distances keep the lower
                // start line first — matching git-mesh's nearest-window
                // preference.
                out.sort_by_key(|l| (l.start_line.abs_diff(near0), l.start_line));
            }
            out
        }
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
}
