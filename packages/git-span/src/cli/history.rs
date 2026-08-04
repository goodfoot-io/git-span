//! `git span history <span>` — chronological timeline of a span, rendered as
//! git-log-style text (default) or JSON (`schema_version: 2`).
//!
//! # Output contract
//!
//! Both formats are newest-first. Every observable change is expressed once,
//! as a unified diff in git's dialect:
//!
//! * `span_diff` — the real git blob diff of the `.span/<name>` declaration
//!   between two states (this subsumes the old `why` field: why prose lives in
//!   the declaration).
//! * per-anchor diffs — pseudo-diffs between the anchor's *extracted
//!   snapshots*, with `path#Lstart-Lend` display paths, `index rk64:…` lines
//!   hashing the snapshots actually rendered, and real-file hunk coordinates.
//!   Anchors pair across consecutive states by identical content first, then
//!   by exact address, then by similarity (git's `-M` shape). Pairing is
//!   conditional on that similarity reaching [`RENAME_SIMILARITY_FLOOR`]: at
//!   or above it a moved anchor renders as one rename rather than remove +
//!   add, and two anchors that exchange addresses *with their content* render
//!   as two renames rather than two rewrites; below it the two snapshots are
//!   unrelated blocks and render as `deleted anchor` + `new anchor`, which
//!   asserts no edit. Git draws the same line — a `git mv` plus a total
//!   replacement renders `new file` + `deleted file` even at
//!   `--find-renames=0%`. The timeline and the `current` block apply the rule
//!   identically, so one declaration change describes the same event before and
//!   after it is committed.
//! * rebindings — an anchor's identity is the token the declaration *records*
//!   for its address ([`Snapshot::recorded`]), not the content that address
//!   happens to hold. A declaration that permutes bindings among addresses (a
//!   swap, a rotation) leaves every address and every byte in place, so no
//!   content comparison can see it, while breaking every anchor it touches.
//!   The test is per address and independent of content: an address that
//!   stood still while the token under it changed renders a `rebound anchor`
//!   block — header-only, with the two recorded tokens on the `index` line —
//!   and when that address was also edited, that block sits *beside* the
//!   ordinary content block, two objects at one address stating two
//!   independent facts. An anchor that *moved*, carrying its content to a new
//!   address, is not rebound: the rename block already accounts for it, and a
//!   rebinding beside it would claim damage the same render disproves.
//!
//! Two verdicts about a re-anchor must not be conflated. *Continuity
//! disproven* — both sides readable, similarity below the floor — means the
//! blocks are unrelated, and the render splits. *Continuity unknown* — the
//! recorded side is unrecoverable — disproves nothing: the move is asserted by
//! the user's own declaration, so the rename lines stay and only the
//! `similarity index` line is omitted. Splitting that case would fabricate two
//! events where one was declared; measuring it would fabricate a number.
//!
//! # Which commits are walked, and what each is diffed against
//!
//! Every commit that moved a seed path is walked, **merges included**, and each
//! entry is diffed against the state at its own **first parent** — never
//! against the entry the walk happened to print above it.
//!
//! Both halves are one rule, and each is useless alone. The walk is ordered by
//! commit *time*, which is not topology: two branch tips print adjacent to each
//! other with nothing between them, so pairing on the printed predecessor makes
//! each tip assert that it reverted the other's edit — signed lines for a
//! change no commit made, over lines `git diff` reports untouched. Skipping
//! merges hides the same fabrication one commit further along: the first commit
//! after a merge inherits the whole merged-in side as its own work.
//!
//! Merges are not skipped because there is nothing to skip them *for*. The
//! qualifying test compares each seed path's blob against `parent_ids.first()`
//! for any parent arity, so a merge qualifies exactly when it moved the
//! mainline at a seed path, and parent #1 is well defined for an octopus merge
//! too. The resolver never agreed with the exclusion either: `git span drift`
//! attributes drift to a merge without hesitation, so a span whose content
//! arrived through one had a finding pointing at a commit this command refused
//! to print.
//!
//! The correctness claim is stated without reference to the implementation: for
//! every rendered anchor block, every `-` line exists in the anchored file at
//! the commit's first parent and every `+` line exists in it at the commit
//! itself. `assert_no_fabricated_lines` in the integration tests is that
//! sentence, executable.
//!
//! # `current` covers every layer, and says which
//!
//! The `current` block is the span's *live* drift against its declaration, and
//! it is not working-tree-only: it covers every layer `git span drift`
//! reports because the resolver behind it is `drift`'s. Those layer names are
//! observations, not commit-status claims: `HEAD` can arise from content in
//! HEAD or from a worktree-only declaration re-anchor compared with HEAD's
//! declaration.
//!
//! It renders headerless, which is git's idiom for "outside the timeline" and
//! the honest claim here, since no single commit entry accounts for it. But a
//! headerless block cannot say by its *shape* which layer it came from, and the
//! the observations need different investigation before repair. In particular,
//! `HEAD` tells the reader to inspect the declaration and timeline; it does not
//! prove which side was committed.
//! So each block names its layers — `sources` in JSON, a `drift source` marker
//! line in the header — over `drift`'s own three values, as a list rather than a
//! scalar because one anchor is routinely drifted at more than one at once and a
//! scalar would have to drop the deeper face.
//!
//! The marker goes into the header both formats are built from, never appended
//! by [`render_human`]: appending it is the one design that breaks the
//! byte-identity between the human block and the JSON `diff` string, and it is
//! also how the below-threshold re-anchor split — the one shape built by a
//! different constructor — came to publish the key with no marker beside it.
//!
//! # Skip-condition inventory
//!
//! Every defect this module has shipped lived in a guard rather than in the
//! logic the guard admitted — the logic was right wherever it was allowed to
//! run. A state enumeration structurally cannot see those: an excluded case
//! never becomes a state. So the conditions under which a render component is
//! *skipped* are listed here, each with the fixture that exercises the
//! excluded case or a sentence for why the exclusion is sound. The value is
//! not proof; it is that the next guard added without either is conspicuous.
//!
//! A justification sentence carries one obligation: **if it asserts that a
//! state cannot arise, it must name what enforces that** — a fail-closed
//! validation, a type, a construction — or be demoted to a fixture. The rule
//! comes from a row here that read "no recorded token is ever the null hash",
//! which was simply false (`git span add` on an empty file records
//! `rk64:0000000000000000`). Nothing enforced it and nothing had to: the
//! sentence sounded like a reason, so the guard under it was never looked at
//! again. An inventory entry that launders a guard is worse than no entry.
//!
//! **Timeline path** ([`diff_section`], [`pair_anchors`]):
//!
//! | Skipped | Condition | Covered by |
//! |---|---|---|
//! | The whole section | Nothing observable changed — no span diff and no anchor blocks | `noop_qualifying_commit_is_dropped` |
//! | A commit | It touched no anchored file and not the declaration | The walk's qualifying filter; a commit that cannot affect any rendered state has nothing to render |
//! | The content block | `snapshot_diff` returns `None` (byte-identical sides) | `no_commit_that_breaks_an_anchor_is_anchor_silent` — the rebinding block still renders |
//! | The rebinding block | `old.recorded == new.recorded`, or there is no old side | An unchanged binding is not a rebinding; a first-add has nothing to have moved from |
//! | The rebinding block | The pair's two addresses differ | `anchors_that_swap_addresses_render_as_two_renames` — the rename beside it already accounts for the binding's movement |
//! | Pairing passes 1, 2, 4 | Either body is non-text | Deliberate: identical-content and similarity pairing need two comparable texts, and two anchors that both failed to extract must not pair as a 100% rename. Pass 3 (address) still catches them, so nothing goes unpaired *because* of this |
//! | The `similarity index` line | Either body is non-text ([`measured_similarity`]) | Unreachable here — see the `Modify`-vs-`Rename` arm in [`anchor_header`]; the option is passed through so a future pairing pass omits the number rather than inventing one |
//!
//! **Current-block path** ([`build_current`]):
//!
//! | Skipped | Condition | Covered by |
//! |---|---|---|
//! | The whole section | Worktree declaration matches `HEAD` and no anchor is drifted | `clean_worktree_has_no_current_section` |
//! | An anchor | The resolver reports it `Fresh` and its declared address did not move | A fresh anchor at an unmoved address has no drift to report; `git span drift` says the same |
//! | The rename form | Similarity measured below [`RENAME_SIMILARITY_FLOOR`] | `every_current_state`'s "declaration swap" and "cross-file swap" — splits into `deleted anchor` + `new anchor` |
//! | The `similarity index` line | Either side cannot be read as text ([`measured_similarity`]) — an unrecoverable recorded side, or a binary snapshot | `an_unmeasurable_reanchor_states_the_move_and_no_similarity`, plus `a_binary_recorded_side_is_recovered_not_declared_lost` |
//! | Hunks | Either side's content could not be produced by its filter (`Absence::suppresses_hunks`) — `a_filter_that_produces_no_content_never_asserts_a_deletion`. Content that was never read cannot stand opposite content that was: the hunk spells the unread half out as a deletion of lines `git diff` reports untouched |
//! | Hunks | The recorded side is unrecoverable, either side is binary (the renderer's `Binary files … differ` line), or a rename/proposal whose content is unchanged | `an_unrecoverable_recorded_snapshot_is_named_in_the_human_block`; hunks need two comparable bodies and synthesizing one presents it as the other's content |
//! | Hunks, on a rename block | Either side is bodyless — absent, or a declared range past end of file | `a_reanchor_past_end_of_file_is_unavailable_not_empty_content`. Signed lines against a side that has no bytes assert edits `git diff` cannot be asked about; the rename lines still state the move the declaration asserts |
//! | The live `content` payload | The live bytes are not UTF-8 — classified `unavailable: "binary"` by [`read_location_body`], the same policy as [`read_anchor_at_commit`] | `a_binary_live_side_is_structural_never_lossy_prose` — a lossy decode is prose wearing content's key |
//! | The live `content` payload | The declared range starts past the file's end — classified `unavailable: "range-past-eof"` by [`read_location_body`] via [`crate::git::slice_line_range`], which *is* the commit path's slice | `a_reanchor_past_end_of_file_is_unavailable_not_empty_content`, `a_truncated_file_is_past_eof_not_absent`, `both_read_paths_give_one_account_of_a_past_eof_range`. A range that merely overlaps the end is clipped, not skipped — only a range with no overlap at all has nothing to show |
//! | Reading the live location at all | The resolver bound no live location ([`build_current`]'s `None` arm) | `a_truncated_file_is_past_eof_not_absent`. The reason is then asked of the *declared* address directly ([`unresolved_reason`]) instead of being assumed: "the resolver found nothing" and "there is no such file" are different facts, and only the second is `absent` |
//! | A token-index entry | The snapshot has no body — [`Unavailable::Absent`], [`Unavailable::RangePastEof`], or [`Unavailable::FilterFailed`] ([`capture_by_hash`]) | Deliberate, and read from the *body*, not from the hash: a recorded token **can** be the null hash (`git span add` on an empty file records `rk64:0000000000000000`), so an empty-extent anchor is now indexed like any other. Measured benign before the change and correct after — positional candidates compare by hash equality, so same-address drift on an empty extent renders an honest hunk either way. A *binary* snapshot's real fingerprint stays indexed — `a_binary_recorded_side_is_recovered_not_declared_lost` is the fixture the old text-gate failed |
//! | A timeline entry | The two sides have equal bodies **and** the same reason for having none ([`crate::cli::unified_diff::render`]) | `a_change_of_unavailable_reason_renders_an_entry`. Two bodyless sides used to compare equal whatever they were: truncating a file past its declared range and then deleting the file is a change the render dropped entirely. Narrow on purpose — only two *both-bodyless* sides with differing reasons count; nothing else about change detection reads a reason |
//! | The rebinding block | Always — this path never renders one | Deliberate: a rebinding is a transition between two *committed* declaration states. The current block already renders a committed rebinding's live drift honestly, one in-place diff per anchor |
//!
//! Declared anchor ranges are taken at face value at every commit — a stale
//! range extracting "wrong" content *is* the drift being visualized. Anchor
//! diffs are always computed between extracted snapshots, never by clipping a
//! file's real commit patch to a line range.
//!
//! Content that cannot be extracted is *structural*, never prose: an absent
//! file, an out-of-range extent, or a filter that produced no content renders
//! as a true `/dev/null` side, binary content as git's `Binary files … differ`
//! line, and JSON marks the reason in a dedicated `unavailable` field. A
//! placeholder string in a hunk body would corrupt the hunk arithmetic and
//! paint the placeholder as source.
//!
//! The `/dev/null` side says there are no bytes, and that is *all* it says —
//! which left the two reasons for having none rendering byte-identically in the
//! default output, hunk included. `unavailable` remains the contract for why,
//! but it is a JSON field, and the default output is text; a reader of the
//! command as most people run it could not tell a deleted file from a range
//! that starts past the end of a file sitting on disk, and the two want
//! opposite repairs. So the header carries a non-contractual
//! `content unavailable <reason>` line naming the reason the `/dev/null`
//! side cannot — git's `Binary files … differ` is the precedent for a dedicated
//! sentence, and the constraint against prose in the *body* is untouched.
//!
//! # One read, or two accounts of one file
//!
//! The live body and the token beside it come from a **single** read
//! ([`live_snapshot`] over [`read_live_bytes`]). They used to come from two —
//! the hash through gix's `convert_to_git` plus any configured filter driver,
//! the body from a plain `std::fs::read` — with a comment here calling the
//! difference unobservable because only a worktree-only read reaches both
//! fallbacks and CRLF changes no rendered line. A `.gitattributes` `filter`
//! line is the case that argument did not have: with `filter=lfs` and a file
//! nobody had touched, the header named the fingerprint of the pointer's first
//! two lines while `content` printed the user's own first two lines, whose
//! token sat on the *old* side of that same `index` line. The converted bytes
//! win, because the `index` line's promise is the stronger one: it names the
//! token a re-anchor would record, and a re-anchor records what git stores.
//!
//! A read that *fails* is a reason, never a fallback. The hash path used to
//! swallow a filter failure into a raw read, answering "what would git record
//! here?" with bytes git would never record. `git span add` refuses to declare
//! a range it cannot read; the render path is held to the same policy, and the
//! failure travels as [`Unavailable::FilterFailed`].
//!
//! # The null hash is an ambiguous value
//!
//! `NULL_ANCHOR_HASH` means five different things, all of them reachable: an
//! absent file, a declared range past end of file, a filter that produced no
//! content, the `/dev/null` side of a genuine create or delete, and a
//! *genuinely empty recorded extent* (`git span add` on an empty file). None of
//! the five is prevented by anything, and no
//! justification anywhere may claim otherwise. Three consumers were each caught
//! reading state back out of it: [`capture_by_hash`] (skipped a real token),
//! change detection in [`crate::cli::unified_diff::render`] (compared null to
//! null and dropped a commit), and the `new anchor` header dialect (announced a
//! creation against a declaration whose recorded token the same output prints).
//!
//! So the reason travels *with* the state — [`Unavailable`] into
//! [`crate::cli::unified_diff::Absence`] — and the hash is written from the
//! body ([`live_hash`]), never read back to infer one. Any future code that
//! asks a null hash what happened is asking an ambiguous value.
//!
//! That answers the question of whether an empty recorded extent and an
//! unreadable one need distinguishing in the output: they do, and they are
//! distinguished structurally rather than by any new field. An empty extent is
//! honest content and keeps `content: ""` with no `unavailable`; an unreadable
//! one drops `content` and names its reason. `git span history` is the same
//! shape it was — the states stopped colliding, not the schema.
//! `every_null_hash_state_is_distinguishable_from_structured_fields` holds the
//! line, enumerated by *route* rather than by state so that a fix reaching one
//! path and not the other cannot pass.

