//! `git span resolve <name>` — settle every residue entry in a
//! conflict-markered span file under one explicitly chosen side.
//!
//! `resolve` is the one command whose supported input is a file carrying Git
//! textual conflict markers. It reads that file as it stands, picks one side
//! — `--rehash` (worktree truth, the default), `--ours`, or `--theirs` — for
//! every residue entry at once, and either writes a clean span through the
//! ordinary [`SpanFile::serialize`] path or leaves the file byte-identical
//! and names the entry that stopped it.
//!
//! Three contracts distinguish it from `drift --fix`:
//!
//! * **All-or-nothing per span.** Any unsettleable residue aborts before the
//!   single write, so a failed `resolve` is always safe to retry with a
//!   different side.
//! * **Never stages.** `resolve` issues zero `git` subprocess calls; the
//!   operator reviews with `git diff` and stages what they agree with.
//! * **Narrow input claim.** Only the residue shape
//!   [`crate::cli::drift_fix::format_residue_markers`] produces is claimed —
//!   at most one conflict block on each side of the anchor/why separator, no
//!   `[config]` header inside either, and every line inside a block consistent
//!   with the region that block sits in. That last one is what makes the
//!   anchor/why boundary *established* rather than guessed: the format marks it
//!   with a blank line and nothing else, so a boundary the reader cannot prove
//!   is a refusal, never a reading. Anything else is refused before the marker
//!   split is trusted for anything.
//!
//! Anchors and why always come from the live worktree text, so progress an
//! operator already made by hand is read as agreed content rather than
//! reverted. Unmerged index stages are consulted only for what the residue
//! writer silently omits from that text — `[config]`, theirs' `why` when the
//! writer left it out because the field had not diverged, and a `base` for
//! three-way arbitration — never to override an anchor or a non-empty
//! text-sourced why.

use crate::cli::commit::{span_file_path, write_worktree_span};
use crate::cli::drift_fix::{read_clean_source_files, split_conflict_markers};
use crate::cli::repair_domain;
use crate::cli::{CliError, NextStep, ResolveArgs, ResolveFormat};
use crate::span_file::{AnchorRecord, SpanFile};
use anyhow::Result;
use git_span_core::UnresolvedAnchor;
use git_span_core::{
    AnchorLineShape, SpanConfig, classify_anchor_line, has_conflict_markers, merge_span_files,
    resolve_config, resolve_why_text,
};
use std::collections::{BTreeSet, HashMap, HashSet};

/// `resolve`-family JSON document version. Its own family: the document is
/// identified by the top-level `command: "resolve"` key plus this number.
pub const RESOLVE_JSON_SCHEMA_VERSION: u32 = 1;

/// The `[config]`-recovery ceiling line (step 11). Printed whenever `resolve`
/// writes a span whose final config is the default and no readable second
/// evidence source existed to recover a dropped `[config]` from.
///
/// It states unverifiability, not loss. The run cannot tell a span that
/// legitimately had default settings from one whose non-default settings the
/// residue writer dropped — claiming the latter would be a second label
/// speaking past its evidence, and a warning that asserts loss on the ordinary
/// case is one the operator learns to skip. It also says "could be read"
/// rather than "were available", because the gate fires both when no unmerged
/// stage existed and when every stage that existed failed to parse — the two
/// cases [`unreadable_stage_line`] tells apart.
const CONFIG_LOSS_LINE: &str = "`[config]` was not recoverable from this input, so the span was \
     written with default settings (copy_detection=same-commit, ignore_whitespace=false, \
     follow_moves=false). The residue writer never serializes `[config]` into the conflict text \
     and no unmerged index stage could be read to supply one, so whether the span carried \
     non-default settings before this conflict cannot be determined from here — check \
     `git log -p` on the span file if it matters, and restore them with a follow-up edit.";

/// The `why`-recovery ceiling line (step 11), symmetric to [`CONFIG_LOSS_LINE`]
/// and stating the same unverifiability rather than an unprovable loss.
const WHY_LOSS_LINE: &str = "The why text was written empty. The residue writer carries only the \
     `ours` side's why into the conflict text, so a why only `theirs` added is absent from it, \
     and no unmerged index stage could be read to supply one — whether prose was lost cannot be \
     determined from here. Restore it by hand if the span had why prose before this conflict.";

// ---------------------------------------------------------------------------
// The shared "resolve exists" remediation
// ---------------------------------------------------------------------------

/// What was *actually detected*, said as the thing that was detected.
///
/// Both halves of `Error::SpanConflict` used to arrive as one opaque variant,
/// so every surface printed the same sentence — "an unresolved merge (unmerged
/// index entry or `<<<<<<<`/`>>>>>>>` markers)" — an either/or that told the
/// operator the tool had not looked. It had looked; the answer was discarded
/// one frame later. With the kind carried through, each surface can say which
/// one fired, and more usefully can say what that implies about staging: an
/// unmerged index entry outlives the text fix, and marker text in an
/// already-merged file does not.
pub(crate) fn conflict_diagnosis(name: &str, kind: git_span_core::ConflictKind) -> String {
    match kind {
        git_span_core::ConflictKind::UnmergedIndex => format!(
            "The index holds unmerged stage entries for `{name}`: Git recorded a conflict here \
             and nothing has settled it yet. git-span refuses to read any layer's content as \
             valid span data while that is true. Settling the worktree text is half the exit — \
             the unmerged index entry survives it until the file is staged."
        ),
        git_span_core::ConflictKind::MarkerText => format!(
            "The span file for `{name}` carries `<<<<<<<`/`=======`/`>>>>>>>` markers while the \
             index holds a single, merged entry — residue committed, or left behind after the \
             index was already settled. git-span refuses to read marker text as valid span \
             data. There is no unmerged stage here, so settling the text is the whole fix."
        ),
    }
}

/// The remediation that names `git span resolve` on the surfaces an operator
/// actually reaches while a span file is conflicted — `show`, `list`, `why`,
/// and `drift --fix`'s bail-outs. Every one of those refuses the file, and
/// none of them could previously offer anything but a text editor.
///
/// Two things this text deliberately does **not** do:
///
/// * **It does not pick a side.** `--rehash` and `--ours`/`--theirs` answer
///   different questions — worktree truth versus "this branch was right" — and
///   which one the operator wants is not derivable from the fact that a file is
///   conflicted. `--dry-run` reports all three without writing, so it is the
///   only honest first suggestion.
/// * **It does not promise success.** `resolve` fails closed on residue whose
///   anchor/why boundary it cannot establish, and `--rehash` fails closed on a
///   source it cannot read. Pointing an operator at a command that will refuse
///   them, without saying so, is the same defect as not pointing at all.
///
/// It takes the same `kind` [`conflict_diagnosis`] does, and for the same
/// reason. Printed one paragraph under that diagnosis, it used to contradict it
/// outright on the [`MarkerText`](git_span_core::ConflictKind::MarkerText) arm:
/// the diagnosis said "there is no unmerged stage here" and this text answered
/// that the index still holds one until the file is staged, then fenced
/// `git add`. It reached that by asking [`repair_domain::commands_for`] with
/// [`repair_domain::BLOCKER_UNSTAGED_RESOLUTION`] hardcoded — the domain table
/// consulted with the answer supplied — which is why no test in
/// [`repair_domain`] could catch it. The blocker now comes from
/// [`repair_domain::conflict_blocker`], so the state decides which commands are
/// nameable and this text can only describe the one it is in.
pub(crate) fn conflict_remediation(
    names: &[&str],
    span_root: &str,
    kind: git_span_core::ConflictKind,
) -> Vec<NextStep> {
    let plural = names.len() != 1;
    let file_word = if plural { "files" } else { "file" };
    let blocker = repair_domain::conflict_blocker(kind);
    let staging = repair_domain::commands_for(blocker)
        .into_iter()
        .find(|d| d.intersects(repair_domain::BLOCKER_UNSTAGED_RESOLUTION));
    let mut steps = vec![
        // On an unmerged index the text half may already be done — this is the
        // state `resolve` itself leaves behind, since it writes the worktree
        // and never stages. Leading straight into `resolve --dry-run` there
        // prescribes a command that prints "no conflict markers; nothing to
        // resolve" and exits 0, which reads as "everything is fine" to an
        // operator whose merge is still unfinished. Say which half is which
        // before naming either.
        NextStep::Prose(match kind {
            git_span_core::ConflictKind::UnmergedIndex => format!(
                "Two things are outstanding and they clear in order: the marker text in the \
                 span {file_word}, then the unmerged index entry. If the {file_word} no longer \
                 {} `<<<<<<<` markers — an earlier `resolve` or a hand edit already settled the \
                 text — skip to the staging step below; `resolve` would report `nothing to \
                 resolve` and exit 0 without changing anything.",
                if plural { "carry" } else { "carries" }
            ),
            git_span_core::ConflictKind::MarkerText => format!(
                "The index holds a single, merged entry here, so the marker text in the span \
                 {file_word} is the only thing outstanding — there is no stage waiting on a \
                 `git add`."
            ),
        }),
        NextStep::Prose(format!(
            "`git span resolve` settles a conflicted span {file_word} without a text editor: it \
             takes one side for the whole span at once — `--rehash` (re-read each anchor's \
             source and hash it), `--ours`, or `--theirs`. Which side is right is yours to \
             decide; `--dry-run` writes nothing and reports what all three would produce:"
        )),
        NextStep::Bash(
            names
                .iter()
                .map(|n| format!("git span resolve {n} --dry-run"))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        NextStep::Prose(
            "Then re-run with the side you chose. `resolve` is all-or-nothing: if it cannot \
             settle every entry under that side — or cannot establish the anchor/why boundary \
             in the residue — it leaves the span file byte-identical and names what stopped it, \
             and editing the file by hand remains available."
                .into(),
        ),
    ];
    // The exit — on the state that has one. Without it the operator lands back
    // here: `resolve` succeeds, the worktree file is clean, and the index still
    // holds the unmerged entry — so every surface that reads the *effective*
    // view keeps refusing, and each one points at `resolve` again. Five
    // surfaces, one circle. `resolve` not staging is a deliberate contract of
    // this command, which makes `git add` the exit and makes naming it this
    // text's job. Named only; nothing here runs it.
    //
    // On `MarkerText` there is no unmerged stage, so this whole paragraph is a
    // claim about a state the operator is not in, and the command under it is
    // one `commands_for` declines to name. Both drop out together, from the
    // same lookup.
    match staging {
        Some(domain) => {
            steps.push(NextStep::Prose(format!(
                "`resolve` writes the settled span {file_word} to the working tree and stops — \
                 it never stages. Until the {file_word} {} staged the index still holds the \
                 unmerged entry, and `show`, `list`, `why`, and `drift` all keep reporting the \
                 conflict. Review the result with `git diff`, then finish the merge:",
                if plural { "are" } else { "is" }
            )));
            steps.push(NextStep::Bash(
                names
                    .iter()
                    .map(|n| format!("{} {span_root}/{n}", domain.command))
                    .collect::<Vec<_>>()
                    .join("\n"),
            ));
        }
        None => steps.push(NextStep::Prose(format!(
            "Review the result with `git diff`. Nothing further is needed: with the markers out \
             of the {file_word}, `show`, `list`, `why`, and `drift` read {} again.",
            if plural { "them" } else { "it" }
        ))),
    }
    steps
}

/// The one-line form of [`conflict_remediation`], for the streaming surfaces
/// (`drift`'s report footer, `drift --fix`'s per-span warnings) that have no
/// `## What to do next` section to render into.
///
/// Same two restraints: it names `--dry-run` rather than a side, and it says
/// the run may write nothing.
pub(crate) fn conflict_hint_line(name: &str, span_root: &str) -> String {
    format!(
        "`git span resolve {name} --dry-run` reports what `--rehash`, `--ours`, and `--theirs` \
         would each write for this span; re-run with the side you want. It writes nothing \
         unless the side you pick settles every entry, and it never stages — finish with \
         `git add {span_root}/{name}` once the result reads right, or this report says the \
         same thing on the next run."
    )
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/// Which side of the conflict decides every residue entry.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Side {
    /// Re-read each conflicted anchor's source from the worktree and hash it.
    Rehash,
    Ours,
    Theirs,
}

impl Side {
    /// The three sides in the order `--dry-run` reports them.
    const ALL: [Side; 3] = [Side::Rehash, Side::Ours, Side::Theirs];

    fn flag(self) -> &'static str {
        match self {
            Side::Rehash => "--rehash",
            Side::Ours => "--ours",
            Side::Theirs => "--theirs",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Side::Rehash => "rehash",
            Side::Ours => "ours",
            Side::Theirs => "theirs",
        }
    }
}

