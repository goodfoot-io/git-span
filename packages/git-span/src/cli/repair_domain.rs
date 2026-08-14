//! **What a command repairs**, and therefore which command a refusal is
//! allowed to name.
//!
//! Every refusal in this CLI ends in a "What to do next" section, and until
//! this module existed nothing in the code represented the one fact those
//! sections turn on: the set of defects each command can actually clear. The
//! command names were picked by whoever wrote the text, from memory, and they
//! were wrong in both directions at once —
//!
//! * `resolve`'s anchor/why *boundary* refusal named `git span drift --fix`,
//!   which does not move content across the separator. Running it rewrites the
//!   marker labels (`HEAD`/`bA` → `ours`/`theirs`), so the file changes, the
//!   operator sees action, re-runs `resolve`, and gets the identical refusal.
//!   A loop with no exit, built out of two commands that each behave correctly.
//! * `resolve --rehash`'s unreadable-source refusal named no command at all,
//!   even on the input where a rename *is* what happened and `drift --fix`
//!   reconciles renames — the same mistake with the sign flipped.
//!
//! **The rule this module encodes:** *a refusal may name a command only if that
//! command's repair domain intersects the blocker.* The weaker rule that first
//! suggested itself — "the named command must change the file" — passes the
//! loop above, because the label rewrite changes the file without advancing the
//! blocker by a single line. Intersection of domains is the property that
//! actually distinguishes an exit from a detour.
//!
//! Refusal builders therefore state their **blocker** as a set of [`Repair`]s
//! and let [`commands_for`] decide which commands may appear. The decision is
//! then a property of the data, testable on its own, rather than of prose
//! written once and copied thereafter.
//!
//! **The failure this module keeps meeting, stated once.** Every defect found
//! in these remediations has been a guard that works for a reason one frame
//! away from the property it is supposed to hold: a gate filtering `--dry-run`
//! because it is a report, on a fence where it was the tail of a sequence; this
//! table consulted with a literal blocker instead of the state's own; a fixture
//! asserting a substring that every branch prints; a lifetime bound sitting on
//! a caller rather than on the function it protects. Each still passes, still
//! reads as protection, and stops holding the moment the frame moves. When
//! adding a check here, the question is not whether it passes but whether what
//! it consumes was *derived* from the thing it claims to verify.
//!
//! The same holds for the sentence a refusal prints when *no* command
//! qualifies. It was first written per **blocker** — one branch for separator
//! placement and one claim about `drift --fix` for everything else — and that
//! second claim was true of a `[config]` header before the separator and false
//! of one after it, where `drift --fix` rewrites the file and drops the span's
//! settings. So the reason hangs off the [`Repair`] variant as well, via
//! [`Repair::no_command_reason`]: a claim about a command's behaviour can then
//! only reach the case it was written about.

use crate::cli::error::NextStep;

/// A class of defect a command can repair.
///
/// Deliberately coarse: the point is not to model every failure but to make
/// "can command X advance blocker Y" a lookup instead of a recollection.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Repair {
    /// An anchor's recorded address or content hash no longer matches the
    /// source — a stale hash, a moved line range, or a path that a rename
    /// left pointing at nothing. This is `drift --fix`'s whole subject.
    AnchorAddress,
    /// Conflict-marker *labels*: the `HEAD` / `bA` / branch-name decorations
    /// Git writes, rewritten to the `ours` / `theirs` form the span writers
    /// emit. Cosmetic by construction — it never moves a line.
    MarkerLabel,
    /// The *shape* of conflict residue: how many blocks there are, and whether
    /// the text is Git's default line-merge rather than the span writers'
    /// output. Repaired by re-deriving residue from a structural merge of the
    /// two sides, which collapses the extra blocks and re-hashes.
    ResidueShape,
    /// A conflict side that does not parse as a span file at all — a `[config]`
    /// header stranded inside a block — where that block sits in the **anchor
    /// region**, before the blank-line separator.
    ///
    /// **No command repairs this, and none touches the file either.**
    /// Re-deriving residue means merging the two sides, and a side that will
    /// not parse cannot be merged: `drift --fix` bails with `malformed anchor
    /// line: no space found in `[config]`` and leaves the file byte-identical.
    /// This variant exists because the mechanical gate caught it — the refusal
    /// named `drift --fix` for both shape defects, and only one of them was
    /// really in its domain.
    UnparseableAnchorResidue,
    /// The same stranded `[config]` header, in a block that sits in the **why
    /// region**, after the separator. `[config]` is the span file's trailing
    /// block, so this is the shape a default text merge can produce when prose
    /// and settings both diverge. The structural drift fixer can re-derive it
    /// without dropping either region, then `resolve` can settle the canonical
    /// residue.
    UnparseableWhyResidue,
    /// Choosing between two divergent values inside well-formed residue — the
    /// question `resolve`'s side flags answer.
    ResidueSettlement,
    /// *Which side of the anchor/why separator a line sits on.*
    ///
    /// **No command in this CLI repairs this**, and that absence is the reason
    /// the loop existed. Every writer here reads the separator's position out
    /// of the text it was handed; none of them decides that a line belongs on
    /// the other side of it, because deciding wrongly either deletes a tracked
    /// anchor or fabricates one from prose. `resolve` refuses instead, and a
    /// hand edit is the honest exit.
    SeparatorPlacement,
    /// Moving a settled worktree file into the index. `git span resolve`
    /// deliberately never does this — it writes the worktree and stops — so
    /// the operator must, and the refusals that route them to `resolve` have to
    /// say so or the merge never finishes.
    IndexStaging,
}

