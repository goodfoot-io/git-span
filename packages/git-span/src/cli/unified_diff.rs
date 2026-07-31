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

/// Marker line naming the one reason a diff block stops at its header: no
/// snapshot anywhere in the render hashes to the declaration's recorded token,
/// so there is no honest "before" text to build hunks from.
///
/// The claim is unqualified because the search behind it is: the old side is
/// looked for by content hash across every snapshot the report produces, not
/// merely under the anchor's own address. A narrower search with this same
/// wording is what turned a recoverable block into a data-loss claim whose
/// documented remedy is destructive.
///
/// It lives in the header — beside `proposed anchor <address>` and the rename
/// lines — rather than being appended by the human renderer, because the JSON
/// `diff` string and the default output's block are byte-identical by
/// contract. A marker only one of them carried would break that, and the
/// state would stay invisible in exactly the surface that needs the
/// explanation.
pub const RECORDED_UNRECOVERABLE: &str = "recorded snapshot unrecoverable";

/// Marker line naming *why* an anchor has no content, in two forms.
///
/// `content unavailable range-past-eof..absent` names a **transition** between
/// two reasons, in the `index` line's own `old..new` idiom. It appears where
/// both sides are bodyless for different reasons — the only case where nothing
/// else in the block can say what changed: two null hashes over two empty
/// bodies.
///
/// `content unavailable range-past-eof` names a **single side's** reason, and
/// exists because the `/dev/null` side is not able to. A `/dev/null` side states
/// that there are no bytes here, which is true of a deleted file and equally
/// true of a declared range that starts past its file's end — so the two
/// rendered byte-identically, down to the deletion hunk, and the human format
/// carried no way to tell them apart. That matters more than a cosmetic
/// ambiguity: the two states want opposite repairs. A deleted file wants
/// restoring; a range past the end of a file sitting right there wants
/// re-anchoring, and `absent`'s gloss points the reader at the wrong one.
///
/// Only [`Absence::RangePastEof`] earns the line. [`Absence::Missing`] covers
/// both "there is no such file" and the `/dev/null` half of an ordinary create
/// or delete, and a line on the latter would explain a side that needs no
/// explanation — git has rendered creates and deletes this way forever. The
/// asymmetry is the point: the marker says the file is *there* and the range is
/// not, which is exactly the fact the `/dev/null` side misstates.
///
/// The precedent is git's own `Binary files … differ`, which is what a dedicated
/// sentence looks like in this dialect — it encodes nothing in the `---`/`+++`
/// sides and states the fact outright. What it does *not* do, and neither does
/// this, is put a placeholder in the body: that would corrupt the hunk
/// arithmetic and paint the placeholder as source. The hunks here are honest and
/// stay — `git diff` shows the same lines leaving for the same commit — so this
/// adds a sentence rather than replacing a body.
///
/// Like [`RECORDED_UNRECOVERABLE`] both forms live in the header rather than
/// being appended by the human renderer, so the JSON `diff` string and the
/// default output's block stay byte-identical.
///
/// Neither form is the discriminator: a consumer reads the reason from the
/// structured `unavailable` field and never parses this line.
pub const CONTENT_UNAVAILABLE: &str = "content unavailable";

/// Marker line naming **which layer the drift lives at** — `drift source
/// worktree`, `drift source head`, `drift source worktree, head` — over the
/// same three layers `git span stale` publishes as `source`, lowercased and
/// comma-separated in the resolver's extent-dependent order.
///
/// It exists because the leading `current` block described *that* an anchor
/// drifted and never *where*, so different layer observations rendered
/// byte-identically while `stale` separated them on both of its own surfaces.
/// The marker is observational: `head` may describe committed content drift or
/// a worktree-only declaration compared with HEAD, so the declaration diff and
/// timeline decide the repair. With drift accumulated over two commits
/// the block describes an edit `git diff`, `git diff HEAD` and every commit
/// entry in the same output all fail to corroborate.
///
/// Emitted only when there is a layer to name — never as an empty list — and
/// last among the header markers, immediately above `index`, so
/// `proposed anchor` and [`CONTENT_UNAVAILABLE`] keep the positions the
/// contract's worked examples show.
///
/// Like [`RECORDED_UNRECOVERABLE`] it lives in the header rather than being
/// appended by the human renderer. The settled invariant is that the default
/// output's block and the JSON `diff` string are the *same bytes* because the
/// renderer builds the header once — not that the string is frozen — so
/// appending here is the one design that would break byte-identity, and it is
/// rejected on that ground. The line is not the discriminator either: a
/// consumer reads the layers from the structured `sources` array.
pub const DRIFT_SOURCE: &str = "drift source";

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
        /// Every layer that shows drift for this anchor, shallow-to-deep,
        /// spelled as the [`DRIFT_SOURCE`] marker line. Empty on a timeline
        /// block, which describes a commit rather than a drift and has no
        /// layer to name.
        drift_sources: Vec<crate::types::DriftSource>,
    },
}

