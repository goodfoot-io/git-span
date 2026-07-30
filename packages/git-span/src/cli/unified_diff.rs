//! Unified-diff *text* renderer, shared by two dialects of `git span
//! history` patch: ordinary blob diffs of a `.span/<name>` declaration
//! file, and "anchor pseudo-diffs" whose paths are `path#Lstart-Lend`
//! addresses, whose `index` lines carry `rk64:` content hashes, and whose
//! hunk headers use the anchor's real file coordinates (a hunk at
//! snapshot-relative line `k` renders at `first_line + k - 1`).
//!
//! [`compute_hunks_from_bytes()`](crate::resolver::layers::diff) computes
//! `-U0` hunk tuples for stale-matching, optimized for match precision —
//! this module is display-only and drives the same `gix::diff::blob`
//! Histogram (imara-diff) engine independently, assembling its own `-U3`
//! context-merged hunks via `gix::diff::blob::unified_diff::UnifiedDiff`.
//! Do not call or reuse `compute_hunks_from_bytes()` from here: it stays
//! tuned for `-U0` stale-matching, this module owns all patch-text
//! production.

// TODO(Step 2 of the `git span history` v2 plan): this module has no
// caller yet — `history.rs` starts consuming it in Step 2, at which point
// this `#[allow(dead_code)]` is removed.
#![allow(dead_code)]

use gix::diff::blob::sources::byte_lines;
use gix::diff::blob::unified_diff::{ConsumeHunk, ContextSize, DiffLineKind, HunkHeader};
use gix::diff::blob::{Algorithm, Diff, InternedInput, UnifiedDiff};

/// Display label used for a `/dev/null` side of a diff (an added or
/// deleted anchor / blob). [`DiffSide::label`] equal to this sentinel
/// selects `/dev/null` rendering conventions for that side.
const DEV_NULL: &str = "dev/null";

/// Header dialect for one rendered file diff.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffHeader {
    /// Ordinary declaration-file diff: `index <old7>..<new7> 100644`.
    Blob {
        /// Old blob OID, abbreviated to 7 hex characters.
        old_oid7: String,
        /// New blob OID, abbreviated to 7 hex characters.
        new_oid7: String,
    },
    /// Anchor pseudo-diff: `index rk64:old..rk64:new`, optional rename
    /// headers with a genuinely computed similarity, or the `new anchor`
    /// / `deleted anchor` lines replacing git's mode lines.
    Anchor {
        /// Old snapshot's `rk64:` extent hash. `"0000000000000000"` for a
        /// [`AnchorDiffKind::New`] (rendered without the `rk64:` prefix,
        /// matching git's null-OID convention).
        old_hash: String,
        /// New snapshot's `rk64:` extent hash. `"0000000000000000"` for a
        /// [`AnchorDiffKind::Deleted`] (rendered without the `rk64:`
        /// prefix).
        new_hash: String,
        /// Which header lines accompany the `index` line.
        kind: AnchorDiffKind,
    },
}

/// Which header lines accompany an [`DiffHeader::Anchor`]'s `index` line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnchorDiffKind {
    /// Address unchanged, content changed. No extra header lines.
    Modify,
    /// Address changed (paired by similarity, not exact match).
    /// `similarity index NN%` / `rename from` / `rename to` header lines.
    /// Hunks are present only when content also changed — a pure move
    /// renders the header block alone.
    Rename {
        /// Git-shaped similarity percentage between the paired snapshots,
        /// as computed by [`similarity()`].
        similarity: u8,
    },
    /// The anchor did not exist in the old state. `new anchor` header
    /// line; old side renders with `/dev/null` conventions.
    New,
    /// The anchor does not exist in the new state. `deleted anchor`
    /// header line; new side renders with `/dev/null` conventions.
    Deleted,
}