use crate::cli::format::format_anchor_address;
use crate::cli::unified_diff::{
    Absence, AnchorDiffKind, BlobDiffKind, DiffHeader, DiffSide, NULL_ANCHOR_HASH, NULL_BLOB_OID7,
    render_diff_header, render_unified_diff, render_unified_diff_always, similarity,
};
use crate::cli::{CliError, HistoryArgs, HistoryFormat, NextStep};
use crate::span::read::read_span_at_in;
use crate::types::{Anchor, AnchorExtent, AnchorLocation, Span};
use anyhow::Result;
use serde_json::{Value, json};
use std::rc::Rc;

/// Similarity floor for pairing a dropped anchor with an added one as a
/// rename. Git's own `-M` default.
const RENAME_SIMILARITY_FLOOR: u8 = 50;

// ---------------------------------------------------------------------------
// Internal data model (drives both renderers — text and JSON cannot diverge)
// ---------------------------------------------------------------------------

/// The full computed history of one span, ready to render in any format.
pub struct HistoryReport {
    /// Span name as passed to the command.
    pub span: String,
    /// `true` when the rendered timeline is a scoped/partial view of history:
    /// `--limit` dropped older *rendered entries* that exist before the window.
    /// The retained entries still diff against the true prior span state (they
    /// were built from the complete walk), but a consumer must not read the
    /// window as the complete record.
    pub scoped: bool,
    /// Commit sections, ordered oldest → newest. No-op commits (nothing
    /// observable changed) are already dropped before this point. Both
    /// renderers reverse to newest-first.
    pub commits: Vec<CommitSection>,
    /// Optional current-drift section (omitted when nothing drifts and the
    /// working tree declaration matches HEAD).
    pub current: Option<CurrentSection>,
}

/// One commit in the history where the span changed observably.
pub struct CommitSection {
    /// Full 40-hex OID of the commit.
    pub hash: String,
    /// Author date as a full ISO-8601 timestamp with offset (JSON `date`).
    pub date: String,
    /// Author date in git's own default rendering
    /// (`Thu Jul 30 12:04:37 2026 -0400`) — the human format's `Date:` line.
    pub date_git: String,
    /// First line of the commit message.
    pub summary: String,
    /// Blob diff of the `.span/<name>` declaration between the previous
    /// rendered state's commit and this one. Present iff the declaration blob
    /// changed.
    pub span_diff: Option<String>,
    /// Anchor changes at this commit, in the new state's declaration order,
    /// with deletions appended in the old state's declaration order.
    pub anchors: Vec<TimelineAnchor>,
}

/// Why an anchor's content could not be rendered at some point in time.
///
/// This is the JSON `unavailable` field's vocabulary, and the *only* place
/// such a condition is described in words — never in a hunk body or a
/// `content` value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Unavailable {
    /// The anchored file does not exist at this commit / in the working tree.
    Absent,
    /// The file exists but the declared line range starts past its end.
    RangePastEof,
    /// The content exists but is not UTF-8 text.
    Binary,
    /// The file is present and its content could not be produced: a
    /// `.gitattributes` line names a filter whose driver is missing,
    /// unconfigured, or unable to run.
    ///
    /// The resolver has always computed this
    /// ([`crate::types::UnavailableReason::FilterFailed`], which `git span
    /// drift` prints as `content unavailable (filter failed)`); this enum did
    /// not carry it, so it collapsed into [`Unavailable::Absent`] and the
    /// output said "no such file at this commit" about a file with readable
    /// lines in it — under a deletion hunk for lines `git diff` reported
    /// untouched.
    FilterFailed,
    /// The declared path is unreachable because it is at or beneath a
    /// submodule gitlink.
    Submodule,
}

impl Unavailable {
    /// The JSON token for this reason.
    fn as_str(self) -> &'static str {
        match self {
            Unavailable::Absent => "absent",
            Unavailable::RangePastEof => "range-past-eof",
            Unavailable::Binary => "binary",
            Unavailable::FilterFailed => "filter-failed",
            Unavailable::Submodule => "submodule",
        }
    }
}

/// One anchor's change record within a commit section.
///
/// `diff` is mandatory, so a timeline anchor always carries a payload.
pub struct TimelineAnchor {
    /// Combined git-span address (`path#L<start>-L<end>` or a bare path for
    /// whole-file anchors) *after* the change; for a removal, the last address
    /// the anchor held.
    pub path: String,
    /// The rendered unified diff for this change. Always present: for a
    /// first-add it is the synthesized `new anchor` addition diff, which the
    /// human format prints and the JSON format replaces with `content`.
    pub diff: String,
    /// Full snapshot text, present only for a first-add whose content was
    /// extractable. When present, the JSON emitter writes `content` *instead
    /// of* `diff`.
    pub content: Option<String>,
    /// Set when the anchor's new-side content could not be extracted. JSON
    /// emits it as `unavailable`; it never becomes body text.
    pub unavailable: Option<Unavailable>,
    /// Present exactly on a `rebound anchor` block, carrying the recorded-token
    /// transition as data (JSON `rebound: { from, to }`).
    ///
    /// This is the block's structured discriminator. Two objects in one
    /// entry's `anchors` array can share a `path` — a rebinding and a content
    /// edit at the same address in the same commit — so block identity is the
    /// pair `(path, form)`, and without this field "form" would only be
    /// readable by scanning the `diff` string for a marker line. That scan is
    /// a live false-positive class: a repository whose own tracked source
    /// contains the phrase `rebound anchor` would produce it inside ordinary
    /// hunk bodies.
    pub rebound: Option<Rebinding>,
}

/// The recorded-token transition a [`TimelineAnchor::rebound`] block reports,
/// in the same `rk64:`-prefixed spelling the `.span` declaration uses, so a
/// consumer can join either side against the declaration file directly.
pub struct Rebinding {
    /// The token the previous state's declaration recorded at this address.
    pub from: String,
    /// The token this state's declaration records at this address.
    pub to: String,
}

impl TimelineAnchor {
    /// Build a timeline entry. `first_add` carries the new side's body when
    /// this is the anchor's first appearance (the only case that ships a full
    /// `content` snapshot); pass `None` otherwise.
    fn new(path: String, diff: String, new_body: Option<&AnchorBody>, first_add: bool) -> Self {
        let unavailable = new_body.and_then(AnchorBody::unavailable);
        let content = match (first_add, new_body) {
            (true, Some(AnchorBody::Text(t))) => Some(t.clone()),
            _ => None,
        };
        TimelineAnchor {
            path,
            diff,
            content,
            unavailable,
            rebound: None,
        }
    }

    /// Build the `rebound anchor` entry for one address, carrying the token
    /// transition both as the patch string's `index` line and as structured
    /// fields. The two must never disagree — they are rendered from the same
    /// pair of tokens.
    fn rebound(path: String, diff: String, from: String, to: String) -> Self {
        TimelineAnchor {
            path,
            diff,
            content: None,
            unavailable: None,
            rebound: Some(Rebinding { from, to }),
        }
    }
}

/// The optional current-drift section: how the live span differs from its last
/// recorded state, at whichever layer produced the difference.
pub struct CurrentSection {
    /// Blob diff of the `.span/<name>` declaration between HEAD and the
    /// working tree (covering why edits and anchor add/remove alike). Present
    /// iff the worktree bytes differ from HEAD.
    pub span_diff: Option<String>,
    /// Anchors the resolver reports as non-`Fresh` (plus any anchor whose
    /// declared address moved in the worktree declaration), in resolver
    /// order.
    pub anchors: Vec<CurrentAnchor>,
}

/// One anchor's drift record in the current section.
///
/// Both payloads are mandatory by construction: `diff` is always rendered
/// (header-only when content is byte-identical but the recorded hash is
/// drifted — that mismatch *is* the finding), and exactly one of
/// `content`/`unavailable` describes the live snapshot. This is what keeps
/// the human and JSON renderers emitting the same entry set: an anchor that
/// `git span drift` reports can never silently vanish from the default
/// output.
pub struct CurrentAnchor {
    /// The anchor's **declared** address — the same string `git span drift`
    /// prints, and the only join key a consumer can match against the `.span`
    /// file. Never the resolver's proposal.
    pub path: String,
    /// Where the resolver believes the anchored content now lives, when that
    /// differs from `path`. A *proposal* (`git span drift --fix` would write
    /// it), not an accomplished move — so it never renders as `rename to`.
    pub proposed: Option<String>,
    /// Diff from the anchor's last recorded state to its live content.
    pub diff: String,
    /// Full live content of the anchor; `None` exactly when `unavailable` is
    /// set.
    pub content: Option<String>,
    /// Why the live content could not be extracted; `None` exactly when
    /// `content` is set.
    pub unavailable: Option<Unavailable>,
    /// `true` exactly when no snapshot in this render's snapshot set hashes to
    /// the declaration's recorded token — the bytes it names were never carried
    /// by any state the report shows. The diff is then a header block alone,
    /// carrying [`RECORDED_UNRECOVERABLE`]: there is a real drift to report
    /// (the two `index` hashes differ) but no honest "before" text to show.
    ///
    /// The search runs by content hash across every rendered snapshot, so the
    /// field cannot claim a loss the same output disproves twenty lines lower.
    /// It never co-occurs with `proposed`: a relocation's live snapshot hashes
    /// to the recorded token by definition, so that old side is always
    /// recoverable.
    pub recorded_unrecoverable: bool,
    /// Every layer that shows drift for this anchor, taken from the resolver's
    /// own extent-dependent `layer_sources` sequence — the same list `git span
    /// drift` turns into one finding per entry. Line ranges use Worktree → Index
    /// → Head; whole files use Index → Worktree → Head. JSON emits it as
    /// `sources` over `drift`'s exact strings (`HEAD` / `INDEX` / `WORKTREE`),
    /// and the diff header carries the lowercase [`DRIFT_SOURCE`] marker built
    /// from it, so both formats name the same layers in the same order.
    ///
    /// Empty exactly when the resolver reports no layer, and the key is then
    /// **omitted** rather than emitted as `[]` or `null` — key presence is how
    /// `current.anchors[]` spells absence throughout, and this is history's
    /// spelling of `drift`'s `"source": null`.
    ///
    /// A *list* and not a scalar because one anchor can drift at more than one
    /// layer at once: distinct observations at HEAD and in the working tree
    /// make `drift` emit two findings for one anchor, and
    /// `current.anchors[]` carries one object per anchor, so a scalar would
    /// silently drop the `HEAD` face of every composed drift — the same class
    /// of loss this field exists to repair, one level down.
    ///
    /// Independent of [`CurrentAnchor::unavailable`] in both directions: an
    /// unreadable anchor still drifts at a layer, and a readable one may not
    /// drift at any.
    pub sources: Vec<crate::types::DriftSource>,
}