// ---------------------------------------------------------------------------
// Index-stage evidence (step 4, second half)
// ---------------------------------------------------------------------------

/// What the unmerged index stages contributed, and what they could not.
///
/// The stage blobs are frozen at the moment the conflict was created while the
/// worktree file is live, so they supply only the three things the residue
/// writer can silently drop from that live text: `base` (stage 1) for
/// three-way arbitration, `[config]` (stages 2/3, grafted onto the
/// text-sourced sides), and **theirs'** `why` when the text carries none.
/// Anchors are never sourced from here under any circumstance.
#[derive(Debug, Default)]
struct StageEvidence {
    /// The merge base's span file, when stage 1 exists **and parsed** — the
    /// only input to `resolve_why_text`/`resolve_config`'s three-way arm.
    base: Option<SpanFile>,
    /// True when the span path had at least one unmerged index entry. False
    /// means there is no second evidence source at all, which is what the two
    /// recovery-ceiling report lines are conditional on.
    available: bool,
    /// True when at least one existing stage blob actually parsed. `available`
    /// alone is not enough to gate the ceiling lines on: a stage that exists
    /// but cannot be read is *not* a recovery source, and treating it as one
    /// is how a swallowed parse error suppressed loss reporting.
    parsed_any: bool,
    /// Stages that exist in the index but could not be read, decoded, or
    /// parsed, named for the report. A span file committed with conflict
    /// markers still in it is the realistic producer: `SpanFile::parse` fails
    /// closed on markers by design, so the next merge that touches the path
    /// stages a blob no reader can use.
    unreadable: Vec<&'static str>,
    /// True when the supplement genuinely replaced theirs' empty text-sourced
    /// why with a non-empty stage value.
    why_recovered: bool,
    /// Where each side's `[config]` value came from, as `(ours, theirs)`. Every
    /// config label is derived from this: `[config]` is the one field no side
    /// of the conflict *text* can speak about, so a label claiming the two
    /// sides agreed — or that arbitration chose between them — has to be able
    /// to point at what said so.
    config_provenance: (ConfigProvenance, ConfigProvenance),
}

/// What supplied one side's `[config]`, in report terms.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum ConfigProvenance {
    /// No stage spoke for this side. Its config is whatever the input text
    /// parsed to — which the residue writer never populates, so a *default*
    /// value here is the absence of evidence rather than a stated setting.
    #[default]
    Unread,
    /// A parsed unmerged index stage supplied it.
    Stage,
    /// The stage existed but could not be read, so the value was filled in as
    /// unchanged-from-base. That is `resolve`'s inference, not this side's
    /// assertion, and no label may credit the side with it.
    Inferred,
}

/// What one index stage yielded. `Absent` and `Unreadable` are the two states
/// `.ok()?` used to collapse into one — and collapsing them is what let an
/// unreadable stage become a `SpanConfig::default()` that then *won* the
/// three-way merge, reported as an affirmative arbitration result.
enum StageRead {
    Absent,
    Unreadable,
    Parsed(Box<SpanFile>),
}

impl StageRead {
    fn parsed(&self) -> Option<&SpanFile> {
        match self {
            StageRead::Parsed(f) => Some(f),
            _ => None,
        }
    }
}

/// Read the unmerged index stages for `{span_root}/{name}` and supplement the
/// text-sourced sides with what the residue writer drops.
///
/// `ours`/`theirs` are mutated only in `.config` (unconditionally, when the
/// corresponding stage blob exists) and `theirs.why` (only when the
/// text-sourced value is empty). Their anchors are never touched.
///
/// **The why supplement is theirs-only, and that is a claim about the writer,
/// not a convenience.** `format_residue_markers` carries a non-diverged why
/// into the text by writing `ours_why` — so `ours`' why is never dropped: a
/// non-empty one is written (plainly, or into the why block when it diverges),
/// and an empty one is empty because `ours` genuinely has no why.
///
/// `theirs`' why is the only one the writer can lose, and it can lose it in
/// **both directions**, which is what the earlier presence-only supplement
/// missed. When the field has not diverged the writer emits `ours_why` for
/// both sides, so the text says nothing whatsoever about `theirs`:
///
/// * *Addition* — `theirs` added prose `ours` lacks. The text carries `ours`'
///   empty why, and stage 3 is the only surviving copy.
/// * *Deletion* — `theirs` deleted prose `ours` still has. The text carries
///   `ours`' prose on both sides, fabricating agreement, and no side flag can
///   override it because nothing looks divergent. A peer's deliberate deletion
///   is silently reverted.
///
/// So the supplement consults stage 3 for absence as well as presence, under a
/// discriminator that cannot revert a hand edit: it fires only when the two
/// text-sourced whys are *identical* (the writer's non-diverged shape, in
/// which the text is not per-side evidence at all) **and** that text still
/// equals stage 2's why (so `ours`' copy is the writer's, not the operator's).
/// A why the operator typed into the file differs from stage 2 and is left
/// alone, which is the same guarantee the empty-string discriminator gave.
/// Supplementing `ours` from stage 2 is still not done: the writer cannot lose
/// ours' why, so it would carry no true positive and one false positive.
fn load_stage_evidence(
    repo: &gix::Repository,
    span_root: &str,
    name: &str,
    ours: &mut SpanFile,
    theirs: &mut SpanFile,
) -> StageEvidence {
    let rel = format!("{span_root}/{name}");
    let entries = crate::git::index_entries(repo).unwrap_or_default();
    let unmerged: Vec<&crate::git::IndexEntrySnapshot> = entries
        .iter()
        .filter(|e| e.path == rel && e.stage != gix::index::entry::Stage::Unconflicted)
        .collect();

    // Each failure below is a *distinct* outcome from "the stage is not
    // there", and the caller needs the difference: an absent stage carries no
    // claim, while an unreadable one carries a claim nobody can read.
    let read_stage = |stage: gix::index::entry::Stage| -> StageRead {
        let Some(entry) = unmerged.iter().find(|e| e.stage == stage) else {
            return StageRead::Absent;
        };
        let Ok(bytes) = crate::git::read_blob_bytes(repo, &entry.oid.to_string()) else {
            return StageRead::Unreadable;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            return StageRead::Unreadable;
        };
        match SpanFile::parse(&text) {
            Ok(file) => StageRead::Parsed(Box::new(file)),
            Err(_) => StageRead::Unreadable,
        }
    };

    let staged_base = read_stage(gix::index::entry::Stage::Base);
    let staged_ours = read_stage(gix::index::entry::Stage::Ours);
    let staged_theirs = read_stage(gix::index::entry::Stage::Theirs);

    let unreadable: Vec<&'static str> = [
        ("base (stage 1)", &staged_base),
        ("ours (stage 2)", &staged_ours),
        ("theirs (stage 3)", &staged_theirs),
    ]
    .into_iter()
    .filter(|(_, read)| matches!(read, StageRead::Unreadable))
    .map(|(label, _)| label)
    .collect();

    let mut evidence = StageEvidence {
        base: staged_base.parsed().cloned(),
        available: !unmerged.is_empty(),
        parsed_any: staged_base.parsed().is_some()
            || staged_ours.parsed().is_some()
            || staged_theirs.parsed().is_some(),
        unreadable,
        why_recovered: false,
        config_provenance: (ConfigProvenance::Unread, ConfigProvenance::Unread),
    };

    // `[config]` never survives the residue writer, so a stage blob is
    // strictly better evidence than the text whenever it exists.
    //
    // An **unreadable** stage is the one case that must never become a value.
    // Leaving that side at `SpanConfig::default()` while the other side is
    // grafted makes `resolve_config` read a failed read as "this side changed
    // the config to the defaults", and that fabricated change then wins the
    // three-way merge and is reported as an arbitration result. Absence of
    // evidence is instead treated as *unchanged from base* — the base's value
    // if it parsed, else the other side's, else no graft at all — so the side
    // that does have evidence decides and nothing is invented.
    let fallback_config = |other: &StageRead| -> Option<SpanConfig> {
        staged_base
            .parsed()
            .or_else(|| other.parsed())
            .map(|f| f.config)
    };
    evidence.config_provenance.0 = match &staged_ours {
        StageRead::Parsed(staged) => {
            ours.config = staged.config;
            ConfigProvenance::Stage
        }
        StageRead::Unreadable => {
            if let Some(config) = fallback_config(&staged_theirs) {
                ours.config = config;
            }
            ConfigProvenance::Inferred
        }
        StageRead::Absent => ConfigProvenance::Unread,
    };
    evidence.config_provenance.1 = match &staged_theirs {
        StageRead::Parsed(staged) => {
            theirs.config = staged.config;
            ConfigProvenance::Stage
        }
        StageRead::Unreadable => {
            if let Some(config) = fallback_config(&staged_ours) {
                theirs.config = config;
            }
            ConfigProvenance::Inferred
        }
        StageRead::Absent => ConfigProvenance::Unread,
    };

    // Theirs-only why supplement, per this function's doc comment.
    let text_ours_why = ours.why.clone();
    let text_theirs_why = theirs.why.clone();
    if let Some(staged) = staged_theirs.parsed() {
        if text_theirs_why.trim().is_empty() && !staged.why.trim().is_empty() {
            // Presence: the writer dropped a why only `theirs` had.
            theirs.why = staged.why.clone();
            evidence.why_recovered = true;
        } else if let Some(staged_o) = staged_ours.parsed()
            && text_ours_why == text_theirs_why
            && text_ours_why == staged_o.why
            && staged.why != text_theirs_why
        {
            // Absence (and any other one-sided change): the text is the
            // writer's copy of `ours`' why on both sides, so it is not
            // evidence about `theirs` at all. `why_recovered` stays false —
            // restoring a *deletion* is not something to label "recovered".
            theirs.why = staged.why.clone();
        }
    }

    evidence
}

