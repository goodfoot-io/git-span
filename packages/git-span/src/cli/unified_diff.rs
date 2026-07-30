//! Unified-diff *text* renderer, shared by two dialects of `git span
//! history` patch: ordinary blob diffs of a `.span/<name>` declaration
//! file, and "anchor pseudo-diffs" whose paths are `path#Lstart-Lend`
//! addresses, whose `index` lines carry `rk64:` content hashes, and whose
//! hunk headers use the anchor's real file coordinates (a hunk at
//! snapshot-relative line `k` renders at `first_line + k - 1`).
//!
//! Declaration blob diffs speak git's own dialect exactly — `new file
//! mode` / `deleted file mode` lines, the real path on both `diff --git`
//! sides, a bare `index old..new` on add/delete and the `100644` mode
//! suffix only on a modification — so a consumer can feed the patch to
//! `git apply`. Anchor pseudo-diffs deliberately diverge (`new anchor` /
//! `deleted anchor`, `a/dev/null`) because an anchor is a range inside a
//! file, not a file.
//!
//! [`compute_hunks_from_bytes()`](crate::resolver::layers::diff) computes
//! `-U0` hunk tuples for stale-matching, optimized for match precision —
//! this module is display-only and drives the same `gix::diff::blob`
//! Histogram (imara-diff) engine independently, assembling its own `-U3`
//! context-merged hunks via `gix::diff::blob::unified_diff::UnifiedDiff`.
//! Do not call or reuse `compute_hunks_from_bytes()` from here: it stays
//! tuned for `-U0` stale-matching, this module owns all patch-text
//! production.

use gix::diff::blob::sources::byte_lines;
use gix::diff::blob::unified_diff::{ConsumeHunk, ContextSize, DiffLineKind, HunkHeader};
use gix::diff::blob::{Algorithm, Diff, InternedInput, UnifiedDiff};

/// Display label used for a `/dev/null` side of an *anchor* pseudo-diff (an
/// added or deleted anchor). [`DiffSide::label`] equal to this sentinel
/// selects `/dev/null` rendering conventions for that side, including on
/// the `diff --git` line. Blob diffs never use it: git names the real path
/// on both `diff --git` sides even for an add or a delete.
pub const DEV_NULL: &str = "dev/null";

/// The all-zero hash callers pass as [`DiffHeader::Anchor::old_hash`] /
/// `new_hash` for the `/dev/null` side of an added or deleted anchor, and
/// for a side whose content is unavailable. It renders bare (no `rk64:`
/// prefix), matching git's null-OID convention.
pub const NULL_ANCHOR_HASH: &str = "0000000000000000";

/// The abbreviated null blob OID git prints on the absent side of an
/// `index` line for an added or deleted file.
pub const NULL_BLOB_OID7: &str = "0000000";

/// Marker line naming the one reason a diff block stops at its header: the
/// old side's recorded bytes are not recoverable from history, so there is no
/// honest "before" text to build hunks from.
///
/// It lives in the header — beside `proposed anchor <address>` and the rename
/// lines — rather than being appended by the human renderer, because the JSON
/// `diff` string and the default output's block are byte-identical by
/// contract. A marker only one of them carried would break that, and the
/// state would stay invisible in exactly the surface that needs the
/// explanation.
pub const RECORDED_UNRECOVERABLE: &str = "recorded snapshot unrecoverable";

/// Header dialect for one rendered file diff.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffHeader {
    /// Ordinary declaration-file diff, in git's own dialect: `index
    /// <old7>..<new7> 100644` for a modification, `new file mode 100644` /
    /// `deleted file mode 100644` plus a bare `index <old7>..<new7>` for an
    /// add or a delete.
    Blob {
        /// Old blob OID abbreviated to 7 hex characters, or
        /// [`NULL_BLOB_OID7`] when the file did not exist.
        old_oid7: String,
        /// New blob OID abbreviated to 7 hex characters, or
        /// [`NULL_BLOB_OID7`] when the file no longer exists.
        new_oid7: String,
        /// Which git file-status header lines accompany the `index` line.
        kind: BlobDiffKind,
    },
    /// Anchor pseudo-diff: `index rk64:old..rk64:new`, optional rename
    /// headers with a genuinely computed similarity, or the `new anchor`
    /// / `deleted anchor` lines replacing git's mode lines.
    Anchor {
        /// Old snapshot's `rk64:` extent hash. [`NULL_ANCHOR_HASH`] for a
        /// [`AnchorDiffKind::New`] or an unavailable side (rendered
        /// without the `rk64:` prefix, matching git's null-OID convention).
        old_hash: String,
        /// New snapshot's `rk64:` extent hash. [`NULL_ANCHOR_HASH`] for a
        /// [`AnchorDiffKind::Deleted`] or an unavailable side.
        new_hash: String,
        /// Which header lines accompany the `index` line.
        kind: AnchorDiffKind,
    },
}

