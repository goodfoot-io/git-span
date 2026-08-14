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
//! The optional `[resolved]` section sits in the why region before any
//! `[config]` block: a line that is exactly `[resolved]` starts it, and
//! everything from that line to the `[config]` marker (or end of file)
//! belongs to it. Each record line records one collapse resolution:
//!
//! ```text
//! [resolved]
//! 2026-08-13T12:34:56Z add file.txt#L1-L5 rk64:bb2a1e4032115e1c
//! ```
//!
//! A record is `<timestamp> <add|replace> <address> <algorithm>:<hash>`,
//! where the timestamp is exactly `YYYY-MM-DDTHH:MM:SSZ` (UTC, second
//! precision, shape-validated as an opaque string) and the address follows
//! the anchor-address grammar. Records are hash-tied staleness facts, not
//! leases: the resolution is current while the identity carries the
//! recorded hash, stale when the hash differs or the identity is gone, and
//! is never auto-deleted.
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

/// The resolution command a `[resolved]` record records. The wire name is
/// the lowercase command token that appears in the record line.
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolveCommand {
    /// The identity was re-added at its current address (`git span add`).
    Add,
    /// The identity was moved to a new address (`git span replace`).
    Replace,
}

impl ResolveCommand {
    /// The lowercase token used in the record line's wire format.
    pub fn wire_name(self) -> &'static str {
        match self {
            ResolveCommand::Add => "add",
            ResolveCommand::Replace => "replace",
        }
    }

    /// Parse a wire-format command token. `None` for anything other than
    /// `add`/`replace` (fail closed).
    pub fn from_wire(name: &str) -> Option<ResolveCommand> {
        match name {
            "add" => Some(ResolveCommand::Add),
            "replace" => Some(ResolveCommand::Replace),
            _ => None,
        }
    }
}

/// One resolution record in a span file's `[resolved]` section: the fact
/// that a collapse sentinel was retired by naming an address (`add`) or by
/// moving the identity to a new address (`replace`).
///
/// The record line's wire format is:
///
/// ```text
/// <timestamp> <add|replace> <address> <algorithm>:<content-hash>
/// ```
///
/// where `<timestamp>` is exactly `YYYY-MM-DDTHH:MM:SSZ` (UTC, second
/// precision) and `<address>` follows the anchor-address grammar
/// (`<path>` or `<path>#L<start>-L<end>`).
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRecord {
    /// The UTC timestamp at which the resolution happened, exactly
    /// `YYYY-MM-DDTHH:MM:SSZ` (shape-validated; the value is opaque to the
    /// kernel).
    pub timestamp: String,
    /// Whether the resolution was an `add` (same address) or a `replace`
    /// (new address).
    pub command: ResolveCommand,
    /// Repository-relative, slash-separated file path of the resolved
    /// identity.
    pub path: String,
    /// 1-based start line; 0 for whole-file identities.
    pub start_line: u32,
    /// 1-based end line (inclusive); 0 for whole-file identities.
    pub end_line: u32,
    /// Hash algorithm name (e.g. `"rk64"`).
    pub algorithm: String,
    /// Hex content hash the identity carried at resolution time.
    pub content_hash: String,
}

impl ResolvedRecord {
    /// The record's identity: the `(path, start, end)` triple shared with
    /// anchor records at the same address.
    pub fn identity(&self) -> (&str, u32, u32) {
        (&self.path, self.start_line, self.end_line)
    }

    /// The address portion of the record line (`<path>` or
    /// `<path>#L<start>-L<end>`), matching `AnchorRecord`'s display form.
    fn address(&self) -> String {
        if self.start_line == 0 && self.end_line == 0 {
            self.path.clone()
        } else {
            format!("{}#L{}-L{}", self.path, self.start_line, self.end_line)
        }
    }
}

impl fmt::Display for ResolvedRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} {} {} {}:{}",
            self.timestamp,
            self.command.wire_name(),
            self.address(),
            self.algorithm,
            self.content_hash
        )
    }
}

impl std::str::FromStr for ResolvedRecord {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        parse_resolved_record_line(s)
    }
}

/// True when `s` has the exact shape `YYYY-MM-DDTHH:MM:SSZ`: the fixed
/// layout of the RFC 3339 UTC timestamps the writer emits. The value is
/// deliberately opaque — only the character-class shape is checked, never
/// the calendar semantics (a shape-valid but impossible date like
/// `2026-13-45T99:99:99Z` still parses). Chrono does the real formatting;
/// the kernel stays chrono-free.
pub fn is_rfc3339_utc_shape(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 20 {
        return false;
    }
    let digit = |b: u8| b.is_ascii_digit();
    digit(bytes[0])
        && digit(bytes[1])
        && digit(bytes[2])
        && digit(bytes[3])
        && bytes[4] == b'-'
        && digit(bytes[5])
        && digit(bytes[6])
        && bytes[7] == b'-'
        && digit(bytes[8])
        && digit(bytes[9])
        && bytes[10] == b'T'
        && digit(bytes[11])
        && digit(bytes[12])
        && bytes[13] == b':'
        && digit(bytes[14])
        && digit(bytes[15])
        && bytes[16] == b':'
        && digit(bytes[17])
        && digit(bytes[18])
        && bytes[19] == b'Z'
}

/// Parse one `[resolved]` record line: `<timestamp> <add|replace> <address>
/// <algorithm>:<content-hash>`. Splits at the last space for the hash token
/// (the same trick `parse_anchor_line` uses, so paths containing spaces are
/// handled), then takes the first two space-separated tokens as timestamp
/// and command with the remainder as the address.
fn parse_resolved_record_line(line: &str) -> std::result::Result<ResolvedRecord, String> {
    let line = line.trim();
    if line.is_empty() {
        return Err("blank line inside the `[resolved]` section".to_string());
    }
    let space_pos = line
        .rfind(' ')
        .ok_or_else(|| format!("malformed [resolved] record line: no space found in `{line}`"))?;
    let rest = &line[..space_pos];
    let hash_part = line[space_pos + 1..].trim();

    if hash_part.is_empty() {
        return Err(format!(
            "malformed [resolved] record line: missing hash after space in `{line}`"
        ));
    }
    let colon_pos = hash_part.find(':').ok_or_else(|| {
        format!(
            "malformed [resolved] record line: hash `{hash_part}` is not `<algorithm>:<content-hash>`"
        )
    })?;
    let algorithm = &hash_part[..colon_pos];
    let content_hash = &hash_part[colon_pos + 1..];
    if algorithm.is_empty() {
        return Err(format!(
            "malformed [resolved] record line: empty algorithm in hash `{hash_part}`"
        ));
    }
    if content_hash.is_empty() {
        return Err(format!(
            "malformed [resolved] record line: empty content hash in hash `{hash_part}`"
        ));
    }

    let mut parts = rest.splitn(3, ' ');
    let timestamp = parts.next().unwrap_or("");
    let command = parts.next().unwrap_or("");
    let address = parts.next().unwrap_or("");

    if !is_rfc3339_utc_shape(timestamp) {
        return Err(format!(
            "malformed [resolved] record line: timestamp `{timestamp}` is not `YYYY-MM-DDTHH:MM:SSZ`"
        ));
    }
    let command = ResolveCommand::from_wire(command).ok_or_else(|| {
        format!(
            "malformed [resolved] record line: unknown command `{command}` (expected `add` or `replace`)"
        )
    })?;
    let (path, extent) = parse_anchor_address(address)
        .map_err(|e| format!("malformed [resolved] record line: invalid anchor address `{address}`: {e}"))?;
    let (start_line, end_line) = match extent {
        AnchorExtent::WholeFile => (0, 0),
        AnchorExtent::LineRange { start, end } => (start, end),
    };

    Ok(ResolvedRecord {
        timestamp: timestamp.to_string(),
        command,
        path,
        start_line,
        end_line,
        algorithm: algorithm.to_string(),
        content_hash: content_hash.to_string(),
    })
}