// ---------------------------------------------------------------------------
// Settlement result shapes
// ---------------------------------------------------------------------------

/// One settled entry in the report: an anchor address and what happened to it.
#[derive(Debug, Clone, serde::Serialize)]
struct ReportEntry {
    address: String,
    outcome: String,
}

/// A successful per-side settlement: the span that would be (or was) written
/// plus everything the report needs.
#[derive(Debug)]
struct Settlement {
    merged: SpanFile,
    entries: Vec<ReportEntry>,
    why_label: String,
    config_label: String,
    warnings: Vec<String>,
    /// True when the merge needed no side arbitration at all (no residue).
    structural_only: bool,
}

/// The outcome of evaluating one side. Non-propagating by construction so
/// `--dry-run` can complete all three evaluations regardless of any failing.
#[derive(Debug)]
enum SideOutcome {
    Resolved(Box<Settlement>),
    /// The side cannot settle this file. `reasons` is what the operator reads;
    /// `blocker` is what the *remediation* is computed from.
    ///
    /// Carrying `blocker` is the point. Detection knows more than a sentence:
    /// it knows an unreadable anchor has a readable same-range counterpart at
    /// another path, which is a defect `git span drift --fix` repairs. Before
    /// this field the reporting layer could only see a list of English
    /// sentences, so it named no command and the operator was left at a dead
    /// end. See [`crate::cli::repair_domain`].
    Failed {
        reasons: Vec<String>,
        blocker: Vec<repair_domain::Repair>,
    },
}

// ---------------------------------------------------------------------------
// JSON documents
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
struct ResolveDocument {
    schema_version: u32,
    command: &'static str,
    span: String,
    side: &'static str,
    dry_run: bool,
    written: bool,
    entries: Vec<ReportEntry>,
    why: String,
    config: String,
    /// The same claim the human report's structural line makes, so the two
    /// surfaces cannot tell different stories about whether the chosen side
    /// was needed at all.
    structural_only: bool,
    warnings: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
struct SideDocument {
    side: &'static str,
    outcome: &'static str,
    entries: Vec<ReportEntry>,
    failures: Vec<String>,
    why: Option<String>,
    config: Option<String>,
    structural_only: Option<bool>,
    warnings: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
struct ResolveDryRunDocument {
    schema_version: u32,
    command: &'static str,
    span: String,
    dry_run: bool,
    written: bool,
    sides: Vec<SideDocument>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git span resolve <name>`. See the module docs for the contract.
pub fn run_resolve(repo: &gix::Repository, args: ResolveArgs, span_root: &str) -> Result<i32> {
    let name = args.name.clone();

    // Step 1: read the worktree span file.
    let path = span_file_path(repo, span_root, &name)?;
    if !path.exists() {
        return Err(CliError {
            subcommand: "resolve",
            summary: format!("no span named `{name}`."),
            what_happened: format!("`{span_root}/{name}` does not exist."),
            next_steps: vec![NextStep::Bash("git span list".into())],
        }
        .into());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` could not be read."),
        what_happened: format!("Reading `{}` failed: {e}", path.display()),
        next_steps: vec![NextStep::Prose(format!(
            "`{span_root}/{name}` is not a readable span file. A hierarchical span whose \
             directory shadows this name occupies the same path — list what is there and \
             resolve the leaf span by its full name."
        ))],
    })?;

    // Step 2: no-op check (worktree-text question, exit 0 per the
    // add-refresh precedent).
    if !has_conflict_markers(&raw) {
        println!("`{name}` has no conflict markers; nothing to resolve");
        return Ok(0);
    }

    // Step 3: driver-shape refusal, unconditional. Returns the marker-length
    // canonicalized text the split is verified against.
    let shaped = verify_driver_shape(&raw, &name)?;

    // Step 4: split and parse. Anchors and why come solely from the worktree
    // text; the index stages supplement config, an empty why, and base.
    let (ours_text, theirs_text) = split_conflict_markers(&shaped).ok_or_else(|| {
        anyhow::anyhow!("internal error: span `{name}` reported as conflicted but no markers found")
    })?;
    let mut ours = SpanFile::parse(&ours_text).map_err(|e| parse_error(&name, "ours", e))?;
    let mut theirs = SpanFile::parse(&theirs_text).map_err(|e| parse_error(&name, "theirs", e))?;

    let stages = load_stage_evidence(repo, span_root, &name, &mut ours, &mut theirs);
    if !stages.available {
        eprintln!(
            "warning: no unmerged index stages found for `{name}`; [config] divergence a prior \
             partial merge may have already dropped cannot be recovered."
        );
    }
    if !stages.unreadable.is_empty() {
        eprintln!("warning: {}", unreadable_stage_line(&stages));
    }

    if args.dry_run {
        return run_dry_run(repo, &name, &ours, &theirs, &stages, args.format);
    }

    let side = if args.ours {
        Side::Ours
    } else if args.theirs {
        Side::Theirs
    } else {
        Side::Rehash
    };

    // Steps 5–8: compute source evidence, run the pre-kernel checks, merge,
    // and settle why/config.
    match evaluate_side(repo, side, &ours, &theirs, &stages) {
        SideOutcome::Failed { reasons, blocker } => {
            // The remediation may not promise what this run has not checked, so
            // check it: evaluate the sides it is about to recommend against
            // this same file and recommend only the ones that settle it.
            let alternatives: Vec<Side> = Side::ALL
                .iter()
                .copied()
                .filter(|&other| other != side)
                .filter(|&other| {
                    matches!(
                        evaluate_side(repo, other, &ours, &theirs, &stages),
                        SideOutcome::Resolved(_)
                    )
                })
                .collect();
            Err(failure_error(&name, side, &reasons, &alternatives, &blocker).into())
        }
        SideOutcome::Resolved(settlement) => {
            let mut settlement = *settlement;
            // Steps 9 + 10: canonical sort, then the single write. Nothing
            // below this point can fail in a way that leaves a partial file.
            write_worktree_span(repo, span_root, &name, &mut settlement.merged)?;
            // Step 11: report.
            match args.format {
                ResolveFormat::Human => print_human(&name, side, &settlement, span_root),
                ResolveFormat::Json => print_json(&name, side, &settlement)?,
            }
            Ok(0)
        }
    }
}