/// Which git file-status header lines accompany a [`DiffHeader::Blob`]'s
/// `index` line. Git signals an add or a delete with a mode line and drops
/// the mode suffix from `index`; a mode-unchanged modification carries the
/// suffix and no mode line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlobDiffKind {
    /// The file did not exist on the old side: `new file mode 100644`.
    Added,
    /// The file exists on both sides with an unchanged mode.
    Modified,
    /// The file does not exist on the new side: `deleted file mode 100644`.
    Deleted,
}

/// Which header lines accompany an [`DiffHeader::Anchor`]'s `index` line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnchorDiffKind {
    /// Address unchanged, content changed. No extra header lines.
    Modify,
    /// Address changed (paired by identical content or by similarity, not
    /// by exact address match). `similarity index NN%` / `rename from` /
    /// `rename to` header lines. Hunks are present only when content also
    /// changed — a pure move renders the header block alone.
    Rename {
        /// Git-shaped similarity percentage between the paired snapshots,
        /// as computed by [`similarity()`].
        similarity: u8,
    },
    /// Address unchanged, but the resolver believes the anchored content
    /// now lives elsewhere. `proposed anchor <address>` header line —
    /// deliberately *not* git's `rename to`, because nothing has moved:
    /// the declaration still says what it said, and this is what
    /// `git span stale --fix` would write. Hunks appear only when the
    /// content changed as well.
    Proposed {
        /// The address the resolver proposes.
        address: String,
    },
    /// The anchor did not exist in the old state. `new anchor` header
    /// line; old side renders with `/dev/null` conventions.
    New,
    /// The anchor does not exist in the new state. `deleted anchor`
    /// header line; new side renders with `/dev/null` conventions.
    Deleted,
}

/// Whether a side has renderable content, and if not, why.
///
/// Unavailability is *structural*: a side that cannot be read renders as a
/// genuinely absent side (or, for binary content, as git's `Binary files
/// … differ` line). Substituting explanatory prose into the body would
/// corrupt hunk arithmetic and paint the placeholder as source.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideState {
    /// [`DiffSide::text`] is the side's real content.
    Present,
    /// The side has no content at this point (the file is absent, or the
    /// declared line range lies past end of file). Renders exactly like a
    /// `/dev/null` side: zero-length, `-0,0`/`+0,0` coordinates, and a
    /// `/dev/null` label on the `---`/`+++` line.
    Absent,
    /// The side's content exists but is not text. Suppresses hunks in
    /// favour of git's `Binary files a/<old> and b/<new> differ` line.
    Binary,
}

/// One side of a diff: display label, text, and the 1-based coordinate of
/// the text's first line in its real file (so hunk headers carry real
/// file coordinates rather than snapshot-relative ones).
///
/// A side representing the `/dev/null` half of an added or deleted
/// *anchor* uses the literal label [`DEV_NULL`] (no `a/`/`b/` prefix, no
/// leading slash — those are applied by the renderer per-context).
/// `first_line` is ignored for a `/dev/null` or [`SideState::Absent`] side.
pub struct DiffSide<'a> {
    /// Display label: `path#Lstart-Lend`, a plain repo-relative path (for
    /// [`DiffHeader::Blob`]), or the sentinel [`DEV_NULL`].
    pub label: String,
    /// The side's full text content. Ignored unless `state` is
    /// [`SideState::Present`].
    pub text: &'a str,
    /// 1-based line number, in the side's real file, of `text`'s first
    /// line. Ignored for a `/dev/null` or absent side.
    pub first_line: u32,
    /// Whether `text` is renderable content.
    pub state: SideState,
}

impl<'a> DiffSide<'a> {
    /// A side with real, renderable content.
    pub fn present(label: impl Into<String>, text: &'a str, first_line: u32) -> Self {
        DiffSide {
            label: label.into(),
            text,
            first_line,
            state: SideState::Present,
        }
    }

    /// A side that carries a label but no content — the file is absent, or
    /// the declared range lies past end of file. Renders as `/dev/null`.
    pub fn absent(label: impl Into<String>) -> Self {
        DiffSide {
            label: label.into(),
            text: "",
            first_line: 1,
            state: SideState::Absent,
        }
    }

    /// A side whose content is not text. Suppresses hunks in favour of
    /// git's `Binary files … differ` line.
    pub fn binary(label: impl Into<String>) -> Self {
        DiffSide {
            label: label.into(),
            text: "",
            first_line: 1,
            state: SideState::Binary,
        }
    }

    /// The `/dev/null` half of an added or deleted *anchor* pseudo-diff.
    pub fn dev_null() -> Self {
        DiffSide {
            label: DEV_NULL.to_string(),
            text: "",
            first_line: 1,
            state: SideState::Absent,
        }
    }

    /// True when this side renders with `/dev/null` conventions: the
    /// explicit sentinel label, or content that is structurally absent.
    fn is_null(&self) -> bool {
        self.label == DEV_NULL || matches!(self.state, SideState::Absent)
    }