/// A command, and the repairs it performs.
pub(crate) struct RepairDomain {
    /// The command as it is written into a `NextStep::Bash` block.
    pub(crate) command: &'static str,
    repairs: &'static [Repair],
}

impl RepairDomain {
    /// True when this command can advance at least one of `blocker`'s repairs.
    pub(crate) fn intersects(&self, blocker: &[Repair]) -> bool {
        blocker.iter().any(|needed| self.repairs.contains(needed))
    }
}

/// `git span drift --fix`.
///
/// Its domain is what it *repairs*, not what it calls: re-anchor and re-hash
/// drifted anchors, canonicalize marker labels, and re-derive residue by
/// splitting a conflicted span file and merging the two sides structurally.
/// The distinction is load-bearing rather than pedantic — `drift --fix` does
/// call `git add` (see `drift_fix.rs`'s re-stage step), and reading that as
/// domain membership would put [`Repair::IndexStaging`] here and rebuild the
/// loop: on the settled-text-unmerged-index state, running it leaves both
/// unmerged stages exactly where they were. The apparent gap in this table is
/// the table being right.
/// It does **not** appear here with [`Repair::SeparatorPlacement`], and that
/// omission is the finding: its split reads the separator from the text
/// exactly as `resolve`'s does, so a line on the wrong side of it stays there.
pub(crate) const DRIFT_FIX: RepairDomain = RepairDomain {
    command: "git span drift --fix",
    repairs: &[
        Repair::AnchorAddress,
        Repair::MarkerLabel,
        Repair::ResidueShape,
        Repair::UnparseableWhyResidue,
    ],
};

/// `git add` — named, never run. `resolve` writing the worktree without
/// staging is a contract of this card, which makes `git add` the only exit
/// from a settled-but-unmerged span file.
pub(crate) const GIT_ADD: RepairDomain = RepairDomain {
    command: "git add",
    repairs: &[Repair::IndexStaging],
};

/// `git span resolve` — settles residue under one chosen side.
pub(crate) const RESOLVE: RepairDomain = RepairDomain {
    command: "git span resolve",
    repairs: &[Repair::ResidueSettlement],
};

/// Every command this module knows about, in the order a remediation must
/// present them: re-derive the residue, then settle it, then stage the result.
///
/// That order used to be described here as the one a remediation "would
/// naturally present" — a claim about intent that nothing enforced, on a list
/// whose consumers joined it into a single fence. Every declared blocker holds
/// one [`Repair`] and the domains are disjoint, so every such fence is one line
/// today and the order never shows. A blocker spanning two domains —
/// `&[ResidueShape, ResidueSettlement]` is an entirely natural one to want —
/// emits `drift --fix` followed by `resolve` from this declaration alone,
/// which is an ordered sequence nobody authored. [`remediation_fence`] emits it
/// as [`NextStep::Ordered`], so the order this list declares is the order the
/// type claims and the one a gate can check.
pub(crate) const ALL: &[&RepairDomain] = &[&DRIFT_FIX, &RESOLVE, &GIT_ADD];

/// The commands for `blocker` as a fence, **with the variant declared** rather
/// than defaulted.
///
/// Consumers used to `join("\n")` [`commands_for`]'s output into a
/// [`NextStep::Bash`], which says the lines are order-independent — a claim
/// nobody made and, for a multi-domain blocker, a false one. Emitting
/// [`NextStep::Ordered`] states what [`ALL`] means: run them in this order,
/// each against what the previous one left. A one-command fence satisfies both
/// readings, so nothing changes today; the point is that the first fence that
/// does not is typed correctly on the day it appears.
pub(crate) fn remediation_fence(blocker: &[Repair]) -> NextStep {
    NextStep::Ordered(
        commands_for(blocker)
            .iter()
            .map(|d| d.command.to_string())
            .collect(),
    )
}