impl DiffHeader {
    /// An anchor header with no drift layer named — every construction outside
    /// the `current` block, where the question does not arise.
    pub fn anchor(old_hash: String, new_hash: String, kind: AnchorDiffKind) -> Self {
        DiffHeader::Anchor {
            old_hash,
            new_hash,
            kind,
            drift_sources: Vec::new(),
        }
    }
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
        /// Git-shaped similarity percentage between the paired snapshots, as
        /// computed by [`similarity()`] — `None` when the two snapshots cannot
        /// be compared at all, which is to say when either side's content is
        /// unrecoverable.
        ///
        /// The `similarity index` line is emitted exactly when this is `Some`,
        /// and its absence is a positive statement: the move is real (a
        /// re-anchor is asserted by the user's own declaration, not inferred
        /// from content) and how alike the two blocks are is *unknown*. A
        /// number here would have to be measured through the empty-string
        /// fallback for an unreadable body, printing `similarity index 0%`
        /// immediately above the line saying that body could not be read.
        similarity: Option<u8>,
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
    /// The declaration now records a *different* token for this address
    /// than it did in the previous state — the binding moved, whatever
    /// the bytes did. `rebound anchor` header line, and an `index` line
    /// carrying the two **recorded** tokens rather than the rendered
    /// content's hash: the token transition is this block's whole
    /// content, which is why it never carries hunks.
    ///
    /// The predicate is per address and says nothing about content.
    /// Content-preserving rebindings (a two-anchor swap, a three-anchor
    /// rotation) change nothing a content diff can see, so without this
    /// form the one commit that broke every affected anchor is the one
    /// commit with no anchor-level account. When the content changed too,
    /// both facts are true at once and this block is emitted *beside* the
    /// ordinary content block for the same address: the rebinding is the
    /// event a content hunk cannot express, and a lone content hunk
    /// invites a re-hash — the repair that would bind the why-prose
    /// permanently to unrelated content.
    Rebound,
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
    /// The side has no content at this point. Renders exactly like a
    /// `/dev/null` side: zero-length, `-0,0`/`+0,0` coordinates, and a
    /// `/dev/null` label on the `---`/`+++` line. The [`Absence`] says *why*,
    /// which the rendering deliberately does not.
    Absent(Absence),
    /// The side's content exists but is not text. Suppresses hunks in
    /// favour of git's `Binary files a/<old> and b/<new> differ` line.
    Binary,
}

/// Why an [`SideState::Absent`] side has no bytes.
///
/// The variants render identically — all are `/dev/null` sides — so this
/// exists for exactly one job: to keep them *distinguishable* where it matters.
/// All wear [`NULL_ANCHOR_HASH`], so a renderer comparing hashes, or comparing
/// two empty bodies, sees one state where there are several, and the commit
/// that carried an anchor from one to another rendered no entry at all. Change
/// detection asks this enum instead.
///
/// The reason is carried *into* the renderer rather than inferred back out of a
/// null hash, because the null hash is ambiguous by construction: an absent
/// file, a past-EOF range, a `/dev/null` side, and a genuinely empty recorded
/// extent all hash to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Absence {
    /// There is nothing here at all: the `/dev/null` half of a creation or a
    /// deletion, or a file that does not exist in this state.
    Missing,
    /// The file exists; the declared line range starts past its end.
    RangePastEof,
    /// The file exists and its content could not be produced: a
    /// `.gitattributes` line names a filter whose driver is missing,
    /// unconfigured, or unable to run.
    ///
    /// This is the one absence that says nothing about the *file* — the bytes
    /// are on disk and readable; what failed is the conversion git would apply
    /// to them. It therefore takes [`suppresses_hunks`] where the other two do
    /// not: a past-EOF range genuinely has no bytes and `git diff` shows the
    /// same lines leaving, but a filter failure means the content was never
    /// measured, and a hunk against an unmeasured side asserts an edit nobody
    /// observed.
    ///
    /// [`suppresses_hunks`]: Absence::suppresses_hunks
    FilterFailed,
    /// A parent directory is now a gitlink, so the declared path cannot be
    /// read from this repository even when a checkout exists beneath it.
    Submodule,
}