    /// The renderable text — empty for anything but [`SideState::Present`],
    /// so an unavailable side never contributes fabricated body lines.
    fn body(&self) -> &str {
        match self.state {
            SideState::Present => self.text,
            SideState::Absent | SideState::Binary => "",
        }
    }
}

/// Render a complete `diff --git …` block at a fixed context width of 3.
///
/// Returns `None` when the two sides carry the same content and the header
/// alone carries no information (only possible for
/// [`BlobDiffKind::Modified`] and [`AnchorDiffKind::Modify`] — a rename,
/// add or delete header is always informative even when content is
/// unchanged).
pub fn render_unified_diff(
    header: &DiffHeader,
    old: DiffSide<'_>,
    new: DiffSide<'_>,
) -> Option<String> {
    render(header, old, new, false)
}

/// Like [`render_unified_diff`], but never elides the block: two sides with
/// identical content still render their header (`diff --git` plus `index`),
/// with no `---`/`+++` pair and no hunks.
///
/// `git span history`'s `current` section uses this: a committed-but-
/// unreconciled anchor has byte-identical content and a stale recorded
/// hash, so the `index rk64:<recorded>..rk64:<live>` line *is* the finding.
/// Eliding it would hide the drift `git span stale` reports.
pub fn render_unified_diff_always(
    header: &DiffHeader,
    old: DiffSide<'_>,
    new: DiffSide<'_>,
) -> String {
    render(header, old, new, true).unwrap_or_default()
}

fn render(
    header: &DiffHeader,
    old: DiffSide<'_>,
    new: DiffSide<'_>,
    force: bool,
) -> Option<String> {
    let old_is_null = old.is_null();
    let new_is_null = new.is_null();
    let is_binary =
        matches!(old.state, SideState::Binary) || matches!(new.state, SideState::Binary);

    let is_modify = matches!(
        header,
        DiffHeader::Blob {
            kind: BlobDiffKind::Modified,
            ..
        }
    ) || matches!(
        header,
        DiffHeader::Anchor {
            kind: AnchorDiffKind::Modify,
            ..
        }
    );
    // Binary sides have no comparable body, so their `index` hashes decide
    // whether anything changed.
    let unchanged = if is_binary {
        header_hashes_equal(header)
    } else {
        old.body() == new.body()
    };
    if is_modify && unchanged && !force {
        return None;
    }

    let mut out = String::new();
    let mut headers_only = push_header(&mut out, header, &old, &new, unchanged);
    headers_only |= force && unchanged && !is_binary;
    if headers_only {
        // Nothing to show below the header: either the content is unchanged, or
        // this is a forced render whose whole point is the `index` line.
        return Some(out);
    }

    let a_label = side_path(&old, "a/", old_is_null);
    let b_label = side_path(&new, "b/", new_is_null);

    if is_binary {
        out.push_str(&format!("Binary files {a_label} and {b_label} differ\n"));
        return Some(out);
    }

    out.push_str(&format!(
        "--- {}\n+++ {}\n",
        tab_terminated(&a_label),
        tab_terminated(&b_label)
    ));
    out.push_str(&render_hunks(&old, &new, old_is_null, new_is_null));

    Some(out)
}

/// Render only the `diff --git` line plus the status and `index` header
/// lines — no `---`/`+++` pair, no hunks.
///
/// This is what a caller emits when one side's content is not recoverable at
/// all (as opposed to known-absent). Hunks need two comparable bodies;
/// synthesizing one from the side that *is* available would present it as
/// though it were the other side's content. The `index` line still carries
/// both hashes, so the block remains a true statement.
///
/// `recorded_unrecoverable` appends the [`RECORDED_UNRECOVERABLE`] marker
/// after the `index` line. Without it a reader sees two differing hashes and
/// an empty body, which is indistinguishable from a renderer that failed to
/// emit its hunks.
pub fn render_diff_header(
    header: &DiffHeader,
    old: &DiffSide<'_>,
    new: &DiffSide<'_>,
    recorded_unrecoverable: bool,
) -> String {
    let mut out = String::new();
    push_header(&mut out, header, old, new, false);
    if recorded_unrecoverable {
        out.push_str(RECORDED_UNRECOVERABLE);
        out.push('\n');
    }
    out
}