impl CurrentAnchor {
    /// Build a current-section entry. `content`/`unavailable` are derived from
    /// `body`, so exactly one of them is always populated and the "both
    /// payloads present" contract cannot be violated by a caller.
    fn new(
        path: String,
        proposed: Option<String>,
        diff: String,
        body: &AnchorBody,
        recorded_unrecoverable: bool,
        sources: Vec<crate::types::DriftSource>,
    ) -> Self {
        CurrentAnchor {
            path,
            proposed,
            diff,
            content: match body {
                AnchorBody::Text(t) => Some(t.clone()),
                AnchorBody::Unavailable(_) => None,
            },
            unavailable: body.unavailable(),
            recorded_unrecoverable,
            sources,
        }
    }
}

/// Content of an anchor at a specific point in time.
///
/// [`AnchorBody::Unavailable`] is an internal *signal*, not text: it never
/// reaches a hunk body, a `content` value, or a similarity computation.
#[derive(Clone, PartialEq, Eq)]
pub enum AnchorBody {
    /// Normal source text extracted from the blob.
    Text(String),
    /// The content could not be extracted. Renders as a structurally absent
    /// side (or git's binary line), and surfaces in JSON as `unavailable`.
    Unavailable(Unavailable),
}

impl AnchorBody {
    /// The renderable text — empty for an unavailable body, so a placeholder
    /// can never be mistaken for source.
    fn text(&self) -> &str {
        match self {
            AnchorBody::Text(s) => s,
            AnchorBody::Unavailable(_) => "",
        }
    }

    fn unavailable(&self) -> Option<Unavailable> {
        match self {
            AnchorBody::Text(_) => None,
            AnchorBody::Unavailable(u) => Some(*u),
        }
    }

    /// True for extractable content. Only such bodies take part in
    /// content-identity and similarity pairing: an absence is not content, and
    /// two absences are not the same content.
    fn is_text(&self) -> bool {
        matches!(self, AnchorBody::Text(_))
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git span history <span>`.
///
/// Builds a [`HistoryReport`] by walking the span's git history in two passes,
/// then renders it via [`render_human`] or [`render_json`] according to
/// `args.format`. Returns exit code `0` on success, `1` on a hard error.
///
/// Error/not-found mapping follows the same conventions as `run_show` in
/// `show.rs`.
pub fn run_history(repo: &gix::Repository, args: HistoryArgs, span_root: &str) -> Result<i32> {
    crate::git::reject_replacement_topology(repo)?;
    let span_path = format!("{span_root}/{}", args.span);

    // Pass 1 — walk the declaration alone, unlimited, to learn every path the
    // span ever anchored. Without this, a commit that edits an anchored file
    // without touching the declaration is invisible and its content change
    // silently folds into the next declaration-touching commit.
    let decl_commits = {
        let _perf = crate::perf::span("history.walk.declaration");
        crate::git::git_log_name_only_for_paths(repo, usize::MAX, std::slice::from_ref(&span_path))?
    };

    // Declarations parsed once per commit, shared between this pass and
    // `build_report`'s state materialization so the same commit's `.span`
    // blob is never parsed twice.
    let mut spans_at: std::collections::HashMap<String, Option<Rc<Span>>> =
        std::collections::HashMap::new();

    let mut seed_paths: Vec<String> = vec![span_path.clone()];
    {
        let _perf = crate::perf::span("history.walk.anchored-paths");
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for cc in &decl_commits {
            let parsed = match read_span_at_in(repo, &args.span, Some(&cc.hash), span_root) {
                Ok(m) => Some(Rc::new(m)),
                Err(crate::Error::SpanNotFound(_)) => None,
                Err(e) => return Err(e.into()),
            };
            let parsed = spans_at.entry(cc.hash.clone()).or_insert(parsed);
            let Some(span) = parsed else { continue };
            for (_id, a) in &span.anchors {
                if seen.insert(a.path.clone()) {
                    seed_paths.push(a.path.clone());
                }
            }
        }
    }

    // Pass 2 — walk the union of the declaration and every anchored path,
    // *unbounded*. `--limit` scopes the rendered entries, not the walk: a
    // narrow anchor in a busy file yields many qualifying commits that change
    // nothing observable, and a walk-side cap would fill the window with those
    // and print nothing at all.
    let mut commits = {
        let _perf = crate::perf::span("history.walk");
        crate::git::git_log_name_only_for_paths(repo, usize::MAX, &seed_paths)?
    };

    // The walk yields newest-first; the timeline is *built* oldest→newest
    // (baseline seeding requires it) and reversed again at render time.
    commits.reverse();

    // Verify the span actually exists somewhere in scope. An empty walk for a
    // never-committed name is a not-found error (mirrors `run_show`).
    if commits.is_empty() {
        // The span may exist only in the worktree (uncommitted). Probe HEAD /
        // worktree before declaring it missing.
        if !names_a_span(repo, &args.span, Some("HEAD"), span_root)
            && !names_a_span(repo, &args.span, None, span_root)
        {
            return Err(not_found_error(repo, &args.span, span_root, &span_path).into());
        }
    }

    let report = {
        let _perf = crate::perf::span("history.build-report");
        build_report(
            repo,
            &args.span,
            span_root,
            &span_path,
            &commits,
            args.limit,
            &mut spans_at,
        )?
    };

    // Fail-closed in spirit: a scoped/partial window must never read as the
    // complete record. `--limit` is an explicit user scope, so we still render
    // and exit 0 — but warn to stderr that older span history exists before
    // the window.
    if report.scoped {
        eprintln!(
            "warning: history is scoped — `--limit` dropped older commits; \
             this is a partial timeline, not the complete record"
        );
    }

    let _perf = crate::perf::span("history.render");
    // Write through one buffered, locked handle: routing a multi-megabyte
    // document through `print!`'s line-buffered stdout flushes per newline.
    // The bytes emitted are identical to the previous `print!`/`println!`.
    use std::io::Write as _;
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    match args.format {
        HistoryFormat::Human => {
            out.write_all(render_human(&report).as_bytes())?;
        }
        HistoryFormat::Json => {
            serde_json::to_writer_pretty(&mut out, &render_json(&report))?;
            out.write_all(b"\n")?;
        }
    }
    out.flush()?;
    Ok(0)
}

/// True when `name` reads as a span at `rev` (or in the working tree when
/// `rev` is `None`).
///
/// Any failure answers "no": a `.span/` *directory* — a namespace like
/// `agent-hooks` — is a tree, not a span, and so is anything else that will
/// not parse as one. Both deserve the curated not-found error below rather
/// than a raw object-store message.
fn names_a_span(repo: &gix::Repository, name: &str, rev: Option<&str>, span_root: &str) -> bool {
    read_span_at_in(repo, name, rev, span_root).is_ok()
}

/// Build the not-found error for a name that names no span.
///
/// A very common miss is passing a *namespace* (`git span history agent-hooks`
/// when the spans are `agent-hooks/…`), so when spans exist under `<name>/` the
/// error says so and names them instead of sending the user to `git span list`.
fn not_found_error(
    repo: &gix::Repository,
    name: &str,
    span_root: &str,
    span_path: &str,
) -> CliError {
    let prefix = format!("{}/", name.trim_end_matches('/'));
    let under_prefix: Vec<String> = crate::span::read::list_span_names_in(repo, span_root)
        .unwrap_or_default()
        .into_iter()
        .filter(|n| n.starts_with(&prefix))
        .collect();

    if !under_prefix.is_empty() {
        let shown: Vec<String> = under_prefix.iter().take(5).cloned().collect();
        return CliError {
            subcommand: "history",
            summary: format!("`{name}` is a span namespace, not a span."),
            what_happened: format!(
                "No span is named `{name}`, but {} span(s) live under `{prefix}`: {}. \
                 `git span history` walks one span at a time.",
                under_prefix.len(),
                shown.join(", ")
            ),
            next_steps: shown
                .into_iter()
                .map(|n| NextStep::Bash(format!("git span history {n}")))
                .collect(),
        };
    }

    CliError {
        subcommand: "history",
        summary: format!("no span named `{name}`."),
        what_happened: format!(
            "No commit in the current history touched `{span_path}`, and the \
             span does not exist in the working tree or at HEAD."
        ),
        next_steps: vec![NextStep::Bash("git span list".into())],
    }
}

// ---------------------------------------------------------------------------
// State materialization
// ---------------------------------------------------------------------------

/// One anchor's extracted snapshot at a point in history: everything the
/// unified-diff renderer needs for one side of an anchor pseudo-diff.
#[derive(Clone)]
struct Snapshot {
    /// Declared address (`path#Lstart-Lend` or a bare path).
    address: String,
    /// 1-based first line of the snapshot in its real file (`1` for
    /// whole-file anchors), so hunk headers carry real file coordinates.
    first_line: u32,
    /// Bare `rk64` hex **of the bytes this snapshot renders** — not the
    /// declaration's recorded token. One hashing convention across the whole
    /// command means `index X..X` above a non-empty hunk is impossible.
    /// [`NULL_ANCHOR_HASH`] when the content is unavailable.
    hash: String,
    /// Extracted body at the declared address, taken at face value.
    body: AnchorBody,
    /// The bare `rk64` token the declaration *records* for this address at
    /// this state — the anchor's identity, as opposed to `hash`, which is
    /// whatever the address happens to hold. Pairing keyed on address and
    /// content alone cannot see a rebinding: a permutation of declarations
    /// preserves both, so the commit that broke every affected anchor showed
    /// no anchor-level change at all.
    recorded: String,
}

/// The span's state rendered at a point in history: the commit it was read at
/// plus each anchor's extracted snapshot, in declaration order.
///
/// Snapshots are behind [`Rc`] because one state's anchors are shared into
/// the capture maps ([`capture_recorded_snapshots`], [`capture_by_hash`])
/// while the state itself keeps flowing through pairing and diffing — a
/// share, not a copy: anchor bodies carry full content strings, and cloning
/// them per walked commit was the dominant allocation of `build-report`.
#[derive(Clone)]
struct RenderedState {
    commit: String,
    anchors: Vec<Rc<Snapshot>>,
}

/// Render the address for an anchor's extent.
fn anchor_address(a: &Anchor) -> String {
    match a.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&a.path, Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&a.path, None, None),
    }
}

/// 1-based first line of an extent in its file.
fn extent_first_line(extent: AnchorExtent) -> u32 {
    match extent {
        AnchorExtent::LineRange { start, .. } => start,
        AnchorExtent::WholeFile => 1,
    }
}

/// Strip the algorithm prefix from a stored hash token (`rk64:<hex>` →
/// `<hex>`); the renderer re-applies the `rk64:` prefix itself.
fn bare_hash(stored_hash: &str) -> String {
    match stored_hash.split_once(':') {
        Some((_algo, hex)) => hex.to_string(),
        None => stored_hash.to_string(),
    }
}

/// The `rk64` content hash of `bytes` under `extent` — the same
/// `git_span_core` fingerprint the declaration records and the resolver
/// compares, so a rendered `index` line is directly comparable with a
/// declaration token.
fn extent_hash(bytes: &[u8], extent: &AnchorExtent) -> String {
    git_span_core::rk64_to_hex(git_span_core::cheap_fingerprint_with_extent(bytes, extent))
}

/// Re-derive a snapshot body's fingerprint from the body itself.
///
/// The recorded-hash oracle is only worth stating if it can fail, and
/// comparing stored [`Snapshot::hash`] fields against the recorded token
/// merely restates the predicate that selected the candidate. Hashing the
/// *bytes the old side will render* is a different claim: it catches a
/// snapshot whose body and hash have drifted apart, which is exactly the
/// failure that would put unvouched-for content on an old side.
///
/// Fingerprints canonicalize to `lines[start..=end].join("\n")`, so a body
/// lifted out of its file hashes identically at line 1 as it did at its real
/// first line — which is why an anchor's content can be recognized after it
/// moves. Whole-file anchors hash their raw bytes and are re-derived that way.
fn body_fingerprint(address: &str, text: &str) -> String {
    let extent = if address.contains("#L") {
        AnchorExtent::LineRange {
            start: 1,
            end: u32::try_from(text.lines().count()).unwrap_or(u32::MAX),
        }
    } else {
        AnchorExtent::WholeFile
    };
    extent_hash(text.as_bytes(), &extent)
}