/// One side of a diff: display label, text, and the 1-based coordinate of
/// the text's first line in its real file (so hunk headers carry real
/// file coordinates rather than snapshot-relative ones).
///
/// A side representing a `/dev/null` half of an addition or deletion uses
/// the literal label `"dev/null"` (no `a/`/`b/` prefix, no leading
/// slash — those are applied by the renderer per-context). `first_line`
/// is ignored for a `/dev/null` side.
pub struct DiffSide<'a> {
    /// Display label: `path#Lstart-Lend`, a plain repo-relative path (for
    /// [`DiffHeader::Blob`]), or the sentinel `"dev/null"`.
    pub label: String,
    /// The side's full text content.
    pub text: &'a str,
    /// 1-based line number, in the side's real file, of `text`'s first
    /// line. Ignored when `label == "dev/null"`.
    pub first_line: u32,
}

/// Render a complete `diff --git …` block at a fixed context width of 3.
/// Returns `None` when the sides are byte-identical and the header alone
/// carries no information (only possible for [`DiffHeader::Blob`] and
/// [`AnchorDiffKind::Modify`] — a rename or add/delete header is always
/// informative even when content is unchanged).
pub fn render_unified_diff(
    header: &DiffHeader,
    old: DiffSide<'_>,
    new: DiffSide<'_>,
) -> Option<String> {
    let old_is_null = old.label == DEV_NULL;
    let new_is_null = new.label == DEV_NULL;

    let is_modify = matches!(header, DiffHeader::Blob { .. })
        || matches!(
            header,
            DiffHeader::Anchor {
                kind: AnchorDiffKind::Modify,
                ..
            }
        );
    if is_modify && old.text == new.text {
        return None;
    }

    let mut out = String::new();
    let git_a = if old_is_null { DEV_NULL } else { old.label.as_str() };
    let git_b = if new_is_null { DEV_NULL } else { new.label.as_str() };
    out.push_str(&format!("diff --git a/{git_a} b/{git_b}\n"));

    let mut is_pure_rename = false;
    match header {
        DiffHeader::Blob { old_oid7, new_oid7 } => {
            out.push_str(&format!("index {old_oid7}..{new_oid7} 100644\n"));
        }
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
                    is_pure_rename = old.text == new.text;
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

    if is_pure_rename {
        return Some(out);
    }

    let a_label = if old_is_null {
        format!("/{DEV_NULL}")
    } else {
        format!("a/{}", old.label)
    };
    let b_label = if new_is_null {
        format!("/{DEV_NULL}")
    } else {
        format!("b/{}", new.label)
    };
    out.push_str(&format!("--- {a_label}\n+++ {b_label}\n"));
    out.push_str(&render_hunks(&old, &new, old_is_null, new_is_null));

    Some(out)
}

/// `"0000000000000000"` renders bare (git's null-OID convention); any
/// other hash gets the `rk64:` extent-hash prefix.
fn format_anchor_hash(hash: &str) -> String {
    if hash == "0000000000000000" {
        hash.to_string()
    } else {
        format!("rk64:{hash}")
    }
}

/// Drive the shared Histogram engine at `-U3` and render the resulting
/// hunks with real-file coordinates. A `/dev/null` side's coordinate is
/// always the literal `0` (git's null-side convention), independent of
/// `first_line`.
fn render_hunks(old: &DiffSide<'_>, new: &DiffSide<'_>, old_is_null: bool, new_is_null: bool) -> String {
    let input = InternedInput::new(byte_lines(old.text.as_bytes()), byte_lines(new.text.as_bytes()));
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

    fn consume_hunk(&mut self, header: HunkHeader, lines: &[(DiffLineKind, &[u8])]) -> std::io::Result<()> {
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
/// Feeds both the `similarity index NN%` header and, later, rename
/// pairing at git's 50% threshold.
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
        DiffSide {
            label: label.to_string(),
            text,
            first_line,
        }
    }

    #[test]
    fn modify_diff_uses_real_coordinate_hunk_headers() {
        let old = "line1\nline2\nline3\nline4\nline5\n";
        let new = "line1\nline2\nline3-changed\nline4\nline5\n";
        let header = DiffHeader::Blob {
            old_oid7: "d94b7e0".to_string(),
            new_oid7: "a71c3f8".to_string(),
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
            side("dev/null", "", 1),
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
            side("dev/null", "", 1),
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
}
