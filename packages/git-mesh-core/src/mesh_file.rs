//! Mesh file format: parse/serialize the text-based mesh file storage.
//!
//! Each mesh file is UTF-8 text stored under the mesh root directory
//! (default `.mesh`). The format is:
//!
//! ```text
//! <anchor-address> <algorithm>:<content-hash>
//! <anchor-address> <algorithm>:<content-hash>
//!
//! <why>
//! ```
//!
//! This is the on-disk contract `.mesh`/`.wiki` consumers share: a pure
//! text↔struct transform with no repository access.

use crate::AnchorExtent;
use crate::error::{Error, Result};
use std::fmt;

/// A single anchor record within a mesh file.
///
/// Whole-file anchors use `start_line = 0` and `end_line = 0`.
/// Line anchors use 1-based inclusive line numbers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnchorRecord {
    /// Repository-relative, slash-separated file path.
    pub path: String,
    /// 1-based start line; 0 for whole-file anchors.
    pub start_line: u32,
    /// 1-based end line (inclusive); 0 for whole-file anchors.
    pub end_line: u32,
    /// Hash algorithm name (e.g. `"sha256"`).
    pub algorithm: String,
    /// Hex content hash produced by the algorithm.
    pub content_hash: String,
}

impl fmt::Display for AnchorRecord {
    /// Formats the anchor address line:
    ///
    /// - Whole-file: `<path> <algorithm>:<content_hash>`
    /// - Line anchor: `<path>#L<start>-L<end> <algorithm>:<content_hash>`
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.start_line == 0 && self.end_line == 0 {
            write!(f, "{} {}:{}", self.path, self.algorithm, self.content_hash)
        } else {
            write!(
                f,
                "{}#L{}-L{} {}:{}",
                self.path, self.start_line, self.end_line, self.algorithm, self.content_hash
            )
        }
    }
}

/// An in-memory representation of a single mesh file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshFile {
    /// Anchor records in file order.
    pub anchors: Vec<AnchorRecord>,
    /// Why text (everything after the first blank line).
    pub why: String,
}

impl MeshFile {
    /// Parse a mesh file from its text format.
    ///
    /// This is a pure text→struct transform. Mesh-root containment of anchor
    /// paths is NOT enforced here: `parse` is the single chokepoint every read
    /// funnels through, including repair/mutation commands (`remove`, `delete`,
    /// `move`, `stale --fix`), which must be able to load a poisoned mesh in
    /// order to fix it. Interior-anchor violations are surfaced at the
    /// reporting/validate surfaces (`stale`, `doctor`) instead.
    ///
    /// Returns `InvalidMeshFile` on malformed input.
    pub fn parse(input: &str) -> Result<Self> {
        // Fail-closed backstop: a mesh file carrying Git textual conflict
        // markers is the product of an unresolved merge. Refuse to parse
        // it as valid mesh data so `show`/`list`/`stale` never present
        // `<<<<<<<` / `=======` / `>>>>>>>` content as real why/anchors.
        if has_conflict_markers(input) {
            return Err(Error::MeshConflict(
                "mesh file contains Git conflict markers".to_string(),
            ));
        }
        // Split on first blank line (double newline).
        let (anchor_block, why) = match input.split_once("\n\n") {
            Some((anchors, why)) => (anchors, why.to_string()),
            None => {
                // No blank-line separator found. Check if the content
                // starts with a newline — that signals an empty anchor
                // block with only a why text.
                if input.starts_with('\n') {
                    ("", input.trim_start().to_string())
                } else {
                    // All text is anchors, why is empty.
                    (input, String::new())
                }
            }
        };

        let mut anchors = Vec::new();
        for (idx, line) in anchor_block.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                // Skip blank lines within the anchor block (e.g. trailing
                // blank before the separator).
                continue;
            }
            let record = parse_anchor_line(line)
                .map_err(|e| Error::InvalidMeshFile(format!("line {}: {e}", idx + 1)))?;
            anchors.push(record);
        }

        // Trim trailing newlines from why.
        let why = why.trim_end().to_string();

        Ok(MeshFile { anchors, why })
    }

    /// Serialize this mesh file to its text format.
    ///
    /// Format:
    /// ```text
    /// <anchor-1>
    /// <anchor-2>
    ///
    /// <why>
    /// ```
    ///
    /// When there are no anchors, a leading blank line introduces the why
    /// text so the parser can distinguish an empty anchor block. When
    /// neither anchors nor why exist, output is empty.
    pub fn serialize(&self) -> String {
        let mut out = String::new();
        for anchor in &self.anchors {
            out.push_str(&anchor.to_string());
            out.push('\n');
        }
        if !self.anchors.is_empty() || !self.why.is_empty() {
            // Blank line separator (or leading blank when no anchors).
            out.push('\n');
        }
        if !self.why.is_empty() {
            out.push_str(&self.why);
            out.push('\n');
        }
        out
    }
}