impl Repair {
    /// Why nothing can be named for *this* repair, and what the command the
    /// operator would reach for does to the file anyway.
    ///
    /// `None` means some command's domain covers the repair, so the question
    /// never arises; [`unrepairable_repairs_state_why`] holds the two halves in
    /// step.
    ///
    /// **The reason belongs here, on the variant, and not on the blocker** —
    /// the same move [`commands_for`] already makes for command names. A
    /// trailing config block is now within the structural fixer's domain, so
    /// only the genuinely inert anchor-region variant needs this explanation.
    fn no_command_reason(self) -> Option<&'static str> {
        match self {
            Repair::AnchorAddress
            | Repair::MarkerLabel
            | Repair::ResidueShape
            | Repair::ResidueSettlement
            | Repair::IndexStaging => None,
            Repair::SeparatorPlacement => Some(
                "`git span drift --fix` in particular does not: it re-anchors drifted anchors \
                 and rewrites conflict-marker labels, and it reads the anchor/why separator out \
                 of the file exactly as `resolve` does rather than deciding which side of it a \
                 line belongs on. Running it here changes the file — the labels — and leaves \
                 this refusal saying the same thing on the next run.",
            ),
            Repair::UnparseableAnchorResidue => Some(
                "`git span drift --fix` in particular does not: re-deriving residue means \
                 merging the two sides, and a side that will not parse cannot be merged. With \
                 the unparseable block before the separator it bails on this file and leaves it \
                 byte-identical.",
            ),
            Repair::UnparseableWhyResidue => None,
        }
    }
}

/// Why nothing can be named, for the blockers no command repairs.
///
/// A refusal that simply falls silent about the command it used to offer reads
/// like an omission. Saying *which* command the operator would reach for and
/// why it will not help is what stops them reaching for it anyway.
pub(crate) fn no_command_reason(blocker: &[Repair]) -> String {
    blocker
        .iter()
        .filter_map(|r| r.no_command_reason())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The commands a refusal blocked on `blocker` may name.
///
/// An empty result is a real answer, not a gap: it means nothing this CLI
/// offers advances the blocker, and the refusal must say so and point at a
/// hand edit rather than reach for the nearest plausible command.
pub(crate) fn commands_for(blocker: &[Repair]) -> Vec<&'static RepairDomain> {
    ALL.iter()
        .copied()
        .filter(|d| d.intersects(blocker))
        .collect()
}

/// The blocker `resolve` reports when a line inside a conflict block sits on
/// the wrong side of the anchor/why separator.
pub(crate) const BLOCKER_SEPARATOR_PLACEMENT: &[Repair] = &[Repair::SeparatorPlacement];

/// The blocker `resolve` reports when a region holds more conflict blocks than
/// any writer here emits — Git's default text merge, which a structural
/// re-derivation collapses.
pub(crate) const BLOCKER_RESIDUE_SHAPE: &[Repair] = &[Repair::ResidueShape];

/// The blocker `resolve` reports when a conflict side will not parse — a
/// `[config]` header inside a block — in the anchor region.
pub(crate) const BLOCKER_UNPARSEABLE_ANCHOR_RESIDUE: &[Repair] =
    &[Repair::UnparseableAnchorResidue];

/// The same defect after the separator, where the structural drift fixer can
/// preserve and canonicalize both the prose and config regions.
pub(crate) const BLOCKER_UNPARSEABLE_WHY_RESIDUE: &[Repair] = &[Repair::UnparseableWhyResidue];

/// The blocker `resolve --rehash` reports when an anchor's source cannot be
/// read, *and* the other side carries a readable anchor over the same line
/// range at a different path — the shape a rename leaves behind.
pub(crate) const BLOCKER_RENAMED_ANCHOR_PATH: &[Repair] = &[Repair::AnchorAddress];

/// The blocker every "the span file is conflicted" refusal leaves behind once
/// `resolve` has settled the text: the index is still unmerged and `resolve`
/// does not stage.
pub(crate) const BLOCKER_UNSTAGED_RESOLUTION: &[Repair] = &[Repair::IndexStaging];