/// Read an anchor's body *and* the hash of the bytes it renders from a
/// specific commit's tree, degrading per-anchor (never aborting the whole
/// report) on missing files, out-of-range line anchors, or non-UTF-8 content.
///
/// An unavailable body carries the null hash: there is nothing to fingerprint.
fn read_anchor_at_commit(
    repo: &gix::Repository,
    commit_oid: &str,
    a: &Anchor,
) -> (AnchorBody, String) {
    fn missing(u: Unavailable) -> (AnchorBody, String) {
        (AnchorBody::Unavailable(u), NULL_ANCHOR_HASH.to_string())
    }

    let Ok(blob_oid) = crate::git::path_blob_at(repo, commit_oid, &a.path) else {
        return missing(Unavailable::Absent);
    };
    let Ok(file_bytes) = crate::git::read_blob_bytes(repo, &blob_oid) else {
        return missing(Unavailable::Absent);
    };
    let hash = extent_hash(&file_bytes, &a.extent);

    let body = match a.extent {
        AnchorExtent::LineRange { start, end } => {
            match crate::git::extract_blob_lines(repo, &blob_oid, start, end) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => AnchorBody::Text(text),
                    Err(_) => AnchorBody::Unavailable(Unavailable::Binary),
                },
                Err(crate::Error::InvalidAnchor { .. }) => {
                    return missing(Unavailable::RangePastEof);
                }
                Err(crate::Error::Parse(_)) => AnchorBody::Unavailable(Unavailable::Binary),
                Err(_) => return missing(Unavailable::Absent),
            }
        }
        AnchorExtent::WholeFile => match String::from_utf8(file_bytes.clone()) {
            Ok(text) => AnchorBody::Text(text),
            Err(_) => AnchorBody::Unavailable(Unavailable::Binary),
        },
    };
    // Binary content still has a real fingerprint — only its *body* is
    // unrenderable, and the `index` line is then the sole change signal.
    (body, hash)
}

/// The span's rendered state at a commit, reading the declaration as that
/// commit had it.
///
/// A commit that predates the span, or one in a deleted-then-re-added gap, has
/// no declaration and renders as an empty state — the same reading
/// [`build_report`] gives a missing span on the walk itself, so a first-add
/// against a parent that had no `.span` file still renders as a creation.
fn state_at_commit(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    commit_oid: &str,
    spans_at: &mut std::collections::HashMap<String, Option<Rc<Span>>>,
) -> Result<RenderedState> {
    // `spans_at` memoizes the declaration parse per commit; the discovery
    // pass in `run_history` seeds it, so a declaration-touching commit is
    // parsed exactly once across both passes.
    let span = match spans_at.get(commit_oid) {
        Some(cached) => cached.clone(),
        None => {
            let parsed = match read_span_at_in(repo, span_name, Some(commit_oid), span_root) {
                Ok(m) => Some(Rc::new(m)),
                Err(crate::Error::SpanNotFound(_)) => None,
                Err(e) => return Err(e.into()),
            };
            spans_at.insert(commit_oid.to_string(), parsed.clone());
            parsed
        }
    };
    Ok(match span {
        Some(m) => rendered_state_at(repo, commit_oid, &m),
        None => RenderedState {
            commit: commit_oid.to_string(),
            anchors: Vec::new(),
        },
    })
}

/// Build the rendered state for a span at a commit.
fn rendered_state_at(repo: &gix::Repository, commit_oid: &str, span: &Span) -> RenderedState {
    let mut anchors = Vec::with_capacity(span.anchors.len());
    for (_id, a) in &span.anchors {
        let (body, hash) = read_anchor_at_commit(repo, commit_oid, a);
        anchors.push(Rc::new(Snapshot {
            address: anchor_address(a),
            first_line: extent_first_line(a.extent),
            hash,
            body,
            recorded: bare_hash(&a.stored_hash),
        }));
    }
    RenderedState {
        commit: commit_oid.to_string(),
        anchors,
    }
}

// ---------------------------------------------------------------------------
// Diff production
// ---------------------------------------------------------------------------

/// A blob's OID and text at some revision.
struct BlobAt {
    oid: String,
    text: String,
}

/// Read `path`'s blob OID and text from a commit's tree; `None` when the path
/// is absent there.
fn blob_at(repo: &gix::Repository, commit_oid: &str, path: &str) -> Option<BlobAt> {
    let oid = crate::git::path_blob_at(repo, commit_oid, path).ok()?;
    let bytes = crate::git::read_blob_bytes(repo, &oid).ok()?;
    Some(BlobAt {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        oid,
    })
}

/// Render the declaration's blob diff between two optional sides, in git's own
/// file dialect: an absent side becomes `new file mode` / `deleted file mode`
/// with a bare `index` line and the real path on both `diff --git` halves.
/// Returns `None` when both sides are absent or byte-identical.
fn blob_diff(path: &str, old: Option<&BlobAt>, new: Option<&BlobAt>) -> Option<String> {
    let kind = match (old, new) {
        (None, None) => return None,
        (None, Some(_)) => BlobDiffKind::Added,
        (Some(_), None) => BlobDiffKind::Deleted,
        (Some(_), Some(_)) => BlobDiffKind::Modified,
    };
    let abbrev = |b: Option<&BlobAt>| match b {
        Some(b) => b.oid.chars().take(7).collect::<String>(),
        None => NULL_BLOB_OID7.to_string(),
    };
    let header = DiffHeader::Blob {
        old_oid7: abbrev(old),
        new_oid7: abbrev(new),
        kind,
    };
    render_unified_diff(&header, blob_side(path, old), blob_side(path, new))
}

/// One side of a declaration blob diff. Git names the real path on both sides
/// of a `diff --git` line even for an add or a delete, so an absent blob keeps
/// the path and is marked absent instead of relabelled `/dev/null`.
fn blob_side<'a>(path: &str, blob: Option<&'a BlobAt>) -> DiffSide<'a> {
    match blob {
        Some(b) => DiffSide::present(path, b.text.as_str(), 1),
        // A declaration blob is a whole file: it is there or it is not, and no
        // line range can overrun it.
        None => DiffSide::absent(path, Absence::Missing),
    }
}

/// One side of an anchor pseudo-diff, with unavailability mapped to the
/// renderer's structural side states rather than to substituted prose.
///
/// The [`Unavailable`] reason travels across the boundary as an [`Absence`]
/// rather than being flattened: both reasons render as a `/dev/null` side, so
/// dropping the distinction here left the renderer unable to see that anything
/// had changed when an anchor moved from one to the other.
fn snapshot_side(s: &Snapshot) -> DiffSide<'_> {
    match &s.body {
        AnchorBody::Text(text) => DiffSide::present(s.address.clone(), text, s.first_line),
        AnchorBody::Unavailable(Unavailable::Binary) => DiffSide::binary(s.address.clone()),
        AnchorBody::Unavailable(Unavailable::RangePastEof) => {
            DiffSide::absent(s.address.clone(), Absence::RangePastEof)
        }
        AnchorBody::Unavailable(Unavailable::Absent) => {
            DiffSide::absent(s.address.clone(), Absence::Missing)
        }
        AnchorBody::Unavailable(Unavailable::FilterFailed) => {
            DiffSide::absent(s.address.clone(), Absence::FilterFailed)
        }
        AnchorBody::Unavailable(Unavailable::Submodule) => {
            DiffSide::absent(s.address.clone(), Absence::Submodule)
        }
    }
}

/// Render a *measurably* unrelated re-anchor as what git renders for the same
/// event: `deleted anchor` at the old address plus `new anchor` at the new
/// one, two blocks asserting no edit between them.
///
/// Only a pair that was measured and fell below [`RENAME_SIMILARITY_FLOOR`]
/// reaches here. An *unmeasurable* pair does not: the move is asserted by the
/// declaration itself, so splitting it would invent a delete and a create
/// where the user declared one move.
///
/// `sources` is the resolver's layer list for the *one* anchor being split, so
/// both halves carry it: the split is a rendering decision about how to show a
/// single declared re-anchor, not two anchors, and the layer the drift lives at
/// is the same fact for both blocks.
fn push_reanchor_split(
    anchors: &mut Vec<CurrentAnchor>,
    old: &Snapshot,
    new: &Snapshot,
    sources: &[crate::types::DriftSource],
) {
    if let Some(diff) = snapshot_diff(Some(old), None, sources) {
        anchors.push(CurrentAnchor::new(
            old.address.clone(),
            None,
            diff,
            &old.body,
            false,
            sources.to_vec(),
        ));
    }
    if let Some(diff) = snapshot_diff(None, Some(new), sources) {
        anchors.push(CurrentAnchor::new(
            new.address.clone(),
            None,
            diff,
            &new.body,
            false,
            sources.to_vec(),
        ));
    }
}

/// Similarity between two snapshot bodies, or `None` when it cannot honestly
/// be measured.
///
/// [`AnchorBody::text`] answers `""` for an unavailable body, so measuring
/// through it turns "we could not read the recorded snapshot" into the
/// confident claim "0% similar" — a fabricated percentage standing in for a
/// value that is genuinely unknown, and, worse, one below
/// [`RENAME_SIMILARITY_FLOOR`], which every surface now documents as
/// impossible for a rename. Unknown is not 0%: callers get `None` and must
/// choose a form that claims nothing about relatedness.
fn measured_similarity(old: &AnchorBody, new: &AnchorBody) -> Option<u8> {
    match (old, new) {
        (AnchorBody::Text(o), AnchorBody::Text(n)) => Some(similarity(o, n)),
        _ => None,
    }
}

/// The anchor diff header for a pair of snapshots.
fn anchor_header(
    old: Option<&Snapshot>,
    new: Option<&Snapshot>,
    drift_sources: &[crate::types::DriftSource],
) -> DiffHeader {
    let null = || NULL_ANCHOR_HASH.to_string();
    let with = |h: DiffHeader| match h {
        DiffHeader::Anchor {
            old_hash,
            new_hash,
            kind,
            ..
        } => DiffHeader::Anchor {
            old_hash,
            new_hash,
            kind,
            drift_sources: drift_sources.to_vec(),
        },
        other => other,
    };
    with(match (old, new) {
        (Some(o), Some(n)) => DiffHeader::anchor(
            o.hash.clone(),
            n.hash.clone(),
            if o.address == n.address {
                AnchorDiffKind::Modify
            } else {
                // `None` is unreachable here: every `pair_anchors` pass that
                // can pair two *different* addresses (content identity, then
                // greedy similarity) requires both bodies to be text, and the
                // one pass that admits a non-text body matches on address,
                // which lands in the `Modify` arm above. Passing the option
                // through means that if a future pass breaks that, the header
                // omits the number rather than inventing one.
                AnchorDiffKind::Rename {
                    similarity: measured_similarity(&o.body, &n.body),
                }
            },
        ),
        (None, Some(n)) => DiffHeader::anchor(null(), n.hash.clone(), AnchorDiffKind::New),
        (Some(o), None) => DiffHeader::anchor(o.hash.clone(), null(), AnchorDiffKind::Deleted),
        (None, None) => unreachable!("a diff needs at least one side"),
    })
}

/// Render one anchor pseudo-diff between two optional snapshots. The kind is
/// derived from the pair: `Modify` at an unchanged address, `Rename` when the
/// address moved (headers always, hunks only when content also changed), and
/// `New`/`Deleted` for an unpaired side.
///
/// `drift_sources` is empty for every timeline block — a commit entry describes
/// a commit, not a drift, and has no layer to name. It is populated only where
/// the `current` block splits one declared re-anchor into two, so the human
/// marker and the JSON `sources` key stay in step: the key without the marker
/// would leave the default output — the format this command exists to produce —
/// the one surface that cannot say where the drift lives.
fn snapshot_diff(
    old: Option<&Snapshot>,
    new: Option<&Snapshot>,
    drift_sources: &[crate::types::DriftSource],
) -> Option<String> {
    if old.is_none() && new.is_none() {
        return None;
    }
    let header = anchor_header(old, new, drift_sources);
    render_unified_diff(
        &header,
        old.map(snapshot_side).unwrap_or_else(DiffSide::dev_null),
        new.map(snapshot_side).unwrap_or_else(DiffSide::dev_null),
    )
}

/// The header-only block for an address whose declaration now records a
/// different token than it did in the previous state.
///
/// The predicate is exactly that — a change of recorded token at one address —
/// and nothing about the content enters it. When the content is also unchanged
/// this is the one anchor-level event no content comparison can produce; when
/// the content changed too, both facts are true at once and this block is
/// emitted alongside the ordinary content block for the same address.
///
/// The `index` line carries the two *recorded* tokens, not the rendered
/// content's hash: the transition between the tokens is the entire finding of
/// this block, and it is the only place the newly recorded token appears.
/// `None` when the binding is unchanged, or when there is no old side to have
/// moved away from.
fn rebinding_diff(old: Option<&Snapshot>, new: &Snapshot) -> Option<TimelineAnchor> {
    let old = old?;
    if old.recorded == new.recorded {
        return None;
    }
    // A pair whose addresses differ is a *move*, and the rename block beside
    // this one already accounts for the binding: the anchor went to a new
    // address carrying its content, and nothing broke. Two anchors that
    // exchange addresses along with their content rebind both addresses by the
    // letter of the test above while breaking neither — emitting a rebinding
    // there would claim damage the same render disproves two lines lower,
    // which is the round-6 silence defect wearing its opposite face. The
    // rebinding this block reports is the one no move explains: the address
    // stood still and the token under it changed.
    if old.address != new.address {
        return None;
    }
    let header = DiffHeader::anchor(
        old.recorded.clone(),
        new.recorded.clone(),
        AnchorDiffKind::Rebound,
    );
    let diff = render_diff_header(&header, &snapshot_side(old), &snapshot_side(new), false);
    Some(TimelineAnchor::rebound(
        new.address.clone(),
        diff,
        format!("rk64:{}", old.recorded),
        format!("rk64:{}", new.recorded),
    ))
}

