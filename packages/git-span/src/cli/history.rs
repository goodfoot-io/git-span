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
//! | An anchor | The resolver reports it `Fresh` and its declared address did not move | A fresh anchor at an unmoved address has no drift to report; `git span stale` says the same |
//! | The rename form | Similarity measured below [`RENAME_SIMILARITY_FLOOR`] | `every_current_state`'s "declaration swap" and "cross-file swap" — splits into `deleted anchor` + `new anchor` |
//! | The `similarity index` line | Either side cannot be read as text ([`measured_similarity`]) — an unrecoverable recorded side, or a binary snapshot | `an_unmeasurable_reanchor_states_the_move_and_no_similarity`, plus `a_binary_recorded_side_is_recovered_not_declared_lost` |
//! | Hunks | The recorded side is unrecoverable, either side is binary (the renderer's `Binary files … differ` line), or a rename/proposal whose content is unchanged | `an_unrecoverable_recorded_snapshot_is_named_in_the_human_block`; hunks need two comparable bodies and synthesizing one presents it as the other's content |
//! | Hunks, on a rename block | Either side is bodyless — absent, or a declared range past end of file | `a_reanchor_past_end_of_file_is_unavailable_not_empty_content`. Signed lines against a side that has no bytes assert edits `git diff` cannot be asked about; the rename lines still state the move the declaration asserts |
//! | The live `content` payload | The live bytes are not UTF-8 — classified `unavailable: "binary"` by [`read_location_body`], the same policy as [`read_anchor_at_commit`] | `a_binary_live_side_is_structural_never_lossy_prose` — a lossy decode is prose wearing content's key |
//! | The live `content` payload | The declared range starts past the file's end — classified `unavailable: "range-past-eof"` by [`read_location_body`] via [`crate::git::slice_line_range`], which *is* the commit path's slice | `a_reanchor_past_end_of_file_is_unavailable_not_empty_content`, `a_truncated_file_is_past_eof_not_absent`, `both_read_paths_give_one_account_of_a_past_eof_range`. A range that merely overlaps the end is clipped, not skipped — only a range with no overlap at all has nothing to show |
//! | Reading the live location at all | The resolver bound no live location ([`build_current`]'s `None` arm) | `a_truncated_file_is_past_eof_not_absent`. The reason is then asked of the *declared* address directly ([`unresolved_reason`]) instead of being assumed: "the resolver found nothing" and "there is no such file" are different facts, and only the second is `absent` |
//! | A token-index entry | The snapshot has no body — [`Unavailable::Absent`] or [`Unavailable::RangePastEof`] ([`capture_by_hash`]) | Deliberate, and read from the *body*, not from the hash: a recorded token **can** be the null hash (`git span add` on an empty file records `rk64:0000000000000000`), so an empty-extent anchor is now indexed like any other. Measured benign before the change and correct after — positional candidates compare by hash equality, so same-address drift on an empty extent renders an honest hunk either way. A *binary* snapshot's real fingerprint stays indexed — `a_binary_recorded_side_is_recovered_not_declared_lost` is the fixture the old text-gate failed |
//! | A timeline entry | The two sides have equal bodies **and** the same reason for having none ([`crate::cli::unified_diff::render`]) | `a_change_of_unavailable_reason_renders_an_entry`. Two bodyless sides used to compare equal whatever they were: truncating a file past its declared range and then deleting the file is a change the render dropped entirely. Narrow on purpose — only two *both-bodyless* sides with differing reasons count; nothing else about change detection reads a reason |
//! | The rebinding block | Always — this path never renders one | Deliberate: a rebinding is a transition between two *committed* declaration states. The current block already renders a committed rebinding's live drift honestly, one in-place diff per anchor |
//!
//! Declared anchor ranges are taken at face value at every commit — a stale
//! range extracting "wrong" content *is* the drift being visualized. Anchor
//! diffs are always computed between extracted snapshots, never by clipping a
//! file's real commit patch to a line range.
//!
//! Content that cannot be extracted is *structural*, never prose: an absent
//! file or an out-of-range extent renders as a true `/dev/null` side, binary
//! content as git's `Binary files … differ` line, and JSON marks the reason in
//! a dedicated `unavailable` field. A placeholder string in a hunk body would
//! corrupt the hunk arithmetic and paint the placeholder as source.
//!
//! The `/dev/null` side says there are no bytes, and that is *all* it says —
//! which left the two reasons for having none rendering byte-identically in the
//! default output, hunk included. `unavailable` remains the contract for why,
//! but it is a JSON field, and the default output is text; a reader of the
//! command as most people run it could not tell a deleted file from a range
//! that starts past the end of a file sitting on disk, and the two want
//! opposite repairs. So the header carries a non-contractual
//! `content unavailable range-past-eof` line naming the reason the `/dev/null`
//! side cannot — git's `Binary files … differ` is the precedent for a dedicated
//! sentence, and the constraint against prose in the *body* is untouched.
//!
//! # The null hash is an ambiguous value
//!
//! `NULL_ANCHOR_HASH` means four different things, all of them reachable: an
//! absent file, a declared range past end of file, the `/dev/null` side of a
//! genuine create or delete, and a *genuinely empty recorded extent* (`git span
//! add` on an empty file). None of the four is prevented by anything, and no
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
    /// `true` when the git-log walk completed without hitting the time budget.
    /// `false` indicates a truncated timeline — the command exits non-zero.
    pub walk_complete: bool,
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
}