/// An in-memory representation of a single span file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanFile {
    /// Anchor records in file order.
    pub anchors: Vec<AnchorRecord>,
    /// Why text (everything after the first blank line, excluding the
    /// optional trailing `[resolved]` and `[config]` sections).
    pub why: String,
    /// Resolution records from the optional `[resolved]` section, in file
    /// order. Empty when the section is absent.
    pub resolved: Vec<ResolvedRecord>,
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
            return Err(Error::SpanConflict(crate::error::ConflictKind::MarkerText));
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

        // Extract the optional trailing `[config]` block first. A
        // `[resolved]` marker after it is therefore parsed as a config line
        // and refused by `parse_config_block`, enforcing section order.
        let why_lines: Vec<&str> = why.lines().collect();
        let config_marker = why_lines.iter().position(|l| l.trim() == "[config]");
        let (prose_lines, config) = match config_marker {
            Some(idx) => {
                let block: Vec<(usize, &str)> = why_lines[idx + 1..]
                    .iter()
                    .enumerate()
                    .map(|(i, l)| (why_first_line + idx + 1 + i, *l))
                    .collect();
                (&why_lines[..idx], parse_config_block(&block)?)
            }
            None => (why_lines.as_slice(), SpanConfig::default()),
        };

        // The first exact `[resolved]` marker in the prose region begins the
        // structured section. Every following line is a record; blank or
        // malformed lines fail closed with their original source line.
        let resolved_marker = prose_lines.iter().position(|l| *l == "[resolved]");
        let (why_lines, resolved) = match resolved_marker {
            Some(idx) => {
                let mut records = Vec::with_capacity(prose_lines.len().saturating_sub(idx + 1));
                let mut identities = HashMap::new();
                for (offset, line) in prose_lines[idx + 1..].iter().enumerate() {
                    let lineno = why_first_line + idx + 1 + offset;
                    let record = parse_resolved_record_line(line).map_err(|e| {
                        Error::InvalidSpanFile(format!("line {lineno}: {e}"))
                    })?;
                    let identity = (record.path.clone(), record.start_line, record.end_line);
                    if let Some(first_line) = identities.insert(identity, lineno) {
                        return Err(Error::InvalidSpanFile(format!(
                            "line {lineno}: duplicate [resolved] identity `{}` (first declared on line {first_line})",
                            record.address()
                        )));
                    }
                    records.push(record);
                }
                (&prose_lines[..idx], records)
            }
            None => (prose_lines, Vec::new()),
        };

        // A syntactically complete record in why prose is almost certainly a
        // misplaced section entry. Accepting it as prose would silently lose
        // the audit record on the next mutation, so refuse it at the boundary.
        for (idx, line) in why_lines.iter().enumerate() {
            if parse_resolved_record_line(line).is_ok() {
                return Err(Error::InvalidSpanFile(format!(
                    "line {}: [resolved] record appears before `[resolved]` marker",
                    why_first_line + idx
                )));
            }
        }

        // Trim trailing newlines (and blank lines before either structured
        // section) from why.
        let why = why_lines.join("\n").trim_end().to_string();

        Ok(SpanFile {
            anchors,
            why,
            resolved,
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
        if !self.anchors.is_empty()
            || !self.why.is_empty()
            || !self.resolved.is_empty()
            || has_config
        {
            // Blank line separator (or leading blank when no anchors).
            out.push('\n');
            if self.anchors.is_empty() {
                // With no anchor block the separator itself is two leading
                // newlines. A single leading newline only works while why is
                // one paragraph; once a structured section adds another
                // blank line, `split_once("\n\n")` would otherwise mistake
                // the why prose for anchors.
                out.push('\n');
            }
        }
        if !self.why.is_empty() {
            out.push_str(&self.why);
            out.push('\n');
        }
        if !self.resolved.is_empty() {
            if !self.why.is_empty() {
                out.push('\n');
            }
            out.push_str("[resolved]\n");
            for record in &self.resolved {
                out.push_str(&record.to_string());
                out.push('\n');
            }
        }
        if has_config {
            if !self.why.is_empty() && self.resolved.is_empty() {
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

/// A duplicate-identity group `collapse_duplicate_identities` reduced to one
/// record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CollapsedIdentity {
    /// Repository-relative, slash-separated file path of the identity.
    pub path: String,
    /// 1-based start line of the identity; 0 for whole-file anchors.
    pub start_line: u32,
    /// 1-based end line (inclusive) of the identity; 0 for whole-file anchors.
    pub end_line: u32,
    /// Record count before the collapse (the count after is always 1).
    pub records_before: usize,
    /// `Some((algorithm, content_hash))` when every record in the group
    /// already agreed on both fields — a same-line duplicate, not a
    /// divergence — so callers that force a drifted survivor must not do
    /// so here. `None` when the group actually disagreed.
    pub agreed_hash: Option<(String, String)>,
}

/// Collapse every group of records sharing a `(path, start_line, end_line)`
/// identity down to one survivor, the first record of the group in
/// canonical order.
///
/// Reorders `anchors` into canonical (path, start_line, end_line) order as
/// a side effect, even when no group collapses. The sort is a stable sort
/// over a `Vec` — never a `HashMap` — so ties within a group preserve
/// on-disk order and the same input collapses to the same survivor
/// regardless of platform or construction order.
///
/// Returns one [`CollapsedIdentity`] per group actually shrunk
/// (`records_before > 1`); single-record groups are untouched and
/// unreported. This function makes no decision about what hash a
/// divergent survivor should carry — `agreed_hash` reports whether the
/// group already agreed, and it is left to the caller to decide what to
/// do when it did not.
pub fn collapse_duplicate_identities(anchors: &mut Vec<AnchorRecord>) -> Vec<CollapsedIdentity> {
    anchors.sort_by(|a, b| {
        (a.path.as_str(), a.start_line, a.end_line).cmp(&(b.path.as_str(), b.start_line, b.end_line))
    });

    let mut collapsed = Vec::new();
    let mut survivors: Vec<AnchorRecord> = Vec::with_capacity(anchors.len());
    let mut i = 0;
    while i < anchors.len() {
        let mut j = i + 1;
        while j < anchors.len()
            && anchors[j].path == anchors[i].path
            && anchors[j].start_line == anchors[i].start_line
            && anchors[j].end_line == anchors[i].end_line
        {
            j += 1;
        }
        let group = &anchors[i..j];
        let records_before = group.len();
        if records_before > 1 {
            let first = &group[0];
            let agreed = group
                .iter()
                .all(|a| a.algorithm == first.algorithm && a.content_hash == first.content_hash);
            let agreed_hash = if agreed {
                Some((first.algorithm.clone(), first.content_hash.clone()))
            } else {
                None
            };
            collapsed.push(CollapsedIdentity {
                path: first.path.clone(),
                start_line: first.start_line,
                end_line: first.end_line,
                records_before,
                agreed_hash,
            });
        }
        survivors.push(group[0].clone());
        i = j;
    }

    *anchors = survivors;
    collapsed
}

/// Whether `a` still carries the collapse sentinel — the fixed all-`f`
/// rk64 hash [`crate::rk64_unmatched_sentinel`] plants on a survivor whose
/// content was never verified.
///
/// The value is all-`f`, **not** all-zero, and that is load-bearing rather
/// than arbitrary: `cheap_fingerprint_with_extent` returns exactly `0` for a
/// range that does not exist in the content it is handed, so an all-zero
/// sentinel would compare equal to "the anchored range is gone" and read
/// `Fresh`. [`crate::rk64_unmatched_sentinel`]'s own doc carries the full
/// argument. Ask this predicate rather than rebuilding the comparison —
/// every writer that can plant or preserve the sentinel (`drift --fix`'s
/// collapse sweep and coalescing barrier, the merge kernel's same-side
/// collapse and cross-side preserve) and every reader that must recognize
/// it (`drift` output) goes through it, so there is one place to be right.
pub fn carried_sentinel(a: &AnchorRecord) -> bool {
    a.algorithm == RK64_ALGORITHM && a.content_hash == crate::rk64_unmatched_sentinel()
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
    WholeFile {
        path_has_whitespace: bool,
        hash_is_writer_shaped: bool,
    },
    /// `<path>#L<start>-L<end> <alg>:<hash>` — a line-range anchor. Prose
    /// that merely quotes an anchor address mid-sentence lands here with
    /// `path_has_whitespace` set, because the words before the address are
    /// absorbed into the path.
    LineRange {
        path_has_whitespace: bool,
        hash_is_writer_shaped: bool,
    },
}

/// True when `hash` has the exact shape every production write site emits:
/// **sixteen lowercase hex digits**.
///
/// This is derived from the writers, not assumed. The only place an anchor's
/// content hash is produced is `content_hash: rk64_to_hex(fp)`, and
/// [`crate::rk64_to_hex`] is `format!("{fp:016x}")` — always sixteen, always
/// lowercase, zero-padded.
///
/// It deliberately names **no algorithm**. The retired `rk64` whitelist keyed
/// on the token before the colon and so would have to be revisited the day a
/// second algorithm lands; a future `blake3:<16 hex>` satisfies this predicate
/// unchanged. What it separates is a hash from an arbitrary colon-bearing
/// token: `https://example.com` (hash `//example.com`) and `rfc:1234` (hash
/// `1234`) are not hashes any writer here produced.
///
/// The invariant to hold is that **no writer-produced line is ever refused on
/// the strength of this predicate**, which is what the retired `rk64` gate
/// violated. Where a record is the thing being refused — a bare anchor found in
/// the why region — that means using it only to *narrow*, as a precondition and
/// never as a trigger: a reader that refuses because this returns true is a
/// strict subset of one that refuses without consulting it, so consulting it
/// can only permit more. Where prose is the thing being refused — a sentence
/// found in the anchor region — the same invariant reads mirrored, refusing on
/// `false`, because a line that is not writer-shaped is by construction not a
/// line a writer put there. What is never sound is refusing a `true` outside
/// the first case, which is the gate rebuilt.
fn hash_is_writer_shaped(hash: &str) -> bool {
    hash.len() == 16 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
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
    let hash_is_writer_shaped = hash_is_writer_shaped(&record.content_hash);
    if record.start_line == 0 && record.end_line == 0 {
        AnchorLineShape::WholeFile {
            path_has_whitespace,
            hash_is_writer_shaped,
        }
    } else {
        AnchorLineShape::LineRange {
            path_has_whitespace,
            hash_is_writer_shaped,
        }
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

/// Which side of a merge a same-side duplicate collapse happened on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MergeSide {
    Ours,
    Theirs,
}

/// Outcome of a structural span merge. Anchors in `merged` are in
/// canonical (path, start_line, end_line) order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpanMergeResult {
    pub merged: SpanFile,
    pub unresolved: Vec<UnresolvedAnchor>,
    /// Independent structural-region divergence. These fields deliberately
    /// do not ride an empty-path anchor sentinel: callers must know which
    /// region actually diverged so settled prose or settings are not pulled
    /// into an unrelated conflict block.
    pub conflicts: SpanMergeConflicts,
    /// Duplicate identities collapsed *within* one side's own anchors,
    /// before ours was ever compared against theirs. Reported so the
    /// collapse is named rather than silently absorbed by the index build.
    pub same_side_collapsed: Vec<(MergeSide, CollapsedIdentity)>,
    /// Identities whose record carried the duplicate-collapse sentinel and
    /// was therefore carried through unchanged instead of re-hashed.
    ///
    /// This is a return-value classification, not a third write
    /// destination: an entry here says nothing about whether the identity
    /// landed in `merged` or `unresolved`, and never changes which.
    pub sentinel_preserved: Vec<(String, u32, u32)>,
}

/// Structural span-file regions that could not be merged authoritatively.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpanMergeConflicts {
    pub why: bool,
    pub resolved: bool,
    pub config: bool,
}

impl SpanMergeConflicts {
    pub fn any(self) -> bool {
        self.why || self.resolved || self.config
    }
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
    let mut source_map: HashMap<&str, &[u8]> = HashMap::with_capacity(source_files.len());
    for (path, bytes) in source_files {
        source_map.entry(path.as_str()).or_insert(bytes.as_slice());
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

    // Collapse each side's own duplicate identities *before* the index maps
    // are built. `HashMap::insert` would otherwise keep only the last
    // same-identity record on that side, silently dropping the other before
    // the two sides are ever compared.
    let mut ours_anchors = ours.anchors.clone();
    let mut theirs_anchors = theirs.anchors.clone();
    let mut same_side_collapsed: Vec<(MergeSide, CollapsedIdentity)> = Vec::new();
    collapse_side(MergeSide::Ours, &mut ours_anchors, &mut same_side_collapsed);
    collapse_side(MergeSide::Theirs, &mut theirs_anchors, &mut same_side_collapsed);

    // Build index maps keyed by (path, start_line, end_line).
    let mut ours_map: HashMap<(&str, u32, u32), &AnchorRecord> = HashMap::new();
    let mut theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> = HashMap::new();

    for a in &ours_anchors {
        ours_map.insert((a.path.as_str(), a.start_line, a.end_line), a);
    }
    for a in &theirs_anchors {
        theirs_map.insert((a.path.as_str(), a.start_line, a.end_line), a);
    }

    let mut merged_anchors: Vec<AnchorRecord> = Vec::new();
    let mut unresolved: Vec<UnresolvedAnchor> = Vec::new();
    let mut sentinel_preserved: Vec<(String, u32, u32)> = Vec::new();

    // Process keys from ours map.
    for (&(path, start_line, end_line), o_anchor) in &ours_map {
        match theirs_map.get(&(path, start_line, end_line)) {
            None => {
                // Anchor only in ours. The sentinel check gates the whole
                // branch, not just the source-available arm — otherwise it
                // never runs for a caller that always passes no sources.
                if carried_sentinel(o_anchor) {
                    sentinel_preserved.push((path.to_string(), start_line, end_line));
                    merged_anchors.push((*o_anchor).clone());
                } else {
                    let anchor = match source_map.get(path).copied() {
                        Some(src) => rehash(o_anchor, src),
                        None => (*o_anchor).clone(),
                    };
                    merged_anchors.push(anchor);
                }
            }
            Some(t_anchor) => {
                if o_anchor.algorithm == t_anchor.algorithm
                    && o_anchor.content_hash == t_anchor.content_hash
                {
                    // Identical in both — keep one copy. Two records
                    // carrying the literal same sentinel land here and are
                    // preserved by construction; nothing is at risk.
                    merged_anchors.push((*o_anchor).clone());
                } else {
                    // Same path + extent, divergent hash.
                    let sentinel_here =
                        carried_sentinel(o_anchor) || carried_sentinel(t_anchor);
                    if sentinel_here {
                        sentinel_preserved.push((path.to_string(), start_line, end_line));
                    }
                    match source_map.get(path).copied() {
                        Some(src) => {
                            // A sentinel-bearing record is never resolved by
                            // rehashing: `rehash` recomputes at the record's
                            // *stored* coordinates, which the sentinel may be
                            // marking as stale pending a position update, so
                            // a fresh hash there would read as confirmation
                            // of content nobody verified.
                            if carried_sentinel(o_anchor) {
                                merged_anchors.push((*o_anchor).clone());
                            } else if carried_sentinel(t_anchor) {
                                merged_anchors.push((**t_anchor).clone());
                            } else {
                                // Re-hash from source → one canonical anchor.
                                merged_anchors.push(rehash(o_anchor, src));
                            }
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
            if carried_sentinel(t_anchor) {
                sentinel_preserved.push((path.to_string(), start_line, end_line));
                merged_anchors.push((*t_anchor).clone());
            } else {
                let anchor = match source_map.get(path).copied() {
                    Some(src) => rehash(t_anchor, src),
                    None => (*t_anchor).clone(),
                };
                merged_anchors.push(anchor);
            }
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

    // The two loops above walk `HashMap`s, so `sentinel_preserved` is built
    // in iteration order — sort it into the same canonical order everything
    // else in this result uses, so no map order leaks into the output.
    sentinel_preserved.sort();

    // Resolve prose, structured audit records, and config independently with
    // the same fail-closed three-way policy.
    let (why_text, why_conflict) = resolve_why_text(base, ours, theirs);
    let (resolved, resolved_conflict) = resolve_resolved_section(base, ours, theirs);
    let (config, config_conflict) = resolve_config(base, ours, theirs);
    let conflicts = SpanMergeConflicts {
        why: why_conflict,
        resolved: resolved_conflict,
        config: config_conflict,
    };

    debug_assert_merge_disjoint(&merged_anchors, &unresolved);

    SpanMergeResult {
        merged: SpanFile {
            anchors: merged_anchors,
            why: why_text,
            resolved,
            config,
        },
        unresolved,
        conflicts,
        same_side_collapsed,
        sentinel_preserved,
    }
}

/// Collapse `anchors` in place and apply the merge kernel's hash policy to
/// each survivor: the sentinel when the group disagreed, the agreed hash
/// (already on the survivor) when it did not. Appends one entry per
/// collapsed group to `out`, tagged with the side it happened on.
fn collapse_side(
    side: MergeSide,
    anchors: &mut Vec<AnchorRecord>,
    out: &mut Vec<(MergeSide, CollapsedIdentity)>,
) {
    for c in collapse_duplicate_identities(anchors) {
        if c.agreed_hash.is_none()
            && let Some(survivor) = anchors.iter_mut().find(|a| {
                a.path == c.path && a.start_line == c.start_line && a.end_line == c.end_line
            })
        {
            survivor.algorithm = RK64_ALGORITHM.to_string();
            survivor.content_hash = crate::rk64_unmatched_sentinel();
        }
        out.push((side, c));
    }
}

/// Every identity must land in `merged` **or** `unresolved`, never both:
/// `format_residue_markers` emits the first as a clean line and the second
/// as conflict markers, so an identity in both prints as a clean line *and*
/// markers for the same span — and an operator resolving the conflict by
/// deleting the markers is left with a duplicate at that identity, which is
/// the precondition state this whole mechanism exists to repair.
///
/// Factored out of [`merge_span_files`] so a test can drive the check
/// against a hand-built violating pair; no branch of the kernel can
/// construct one.
fn debug_assert_merge_disjoint(merged: &[AnchorRecord], unresolved: &[UnresolvedAnchor]) {
    #[cfg(debug_assertions)]
    {
        let merged_ids: std::collections::HashSet<(&str, u32, u32)> = merged
            .iter()
            .map(|a| (a.path.as_str(), a.start_line, a.end_line))
            .collect();
        let unresolved_ids: std::collections::HashSet<(&str, u32, u32)> = unresolved
            .iter()
            .map(|u| (u.path.as_str(), u.start_line, u.end_line))
            .collect();
        debug_assert!(
            merged_ids.is_disjoint(&unresolved_ids),
            "merge_span_files invariant violated: an identity appears in both \
             `merged` and `unresolved`"
        );
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (merged, unresolved);
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

/// Resolve the `[resolved]` sections of a three-way merge, per identity.
///
/// Mirrors [`resolve_why_text`] / [`resolve_config`]: an unchanged side
/// yields to the changed one, an identical change on both sides is kept,
/// and a divergent change fails closed (returns `diverged = true`). Union
/// semantics matter most — a record present on one branch and absent on
/// the other must survive the merge.
///
/// Returns the merged records and whether any identity diverged.
///
pub fn resolve_resolved_section(
    base: Option<&SpanFile>,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> (Vec<ResolvedRecord>, bool) {
    // A no-op merge must be byte-for-byte lossless even for an in-memory
    // `SpanFile` that did not come through the parser. The parser refuses
    // duplicate identities, but preserving identical inputs here prevents
    // this leaf helper from silently discarding a later record.
    if ours.resolved == theirs.resolved {
        return (ours.resolved.clone(), false);
    }

    type Identity = (String, u32, u32);

    fn identities(records: &[ResolvedRecord]) -> impl Iterator<Item = Identity> + '_ {
        records
            .iter()
            .map(|r| (r.path.clone(), r.start_line, r.end_line))
    }

    fn index(records: &[ResolvedRecord]) -> HashMap<(&str, u32, u32), &ResolvedRecord> {
        records
            .iter()
            .map(|record| {
                (
                    (record.path.as_str(), record.start_line, record.end_line),
                    record,
                )
            })
            .collect()
    }

    let mut keys = std::collections::BTreeSet::new();
    keys.extend(identities(&ours.resolved));
    keys.extend(identities(&theirs.resolved));
    if let Some(base) = base {
        keys.extend(identities(&base.resolved));
    }

    let ours_index = index(&ours.resolved);
    let theirs_index = index(&theirs.resolved);
    let base_index = base.map(|base| index(&base.resolved));

    let mut merged = Vec::with_capacity(keys.len());
    let mut diverged = false;
    for key in keys {
        let lookup_key = (key.0.as_str(), key.1, key.2);
        let ours_record = ours_index.get(&lookup_key).copied();
        let theirs_record = theirs_index.get(&lookup_key).copied();
        let selected = match base {
            Some(_) => {
                let base_record = base_index
                    .as_ref()
                    .and_then(|index| index.get(&lookup_key))
                    .copied();
                if ours_record == theirs_record {
                    ours_record
                } else if ours_record == base_record {
                    theirs_record
                } else if theirs_record == base_record {
                    ours_record
                } else {
                    diverged = true;
                    // The merged value is ours-biased only as residue material;
                    // the divergence flag prevents it from being presented as
                    // an authoritative clean merge.
                    ours_record
                }
            }
            None => match (ours_record, theirs_record) {
                (Some(ours), Some(theirs)) if ours != theirs => {
                    diverged = true;
                    Some(ours)
                }
                (Some(ours), _) => Some(ours),
                (None, Some(theirs)) => Some(theirs),
                (None, None) => None,
            },
        };
        if let Some(record) = selected {
            merged.push(record.clone());
        }
    }

    (merged, diverged)
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
            resolved: Vec::new(),
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
            resolved: Vec::new(),
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

    fn resolved_record(path: &str, hash: &str) -> ResolvedRecord {
        ResolvedRecord {
            timestamp: "2026-08-13T12:34:56Z".into(),
            command: ResolveCommand::Add,
            path: path.into(),
            start_line: 1,
            end_line: 5,
            algorithm: "rk64".into(),
            content_hash: hash.into(),
        }
    }

    fn resolved_span(records: Vec<ResolvedRecord>) -> SpanFile {
        SpanFile {
            anchors: Vec::new(),
            why: String::new(),
            resolved: records,
            config: SpanConfig::default(),
        }
    }

    #[test]
    fn resolved_section_roundtrips_with_why_anchors_and_config() {
        let span = SpanFile {
            anchors: vec![AnchorRecord {
                path: "src/a file.rs".into(),
                start_line: 1,
                end_line: 5,
                algorithm: "rk64".into(),
                content_hash: "abcd".into(),
            }],
            why: "human-readable reason".into(),
            resolved: vec![resolved_record("src/a file.rs", "abcd")],
            config: SpanConfig {
                copy_detection: CopyDetection::AnyFileInCommit,
                ignore_whitespace: true,
                follow_moves: false,
            },
        };
        let serialized = span.serialize();
        assert!(serialized.contains("\n[resolved]\n"), "{serialized}");
        assert!(serialized.find("[resolved]").unwrap() < serialized.find("[config]").unwrap());
        assert_eq!(SpanFile::parse(&serialized).unwrap(), span);
    }

    #[test]
    fn resolved_section_roundtrips_without_why_or_config() {
        let span = resolved_span(vec![resolved_record("src/a file.rs", "abcd")]);
        let serialized = span.serialize();
        assert_eq!(SpanFile::parse(&serialized).unwrap(), span);
    }

    #[test]
    fn resolved_section_roundtrips_with_why_and_without_config() {
        let mut span = resolved_span(vec![resolved_record("a.rs", "abcd")]);
        span.why = "why prose".into();
        assert_eq!(SpanFile::parse(&span.serialize()).unwrap(), span);
    }

    #[test]
    fn sectionless_files_keep_empty_resolved_and_roundtrip() {
        let input = "a.rs#L1-L5 rk64:abcd\n\nwhy prose\n";
        let span = SpanFile::parse(input).unwrap();
        assert!(span.resolved.is_empty());
        assert_eq!(SpanFile::parse(&span.serialize()).unwrap(), span);
    }

    #[test]
    fn resolved_section_failures_name_the_source_line() {
        let bad = [
            ("2026-08-13 12:34:56Z add a.rs#L1-L5 rk64:abcd", "timestamp"),
            ("2026-08-13T12:34:56Z move a.rs#L1-L5 rk64:abcd", "unknown command"),
            ("2026-08-13T12:34:56Z add a.rs#L1-L5 abcd", "hash"),
            ("2026-08-13T12:34:56Z add a.rs#L0-L5 rk64:abcd", "address"),
        ];
        for (line, expected) in bad {
            let input = format!("a.rs#L1-L5 rk64:abcd\n\nwhy\n[resolved]\n{line}\n");
            let err = SpanFile::parse(&input).unwrap_err().to_string();
            assert!(err.contains("line 5"), "{err}");
            assert!(err.contains(expected), "{err}");
        }
    }

    #[test]
    fn resolved_section_rejects_blank_lines_and_misordering() {
        let blank = "a.rs rk64:abcd\n\n[resolved]\n2026-08-13T12:34:56Z add a.rs rk64:abcd\n\n2026-08-13T12:35:56Z add b.rs rk64:ef01\n";
        let err = SpanFile::parse(blank).unwrap_err().to_string();
        assert!(err.contains("line 5") && err.contains("blank line"), "{err}");

        let after_config = "a.rs rk64:abcd\n\n[config]\nfollow_moves = true\n[resolved]\n2026-08-13T12:34:56Z add a.rs rk64:abcd\n";
        let err = SpanFile::parse(after_config).unwrap_err().to_string();
        assert!(err.contains("line 5") && err.contains("[resolved]"), "{err}");
    }

    #[test]
    fn resolved_section_rejects_duplicate_identities_at_the_second_line() {
        let input = "a.rs rk64:abcd\n\nwhy\n[resolved]\n2026-08-13T12:34:56Z add a.rs rk64:abcd\n2026-08-13T12:35:56Z replace a.rs rk64:ef01\n";
        let err = SpanFile::parse(input).unwrap_err().to_string();
        assert!(err.contains("line 6"), "{err}");
        assert!(err.contains("duplicate") && err.contains("a.rs"), "{err}");
        assert!(err.contains("line 5"), "{err}");
    }

    #[test]
    fn indented_resolved_marker_remains_why_prose() {
        let input = "a.rs rk64:abcd\n\nwhy\n    [resolved]\nstill why\n";
        let span = SpanFile::parse(input).unwrap();
        assert!(span.resolved.is_empty());
        assert_eq!(span.why, "why\n    [resolved]\nstill why");
    }

    #[test]
    fn resolved_record_before_marker_and_marker_collision_fail_closed() {
        let misplaced = "a.rs rk64:abcd\n\nwhy\n2026-08-13T12:34:56Z add a.rs rk64:abcd\n";
        let err = SpanFile::parse(misplaced).unwrap_err().to_string();
        assert!(err.contains("line 4") && err.contains("before `[resolved]`"), "{err}");

        let collision = "a.rs rk64:abcd\n\nordinary prose\n[resolved]\nstill ordinary prose\n";
        let err = SpanFile::parse(collision).unwrap_err().to_string();
        assert!(err.contains("line 5") && err.contains("[resolved]"), "{err}");
    }

    #[test]
    fn resolved_section_does_not_leak_into_why() {
        let input = "a.rs#L1-L5 rk64:abcd\n\nwhy line one\nwhy line two\n[resolved]\n2026-08-13T12:34:56Z add a.rs#L1-L5 rk64:abcd\n";
        let span = SpanFile::parse(input).unwrap();
        assert_eq!(span.why, "why line one\nwhy line two");
        assert_eq!(span.resolved, vec![resolved_record("a.rs", "abcd")]);
    }

    #[test]
    fn resolve_resolved_section_obeys_three_way_changes() {
        let base_record = resolved_record("a.rs", "base");
        let ours_record = resolved_record("a.rs", "ours");
        let theirs_record = resolved_record("a.rs", "theirs");
        let base = resolved_span(vec![base_record.clone()]);

        let unchanged = resolved_span(vec![base_record.clone()]);
        let ours_changed = resolved_span(vec![ours_record.clone()]);
        assert_eq!(
            resolve_resolved_section(Some(&base), &ours_changed, &unchanged),
            (vec![ours_record.clone()], false)
        );
        assert_eq!(
            resolve_resolved_section(Some(&base), &unchanged, &resolved_span(vec![theirs_record.clone()])),
            (vec![theirs_record.clone()], false)
        );
        assert_eq!(
            resolve_resolved_section(Some(&base), &ours_changed, &ours_changed),
            (vec![ours_record.clone()], false)
        );
        assert_eq!(
            resolve_resolved_section(
                Some(&base),
                &ours_changed,
                &resolved_span(vec![theirs_record])
            ),
            (vec![ours_record], true)
        );
    }

    #[test]
    fn resolve_resolved_section_unions_one_sided_records_without_a_base() {
        let ours = resolved_span(vec![resolved_record("a.rs", "aaaa")]);
        let theirs = resolved_span(vec![resolved_record("b.rs", "bbbb")]);
        let (records, diverged) = resolve_resolved_section(None, &ours, &theirs);
        assert!(!diverged);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].path, "a.rs");
        assert_eq!(records[1].path, "b.rs");
    }

    #[test]
    fn resolve_resolved_section_fails_closed_on_no_base_divergence() {
        let ours = resolved_span(vec![resolved_record("a.rs", "ours")]);
        let theirs = resolved_span(vec![resolved_record("a.rs", "theirs")]);
        let (records, diverged) = resolve_resolved_section(None, &ours, &theirs);
        assert!(diverged);
        assert_eq!(records, ours.resolved);
    }

    #[test]
    fn resolve_resolved_section_noop_preserves_every_input_record() {
        let first = resolved_record("a.rs", "first");
        let mut second = resolved_record("a.rs", "second");
        second.timestamp = "2026-08-13T12:35:56Z".into();
        second.command = ResolveCommand::Replace;
        let span = resolved_span(vec![first, second]);

        let (records, diverged) = resolve_resolved_section(Some(&span), &span, &span);
        assert!(!diverged);
        assert_eq!(records, span.resolved);
    }

    #[test]
    fn resolve_resolved_section_unions_large_disjoint_sides_in_identity_order() {
        let ours = resolved_span(
            (0..2_000)
                .map(|i| resolved_record(&format!("ours-{i:04}.rs"), "ours"))
                .collect(),
        );
        let theirs = resolved_span(
            (0..2_000)
                .map(|i| resolved_record(&format!("theirs-{i:04}.rs"), "theirs"))
                .collect(),
        );
        let base = resolved_span(Vec::new());

        let (records, diverged) = resolve_resolved_section(Some(&base), &ours, &theirs);

        assert!(!diverged);
        assert_eq!(records.len(), 4_000);
        assert!(records.windows(2).all(|pair| pair[0].path < pair[1].path));
    }

    #[test]
    fn merge_span_files_signals_resolved_section_divergence() {
        let base = resolved_span(vec![resolved_record("a.rs", "base")]);
        let ours = resolved_span(vec![resolved_record("a.rs", "ours")]);
        let theirs = resolved_span(vec![resolved_record("a.rs", "theirs")]);
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        assert!(result.conflicts.resolved);
        assert!(!result.conflicts.why && !result.conflicts.config);
        assert!(result.unresolved.is_empty());
        assert_eq!(result.merged.resolved, ours.resolved);
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
        let ours = SpanFile { anchors: vec![a.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![b.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let ours = SpanFile { anchors: vec![anchor.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![anchor.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let ours = SpanFile { anchors: vec![ours_anchor], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![theirs_anchor], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        // Source file available for re-hashing — should resolve to one anchor.
        let source = vec![("a.txt".into(), b"hello\nworld\n".to_vec())];
        let result = merge_span_files(None, &ours, &theirs, &source);
        assert_eq!(result.merged.anchors.len(), 1);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_duplicate_source_paths_use_first_entry() {
        let ours_anchor = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 2,
            algorithm: "rk64".into(), content_hash: "abc123".into(),
        };
        let theirs_anchor = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 2,
            algorithm: "rk64".into(), content_hash: "def456".into(),
        };
        let ours = span_of(vec![ours_anchor]);
        let theirs = span_of(vec![theirs_anchor]);
        let first = b"first\nsource\n".to_vec();
        let second = b"second\nsource\n".to_vec();
        let source = vec![("a.txt".into(), first.clone()), ("a.txt".into(), second)];

        let result = merge_span_files(None, &ours, &theirs, &source);

        let expected = rk64_to_hex(cheap_fingerprint_with_extent(
            &first,
            &AnchorExtent::LineRange { start: 1, end: 2 },
        ));
        assert_eq!(result.merged.anchors[0].content_hash, expected);
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
        let ours = SpanFile { anchors: vec![ours_anchor.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![theirs_anchor.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // No source to re-hash — anchor listed as unresolved.
        assert_eq!(result.unresolved.len(), 1);
        assert_eq!(result.unresolved[0].path, "x.txt");
        assert_eq!(result.unresolved[0].start_line, 2);
        assert_eq!(result.unresolved[0].end_line, 4);
        assert_eq!(result.unresolved[0].ours, ours_anchor);
        assert_eq!(result.unresolved[0].theirs, theirs_anchor);
    }

    // -----------------------------------------------------------------------
    // merge kernel: same-side collapse and sentinel preservation
    // -----------------------------------------------------------------------

    fn span_of(anchors: Vec<AnchorRecord>) -> SpanFile {
        SpanFile { anchors, why: String::new(), config: SpanConfig::default(), resolved: Vec::new() }
    }

    fn sentinel_anchor(path: &str, start: u32, end: u32) -> AnchorRecord {
        anchor(path, start, end, RK64_ALGORITHM, &crate::rk64_unmatched_sentinel())
    }

    fn merged_at<'a>(
        result: &'a SpanMergeResult,
        path: &str,
        start: u32,
        end: u32,
    ) -> Vec<&'a AnchorRecord> {
        result
            .merged
            .anchors
            .iter()
            .filter(|a| a.path == path && a.start_line == start && a.end_line == end)
            .collect()
    }

    #[test]
    fn merge_collapses_ours_side_duplicate_instead_of_dropping_it() {
        // Ours carries an unrepaired duplicate for one identity; theirs has
        // a single, identical-to-neither record for the same identity.
        let ours = span_of(vec![
            anchor("a.txt", 1, 2, "rk64", "aaaa"),
            anchor("a.txt", 1, 2, "rk64", "bbbb"),
        ]);
        let theirs = span_of(vec![anchor("a.txt", 1, 2, "rk64", "cccc")]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        // The same-side collapse is named, not silently absorbed by the
        // index build's last-write-wins insert.
        assert_eq!(result.same_side_collapsed.len(), 1);
        let (side, collapsed) = &result.same_side_collapsed[0];
        assert_eq!(*side, MergeSide::Ours);
        assert_eq!(collapsed.path, "a.txt");
        assert_eq!(collapsed.records_before, 2);
        assert_eq!(collapsed.agreed_hash, None);

        // The divergent survivor carries the sentinel, so the cross-side
        // comparison sees it and reports the preservation.
        assert_eq!(
            result.sentinel_preserved,
            vec![("a.txt".to_string(), 1, 2)]
        );
        // No source to adjudicate the cross-side divergence: still unresolved.
        assert_eq!(result.unresolved.len(), 1);
        assert_eq!(
            result.unresolved[0].ours.content_hash,
            crate::rk64_unmatched_sentinel()
        );
        assert!(merged_at(&result, "a.txt", 1, 2).is_empty());
    }

    #[test]
    fn merge_collapses_theirs_side_duplicate_with_no_counterpart() {
        // Theirs carries the duplicate; ours has nothing at that identity.
        let ours = span_of(vec![anchor("other.txt", 1, 1, "rk64", "zzzz")]);
        let theirs = span_of(vec![
            anchor("b.txt", 4, 6, "rk64", "aaaa"),
            anchor("b.txt", 4, 6, "rk64", "bbbb"),
        ]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        assert_eq!(result.same_side_collapsed.len(), 1);
        assert_eq!(result.same_side_collapsed[0].0, MergeSide::Theirs);
        assert_eq!(result.same_side_collapsed[0].1.records_before, 2);

        // Exactly one record survives — the other is not silently dropped
        // without a report, and not duplicated into the merged output.
        let survivors = merged_at(&result, "b.txt", 4, 6);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, crate::rk64_unmatched_sentinel());
        assert_eq!(result.sentinel_preserved, vec![("b.txt".to_string(), 4, 6)]);
    }

    #[test]
    fn merge_same_side_identical_duplicate_keeps_agreed_hash() {
        // A verbatim-repeated line is a same-line duplicate, not a
        // divergence: it is deduplicated and reported, but never forced to
        // the sentinel — that would manufacture drift for content that was
        // never in doubt.
        let ours = span_of(vec![
            anchor("c.txt", 2, 3, "rk64", "abcd"),
            anchor("c.txt", 2, 3, "rk64", "abcd"),
        ]);
        let theirs = span_of(vec![]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        assert_eq!(result.same_side_collapsed.len(), 1);
        assert_eq!(
            result.same_side_collapsed[0].1.agreed_hash,
            Some(("rk64".to_string(), "abcd".to_string()))
        );
        let survivors = merged_at(&result, "c.txt", 2, 3);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, "abcd");
        assert!(result.sentinel_preserved.is_empty());
    }

    #[test]
    fn merge_preserves_sentinel_on_ours_against_real_theirs_hash() {
        let ours = span_of(vec![sentinel_anchor("a.txt", 1, 2)]);
        let theirs = span_of(vec![anchor("a.txt", 1, 2, "rk64", "realhash")]);
        let source = vec![("a.txt".to_string(), b"hello\nworld\n".to_vec())];
        let result = merge_span_files(None, &ours, &theirs, &source);

        // Source is available, so pre-preserve this would have been
        // rehashed. It must not be: the survivor still carries the sentinel
        // at untouched coordinates, and the real hash is discarded.
        let survivors = merged_at(&result, "a.txt", 1, 2);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, crate::rk64_unmatched_sentinel());
        assert_eq!(survivors[0].algorithm, RK64_ALGORITHM);
        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 1, 2)]);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_preserves_sentinel_on_theirs_against_real_ours_hash() {
        // The discriminating direction: a guard that only inspected
        // `o_anchor` would rehash this one away.
        let ours = span_of(vec![anchor("a.txt", 1, 2, "rk64", "realhash")]);
        let theirs = span_of(vec![sentinel_anchor("a.txt", 1, 2)]);
        let source = vec![("a.txt".to_string(), b"hello\nworld\n".to_vec())];
        let result = merge_span_files(None, &ours, &theirs, &source);

        let survivors = merged_at(&result, "a.txt", 1, 2);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, crate::rk64_unmatched_sentinel());
        assert_eq!(survivors[0].start_line, 1);
        assert_eq!(survivors[0].end_line, 2);
        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 1, 2)]);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_reports_sentinel_with_empty_source_files_ours_only() {
        // `merge_driver.rs` always passes `&[]`, so a sentinel check nested
        // inside the source-available arm would never run for it.
        let ours = span_of(vec![sentinel_anchor("a.txt", 1, 2)]);
        let theirs = span_of(vec![]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 1, 2)]);
        let survivors = merged_at(&result, "a.txt", 1, 2);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, crate::rk64_unmatched_sentinel());
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_reports_sentinel_with_empty_source_files_theirs_only() {
        let ours = span_of(vec![]);
        let theirs = span_of(vec![sentinel_anchor("b.txt", 3, 4)]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        assert_eq!(result.sentinel_preserved, vec![("b.txt".to_string(), 3, 4)]);
        let survivors = merged_at(&result, "b.txt", 3, 4);
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].content_hash, crate::rk64_unmatched_sentinel());
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_sentinel_divergent_without_source_stays_only_in_unresolved() {
        // `sentinel_preserved` is a classification, never a second write:
        // this identity is in `unresolved` and must appear nowhere in
        // `merged`, or the residue writer would emit both a clean line and
        // conflict markers for it.
        let ours = span_of(vec![sentinel_anchor("a.txt", 1, 2)]);
        let theirs = span_of(vec![anchor("a.txt", 1, 2, "rk64", "realhash")]);
        let result = merge_span_files(None, &ours, &theirs, &[]);

        assert_eq!(result.unresolved.len(), 1);
        assert_eq!(result.unresolved[0].path, "a.txt");
        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 1, 2)]);
        assert!(merged_at(&result, "a.txt", 1, 2).is_empty());
    }

    #[test]
    #[should_panic(expected = "merge_span_files invariant violated")]
    fn merge_disjointness_invariant_fires_on_a_violating_pair() {
        // No branch of the kernel can construct this, so the guard is driven
        // directly — proving it actually fires rather than only existing.
        let record = anchor("a.txt", 1, 2, "rk64", "aaaa");
        let unresolved = vec![UnresolvedAnchor {
            path: "a.txt".into(),
            start_line: 1,
            end_line: 2,
            ours: record.clone(),
            theirs: anchor("a.txt", 1, 2, "rk64", "bbbb"),
        }];
        debug_assert_merge_disjoint(std::slice::from_ref(&record), &unresolved);
    }

    #[test]
    fn merge_never_rehashes_a_sentinel_at_stale_coordinates() {
        // §3's re-anchor guard can leave a collapsed survivor's coordinates
        // stale pending a later position update, marked only by the sentinel
        // sitting there. Source now holds the true content two lines lower.
        let stale = sentinel_anchor("a.txt", 1, 2);
        let ours = span_of(vec![stale.clone()]);
        let theirs = span_of(vec![]);
        let new_content = b"// header\n// header\nreal one\nreal two\n".to_vec();
        let source = vec![("a.txt".to_string(), new_content.clone())];
        let result = merge_span_files(None, &ours, &theirs, &source);

        let survivors = merged_at(&result, "a.txt", 1, 2);
        assert_eq!(survivors.len(), 1);
        // Neither a hash of the new location nor of the stale one: no
        // rehash of any kind may run while the sentinel is present.
        assert_eq!(*survivors[0], stale);
        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 1, 2)]);

        // The regression guard: what the pre-preserve design would have
        // written. Hashing the *stale* range against the new source yields a
        // real hash that matches the content now sitting at those
        // coordinates — a false `Fresh` reading for an anchor whose owed
        // relocation nothing in the file would still record.
        let stale_range = AnchorExtent::LineRange { start: 1, end: 2 };
        let would_have_written =
            rk64_to_hex(cheap_fingerprint_with_extent(&new_content, &stale_range));
        assert_ne!(would_have_written, crate::rk64_unmatched_sentinel());
        let true_range = AnchorExtent::LineRange { start: 3, end: 4 };
        let true_content_hash =
            rk64_to_hex(cheap_fingerprint_with_extent(&new_content, &true_range));
        assert_ne!(would_have_written, true_content_hash);
    }

    #[test]
    fn merge_never_rehashes_a_sentinel_shifted_by_an_edit_above_it() {
        // The ordinary member of the deferred population: lines inserted
        // above the anchor shift its range, no relocation involved.
        let stale = sentinel_anchor("a.txt", 2, 3);
        let ours = span_of(vec![anchor("keep.txt", 1, 1, "rk64", "kkkk")]);
        let theirs = span_of(vec![stale.clone()]);
        let shifted = b"use a;\nuse b;\nuse c;\nbody one\nbody two\n".to_vec();
        let source = vec![("a.txt".to_string(), shifted)];
        let result = merge_span_files(None, &ours, &theirs, &source);

        let survivors = merged_at(&result, "a.txt", 2, 3);
        assert_eq!(survivors.len(), 1);
        assert_eq!(*survivors[0], stale);
        assert_eq!(result.sentinel_preserved, vec![("a.txt".to_string(), 2, 3)]);
    }

    // -----------------------------------------------------------------------
    // collapse_duplicate_identities
    // -----------------------------------------------------------------------

    fn anchor(path: &str, start: u32, end: u32, algorithm: &str, hash: &str) -> AnchorRecord {
        AnchorRecord {
            path: path.into(),
            start_line: start,
            end_line: end,
            algorithm: algorithm.into(),
            content_hash: hash.into(),
        }
    }

    #[test]
    fn collapse_two_divergent_records_to_one() {
        let mut anchors = vec![
            anchor("a.rs", 1, 3, "rk64", "1111"),
            anchor("a.rs", 1, 3, "rk64", "2222"),
        ];
        let collapsed = collapse_duplicate_identities(&mut anchors);
        assert_eq!(anchors.len(), 1);
        assert_eq!(collapsed.len(), 1);
        assert_eq!(collapsed[0].path, "a.rs");
        assert_eq!(collapsed[0].start_line, 1);
        assert_eq!(collapsed[0].end_line, 3);
        assert_eq!(collapsed[0].records_before, 2);
        assert_eq!(collapsed[0].agreed_hash, None);
    }

    #[test]
    fn collapse_three_records_to_one() {
        let mut anchors = vec![
            anchor("b.rs", 5, 10, "rk64", "1111"),
            anchor("b.rs", 5, 10, "rk64", "2222"),
            anchor("b.rs", 5, 10, "rk64", "3333"),
        ];
        let collapsed = collapse_duplicate_identities(&mut anchors);
        assert_eq!(anchors.len(), 1);
        assert_eq!(collapsed.len(), 1);
        assert_eq!(collapsed[0].records_before, 3);
        assert_eq!(collapsed[0].agreed_hash, None);
    }

    #[test]
    fn collapse_no_op_without_duplicates() {
        let mut anchors = vec![
            anchor("a.rs", 1, 3, "rk64", "1111"),
            anchor("b.rs", 5, 10, "rk64", "2222"),
        ];
        let before = anchors.clone();
        let collapsed = collapse_duplicate_identities(&mut anchors);
        assert!(collapsed.is_empty());
        assert_eq!(anchors.len(), 2);
        // Order is canonicalized even on a no-op call; both inputs were
        // already distinct identities in canonical order here.
        assert_eq!(anchors, before);
    }

    #[test]
    fn collapse_survivor_deterministic_regardless_of_input_order() {
        // Two distinct identities, each with its own duplicate pair, given
        // to the function in opposite overall (inter-group) order. Within
        // each group the relative (on-disk) order of its own records is
        // preserved identically in both constructions, so — per the
        // documented stable-sort contract, which keeps the first record of
        // each group in on-disk order — the survivor chosen for each
        // identity does not depend on which identity's records happened to
        // be constructed first in the input Vec, only on the fixed,
        // deterministic (path, start_line, end_line) sort key and each
        // group's own internal order. This is the property that makes the
        // primitive safe to call on a Vec sourced from anywhere (never a
        // HashMap, whose iteration order is randomized per process).
        let mut order_a_first = vec![
            anchor("a.rs", 1, 3, "rk64", "a-1111"),
            anchor("a.rs", 1, 3, "rk64", "a-2222"),
            anchor("b.rs", 5, 10, "rk64", "b-1111"),
            anchor("b.rs", 5, 10, "rk64", "b-2222"),
        ];
        let mut order_b_first = vec![
            anchor("b.rs", 5, 10, "rk64", "b-1111"),
            anchor("b.rs", 5, 10, "rk64", "b-2222"),
            anchor("a.rs", 1, 3, "rk64", "a-1111"),
            anchor("a.rs", 1, 3, "rk64", "a-2222"),
        ];
        let collapsed_a = collapse_duplicate_identities(&mut order_a_first);
        let collapsed_b = collapse_duplicate_identities(&mut order_b_first);
        assert_eq!(order_a_first, order_b_first);
        assert_eq!(order_a_first[0].content_hash, "a-1111");
        assert_eq!(order_a_first[1].content_hash, "b-1111");
        assert_eq!(collapsed_a.len(), 2);
        assert_eq!(collapsed_b.len(), 2);
        assert_eq!(collapsed_a, collapsed_b);
    }

    #[test]
    fn collapse_agreed_hash_some_on_identical_duplicate() {
        let mut anchors = vec![
            anchor("a.rs", 1, 3, "rk64", "1111"),
            anchor("a.rs", 1, 3, "rk64", "1111"),
        ];
        let collapsed = collapse_duplicate_identities(&mut anchors);
        assert_eq!(collapsed.len(), 1);
        assert_eq!(
            collapsed[0].agreed_hash,
            Some(("rk64".to_string(), "1111".to_string()))
        );
    }

    #[test]
    fn collapse_agreed_hash_none_on_divergent_duplicate() {
        let mut anchors = vec![
            anchor("a.rs", 1, 3, "rk64", "1111"),
            anchor("a.rs", 1, 3, "rk64", "2222"),
        ];
        let collapsed = collapse_duplicate_identities(&mut anchors);
        assert_eq!(collapsed.len(), 1);
        assert_eq!(collapsed[0].agreed_hash, None);
    }

    #[test]
    fn carried_sentinel_detects_sentinel_and_only_sentinel() {
        let sentinel = crate::rk64_unmatched_sentinel();
        let sentinel_anchor = anchor("a.rs", 1, 3, RK64_ALGORITHM, &sentinel);
        assert!(carried_sentinel(&sentinel_anchor));

        let real_hash_anchor = anchor("a.rs", 1, 3, RK64_ALGORITHM, "deadbeef");
        assert!(!carried_sentinel(&real_hash_anchor));

        let wrong_algorithm_anchor = anchor("a.rs", 1, 3, "sha256", &sentinel);
        assert!(!carried_sentinel(&wrong_algorithm_anchor));
    }

    #[test]
    fn merge_why_ours_changed() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let base = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "common why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let base = SpanFile { anchors: vec![a.clone()], why: "original why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "new why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "new why".into(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let base = SpanFile { anchors: vec![a.clone()], why: "base why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let result = merge_span_files(Some(&base), &ours, &theirs, &[]);
        // Both sides changed why differently from base — fail closed.
        assert!(result.conflicts.why);
        assert!(result.unresolved.is_empty());
    }

    #[test]
    fn merge_why_neither_changed() {
        let a = AnchorRecord {
            path: "a.txt".into(), start_line: 1, end_line: 3,
            algorithm: "rk64".into(), content_hash: "1111".into(),
        };
        let base = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let ours = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "stable why".into(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let ours = SpanFile { anchors: vec![a.clone()], why: "ours why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: "theirs why".into(), config: SpanConfig::default(), resolved: Vec::new() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // No base span and divergent why — fail closed.
        assert!(result.conflicts.why);
        assert!(result.unresolved.is_empty());
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
        let ours = SpanFile { anchors: vec![z, a_later], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![a.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
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
        let ours = SpanFile { anchors: vec![whole.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let theirs = SpanFile { anchors: vec![line.clone()], why: String::new(), config: SpanConfig::default(), resolved: Vec::new() };
        let result = merge_span_files(None, &ours, &theirs, &[]);
        // Whole-file and line-range anchors both preserved.
        assert_eq!(result.merged.anchors.len(), 2);
        assert!(result.merged.anchors.contains(&whole));
        assert!(result.merged.anchors.contains(&line));
        assert!(result.unresolved.is_empty());
    }
}
