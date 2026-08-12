//! Span file format: parse/serialize the text-based span file storage.
//!
//! Each span file is UTF-8 text stored under the span root directory
//! (default `.span`). The format is:
//!
//! ```text
//! <anchor-address> <algorithm>:<content-hash>
//! <anchor-address> <algorithm>:<content-hash>
//!
//! <why>
//!
//! [config]
//! copy_detection = "same-commit"   # off | same-commit | any-file-in-commit | any-file-in-repo
//! ignore_whitespace = false
//! follow_moves = false
//! ```
//!
//! The `[config]` block is optional: a line that is exactly `[config]`
//! within the why section starts it, and everything from that line to the
//! end of the file belongs to it (the why text excludes the block and any
//! trailing blank lines before it). Keys default when omitted; unknown
//! keys, invalid values, or malformed lines are refused (fail closed).
//! TOML-style `#` comments and blank lines are allowed inside the block.
//!
//! This is the on-disk contract `.span`/`.wiki` consumers share: a pure
//! text↔struct transform with no repository access.

use crate::{cheap_fingerprint_with_extent, rk64_to_hex, AnchorExtent, RK64_ALGORITHM};
use crate::error::{Error, Result};
use std::collections::HashMap;
use std::fmt;

/// A single anchor record within a span file.
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

/// `-C` levels for copy detection. Stored in the span file's `[config]`
/// block, not in the anchor record. The wire (kebab-case) names are
/// `off`, `same-commit`, `any-file-in-commit`, `any-file-in-repo`.
///
/// Declaration order is narrowest → most permissive so `Ord`/`max` picks
/// the widest setting across spans.
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CopyDetection {
    Off,
    SameCommit,
    AnyFileInCommit,
    AnyFileInRepo,
}

impl CopyDetection {
    /// The documented kebab-case wire name used in the `[config]` block.
    pub fn wire_name(self) -> &'static str {
        match self {
            CopyDetection::Off => "off",
            CopyDetection::SameCommit => "same-commit",
            CopyDetection::AnyFileInCommit => "any-file-in-commit",
            CopyDetection::AnyFileInRepo => "any-file-in-repo",
        }
    }

    /// Parse a kebab-case wire name. `None` for anything undocumented.
    pub fn from_wire(name: &str) -> Option<Self> {
        match name {
            "off" => Some(CopyDetection::Off),
            "same-commit" => Some(CopyDetection::SameCommit),
            "any-file-in-commit" => Some(CopyDetection::AnyFileInCommit),
            "any-file-in-repo" => Some(CopyDetection::AnyFileInRepo),
            _ => None,
        }
    }
}

/// Resolver options for all anchors in a span, parsed from the optional
/// trailing `[config]` block. Absent block (or absent keys) ⇒ defaults.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SpanConfig {
    pub copy_detection: CopyDetection,
    pub ignore_whitespace: bool,
    pub follow_moves: bool,
}

impl Default for SpanConfig {
    /// The documented defaults: `same-commit` / `false` / `false`.
    fn default() -> Self {
        SpanConfig {
            copy_detection: CopyDetection::SameCommit,
            ignore_whitespace: false,
            follow_moves: false,
        }
    }
}

/// An in-memory representation of a single span file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanFile {
    /// Anchor records in file order.
    pub anchors: Vec<AnchorRecord>,
    /// Why text (everything after the first blank line, excluding the
    /// optional trailing `[config]` block).
    pub why: String,
    /// Resolver options from the trailing `[config]` block; defaults when
    /// the block (or a key) is absent.
    pub config: SpanConfig,
}