/// `--dry-run`: report what EACH of the three sides would produce. Side flags
/// are ignored; nothing is written; every side completes regardless of
/// another side's failure.
fn run_dry_run(
    repo: &gix::Repository,
    name: &str,
    ours: &SpanFile,
    theirs: &SpanFile,
    stages: &StageEvidence,
    format: ResolveFormat,
) -> Result<i32> {
    let outcomes: Vec<(Side, SideOutcome)> = Side::ALL
        .iter()
        .map(|&side| (side, evaluate_side(repo, side, ours, theirs, stages)))
        .collect();

    match format {
        ResolveFormat::Human => {
            println!("dry run for `{name}` — nothing written; all three sides evaluated");
            for (side, outcome) in &outcomes {
                match outcome {
                    SideOutcome::Resolved(settlement) => {
                        println!("{}: would resolve", side.flag());
                        for line in settlement_lines(settlement) {
                            println!("  {line}");
                        }
                    }
                    SideOutcome::Failed { reasons, .. } => {
                        println!("{}: would fail", side.flag());
                        for reason in reasons {
                            println!("  {reason}");
                        }
                    }
                }
            }
        }
        ResolveFormat::Json => {
            let doc = ResolveDryRunDocument {
                schema_version: RESOLVE_JSON_SCHEMA_VERSION,
                command: "resolve",
                span: name.to_string(),
                dry_run: true,
                written: false,
                sides: outcomes
                    .iter()
                    .map(|(side, outcome)| match outcome {
                        SideOutcome::Resolved(s) => SideDocument {
                            side: side.name(),
                            outcome: "resolved",
                            entries: s.entries.clone(),
                            failures: Vec::new(),
                            why: Some(s.why_label.clone()),
                            config: Some(s.config_label.clone()),
                            structural_only: Some(s.structural_only),
                            warnings: s.warnings.clone(),
                        },
                        SideOutcome::Failed { reasons, .. } => SideDocument {
                            side: side.name(),
                            outcome: "failed",
                            entries: Vec::new(),
                            failures: reasons.clone(),
                            why: None,
                            config: None,
                            structural_only: None,
                            warnings: Vec::new(),
                        },
                    })
                    .collect(),
            };
            println!("{}", serde_json::to_string_pretty(&doc)?);
        }
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// Step 3: driver-shape refusal
// ---------------------------------------------------------------------------

/// Length of a leading run of `c`, when the run is at least 7 characters
/// long (the shortest conflict marker git ever writes).
fn marker_run_len(line: &str, c: char) -> Option<usize> {
    let len = line.chars().take_while(|ch| *ch == c).count();
    if len >= 7 { Some(len) } else { None }
}

/// Refuse input shapes [`crate::cli::drift_fix::format_residue_markers`] cannot
/// produce, and return the text with conflict markers canonicalized to length 7.
///
/// The claim is derived from the writer, which emits residue in two regions
/// split by the blank-line separator: **at most one** conflict block before it
/// (all divergent anchors, coalesced into a single block) and **at most one**
/// after it (both sides' divergent why). A file with two blocks on the same
/// side of the separator is therefore not the writer's output — it is what
/// Git's default text merge produces when the span driver is not registered,
/// and `resolve`'s settlement is not verified against it. `[config]` is never
/// serialized into residue at all, so one inside a block is refused too.
///
/// **Counting blocks is not enough, and that is what this function got wrong
/// before.** The span format marks the anchor/why boundary with a blank line
/// and nothing else, so the boundary is a fact the writer knows and the reader
/// can only reconstruct. A block's *position* relative to the first outside
/// blank is a claim about the boundary, not a check of it: nothing downstream
/// — not [`SideBuilder`], not `SpanFile::parse`, not either pre-kernel check —
/// can distinguish a boundary reconstructed correctly from one reconstructed
/// wrongly, and a wrong one is silently either a deleted anchor or a fabricated
/// one. So this function now *establishes* the boundary instead of assuming it,
/// by checking every line inside a conflict block against the region the block
/// sits in:
///
/// * **Anchor-region blocks carry only anchor records.** The writer emits
///   exactly `UnresolvedAnchor` serializations there — never a blank line. A
///   blank inside an anchor-region block is the one thing that makes
///   [`SideBuilder`]'s per-side boundary *asymmetric*, which is how prose
///   became an anchor on one side and an anchor became prose on the other.
///   Refusing it is what makes the two sides' boundaries provably the same
///   outside blank line, and therefore makes the split trustworthy.
/// * **A whole-file "anchor" whose path contains whitespace is prose.** Real
///   whole-file anchors are paths; a sentence ending in a colon-bearing token
///   (a URL, most often) parses as one. Inside an anchor-region block that
///   ambiguity is unresolvable, so it is refused rather than written back as a
///   tracked anchor.
/// * **Why-region blocks carry no bare anchor record, in either address form.**
///   A tracked anchor that lands after the separator is deleted outright, and
///   the deletion cannot even be reported, because `build_entries` iterates the
///   anchors that survived. The producer is not hypothetical: the
///   `format_residue_markers` that predates `42d28964` pushes the blank
///   separator first and *then* opens a block holding the anchor residue, so
///   every anchor it wrote sits after the separator. Whole-file anchors render
///   through the same `Display` without a `#L` range, which is why the check
///   names both `WholeFile` and `LineRange` — covering only the line-range form
///   left the whole-file form, a fifth of this repository's own anchors, to be
///   eaten silently.
///
///   Both are keyed on two things at once, and the pair is what makes the
///   refusal land on records rather than on prose. First, a *whitespace-free*
///   address: `parse_anchor_line` splits at the last space, so words around a
///   quoted address are absorbed into the path, and `docs at
///   https://example.com` or a why quoting an anchor mid-sentence arrives with
///   whitespace in it. Second, a *writer-shaped* content hash — sixteen
///   lowercase hex, the only thing `rk64_to_hex` can produce — which catches
///   the one-word prose the first test misses: `See https://example.com` has a
///   whitespace-free address and a hash of `//example.com`, and `Ref rfc:1234`
///   a hash of `1234`. Neither is a hash any writer emitted.
///
///   The remaining ambiguity is irreducible and is the case that *must* stay
///   refused: a why line quoting a genuine anchor verbatim,
///   `src/b.txt rk64:1111111111111111`, is byte-identical to a misplaced
///   record. So is a real anchor whose own path contains a space, which goes
///   the other way and is still lost to the why. See the card's
///   `notes/boundary-provenance-limit.md`.
///
/// Every one of these is a refusal with the file left byte-identical — the
/// fail-closed answer to a boundary that cannot be established, in place of a
/// guess that silently loses or invents tracked couplings.
///
/// Git writes markers at the configured conflict-marker size (`%L`, which
/// [`crate::cli::merge_driver`] honors), while the shared split recognizes a
/// `=======` separator only at exactly seven characters — [`SideBuilder`]'s
/// structural boundary tracking did not change that. Canonicalizing the three
/// marker forms here — and only inside a block, so a Markdown setext underline
/// in why prose is untouched — keeps a `%L=9` residue file readable without
/// changing the shared splitter every other caller depends on.
///
/// [`SideBuilder`]: crate::cli::drift_fix
fn verify_driver_shape(raw: &str, name: &str) -> std::result::Result<String, CliError> {
    // Several blockers live in this function and they have different repair
    // domains, so they get different remediations — see
    // [`crate::cli::repair_domain`]. More blocks in one region than any writer
    // emits is re-derivable: `drift --fix` splits the file and writes canonical
    // residue back. A line on the wrong side of the *separator* is not: every
    // writer here, `drift --fix` included, reads the separator's position out
    // of the text rather than deciding it, so `drift --fix` rewrites the marker
    // labels, changes the file, and leaves the blocker exactly where it was.
    // Naming it there is what made `resolve` → `drift --fix` → `resolve` a
    // loop with no exit. An unparseable side is a third case, and it is split
    // by region rather than reported as one blocker: `drift --fix` bails on an
    // unparseable *anchor* block and touches nothing, but on an unparseable
    // *why* block it rewrites the file and drops `[config]` entirely, so the
    // two cannot share a sentence about what running it would do.
    let refusal = |reason: String, blocker: &'static [repair_domain::Repair]| CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` is not in the shape `resolve` can settle."),
        what_happened: format!(
            "{reason} This is not the shape `git span merge-driver` or `git span drift --fix` \
             produce, and `resolve`'s marker-splitting is not verified safe for it. The span \
             file was not modified."
        ),
        next_steps: shape_refusal_steps(blocker),
    };
    let shape_refusal = |reason: String| refusal(reason, repair_domain::BLOCKER_RESIDUE_SHAPE);

    let mut out = String::new();
    // Blocks are counted per region, split at the first blank line outside
    // every block — the same separator `SideBuilder` flips on, so the two
    // counts are exactly "anchor-residue blocks" and "why-residue blocks".
    let mut anchor_blocks = 0usize;
    let mut why_blocks = 0usize;
    let mut in_why_region = false;
    let mut open_len: Option<usize> = None;
    // Inside the diff3 base region the content is discarded by the split, so
    // it is neither an anchor nor a why and is not checked.
    let mut in_base = false;

    for line in raw.lines() {
        if let Some(len) = marker_run_len(line, '<') {
            if in_why_region {
                why_blocks += 1;
            } else {
                anchor_blocks += 1;
            }
            open_len = Some(len);
            in_base = false;
            out.push_str("<<<<<<<");
            out.push_str(&line[len..]);
            out.push('\n');
            continue;
        }
        if let Some(len) = open_len {
            if let Some(close_len) = marker_run_len(line, '>') {
                open_len = None;
                in_base = false;
                out.push_str(">>>>>>>");
                out.push_str(&line[close_len..]);
                out.push('\n');
                continue;
            }
            if let Some(base_len) = marker_run_len(line, '|') {
                in_base = true;
                out.push_str("|||||||");
                out.push_str(&line[base_len..]);
                out.push('\n');
                continue;
            }
            if let Some(sep_len) = marker_run_len(line, '=')
                && sep_len == len
                && line[sep_len..]
                    .chars()
                    .next()
                    .is_none_or(char::is_whitespace)
            {
                in_base = false;
                out.push_str("=======");
                out.push_str(&line[sep_len..]);
                out.push('\n');
                continue;
            }
            if line.trim() == "[config]" {
                // The region decides the blocker, because it decides what
                // `drift --fix` does to the file — nothing, or a rewrite that
                // drops the `[config]` block the header belongs to.
                let (region, blocker) = if in_why_region {
                    ("why text", repair_domain::BLOCKER_UNPARSEABLE_WHY_RESIDUE)
                } else {
                    (
                        "anchor block",
                        repair_domain::BLOCKER_UNPARSEABLE_ANCHOR_RESIDUE,
                    )
                };
                return Err(refusal(
                    format!(
                        "Span `{name}` has a `[config]` header inside a conflict block in its \
                         {region}, so that side does not parse as a span file."
                    ),
                    blocker,
                ));
            }
            if !in_base
                && let Some(reason) = boundary_violation(line, in_why_region, name)
            {
                return Err(refusal(reason, repair_domain::BLOCKER_SEPARATOR_PLACEMENT));
            }
        } else if line.is_empty() && !in_why_region {
            // The first blank line outside every block is the anchor/why
            // separator, exactly as `SideBuilder::push` reads it.
            in_why_region = true;
        }
        out.push_str(line);
        out.push('\n');
    }

    if anchor_blocks > 1 {
        return Err(shape_refusal(format!(
            "Span `{name}` has {anchor_blocks} conflict blocks in its anchor block; the residue \
             writer coalesces every divergent anchor into one."
        )));
    }
    if why_blocks > 1 {
        return Err(shape_refusal(format!(
            "Span `{name}` has {why_blocks} conflict blocks in its why text; the residue writer \
             writes at most one."
        )));
    }

    Ok(out)
}

/// One line inside a conflict block, checked against the region the block sits
/// in. Returns the refusal reason when the line makes the anchor/why boundary
/// unestablishable, `None` when it is consistent with its region.
///
/// See [`verify_driver_shape`] for why each shape is refused rather than
/// interpreted.
fn boundary_violation(line: &str, in_why_region: bool, name: &str) -> Option<String> {
    let shape = classify_anchor_line(line);
    if in_why_region {
        // The discriminator after the separator is **bare record versus
        // embedded text**, not which address form the line uses. An address
        // with no whitespace in it means the line is the whole record and
        // nothing else — what a writer emits, and what prose reaches only by
        // being nothing but an address. An address that *does* carry
        // whitespace means the words around it were absorbed into the path by
        // `parse_anchor_line`'s split-at-the-last-space, which is ordinary why
        // prose: `docs at https://example.com` is a `WholeFile` with a spacey
        // path, and a why quoting an anchor mid-sentence is a `LineRange` with
        // one. Refusing those would hard-stop the prose `42d28964` exists to
        // protect.
        //
        // Both address forms are named rather than left to a wildcard: the
        // whole-file form was the hole — the pre-`42d28964` writer emitted
        // tracked anchors after the separator, `Display` renders a whole-file
        // anchor without `#L`, and the arm covered only the line-range form.
        let described = match shape {
            AnchorLineShape::NotAnchor => return None,
            // Prose. An address that absorbed whitespace is text with an
            // address in it, not a record.
            AnchorLineShape::LineRange {
                path_has_whitespace: true,
                ..
            }
            | AnchorLineShape::WholeFile {
                path_has_whitespace: true,
                ..
            } => return None,
            // Prose too, on the second half of the test: no writer here emits a
            // content hash that is not sixteen lowercase hex, so a line whose
            // hash is `//example.com` or `1234` is a sentence ending in a
            // colon-bearing token, not a record that was misplaced. This is a
            // precondition on the refusal, never a trigger for one — see
            // `hash_is_writer_shaped`'s note on why the polarity matters.
            AnchorLineShape::LineRange {
                hash_is_writer_shaped: false,
                ..
            }
            | AnchorLineShape::WholeFile {
                hash_is_writer_shaped: false,
                ..
            } => return None,
            AnchorLineShape::LineRange { .. } => "line-range anchor record",
            AnchorLineShape::WholeFile { .. } => "whole-file anchor record",
        };
        return Some(format!(
            "Span `{name}` has a {described}, `{line}`, inside a conflict block that sits *after* \
             the blank-line separator. The residue writer puts anchor residue before the separator \
             and never after it, so this line is either a tracked anchor that a different writer \
             misplaced — settling it here would delete it — or why prose that is indistinguishable \
             from one."
        ));
    }
    match shape {
        AnchorLineShape::NotAnchor if line.is_empty() => Some(format!(
            "Span `{name}` has a blank line inside a conflict block that sits *before* the \
             blank-line separator. A blank inside a block moves the anchor/why boundary on one \
             side only, so the two sides no longer agree on where it is and `resolve` cannot \
             establish it."
        )),
        AnchorLineShape::NotAnchor => Some(format!(
            "Span `{name}` has a line inside its anchor-residue conflict block that is not an \
             anchor record: `{line}`. The residue writer emits nothing but anchor records \
             before the separator."
        )),
        AnchorLineShape::WholeFile {
            path_has_whitespace: true,
            ..
        } => Some(format!(
            "Span `{name}` has a line inside its anchor-residue conflict block whose whole-file \
             anchor path contains whitespace: `{line}`. That is the shape prose takes when it \
             ends in a colon-bearing token such as a URL, and settling it would write a \
             fabricated anchor whose path is a sentence."
        )),
        // The second half of the same discriminator the why-region arm reads,
        // in the direction this region asks it. A content hash that is not
        // sixteen lowercase hex is not one any writer here produced — the only
        // production write is `content_hash: rk64_to_hex(fp)`, which is
        // `format!("{fp:016x}")` — so a line carrying `//example.com` or `1234`
        // is a sentence whose last token merely holds a colon, not an anchor
        // record. `See https://example.com` splits at the last space into
        // address `See` and hash part `https://example.com`, so it has a
        // *whitespace-free* whole-file address and the arm above cannot see it;
        // settling it writes a tracked coupling at path `See`, a word lifted
        // out of the operator's own prose.
        //
        // Both arms read the same property and neither can refuse a
        // writer-produced line on it: after the separator the shape is a
        // precondition on refusing, so consulting it only permits more; here it
        // is the mirror — everything it newly refuses is a line no writer emits
        // in this region, because every record a writer puts before the
        // separator carries a sixteen-hex hash by construction.
        AnchorLineShape::WholeFile {
            hash_is_writer_shaped: false,
            ..
        }
        | AnchorLineShape::LineRange {
            hash_is_writer_shaped: false,
            ..
        } => Some(format!(
            "Span `{name}` has a line inside its anchor-residue conflict block whose content \
             hash is not the sixteen lowercase hex digits every writer emits: `{line}`. That is \
             the shape prose takes when its last word holds a colon, and settling it would write \
             a fabricated anchor whose path is a word from the surrounding sentence."
        )),
        // What is left is what a real anchor record looks like, which is
        // exactly what belongs before the separator. Every field is named
        // rather than left to a wildcard so a new `AnchorLineShape` — and a new
        // combination of these two — has to be decided here too.
        //
        // A line-range address whose path holds whitespace stays permitted, and
        // that is a trade rather than an omission: unlike the hash test it has
        // a real cost, since an anchor whose own path contains a space
        // (`my file.txt#L1-L3 rk64:…`) is a genuine record this would hard-stop.
        // See the card's `notes/boundary-provenance-limit.md`.
        AnchorLineShape::WholeFile {
            path_has_whitespace: false,
            hash_is_writer_shaped: true,
        }
        | AnchorLineShape::LineRange {
            hash_is_writer_shaped: true,
            ..
        } => None,
    }
}

/// The remediation for a [`verify_driver_shape`] refusal, derived from the
/// blocker rather than written per call site.
///
/// **The `&'static` bound is the guard, and it sits here rather than on the
/// caller for a reason.** This function joins `commands_for`'s output into one
/// fence, so a blocker spanning two domains makes that fence a sequence.
/// `resolve` builds blockers in a runtime `Vec<Repair>` elsewhere;
/// `'static` admits only the declared constants, so that accumulator cannot
/// reach here. On the closure that calls this — where the bound used to be —
/// the same guarantee held only because this function happened to have one
/// caller, and a second caller added anywhere would have compiled with a local
/// `Vec` and relaxed nothing visible.
///
/// When [`repair_domain::commands_for`] returns nothing the refusal says so in
/// as many words and stops at the hand edit. That empty case is the whole
/// reason this is computed: the previous text offered `git span drift --fix`
/// unconditionally, and on the separator-placement blocker that command
/// rewrites the marker labels — changing the file, advancing nothing, and
/// sending the operator back into `resolve` for the identical refusal.
fn shape_refusal_steps(blocker: &'static [repair_domain::Repair]) -> Vec<NextStep> {
    let commands = repair_domain::commands_for(blocker);
    if commands.is_empty() {
        let mut steps = vec![
            NextStep::Prose(format!(
                "No git-span command repairs this. {}",
                repair_domain::no_command_reason(blocker)
            )),
            // This paragraph used to instruct the operator to "lift any
            // `[config]` header out of the block entirely" as a plain fact
            // about the file in front of them. It presupposes the header is
            // still there, and an operator who ran `drift --fix` first arrives
            // with it already gone and nothing in the file recording that it
            // existed — a tidy little why conflict that looks finished. So the
            // instruction is conditional, and the sentence that matters most
            // to that operator is where their settings actually survived.
            NextStep::Prose(
                "Edit the span file by hand: move each line inside the conflict block to the \
                 side of the blank-line separator it belongs on — anchor records before it, \
                 why prose after it — and if a `[config]` header is inside a block, lift it \
                 out of the block entirely. `resolve` has written nothing, so the file is \
                 exactly as Git left it."
                    .into(),
            ),
        ];
        // Only on the variant where a `[config]` block can already have been
        // destroyed before the operator got here.
        if blocker.contains(&repair_domain::Repair::UnparseableWhyResidue) {
            steps.push(NextStep::Prose(
                "If the file no longer shows a `[config]` block that it used to carry, do not \
                 finish by hand: the settings live in the unmerged index stages, `git span \
                 resolve` reads them from there, and `git add` is what discards them. \
                 `git show :2:<path>` prints the `ours` stage if you want to look first."
                    .into(),
            ));
        }
        return steps;
    }
    let mut steps = vec![NextStep::Prose(
        "If this came from Git's default text merge (the span merge driver not registered in \
         `.gitattributes`), the structural fix re-derives the residue:"
            .into(),
    )];
    steps.push(repair_domain::remediation_fence(blocker));
    steps.push(NextStep::Prose(
        "Otherwise resolve this span file by hand.".into(),
    ));
    steps
}

/// Wrap a side's parse failure. Names which side failed and the underlying
/// parse error — residue has not been enumerated yet, so no anchor can be
/// named. The file is untouched either way.
fn parse_error(name: &str, side: &str, err: impl std::fmt::Display) -> CliError {
    CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` could not be parsed after splitting its conflict."),
        what_happened: format!(
            "The `{side}` side of the conflict in `{name}` failed to parse: {err}. The span file \
             was not modified."
        ),
        next_steps: vec![NextStep::Prose(
            "Correct the malformed side in the span file by hand, then retry.".into(),
        )],
    }
}

// ---------------------------------------------------------------------------
// Steps 5–8: per-side settlement
// ---------------------------------------------------------------------------

/// Canonical `<path>` / `<path>#L<start>-L<end>` address text.
fn address(path: &str, start_line: u32, end_line: u32) -> String {
    if start_line == 0 && end_line == 0 {
        path.to_string()
    } else {
        format!("{path}#L{start_line}-L{end_line}")
    }
}

fn anchor_key(anchor: &AnchorRecord) -> (&str, u32, u32) {
    (anchor.path.as_str(), anchor.start_line, anchor.end_line)
}

/// Evaluate one side end-to-end without propagating any failure: every
/// failure becomes this side's own reported outcome. `--dry-run` needs this
/// (three independent evaluations must all complete); the single-side path
/// turns a `Failed` into the all-or-nothing `CliError`.
fn evaluate_side(
    repo: &gix::Repository,
    side: Side,
    ours: &SpanFile,
    theirs: &SpanFile,
    stages: &StageEvidence,
) -> SideOutcome {
    // Step 5: source evidence. `--ours`/`--theirs` never read a source at
    // all — routing around an unreadable source is the entire point of them.
    let source_files: Vec<(String, Vec<u8>)> = if side == Side::Rehash {
        match read_clean_source_files(repo, ours, theirs) {
            Ok(files) => files,
            Err(e) => {
                return SideOutcome::Failed {
                    reasons: vec![e.to_string()],
                    blocker: Vec::new(),
                };
            }
        }
    } else {
        Vec::new()
    };

    // Steps 6 + 6b: pre-kernel checks that keep the kernel from producing a
    // hash `resolve` cannot vouch for.
    let mut failures: Vec<String> = Vec::new();
    // What the *reporting* layer will be allowed to name. Detection fills it;
    // `failure_error` reads it. Empty means no command in this CLI advances
    // what stopped this side.
    let mut blocker: Vec<repair_domain::Repair> = Vec::new();
    if side == Side::Rehash {
        let renamed = renamed_anchor_candidates(ours, theirs, &source_files);
        let unverifiable = unverifiable_anchor_failures(ours, theirs, &source_files, &renamed);
        if !unverifiable.is_empty() && !renamed.is_empty() {
            blocker.extend_from_slice(repair_domain::BLOCKER_RENAMED_ANCHOR_PATH);
        }
        failures.extend(unverifiable);
        failures.extend(rehash_validity_failures(ours, theirs, &source_files));
    }

    let ours_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        ours.anchors.iter().map(|a| (anchor_key(a), a)).collect();
    let theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        theirs.anchors.iter().map(|a| (anchor_key(a), a)).collect();

    // Step 7: kernel merge.
    let result = merge_span_files(None, ours, theirs, &source_files);
    let anchor_residue: Vec<&UnresolvedAnchor> = result
        .unresolved
        .iter()
        .filter(|u| !u.path.is_empty())
        .collect();

    // Step 8: why/config, computed independently of the kernel's collapsed
    // synthetic marker so each divergence is reported for what it is.
    let (why, why_diverged) = resolve_why_text(stages.base.as_ref(), ours, theirs);
    let (config, config_diverged) = resolve_config(stages.base.as_ref(), ours, theirs);

    let mut merged = result.merged.clone();

    match side {
        Side::Rehash => {
            for u in &anchor_residue {
                failures.push(format!(
                    "{}: divergent hash with no clean source to re-hash from (ours {}:{}, \
                     theirs {}:{})",
                    address(&u.path, u.start_line, u.end_line),
                    u.ours.algorithm,
                    u.ours.content_hash,
                    u.theirs.algorithm,
                    u.theirs.content_hash
                ));
            }
            if why_diverged {
                failures.push(
                    "`--why` text diverged between ours and theirs, and the worktree has \
                     nothing to say about prose"
                        .to_string(),
                );
            }
            if config_diverged {
                failures.push("`[config]` diverged between ours and theirs".to_string());
            }
            if !failures.is_empty() {
                return SideOutcome::Failed {
                    reasons: failures,
                    blocker,
                };
            }
        }
        Side::Ours | Side::Theirs => {
            // Every anchor-residue entry carries both records, so this side
            // always resolves. Orphans are untouched: they arrive through the
            // kernel's union branch, never through `unresolved`.
            for u in &anchor_residue {
                merged.anchors.push(if side == Side::Ours {
                    u.ours.clone()
                } else {
                    u.theirs.clone()
                });
            }
        }
    }

    // The side override fires only on real divergence: an uncontested value
    // three-way resolution already settled is never overwritten.
    let chosen_why = if why_diverged {
        match side {
            Side::Ours => ours.why.clone(),
            Side::Theirs => theirs.why.clone(),
            Side::Rehash => why.clone(),
        }
    } else {
        why.clone()
    };
    let chosen_config = if config_diverged {
        match side {
            Side::Ours => ours.config,
            Side::Theirs => theirs.config,
            Side::Rehash => config,
        }
    } else {
        config
    };
    merged.why = chosen_why;
    merged.config = chosen_config;

    // Step 9: canonical order — step 7's manually pushed entries are not
    // necessarily sorted.
    merged.anchors.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    // Whether *any* residue existed at all — the question the report's
    // structural line answers, asked of the two split sides rather than of the
    // kernel's leftovers. `result.unresolved` is empty on exactly the
    // successful `--rehash` runs where residue existed and re-hashing settled
    // it, so reading it after the merge announces "no residue required the
    // requested side" directly beneath a per-anchor line saying re-hashing was
    // what settled one.
    let contested_anchor = ours.anchors.iter().any(|a| {
        theirs_map
            .get(&anchor_key(a))
            .is_some_and(|t| t.algorithm != a.algorithm || t.content_hash != a.content_hash)
    });
    let structural_only = !contested_anchor && !why_diverged && !config_diverged;

    // Anchors whose source cannot be read at all. Under `--rehash` that is a
    // refusal above and this set is empty by construction; under a side flag it
    // is the expected input, and the same set drives both the per-anchor label
    // and the summary warning so the two cannot disagree.
    let unverified_paths: BTreeSet<String> = if side == Side::Rehash {
        BTreeSet::new()
    } else {
        dead_source_paths(repo, &merged)
    };

    let entries = build_entries(side, &merged, &ours_map, &theirs_map, &unverified_paths);
    // The supplement is only worth reporting when what it recovered is what
    // actually got written: `--ours` on a why the operator cleared writes the
    // empty value it was asked for, and calling that "recovered" would be a
    // second misleading label in place of the one this state exists to fix.
    let why_recovered = stages.why_recovered && merged.why == theirs.why;
    let why_label = field_label(
        side,
        why_diverged,
        &ours.why,
        &theirs.why,
        &merged.why,
        why_recovered,
    );
    let config_label = field_label_config(
        side,
        config_diverged,
        ours,
        theirs,
        &merged,
        stages.config_provenance,
    );

    // The two ceiling lines describe what could not be recovered, so they fire
    // only where there genuinely was no second evidence source to recover from.
    let mut warnings = Vec::new();
    if !stages.unreadable.is_empty() {
        warnings.push(unreadable_stage_line(stages));
    }
    if let Some(line) = unverified_anchor_warning(&merged, &unverified_paths) {
        warnings.push(line);
    }
    // A stage that exists but cannot be parsed is not a recovery source, so
    // `available` alone cannot gate these: gating on it is what suppressed
    // loss reporting on exactly the run where a stage blob failed to read.
    if !stages.available || !stages.parsed_any {
        if merged.config == SpanConfig::default() {
            warnings.push(CONFIG_LOSS_LINE.to_string());
        }
        if merged.why.trim().is_empty() {
            warnings.push(WHY_LOSS_LINE.to_string());
        }
    }

    SideOutcome::Resolved(Box::new(Settlement {
        merged,
        entries,
        why_label,
        config_label,
        warnings,
        structural_only,
    }))
}

/// Step 6: **every** anchor that would be written must have a readable source,
/// or `--rehash` cannot vouch for the hash it writes.
///
/// The predecessor of this check fired only on an anchor whose
/// `(path, start, end)` key was present on one side and absent on the other —
/// a condition well-formed driver residue can never satisfy. The residue
/// writer puts only same-key `unresolved` entries inside the conflict block and
/// every other anchor outside it, where the split copies it into *both* sides,
/// so `ours` and `theirs` always carry identical key sets. The check was
/// therefore unreachable on exactly the input it existed to protect — a real
/// orphan whose source is gone was cloned with its stale hash and reported
/// `unchanged` — while the only way to make key sets diverge was to corrupt the
/// marker split, on which it fired and described a sentence fragment as an
/// orphan anchor. It was wired to the complement of its own condition.
///
/// Readability, not orphanhood, is the property `--rehash` needs: the kernel
/// clones an anchor whose source it cannot find, whether that anchor is an
/// orphan, a same-key divergence, or agreed on both sides. So this iterates the
/// union of both key sets and fails on any unreadable path. Orphans keep their
/// own wording because the side an orphan came from is information the operator
/// needs and no other anchor has.
///
/// This is `--rehash`-only by design, and the asymmetry is the point:
/// `--ours`/`--theirs` exist *because* a source may be deleted, still
/// conflicted, or ambiguously renamed, and refusing there would make the
/// card's headline recovery fail on its headline input. Those sides write the
/// anchor and say so in a warning instead — see
/// [`unverified_anchor_warning`].
fn unverifiable_anchor_failures(
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
    renamed: &[(String, String)],
) -> Vec<String> {
    let readable: HashSet<&str> = source_files.iter().map(|(p, _)| p.as_str()).collect();
    let ours_keys: HashSet<(&str, u32, u32)> = ours.anchors.iter().map(anchor_key).collect();
    let theirs_keys: HashSet<(&str, u32, u32)> = theirs.anchors.iter().map(anchor_key).collect();

    let mut failures = BTreeSet::new();
    for anchor in ours.anchors.iter().chain(theirs.anchors.iter()) {
        let key = anchor_key(anchor);
        if readable.contains(anchor.path.as_str()) {
            continue;
        }
        let addr = address(&anchor.path, anchor.start_line, anchor.end_line);
        let orphan_side = match (ours_keys.contains(&key), theirs_keys.contains(&key)) {
            (true, false) => Some("ours"),
            (false, true) => Some("theirs"),
            _ => None,
        };
        // The observation, stated as an observation. Not "this file was
        // renamed" — an operator who cannot reproduce that claim from the two
        // sides in front of them has been failed exactly the way this finding
        // describes, one layer along. What is true and checkable is that some
        // *other* anchor on this input covers the same range at a path that
        // does read.
        let counterpart: String = renamed
            .iter()
            .filter(|(dead, _)| *dead == addr)
            .map(|(_, live)| live.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let same_range = if counterpart.is_empty() {
            String::new()
        } else {
            format!(
                "; an anchor over the same line range at a different, readable path is present \
                 on this input ({counterpart})"
            )
        };
        failures.insert(match orphan_side {
            Some(side_name) => format!(
                "{addr}: orphan anchor referenced only by {side_name}; source unreadable, \
                 cannot verify under --rehash{same_range}"
            ),
            None => format!(
                "{addr}: source unreadable, cannot verify this anchor under --rehash{same_range}"
            ),
        });
    }
    failures.into_iter().collect()
}

/// The rename *signal*, and nothing more than the signal.
///
/// [`unverifiable_anchor_failures`] refuses an anchor whose source cannot be
/// read, and until now it named no command — leaving the operator at a dead
/// end on the one input where a command does apply. Rename repair is squarely
/// inside `git span drift --fix`'s domain, so the refusal is allowed to name it
/// (see [`crate::cli::repair_domain`]) exactly when this predicate holds.
///
/// The predicate is deliberately the smallest thing that supports the claim:
/// **for an unreadable anchor, does a readable anchor over the same line range
/// at a different path exist across the two sides?** It is computed over the
/// union of both parsed sides and the already-collected readable source set,
/// so it needs nothing beyond what `--rehash` has already read.
///
/// It notably does **not** call `plan_orphan_removals`. That function is pure,
/// so borrowing its candidate search was tempting, but its search is defined
/// over orphan index sets — precisely the bookkeeping `resolve` was moved off
/// — and importing it would re-couple the two. What is needed here is one
/// range comparison, not a relocation planner.
///
/// What the caller may say from this is bounded by what was actually observed:
/// a same-range readable counterpart exists. It is **not** evidence that a
/// rename happened — an unrelated anchor can share a range — and the message
/// must not claim one.
fn renamed_anchor_candidates(
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> Vec<(String, String)> {
    let readable: HashSet<&str> = source_files.iter().map(|(p, _)| p.as_str()).collect();
    let union: Vec<&AnchorRecord> = ours.anchors.iter().chain(theirs.anchors.iter()).collect();
    let mut pairs = BTreeSet::new();
    for dead in union.iter().filter(|a| !readable.contains(a.path.as_str())) {
        for live in union.iter().filter(|a| readable.contains(a.path.as_str())) {
            if live.path != dead.path
                && live.start_line == dead.start_line
                && live.end_line == dead.end_line
            {
                pairs.insert((
                    address(&dead.path, dead.start_line, dead.end_line),
                    address(&live.path, live.start_line, live.end_line),
                ));
            }
        }
    }
    pairs.into_iter().collect()
}

/// The `--ours`/`--theirs` counterpart to [`unverifiable_anchor_failures`]: on
/// those sides an unreadable source is the expected input rather than a
/// blocker, so the anchor is written — but the operator is told which anchors
/// were carried across on the side's recorded hash alone, with nothing in the
/// worktree to check them against.
fn unverified_anchor_warning(merged: &SpanFile, dead: &BTreeSet<String>) -> Option<String> {
    if dead.is_empty() {
        return None;
    }
    let listed: Vec<String> = merged
        .anchors
        .iter()
        .filter(|a| dead.contains(a.path.as_str()))
        .map(|a| address(&a.path, a.start_line, a.end_line))
        .collect();
    if listed.is_empty() {
        return None;
    }
    Some(format!(
        "unverified: {} anchor(s) were written from the chosen side's recorded hash with no \
         readable source to check them against ({}). That is what taking a side means when a \
         source is gone — `git span drift` will surface them, and `--rehash` refuses them.",
        listed.len(),
        listed.join(", ")
    ))
}

/// The anchor paths in `merged` with no readable worktree source. One set feeds
/// both the per-anchor label and the summary warning, so a report can never
/// call an anchor `unchanged` on the same run it names it unverified.
fn dead_source_paths(repo: &gix::Repository, merged: &SpanFile) -> BTreeSet<String> {
    merged
        .anchors
        .iter()
        .map(|a| a.path.clone())
        .collect::<BTreeSet<String>>()
        .into_iter()
        .filter(|path| crate::git::read_worktree_bytes(repo, path).is_err())
        .collect()
}

/// The report line naming index stages that exist but could not be read.
fn unreadable_stage_line(stages: &StageEvidence) -> String {
    format!(
        "index stages that could not be read: {}. A span file committed with conflict markers \
         still in it stages a blob no reader can parse. Nothing was inferred from them — the \
         readable stages and the worktree text decided this run.",
        stages.unreadable.join(", ")
    )
}

/// Step 6's sibling: a source that reads cleanly but no longer covers the
/// range an anchor declares. `cheap_fingerprint_with_extent` maps a past-EOF
/// range to `0` and silently clamps a partial overrun, and `drift` would then
/// confirm the result clean — so the anchor never reaches the kernel.
fn rehash_validity_failures(
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> Vec<String> {
    let ours_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        ours.anchors.iter().map(|a| (anchor_key(a), a)).collect();
    let theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        theirs.anchors.iter().map(|a| (anchor_key(a), a)).collect();

    let mut failures = Vec::new();
    let keys: BTreeSet<(&str, u32, u32)> = ours_map.keys().chain(theirs_map.keys()).copied().collect();
    for key in keys {
        let (path, start_line, end_line) = key;
        // Whole-file anchors declare no range to overrun.
        if start_line == 0 && end_line == 0 {
            continue;
        }
        // An anchor identical on both sides is cloned rather than re-hashed,
        // which used to exempt it from this check — but a cloned hash is
        // exactly the one `--rehash` has not verified, and an address whose
        // range no longer fits its file is the case where the clone is
        // provably stale. The exemption is gone.
        //
        // A hash that merely differs from the worktree within a range that
        // still fits is ordinary drift, not `resolve`'s business: silently
        // re-hashing it would paper over a coupling the operator needs to see,
        // and refusing it would make `resolve` unusable on any span with
        // unrelated drift. `git span drift` owns that case.
        //
        // An absent source is step 6's business, not this check's.
        let Some((_, bytes)) = source_files.iter().find(|(p, _)| p == path) else {
            continue;
        };
        let line_count = String::from_utf8_lossy(bytes).lines().count() as u32;
        if start_line == 0 || end_line > line_count {
            failures.push(format!(
                "{}: source has only {line_count} lines, cannot verify this anchor's range \
                 under --rehash",
                address(path, start_line, end_line)
            ));
        }
    }
    failures
}

/// Step 11's per-anchor lines.
///
/// `unverified` names the anchors written from a recorded hash with no readable
/// source — the expected input under `--ours`/`--theirs`, empty under
/// `--rehash` because there it is a refusal. Their labels must not claim
/// otherwise: `unchanged` asserts the two sides' hashes were compared *and*
/// that the hash still describes the source, and only the first of those
/// happened. The suffix is applied to every outcome rather than to one string,
/// because the property is about the anchor's source, not about which branch
/// produced its wording.
fn build_entries(
    side: Side,
    merged: &SpanFile,
    ours_map: &HashMap<(&str, u32, u32), &AnchorRecord>,
    theirs_map: &HashMap<(&str, u32, u32), &AnchorRecord>,
    unverified: &BTreeSet<String>,
) -> Vec<ReportEntry> {
    merged
        .anchors
        .iter()
        .map(|a| {
            let key = anchor_key(a);
            let settled = match (ours_map.get(&key), theirs_map.get(&key)) {
                (Some(o), Some(t)) => {
                    if o.algorithm == t.algorithm && o.content_hash == t.content_hash {
                        "unchanged".to_string()
                    } else {
                        match side {
                            Side::Rehash => {
                                if a.content_hash == o.content_hash {
                                    "re-hashed from the worktree (matches ours)".to_string()
                                } else if a.content_hash == t.content_hash {
                                    "re-hashed from the worktree (matches theirs)".to_string()
                                } else {
                                    "re-hashed from the worktree (differs from both sides)"
                                        .to_string()
                                }
                            }
                            _ => format!("kept {}", side.name()),
                        }
                    }
                }
                (Some(_), None) => "kept — only present in ours, not itself residue".to_string(),
                (None, Some(_)) => "kept — only present in theirs, not itself residue".to_string(),
                (None, None) => "resolved".to_string(),
            };
            let outcome = if unverified.contains(a.path.as_str()) {
                match settled.as_str() {
                    "unchanged" => "unverified — both sides carried the same hash, and there is \
                                    no readable source to check it against"
                        .to_string(),
                    other => format!("{other} (unverified — no readable source)"),
                }
            } else {
                settled
            };
            ReportEntry {
                address: address(&a.path, a.start_line, a.end_line),
                outcome,
            }
        })
        .collect()
}

/// The four-state `why` label: an explicit side choice that fired, a
/// three-way answer taken without operator input, a value the index-stage
/// supplement put back, or trivial agreement.
///
/// `recovered from index stages` replaces `unchanged` rather than ranking
/// above the other two, because it is exactly the claim of agreement that
/// cannot be made here: an empty text-sourced why on theirs is equally "the
/// residue writer left theirs' addition out" and "the operator deliberately
/// cleared a contested why", so the report says something restored it instead
/// of asserting both sides agreed. When a side choice or a three-way answer
/// did the arbitrating, that stays the headline and the recovery is appended.
fn field_label(
    side: Side,
    diverged: bool,
    ours: &str,
    theirs: &str,
    merged: &str,
    recovered: bool,
) -> String {
    let arbitrated = if diverged && side != Side::Rehash {
        format!("kept {}", side.name())
    } else if ours != theirs {
        let which = if merged == ours { "ours" } else { "theirs" };
        format!("resolved automatically (matches {which})")
    } else if recovered {
        return "recovered from index stages".to_string();
    } else if merged.trim().is_empty() {
        // Nothing was compared into agreement here — there is no why on either
        // side of the split to agree about. `unchanged` beside the why-recovery
        // ceiling line read as a summary contradicting it; this states the
        // outcome the ceiling line then qualifies.
        "written empty — no why text in this input".to_string()
    } else {
        "unchanged".to_string()
    };
    if recovered {
        format!("{arbitrated}, recovered from index stages")
    } else {
        arbitrated
    }
}

/// [`field_label`] for `[config]`, which compares by value rather than text —
/// and, unlike `why`, has no side of the conflict *text* to compare at all.
///
/// [`crate::cli::drift_fix::format_residue_markers`] never serializes
/// `[config]` into residue, so when no stage supplies one both split sides
/// parse as `SpanConfig::default()`. They are then equal because nothing was
/// read, not because the sides agreed, and the old `unchanged` printed that
/// non-comparison as a summary two lines above [`CONFIG_LOSS_LINE`] saying the
/// settings were gone. Every branch below therefore asks what *stated* each
/// side's value before it describes the outcome:
///
/// * a value from a parsed stage is stated by that side;
/// * a value the input text carried is stated only when it is non-default,
///   since the writer emits no `[config]` and a default is what parsing
///   nothing produces;
/// * a value filled in from base because the side's stage could not be read is
///   [`ConfigProvenance::Inferred`] and is stated by nobody.
///
/// Divergence keeps its `kept {side}` wording: two distinct values in play is
/// itself the evidence that both sides asserted one, and the side flag really
/// did select between them.
fn field_label_config(
    side: Side,
    diverged: bool,
    ours: &SpanFile,
    theirs: &SpanFile,
    merged: &SpanFile,
    provenance: (ConfigProvenance, ConfigProvenance),
) -> String {
    let stated = |prov: ConfigProvenance, config: &SpanConfig| match prov {
        ConfigProvenance::Stage => true,
        ConfigProvenance::Inferred => false,
        ConfigProvenance::Unread => *config != SpanConfig::default(),
    };
    let ours_stated = stated(provenance.0, &ours.config);
    let theirs_stated = stated(provenance.1, &theirs.config);

    if diverged && side != Side::Rehash {
        format!("kept {}", side.name())
    } else if ours.config != theirs.config {
        let (which, loser_stated) = if merged.config == ours.config {
            ("ours", theirs_stated)
        } else {
            ("theirs", ours_stated)
        };
        if loser_stated {
            format!("resolved automatically (matches {which})")
        } else {
            format!(
                "taken from {which} — the other side's `[config]` was never read, so nothing \
                 was arbitrated"
            )
        }
    } else {
        match (ours_stated, theirs_stated) {
            (true, true) => "unchanged".to_string(),
            (true, false) => "taken from ours — theirs' `[config]` was never read".to_string(),
            (false, true) => "taken from theirs — ours' `[config]` was never read".to_string(),
            (false, false) => {
                "written with default settings — no `[config]` in this input stated one"
                    .to_string()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Step 7's failure branch and step 11's report
// ---------------------------------------------------------------------------

/// The all-or-nothing failure: nothing was written, so retrying with another
/// side is always safe — and the remediation says which ones.
///
/// `alternatives` are the other sides the caller **evaluated against this same
/// file** and found would settle it. That evaluation is the whole point. The
/// previous text was a constant: it offered `--ours` and `--theirs`
/// unconditionally and added the reassurance that "both leave every other
/// anchor exactly as the merge produced it", a claim nothing in the run
/// checked. A refusal that has just protected a file must not be the thing
/// that routes the operator into a command that damages it, and a promise of
/// safety is exactly the sentence that makes the next command feel safe.
///
/// Narrowing this had to stop short of dropping the offer after a `--rehash`
/// failure: a divergent `--why` with no merge base is the card's headline
/// case, where `--rehash` correctly fails closed and the side flags *are* the
/// exit. So the offer stands whenever a side really does settle the file, and
/// vanishes only when none does — in which case the operator is told that, and
/// pointed at `--dry-run` and a hand edit instead of at a command that will
/// fail the same way.
fn failure_error(
    name: &str,
    side: Side,
    reasons: &[String],
    alternatives: &[Side],
    blocker: &[repair_domain::Repair],
) -> CliError {
    let listed = reasons
        .iter()
        .map(|r| format!("- {r}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut next_steps = if alternatives.is_empty() {
        vec![
            NextStep::Prose(
                "The other sides were evaluated against this same file and do not settle it \
                 either, so no side flag is an exit here. See each side's own reason with:"
                    .into(),
            ),
            NextStep::Bash(format!("git span resolve {name} --dry-run")),
            NextStep::Prose(
                "Then clear what the entries above name — restore a deleted source, finish an \
                 outer conflict — or resolve this span file by hand.".into(),
            ),
        ]
    } else {
        let flags: Vec<&str> = alternatives.iter().map(|s| s.flag()).collect();
        let listed_flags = flags.join(" and ");
        let verb = if flags.len() == 1 { "settles" } else { "settle" };
        vec![
            NextStep::Prose(format!(
                "Take a side explicitly. {listed_flags} {verb} every entry listed above — not as \
                 a general property of side flags, but as the result of evaluating them against \
                 this file just now:"
            )),
            NextStep::Bash(
                alternatives
                    .iter()
                    .map(|s| format!("git span resolve {name} {}", s.flag()))
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            NextStep::Prose(format!(
                "Or see what each side would write first with `git span resolve {name} --dry-run`."
            )),
        ]
    };
    // The blocker-derived half. `--rehash`'s unreadable-source refusal used to
    // name nothing at all, which is the same defect as naming the wrong thing:
    // on the input where an anchor's source cannot be read *and* a same-range
    // readable anchor sits at another path, rename reconciliation is squarely
    // inside `git span drift --fix`'s repair domain and it is the exit.
    //
    // The wording is fenced by two things it must not claim. It does not say
    // the file was renamed — only that the counterpart exists, which is all
    // the tool saw. And it does not present `resolve` as the rename command in
    // general: a `git mv` that neither side re-anchors after merges with no
    // conflict markers at all, so `resolve` says "nothing to resolve" and never
    // runs, and that stale anchor on a dead path is `drift`'s alone. This
    // refusal is the diverged case only — both sides re-anchored, which is why
    // there is a conflict here to refuse.
    for domain in repair_domain::commands_for(blocker) {
        next_steps.push(NextStep::Prose(format!(
            "The entries above pair an anchor whose source cannot be read with one over the \
             same line range at a different, readable path. That is what a rename looks like \
             from here — the tool has seen the pairing, not the rename itself. \
             `{}` reconciles renames, and its own report names what is left afterwards:",
            domain.command
        )));
        // This fence used to continue `git span resolve {name} --dry-run`,
        // under "run it, then re-run `resolve` on the residue it leaves". On
        // the input this refusal fires on there is no residue afterwards —
        // `drift --fix` settles the markers outright — so the operator's last
        // output was `no conflict markers; nothing to resolve`, which the
        // paragraph below teaches them to read as *the other case entirely*.
        // A sequence that ends in a command with nothing to do ends by
        // telling the operator they were never here. `drift --fix` already
        // routes them correctly from its own output, so the sequence stops
        // where the repair does.
        next_steps.push(NextStep::Ordered(vec![domain.command.to_string()]));
        next_steps.push(NextStep::Prose(
            "This applies to a rename the two sides disagreed about. A `git mv` that neither \
             side re-anchored after produces no conflict markers in the span file at all — \
             `resolve` reports `no conflict markers; nothing to resolve` and is not involved; \
             `git span drift` surfaces that stale anchor on its own."
                .into(),
        ));
    }
    CliError {
        subcommand: "resolve",
        summary: format!(
            "span `{name}` has residue `{}` cannot settle.",
            side.flag()
        ),
        what_happened: format!(
            "Nothing was written — the span file is byte-identical to what it was before this \
             run. These entries stopped it:\n\n{listed}"
        ),
        next_steps,
    }
}

/// The report body shared by the human write report and the dry-run fan-out.
fn settlement_lines(settlement: &Settlement) -> Vec<String> {
    let mut lines: Vec<String> = settlement
        .entries
        .iter()
        .map(|e| format!("{}: {}", e.address, e.outcome))
        .collect();
    if settlement.structural_only {
        lines.push(
            "resolved structurally — no residue required the requested side".to_string(),
        );
    }
    lines.push(format!("why: {}", settlement.why_label));
    lines.push(format!("config: {}", settlement.config_label));
    lines.extend(settlement.warnings.iter().cloned());
    lines
}

fn print_human(name: &str, side: Side, settlement: &Settlement, span_root: &str) {
    println!("resolved `{name}` with {}", side.flag());
    for line in settlement_lines(settlement) {
        println!("  {line}");
    }
    // "not staged" was already here and was already true; what it did not say
    // is that the merge is therefore unfinished, so an operator who stopped at
    // this line went straight back to `show`/`drift` and was told the span was
    // still conflicted. Name the exit. Naming it is all that happens — this
    // command does not stage, by contract.
    println!("  `{name}` was written to the worktree and not staged; review it with `git diff`.");
    println!(
        "  The index still holds the unmerged entry until you stage it: `{} {span_root}/{name}`.",
        repair_domain::GIT_ADD.command
    );
}

fn print_json(name: &str, side: Side, settlement: &Settlement) -> Result<()> {
    let doc = ResolveDocument {
        schema_version: RESOLVE_JSON_SCHEMA_VERSION,
        command: "resolve",
        span: name.to_string(),
        side: side.name(),
        dry_run: false,
        written: true,
        entries: settlement.entries.clone(),
        why: settlement.why_label.clone(),
        config: settlement.config_label.clone(),
        structural_only: settlement.structural_only,
        warnings: settlement.warnings.clone(),
    };
    println!("{}", serde_json::to_string_pretty(&doc)?);
    Ok(())
}

// ---------------------------------------------------------------------------
// Function-level settlement tests (CLI-unreachable shapes)
// ---------------------------------------------------------------------------

/// Settle two hand-built `SpanFile`s under one side, exposed for tests that
/// exercise shapes the CLI layer cannot construct — a `[config]` divergence
/// most of all, which the driver-shape refusal makes textually unreachable.
///
/// Returns `Ok((merged, why_label, config_label))` or `Err(failure reasons)`.
#[doc(hidden)]
pub fn settle_for_test(
    repo: &gix::Repository,
    side_name: &str,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> std::result::Result<(SpanFile, String, String), Vec<String>> {
    let side = match side_name {
        "ours" => Side::Ours,
        "theirs" => Side::Theirs,
        _ => Side::Rehash,
    };
    match evaluate_side(repo, side, ours, theirs, &StageEvidence::default()) {
        SideOutcome::Resolved(s) => Ok((s.merged.clone(), s.why_label.clone(), s.config_label.clone())),
        SideOutcome::Failed { reasons, .. } => Err(reasons),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git_span_core::ConflictKind;

    /// Every `git span …`/`git add` line the remediation fences, paired with
    /// the [`repair_domain`] entry it belongs to. Commands no domain claims —
    /// `git status`, which inspects rather than repairs — are not judged here.
    fn fenced_domains(steps: &[NextStep]) -> Vec<&'static str> {
        steps
            .iter()
            .flat_map(|s| match s {
                NextStep::Bash(block) => block.lines().map(str::to_string).collect::<Vec<_>>(),
                NextStep::Ordered(cmds) => cmds.clone(),
                NextStep::Prose(_) => Vec::new(),
            })
            .filter_map(|line| {
                repair_domain::ALL
                    .iter()
                    .find(|d| line.starts_with(d.command))
                    .map(|d| d.command)
            })
            .collect()
    }

    /// **The gate the hardcoded blocker made structurally impossible.**
    ///
    /// [`conflict_remediation`] did consult [`repair_domain::commands_for`] —
    /// with [`repair_domain::BLOCKER_UNSTAGED_RESOLUTION`] written in as the
    /// argument, so the table was asked a question whose answer the caller had
    /// already chosen. Every test in [`repair_domain`] passed, because they all
    /// query the table with constants and never with a blocker derived from a
    /// state. This one derives the blocker from the [`ConflictKind`] the
    /// remediation was built for, which is the only way the mismatch shows.
    #[test]
    fn conflict_remediation_fences_only_commands_the_state_admits() {
        for kind in [ConflictKind::UnmergedIndex, ConflictKind::MarkerText] {
            let allowed: Vec<&str> =
                repair_domain::commands_for(repair_domain::conflict_blocker(kind))
                    .iter()
                    .map(|d| d.command)
                    .collect();
            for command in fenced_domains(&conflict_remediation(&["m"], ".span", kind)) {
                assert!(
                    allowed.contains(&command),
                    "{kind:?}: `{command}` is fenced but its repair domain does not intersect \
                     the blocker this state actually has ({allowed:?})"
                );
            }
        }
    }

    /// The occurrence, stated as the operator meets it: `git add` fenced four
    /// lines under a diagnosis that just said there is no unmerged stage.
    #[test]
    fn marker_text_neither_fences_nor_claims_a_staging_step() {
        let steps = conflict_remediation(&["m"], ".span", ConflictKind::MarkerText);
        assert!(
            !fenced_domains(&steps).contains(&repair_domain::GIT_ADD.command),
            "the index holds a single merged entry here; there is nothing to stage"
        );
        let prose: String = steps
            .iter()
            .filter_map(|s| match s {
                NextStep::Prose(p) => Some(p.as_str()),
                NextStep::Bash(_) | NextStep::Ordered(_) => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            !prose.contains("the index still holds the unmerged entry"),
            "and the text must not assert one, one paragraph under a diagnosis denying it: \
             {prose}"
        );
        assert!(
            prose.contains("there is no stage waiting on a `git add`"),
            "saying so is what keeps the two paragraphs from contradicting: {prose}"
        );
    }

    /// **The ordered-fence gate.** Round 2's mechanical gate re-seeds the
    /// fixture before each command and filters `--dry-run` out, so it judges a
    /// fence as an unordered set of repairs. Both choices are right for
    /// alternatives and both are blind to a *sequence*, which is where the
    /// rename refusal's defect lived: its last command was a report that, on
    /// this input, had nothing to report.
    ///
    /// So the type carries the claim and this holds it: a
    /// [`NextStep::Ordered`] block is a prescription to run its lines in order,
    /// therefore every line — the last one most of all — must be a command
    /// whose repair domain intersects the blocker, and none of them may be a
    /// report. A dry-run is welcome in a [`NextStep::Bash`] block, where it is
    /// one of several things the operator might pick.
    #[test]
    fn ordered_fences_end_in_a_repair_not_a_report() {
        for blocker in [
            repair_domain::BLOCKER_RENAMED_ANCHOR_PATH,
            repair_domain::BLOCKER_SEPARATOR_PLACEMENT,
        ] {
            let allowed: Vec<&str> = repair_domain::commands_for(blocker)
                .iter()
                .map(|d| d.command)
                .collect();
            for alternatives in [&[][..], &[Side::Ours][..]] {
                let err = failure_error("m", Side::Rehash, &["reason".into()], alternatives, blocker);
                for step in &err.next_steps {
                    let NextStep::Ordered(cmds) = step else {
                        continue;
                    };
                    assert!(!cmds.is_empty(), "an empty sequence prescribes nothing");
                    for cmd in cmds {
                        assert!(
                            !cmd.contains("--dry-run"),
                            "`{cmd}` reports; a step in a prescribed sequence must repair. The                              rename refusal ended on one and handed the operator `nothing to                              resolve` as their final output"
                        );
                        assert!(
                            allowed.iter().any(|c| cmd.starts_with(c)),
                            "`{cmd}` is prescribed but its repair domain does not intersect this                              blocker ({allowed:?})"
                        );
                    }
                }
            }
        }
    }

    /// The latent case, exercised before it exists in production: a blocker
    /// spanning two domains. Every declared blocker holds one repair today, so
    /// [`repair_domain::remediation_fence`] emits one line and the ordering is
    /// invisible — but [`repair_domain::ALL`] declares an order, `resolve.rs`
    /// already builds blockers in a `Vec` at runtime, and the first
    /// multi-domain blocker produces `drift --fix` then `resolve` from that
    /// declaration alone, with no author involved. Typed as
    /// [`NextStep::Ordered`], that fence arrives already under the sequence
    /// rules rather than silently claiming order-independence.
    #[test]
    fn a_multi_domain_blocker_emits_an_ordered_fence_in_the_declared_order() {
        let blocker = &[
            repair_domain::Repair::ResidueSettlement,
            repair_domain::Repair::ResidueShape,
        ];
        let NextStep::Ordered(cmds) = repair_domain::remediation_fence(blocker) else {
            panic!("a fence built from the table must state that its order is meant");
        };
        assert_eq!(
            cmds,
            vec![
                "git span drift --fix".to_string(),
                "git span resolve".to_string(),
            ],
            "re-derive the residue, then settle it — the order `ALL` declares, regardless of \
             the order the blocker's repairs were accumulated in"
        );
        for cmd in &cmds {
            assert!(!cmd.contains("--dry-run"), "`{cmd}` reports rather than repairs");
        }
    }

    /// The other arm keeps the exit — `resolve` writes the worktree and never
    /// stages, so `git add` is the only way out of an unmerged index — but must
    /// not open on a command that exits 0 having done nothing. The post-
    /// `resolve` state reaches this text with the text half already settled,
    /// where `resolve --dry-run` reports `nothing to resolve`.
    #[test]
    fn unmerged_index_keeps_the_exit_and_does_not_open_on_a_no_op() {
        let steps = conflict_remediation(&["m"], ".span", ConflictKind::UnmergedIndex);
        assert!(fenced_domains(&steps).contains(&repair_domain::GIT_ADD.command));
        let NextStep::Prose(first) = &steps[0] else {
            panic!("the first step must be prose, not a command: {steps:?}");
        };
        assert!(
            first.contains("nothing to resolve") && first.contains("skip to the staging step"),
            "an operator whose text is already settled must be told before the fence, not by \
             a command that exits 0: {first}"
        );
    }
}