impl Absence {
    /// The word for this absence, spelled exactly as the JSON `unavailable`
    /// field spells it so the two surfaces never name one state twice.
    fn label(self) -> &'static str {
        match self {
            Absence::Missing => "absent",
            Absence::RangePastEof => "range-past-eof",
            Absence::FilterFailed => "filter-failed",
            Absence::Submodule => "submodule",
        }
    }

    /// Whether this absence earns a [`CONTENT_UNAVAILABLE`] line naming it.
    ///
    /// [`Absence::Missing`] does not: it covers both "there is no such file"
    /// and the `/dev/null` half of an ordinary create or delete, and a line on
    /// the latter would explain a side git has rendered this way forever. The
    /// other states do, and for the same reason — each says the path's absence
    /// has a narrower cause than "no such file", a fact a bare `/dev/null`
    /// side would misstate.
    fn is_named(self) -> bool {
        match self {
            Absence::Missing => false,
            Absence::RangePastEof | Absence::FilterFailed | Absence::Submodule => true,
        }
    }

    /// Whether a side in this state makes the block header-only.
    ///
    /// Hunks need a side whose content was *read*. A filter failure or a path
    /// hidden behind a gitlink means it was not, so the only honest block is
    /// the two tokens plus the reason.
    fn suppresses_hunks(self) -> bool {
        matches!(self, Absence::FilterFailed | Absence::Submodule)
    }
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

    /// A side that carries a label but no content, for the stated reason.
    /// Renders as `/dev/null` whichever reason it is — the reason is data for
    /// change detection, not a rendering variant.
    pub fn absent(label: impl Into<String>, why: Absence) -> Self {
        DiffSide {
            label: label.into(),
            text: "",
            first_line: 1,
            state: SideState::Absent(why),
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
            state: SideState::Absent(Absence::Missing),
        }
    }

    /// True when this side renders with `/dev/null` conventions: the
    /// explicit sentinel label, or content that is structurally absent.
    fn is_null(&self) -> bool {
        self.label == DEV_NULL || matches!(self.state, SideState::Absent(_))
    }

    /// Why this side has no bytes, or `None` when it has some.
    fn absence(&self) -> Option<Absence> {
        match self.state {
            SideState::Absent(why) => Some(why),
            SideState::Present | SideState::Binary => None,
        }
    }

    /// The renderable text — empty for anything but [`SideState::Present`],
    /// so an unavailable side never contributes fabricated body lines.
    fn body(&self) -> &str {
        match self.state {
            SideState::Present => self.text,
            SideState::Absent(_) | SideState::Binary => "",
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
    //
    // Two bodyless sides compare equal (both empty) and their hashes compare
    // equal (both null), so a state that went from a past-EOF range to a
    // deleted file used to satisfy every "unchanged" test there was, and the
    // commit that did it rendered no entry at all — an `unavailable` value
    // visibly changing with nothing to see it. The absence *reason* is the only
    // thing that moved, so it is the thing asked. Deliberately narrow: this is
    // not general reason-carrying change detection but the one pair of states
    // that collapse onto the same hash and the same empty body.
    let absence_changed = matches!(
        (old.absence(), new.absence()),
        (Some(a), Some(b)) if a != b
    );
    let unchanged = if is_binary {
        header_hashes_equal(header)
    } else {
        old.body() == new.body() && !absence_changed
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
            drift_sources,
        } => {
            // Set by the transition form below, so the single-side form does not
            // repeat a reason the transition line already spells out.
            let mut named_absence = false;
            match kind {
                AnchorDiffKind::Modify => {
                    // The one anchor-level change no hunk can express: neither
                    // state has bytes, so there is nothing to put on either
                    // side of a `-`/`+`, and yet the anchor moved between two
                    // distinct unreadable states. Without this line the block
                    // is two identical null hashes over an empty body, which
                    // is indistinguishable from a renderer that failed —
                    // the same gap the `recorded snapshot unrecoverable`
                    // marker was added to close.
                    if let (Some(a), Some(b)) = (old.absence(), new.absence())
                        && a != b
                    {
                        out.push_str(&format!(
                            "{CONTENT_UNAVAILABLE} {}..{}\n",
                            a.label(),
                            b.label()
                        ));
                        named_absence = true;
                        headers_only = true;
                    }
                }
                AnchorDiffKind::Rename { similarity } => {
                    if let Some(similarity) = similarity {
                        out.push_str(&format!("similarity index {similarity}%\n"));
                    }
                    out.push_str(&format!("rename from {}\n", old.label));
                    out.push_str(&format!("rename to {}\n", new.label));
                    // Hunks need two comparable bodies. A rename whose old or
                    // new side has no bytes has one, and diffing against the
                    // absence spells the missing half out as a full deletion
                    // (or addition) — signed lines for an edit the user never
                    // made, when all they did was move a declaration onto an
                    // address that holds nothing. The declared move is the
                    // whole finding, so the header is the whole block.
                    headers_only = unchanged || old.is_null() || new.is_null();
                }
                AnchorDiffKind::Proposed { address } => {
                    out.push_str(&format!("proposed anchor {address}\n"));
                    headers_only = unchanged;
                }
                AnchorDiffKind::New => out.push_str("new anchor\n"),
                AnchorDiffKind::Deleted => out.push_str("deleted anchor\n"),
                AnchorDiffKind::Rebound => {
                    out.push_str("rebound anchor\n");
                    headers_only = true;
                }
            }
            // A `/dev/null` side can say "no bytes"; it cannot say that the file
            // is present and the declared *range* is what does not exist. Every
            // anchor dialect kind can reach that state — a truncation is a
            // `Modify`, a hand-edited re-anchor past the end is a `Rename` — so
            // the line is emitted here rather than inside any one arm.
            let named = [old.absence(), new.absence()]
                .into_iter()
                .flatten()
                .find(|why| why.is_named());
            if let Some(why) = named
                && !named_absence
            {
                out.push_str(&format!("{CONTENT_UNAVAILABLE} {}\n", why.label()));
            }
            // A side whose content was never read cannot stand opposite one
            // that was: the hunk would spell the unread half out as a full
            // deletion (or addition) — signed lines for an edit nobody
            // measured, over a file `git status` calls clean.
            headers_only |= [old.absence(), new.absence()]
                .into_iter()
                .flatten()
                .any(Absence::suppresses_hunks);
            // Last marker before `index`: an anchor can drift at several layers
            // at once (an edit committed and then further edited in the working
            // tree), so this is a list and not a single word — naming one layer
            // would drop the other face of exactly the composed drift the
            // marker exists to expose.
            if !drift_sources.is_empty() {
                let layers: Vec<&str> = drift_sources
                    .iter()
                    .map(|s| crate::types::DriftSource::marker_token(*s))
                    .collect();
                out.push_str(&format!("{DRIFT_SOURCE} {}\n", layers.join(", ")));
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

/// One side of a hunk header. Git omits the length when it is exactly 1
/// (`@@ -2 +4 @@`, never `@@ -2,1 +4,1 @@`), independently per side; a parser
/// written against git's output — and `git apply` itself — reads the short
/// form, so a rendered patch that always spells the count is not the dialect
/// this command promises.
fn hunk_side(start: u32, count: u32) -> String {
    if count == 1 {
        start.to_string()
    } else {
        format!("{start},{count}")
    }
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
        self.out.push_str(&format!(
            "@@ -{} +{} @@\n",
            hunk_side(os, oc),
            hunk_side(ns, nc)
        ));
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
    // The interned input already knows each side's line count; collecting the
    // lines into vectors first would only re-derive the same two numbers.
    let input = InternedInput::new(byte_lines(old.as_bytes()), byte_lines(new.as_bytes()));
    let old_len = input.before.len() as u64;
    let new_len = input.after.len() as u64;
    if old_len == 0 && new_len == 0 {
        return 100;
    }

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

        let header = DiffHeader::anchor(
            "aaaa".to_string(),
            "bbbb".to_string(),
            AnchorDiffKind::Modify,
        );
        let out = render_unified_diff(
            &header,
            side("f#L1-L20", &old, 1),
            side("f#L1-L20", &new, 1),
        )
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

        let header = DiffHeader::anchor(
            "aaaa".to_string(),
            "bbbb".to_string(),
            AnchorDiffKind::Modify,
        );
        let out = render_unified_diff(
            &header,
            side("f#L1-L20", &old, 1),
            side("f#L1-L20", &new, 1),
        )
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
        let header = DiffHeader::anchor(
            "fe4d90f3aa35936c".to_string(),
            "fe4d90f3aa35936c".to_string(),
            AnchorDiffKind::Rename {
                similarity: Some(100),
            },
        );
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
        let header = DiffHeader::anchor(
            "fe4d90f3aa35936c".to_string(),
            "2c8b1e94d07a3f65".to_string(),
            AnchorDiffKind::Rename {
                similarity: Some(sim),
            },
        );
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
        let header = DiffHeader::anchor(
            "0000000000000000".to_string(),
            "fe4d90f3aa35936c".to_string(),
            AnchorDiffKind::New,
        );
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
        let header = DiffHeader::anchor(
            "e0f3bd75ca314e07".to_string(),
            "0000000000000000".to_string(),
            AnchorDiffKind::Deleted,
        );
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
        let out = render_unified_diff(
            &header,
            side(".span/x", "same\n", 1),
            side(".span/x", "same\n", 1),
        );
        assert_eq!(out, None);
    }

    #[test]
    fn byte_identical_modify_returns_none_for_anchor() {
        let header = DiffHeader::anchor(
            "aaaa".to_string(),
            "aaaa".to_string(),
            AnchorDiffKind::Modify,
        );
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
            DiffSide::absent(".span/x", Absence::Missing),
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
            DiffSide::absent(".span/x", Absence::Missing),
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
        let header = DiffHeader::anchor(
            "e0f3bd75ca314e07".to_string(),
            NULL_ANCHOR_HASH.to_string(),
            AnchorDiffKind::Modify,
        );
        let out = render_unified_diff(
            &header,
            side("src.txt#L1-L2", "one\ntwo\n", 1),
            DiffSide::absent("src.txt#L1-L2", Absence::Missing),
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
        let header = DiffHeader::anchor(
            "1f1b7cf059444277".to_string(),
            "fd1a4e7a7c6a7eaf".to_string(),
            AnchorDiffKind::Modify,
        );
        let old = DiffSide::absent("f.txt#L3-L5", Absence::Missing);
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
        let header = DiffHeader::anchor(
            NULL_ANCHOR_HASH.to_string(),
            NULL_ANCHOR_HASH.to_string(),
            AnchorDiffKind::Modify,
        );
        assert_eq!(
            render_unified_diff(
                &header,
                DiffSide::absent("src.txt#L1-L2", Absence::Missing),
                DiffSide::absent("src.txt#L1-L2", Absence::Missing),
            ),
            None,
            "an anchor that was unavailable before and after did not change"
        );
    }

    /// The same two null hashes and the same two empty bodies as the test
    /// above, differing only in *why* each side has no content — and that
    /// difference is the entire event, so eliding the block would drop it from
    /// the record. The marker carries the transition because nothing else in a
    /// bodyless block can.
    #[test]
    fn two_absent_sides_with_different_reasons_are_a_change() {
        let header = DiffHeader::anchor(
            NULL_ANCHOR_HASH.to_string(),
            NULL_ANCHOR_HASH.to_string(),
            AnchorDiffKind::Modify,
        );
        assert_eq!(
            render_unified_diff(
                &header,
                DiffSide::absent("src.txt#L1-L2", Absence::RangePastEof),
                DiffSide::absent("src.txt#L1-L2", Absence::Missing),
            ),
            Some(
                "diff --git a/src.txt#L1-L2 b/src.txt#L1-L2\n\
                 content unavailable range-past-eof..absent\n\
                 index 0000000000000000..0000000000000000\n"
                    .to_string()
            ),
            "the reason moved, and it is the only thing that can have"
        );
    }

    #[test]
    fn binary_side_renders_gits_binary_line_instead_of_hunks() {
        let header = DiffHeader::anchor(
            "aaaaaaaaaaaaaaaa".to_string(),
            "bbbbbbbbbbbbbbbb".to_string(),
            AnchorDiffKind::Modify,
        );
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
        let header = DiffHeader::anchor(
            "aaaaaaaaaaaaaaaa".to_string(),
            "aaaaaaaaaaaaaaaa".to_string(),
            AnchorDiffKind::Modify,
        );
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
        let header = DiffHeader::anchor(
            "1111111111111111".to_string(),
            "2222222222222222".to_string(),
            AnchorDiffKind::Modify,
        );
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