impl Unavailable {
    /// The JSON token for this reason.
    fn as_str(self) -> &'static str {
        match self {
            Unavailable::Absent => "absent",
            Unavailable::RangePastEof => "range-past-eof",
            Unavailable::Binary => "binary",
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

/// The optional current-drift section: how the working tree differs from the
/// last recorded timeline state and from HEAD.
pub struct CurrentSection {
    /// Blob diff of the `.span/<name>` declaration between HEAD and the
    /// working tree (covering uncommitted why edits and uncommitted anchor
    /// add/remove alike). Present iff the worktree bytes differ from HEAD.
    pub span_diff: Option<String>,
    /// Anchors the resolver reports as non-`Fresh` (plus any anchor whose
    /// declared address moved in the uncommitted declaration), in resolver
    /// order.
    pub anchors: Vec<CurrentAnchor>,
}

/// One anchor's drift record in the current section.
///
/// Both payloads are mandatory by construction: `diff` is always rendered
/// (header-only when content is byte-identical but the recorded hash is
/// stale — that mismatch *is* the finding), and exactly one of
/// `content`/`unavailable` describes the live snapshot. This is what keeps
/// the human and JSON renderers emitting the same entry set: an anchor that
/// `git span stale` reports can never silently vanish from the default
/// output.
pub struct CurrentAnchor {
    /// The anchor's **declared** address — the same string `git span stale`
    /// prints, and the only join key a consumer can match against the `.span`
    /// file. Never the resolver's proposal.
    pub path: String,
    /// Where the resolver believes the anchored content now lives, when that
    /// differs from `path`. A *proposal* (`git span stale --fix` would write
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
/// `args.format`. Returns exit code `0` on success, `1` on an incomplete walk
/// or hard error.
///
/// Error/not-found mapping follows the same conventions as `run_show` in
/// `show.rs`.
pub fn run_history(repo: &gix::Repository, args: HistoryArgs, span_root: &str) -> Result<i32> {
    let span_path = format!("{span_root}/{}", args.span);

    // Pass 1 — walk the declaration alone, unlimited, to learn every path the
    // span ever anchored. Without this, a commit that edits an anchored file
    // without touching the declaration is invisible and its content change
    // silently folds into the next declaration-touching commit.
    let (decl_commits, pass1_complete) = {
        let _perf = crate::perf::span("history.walk.declaration");
        crate::git::git_log_name_only_for_paths(
            repo,
            usize::MAX,
            std::slice::from_ref(&span_path),
        )?
    };
    if !pass1_complete {
        eprintln!(
            "error: history walk incomplete — not all commits were inspected (hit time budget)"
        );
        return Ok(1);
    }

    let mut seed_paths: Vec<String> = vec![span_path.clone()];
    {
        let _perf = crate::perf::span("history.walk.anchored-paths");
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for cc in &decl_commits {
            let span = match read_span_at_in(repo, &args.span, Some(&cc.hash), span_root) {
                Ok(m) => m,
                Err(crate::Error::SpanNotFound(_)) => continue,
                Err(e) => return Err(e.into()),
            };
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
    let (mut commits, walk_complete) = {
        let _perf = crate::perf::span("history.walk");
        crate::git::git_log_name_only_for_paths(repo, usize::MAX, &seed_paths)?
    };

    // Fail-closed: a truncated timeline is not a whole one. Emit a warning to
    // stderr, no partial output, and exit non-zero.
    if !walk_complete {
        eprintln!(
            "error: history walk incomplete — not all commits were inspected (hit time budget)"
        );
        return Ok(1);
    }

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
            walk_complete,
            &commits,
            args.limit,
        )?
    };

    // Fail-closed in spirit: a scoped/partial window must never read as the
    // complete record. Unlike the walk-budget truncation (an internal limit,
    // exit non-zero), `--limit` is an explicit user scope, so we still render
    // and exit 0 — but warn to stderr that older span history exists before
    // the window.
    if report.scoped {
        eprintln!(
            "warning: history is scoped — `--limit` dropped older commits; \
             this is a partial timeline, not the complete record"
        );
    }

    let _perf = crate::perf::span("history.render");
    match args.format {
        HistoryFormat::Human => {
            print!("{}", render_human(&report));
        }
        HistoryFormat::Json => {
            let value = render_json(&report);
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }
    Ok(0)
}

/// True when `name` reads as a span at `rev` (or in the working tree when
/// `rev` is `None`).
///
/// Any failure answers "no": a `.span/` *directory* — a namespace like
/// `agent-hooks` — is a tree, not a span, and so is anything else that will
/// not parse as one. Both deserve the curated not-found error below rather
/// than a raw object-store message.
fn names_a_span(
    repo: &gix::Repository,
    name: &str,
    rev: Option<&str>,
    span_root: &str,
) -> bool {
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
struct RenderedState {
    commit: String,
    anchors: Vec<Snapshot>,
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

/// Build the rendered state for a span at a commit.
fn rendered_state_at(repo: &gix::Repository, commit_oid: &str, span: &Span) -> RenderedState {
    let mut anchors = Vec::with_capacity(span.anchors.len());
    for (_id, a) in &span.anchors {
        let (body, hash) = read_anchor_at_commit(repo, commit_oid, a);
        anchors.push(Snapshot {
            address: anchor_address(a),
            first_line: extent_first_line(a.extent),
            hash,
            body,
            recorded: bare_hash(&a.stored_hash),
        });
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
fn push_reanchor_split(anchors: &mut Vec<CurrentAnchor>, old: &Snapshot, new: &Snapshot) {
    if let Some(diff) = snapshot_diff(Some(old), None) {
        anchors.push(CurrentAnchor::new(
            old.address.clone(),
            None,
            diff,
            &old.body,
            false,
        ));
    }
    if let Some(diff) = snapshot_diff(None, Some(new)) {
        anchors.push(CurrentAnchor::new(
            new.address.clone(),
            None,
            diff,
            &new.body,
            false,
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
fn anchor_header(old: Option<&Snapshot>, new: Option<&Snapshot>) -> DiffHeader {
    let null = || NULL_ANCHOR_HASH.to_string();
    match (old, new) {
        (Some(o), Some(n)) => DiffHeader::Anchor {
            old_hash: o.hash.clone(),
            new_hash: n.hash.clone(),
            kind: if o.address == n.address {
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
        },
        (None, Some(n)) => DiffHeader::Anchor {
            old_hash: null(),
            new_hash: n.hash.clone(),
            kind: AnchorDiffKind::New,
        },
        (Some(o), None) => DiffHeader::Anchor {
            old_hash: o.hash.clone(),
            new_hash: null(),
            kind: AnchorDiffKind::Deleted,
        },
        (None, None) => unreachable!("a diff needs at least one side"),
    }
}

/// Render one anchor pseudo-diff between two optional snapshots. The kind is
/// derived from the pair: `Modify` at an unchanged address, `Rename` when the
/// address moved (headers always, hunks only when content also changed), and
/// `New`/`Deleted` for an unpaired side.
fn snapshot_diff(old: Option<&Snapshot>, new: Option<&Snapshot>) -> Option<String> {
    if old.is_none() && new.is_none() {
        return None;
    }
    let header = anchor_header(old, new);
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
    let header = DiffHeader::Anchor {
        old_hash: old.recorded.clone(),
        new_hash: new.recorded.clone(),
        kind: AnchorDiffKind::Rebound,
    };
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
fn pair_anchors(old: &[Snapshot], new: &[Snapshot]) -> (Vec<Option<usize>>, Vec<usize>) {
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

    // Pass 4 — greedy similarity among the leftovers.
    loop {
        let mut best: Option<(u8, usize, usize)> = None;
        for (i, o) in old.iter().enumerate() {
            if old_used[i] || !o.body.is_text() {
                continue;
            }
            for (j, n) in new.iter().enumerate() {
                if pairs[j].is_some() || !n.body.is_text() {
                    continue;
                }
                let sim = similarity(o.body.text(), n.body.text());
                if sim < RENAME_SIMILARITY_FLOOR {
                    continue;
                }
                // Ties break by declaration order: the iteration order is
                // (old asc, new asc), so a strict `>` keeps the first-seen
                // candidate.
                if best.is_none_or(|(bs, _, _)| sim > bs) {
                    best = Some((sim, i, j));
                }
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

/// Diff a commit's rendered state against the previous rendered state and emit
/// a [`CommitSection`]. Returns `None` when nothing observable changed — a
/// commit that qualified for the walk (it touched an anchored file) but left
/// every declared range and the declaration itself untouched.
fn diff_section(
    repo: &gix::Repository,
    span_path: &str,
    ident: CommitIdent,
    prev: Option<&RenderedState>,
    cur: &RenderedState,
) -> Option<CommitSection> {
    let old_blob = prev.and_then(|p| blob_at(repo, &p.commit, span_path));
    let new_blob = blob_at(repo, &cur.commit, span_path);
    let span_diff = blob_diff(span_path, old_blob.as_ref(), new_blob.as_ref());

    let empty: Vec<Snapshot> = Vec::new();
    let old = prev.map(|p| p.anchors.as_slice()).unwrap_or(&empty);
    let new = cur.anchors.as_slice();
    let (pairs, dropped) = pair_anchors(old, new);

    let mut anchors: Vec<TimelineAnchor> = Vec::new();
    for (j, n) in new.iter().enumerate() {
        let o = pairs[j].map(|i| &old[i]);
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
        let Some(diff) = snapshot_diff(o, Some(n)) else {
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
        if let Some(diff) = snapshot_diff(Some(&old[i]), None) {
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

    Some(CommitSection {
        hash: ident.hash,
        date: ident.date,
        date_git: ident.date_git,
        summary: ident.summary,
        span_diff,
        anchors,
    })
}

/// Identity of the commit a section is being built for, in both date shapes
/// the two renderers need.
struct CommitIdent {
    hash: String,
    /// Full ISO-8601 timestamp with offset (JSON).
    date: String,
    /// Git's own default author-date rendering (human `Date:` line).
    date_git: String,
    summary: String,
}

#[allow(clippy::too_many_arguments)]
fn build_report(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    span_path: &str,
    walk_complete: bool,
    commits: &[crate::git::CommitChanges],
    limit: Option<usize>,
) -> Result<HistoryReport> {
    let mut sections: Vec<CommitSection> = Vec::new();

    // The declaration's recorded `rk64` tokens, keyed by declared address, read
    // from the live (working-tree) `.span` file — the same record `git span
    // stale` compares against.
    let recorded = recorded_hashes(repo, span_name, span_root);
    // The rendered snapshot, if any, whose content the declaration's recorded
    // token actually hashes. Collected across the walk (newest match wins) so
    // the `current` block can diff live content against *what was recorded*
    // rather than against whatever text now occupies the recorded line numbers.
    let mut recorded_snapshots: std::collections::HashMap<String, Snapshot> =
        std::collections::HashMap::new();
    // Every snapshot this render has produced, keyed by its content hash — the
    // set of contents the report itself displays. The `current` block's old
    // side draws from it, which is what makes "unrecoverable" mean something a
    // reader can check: if the recorded token is missing here, its bytes are
    // nowhere in this render either. Newest wins (the walk is newest-first).
    let mut rendered_by_hash: std::collections::HashMap<String, Snapshot> =
        std::collections::HashMap::new();

    // The walk is unbounded, so the oldest walked commit is the span's true
    // first appearance and needs no seeded baseline. (`--limit` trims *rendered
    // entries* afterwards, and every retained entry was built against real
    // prior state.)
    let mut prev: Option<RenderedState> = None;

    for cc in commits {
        // Read the span as it existed at this commit. An absent span
        // (deleted-then-re-added gap, or a commit predating the span's
        // creation that touched an anchored file) renders as an empty state.
        let span = match read_span_at_in(repo, span_name, Some(&cc.hash), span_root) {
            Ok(m) => Some(m),
            Err(crate::Error::SpanNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        };

        let cur = match &span {
            Some(m) => rendered_state_at(repo, &cc.hash, m),
            None => RenderedState {
                commit: cc.hash.clone(),
                anchors: Vec::new(),
            },
        };

        capture_recorded_snapshots(&recorded, &mut recorded_snapshots, &cur);
        capture_by_hash(&mut rendered_by_hash, &cur);

        let meta = crate::git::commit_meta(repo, &cc.hash)?;

        let ident = CommitIdent {
            hash: cc.hash.clone(),
            date: rfc2822_to_iso8601(&meta.author_date_rfc2822),
            date_git: rfc2822_to_git_default(&meta.author_date_rfc2822),
            summary: meta.summary.clone(),
        };

        if let Some(section) = diff_section(repo, span_path, ident, prev.as_ref(), &cur) {
            sections.push(section);
        }

        // Advance the baseline. A no-op commit yields `cur == prev`, so this is
        // harmless and never resets the diff anchor.
        prev = Some(cur);
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
    let last = match prev {
        Some(state) => Some(state),
        None => match read_span_at_in(repo, span_name, Some("HEAD"), span_root) {
            Ok(span) => crate::git::resolve_commit(repo, "HEAD")
                .ok()
                .map(|head| rendered_state_at(repo, &head, &span)),
            Err(crate::Error::SpanNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        },
    };
    if let Some(state) = last.as_ref() {
        capture_recorded_snapshots(&recorded, &mut recorded_snapshots, state);
        capture_by_hash(&mut rendered_by_hash, state);
    }

    let current = build_current(
        repo,
        span_name,
        span_root,
        span_path,
        last.as_ref(),
        &recorded,
        &recorded_snapshots,
        &rendered_by_hash,
    )?;

    Ok(HistoryReport {
        span: span_name.to_string(),
        walk_complete,
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
        let entry = seen.entry(bare_hash(&a.stored_hash)).or_insert_with(|| {
            Some((anchor_address(a), extent_first_line(a.extent)))
        });
        if entry.as_ref().is_some_and(|(addr, _)| *addr != anchor_address(a)) {
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
    at_address: &'a std::collections::HashMap<String, Snapshot>,
    /// Every snapshot this render produced, keyed by content hash. Membership
    /// here is exactly the negation of "unrecoverable".
    by_hash: &'a std::collections::HashMap<String, Snapshot>,
    /// The last recorded state's anchors, in declaration order.
    last_state: &'a [Snapshot],
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
    /// another address — exactly what `git span stale` prints `moved to` for.
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
    into: &mut std::collections::HashMap<String, Snapshot>,
    state: &RenderedState,
) {
    for snap in &state.anchors {
        if recorded.get(&snap.address) == Some(&snap.hash) {
            into.insert(snap.address.clone(), snap.clone());
        }
    }
}

/// Index every snapshot in `state` by its content hash.
///
/// Population rule, stated rather than inherited from map internals: states
/// arrive newest-first, anchors within a state in declaration order, and the
/// first entry for a hash wins — so the newest state's earliest-declared
/// anchor is the one kept, deterministically. A collision can only ever be
/// between byte-identical bodies (equal token means equal content — the
/// fingerprint covers the raw bytes, binary or not), and the label a side
/// wears is chosen by [`CurrentState`], never by the candidate, so the
/// tie-break can change neither the rendered bytes nor the address above them.
///
/// Membership is decided by whether the snapshot *has bytes*, not by whether
/// those bytes decoded as text: a binary snapshot has a real fingerprint and
/// only an unrenderable body, and excluding it from this index is exactly what
/// once made `recorded: "unrecoverable"` fire for a token the same render
/// printed as first-add content. What is skipped is a snapshot with nothing to
/// key: the two [`Unavailable`] reasons that mean "no bytes at this address".
///
/// The test reads the *body*, not the hash, and that is the whole point.
/// [`NULL_ANCHOR_HASH`] is an ambiguous value — an absent file, a past-EOF
/// range, a `/dev/null` side, and a genuinely empty recorded extent all wear it
/// — so `hash != NULL_ANCHOR_HASH` skipped a fourth state it never meant to:
/// `git span add` on an empty file records `rk64:0000000000000000`, and that
/// anchor was excluded from cross-address recovery. Reading the body asks the
/// question the guard was always trying to ask.
fn capture_by_hash(
    into: &mut std::collections::HashMap<String, Snapshot>,
    state: &RenderedState,
) {
    for snap in &state.anchors {
        let bodiless = matches!(
            snap.body.unavailable(),
            Some(Unavailable::Absent | Unavailable::RangePastEof)
        );
        if !bodiless {
            into.entry(snap.hash.clone()).or_insert_with(|| snap.clone());
        }
    }
}

/// Convert an RFC2822 date to a full ISO-8601 timestamp with offset
/// (`2026-07-29T15:12:41-07:00`, git's `%aI`). JSON consumers render both a
/// relative age and an absolute local time, neither of which a day-only string
/// can support.
fn rfc2822_to_iso8601(rfc2822: &str) -> String {
    use chrono::DateTime;
    match DateTime::parse_from_rfc2822(rfc2822) {
        Ok(dt) => dt.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        Err(_) => rfc2822.to_string(),
    }
}

/// Convert an RFC2822 date to git's own default `Date:` rendering
/// (`Thu Jul 30 12:04:37 2026 -0400`, git's `%ad`). A day-only string makes a
/// run of same-day commits — the normal shape of span history — unskimmable.
fn rfc2822_to_git_default(rfc2822: &str) -> String {
    use chrono::DateTime;
    match DateTime::parse_from_rfc2822(rfc2822) {
        Ok(dt) => dt.format("%a %b %e %H:%M:%S %Y %z").to_string(),
        Err(_) => rfc2822.to_string(),
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

/// Compute the `rk64` content hash of a resolved location, using the same
/// canonicalization the resolver and `git span add` use, so the `index rk64:…`
/// line on the live side of a current diff is the token a re-anchor would
/// record.
fn location_hash(repo: &gix::Repository, loc: &AnchorLocation) -> String {
    // A resolved location read from the working tree carries `blob: None` (see
    // `AnchorLocation::blob`), so the live bytes have to come from disk. The
    // body beside this hash comes from `read_location_body`, via
    // `stale_output::read_location_bytes_present`, and the two fallbacks are
    // not the same call: that one is a plain `std::fs::read`, this one runs
    // gix's `convert_to_git` normalization first and only falls back to a raw
    // read. The asymmetry is deliberate — a hash must be the token a re-anchor
    // would record, which is computed over normalized bytes, while the body is
    // what the file literally holds. It is also unobservable: a location the
    // resolver resolved carries its blob, so the two fallbacks only both fire
    // for a worktree-only read, where CRLF normalization changes the hash and
    // not the rendered text.
    let bytes = loc
        .blob
        .and_then(|oid| crate::git::read_blob_bytes(repo, &oid.to_string()).ok())
        .unwrap_or_else(|| {
            let path = loc.path.to_string_lossy().to_string();
            let mut filters = crate::resolver::layers::CustomFilters::new();
            crate::resolver::layers::read_worktree_normalized(repo, &mut filters, &path)
                .or_else(|_| crate::git::read_worktree_bytes(repo, &path))
                .unwrap_or_default()
        });
    extent_hash(&bytes, &loc.extent)
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
///   rewrite for what `git span stale` calls a pure move;
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
    let source = [
        sources.at_address.get(&address),
        Some(live),
        paired,
        sources.by_hash.get(&hash),
    ]
    .into_iter()
    .flatten()
    .chain(sources.last_state.iter())
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
/// A missing file is [`Unavailable::Absent`], which is what the doc's own gloss
/// says the word means. That distinction is why this reads through
/// [`read_location_bytes_present`]: an empty `Vec` cannot tell "no such file"
/// from "an empty file", and an empty file's extent is honest, extractable
/// content.
///
/// [`read_location_bytes_present`]: crate::cli::stale_output::read_location_bytes_present
fn read_location_body(repo: &gix::Repository, loc: &AnchorLocation) -> AnchorBody {
    let Some(bytes) = crate::cli::stale_output::read_location_bytes_present(repo, loc) else {
        return AnchorBody::Unavailable(Unavailable::Absent);
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return AnchorBody::Unavailable(Unavailable::Binary);
    };
    match loc.extent {
        AnchorExtent::WholeFile => AnchorBody::Text(text.to_string()),
        AnchorExtent::LineRange { start, end } => {
            match crate::git::slice_line_range(text, start, end) {
                Ok(sliced) => AnchorBody::Text(sliced),
                Err(_) => AnchorBody::Unavailable(Unavailable::RangePastEof),
            }
        }
    }
}

/// The hash that travels with a live body, mirroring [`read_anchor_at_commit`]'s
/// `missing` helper: a body with no bytes at all has nothing to fingerprint and
/// carries [`NULL_ANCHOR_HASH`], while binary bytes keep their real one (a
/// binary snapshot has an unrenderable *body*, not an absent *token*).
///
/// The null hash is an ambiguous value — four distinct states wear it — so it is
/// written *from* the body here and never read back to recover the state. Every
/// consumer that needs the reason takes it from [`AnchorBody::unavailable`].
fn live_hash(repo: &gix::Repository, loc: &AnchorLocation, body: &AnchorBody) -> String {
    match body.unavailable() {
        Some(Unavailable::Absent | Unavailable::RangePastEof) => NULL_ANCHOR_HASH.to_string(),
        _ => location_hash(repo, loc),
    }
}

/// Why an anchor the resolver could not bind has no live body.
///
/// The resolver answers "is there content here?", not "why not" — it reports a
/// deleted anchor and hands back no location, and the emitter used to read that
/// silence as [`Unavailable::Absent`], printing "no such file" for a file
/// sitting on disk. The declared address is still a readable question, so it is
/// asked directly, at the declared path with `blob: None` so the answer comes
/// from the working tree rather than from whatever object the resolver last
/// touched.
///
/// A readable declared range means the absence is the resolver's verdict rather
/// than the file system's, and [`Unavailable::Absent`] stands: the anchor's
/// *content* is gone even though its file is not.
fn unresolved_reason(repo: &gix::Repository, anchored: &AnchorLocation) -> Unavailable {
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
///   1. the resolver (the same `LayerSet::full()` engine `git span stale` uses)
///      reports a non-`Fresh` status for an anchor — committed-but-not-
///      re-anchored source drift, a relocated `moved` anchor, an uncommitted
///      edit, a deletion, …;
///   2. the worktree declaration differs from HEAD — one `span_diff` covering
///      uncommitted why edits and uncommitted anchor add/remove alike.
///
/// Each emitted anchor is keyed by its **declared** address (what `stale`
/// prints, and the only string a consumer can join against the `.span` file);
/// a resolver relocation is reported as a `proposed` address, never as a
/// completed rename. It carries both payloads: the live snapshot, and a diff
/// from the last recorded state that degrades to a header-only
/// `index rk64:<recorded>..rk64:<live>` block when the content is unchanged
/// but the declaration's recorded hash is stale — the mismatch *is* the
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
    recorded_snapshots: &std::collections::HashMap<String, Snapshot>,
    rendered_by_hash: &std::collections::HashMap<String, Snapshot>,
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
    // stale` uses: worktree-over-index-over-HEAD, with the staged-span layer
    // included.
    let options = crate::types::EngineOptions {
        layers: crate::types::LayerSet::full(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
        fuzzy_threshold: 0.95,
    };
    let names = [span_name.to_string()];
    let resolved = crate::resolver::resolve_named_spans(repo, span_root, &names, options)?;

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
            Err(e) => return Err(e.into()),
        };

        // Materialize *every* anchor (not only the drifted ones) so pairing
        // against the last recorded state sees the whole picture; only the
        // interesting ones are emitted below.
        let mut live: Vec<Snapshot> = Vec::with_capacity(span.anchors.len());
        let mut fresh: Vec<bool> = Vec::with_capacity(span.anchors.len());
        let mut states: Vec<CurrentState> = Vec::with_capacity(span.anchors.len());
        for r in &span.anchors {
            let declared = location_address(&r.anchored);
            // The resolver only *recommends* a relocation for the bytes-equal
            // statuses — the same ones `git span stale` prints `moved to
            // <address>` for. For a `Changed` anchor `r.current` is merely
            // where the search landed while establishing that the content
            // differs; `stale` issues no instruction, so neither may history.
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
                    let body = read_location_body(repo, loc);
                    let hash = live_hash(repo, loc, &body);
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
                    AnchorBody::Unavailable(unresolved_reason(repo, &r.anchored)),
                    NULL_ANCHOR_HASH.to_string(),
                    extent_first_line(r.anchored.extent),
                ),
            };
            live.push(Snapshot {
                // The declaration's recorded token for this address, so a live
                // snapshot carries the same identity a walked one does.
                recorded: recorded.get(&declared).cloned().unwrap_or_default(),
                address: declared,
                first_line,
                hash,
                body,
            });
            fresh.push(r.status == crate::types::AnchorStatus::Fresh);
            states.push(state);
        }

        let empty: Vec<Snapshot> = Vec::new();
        let old = last.map(|s| s.anchors.as_slice()).unwrap_or(&empty);
        let (pairs, _dropped) = pair_anchors(old, &live);

        for (j, n) in live.iter().enumerate() {
            let paired = pairs[j].map(|i| &old[i]);
            let state = &states[j];
            // A `Fresh` anchor has nothing to report unless the declaration
            // moved it; a worktree-removed or worktree-added anchor is already
            // covered by `span_diff`.
            if fresh[j] && !matches!(state, CurrentState::Reanchored { .. }) {
                continue;
            }
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
                        push_reanchor_split(&mut anchors, &o.snapshot, n);
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
            let header = DiffHeader::Anchor {
                old_hash: old_side
                    .as_ref()
                    .map(|o| o.snapshot.hash.clone())
                    .unwrap_or_else(|| NULL_ANCHOR_HASH.to_string()),
                new_hash: n.hash.clone(),
                kind,
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
/// Uncommitted drift comes first with no commit header (git's own idiom for
/// "not yet committed"), then commit entries newest-first: `commit <40-hex>`,
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
/// *declared* address, the same string `git span stale` prints — plus **both**
/// payloads: `diff` and `content`. `diff` is always present; when the live
/// content is byte-identical to the last recorded state but the declaration's
/// recorded hash is stale, it degrades to a header-only block whose
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
/// (`git span stale --fix` would write it), not an accomplished move.
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
                Value::Object(ao)
            })
            .collect();
        co.insert("anchors".into(), json!(anchors));
        root.insert("current".into(), Value::Object(co));
    }
    root.insert("commits".into(), json!(commits));

    Value::Object(root)
}