/// Pair the old state's anchors with the new state's, in git's own resolution
/// order.
///
/// 1. **Identical content at the same address** — an anchor that plainly
///    stayed put.
/// 2. **Identical content anywhere** — a move. This must precede address
///    matching: when two anchors *exchange* addresses in one commit, each
///    would otherwise grab the other's address and both render as total
///    rewrites instead of two pure moves.
/// 3. **Exact address** among the leftovers — same address, changed content.
/// 4. **Similarity** ≥ [`RENAME_SIMILARITY_FLOOR`] among what is still
///    unpaired, greedily by highest score; ties break by declaration order
///    (lowest old index, then lowest new index), so a deterministic pairing
///    falls out of a deterministic declaration.
///
/// Unavailable bodies take part in the address passes only: an absence is not
/// content, and two unrelated anchors that both failed to extract must not
/// pair as a 100%-similar rename.
///
/// Returns `pairs[new_index] = Some(old_index)` plus the old indices that
/// stayed unpaired, in declaration order.
fn pair_anchors(old: &[Rc<Snapshot>], new: &[Rc<Snapshot>]) -> (Vec<Option<usize>>, Vec<usize>) {
    let mut pairs: Vec<Option<usize>> = vec![None; new.len()];
    let mut old_used: Vec<bool> = vec![false; old.len()];

    let pair_up = |pairs: &mut Vec<Option<usize>>,
                   old_used: &mut Vec<bool>,
                   accept: &dyn Fn(&Snapshot, &Snapshot) -> bool| {
        for (j, n) in new.iter().enumerate() {
            if pairs[j].is_some() {
                continue;
            }
            if let Some(i) = (0..old.len()).find(|i| !old_used[*i] && accept(&old[*i], n)) {
                old_used[i] = true;
                pairs[j] = Some(i);
            }
        }
    };

    // Pass 1 and 2 — content identity, address-preserving first.
    let same_content = |o: &Snapshot, n: &Snapshot| {
        o.body.is_text() && n.body.is_text() && !o.body.text().is_empty() && o.body == n.body
    };
    pair_up(&mut pairs, &mut old_used, &|o, n| {
        o.address == n.address && same_content(o, n)
    });
    pair_up(&mut pairs, &mut old_used, &same_content);
    // Pass 3 — exact address.
    pair_up(&mut pairs, &mut old_used, &|o, n| o.address == n.address);

    // Pass 4 — greedy similarity among the leftovers. Scores are a pure
    // function of the two bodies, so they are computed once per candidate
    // pair; each greedy round then re-scans the memoized list instead of
    // re-running a full Histogram diff per surviving pair.
    let mut candidates: Vec<(u8, usize, usize)> = Vec::new();
    for (i, o) in old.iter().enumerate() {
        if old_used[i] || !o.body.is_text() {
            continue;
        }
        for (j, n) in new.iter().enumerate() {
            if pairs[j].is_some() || !n.body.is_text() {
                continue;
            }
            let sim = similarity(o.body.text(), n.body.text());
            if sim >= RENAME_SIMILARITY_FLOOR {
                candidates.push((sim, i, j));
            }
        }
    }
    loop {
        let mut best: Option<(u8, usize, usize)> = None;
        for &(sim, i, j) in &candidates {
            if old_used[i] || pairs[j].is_some() {
                continue;
            }
            // Ties break by declaration order: the candidate list is built
            // in (old asc, new asc) order, so a strict `>` keeps the
            // first-seen candidate.
            if best.is_none_or(|(bs, _, _)| sim > bs) {
                best = Some((sim, i, j));
            }
        }
        match best {
            Some((_, i, j)) => {
                old_used[i] = true;
                pairs[j] = Some(i);
            }
            None => break,
        }
    }

    let dropped = (0..old.len()).filter(|i| !old_used[*i]).collect();
    (pairs, dropped)
}

/// Diff a commit's rendered state against **the state materialized at its
/// first parent** and emit the entry's observable body. Returns `None` when
/// nothing observable changed — a commit that qualified for the walk (it
/// touched an anchored file) but left every declared range and the
/// declaration itself untouched.
///
/// `prev` is parent #1's state and not the previous entry in the walk: those
/// coincide only on a linear history, and the difference is the whole of the
/// invariant this function owes — every `-` line it renders exists in
/// `git show C^:path`, and every `+` line in `git show C:path`.
///
/// The emptiness decision is made from rendered state alone — the commit's
/// identity plays no part in it, which is what lets [`build_report`] defer
/// the author-metadata parse to commits that actually render.
fn diff_section(
    repo: &gix::Repository,
    span_path: &str,
    prev: Option<&RenderedState>,
    cur: &RenderedState,
    decl_blobs: &mut std::collections::HashMap<String, Option<Rc<BlobAt>>>,
) -> Option<SectionBody> {
    // The declaration blob per commit, memoized across calls: along a linear
    // chain every commit's blob is asked for twice — once as `cur`, once as
    // the next commit's `prev`.
    let mut decl_blob = |commit: &str| -> Option<Rc<BlobAt>> {
        decl_blobs
            .entry(commit.to_string())
            .or_insert_with(|| blob_at(repo, commit, span_path).map(Rc::new))
            .clone()
    };
    let old_blob = prev.and_then(|p| decl_blob(&p.commit));
    let new_blob = decl_blob(&cur.commit);
    let span_diff = blob_diff(span_path, old_blob.as_deref(), new_blob.as_deref());

    let empty: Vec<Rc<Snapshot>> = Vec::new();
    let old = prev.map(|p| p.anchors.as_slice()).unwrap_or(&empty);
    let new = cur.anchors.as_slice();
    let (pairs, dropped) = pair_anchors(old, new);

    let mut anchors: Vec<TimelineAnchor> = Vec::new();
    for (j, n) in new.iter().enumerate() {
        let o = pairs[j].map(|i| old[i].as_ref());
        // Whether this address was rebound is a question about the
        // declaration, and it is answered per address — independently of
        // whether the content also changed. Gating it on "no content diff"
        // would let a commit that rebinds an address *and* edits it render as
        // ordinary drift, hiding the rebinding behind a benign hunk and
        // inviting a re-hash: the repair that would permanently bind the why
        // to unrelated content, when the truth wants the rebinding reverted.
        // The two facts co-occur, so the render carries both, as adjacent
        // blocks at one address: the rebound block states the token
        // transition, the content block states the content transition, and
        // neither contaminates the other.
        if let Some(rebound) = rebinding_diff(o, n) {
            anchors.push(rebound);
        }
        let Some(diff) = snapshot_diff(o, Some(n.as_ref()), &[]) else {
            continue;
        };
        // A first-add carries the full snapshot so a consumer can render a
        // preview without reconstructing it from the addition diff.
        anchors.push(TimelineAnchor::new(
            n.address.clone(),
            diff,
            Some(&n.body),
            o.is_none(),
        ));
    }
    for i in dropped {
        if let Some(diff) = snapshot_diff(Some(old[i].as_ref()), None, &[]) {
            anchors.push(TimelineAnchor::new(
                old[i].address.clone(),
                diff,
                None,
                false,
            ));
        }
    }

    if span_diff.is_none() && anchors.is_empty() {
        return None;
    }

    Some(SectionBody { span_diff, anchors })
}

/// The observable payload of a timeline entry — a [`CommitSection`] minus the
/// commit's identity, which [`build_report`] attaches only after the body has
/// proven non-empty.
struct SectionBody {
    span_diff: Option<String>,
    anchors: Vec<TimelineAnchor>,
}

#[allow(clippy::too_many_arguments)]
fn build_report(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    span_path: &str,
    commits: &[crate::git::CommitChanges],
    limit: Option<usize>,
    spans_at: &mut std::collections::HashMap<String, Option<Rc<Span>>>,
) -> Result<HistoryReport> {
    let mut sections: Vec<CommitSection> = Vec::new();

    // The declaration's recorded `rk64` tokens, keyed by declared address, read
    // from the live (working-tree) `.span` file — the same record `git span
    // drift` compares against.
    let recorded = recorded_hashes(repo, span_name, span_root);
    // The rendered snapshot, if any, whose content the declaration's recorded
    // token actually hashes. Collected across the walk (newest match wins) so
    // the `current` block can diff live content against *what was recorded*
    // rather than against whatever text now occupies the recorded line numbers.
    let mut recorded_snapshots: std::collections::HashMap<String, Rc<Snapshot>> =
        std::collections::HashMap::new();
    // Every snapshot this render has produced, keyed by its content hash — the
    // set of contents the report itself displays. The `current` block's old
    // side draws from it, which is what makes "unrecoverable" mean something a
    // reader can check: if the recorded token is missing here, its bytes are
    // nowhere in this render either. Oldest wins: this loop runs oldest→newest
    // and the first entry for a hash is kept, and a collision can only be
    // between byte-identical bodies, so the choice cannot change rendered
    // bytes (see [`capture_by_hash`]).
    let mut rendered_by_hash: std::collections::HashMap<String, Rc<Snapshot>> =
        std::collections::HashMap::new();

    // Every rendered state this pass has materialized, keyed by commit. The
    // walk is dense in first-parent links — a commit's parent is very often the
    // previously walked commit — so memoizing keeps a branched history at
    // roughly one state materialization per entry rather than two. States are
    // shared out of the memo, never copied: a state owns every anchor body it
    // extracted, and cloning it per lookup was two full-content copies per
    // walked commit.
    let mut states: std::collections::HashMap<String, Rc<RenderedState>> =
        std::collections::HashMap::new();
    // The declaration blob at each commit, memoized for `diff_section` (see
    // its `decl_blob` helper for why).
    let mut decl_blobs: std::collections::HashMap<String, Option<Rc<BlobAt>>> =
        std::collections::HashMap::new();
    // The newest walked commit's state, which the `current` block diffs
    // against. Tracked separately from the per-entry baseline: the walk is
    // oldest->newest, so this is simply the last one materialized.
    let mut newest: Option<Rc<RenderedState>> = None;

    for cc in commits {
        // Read the span as it existed at this commit. An absent span
        // (deleted-then-re-added gap, or a commit predating the span's
        // creation that touched an anchored file) renders as an empty state.
        let cur = match states.get(&cc.hash) {
            Some(s) => Rc::clone(s),
            None => {
                let s = Rc::new(state_at_commit(
                    repo, span_name, span_root, &cc.hash, spans_at,
                )?);
                states.insert(cc.hash.clone(), Rc::clone(&s));
                s
            }
        };

        // The baseline is the state materialized at this commit's **first
        // parent** — never the previous rendered entry. The two coincide only
        // on linear history; where they diverge, pairing against the list
        // predecessor makes an entry assert edits its commit did not make (a
        // sibling branch's line reverted, attributed to a named author). A root
        // commit has no parent and pairs against nothing, which is what makes
        // the span's first appearance render as a creation.
        //
        // A merge that the walk *did* skip cannot corrupt the commit after it:
        // skippable means no seed path's blob moved on the mainline, so the
        // skipped merge's state and its first parent's state are the same
        // state, and the chain is unbroken either way.
        let prev = match crate::git::first_parent_of(repo, &cc.hash)? {
            Some(parent) => Some(match states.get(&parent) {
                Some(s) => Rc::clone(s),
                None => {
                    let s = Rc::new(state_at_commit(
                        repo, span_name, span_root, &parent, spans_at,
                    )?);
                    states.insert(parent, Rc::clone(&s));
                    s
                }
            }),
            None => None,
        };

        capture_recorded_snapshots(&recorded, &mut recorded_snapshots, &cur);
        capture_by_hash(&mut rendered_by_hash, &cur);

        // Author metadata is parsed only for commits that render an entry.
        // Metadata validity is a contract for *rendered* commits: a walked
        // commit that changes nothing observable never has its author line
        // read, so an unparseable date there cannot fail the command.
        if let Some(body) = diff_section(repo, span_path, prev.as_deref(), &cur, &mut decl_blobs) {
            let meta = crate::git::commit_meta(repo, &cc.hash)?;
            sections.push(CommitSection {
                hash: cc.hash.clone(),
                date: meta.author_date_iso8601,
                date_git: meta.author_date_git,
                summary: meta.summary,
                span_diff: body.span_diff,
                anchors: body.anchors,
            });
        }

        newest = Some(cur);
    }

    // `--limit N` is a window over *rendered entries*: keep the newest N and
    // flag the report scoped when anything older was dropped. `--limit 0` is an
    // explicitly empty — and therefore explicitly partial — document.
    let mut scoped = false;
    if let Some(n) = limit {
        if sections.len() > n {
            sections.drain(..sections.len() - n);
            scoped = true;
        }
        if n == 0 {
            scoped = true;
        }
    }

    // The current block diffs against the *last recorded timeline state* — the
    // newest commit's state. With an empty walk (a worktree-only span) fall
    // back to HEAD, the only other recorded state.
    let last = match newest {
        Some(state) => Some(state),
        None => match read_span_at_in(repo, span_name, Some("HEAD"), span_root) {
            Ok(span) => crate::git::resolve_commit(repo, "HEAD")
                .ok()
                .map(|head| Rc::new(rendered_state_at(repo, &head, &span))),
            Err(crate::Error::SpanNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        },
    };
    if let Some(state) = last.as_deref() {
        capture_recorded_snapshots(&recorded, &mut recorded_snapshots, state);
        capture_by_hash(&mut rendered_by_hash, state);
    }

    let current = build_current(
        repo,
        span_name,
        span_root,
        span_path,
        last.as_deref(),
        &recorded,
        &recorded_snapshots,
        &rendered_by_hash,
    )?;

    Ok(HistoryReport {
        span: span_name.to_string(),
        scoped,
        commits: sections,
        current,
    })
}

/// The declaration's recorded `rk64` tokens, keyed by declared address, read
/// from the working-tree `.span` file. Empty when the span does not exist
/// there (a deleted or never-checked-out declaration).
fn recorded_hashes(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
) -> std::collections::HashMap<String, String> {
    match read_span_at_in(repo, span_name, None, span_root) {
        Ok(span) => span
            .anchors
            .iter()
            .map(|(_id, a)| (anchor_address(a), bare_hash(&a.stored_hash)))
            .collect(),
        Err(_) => std::collections::HashMap::new(),
    }
}

/// Where HEAD's declaration puts each recorded token: `rk64` token →
/// (declared address, that address's first line).
///
/// This is the per-anchor half of what `span_diff` shows as a blob patch. The
/// patch says *the declaration changed*; this says, for one anchor, *what it
/// changed about it* — which is the only way to tell a declaration re-anchor
/// (the token is declared at a different address than HEAD declares it at)
/// from a resolver relocation (both declarations agree; the bytes moved).
///
/// A token declared at two addresses at once is dropped: it names no single
/// "where HEAD said this was", and guessing would relabel a side on a
/// coin-flip.
fn head_token_addresses(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
) -> std::collections::HashMap<String, (String, u32)> {
    let Ok(span) = read_span_at_in(repo, span_name, Some("HEAD"), span_root) else {
        return std::collections::HashMap::new();
    };
    let mut seen: std::collections::HashMap<String, Option<(String, u32)>> =
        std::collections::HashMap::new();
    for (_id, a) in &span.anchors {
        let entry = seen
            .entry(bare_hash(&a.stored_hash))
            .or_insert_with(|| Some((anchor_address(a), extent_first_line(a.extent))));
        if entry
            .as_ref()
            .is_some_and(|(addr, _)| *addr != anchor_address(a))
        {
            *entry = None;
        }
    }
    seen.into_iter()
        .filter_map(|(token, at)| at.map(|at| (token, at)))
        .collect()
}

/// Everywhere the `current` block may look for the bytes a declaration
/// records. The set is deliberately wide: a token's bytes are its identity,
/// and refusing to look past the anchor's own address reported content the
/// same render displays twenty lines below as lost.
struct RecordedSources<'a> {
    /// Snapshots whose address *and* hash match the live declaration — the
    /// walk's own answer to "what does this anchor record".
    at_address: &'a std::collections::HashMap<String, Rc<Snapshot>>,
    /// Every snapshot this render produced, keyed by content hash. Membership
    /// here is exactly the negation of "unrecoverable".
    by_hash: &'a std::collections::HashMap<String, Rc<Snapshot>>,
    /// The last recorded state's anchors, in declaration order.
    last_state: &'a [Rc<Snapshot>],
}