/// Push the `diff --git` line and the dialect's status/`index` header lines.
/// Returns `true` when the header block is self-sufficient (a pure rename or
/// a pure proposal, where `unchanged` content means there is nothing to show
/// below it).
fn push_header(
    out: &mut String,
    header: &DiffHeader,
    old: &DiffSide<'_>,
    new: &DiffSide<'_>,
    unchanged: bool,
) -> bool {
    out.push_str(&format!(
        "diff --git a/{} b/{}\n",
        old.label.as_str(),
        new.label.as_str()
    ));

    let mut headers_only = false;
    match header {
        DiffHeader::Blob {
            old_oid7,
            new_oid7,
            kind,
        } => match kind {
            BlobDiffKind::Added => {
                out.push_str("new file mode 100644\n");
                out.push_str(&format!("index {old_oid7}..{new_oid7}\n"));
            }
            BlobDiffKind::Deleted => {
                out.push_str("deleted file mode 100644\n");
                out.push_str(&format!("index {old_oid7}..{new_oid7}\n"));
            }
            BlobDiffKind::Modified => {
                out.push_str(&format!("index {old_oid7}..{new_oid7} 100644\n"));
            }
        },
        DiffHeader::Anchor {
            old_hash,
            new_hash,
            kind,
        } => {
            match kind {
                AnchorDiffKind::Modify => {}
                AnchorDiffKind::Rename { similarity } => {
                    out.push_str(&format!("similarity index {similarity}%\n"));
                    out.push_str(&format!("rename from {}\n", old.label));
                    out.push_str(&format!("rename to {}\n", new.label));
                    headers_only = unchanged;
                }
                AnchorDiffKind::Proposed { address } => {
                    out.push_str(&format!("proposed anchor {address}\n"));
                    headers_only = unchanged;
                }
                AnchorDiffKind::New => out.push_str("new anchor\n"),
                AnchorDiffKind::Deleted => out.push_str("deleted anchor\n"),
            }
            out.push_str(&format!(
                "index {}..{}\n",
                format_anchor_hash(old_hash),
                format_anchor_hash(new_hash)
            ));
        }
    }
    headers_only
}

/// The `---`/`+++` (and `Binary files …`) path for one side: `/dev/null`
/// for a null side, otherwise the label under its `a/`/`b/` prefix.
fn side_path(side: &DiffSide<'_>, prefix: &str, is_null: bool) -> String {
    if is_null {
        format!("/{DEV_NULL}")
    } else {
        format!("{prefix}{}", side.label)
    }
}

/// Git terminates a `---`/`+++` path with a tab when the path contains
/// whitespace, so a parser can find where the path ends. Paths without
/// whitespace are emitted bare.
fn tab_terminated(path: &str) -> String {
    if path.chars().any(char::is_whitespace) {
        format!("{path}\t")
    } else {
        path.to_string()
    }
}

/// True when a header's two `index` hashes are equal — the only available
/// "did anything change" signal for binary sides.
fn header_hashes_equal(header: &DiffHeader) -> bool {
    match header {
        DiffHeader::Blob {
            old_oid7, new_oid7, ..
        } => old_oid7 == new_oid7,
        DiffHeader::Anchor {
            old_hash, new_hash, ..
        } => old_hash == new_hash,
    }
}

/// [`NULL_ANCHOR_HASH`] renders bare (git's null-OID convention); any
/// other hash gets the `rk64:` extent-hash prefix.
fn format_anchor_hash(hash: &str) -> String {
    if hash == NULL_ANCHOR_HASH {
        hash.to_string()
    } else {
        format!("rk64:{hash}")
    }
}

/// Drive the shared Histogram engine at `-U3` and render the resulting
/// hunks with real-file coordinates. A `/dev/null` side's coordinate is
/// always the literal `0` (git's null-side convention), independent of
/// `first_line`.
fn render_hunks(
    old: &DiffSide<'_>,
    new: &DiffSide<'_>,
    old_is_null: bool,
    new_is_null: bool,
) -> String {
    let input = InternedInput::new(
        byte_lines(old.body().as_bytes()),
        byte_lines(new.body().as_bytes()),
    );
    let diff = Diff::compute(Algorithm::Histogram, &input);
    let renderer = HunkRenderer {
        old_first_line: old.first_line,
        new_first_line: new.first_line,
        old_is_null,
        new_is_null,
        out: String::new(),
    };
    UnifiedDiff::new(&diff, &input, renderer, ContextSize::symmetrical(3))
        .consume()
        .unwrap_or_default()
}

/// [`ConsumeHunk`] delegate that writes real-file-coordinate `@@ … @@`
/// headers and prefixed body lines (with `\ No newline at end of file`
/// markers) directly into an accumulating [`String`].
struct HunkRenderer {
    old_first_line: u32,
    new_first_line: u32,
    old_is_null: bool,
    new_is_null: bool,
    out: String,
}

impl ConsumeHunk for HunkRenderer {
    type Out = String;

    fn consume_hunk(
        &mut self,
        header: HunkHeader,
        lines: &[(DiffLineKind, &[u8])],
    ) -> std::io::Result<()> {
        let (os, oc) = side_coords(
            self.old_is_null,
            self.old_first_line,
            header.before_hunk_start,
            header.before_hunk_len,
        );
        let (ns, nc) = side_coords(
            self.new_is_null,
            self.new_first_line,
            header.after_hunk_start,
            header.after_hunk_len,
        );
        self.out.push_str(&format!("@@ -{os},{oc} +{ns},{nc} @@\n"));
        for (kind, content) in lines {
            let prefix = match kind {
                DiffLineKind::Context => ' ',
                DiffLineKind::Add => '+',
                DiffLineKind::Remove => '-',
            };
            let (text, has_newline) = match content.strip_suffix(b"\n") {
                Some(stripped) => (stripped, true),
                None => (*content, false),
            };
            self.out.push(prefix);
            self.out.push_str(&String::from_utf8_lossy(text));
            self.out.push('\n');
            if !has_newline {
                self.out.push_str("\\ No newline at end of file\n");
            }
        }
        Ok(())
    }

