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
    /// header stranded inside a block being the case that occurs.
    ///
    /// **No command repairs this.** Re-deriving residue means merging the two
    /// sides, and a side that will not parse cannot be merged: `drift --fix`
    /// bails with `malformed anchor line: no space found in `[config]`` and
    /// leaves the file byte-identical. This variant exists because the
    /// mechanical gate caught it — the refusal named `drift --fix` for both
    /// shape defects, and only one of them was really in its domain.
    UnparseableResidueSide,
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
/// Its domain is exactly what its implementation does: re-anchor and re-hash
/// drifted anchors, canonicalize marker labels, and re-derive residue by
/// splitting a conflicted span file and merging the two sides structurally.
/// It does **not** appear here with [`Repair::SeparatorPlacement`], and that
/// omission is the finding: its split reads the separator from the text
/// exactly as `resolve`'s does, so a line on the wrong side of it stays there.
pub(crate) const DRIFT_FIX: RepairDomain = RepairDomain {
    command: "git span drift --fix",
    repairs: &[
        Repair::AnchorAddress,
        Repair::MarkerLabel,
        Repair::ResidueShape,
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

/// Every command this module knows about, in the order a remediation would
/// naturally present them.
const ALL: &[&RepairDomain] = &[&DRIFT_FIX, &RESOLVE, &GIT_ADD];

/// Why nothing can be named, for the blockers no command repairs.
///
/// A refusal that simply falls silent about the command it used to offer reads
/// like an omission. Saying *which* command the operator would reach for and
/// why it will not help is what stops them reaching for it anyway.
pub(crate) fn no_command_reason(blocker: &[Repair]) -> &'static str {
    if blocker.contains(&Repair::SeparatorPlacement) {
        "`git span drift --fix` in particular does not: it re-anchors drifted anchors and \
         rewrites conflict-marker labels, and it reads the anchor/why separator out of the file \
         exactly as `resolve` does rather than deciding which side of it a line belongs on. \
         Running it here changes the file — the labels — and leaves this refusal saying the \
         same thing on the next run."
    } else {
        "`git span drift --fix` in particular does not: re-deriving residue means merging the \
         two sides, and a side that will not parse cannot be merged. It bails on this file and \
         leaves it byte-identical."
    }
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
/// `[config]` header inside a block.
pub(crate) const BLOCKER_UNPARSEABLE_RESIDUE: &[Repair] = &[Repair::UnparseableResidueSide];

/// The blocker `resolve --rehash` reports when an anchor's source cannot be
/// read, *and* the other side carries a readable anchor over the same line
/// range at a different path — the shape a rename leaves behind.
pub(crate) const BLOCKER_RENAMED_ANCHOR_PATH: &[Repair] = &[Repair::AnchorAddress];

/// The blocker every "the span file is conflicted" refusal leaves behind once
/// `resolve` has settled the text: the index is still unmerged and `resolve`
/// does not stage.
pub(crate) const BLOCKER_UNSTAGED_RESOLUTION: &[Repair] = &[Repair::IndexStaging];

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

    /// The gate's own catch: a side that will not parse is not re-derivable,
    /// so the shape refusal had to stop naming `drift --fix` for that half.
    #[test]
    fn unparseable_residue_side_admits_no_command() {
        assert!(commands_for(BLOCKER_UNPARSEABLE_RESIDUE).is_empty());
        assert!(!DRIFT_FIX.intersects(BLOCKER_UNPARSEABLE_RESIDUE));
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