/// Which of three mutually exclusive things happened to one anchor since its
/// last recorded state. Each owns its labels, its proposal, and where the live
/// side is read — the distinctions are too close together to ride on a single
/// boolean, which is how fixing one shape kept reopening another.
///
/// A fourth outcome, "the recorded bytes are not recoverable", is not a state
/// but a result: it is what [`current_old_side`] reports when no candidate
/// hashes to the declaration's token, and it is the only place the
/// [`RECORDED_UNRECOVERABLE`] marker appears.
#[derive(Clone, Debug, PartialEq, Eq)]
enum CurrentState {
    /// The declaration itself moved this anchor: its recorded token is
    /// declared at `from` in HEAD and somewhere else in the worktree. The old
    /// side wears `from` (where those bytes were declared to be), the new side
    /// wears the declared address, and no proposal is issued — the user
    /// already stated where the anchor belongs, and a proposal beside a rename
    /// would be a second, contradictory instruction.
    Reanchored {
        /// HEAD's declared address for this anchor's recorded token.
        from: String,
        /// First line of `from`, so the old hunk coordinate matches its label.
        first_line: u32,
    },
    /// Both declarations agree, and the resolver found the recorded bytes at
    /// another address — exactly what `git span drift` prints `moved to` for.
    /// Nothing moved in the declaration, so neither side is relabelled; the
    /// proposal alone names the destination.
    Relocated {
        /// The address the resolver proposes.
        to: String,
    },
    /// Both declarations agree and the content at the declared address is what
    /// changed (or is unreadable). Both sides wear the declared address, and
    /// the block is an ordinary hunk.
    Drifted,
}

/// Remember every snapshot in `state` whose content hash equals the
/// declaration's recorded token for the same address — that snapshot *is* the
/// content the declaration describes. Later states overwrite earlier ones, so
/// the newest matching snapshot wins.
fn capture_recorded_snapshots(
    recorded: &std::collections::HashMap<String, String>,
    into: &mut std::collections::HashMap<String, Rc<Snapshot>>,
    state: &RenderedState,
) {
    for snap in &state.anchors {
        if recorded.get(&snap.address) == Some(&snap.hash) {
            into.insert(snap.address.clone(), Rc::clone(snap));
        }
    }
}

/// Index every snapshot in `state` by its content hash.
///
/// Population rule, stated rather than inherited from map internals: states
/// arrive oldest-first ([`build_report`] walks the reversed log), anchors
/// within a state in declaration order, and the first entry for a hash wins —
/// so the oldest state's earliest-declared anchor is the one kept,
/// deterministically. A collision can only ever be between byte-identical
/// bodies (equal token means equal content — the fingerprint covers the raw
/// bytes, binary or not), and the label a side wears is chosen by
/// [`CurrentState`], never by the candidate, so the tie-break can change
/// neither the rendered bytes nor the address above them.
///
/// Membership is decided by whether the snapshot *has bytes*, not by whether
/// those bytes decoded as text: a binary snapshot has a real fingerprint and
/// only an unrenderable body, and excluding it from this index is exactly what
/// once made `recorded: "unrecoverable"` fire for a token the same render
/// printed as first-add content. What is skipped is a snapshot with nothing to
/// key: the [`Unavailable`] reasons that mean "no bytes at this address".
/// [`Unavailable::Submodule`] is in the list for completeness — walked states
/// come from [`read_anchor_at_commit`], which never produces it (only the
/// `current` block's resolver path does) — so that the guard stays correct if
/// a future state source can.
///
/// The test reads the *body*, not the hash, and that is the whole point.
/// [`NULL_ANCHOR_HASH`] is an ambiguous value — an absent file, a past-EOF
/// range, a `/dev/null` side, and a genuinely empty recorded extent all wear it
/// — so `hash != NULL_ANCHOR_HASH` skipped a fourth state it never meant to:
/// `git span add` on an empty file records `rk64:0000000000000000`, and that
/// anchor was excluded from cross-address recovery. Reading the body asks the
/// question the guard was always trying to ask.
fn capture_by_hash(
    into: &mut std::collections::HashMap<String, Rc<Snapshot>>,
    state: &RenderedState,
) {
    for snap in &state.anchors {
        let bodiless = matches!(
            snap.body.unavailable(),
            Some(
                Unavailable::Absent
                    | Unavailable::RangePastEof
                    | Unavailable::FilterFailed
                    | Unavailable::Submodule
            )
        );
        if !bodiless {
            into.entry(snap.hash.clone())
                .or_insert_with(|| Rc::clone(snap));
        }
    }
}

// ---------------------------------------------------------------------------
// Current (working-tree) section
// ---------------------------------------------------------------------------

/// Build the address string for a resolved anchor location.
fn location_address(loc: &AnchorLocation) -> String {
    let path = loc.path.to_string_lossy();
    match loc.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&path, Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&path, None, None),
    }
}

/// The live bytes at a location — **one** read, feeding both the body and the
/// hash beside it, or the structured reason there are none.
///
/// # Why this is one function
///
/// It used to be two, and they disagreed. The hash came from
/// [`crate::resolver::layers::read_worktree_normalized`] (gix's
/// `convert_to_git` plus any `filter.<name>.process` driver); the body came
/// from `drift_output::read_location_bytes_present`, a plain `std::fs::read`.
/// The comment that stood here justified the split — a hash must be the token
/// a re-anchor would record, a body is what the file literally holds — and
/// then called it unobservable, on the reasoning that a resolved location
/// carries its blob and only a worktree-only read can reach both fallbacks,
/// where the difference is CRLF normalization and CRLF changes no rendered
/// line.
///
/// A content filter is the counter-example that argument did not have. A
/// resolved worktree location carries `blob: None`, so both fallbacks fire;
/// and a filter is free to return something other than line endings. With a
/// `filter=lfs` line in `.gitattributes` and a file nobody had touched, the
/// header named the fingerprint of the pointer's first two lines while
/// `content` printed the user's own first two lines — whose token was sitting
/// on the *old* side of that same `index` line. `content` is documented as
/// "the full bytes whose hash the header names on the side wearing `path`", so
/// a consumer joining the two got a mismatch by construction, and the field's
/// stated purpose was defeated in every repository with a clean filter in it.
///
/// The normalized bytes win, because the `index` line's promise is the
/// stronger one: it names the token a re-anchor would record, and a re-anchor
/// records what git stores. The body follows the hash rather than the other
/// way round.
///
/// # Why a failure is a reason and not a fallback
///
/// The old hash path swallowed a filter failure into a raw read
/// (`.or_else(|_| read_worktree_bytes(…))`), which is fail-open: it answered
/// the question "what would git record here?" with bytes git would never
/// record. `git span add` refuses to declare what it cannot read, and the
/// render path is held to the same policy — the failure becomes
/// [`Unavailable::FilterFailed`] and reaches the JSON contract, rather than
/// being papered over with the pre-filter bytes.
fn read_live_bytes(
    repo: &gix::Repository,
    loc: &AnchorLocation,
) -> std::result::Result<Vec<u8>, Unavailable> {
    // A stored object is the whole answer when there is one. The fallthrough
    // matters: a location resolved from the working tree can carry an OID that
    // was computed but never written, and reading it fails — which is not the
    // same as the content being absent.
    if let Some(bytes) = loc
        .blob
        .and_then(|oid| crate::git::read_blob_bytes(repo, &oid.to_string()).ok())
    {
        return Ok(bytes);
    }
    // Existence is asked before content: `read_worktree_normalized` answers
    // `Ok(vec![])` for a path that is not there, and an empty `Vec` cannot tell
    // "no such file" from "an empty file" — whose extent is honest, extractable
    // content.
    let workdir = repo.workdir().ok_or(Unavailable::Absent)?;
    let path = loc.path.to_string_lossy().to_string();
    if std::fs::symlink_metadata(workdir.join(&path)).is_err() {
        return Err(Unavailable::Absent);
    }
    let mut filters = crate::resolver::layers::CustomFilters::new();
    match crate::resolver::layers::read_worktree_normalized(repo, &mut filters, &path) {
        Ok(bytes) => Ok(bytes),
        Err(crate::Error::FilterFailed { .. }) => Err(Unavailable::FilterFailed),
        Err(_) => crate::git::read_worktree_bytes(repo, &path).map_err(|_| Unavailable::Absent),
    }
}

/// The old side of a current-block diff: the anchor's *recorded* state, as the
/// declaration describes it.
///
/// # The oracle
///
/// **Whatever content stands as an old side must hash to the declaration's
/// recorded `rk64` token.** Nothing else is the recorded content, and every
/// known way this block has lied came from violating that rule:
///
/// * the newest snapshot *at the recorded address* is, for a `Moved` anchor,
///   a different block of source entirely — diffing against it fabricates a
///   rewrite for what `git span drift` calls a pure move;
/// * for an in-place committed edit it is the *drifted* text, so the diff
///   comes out empty and the drift vanishes from the default output;
/// * for a never-committed declaration there is no earlier state at all, and
///   treating the anchor as a creation paints the drifted text as the
///   declared content while the recorded token two keys away says otherwise.
///
/// So the body is taken from the first candidate that hashes to the recorded
/// token — the snapshot the walk identified as recorded, the live content
/// (identical bytes by definition when the hashes agree), or the paired
/// snapshot. When no candidate qualifies the recorded bytes are simply not
/// recoverable — [`OldSide::recovered`] is `false` and the body is
/// [`Unavailable`]: the caller then renders the header alone, because hunks
/// need two comparable bodies. `recovered` is the *only* carrier of that
/// verdict: a recovered candidate can itself wear an [`Unavailable::Binary`]
/// body (a real fingerprint over unrenderable bytes), and reading
/// "unrecoverable" off body shape is what once declared such a token lost
/// while the same render printed it as first-add content.
///
/// Either way the `index` line carries `rk64:<recorded>..rk64:<live>`, so the
/// two hashes differ exactly when the anchor is drifted.
///
/// `address` and `first_line` are the caller's decision, not this function's:
/// [`CurrentState`] owns which address a side wears, and the coordinate comes
/// from that same label so the two can never disagree. The label is a claim
/// about the *declaration* — "this is what the declaration says lives here" —
/// while a candidate's own address is only where those bytes were found, which
/// is why the search deliberately ranges past the label: a declaration swap
/// leaves each anchor's recorded bytes sitting under the sibling's address,
/// and refusing to look there reported recoverable content as lost.
///
/// The oracle above is enforced by construction here (a candidate is only
/// taken when its hash equals the token) and checked end-to-end by
/// `current_old_sides_carry_the_declarations_recorded_token`, which re-reads
/// every emitted `index` line against the live `.span` file.
fn current_old_side(
    paired: Option<&Snapshot>,
    live: &Snapshot,
    sources: &RecordedSources<'_>,
    address: String,
    first_line: u32,
    recorded_hash: Option<&String>,
) -> Option<OldSide> {
    let hash = recorded_hash
        .cloned()
        .or_else(|| paired.map(|p| p.hash.clone()))?;
    let at_address = sources.at_address.get(&address).map(Rc::as_ref);
    let by_hash = sources.by_hash.get(&hash).map(Rc::as_ref);
    let source = [at_address, Some(live), paired, by_hash]
        .into_iter()
        .flatten()
        .chain(sources.last_state.iter().map(Rc::as_ref))
        .find(|candidate| candidate.hash == hash);
    debug_assert!(
        source.is_none_or(|s| {
            !s.body.is_text() || body_fingerprint(&s.address, s.body.text()) == hash
        }),
        "an old side must hash to the declaration's recorded token"
    );
    Some(match source {
        Some(src) => OldSide {
            snapshot: Snapshot {
                address,
                first_line,
                recorded: hash.clone(),
                hash,
                body: src.body.clone(),
            },
            recovered: true,
        },
        None => OldSide {
            snapshot: Snapshot {
                address,
                first_line,
                recorded: hash.clone(),
                hash,
                body: AnchorBody::Unavailable(Unavailable::Absent),
            },
            recovered: false,
        },
    })
}