/// Detect Git textual merge-conflict markers. A line is a conflict
/// marker when it begins with one of the standard 7-character sentinels
/// (`<<<<<<<`, `=======`, `>>>>>>>`) or the diff3 base sentinel
/// (`|||||||`). The `=======` form must be the marker line exactly (or
/// followed by whitespace) so a legitimate `=======` inside why prose is
/// not over-matched alongside the open/close markers.
fn has_conflict_markers(input: &str) -> bool {
    input.lines().any(is_conflict_marker_line)
}

/// True when `line` is a single Git conflict-marker line. The open
/// (`<<<<<<<`), close (`>>>>>>>`), and diff3 base (`|||||||`) sentinels
/// match on prefix. The `=======` separator must be the marker line
/// exactly or be followed by whitespace, so a longer run of `=` (e.g. a
/// Markdown setext underline) in legitimate why prose is not over-matched.
fn is_conflict_marker_line(line: &str) -> bool {
    if line.starts_with("<<<<<<<") || line.starts_with(">>>>>>>") || line.starts_with("|||||||") {
        return true;
    }
    match line.strip_prefix("=======") {
        Some(rest) => rest.is_empty() || rest.starts_with(char::is_whitespace),
        None => false,
    }
}

/// Parse a single anchor line of the form:
///
/// - `<path> <algorithm>:<content-hash>`
/// - `<path>#L<start>-L<end> <algorithm>:<content-hash>`
fn parse_anchor_line(line: &str) -> Result<AnchorRecord> {
    // Split at the last space. Using rfind ensures paths containing
    // spaces (e.g. "dir with spaces/file.txt#L1-L5") are handled
    // correctly, because the hash token `algorithm:content_hash` never
    // contains spaces.
    let space_pos = line.rfind(' ').ok_or_else(|| {
        Error::InvalidMeshFile(format!("malformed anchor line: no space found in `{line}`"))
    })?;

    let address = &line[..space_pos];
    let hash_part = line[space_pos + 1..].trim();

    if address.is_empty() {
        return Err(Error::InvalidMeshFile("empty anchor address".to_string()));
    }
    if hash_part.is_empty() {
        return Err(Error::InvalidMeshFile(format!(
            "missing hash after space in `{line}`"
        )));
    }

    // Parse hash part: <algorithm>:<content-hash>
    let colon_pos = hash_part.find(':').ok_or_else(|| {
        Error::InvalidMeshFile(format!(
            "malformed hash part `{hash_part}`: expected `<algorithm>:<content-hash>`"
        ))
    })?;
    let algorithm = hash_part[..colon_pos].to_string();
    let content_hash = hash_part[colon_pos + 1..].to_string();

    if algorithm.is_empty() {
        return Err(Error::InvalidMeshFile(format!(
            "empty algorithm in hash part `{hash_part}`"
        )));
    }
    if content_hash.is_empty() {
        return Err(Error::InvalidMeshFile(format!(
            "empty content hash in hash part `{hash_part}`"
        )));
    }

    // Parse address for optional line range.
    if let Some(hash_pos) = address.find("#L") {
        let file_path = &address[..hash_pos];
        let range_part = &address[hash_pos + 2..];

        if file_path.is_empty() {
            return Err(Error::InvalidMeshFile(format!(
                "empty file path in line-anchor address `{address}`"
            )));
        }

        let dash_pos = range_part.find("-L").ok_or_else(|| {
            Error::InvalidMeshFile(format!(
                "malformed line anchor address `{address}`: expected `<path>#L<start>-L<end>`"
            ))
        })?;

        let start_str = &range_part[..dash_pos];
        let end_str = &range_part[dash_pos + 2..];

        let start_line = start_str.parse::<u32>().map_err(|e| {
            Error::InvalidMeshFile(format!("invalid start line in `{address}`: {e}"))
        })?;
        let end_line = end_str
            .parse::<u32>()
            .map_err(|e| Error::InvalidMeshFile(format!("invalid end line in `{address}`: {e}")))?;

        if start_line == 0 {
            return Err(Error::InvalidMeshFile(format!(
                "start line must be >= 1 in `{address}`"
            )));
        }
        if end_line < start_line {
            return Err(Error::InvalidMeshFile(format!(
                "end line {end_line} < start line {start_line} in `{address}`"
            )));
        }

        Ok(AnchorRecord {
            path: file_path.to_string(),
            start_line,
            end_line,
            algorithm,
            content_hash,
        })
    } else {
        // Whole-file anchor.
        Ok(AnchorRecord {
            path: address.to_string(),
            start_line: 0,
            end_line: 0,
            algorithm,
            content_hash,
        })
    }
}