impl SpanFile {
    /// Parse a span file from its text format.
    ///
    /// This is a pure text→struct transform. Span-root containment of anchor
    /// paths is NOT enforced here: `parse` is the single chokepoint every read
    /// funnels through, including repair/mutation commands (`remove`, `delete`,
    /// `move`, `drift --fix`), which must be able to load a poisoned span in
    /// order to fix it. Interior-anchor violations are surfaced at the
    /// reporting/validate surfaces (`drift`, `doctor`) instead.
    ///
    /// Returns `InvalidSpanFile` on malformed input.
    pub fn parse(input: &str) -> Result<Self> {
        // Canonicalize CRLF → LF up front so every downstream step — the
        // blank-line separator split, the anchor `lines()` scan, and the why
        // text — sees the same shape regardless of how the file's line
        // endings were stored. A CRLF span file (Windows checkout with
        // `core.autocrlf`, or a CRLF editor) thus parses to the same
        // `SpanFile` as its LF twin, matching the crate's CRLF-canonicalizing
        // hashing kernel. Without this, `\r\n\r\n` would defeat the
        // `split_once("\n\n")` separator search below.
        let normalized;
        let input = if input.contains('\r') {
            normalized = input.replace("\r\n", "\n");
            normalized.as_str()
        } else {
            input
        };
        // Fail-closed backstop: a span file carrying Git textual conflict
        // markers is the product of an unresolved merge. Refuse to parse
        // it as valid span data so `show`/`list`/`drift` never present
        // `<<<<<<<` / `=======` / `>>>>>>>` content as real why/anchors.
        if has_conflict_markers(input) {
            return Err(Error::SpanConflict(
                "span file contains Git conflict markers".to_string(),
            ));
        }
        // Split on first blank line (double newline). `why_first_line` is
        // the 1-based line number of the why section's first line in the
        // (normalized) input, used for `[config]` diagnostics.
        let (anchor_block, why, why_first_line) = match input.split_once("\n\n") {
            Some((anchors, why)) => {
                let first = anchors.matches('\n').count() + 3;
                (anchors, why.to_string(), first)
            }
            None => {
                // No blank-line separator found. Check if the content
                // starts with a newline — that signals an empty anchor
                // block with only a why text.
                if input.starts_with('\n') {
                    // Strip only the leading newline(s) that stand in for the
                    // absent anchor block — not arbitrary whitespace — so the
                    // why text's own leading indentation survives, matching the
                    // `split_once` sibling path which consumes just the
                    // separator.
                    let trimmed = input.trim_start_matches('\n');
                    let stripped = input.len() - trimmed.len();
                    ("", trimmed.to_string(), stripped + 1)
                } else {
                    // All text is anchors, why is empty.
                    (input, String::new(), 1)
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
                .map_err(|e| Error::InvalidSpanFile(format!("line {}: {e}", idx + 1)))?;
            anchors.push(record);
        }

        // Extract the optional trailing `[config]` block: the first line
        // that is exactly `[config]` starts it; everything from that line
        // on is configuration, not prose.
        let why_lines: Vec<&str> = why.lines().collect();
        let config_marker = why_lines.iter().position(|l| l.trim() == "[config]");
        let (why, config) = match config_marker {
            Some(idx) => {
                let prose = why_lines[..idx].join("\n");
                let block: Vec<(usize, &str)> = why_lines[idx + 1..]
                    .iter()
                    .enumerate()
                    .map(|(i, l)| (why_first_line + idx + 1 + i, *l))
                    .collect();
                (prose, parse_config_block(&block)?)
            }
            None => (why, SpanConfig::default()),
        };

        // Trim trailing newlines (and any blank lines that preceded the
        // `[config]` block) from why.
        let why = why.trim_end().to_string();

        Ok(SpanFile {
            anchors,
            why,
            config,
        })
    }

    /// Serialize this span file to its text format.
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
    /// neither anchors nor why exist (and the config is default), output
    /// is empty.
    ///
    /// A non-default config round-trips as the documented trailing
    /// `[config]` block (all three keys, explicit). A default config
    /// serializes nothing — parse treats an absent block as defaults, so
    /// `parse(serialize(x)) == x` holds either way.
    pub fn serialize(&self) -> String {
        let has_config = self.config != SpanConfig::default();
        let mut out = String::new();
        for anchor in &self.anchors {
            out.push_str(&anchor.to_string());
            out.push('\n');
        }
        if !self.anchors.is_empty() || !self.why.is_empty() || has_config {
            // Blank line separator (or leading blank when no anchors).
            out.push('\n');
        }
        if !self.why.is_empty() {
            out.push_str(&self.why);
            out.push('\n');
        }
        if has_config {
            if !self.why.is_empty() {
                // Blank line between the why prose and the config block.
                out.push('\n');
            }
            out.push_str("[config]\n");
            out.push_str(&format!(
                "copy_detection = \"{}\"\n",
                self.config.copy_detection.wire_name()
            ));
            out.push_str(&format!(
                "ignore_whitespace = {}\n",
                self.config.ignore_whitespace
            ));
            out.push_str(&format!("follow_moves = {}\n", self.config.follow_moves));
        }
        out
    }
}

/// Parse the lines of a `[config]` block (everything after the `[config]`
/// marker line). Each entry is `(1-based file line number, raw line)`.
///
/// TOML-style `#` comments (outside double quotes) and blank lines are
/// allowed. Unknown keys, duplicate keys, invalid values, and malformed
/// lines are refused with an error naming the offense and its line —
/// fail closed rather than silently accepting an unenforceable setting.
fn parse_config_block(lines: &[(usize, &str)]) -> Result<SpanConfig> {
    /// Strip a `#` comment that is not inside a double-quoted string.
    fn strip_comment(line: &str) -> &str {
        let mut in_string = false;
        for (i, c) in line.char_indices() {
            match c {
                '"' => in_string = !in_string,
                '#' if !in_string => return &line[..i],
                _ => {}
            }
        }
        line
    }

    fn parse_bool(key: &str, value: &str, lineno: usize) -> Result<bool> {
        match value {
            "true" => Ok(true),
            "false" => Ok(false),
            other => Err(Error::InvalidSpanFile(format!(
                "line {lineno}: invalid {key} value `{other}`: expected true or false"
            ))),
        }
    }

    let mut config = SpanConfig::default();
    let mut seen: [Option<usize>; 3] = [None; 3];
    for &(lineno, raw) in lines {
        let line = strip_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Err(Error::InvalidSpanFile(format!(
                "line {lineno}: malformed [config] line `{}`: expected `key = value`",
                raw.trim()
            )));
        };
        let key = key.trim();
        let value = value.trim();
        let slot = match key {
            "copy_detection" => 0,
            "ignore_whitespace" => 1,
            "follow_moves" => 2,
            other => {
                return Err(Error::InvalidSpanFile(format!(
                    "line {lineno}: unknown [config] key `{other}`: expected \
                     copy_detection, ignore_whitespace, or follow_moves"
                )));
            }
        };
        if let Some(first) = seen[slot] {
            return Err(Error::InvalidSpanFile(format!(
                "line {lineno}: duplicate [config] key `{key}` (first set on line {first})"
            )));
        }
        seen[slot] = Some(lineno);
        match slot {
            0 => {
                let Some(unquoted) = value
                    .strip_prefix('"')
                    .and_then(|v| v.strip_suffix('"'))
                else {
                    return Err(Error::InvalidSpanFile(format!(
                        "line {lineno}: invalid copy_detection value `{value}`: \
                         expected a quoted string, e.g. copy_detection = \"same-commit\""
                    )));
                };
                config.copy_detection = CopyDetection::from_wire(unquoted).ok_or_else(|| {
                    Error::InvalidSpanFile(format!(
                        "line {lineno}: invalid copy_detection value `{unquoted}`: \
                         expected \"off\", \"same-commit\", \"any-file-in-commit\", \
                         or \"any-file-in-repo\""
                    ))
                })?;
            }
            1 => config.ignore_whitespace = parse_bool(key, value, lineno)?,
            _ => config.follow_moves = parse_bool(key, value, lineno)?,
        }
    }
    Ok(config)
}

/// Detect Git textual merge-conflict markers. A line is a conflict
/// marker when it begins with one of the standard 7-character sentinels
/// (`<<<<<<<`, `=======`, `>>>>>>>`) or the diff3 base sentinel
/// (`|||||||`). The `=======` form must be the marker line exactly (or
/// followed by whitespace) so a legitimate `=======` inside why prose is
/// not over-matched alongside the open/close markers.
pub fn has_conflict_markers(input: &str) -> bool {
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
        Error::InvalidSpanFile(format!("malformed anchor line: no space found in `{line}`"))
    })?;

    let address = &line[..space_pos];
    let hash_part = line[space_pos + 1..].trim();

    if address.is_empty() {
        return Err(Error::InvalidSpanFile("empty anchor address".to_string()));
    }
    if hash_part.is_empty() {
        return Err(Error::InvalidSpanFile(format!(
            "missing hash after space in `{line}`"
        )));
    }

    // Parse hash part: <algorithm>:<content-hash>
    let colon_pos = hash_part.find(':').ok_or_else(|| {
        Error::InvalidSpanFile(format!(
            "malformed hash part `{hash_part}`: expected `<algorithm>:<content-hash>`"
        ))
    })?;
    let algorithm = hash_part[..colon_pos].to_string();
    let content_hash = hash_part[colon_pos + 1..].to_string();

    if algorithm.is_empty() {
        return Err(Error::InvalidSpanFile(format!(
            "empty algorithm in hash part `{hash_part}`"
        )));
    }
    if content_hash.is_empty() {
        return Err(Error::InvalidSpanFile(format!(
            "empty content hash in hash part `{hash_part}`"
        )));
    }

    // Delegate the address grammar and path normalization to the single
    // authority, `parse_anchor_address`. Re-implementing the grammar here is
    // what let the two surfaces drift: backslash paths went un-normalized and
    // a bare `#` (e.g. `file.ts#88`) was silently accepted as a whole-file
    // path. The span-file surface keeps its richer error type by rendering the
    // typed `AddressError` into an `InvalidSpanFile` message — the one
    // legitimate difference between this surface and the CLI's `Option`.
    let (path, extent) = parse_anchor_address(address).map_err(|e| {
        Error::InvalidSpanFile(format!("malformed anchor address `{address}`: {e}"))
    })?;

    let (start_line, end_line) = match extent {
        AnchorExtent::WholeFile => (0, 0),
        AnchorExtent::LineRange { start, end } => (start, end),
    };

    Ok(AnchorRecord {
        path,
        start_line,
        end_line,
        algorithm,
        content_hash,
    })
}