/// [`current_old_side`]'s answer: the snapshot to render as the old side, and
/// the verdict on whether the render's snapshot set actually carried the
/// recorded bytes. The two are separate fields because they are separate
/// facts: a recovered binary snapshot has an [`Unavailable`] *body* but is not
/// a lost *token*.
struct OldSide {
    snapshot: Snapshot,
    /// `false` exactly when no snapshot in this render hashes to the recorded
    /// token — the one condition [`RECORDED_UNRECOVERABLE`] reports.
    recovered: bool,
}

/// Read an anchor's live body from a location, applying [`read_anchor_at_commit`]'s
/// policy on *both* axes — encoding and extent.
///
/// **Encoding:** the file's bytes must be UTF-8 as a whole or the body is
/// [`Unavailable::Binary`], so the same bytes can never be
/// `unavailable: "binary"` when read from a commit and a lossily-decoded
/// `content` string of replacement characters when read from the worktree.
///
/// **Extent:** the declared range must overlap the file, or the body is
/// [`Unavailable::RangePastEof`] — the same verdict
/// [`crate::git::slice_line_range`] hands the commit path, because it *is* the
/// commit path's function. Without this the live read fabricated `Text("")` for
/// a range the file does not have, and an empty string is content: it measured
/// as `similarity 0%`, split a declared re-anchor into a delete plus a create
/// asserting deletions `git diff` never showed, and shipped `"content": ""` for
/// an address holding nothing at all. One file state, two accounts, and
/// committing the declaration rewrote the story.
///
/// A missing file is [`Unavailable::Absent`], and a file whose *filter* could
/// not produce content is [`Unavailable::FilterFailed`] — the file is there and
/// readable, so calling it absent is not a coarser answer but a false one.
/// Both come from [`read_live_bytes`], which is also where the hash beside this
/// body comes from: one read, one account.
fn read_location_body(repo: &gix::Repository, loc: &AnchorLocation) -> AnchorBody {
    live_snapshot(repo, loc).0
}

/// The live body **and** the hash that travels with it, derived from the same
/// bytes so the two can never describe different content.
///
/// Mirrors [`read_anchor_at_commit`]'s `missing` helper: a body with no bytes
/// at all has nothing to fingerprint and carries [`NULL_ANCHOR_HASH`], while
/// binary bytes keep their real one (a binary snapshot has an unrenderable
/// *body*, not an absent *token*).
///
/// The null hash is an ambiguous value — four distinct states wear it — so it is
/// written *from* the body here and never read back to recover the state. Every
/// consumer that needs the reason takes it from [`AnchorBody::unavailable`].
fn live_snapshot(repo: &gix::Repository, loc: &AnchorLocation) -> (AnchorBody, String) {
    let bytes = match read_live_bytes(repo, loc) {
        Ok(bytes) => bytes,
        Err(why) => return (AnchorBody::Unavailable(why), NULL_ANCHOR_HASH.to_string()),
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return (
            AnchorBody::Unavailable(Unavailable::Binary),
            extent_hash(&bytes, &loc.extent),
        );
    };
    let sliced = match loc.extent {
        AnchorExtent::WholeFile => Ok(text.to_string()),
        AnchorExtent::LineRange { start, end } => crate::git::slice_line_range(text, start, end),
    };
    match sliced {
        Ok(body) => (AnchorBody::Text(body), extent_hash(&bytes, &loc.extent)),
        // The extent has no bytes on the axis the hash is computed over. That
        // condition already produced the null token; what it did not do was
        // reach `unavailable`, so a consumer saw a null hash beside a `content`
        // value supplied from a second read of the same file.
        Err(_) => (
            AnchorBody::Unavailable(Unavailable::RangePastEof),
            NULL_ANCHOR_HASH.to_string(),
        ),
    }
}

/// Why an anchor the resolver could not bind has no live body.
///
/// The resolver's terminal status is authoritative when it carries a cause
/// such as [`crate::types::AnchorStatus::Submodule`]. Otherwise it answers "is
/// there content here?", not "why not", so the declared address is asked
/// directly with `blob: None` rather than treating a missing resolved location
/// as proof the file itself is absent.
///
/// A readable declared range means the absence is the resolver's verdict rather
/// than the file system's, and [`Unavailable::Absent`] stands: the anchor's
/// *content* is gone even though its file is not.
fn unresolved_reason(
    repo: &gix::Repository,
    anchored: &AnchorLocation,
    status: &crate::types::AnchorStatus,
) -> Unavailable {
    if matches!(status, crate::types::AnchorStatus::Submodule) {
        return Unavailable::Submodule;
    }
    let declared = AnchorLocation {
        path: anchored.path.clone(),
        extent: anchored.extent,
        blob: None,
    };
    read_location_body(repo, &declared)
        .unavailable()
        .unwrap_or(Unavailable::Absent)
}