/// What is actually outstanding in a `SpanConflict` state, **derived from the
/// state** rather than assumed by the caller.
///
/// This exists because the shared conflict remediation queried [`commands_for`]
/// with [`BLOCKER_UNSTAGED_RESOLUTION`] hardcoded — the table consulted with the
/// answer already supplied. `commands_for` cannot decline a command when the
/// caller hands it the blocker that justifies one, so `git add` was named on
/// [`git_span_core::ConflictKind::MarkerText`], where the index holds a single
/// merged entry and there is nothing to stage, four lines under a diagnosis
/// that said so. Every domain test still passed, because they all asked the
/// table about constants and never about a real state.
///
/// * [`MarkerText`](git_span_core::ConflictKind::MarkerText): markers in the
///   text, index merged. Settling the text is the whole fix — settlement only.
/// * [`UnmergedIndex`](git_span_core::ConflictKind::UnmergedIndex): Git
///   recorded the conflict and nothing has settled it. The text may or may not
///   still carry markers, but the stage entry outlives the text either way, so
///   both repairs are live.
pub(crate) fn conflict_blocker(kind: git_span_core::ConflictKind) -> &'static [Repair] {
    match kind {
        git_span_core::ConflictKind::MarkerText => &[Repair::ResidueSettlement],
        git_span_core::ConflictKind::UnmergedIndex => {
            &[Repair::ResidueSettlement, Repair::IndexStaging]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The loop, stated as data. `drift --fix` rewrites marker labels — so it
    /// *will* change a file whose separator placement is wrong — but the
    /// blocker is untouched, so it must not be named.
    #[test]
    fn separator_placement_admits_no_command() {
        assert!(
            commands_for(BLOCKER_SEPARATOR_PLACEMENT).is_empty(),
            "no command repairs separator placement; naming one builds the loop"
        );
        assert!(!DRIFT_FIX.intersects(BLOCKER_SEPARATOR_PLACEMENT));
    }

    /// The same rule with the sign flipped: rename repair is inside
    /// `drift --fix`'s domain, so the refusal that meets one must name it.
    #[test]
    fn renamed_anchor_path_admits_drift_fix() {
        let named: Vec<&str> = commands_for(BLOCKER_RENAMED_ANCHOR_PATH)
            .iter()
            .map(|d| d.command)
            .collect();
        assert_eq!(named, vec!["git span drift --fix"]);
    }

    /// A pre-separator config header is not re-derivable, while the trailing
    /// structural shape is within `drift --fix`'s domain.
    #[test]
    fn unparseable_residue_routes_by_region() {
        assert!(commands_for(BLOCKER_UNPARSEABLE_ANCHOR_RESIDUE).is_empty());
        assert!(!DRIFT_FIX.intersects(BLOCKER_UNPARSEABLE_ANCHOR_RESIDUE));
        assert_eq!(
            commands_for(BLOCKER_UNPARSEABLE_WHY_RESIDUE)
                .iter()
                .map(|domain| domain.command)
                .collect::<Vec<_>>(),
            vec!["git span drift --fix"]
        );
    }

    /// Only the unrecoverable anchor-region shape carries a no-command reason.
    #[test]
    fn only_anchor_region_has_a_no_command_reason() {
        let anchor = no_command_reason(BLOCKER_UNPARSEABLE_ANCHOR_RESIDUE);
        let why = no_command_reason(BLOCKER_UNPARSEABLE_WHY_RESIDUE);
        assert!(anchor.contains("leaves it byte-identical"));
        assert!(why.is_empty());
    }

    /// **The pairing gate.** Every repair no command's domain covers must carry
    /// a reason, and every repair some command covers must not — otherwise a
    /// refusal that names nothing either says nothing about why, or repeats a
    /// reason belonging to a different case. Adding a `Repair` fails here until
    /// its side of the pairing is decided.
    #[test]
    fn unrepairable_repairs_state_why() {
        for repair in [
            Repair::AnchorAddress,
            Repair::MarkerLabel,
            Repair::ResidueShape,
            Repair::UnparseableAnchorResidue,
            Repair::UnparseableWhyResidue,
            Repair::ResidueSettlement,
            Repair::SeparatorPlacement,
            Repair::IndexStaging,
        ] {
            let repairable = !commands_for(&[repair]).is_empty();
            assert_eq!(
                repairable,
                repair.no_command_reason().is_none(),
                "{repair:?}: a repair with no command must explain the absence, and a repair \
                 with one must not carry an explanation of why there is none"
            );
        }
    }

    #[test]
    fn residue_shape_admits_drift_fix_only() {
        let named: Vec<&str> = commands_for(BLOCKER_RESIDUE_SHAPE)
            .iter()
            .map(|d| d.command)
            .collect();
        assert_eq!(named, vec!["git span drift --fix"]);
    }

    #[test]
    fn unstaged_resolution_admits_git_add_only() {
        let named: Vec<&str> = commands_for(BLOCKER_UNSTAGED_RESOLUTION)
            .iter()
            .map(|d| d.command)
            .collect();
        assert_eq!(named, vec!["git add"]);
        assert!(
            !RESOLVE.intersects(BLOCKER_UNSTAGED_RESOLUTION),
            "`resolve` never stages, so it can never be the exit from an unstaged resolution"
        );
    }
}