/// How one line of a conflict-markered span file reads against the anchor
/// grammar, for a reader that has to decide whether the line belongs to the
/// anchor block or the why text.
///
/// The span-file format gives the two regions no per-line marking of their
/// own: they are separated by a blank line and nothing else. A reader that
/// has lost track of that separator — because a conflict block moved it, or
/// because the block came from a writer that put anchor residue and why
/// residue in one block — cannot recover it from a line's appearance alone,
/// and every shape below is one it must be able to name in order to refuse
/// rather than guess. See [`classify_anchor_line`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorLineShape {
    /// The line does not parse as an anchor record at all (a blank line,
    /// ordinary prose, a `[config]` header).
    NotAnchor,
    /// `<path> <alg>:<hash>` — a whole-file anchor. `path_has_whitespace`
    /// is the discriminator between a real whole-file anchor (paths rarely
    /// contain spaces) and a sentence that happens to end in a colon-bearing
    /// token, such as prose closing with a URL.
    WholeFile { path_has_whitespace: bool },
    /// `<path>#L<start>-L<end> <alg>:<hash>` — a line-range anchor. Prose
    /// that merely quotes an anchor address mid-sentence lands here with
    /// `path_has_whitespace` set, because the words before the address are
    /// absorbed into the path.
    LineRange { path_has_whitespace: bool },
}

/// Classify one line against the anchor grammar without committing to it.
///
/// This is the shared authority for "could this line be an anchor record?",
/// used by readers that must establish the anchor/why boundary structurally
/// and refuse when they cannot. It answers only about shape — it never
/// decides what the line *is*, because that is precisely what the format
/// does not record.
pub fn classify_anchor_line(line: &str) -> AnchorLineShape {
    let Ok(record) = parse_anchor_line(line) else {
        return AnchorLineShape::NotAnchor;
    };
    let path_has_whitespace = record.path.chars().any(char::is_whitespace);
    if record.start_line == 0 && record.end_line == 0 {
        AnchorLineShape::WholeFile { path_has_whitespace }
    } else {
        AnchorLineShape::LineRange { path_has_whitespace }
    }
}