/// Build the optional `current` section from two triggers:
///
///   1. the resolver (the same `LayerSet::full()` engine `git span drift` uses)
///      reports actionable drift for an anchor — committed-but-not-
///      re-anchored source drift, a relocated `moved` anchor, a working-tree
///      edit, a deletion, …; informational `ResolvedPendingCommit` does not
///      qualify;
///   2. the worktree declaration differs from HEAD — one `span_diff` covering
///      why edits and anchor add/remove alike.
///
/// Each emitted anchor is keyed by its **declared** address (what `drift`
/// prints, and the only string a consumer can join against the `.span` file);
/// a resolver relocation is reported as a `proposed` address, never as a
/// completed rename. It carries both payloads: the live snapshot, and a diff
/// from the last recorded state that degrades to a header-only
/// `index rk64:<recorded>..rk64:<live>` block when the content is unchanged
/// but the declaration's recorded hash is drifted — the mismatch *is* the
/// finding, and eliding it is what used to hide committed drift from the
/// default output.
///
/// Anchors pair against the last recorded state through the same
/// [`pair_anchors`] logic the timeline uses, so an *uncommitted* re-anchor
/// (the user edited the address in the worktree `.span` file) renders as a
/// rename rather than a `new anchor`.
///
/// The section is omitted when neither trigger fires.
#[allow(clippy::too_many_arguments)]
fn build_current(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    span_path: &str,
    last: Option<&RenderedState>,
    recorded: &std::collections::HashMap<String, String>,
    recorded_snapshots: &std::collections::HashMap<String, Rc<Snapshot>>,
    rendered_by_hash: &std::collections::HashMap<String, Rc<Snapshot>>,
) -> Result<Option<CurrentSection>> {
    // Trigger 2 — HEAD declaration blob vs. the worktree bytes. The worktree
    // side's `index` hash comes from `hash_blob`, which computes a blob OID
    // without writing the object.
    let head_blob = crate::git::resolve_commit(repo, "HEAD")
        .ok()
        .and_then(|head| blob_at(repo, &head, span_path));
    let work_blob = crate::git::read_worktree_bytes(repo, span_path)
        .ok()
        .and_then(|bytes| {
            let oid = crate::git::hash_blob(&bytes).ok()?;
            Some(BlobAt {
                oid: oid.to_string(),
                text: String::from_utf8_lossy(&bytes).into_owned(),
            })
        });
    let span_diff = blob_diff(span_path, head_blob.as_ref(), work_blob.as_ref());

    // Trigger 1 — resolve the live span through the same engine `git span
    // drift` uses: worktree-over-index-over-HEAD, with the staged-span layer
    // included.
    let options = crate::types::EngineOptions {
        layers: crate::types::LayerSet::full(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
        fuzzy_threshold: 0.95,
    };
    let names = [span_name.to_string()];
    // Repository-read failures out of the resolver get the same curated
    // shape `drift` uses (the two commands share the engine); other library
    // errors keep their own rendering.
    let curate = |e: crate::Error| -> anyhow::Error {
        match e {
            crate::Error::Git(_) => crate::cli::resolver_read_error("history", e).into(),
            _ => e.into(),
        }
    };
    let resolved = crate::resolver::resolve_named_spans(repo, span_root, &names, options)
        .map_err(curate)?;

    // Where HEAD's declaration puts each recorded token — the per-anchor half
    // of the same comparison `span_diff` renders as a blob patch.
    let head_tokens = head_token_addresses(repo, span_name, span_root);

    let mut anchors: Vec<CurrentAnchor> = Vec::new();
    for (_name, result) in resolved {
        let span = match result {
            Ok(m) => m,
            // A worktree-only span (no committed ref) still resolves; a genuine
            // not-found surfaces nothing for this anchor pass.
            Err(crate::Error::SpanNotFound(_)) => continue,
            Err(e) => return Err(curate(e)),
        };

        // Materialize *every* anchor (not only the drifted ones) so pairing
        // against the last recorded state sees the whole picture; only the
        // interesting ones are emitted below.
        let mut live: Vec<Rc<Snapshot>> = Vec::with_capacity(span.anchors.len());
        let mut reportable: Vec<bool> = Vec::with_capacity(span.anchors.len());
        let mut states: Vec<CurrentState> = Vec::with_capacity(span.anchors.len());
        // The resolver's own per-anchor layer list, carried across verbatim
        // rather than recomputed: `drift` emits one finding per entry from this
        // same vector, so history naming a different set than `drift` for the
        // same anchor is not expressible.
        let mut layer_sources: Vec<Vec<crate::types::DriftSource>> =
            Vec::with_capacity(span.anchors.len());
        for r in &span.anchors {
            let declared = location_address(&r.anchored);
            // The resolver only *recommends* a relocation for the bytes-equal
            // statuses — the same ones `git span drift` prints `moved to
            // <address>` for. For a `Changed` anchor `r.current` is merely
            // where the search landed while establishing that the content
            // differs; `drift` issues no instruction, so neither may history.
            let relocation = matches!(
                r.status,
                crate::types::AnchorStatus::Moved
                    | crate::types::AnchorStatus::ResolvedPendingCommit
            );
            let healed = r
                .current
                .as_ref()
                .map(location_address)
                .filter(|h| *h != declared);
            // The declaration comparison outranks the resolver's opinion: if
            // the user moved this token to a new address, that is a statement
            // of intent, and a `proposed anchor` line beside the rename would
            // contradict it.
            let state = match recorded
                .get(&declared)
                .and_then(|token| head_tokens.get(token))
            {
                Some((from, first_line)) if *from != declared => CurrentState::Reanchored {
                    from: from.clone(),
                    first_line: *first_line,
                },
                _ => match (relocation, healed) {
                    (true, Some(to)) => CurrentState::Relocated { to },
                    _ => CurrentState::Drifted,
                },
            };
            // Where the live side is read. A relocation is the one state whose
            // live bytes are elsewhere — the declaration still names the
            // address it always named, and the content demonstrably moved. In
            // every other state the declared range is read at face value:
            // reading a `Changed` anchor at the resolver's landing site
            // produced a body sliced past EOF and a deletion hunk for content
            // the declared range still held, with the user's actual edit
            // nowhere in the block.
            let read_at_target = matches!(state, CurrentState::Relocated { .. });
            let live_loc = r.current.as_ref().map(|loc| {
                if read_at_target {
                    loc.clone()
                } else {
                    crate::types::AnchorLocation {
                        path: r.anchored.path.clone(),
                        extent: r.anchored.extent,
                        // The layer that resolved the anchor is still the right
                        // place to read from; only the extent goes back to what
                        // the declaration says.
                        blob: (loc.path == r.anchored.path).then_some(loc.blob).flatten(),
                    }
                }
            });
            // Both arms classify unavailability at the point the live location
            // is decided, so the two routes to a past-EOF range — a resolved
            // location whose declared extent overruns the file, and an anchor
            // the resolver could not bind at all — land on the same reason.
            // Classifying in only one of them leaves the other emitting the
            // contradiction it was fixed for.
            let (body, hash, first_line) = match &live_loc {
                Some(loc) => {
                    let (body, hash) = live_snapshot(repo, loc);
                    (
                        body,
                        hash,
                        // A relocated side is labelled with the declared address
                        // and carries the declared range's coordinate: its bytes
                        // are byte-identical to the recorded ones, so the block is
                        // header-only and the coordinate never surfaces — but if it
                        // ever did, it would have to agree with the label.
                        extent_first_line(r.anchored.extent),
                    )
                }
                // Nothing resolves: the anchored content is gone. A structural
                // absence, never a prose placeholder — and the reason is read
                // off the declared address rather than assumed, because "the
                // resolver bound nothing" and "there is no such file" are
                // different facts.
                None => (
                    AnchorBody::Unavailable(unresolved_reason(repo, &r.anchored, &r.status)),
                    NULL_ANCHOR_HASH.to_string(),
                    extent_first_line(r.anchored.extent),
                ),
            };
            live.push(Rc::new(Snapshot {
                // The declaration's recorded token for this address, so a live
                // snapshot carries the same identity a walked one does.
                recorded: recorded.get(&declared).cloned().unwrap_or_default(),
                address: declared,
                first_line,
                hash,
                body,
            }));
            reportable.push(crate::resolver::anchor_status_is_drift(&r.status));
            states.push(state);
            layer_sources.push(r.layer_sources.clone());
        }

        let empty: Vec<Rc<Snapshot>> = Vec::new();
        let old = last.map(|s| s.anchors.as_slice()).unwrap_or(&empty);
        let (pairs, _dropped) = pair_anchors(old, &live);

        for (j, n) in live.iter().enumerate() {
            let paired = pairs[j].map(|i| old[i].as_ref());
            let state = &states[j];
            // Only actionable drift produces a current anchor. Fresh and
            // resolved-pending-commit anchors may still have declaration edits,
            // but those are already represented by `span_diff`.
            if !reportable[j] {
                continue;
            }
            let drift_sources = &layer_sources[j];
            // Only a re-anchor relabels a side, and it labels the old side
            // with the address HEAD's declaration gave those bytes.
            let (old_address, old_first_line) = match state {
                CurrentState::Reanchored { from, first_line } => (from.clone(), *first_line),
                _ => (n.address.clone(), n.first_line),
            };
            let sources = RecordedSources {
                at_address: recorded_snapshots,
                by_hash: rendered_by_hash,
                last_state: old,
            };
            let old_side = current_old_side(
                paired,
                n,
                &sources,
                old_address,
                old_first_line,
                recorded.get(&n.address),
            );
            let kind = match (state, &old_side) {
                // No recorded state to diff against at all: the anchor is new
                // in the worktree declaration.
                (_, None) => AnchorDiffKind::New,
                // The move itself is never in doubt: `Reanchored` is entered
                // because the *user's declaration* moved a recorded token
                // between addresses, so `rename from`/`rename to` state
                // something the declaration asserts rather than something the
                // renderer inferred. What varies is whether the two blocks can
                // be compared.
                //
                // Measurable and at or above git's floor: an ordinary rename.
                // Measurable and below it: not one anchor edited but two
                // unrelated blocks, and pairing them would spell "these lines
                // became those lines" over an edit that never happened — git
                // refuses the same form, rendering `new file` + `deleted file`
                // for a `git mv` plus a total replacement even at
                // `--find-renames=0%`. Unmeasurable, because the recorded side
                // is unrecoverable: still one declared move, so splitting it
                // would fabricate two events where the user declared one — the
                // rename lines stay and the `similarity index` line is omitted,
                // which says "how alike is unknown" instead of measuring
                // through the empty-string fallback and printing a confident
                // `similarity index 0%` above the line admitting the side could
                // not be read.
                (CurrentState::Reanchored { .. }, Some(o)) => {
                    let measured = measured_similarity(&o.snapshot.body, &n.body);
                    if measured.is_some_and(|s| s < RENAME_SIMILARITY_FLOOR) {
                        push_reanchor_split(&mut anchors, &o.snapshot, n, drift_sources);
                        continue;
                    }
                    AnchorDiffKind::Rename {
                        similarity: measured,
                    }
                }
                (CurrentState::Relocated { to }, Some(_)) => AnchorDiffKind::Proposed {
                    address: to.clone(),
                },
                (CurrentState::Drifted, Some(_)) => AnchorDiffKind::Modify,
            };
            // The one construction site that names a drift layer: the marker
            // goes into the header both formats are built from, so the default
            // output's block and the JSON `diff` string stay the same bytes.
            let header = DiffHeader::Anchor {
                old_hash: old_side
                    .as_ref()
                    .map(|o| o.snapshot.hash.clone())
                    .unwrap_or_else(|| NULL_ANCHOR_HASH.to_string()),
                new_hash: n.hash.clone(),
                kind,
                drift_sources: drift_sources.clone(),
            };
            let old_diff_side = old_side
                .as_ref()
                .map(|o| snapshot_side(&o.snapshot))
                .unwrap_or_else(DiffSide::dev_null);
            // The recorded bytes are unrecoverable: no snapshot in this render
            // hashes to the token (a declaration that was never committed at
            // its current hash). Hunks would have to invent one of the two
            // sides, so the header — which still names both hashes truthfully
            // — is the whole block. The verdict is [`OldSide::recovered`] and
            // nothing else: a recovered side whose body is unrenderable (a
            // binary snapshot) is not a lost token, and the renderer's
            // structural side states already handle it.
            let unrecoverable = old_side.as_ref().is_some_and(|o| !o.recovered);
            let diff = if unrecoverable {
                render_diff_header(&header, &old_diff_side, &snapshot_side(n), true)
            } else {
                render_unified_diff_always(&header, old_diff_side, snapshot_side(n))
            };
            let proposed = match state {
                CurrentState::Relocated { to } => Some(to.clone()),
                _ => None,
            };
            anchors.push(CurrentAnchor::new(
                n.address.clone(),
                proposed,
                diff,
                &n.body,
                unrecoverable,
                drift_sources.clone(),
            ));
        }
    }

    if span_diff.is_none() && anchors.is_empty() {
        return Ok(None);
    }
    Ok(Some(CurrentSection { span_diff, anchors }))
}

// ---------------------------------------------------------------------------
// Renderers (pure functions of HistoryReport)
// ---------------------------------------------------------------------------

/// Render a `HistoryReport` as git-log-style text.
///
/// Live drift comes first with no commit header — git's own idiom for "outside
/// the timeline", which is the honest claim here, because no single commit
/// entry accounts for the live comparison. The `drift source` line inside each
/// block names the resolver layers that observed drift, not commit status.
/// Then commit entries newest-first: `commit <40-hex>`,
/// `Date:   <git's default author-date rendering>`, a blank line, the
/// four-space-indented summary, then the declaration diff and each anchor
/// diff. Every block is separated by one blank line.
///
/// Every anchor the JSON format emits is emitted here too: both renderers walk
/// the same entry lists, and both `TimelineAnchor` and `CurrentAnchor` carry a
/// mandatory `diff`.
pub fn render_human(report: &HistoryReport) -> String {
    let mut blocks: Vec<&str> = Vec::new();
    let headers: Vec<String> = report
        .commits
        .iter()
        .rev()
        .map(|c| {
            format!(
                "commit {}\nDate:   {}\n\n    {}\n",
                c.hash, c.date_git, c.summary
            )
        })
        .collect();

    if let Some(cur) = &report.current {
        if let Some(d) = &cur.span_diff {
            blocks.push(d);
        }
        for a in &cur.anchors {
            blocks.push(&a.diff);
        }
    }
    for (header, c) in headers.iter().zip(report.commits.iter().rev()) {
        blocks.push(header);
        if let Some(d) = &c.span_diff {
            blocks.push(d);
        }
        for a in &c.anchors {
            blocks.push(&a.diff);
        }
    }

    blocks.join("\n")
}

/// Render a `HistoryReport` as a `schema_version: 2` `serde_json::Value`.
///
/// Top level: `schema_version`, `span`, `commits` (newest-first), plus
/// `scoped: true` and `current` when they apply. `scoped` means `--limit`
/// dropped older entries — such a document is a partial record, and a consumer
/// must never read it as evidence that a span has no history or no drift.
///
/// **Timeline anchors** (`commits[].anchors[]`) carry `path` plus exactly one
/// of `content` (a first-add's full snapshot) or `diff` (every other change).
///
/// **Current anchors** (`current.anchors[]`) carry `path` — always the
/// *declared* address, the same string `git span drift` prints — plus **both**
/// payloads: `diff` and `content`. `diff` is always present; when the live
/// content is byte-identical to the last recorded state but the declaration's
/// recorded hash is drifted, it degrades to a header-only block whose
/// `index rk64:<recorded>..rk64:<live>` line is itself the finding. The human
/// renderer emits exactly the same entry set.
///
/// **`unavailable`** replaces `content` whenever an anchor's content could not
/// be extracted: `"absent"` (no such file), `"range-past-eof"` (the declared
/// range starts past end of file), or `"binary"` (not UTF-8). It is a status to
/// style, never source to render — no placeholder prose is ever emitted as
/// content or as diff body text.
///
/// **`recorded`** appears as `"unrecoverable"` on a current anchor exactly
/// when no snapshot in this render's snapshot set hashes to the declaration's
/// recorded token — the predicate is render-scoped, not a claim about the
/// repository at large (a `.span` file edited but never committed, say). The
/// diff is then a header block naming both hashes, with no hunks: there is a
/// real drift, but no honest "before" text to show, and the live text is never
/// dressed up as the declared content.
///
/// **`proposed`** appears on a current anchor when the resolver believes the
/// anchored content now lives at a different address. It is a *proposal*
/// (`git span drift --fix` would write it), not an accomplished move.
pub fn render_json(report: &HistoryReport) -> Value {
    let commits: Vec<Value> = report
        .commits
        .iter()
        .rev()
        .map(|c| {
            let mut obj = serde_json::Map::new();
            obj.insert("hash".into(), json!(c.hash));
            obj.insert("date".into(), json!(c.date));
            obj.insert("summary".into(), json!(c.summary));
            if let Some(diff) = &c.span_diff {
                obj.insert("span_diff".into(), json!(diff));
            }
            let anchors: Vec<Value> = c
                .anchors
                .iter()
                .map(|a| {
                    let mut ao = serde_json::Map::new();
                    ao.insert("path".into(), json!(a.path));
                    match &a.content {
                        Some(content) => ao.insert("content".into(), json!(content)),
                        None => ao.insert("diff".into(), json!(a.diff)),
                    };
                    if let Some(u) = a.unavailable {
                        ao.insert("unavailable".into(), json!(u.as_str()));
                    }
                    // The structured form discriminator. Its presence *is*
                    // "this is the rebound block"; a consumer never has to
                    // parse the patch string to tell the two blocks at one
                    // address apart.
                    if let Some(r) = &a.rebound {
                        ao.insert("rebound".into(), json!({ "from": r.from, "to": r.to }));
                    }
                    Value::Object(ao)
                })
                .collect();
            obj.insert("anchors".into(), json!(anchors));
            Value::Object(obj)
        })
        .collect();

    let mut root = serde_json::Map::new();
    root.insert("schema_version".into(), json!(2));
    root.insert("span".into(), json!(report.span));
    if report.scoped {
        root.insert("scoped".into(), json!(true));
    }
    if let Some(cur) = &report.current {
        let mut co = serde_json::Map::new();
        if let Some(diff) = &cur.span_diff {
            co.insert("span_diff".into(), json!(diff));
        }
        let anchors: Vec<Value> = cur
            .anchors
            .iter()
            .map(|a| {
                let mut ao = serde_json::Map::new();
                ao.insert("path".into(), json!(a.path));
                if let Some(proposed) = &a.proposed {
                    ao.insert("proposed".into(), json!(proposed));
                }
                ao.insert("diff".into(), json!(a.diff));
                if let Some(content) = &a.content {
                    ao.insert("content".into(), json!(content));
                }
                if let Some(u) = a.unavailable {
                    ao.insert("unavailable".into(), json!(u.as_str()));
                }
                if a.recorded_unrecoverable {
                    ao.insert("recorded".into(), json!("unrecoverable"));
                }
                // Omitted, never `[]` and never `null`: `current.anchors[]`
                // spells absence by key presence throughout, and an empty array
                // would be a positive claim that the resolver found layers and
                // they were none.
                if !a.sources.is_empty() {
                    let layers: Vec<&str> = a
                        .sources
                        .iter()
                        .map(|s| crate::types::DriftSource::as_json_str(*s))
                        .collect();
                    ao.insert("sources".into(), json!(layers));
                }
                Value::Object(ao)
            })
            .collect();
        co.insert("anchors".into(), json!(anchors));
        root.insert("current".into(), Value::Object(co));
    }
    root.insert("commits".into(), json!(commits));

    Value::Object(root)
}