    fn finish(self) -> Self::Out {
        self.out
    }
}

/// Map one side's snapshot-relative `HunkHeader` field pair (1-based
/// start, count) to real-file coordinates. A `/dev/null` side always
/// renders `(0, 0)`. Otherwise a non-empty range offsets by
/// `first_line - 1`; an empty range (only possible when the side's whole
/// snapshot is empty, i.e. the `/dev/null` case above) falls back to
/// git's `N,0` convention using the 0-based position.
fn side_coords(is_null: bool, first_line: u32, start_1based: u32, len: u32) -> (u32, u32) {
    if is_null {
        return (0, 0);
    }
    let display_pos = if len == 0 {
        start_1based.saturating_sub(1)
    } else {
        start_1based
    };
    let real = i64::from(first_line) - 1 + i64::from(display_pos);
    (real.max(0) as u32, len)
}

/// Git-shaped similarity percentage (0-100) between two snapshots,
/// line-based via the same Histogram engine [`render_unified_diff`] uses.
/// Feeds both the `similarity index NN%` header and rename pairing at
/// git's 50% threshold.
///
/// Callers must not feed it unavailable content: two anchors that both
/// failed to extract are both empty, and an empty-vs-empty comparison
/// scores 100 — pairing them would fabricate a rename between unrelated
/// anchors.
pub fn similarity(old: &str, new: &str) -> u8 {
    let old_lines: Vec<_> = byte_lines(old.as_bytes()).collect();
    let new_lines: Vec<_> = byte_lines(new.as_bytes()).collect();
    let old_len = old_lines.len() as u64;
    let new_len = new_lines.len() as u64;
    if old_len == 0 && new_len == 0 {
        return 100;
    }

    let input = InternedInput::new(byte_lines(old.as_bytes()), byte_lines(new.as_bytes()));
    let diff = Diff::compute(Algorithm::Histogram, &input);
    let removed: u64 = diff
        .hunks()
        .map(|hunk| u64::from(hunk.before.end - hunk.before.start))
        .sum();
    let common = old_len.saturating_sub(removed);

    ((200 * common) / (old_len + new_len)).min(100) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side<'a>(label: &str, text: &'a str, first_line: u32) -> DiffSide<'a> {
        DiffSide::present(label, text, first_line)
    }

    #[test]
    fn modify_diff_uses_real_coordinate_hunk_headers() {
        let old = "line1\nline2\nline3\nline4\nline5\n";
        let new = "line1\nline2\nline3-changed\nline4\nline5\n";
        let header = DiffHeader::Blob {
            old_oid7: "d94b7e0".to_string(),
            new_oid7: "a71c3f8".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(
            &header,
            side(".span/x", old, 100),
            side(".span/x", new, 100),
        )
        .expect("content differs, must render");

        let expected = "diff --git a/.span/x b/.span/x\n\
             index d94b7e0..a71c3f8 100644\n\
             --- a/.span/x\n\
             +++ b/.span/x\n\
             @@ -100,5 +100,5 @@\n \
             line1\n \
             line2\n\
             -line3\n\
             +line3-changed\n \
             line4\n \
             line5\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn u3_context_merges_hunks_within_two_context_widths() {
        let lines: Vec<String> = (1..=20).map(|n| format!("L{n}\n")).collect();
        let old: String = lines.concat();
        let mut new_lines = lines.clone();
        new_lines[4] = "L5-x\n".to_string(); // 0-based index 4 == line 5
        new_lines[9] = "L10-x\n".to_string(); // 0-based index 9 == line 10
        let new: String = new_lines.concat();

        let header = DiffHeader::Anchor {
            old_hash: "aaaa".to_string(),
            new_hash: "bbbb".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff(&header, side("f#L1-L20", &old, 1), side("f#L1-L20", &new, 1))
            .expect("content differs, must render");

        let expected = "diff --git a/f#L1-L20 b/f#L1-L20\n\
             index rk64:aaaa..rk64:bbbb\n\
             --- a/f#L1-L20\n\
             +++ b/f#L1-L20\n\
             @@ -2,12 +2,12 @@\n \
             L2\n \
             L3\n \
             L4\n\
             -L5\n\
             +L5-x\n \
             L6\n \
             L7\n \
             L8\n \
             L9\n\
             -L10\n\
             +L10-x\n \
             L11\n \
             L12\n \
             L13\n";
        assert_eq!(
            out, expected,
            "changes 4 lines apart (<= 2*context) must coalesce into one hunk"
        );
    }

    #[test]
    fn u3_context_splits_hunks_beyond_two_context_widths() {
        let lines: Vec<String> = (1..=20).map(|n| format!("L{n}\n")).collect();
        let old: String = lines.concat();
        let mut new_lines = lines.clone();
        new_lines[4] = "L5-x\n".to_string(); // 0-based index 4 == line 5
        new_lines[17] = "L18-x\n".to_string(); // 0-based index 17 == line 18
        let new: String = new_lines.concat();

        let header = DiffHeader::Anchor {
            old_hash: "aaaa".to_string(),
            new_hash: "bbbb".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff(&header, side("f#L1-L20", &old, 1), side("f#L1-L20", &new, 1))
            .expect("content differs, must render");

        let expected = "diff --git a/f#L1-L20 b/f#L1-L20\n\
             index rk64:aaaa..rk64:bbbb\n\
             --- a/f#L1-L20\n\
             +++ b/f#L1-L20\n\
             @@ -2,7 +2,7 @@\n \
             L2\n \
             L3\n \
             L4\n\
             -L5\n\
             +L5-x\n \
             L6\n \
             L7\n \
             L8\n\
             @@ -15,6 +15,6 @@\n \
             L15\n \
             L16\n \
             L17\n\
             -L18\n\
             +L18-x\n \
             L19\n \
             L20\n";
        assert_eq!(
            out, expected,
            "changes 12 lines apart (> 2*context) must render as two hunks"
        );
    }

    #[test]
    fn pure_rename_renders_headers_only_no_hunks() {
        let text = "export function f() {\n    return 1;\n}\n";
        let header = DiffHeader::Anchor {
            old_hash: "fe4d90f3aa35936c".to_string(),
            new_hash: "fe4d90f3aa35936c".to_string(),
            kind: AnchorDiffKind::Rename { similarity: 100 },
        };
        let out = render_unified_diff(
            &header,
            side("src/a.ts#L10-L12", text, 10),
            side("src/a.ts#L20-L22", text, 20),
        )
        .expect("a rename header is always informative, even with unchanged content");

        let expected = "diff --git a/src/a.ts#L10-L12 b/src/a.ts#L20-L22\n\
             similarity index 100%\n\
             rename from src/a.ts#L10-L12\n\
             rename to src/a.ts#L20-L22\n\
             index rk64:fe4d90f3aa35936c..rk64:fe4d90f3aa35936c\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn move_with_edit_renders_headers_and_hunks() {
        let old = "export function f() {\n    return 1;\n}\n";
        let new = "export function f() {\n    return 2;\n}\n";
        let sim = similarity(old, new);
        let header = DiffHeader::Anchor {
            old_hash: "fe4d90f3aa35936c".to_string(),
            new_hash: "2c8b1e94d07a3f65".to_string(),
            kind: AnchorDiffKind::Rename { similarity: sim },
        };
        let out = render_unified_diff(
            &header,
            side("src/a.ts#L10-L12", old, 10),
            side("src/a.ts#L20-L22", new, 20),
        )
        .expect("content and address both changed, must render hunks");

        let expected = format!(
            "diff --git a/src/a.ts#L10-L12 b/src/a.ts#L20-L22\n\
             similarity index {sim}%\n\
             rename from src/a.ts#L10-L12\n\
             rename to src/a.ts#L20-L22\n\
             index rk64:fe4d90f3aa35936c..rk64:2c8b1e94d07a3f65\n\
             --- a/src/a.ts#L10-L12\n\
             +++ b/src/a.ts#L20-L22\n\
             @@ -10,3 +20,3 @@\n \
             export function f() {{\n\
             -    return 1;\n\
             +    return 2;\n \
             }}\n"
        );
        assert_eq!(out, expected);
    }

    #[test]
    fn new_anchor_renders_dev_null_old_side() {
        let new = "export function handleDisclosure() {\n    emit();\n}\n";
        let header = DiffHeader::Anchor {
            old_hash: "0000000000000000".to_string(),
            new_hash: "fe4d90f3aa35936c".to_string(),
            kind: AnchorDiffKind::New,
        };
        let out = render_unified_diff(
            &header,
            DiffSide::dev_null(),
            side("packages/a.ts#L245-L247", new, 245),
        )
        .expect("addition always renders");

        let expected = "diff --git a/dev/null b/packages/a.ts#L245-L247\n\
             new anchor\n\
             index 0000000000000000..rk64:fe4d90f3aa35936c\n\
             --- /dev/null\n\
             +++ b/packages/a.ts#L245-L247\n\
             @@ -0,0 +245,3 @@\n\
             +export function handleDisclosure() {\n\
             +    emit();\n\
             +}\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn deleted_anchor_renders_dev_null_new_side() {
        let old = "function renderAdvisorHeader() {\n    return spanCount;\n}\n";
        let header = DiffHeader::Anchor {
            old_hash: "e0f3bd75ca314e07".to_string(),
            new_hash: "0000000000000000".to_string(),
            kind: AnchorDiffKind::Deleted,
        };
        let out = render_unified_diff(
            &header,
            side("packages/a.ts#L1116-L1118", old, 1116),
            DiffSide::dev_null(),
        )
        .expect("deletion always renders");

        let expected = "diff --git a/packages/a.ts#L1116-L1118 b/dev/null\n\
             deleted anchor\n\
             index rk64:e0f3bd75ca314e07..0000000000000000\n\
             --- a/packages/a.ts#L1116-L1118\n\
             +++ /dev/null\n\
             @@ -1116,3 +0,0 @@\n\
             -function renderAdvisorHeader() {\n\
             -    return spanCount;\n\
             -}\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn blob_header_uses_old7_new7_100644_dialect() {
        let header = DiffHeader::Blob {
            old_oid7: "8f3a2c1".to_string(),
            new_oid7: "d94b7e0".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(
            &header,
            side(".span/x", "a\n", 1),
            side(".span/x", "b\n", 1),
        )
        .expect("content differs, must render");
        assert!(
            out.starts_with("diff --git a/.span/x b/.span/x\nindex 8f3a2c1..d94b7e0 100644\n"),
            "got: {out}"
        );
    }

    #[test]
    fn byte_identical_modify_returns_none_for_blob() {
        let header = DiffHeader::Blob {
            old_oid7: "8f3a2c1".to_string(),
            new_oid7: "8f3a2c1".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(&header, side(".span/x", "same\n", 1), side(".span/x", "same\n", 1));
        assert_eq!(out, None);
    }

    #[test]
    fn byte_identical_modify_returns_none_for_anchor() {
        let header = DiffHeader::Anchor {
            old_hash: "aaaa".to_string(),
            new_hash: "aaaa".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff(
            &header,
            side("f#L1-L1", "same\n", 1),
            side("f#L1-L1", "same\n", 1),
        );
        assert_eq!(out, None);
    }

    #[test]
    fn missing_trailing_newline_emits_git_marker() {
        let old = "a\nb";
        let new = "a\nc";
        let header = DiffHeader::Blob {
            old_oid7: "1111111".to_string(),
            new_oid7: "2222222".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(&header, side(".span/x", old, 1), side(".span/x", new, 1))
            .expect("content differs, must render");

        let expected = "diff --git a/.span/x b/.span/x\n\
             index 1111111..2222222 100644\n\
             --- a/.span/x\n\
             +++ b/.span/x\n\
             @@ -1,2 +1,2 @@\n \
             a\n\
             -b\n\
             \\ No newline at end of file\n\
             +c\n\
             \\ No newline at end of file\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn similarity_of_identical_snapshots_is_100() {
        let text = "foo\nbar\nbaz\n";
        assert_eq!(similarity(text, text), 100);
    }

    #[test]
    fn similarity_of_fully_disjoint_snapshots_is_0() {
        assert_eq!(similarity("foo\nbar\n", "baz\nqux\n"), 0);
    }

    #[test]
    fn added_blob_uses_gits_new_file_dialect() {
        let header = DiffHeader::Blob {
            old_oid7: NULL_BLOB_OID7.to_string(),
            new_oid7: "d94b7e0".to_string(),
            kind: BlobDiffKind::Added,
        };
        let out = render_unified_diff(
            &header,
            DiffSide::absent(".span/x"),
            side(".span/x", "a\nb\n", 1),
        )
        .expect("an addition always renders");

        let expected = "diff --git a/.span/x b/.span/x\n\
             new file mode 100644\n\
             index 0000000..d94b7e0\n\
             --- /dev/null\n\
             +++ b/.span/x\n\
             @@ -0,0 +1,2 @@\n\
             +a\n\
             +b\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn deleted_blob_uses_gits_deleted_file_dialect() {
        let header = DiffHeader::Blob {
            old_oid7: "d94b7e0".to_string(),
            new_oid7: NULL_BLOB_OID7.to_string(),
            kind: BlobDiffKind::Deleted,
        };
        let out = render_unified_diff(
            &header,
            side(".span/x", "a\nb\n", 1),
            DiffSide::absent(".span/x"),
        )
        .expect("a deletion always renders");

        let expected = "diff --git a/.span/x b/.span/x\n\
             deleted file mode 100644\n\
             index d94b7e0..0000000\n\
             --- a/.span/x\n\
             +++ /dev/null\n\
             @@ -1,2 +0,0 @@\n\
             -a\n\
             -b\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn whitespace_in_path_tab_terminates_the_marker_lines() {
        let header = DiffHeader::Blob {
            old_oid7: "1111111".to_string(),
            new_oid7: "2222222".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(
            &header,
            side("my dir/my file.txt", "a\n", 1),
            side("my dir/my file.txt", "b\n", 1),
        )
        .expect("content differs, must render");

        assert!(
            out.contains("--- a/my dir/my file.txt\t\n+++ b/my dir/my file.txt\t\n"),
            "git tab-terminates a whitespace-bearing path; got:\n{out}"
        );
        assert!(
            out.contains("diff --git a/my dir/my file.txt b/my dir/my file.txt\n"),
            "the `diff --git` line is not disambiguated, exactly as git leaves it; got:\n{out}"
        );
    }

    #[test]
    fn whitespace_free_paths_keep_bare_marker_lines() {
        let header = DiffHeader::Blob {
            old_oid7: "1111111".to_string(),
            new_oid7: "2222222".to_string(),
            kind: BlobDiffKind::Modified,
        };
        let out = render_unified_diff(&header, side("a.txt", "a\n", 1), side("a.txt", "b\n", 1))
            .expect("content differs, must render");
        assert!(out.contains("--- a/a.txt\n+++ b/a.txt\n"), "got:\n{out}");
    }

    #[test]
    fn absent_side_renders_as_dev_null_never_as_prose() {
        let header = DiffHeader::Anchor {
            old_hash: "e0f3bd75ca314e07".to_string(),
            new_hash: NULL_ANCHOR_HASH.to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff(
            &header,
            side("src.txt#L1-L2", "one\ntwo\n", 1),
            DiffSide::absent("src.txt#L1-L2"),
        )
        .expect("content vanished, must render");

        let expected = "diff --git a/src.txt#L1-L2 b/src.txt#L1-L2\n\
             index rk64:e0f3bd75ca314e07..0000000000000000\n\
             --- a/src.txt#L1-L2\n\
             +++ /dev/null\n\
             @@ -1,2 +0,0 @@\n\
             -one\n\
             -two\n";
        assert_eq!(out, expected);
    }

    #[test]
    fn an_unrecoverable_header_block_says_why_it_has_no_hunks() {
        let header = DiffHeader::Anchor {
            old_hash: "1f1b7cf059444277".to_string(),
            new_hash: "fd1a4e7a7c6a7eaf".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let old = DiffSide::absent("f.txt#L3-L5");
        let new = side("f.txt#L3-L5", "one\ntwo\nthree\n", 3);

        let expected = "diff --git a/f.txt#L3-L5 b/f.txt#L3-L5\n\
             index rk64:1f1b7cf059444277..rk64:fd1a4e7a7c6a7eaf\n";
        assert_eq!(
            render_diff_header(&header, &old, &new, false),
            expected,
            "without the flag the block is two hashes and nothing else"
        );
        assert_eq!(
            render_diff_header(&header, &old, &new, true),
            format!("{expected}recorded snapshot unrecoverable\n"),
            "the marker follows the index line, so the reader can tell an \
             unrecoverable old side from a renderer that lost its hunks"
        );
    }

    #[test]
    fn two_absent_sides_render_nothing() {
        let header = DiffHeader::Anchor {
            old_hash: NULL_ANCHOR_HASH.to_string(),
            new_hash: NULL_ANCHOR_HASH.to_string(),
            kind: AnchorDiffKind::Modify,
        };
        assert_eq!(
            render_unified_diff(
                &header,
                DiffSide::absent("src.txt#L1-L2"),
                DiffSide::absent("src.txt#L1-L2"),
            ),
            None,
            "an anchor that was unavailable before and after did not change"
        );
    }

    #[test]
    fn binary_side_renders_gits_binary_line_instead_of_hunks() {
        let header = DiffHeader::Anchor {
            old_hash: "aaaaaaaaaaaaaaaa".to_string(),
            new_hash: "bbbbbbbbbbbbbbbb".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff(
            &header,
            DiffSide::binary("logo.png"),
            DiffSide::binary("logo.png"),
        )
        .expect("differing hashes mean the binary changed");

        let expected = "diff --git a/logo.png b/logo.png\n\
             index rk64:aaaaaaaaaaaaaaaa..rk64:bbbbbbbbbbbbbbbb\n\
             Binary files a/logo.png and b/logo.png differ\n";
        assert_eq!(out, expected);
        assert!(!out.contains("@@"), "a binary diff carries no hunks");
    }

    #[test]
    fn unchanged_binary_sides_render_nothing() {
        let header = DiffHeader::Anchor {
            old_hash: "aaaaaaaaaaaaaaaa".to_string(),
            new_hash: "aaaaaaaaaaaaaaaa".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        assert_eq!(
            render_unified_diff(
                &header,
                DiffSide::binary("logo.png"),
                DiffSide::binary("logo.png"),
            ),
            None
        );
    }

    #[test]
    fn forced_render_of_identical_sides_emits_the_header_alone() {
        let text = "one\ntwo\n";
        let header = DiffHeader::Anchor {
            old_hash: "1111111111111111".to_string(),
            new_hash: "2222222222222222".to_string(),
            kind: AnchorDiffKind::Modify,
        };
        let out = render_unified_diff_always(
            &header,
            side("src.txt#L1-L2", text, 1),
            side("src.txt#L1-L2", text, 1),
        );

        let expected = "diff --git a/src.txt#L1-L2 b/src.txt#L1-L2\n\
             index rk64:1111111111111111..rk64:2222222222222222\n";
        assert_eq!(
            out, expected,
            "the differing index hashes are the whole finding: content is \
             unchanged but the recorded hash is stale"
        );
    }
}