/// Canonicalize an anchor path to the POSIX, forward-slash, repo-relative
/// form. A Windows author may type `sub\dir\file.txt`; the git tree/index
/// is forward-slash on every platform, so a backslash path would fail to
/// resolve everywhere. Normalize at the parse (write) boundary so spans
/// stay portable across OSes.
fn normalize_anchor_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Why an anchor address failed to parse. Naming each failure mode lets the
/// two reading surfaces share one grammar while keeping their own error
/// presentation: [`parse_address`] (the CLI boundary) collapses every variant
/// to `None`, while [`parse_anchor_line`] renders each into a specific
/// `InvalidSpanFile` message.
#[derive(Debug, PartialEq, Eq)]
enum AddressError {
    /// The path component before `#L` (or the whole address) is empty.
    EmptyPath,
    /// A `#` without a following `L` (e.g. `file.ts#88`) — invalid syntax.
    BareHash,
    /// `#L` was present but the `-L<end>` separator was missing.
    MissingRangeSeparator,
    /// The `<start>` between `#L` and `-L` was not a `u32`.
    InvalidStartLine,
    /// The `<end>` after `-L` was not a `u32`.
    InvalidEndLine,
    /// `<start>` parsed to 0; line numbers are 1-based.
    StartLineZero,
    /// `<end>` is below `<start>`, so the range is empty.
    EndBeforeStart { start: u32, end: u32 },
}

impl fmt::Display for AddressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AddressError::EmptyPath => write!(f, "empty file path"),
            AddressError::BareHash => {
                write!(f, "`#` without `L` is invalid anchor syntax (e.g. `file.ts#88`)")
            }
            AddressError::MissingRangeSeparator => {
                write!(f, "expected `<path>#L<start>-L<end>`")
            }
            AddressError::InvalidStartLine => write!(f, "invalid start line"),
            AddressError::InvalidEndLine => write!(f, "invalid end line"),
            AddressError::StartLineZero => write!(f, "start line must be >= 1"),
            AddressError::EndBeforeStart { start, end } => {
                write!(f, "end line {end} < start line {start}")
            }
        }
    }
}

/// The single anchor-address grammar and path-normalization authority.
///
/// `<path>#L<start>-L<end>` yields a line range; a bare `<path>` yields a
/// whole-file extent. A `#` without a following `L` (e.g. `file.ts#88`) is
/// invalid. The path is normalized to the canonical forward-slash form (see
/// [`normalize_anchor_path`]) so a backslash-spelled path authored on Windows
/// resolves against the forward-slash git tree everywhere.
///
/// Returns a typed [`AddressError`] so each caller can choose its own error
/// presentation.
fn parse_anchor_address(text: &str) -> std::result::Result<(String, AnchorExtent), AddressError> {
    if let Some((path, fragment)) = text.split_once("#L") {
        if path.is_empty() {
            return Err(AddressError::EmptyPath);
        }
        let (start, end) = fragment
            .split_once("-L")
            .ok_or(AddressError::MissingRangeSeparator)?;
        let start: u32 = start.parse().map_err(|_| AddressError::InvalidStartLine)?;
        let end: u32 = end.parse().map_err(|_| AddressError::InvalidEndLine)?;
        if start < 1 {
            return Err(AddressError::StartLineZero);
        }
        if end < start {
            return Err(AddressError::EndBeforeStart { start, end });
        }
        return Ok((
            normalize_anchor_path(path),
            AnchorExtent::LineRange { start, end },
        ));
    }
    // A `#` without a following `L` is invalid anchor syntax (e.g., `file.ts#88`).
    if text.contains('#') {
        return Err(AddressError::BareHash);
    }
    if text.is_empty() {
        return Err(AddressError::EmptyPath);
    }
    Ok((normalize_anchor_path(text), AnchorExtent::WholeFile))
}

/// Parse a `<path>#L<start>-L<end>` line-anchor address, or a bare
/// `<path>` whole-file address. Returns `None` on any malformed address —
/// the CLI boundary rejects those silently.
///
/// Thin `Option`-returning facade over [`parse_anchor_address`], the shared
/// grammar/normalization authority.
pub fn parse_address(text: &str) -> Option<(String, AnchorExtent)> {
    parse_anchor_address(text).ok()
}

// ---------------------------------------------------------------------------
// Structural span merge
// ---------------------------------------------------------------------------

/// Outcome of a structural span merge. Anchors in `merged` are in
/// canonical (path, start_line, end_line) order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanMergeResult {
    pub merged: SpanFile,
    pub unresolved: Vec<UnresolvedAnchor>,
}

/// Same path + extent on both sides, divergent content_hash, with no
/// source available to re-hash authoritatively.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnresolvedAnchor {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub ours: AnchorRecord,
    pub theirs: AnchorRecord,
}