/// Canonicalize an anchor path to the POSIX, forward-slash, repo-relative
/// form. A Windows author may type `sub\dir\file.txt`; the git tree/index
/// is forward-slash on every platform, so a backslash path would fail to
/// resolve everywhere. Normalize at the parse (write) boundary so meshes
/// stay portable across OSes.
fn normalize_anchor_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Parse a `<path>#L<start>-L<end>` line-anchor address, or a bare
/// `<path>` whole-file address. Returns `None` on malformed line-anchor
/// fragments — callers should reject those at the CLI boundary.
///
/// The path component is normalized to the canonical forward-slash form
/// (see [`normalize_anchor_path`]) so a backslash-spelled path authored on
/// Windows resolves against the forward-slash git tree everywhere.
pub fn parse_address(text: &str) -> Option<(String, AnchorExtent)> {
    if let Some((path, fragment)) = text.split_once("#L") {
        let (start, end) = fragment.split_once("-L")?;
        if path.is_empty() {
            return None;
        }
        let start: u32 = start.parse().ok()?;
        let end: u32 = end.parse().ok()?;
        if start < 1 || end < start {
            return None;
        }
        return Some((
            normalize_anchor_path(path),
            AnchorExtent::LineRange { start, end },
        ));
    }
    // A `#` without a following `L` is invalid anchor syntax (e.g., `file.ts#88`).
    if text.contains('#') {
        return None;
    }
    if text.is_empty() {
        return None;
    }
    Some((normalize_anchor_path(text), AnchorExtent::WholeFile))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backslash_path_normalized_in_line_address() {
        let (path, extent) = parse_address("sub\\dir\\file.txt#L1-L3").unwrap();
        assert_eq!(path, "sub/dir/file.txt");
        assert_eq!(extent, AnchorExtent::LineRange { start: 1, end: 3 });
    }

    #[test]
    fn backslash_path_normalized_in_whole_file_address() {
        let (path, extent) = parse_address("sub\\dir\\file.txt").unwrap();
        assert_eq!(path, "sub/dir/file.txt");
        assert_eq!(extent, AnchorExtent::WholeFile);
    }

    #[test]
    fn forward_slash_path_unchanged() {
        let (path, _) = parse_address("sub/dir/file.txt#L1-L3").unwrap();
        assert_eq!(path, "sub/dir/file.txt");
    }

    #[test]
    fn parse_single_whole_file_anchor() {
        let input = "path/to/file.txt sha256:abc123\n\n";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.anchors.len(), 1);
        assert_eq!(mesh.anchors[0].path, "path/to/file.txt");
        assert_eq!(mesh.anchors[0].start_line, 0);
        assert_eq!(mesh.anchors[0].end_line, 0);
        assert_eq!(mesh.anchors[0].algorithm, "sha256");
        assert_eq!(mesh.anchors[0].content_hash, "abc123");
        assert_eq!(mesh.why, "");
    }

    #[test]
    fn parse_line_anchor() {
        let input = "src/lib.rs#L10-L35 sha256:def456\n\n";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.anchors.len(), 1);
        assert_eq!(mesh.anchors[0].path, "src/lib.rs");
        assert_eq!(mesh.anchors[0].start_line, 10);
        assert_eq!(mesh.anchors[0].end_line, 35);
    }

    #[test]
    fn parse_with_why() {
        let input = "a.txt sha256:111\nb.txt sha256:222\n\nThis is the why text.\nIt can span multiple lines.\n";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.anchors.len(), 2);
        assert_eq!(
            mesh.why,
            "This is the why text.\nIt can span multiple lines."
        );
    }

    #[test]
    fn parse_no_blank_line() {
        let input = "a.txt sha256:111\nb.txt sha256:222\n";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.anchors.len(), 2);
        assert_eq!(mesh.why, "");
    }

    #[test]
    fn parse_empty_anchors_with_why() {
        let input = "\n\nwhy text here";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.anchors.len(), 0);
        assert_eq!(mesh.why, "why text here");
    }

    #[test]
    fn parse_rejects_missing_space() {
        let result = MeshFile::parse("badline\n");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("no space"));
    }

    #[test]
    fn parse_rejects_bad_hash_format() {
        let result = MeshFile::parse("file.txt badhash\n");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("expected"));
    }

    #[test]
    fn parse_rejects_invalid_start_line() {
        let result = MeshFile::parse("file.txt#L0-L10 sha256:abc\n");
        assert!(result.is_err());
    }

    #[test]
    fn parse_rejects_end_before_start() {
        let result = MeshFile::parse("file.txt#L10-L5 sha256:abc\n");
        assert!(result.is_err());
    }

    #[test]
    fn parse_rejects_conflict_markers() {
        let input = "<<<<<<< HEAD\na.txt sha256:111\n=======\nb.txt sha256:222\n>>>>>>> branch\n";
        assert!(matches!(
            MeshFile::parse(input),
            Err(Error::MeshConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_open_marker() {
        // A half-resolved file where `>>>>>>>` was deleted but `<<<<<<<`
        // survives is still merge residue. Fail closed.
        let input = "<<<<<<< HEAD\n\nsome why text";
        assert!(matches!(
            MeshFile::parse(input),
            Err(Error::MeshConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_close_marker() {
        let input = "a.txt sha256:111\n\n>>>>>>> branch";
        assert!(matches!(
            MeshFile::parse(input),
            Err(Error::MeshConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_separator_marker() {
        let input = "a.txt sha256:111\n=======\nb.txt sha256:222\n";
        assert!(matches!(
            MeshFile::parse(input),
            Err(Error::MeshConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_diff3_base_marker() {
        let input = "<<<<<<< HEAD\na.txt sha256:111\n||||||| base\nb.txt sha256:222\n";
        assert!(matches!(
            MeshFile::parse(input),
            Err(Error::MeshConflict(_))
        ));
    }

    #[test]
    fn parse_allows_equals_underline_in_why() {
        // A Markdown setext underline (a run of `=` longer than the
        // 7-char separator) in why prose must not be over-matched.
        let input = "a.txt sha256:111\n\nHeading\n==========\nbody text";
        let mesh = MeshFile::parse(input).unwrap();
        assert_eq!(mesh.why, "Heading\n==========\nbody text");
    }

    #[test]
    fn display_whole_file() {
        let r = AnchorRecord {
            path: "foo.rs".into(),
            start_line: 0,
            end_line: 0,
            algorithm: "sha256".into(),
            content_hash: "abcd".into(),
        };
        assert_eq!(r.to_string(), "foo.rs sha256:abcd");
    }

    #[test]
    fn display_line_anchor() {
        let r = AnchorRecord {
            path: "bar.rs".into(),
            start_line: 5,
            end_line: 10,
            algorithm: "sha256".into(),
            content_hash: "1234".into(),
        };
        assert_eq!(r.to_string(), "bar.rs#L5-L10 sha256:1234");
    }

    #[test]
    fn mesh_file_line_normalizes_backslash_path() {
        // A backslash-spelled path reaching a mesh file (hand edit, external
        // writer) must be normalized to the forward-slash form, exactly as
        // `parse_address` does at the CLI boundary, so it resolves against the
        // forward-slash git tree on every platform.
        let mesh = MeshFile::parse("sub\\dir\\file.txt#L1-L3 sha256:abc\n").unwrap();
        assert_eq!(mesh.anchors[0].path, "sub/dir/file.txt");
        assert_eq!(
            parse_address("sub\\dir\\file.txt#L1-L3").unwrap().0,
            mesh.anchors[0].path,
        );

        let whole = MeshFile::parse("sub\\dir\\file.txt sha256:abc\n").unwrap();
        assert_eq!(whole.anchors[0].path, "sub/dir/file.txt");
    }

    #[test]
    fn mesh_file_line_rejects_bare_hash() {
        // `file.ts#88` is documented as invalid anchor syntax and rejected by
        // `parse_address`; the mesh-file line parser must reject it too rather
        // than silently storing `file.ts#88` as an unresolvable whole-file path.
        assert!(parse_address("file.ts#88").is_none());
        assert!(MeshFile::parse("file.ts#88 sha256:abc\n").is_err());
    }

    #[test]
    fn serialize_roundtrip() {
        let input = "a.txt sha256:111\nb.rs#L1-L5 sha256:222\n\nSome why text.\n";
        let mesh = MeshFile::parse(input).unwrap();
        let serialized = mesh.serialize();
        let reparsed = MeshFile::parse(&serialized).unwrap();
        assert_eq!(mesh, reparsed);
    }
}