/// `base` is the merge-base span (merge-driver path); `None` when parsing
/// textual conflict markers into ours/theirs (the `--fix` path), in which
/// case any `--why` divergence fails closed. `source_files` supplies
/// `(repo_relative_path, file_bytes)` for re-hashing.
pub fn merge_span_files(
    base: Option<&SpanFile>,
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> SpanMergeResult {
    fn find_source<'a>(path: &str, files: &'a [(String, Vec<u8>)]) -> Option<&'a [u8]> {
        files.iter().find(|(p, _)| p == path).map(|(_, b)| b.as_slice())
    }

    fn rehash(anchor: &AnchorRecord, source: &[u8]) -> AnchorRecord {
        let extent = if anchor.start_line == 0 && anchor.end_line == 0 {
            AnchorExtent::WholeFile
        } else {
            AnchorExtent::LineRange { start: anchor.start_line, end: anchor.end_line }
        };
        let fp = cheap_fingerprint_with_extent(source, &extent);
        AnchorRecord {
            path: anchor.path.clone(),
            start_line: anchor.start_line,
            end_line: anchor.end_line,
            algorithm: RK64_ALGORITHM.to_string(),
            content_hash: rk64_to_hex(fp),
        }
    }

    // Build index maps keyed by (path, start_line, end_line).
    let mut ours_map: HashMap<(&str, u32, u32), &AnchorRecord> = HashMap::new();
    let mut theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> = HashMap::new();

    for a in &ours.anchors {
        ours_map.insert((a.path.as_str(), a.start_line, a.end_line), a);
    }
    for a in &theirs.anchors {
        theirs_map.insert((a.path.as_str(), a.start_line, a.end_line), a);
    }

    let mut merged_anchors: Vec<AnchorRecord> = Vec::new();
    let mut unresolved: Vec<UnresolvedAnchor> = Vec::new();

    // Process keys from ours map.
    for (&(path, start_line, end_line), o_anchor) in &ours_map {
        match theirs_map.get(&(path, start_line, end_line)) {
            None => {
                // Anchor only in ours.
                let anchor = match find_source(path, source_files) {
                    Some(src) => rehash(o_anchor, src),
                    None => (*o_anchor).clone(),
                };
                merged_anchors.push(anchor);
            }
            Some(t_anchor) => {
                if o_anchor.algorithm == t_anchor.algorithm
                    && o_anchor.content_hash == t_anchor.content_hash
                {
                    // Identical in both — keep one copy.
                    merged_anchors.push((*o_anchor).clone());
                } else {
                    // Same path + extent, divergent hash.
                    match find_source(path, source_files) {
                        Some(src) => {
                            // Re-hash from source → one canonical anchor.
                            merged_anchors.push(rehash(o_anchor, src));
                        }
                        None => {
                            // No source available — return in unresolved.
                            unresolved.push(UnresolvedAnchor {
                                path: path.to_string(),
                                start_line,
                                end_line,
                                ours: (*o_anchor).clone(),
                                theirs: (*t_anchor).clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Process keys only in theirs map (not already handled above).
    for (&(path, start_line, end_line), t_anchor) in &theirs_map {
        if !ours_map.contains_key(&(path, start_line, end_line)) {
            let anchor = match find_source(path, source_files) {
                Some(src) => rehash(t_anchor, src),
                None => (*t_anchor).clone(),
            };
            merged_anchors.push(anchor);
        }
    }

    // Sort into canonical (path, start_line, end_line) order.
    merged_anchors.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    // Sort unresolved anchors deterministically by (path, start_line, end_line)
    // so conflict-marker output order is stable across runs.
    unresolved.sort_by_key(|u| (u.path.clone(), u.start_line, u.end_line));

    // Resolve why text and config with the same three-way policy.
    let (why_text, why_conflict) = resolve_why_text(base, ours, theirs);
    let (config, config_conflict) = resolve_config(base, ours, theirs);
    if why_conflict || config_conflict {
        // Signal why conflict via a synthetic unresolved entry.
        unresolved.push(UnresolvedAnchor {
            path: String::new(),
            start_line: 0,
            end_line: 0,
            ours: AnchorRecord {
                path: String::new(),
                start_line: 0,
                end_line: 0,
                algorithm: String::new(),
                content_hash: String::new(),
            },
            theirs: AnchorRecord {
                path: String::new(),
                start_line: 0,
                end_line: 0,
                algorithm: String::new(),
                content_hash: String::new(),
            },
        });
    }

    SpanMergeResult {
        merged: SpanFile {
            anchors: merged_anchors,
            why: why_text,
            config,
        },
        unresolved,
    }
}

/// Resolve the `[config]` block from three-way merge inputs with the same
/// policy as [`resolve_why_text`]: an unchanged side yields to the changed
/// one; divergent changes (or divergence without a base) fail closed.
pub fn resolve_config(
    base: Option<&SpanFile>,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> (SpanConfig, bool) {
    match base {
        Some(base) => {
            let o_changed = ours.config != base.config;
            let t_changed = theirs.config != base.config;
            match (o_changed, t_changed) {
                (false, false) => (base.config, false),
                (true, false) => (ours.config, false),
                (false, true) => (theirs.config, false),
                (true, true) => (ours.config, ours.config != theirs.config),
            }
        }
        None => (ours.config, ours.config != theirs.config),
    }
}

/// Resolve the `why` text from three-way merge inputs.
///
/// Returns `(why_text, has_conflict)` where `has_conflict` is `true` when
/// both sides changed the why differently from base (or diverged without
/// a base), signaling the caller to fail closed.
pub fn resolve_why_text(
    base: Option<&SpanFile>,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> (String, bool) {
    match base {
        Some(base) => {
            let o_changed = ours.why != base.why;
            let t_changed = theirs.why != base.why;
            match (o_changed, t_changed) {
                (false, false) => (base.why.clone(), false),
                (true, false) => (ours.why.clone(), false),
                (false, true) => (theirs.why.clone(), false),
                (true, true) => {
                    if ours.why == theirs.why {
                        (ours.why.clone(), false)
                    } else {
                        (ours.why.clone(), true)
                    }
                }
            }
        }
        None => {
            if ours.why == theirs.why {
                (ours.why.clone(), false)
            } else {
                (ours.why.clone(), true)
            }
        }
    }
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
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.anchors.len(), 1);
        assert_eq!(span.anchors[0].path, "path/to/file.txt");
        assert_eq!(span.anchors[0].start_line, 0);
        assert_eq!(span.anchors[0].end_line, 0);
        assert_eq!(span.anchors[0].algorithm, "sha256");
        assert_eq!(span.anchors[0].content_hash, "abc123");
        assert_eq!(span.why, "");
    }

    #[test]
    fn parse_line_anchor() {
        let input = "src/lib.rs#L10-L35 sha256:def456\n\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.anchors.len(), 1);
        assert_eq!(span.anchors[0].path, "src/lib.rs");
        assert_eq!(span.anchors[0].start_line, 10);
        assert_eq!(span.anchors[0].end_line, 35);
    }

    #[test]
    fn parse_with_why() {
        let input = "a.txt sha256:111\nb.txt sha256:222\n\nThis is the why text.\nIt can span multiple lines.\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.anchors.len(), 2);
        assert_eq!(
            span.why,
            "This is the why text.\nIt can span multiple lines."
        );
    }

    #[test]
    fn parse_no_blank_line() {
        let input = "a.txt sha256:111\nb.txt sha256:222\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.anchors.len(), 2);
        assert_eq!(span.why, "");
    }

    #[test]
    fn parse_empty_anchors_with_why() {
        let input = "\n\nwhy text here";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.anchors.len(), 0);
        assert_eq!(span.why, "why text here");
    }

    #[test]
    fn parse_crlf_matches_lf_twin() {
        let lf = SpanFile::parse("a.txt sha256:111\n\nwhy text\n").unwrap();
        let crlf = SpanFile::parse("a.txt sha256:111\r\n\r\nwhy text\r\n").unwrap();
        assert_eq!(crlf, lf);
        assert_eq!(crlf.anchors.len(), 1);
        assert_eq!(crlf.anchors[0].path, "a.txt");
        assert_eq!(crlf.anchors[0].algorithm, "sha256");
        assert_eq!(crlf.anchors[0].content_hash, "111");
        assert_eq!(crlf.why, "why text");
    }

    #[test]
    fn parse_leading_newline_preserves_why_indentation() {
        let span = SpanFile::parse("\n  indented why").unwrap();
        assert_eq!(span.why, "  indented why");
        // The blank-line-separator sibling path must agree.
        let sibling = SpanFile::parse("\n\n  indented why").unwrap();
        assert_eq!(span.why, sibling.why);
    }

    #[test]
    fn parse_rejects_missing_space() {
        let result = SpanFile::parse("badline\n");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("no space"));
    }

    #[test]
    fn parse_rejects_bad_hash_format() {
        let result = SpanFile::parse("file.txt badhash\n");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("expected"));
    }

    #[test]
    fn parse_rejects_invalid_start_line() {
        let result = SpanFile::parse("file.txt#L0-L10 sha256:abc\n");
        assert!(result.is_err());
    }

    #[test]
    fn parse_rejects_end_before_start() {
        let result = SpanFile::parse("file.txt#L10-L5 sha256:abc\n");
        assert!(result.is_err());
    }

    #[test]
    fn parse_rejects_conflict_markers() {
        let input = "<<<<<<< HEAD\na.txt sha256:111\n=======\nb.txt sha256:222\n>>>>>>> branch\n";
        assert!(matches!(
            SpanFile::parse(input),
            Err(Error::SpanConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_open_marker() {
        // A half-resolved file where `>>>>>>>` was deleted but `<<<<<<<`
        // survives is still merge residue. Fail closed.
        let input = "<<<<<<< HEAD\n\nsome why text";
        assert!(matches!(
            SpanFile::parse(input),
            Err(Error::SpanConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_close_marker() {
        let input = "a.txt sha256:111\n\n>>>>>>> branch";
        assert!(matches!(
            SpanFile::parse(input),
            Err(Error::SpanConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_lone_separator_marker() {
        let input = "a.txt sha256:111\n=======\nb.txt sha256:222\n";
        assert!(matches!(
            SpanFile::parse(input),
            Err(Error::SpanConflict(_))
        ));
    }

    #[test]
    fn parse_rejects_diff3_base_marker() {
        let input = "<<<<<<< HEAD\na.txt sha256:111\n||||||| base\nb.txt sha256:222\n";
        assert!(matches!(
            SpanFile::parse(input),
            Err(Error::SpanConflict(_))
        ));
    }

    #[test]
    fn parse_allows_equals_underline_in_why() {
        // A Markdown setext underline (a run of `=` longer than the
        // 7-char separator) in why prose must not be over-matched.
        let input = "a.txt sha256:111\n\nHeading\n==========\nbody text";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.why, "Heading\n==========\nbody text");
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
    fn span_file_line_normalizes_backslash_path() {
        // A backslash-spelled path reaching a span file (hand edit, external
        // writer) must be normalized to the forward-slash form, exactly as
        // `parse_address` does at the CLI boundary, so it resolves against the
        // forward-slash git tree on every platform.
        let span = SpanFile::parse("sub\\dir\\file.txt#L1-L3 sha256:abc\n").unwrap();
        assert_eq!(span.anchors[0].path, "sub/dir/file.txt");
        assert_eq!(
            parse_address("sub\\dir\\file.txt#L1-L3").unwrap().0,
            span.anchors[0].path,
        );

        let whole = SpanFile::parse("sub\\dir\\file.txt sha256:abc\n").unwrap();
        assert_eq!(whole.anchors[0].path, "sub/dir/file.txt");
    }

    #[test]
    fn span_file_line_rejects_bare_hash() {
        // `file.ts#88` is documented as invalid anchor syntax and rejected by
        // `parse_address`; the span-file line parser must reject it too rather
        // than silently storing `file.ts#88` as an unresolvable whole-file path.
        assert!(parse_address("file.ts#88").is_none());
        assert!(SpanFile::parse("file.ts#88 sha256:abc\n").is_err());
    }

    #[test]
    fn parse_config_block_excluded_from_why() {
        let input = "a.txt sha256:111\n\nGuard the resolver settings.\n\n[config]\ncopy_detection = \"any-file-in-repo\"\nignore_whitespace = true\nfollow_moves = true\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.why, "Guard the resolver settings.");
        assert_eq!(
            span.config,
            SpanConfig {
                copy_detection: CopyDetection::AnyFileInRepo,
                ignore_whitespace: true,
                follow_moves: true,
            }
        );
    }

    #[test]
    fn parse_config_block_allows_comments_and_blank_lines() {
        let input = "a.txt sha256:111\n\nwhy\n\n[config]\n\ncopy_detection = \"off\"   # off | same-commit | any-file-in-commit | any-file-in-repo\n# a full-line comment\nfollow_moves = true # trailing\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.why, "why");
        assert_eq!(span.config.copy_detection, CopyDetection::Off);
        assert!(!span.config.ignore_whitespace);
        assert!(span.config.follow_moves);
    }

    #[test]
    fn parse_config_block_without_why_prose() {
        let input = "a.txt sha256:111\n\n[config]\nignore_whitespace = true\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.why, "");
        assert!(span.config.ignore_whitespace);
        assert_eq!(span.config.copy_detection, CopyDetection::SameCommit);
    }

    #[test]
    fn parse_missing_config_block_yields_defaults() {
        let span = SpanFile::parse("a.txt sha256:111\n\njust a why\n").unwrap();
        assert_eq!(span.config, SpanConfig::default());
    }

    #[test]
    fn parse_rejects_invalid_copy_detection_value() {
        let input = "a.txt sha256:111\n\nwhy\n\n[config]\ncopy_detection = \"totally-bogus-value\"\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("copy_detection"), "err: {err}");
        assert!(err.contains("totally-bogus-value"), "err: {err}");
        assert!(err.contains("line 6"), "err: {err}");
    }

    #[test]
    fn parse_rejects_unknown_config_key() {
        let input = "a.txt sha256:111\n\nwhy\n\n[config]\nfollow_renames = true\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("follow_renames"), "err: {err}");
    }

    #[test]
    fn parse_rejects_malformed_config_line() {
        let input = "a.txt sha256:111\n\nwhy\n\n[config]\nnot a key value pair\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("expected `key = value`"), "err: {err}");
    }

    #[test]
    fn parse_rejects_duplicate_config_key() {
        let input =
            "a.txt sha256:111\n\nwhy\n\n[config]\nfollow_moves = true\nfollow_moves = false\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("duplicate"), "err: {err}");
        assert!(err.contains("follow_moves"), "err: {err}");
    }

    #[test]
    fn parse_rejects_invalid_bool_value() {
        let input = "a.txt sha256:111\n\nwhy\n\n[config]\nignore_whitespace = yes\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("ignore_whitespace"), "err: {err}");
        assert!(err.contains("yes"), "err: {err}");
    }

    #[test]
    fn serialize_roundtrip_non_default_config() {
        let span = SpanFile {
            anchors: vec![AnchorRecord {
                path: "a.txt".into(),
                start_line: 1,
                end_line: 5,
                algorithm: "rk64".into(),
                content_hash: "abcd".into(),
            }],
            why: "keep these settings.".into(),
            config: SpanConfig {
                copy_detection: CopyDetection::AnyFileInCommit,
                ignore_whitespace: true,
                follow_moves: false,
            },
        };
        let serialized = span.serialize();
        assert!(
            serialized.contains("[config]\ncopy_detection = \"any-file-in-commit\""),
            "serialized: {serialized}"
        );
        let reparsed = SpanFile::parse(&serialized).unwrap();
        assert_eq!(span, reparsed);
    }

    #[test]
    fn serialize_roundtrip_config_without_why() {
        let span = SpanFile {
            anchors: vec![AnchorRecord {
                path: "a.txt".into(),
                start_line: 0,
                end_line: 0,
                algorithm: "rk64".into(),
                content_hash: "abcd".into(),
            }],
            why: String::new(),
            config: SpanConfig {
                copy_detection: CopyDetection::Off,
                ignore_whitespace: false,
                follow_moves: true,
            },
        };
        let reparsed = SpanFile::parse(&span.serialize()).unwrap();
        assert_eq!(span, reparsed);
    }

    #[test]
    fn serialize_default_config_emits_no_block() {
        let span = SpanFile::parse("a.txt sha256:111\n\nwhy\n").unwrap();
        assert!(!span.serialize().contains("[config]"));
    }

    #[test]
    fn serialize_roundtrip() {
        let input = "a.txt sha256:111\nb.rs#L1-L5 sha256:222\n\nSome why text.\n";
        let span = SpanFile::parse(input).unwrap();
        let serialized = span.serialize();
        let reparsed = SpanFile::parse(&serialized).unwrap();
        assert_eq!(span, reparsed);
    }

    // -----------------------------------------------------------------------
    // merge_span_files
    // -----------------------------------------------------------------------

    #[test]
    fn merge_union_distinct_anchors() {
        let a = AnchorRecord {
            path: "a.rs".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let b = AnchorRecord {
            path: "b.rs".into(), start_line: 5, end_line: 10,
            algorithm: "rk64".into(), content_hash: "2222".into(),
        };
        let ours = SpanFile { anchors: vec![a.clone()], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![b.clone()], why: String::new(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // Both unique anchors appear in the merged output.
        assert_eq!(result.merged.anchors.len(), 2);
        assert!(result.merged.anchors.contains(&a));
        assert!(result.merged.anchors.contains(&b));
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_identical_anchor_kept() {
        let anchor = AnchorRecord {
            path: "same.rs".into(), start_line: 1, end_line: 5,
            algorithm: "rk64".into(), content_hash: "deadbeef".into(),
        };
        let ours = SpanFile { anchors: vec![anchor.clone()], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![anchor.clone()], why: String::new(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // Identical anchor on both sides produces a single copy.
        assert_eq!(result.merged.anchors.len(), 1);
        assert_eq!(result.merged.anchors[0], anchor);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_divergent_with_source() {
        let ours_anchor = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 2,
            algorithm: "rk64".into(), content_hash: "abc123".into(),
        };
        let theirs_anchor = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 2,
            algorithm: "rk64".into(), content_hash: "def456".into(),
        };
        let ours = SpanFile { anchors: vec![ours_anchor], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![theirs_anchor], why: String::new(), config: SpanConfig::default() };
        // Source file available for re-hashing — should resolve to one anchor.
        let source = vec![("a.txt".into(), b"hello\nworld\n".to_vec())];
        let result = merge_span_files(None, &ours, &theirs, &source);
        assert_eq!(result.merged.anchors.len(), 1);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_divergent_without_source() {
        let ours_anchor = AnchorRecord {
            path: "x.txt".into(), start_line: 2, end_line: 4,
            algorithm: "rk64".into(), content_hash: "abc123".into(),
        };
        let theirs_anchor = AnchorRecord {
            path: "x.txt".into(), start_line: 2, end_line: 4,
            algorithm: "rk64".into(), content_hash: "def456".into(),
        };
        let ours = SpanFile { anchors: vec![ours_anchor.clone()], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![theirs_anchor.clone()], why: String::new(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // No source to re-hash — anchor listed as unresolved.
        assert_eq!(result.unresolved.len(), 1);
        assert_eq!(result.unresolved[0].path, "x.txt");
        assert_eq!(result.unresolved[0].start_line, 2);
        assert_eq!(result.unresolved[0].end_line, 4);
        assert_eq!(result.unresolved[0].ours, ours_anchor);
        assert_eq!(result.unresolved[0].theirs, theirs_anchor);
    }

    #[test]
    fn merge_why_ours_changed() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // Only ours changed why → take ours.
        assert_eq!(result.merged.why, "ours why");
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_why_theirs_changed() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // Only theirs changed why → take theirs.
        assert_eq!(result.merged.why, "theirs why");
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_why_both_identical() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "original why".into(), config: SpanConfig::default() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "new why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "new why".into(), config: SpanConfig::default() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // Both changed why identically → accept the new common why.
        assert_eq!(result.merged.why, "new why");
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_why_both_divergent() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "base why".into(), config: SpanConfig::default() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // Both sides changed why differently from base — fail closed.
        assert!(result.unresolved.len() > 0);
    }

    #[test]
    fn merge_why_neither_changed() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // No side changed why → keep the common value.
        assert_eq!(result.merged.why, "stable why");
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_why_no_base_divergence() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // No base span and divergent why — fail closed.
        assert!(result.unresolved.len() > 0);
    }

    #[test]
    fn merge_canonical_ordering() {
        let z = AnchorRecord {
            path: "z.rs".into(), start_line: 1, end_line: 5,
            algorithm: "rk64".into(), content_hash: "aaa".into(),
        };
        let a = AnchorRecord {
            path: "a.rs".into(), start_line: 1, end_line: 5,
            algorithm: "rk64".into(), content_hash: "bbb".into(),
        };
        let a_later = AnchorRecord {
            path: "a.rs".into(), start_line: 10, end_line: 15,
            algorithm: "rk64".into(), content_hash: "ccc".into(),
        };
        let ours = SpanFile { anchors: vec![z, a_later], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: String::new(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        assert_eq!(result.merged.anchors.len(), 3);
        // Canonical: (path, start_line, end_line) ascending.
        assert_eq!(result.merged.anchors[0], a);
        assert_eq!(result.merged.anchors[1].path, "a.rs");
        assert_eq!(result.merged.anchors[1].start_line, 10);
        assert_eq!(result.merged.anchors[2].path, "z.rs");
    }

    #[test]
    fn merge_whole_file_anchors() {
        let whole = AnchorRecord {
            path: "f.txt".into(), start_line: 0, end_line: 0,
            algorithm: "rk64".into(), content_hash: "whole_file_hash".into(),
        };
        let line = AnchorRecord {
            path: "f.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "line_hash".into(),
        };
        let ours = SpanFile { anchors: vec![whole.clone()], why: String::new(), config: SpanConfig::default() };
        let theirs = SpanFile { anchors: vec![line.clone()], why: String::new(), config: SpanConfig::default() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // Whole-file and line-range anchors both preserved.
        assert_eq!(result.merged.anchors.len(), 2);
        assert!(result.merged.anchors.contains(&whole));
        assert!(result.merged.anchors.contains(&line));
        assert!(result.unresolved.is_empty());
    }
}
