//! Round-2 evaluation: **what a command repairs**, and the steering that
//! follows from it.
//!
//! Two evaluators filed five findings here and then re-diagnosed them as one
//! missing model: nothing in the code represented each command's repair
//! domain, so refusals named commands from memory and named them wrongly in
//! both directions. `git span drift --fix` repairs anchor hashes and paths and
//! rewrites conflict-marker labels; it never moves content across the
//! anchor/why separator. From that single fact both errors fall out —
//! `resolve`'s boundary refusal named it and must not, and `--rehash`'s
//! unreadable-source refusal did not name it and must.
//!
//! Two assertion forms live here and both earn their place:
//!
//! * **The design rule.** *A refusal may name a command only if that command's
//!   repair domain intersects the blocker.* Checked directly by
//!   [`boundary_refusal_names_no_command`] and
//!   [`rename_signal_refusal_names_drift_fix`].
//! * **The mechanical gate.** For each refusal that names a command, run that
//!   command and assert the file changed. Incomplete as a rule — the loop this
//!   card found *passes* it, because rewriting the marker labels changes the
//!   file without advancing the blocker — but automatable, and it is what
//!   would have caught the loop on the day it was written.
//!   [`assert_named_commands_change_the_file`] is that gate.
//!
//! All three steering findings had zero test coverage before this file.

use crate::support;

use anyhow::Result;
use git_span_core::{cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// `file1.txt` as `TestRepo::seeded` writes it (10 lines).
pub const ORIGINAL: &str = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";

/// Well-formed rk64 tokens matching no real content.
pub const OTHER_HASH: &str = "0123456789abcdef";
const THIRD_HASH: &str = "fedcba9876543210";

pub fn span_path(repo: &TestRepo, name: &str) -> std::path::PathBuf {
    repo.path().join(".span").join(name)
}

pub fn read_span_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(span_path(repo, name))?)
}

pub fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_span_core::AnchorExtent::WholeFile,
    ))
}

/// Residue produced by running the **real merge driver**, so a fixture that
/// claims to be driver output is one. Hand-written residue has concealed
/// defects three times on this card.
fn driver_residue(repo: &TestRepo, base: &str, ours: &str, theirs: &str) -> Result<String> {
    repo.write_file(".merge-base", base)?;
    repo.write_file(".merge-ours", ours)?;
    repo.write_file(".merge-theirs", theirs)?;
    let out = repo.run_span([
        "merge-driver",
        ".merge-base",
        ".merge-ours",
        ".merge-theirs",
        "7",
    ])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "driver must take its partial-resolution branch to produce residue; stderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(std::fs::read_to_string(repo.path().join(".merge-ours"))?)
}

/// Every command inside a ```bash fence in a rendered `CliError`.
///
/// This is what "the refusal names a command" means operationally: the fenced
/// block is the thing an operator copies.
pub fn fenced_commands(stderr: &str) -> Vec<String> {
    let mut cmds = Vec::new();
    let mut inside = false;
    for line in stderr.lines() {
        if line.trim_start().starts_with("```") {
            inside = line.trim_start().starts_with("```bash");
            continue;
        }
        if inside && !line.trim().is_empty() {
            cmds.push(line.trim().to_string());
        }
    }
    cmds
}

/// Whitespace-normalized stderr — the refusals are single long sentences that
/// the terminal wraps, so assertions are about the words, not the line breaks.
pub fn flat(stderr: &str) -> String {
    stderr.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// **The mechanical gate.** Every `git span …` command a refusal put in a
/// fenced block must, when run against this same repository, change the span
/// file.
///
/// `--dry-run` is excluded by construction, not by oversight: it is documented
/// to write nothing, and a refusal offering it is offering a *report*, not a
/// repair. Everything else in a fence is being offered as the exit, and an
/// exit that leaves the file byte-identical is a loop.
fn assert_named_commands_change_the_file(
    repo: &TestRepo,
    name: &str,
    fixture: &str,
    stderr: &str,
) -> Result<()> {
    let commands: Vec<String> = fenced_commands(stderr)
        .into_iter()
        .filter(|c| c.starts_with("git span") && !c.contains("--dry-run"))
        .collect();
    assert!(
        !commands.is_empty(),
        "this refusal is supposed to name a repair command; stderr=\n{stderr}"
    );
    for cmd in commands {
        // Each command is judged against the state the operator is actually
        // in — the refused file — not against whatever an earlier command in
        // the same list left behind. Running them in sequence made the second
        // one a no-op for the trivial reason that the first had already
        // settled the file, which is a fact about the harness, not the advice.
        repo.write_file(&format!(".span/{name}"), fixture)?;
        let before = read_span_bytes(repo, name)?;
        let args: Vec<&str> = cmd.split_whitespace().skip(2).collect();
        repo.run_span(args)?;
        assert_ne!(
            before,
            read_span_bytes(repo, name)?,
            "the refusal named `{cmd}`, so running it must change `{name}`; a named command \
             that leaves the file byte-identical sends the operator straight back to the same \
             refusal"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Finding 2: the looping remediation
// ---------------------------------------------------------------------------

/// Residue in the shape the pre-`42d28964` writer emitted: the blank separator
/// first, and only then a conflict block carrying anchor residue — so every
/// anchor it wrote sits *after* the separator, where settling it would delete
/// it outright. `resolve` refuses this, and the refusal used to name
/// `git span drift --fix`.
fn post_separator_anchor_residue() -> String {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    format!(
        "\
file1.txt#L1-L5 rk64:{h1}

<<<<<<< HEAD
some rationale
=======
file2.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> side
"
    )
}

/// The design rule, at the blocker no command repairs. Separator placement is
/// decided by no writer in this CLI — each reads it out of the text it was
/// handed — so the refusal must name nothing and say so.
#[test]
fn boundary_refusal_names_no_command() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &post_separator_anchor_residue())?;

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");

    assert!(
        fenced_commands(&stderr).is_empty(),
        "no command repairs separator placement, so the refusal must fence none; \
         stderr=\n{stderr}"
    );
    let flattened = flat(&stderr);
    assert!(
        flattened.contains("No git-span command repairs this"),
        "the refusal must say the absence out loud rather than leave a silent gap; \
         stderr=\n{stderr}"
    );
    assert!(
        flattened.contains("Edit the span file by hand"),
        "hand-editing is the honest exit here and the refusal must leave the operator with \
         it; stderr=\n{stderr}"
    );
    Ok(())
}

/// **Why the weaker rule is not enough**, demonstrated rather than asserted in
/// prose: `git span drift --fix` *does* change this file — it rewrites the
/// marker labels — and `resolve` refuses it identically afterwards. A gate
/// that only asked "did the named command change the file" would have passed
/// the loop. Naming it was the defect; the domain rule is what catches it.
#[test]
fn drift_fix_changes_the_file_without_advancing_the_boundary_blocker() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", &post_separator_anchor_residue())?;

    let first = repo.run_span(["resolve", "m"])?;
    let first_err = String::from_utf8_lossy(&first.stderr).to_string();
    assert_ne!(first.status.code(), Some(0));

    let before = read_span_bytes(&repo, "m")?;
    repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let after = read_span_bytes(&repo, "m")?;

    let second = repo.run_span(["resolve", "m"])?;
    let second_err = String::from_utf8_lossy(&second.stderr).to_string();
    assert_ne!(
        second.status.code(),
        Some(0),
        "the blocker must survive `drift --fix`; stderr=\n{second_err}"
    );
    assert!(
        flat(&second_err).contains("sits *after* the blank-line separator"),
        "and it must be the *same* blocker, not a different one; stderr=\n{second_err}"
    );
    // The loop, in one assertion: the file moved, the refusal did not.
    assert_ne!(
        before, after,
        "fixture assumption: `drift --fix` rewrites the marker labels, which is what made \
         this look like progress"
    );
    assert_eq!(
        flat(&first_err),
        flat(&second_err),
        "identical refusal before and after — this is the loop that had no exit"
    );
    Ok(())
}

/// The other blocker in the same refusal builder, which *is* re-derivable: two
/// conflict blocks in one region is Git's default text merge, and re-deriving
/// residue from a structural merge collapses them. That is inside
/// `drift --fix`'s domain, so it keeps naming it — and the gate confirms it.
#[test]
fn residue_shape_refusal_names_drift_fix_and_it_moves_the_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let fixture = format!(
        "\
file1.txt#L1-L5 rk64:{h1}
<<<<<<< HEAD
file2.txt#L1-L5 rk64:{OTHER_HASH}
=======
file2.txt#L1-L5 rk64:{THIRD_HASH}
>>>>>>> side
<<<<<<< HEAD
file2.txt#L6-L8 rk64:{OTHER_HASH}
=======
file2.txt#L6-L8 rk64:{THIRD_HASH}
>>>>>>> side

why prose
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        fenced_commands(&stderr)
            .iter()
            .any(|c| c == "git span drift --fix"),
        "residue shape is inside `drift --fix`'s domain, so it stays named; stderr=\n{stderr}"
    );
    assert_named_commands_change_the_file(&repo, "m", &fixture, &stderr)
}

/// **What the gate caught that the design rule alone did not.** A `[config]`
/// header inside a conflict block was filed under the same "residue shape"
/// blocker and inherited the same `drift --fix` remediation — but re-deriving
/// residue means merging the two sides, and a side that will not parse cannot
/// be merged. `drift --fix` bails on this file and leaves it byte-identical,
/// which is the same dead loop the boundary refusal had. Running the gate is
/// what turned that up.
#[test]
fn unparseable_side_refusal_names_no_command_because_drift_fix_cannot_move_it() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    // Anchor-region block. The why-region variant of the same defect is worse
    // rather than better: `drift --fix` "advances" it only by absorbing both
    // `[config]` blocks into the why and dropping the settings on the floor,
    // which is a reason not to name the command, not a reason to.
    let fixture = format!(
        "\
<<<<<<< HEAD
file1.txt#L1-L5 rk64:{h1}
[config]
copy_detection = \"same-commit\"
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> side
"
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        fenced_commands(&stderr).is_empty(),
        "nothing repairs an unparseable side, so nothing may be fenced; stderr=\n{stderr}"
    );
    assert!(
        flat(&stderr).contains("a side that will not parse cannot be merged"),
        "and the refusal must say why the obvious command is not it; stderr=\n{stderr}"
    );

    // The claim the refusal makes, checked rather than asserted in prose.
    let before = read_span_bytes(&repo, "m")?;
    repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    assert_eq!(
        before,
        read_span_bytes(&repo, "m")?,
        "`drift --fix` must in fact leave this file byte-identical"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Finding 3: the rename dead end
// ---------------------------------------------------------------------------

/// Residue whose `--rehash` blocker carries the rename signal: an anchor whose
/// source cannot be read, alongside a readable anchor over the **same line
/// range** at a different path.
pub fn renamed_anchor_residue(repo: &TestRepo) -> Result<String> {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let dead = format!("moved/from.txt#L1-L5 rk64:{OTHER_HASH}");
    let base = format!("{dead}\nfile1.txt#L1-L5 rk64:{h1}\n\nshared rationale\n");
    let ours = format!("{dead}\nfile1.txt#L1-L5 rk64:{OTHER_HASH}\n\nshared rationale\n");
    let theirs = format!("{dead}\nfile1.txt#L1-L5 rk64:{THIRD_HASH}\n\nshared rationale\n");
    let residue = driver_residue(repo, &base, &ours, &theirs)?;
    assert!(
        residue.contains("moved/from.txt#L1-L5") && residue.contains("file1.txt#L1-L5"),
        "fixture assumption: both anchors must survive into the residue; residue=\n{residue}"
    );
    Ok(residue)
}

/// The rule with the sign flipped. Rename repair is inside `drift --fix`'s
/// domain, so the refusal that meets the rename signal must name it — and the
/// mechanical gate must pass on the command it names.
#[test]
fn rename_signal_refusal_names_drift_fix() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = renamed_anchor_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(
        fenced_commands(&stderr)
            .iter()
            .any(|c| c.starts_with("git span drift --fix")),
        "an unreadable anchor with a same-range readable counterpart is rename repair, which \
         `drift --fix` does; stderr=\n{stderr}"
    );
    assert_named_commands_change_the_file(&repo, "m", &residue, &stderr)
}

/// **Claim only what the tool can see.** The tool observed a same-range
/// readable anchor at another path. It did not observe a rename, and an
/// operator who cannot reproduce a claim has been failed exactly the way this
/// finding describes, one layer along.
#[test]
fn rename_refusal_claims_the_pairing_not_the_rename() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = renamed_anchor_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let flattened = flat(&stderr);

    assert!(
        flattened.contains("same line range at a different, readable path"),
        "the refusal must state the observation it actually made; stderr=\n{stderr}"
    );
    assert!(
        flattened.contains("the tool has seen the pairing, not the rename itself"),
        "and must mark the gap between that observation and a rename; stderr=\n{stderr}"
    );
    for overclaim in ["file was renamed", "this file was renamed", "was renamed to"] {
        assert!(
            !flattened.contains(overclaim),
            "the refusal must not assert `{overclaim}` — it cannot see that; stderr=\n{stderr}"
        );
    }
    // The pairing itself has to be named, or "a same-range counterpart exists"
    // is a claim the operator also cannot check.
    assert!(
        flattened.contains("moved/from.txt#L1-L5") && flattened.contains("file1.txt#L1-L5"),
        "both halves of the pairing must be named so the operator can check it; \
         stderr=\n{stderr}"
    );
    Ok(())
}

/// **Rename during a merge is two cases with different owners**, and the
/// message must not imply `resolve` owns both. The clean-merging case — where
/// neither side re-anchors after the `git mv` — produces no conflict markers
/// at all, so `resolve` is never involved and that stale anchor is `drift`'s.
/// The refusal has to scope itself to the diverged case it actually fired on.
#[test]
fn rename_refusal_scopes_itself_to_the_diverged_case() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = renamed_anchor_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;
    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let flattened = flat(&String::from_utf8_lossy(&out.stderr));
    assert!(
        flattened.contains("neither side re-anchored"),
        "the refusal must name the case it does not cover; stderr flattened=\n{flattened}"
    );

    // And the claim it makes about that case has to be true. A `git mv` that
    // neither side re-anchored after leaves a span file with no markers, and
    // `resolve` says exactly what the refusal promises it says.
    let clean = TestRepo::seeded()?;
    clean.span_stdout(["add", "r", "file1.txt#L1-L5"])?;
    clean.span_stdout(["why", "r", "seed"])?;
    clean.commit_all("seed span")?;
    clean.run_git(["mv", "file1.txt", "renamed.txt"])?;
    clean.run_git(["commit", "-m", "git mv"])?;

    let out = clean.run_span(["resolve", "r"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "a rename neither side re-anchored is not a conflict; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("no conflict markers; nothing to resolve"),
        "and `resolve` reports exactly what the other refusal says it reports; \
         stdout=\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Finding 1: the post-resolve `git add` loop
// ---------------------------------------------------------------------------

/// Leave the repo mid-merge with real unmerged stages on `.span/m`: the state
/// every one of the circling surfaces is read in.
fn mid_merge(repo_seed: &str) -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/m", repo_seed)?;
    repo.commit_all("declare m")?;

    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file(".span/m", &format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\ntheir why\n"))?;
    repo.commit_all("side edits m")?;

    repo.run_git(["checkout", "main"])?;
    repo.write_file(".span/m", &format!("file1.txt#L1-L5 rk64:{THIRD_HASH}\n\nour why\n"))?;
    repo.commit_all("main edits m")?;

    let merge = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "--no-edit", "side"])
        .output()?;
    assert!(
        !merge.status.success(),
        "fixture assumption: the merge must conflict, or there are no unmerged stages"
    );
    let staged = repo.git_stdout(["ls-files", "-u", ".span/m"])?;
    assert!(
        staged.contains("\t.span/m"),
        "fixture assumption: `.span/m` must be unmerged; ls-files -u:\n{staged}"
    );
    Ok(repo)
}

/// Every surface that refuses a conflicted span must name the exit. `resolve`
/// writes the worktree and never stages — a deliberate contract of this card —
/// so without `git add` in the text the operator settles the file, re-runs, and
/// is told the same thing by the same surfaces. Interactive `why` is covered
/// separately because automation cannot invoke its terminal-only read mode.
///
/// `git add` appears in the *text* only; nothing here runs it, and
/// `resolve_never_stages` in `cli_resolve` guards the other half.
#[test]
fn every_conflict_surface_names_the_staging_exit() -> Result<()> {
    let seed = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\nbase why\n");
    let repo = mid_merge(&seed)?;

    for args in [vec!["m"], vec!["list"]] {
        let out = repo.run_span(args.clone())?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            flat(&text).contains("git add .span/m"),
            "`git span {}` must name the staging exit; output=\n{text}",
            args.join(" ")
        );
    }

    let drift = repo.run_span(["drift", "--no-exit-code"])?;
    let drift_text = String::from_utf8_lossy(&drift.stdout);
    assert!(
        flat(&drift_text).contains("git add .span/m"),
        "`drift`'s conflict footer must name it too; stdout=\n{drift_text}"
    );
    Ok(())
}

/// The successful run is a steering surface too — arguably the first one. It
/// already said "not staged"; what it did not say is that the merge is
/// therefore unfinished, so an operator who stopped reading there went
/// straight back to `show` and was told the span was still conflicted.
#[test]
fn successful_resolve_names_the_exit_and_still_does_not_stage() -> Result<()> {
    let seed = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\nbase why\n");
    let repo = mid_merge(&seed)?;

    let out = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stdout=\n{stdout}\nstderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        flat(&stdout).contains("git add .span/m"),
        "the success report must name the exit; stdout=\n{stdout}"
    );
    // The contract the text describes has to still hold: naming `git add` is
    // the whole change, and `resolve` performing it would be the bug.
    let staged = repo.git_stdout(["ls-files", "-u", ".span/m"])?;
    assert!(
        !staged.trim().is_empty(),
        "`resolve` must leave the unmerged index entry exactly where it was; ls-files -u:\n\
         {staged}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Finding 4: the two conditions `SpanConflict` collapsed
// ---------------------------------------------------------------------------

/// An unmerged index entry and marker text in an already-merged file are
/// detected in different places and cleared by different actions. The variant
/// carried neither apart, so every surface printed the same either/or —
/// telling the operator the tool had not looked, when in fact it had and the
/// answer was discarded one frame later.
#[test]
fn unmerged_index_and_marker_text_are_reported_apart() -> Result<()> {
    // Half one: a real merge leaves stage 1/2/3 entries.
    let seed = format!("file1.txt#L1-L5 rk64:{OTHER_HASH}\n\nbase why\n");
    let unmerged = mid_merge(&seed)?;
    let out = unmerged.run_span(["m"])?;
    let flattened = flat(&String::from_utf8_lossy(&out.stderr));
    assert!(
        flattened.contains("The index holds unmerged stage entries"),
        "`git span m` must name the condition that actually fired; stderr=\n{flattened}"
    );
    assert!(
        flattened.contains("survives it until the file is staged"),
        "and say what that implies, which is the whole reason to tell them apart; \
         stderr=\n{flattened}"
    );

    // Half two: marker text committed into an otherwise-merged file. No
    // unmerged stage exists, so staging is not what is missing.
    let marker_only = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    marker_only.write_file(
        ".span/m",
        &format!(
            "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> theirs

why prose
"
        ),
    )?;
    marker_only.commit_all("commit residue")?;
    let staged = marker_only.git_stdout(["ls-files", "-u", ".span/m"])?;
    assert!(
        staged.trim().is_empty(),
        "fixture assumption: no unmerged stage may exist here; ls-files -u:\n{staged}"
    );

    let out = marker_only.run_span(["m"])?;
    let flattened = flat(&String::from_utf8_lossy(&out.stderr));
    assert!(
        flattened.contains("while the index holds a single, merged entry"),
        "`git span m` must name *this* condition instead; stderr=\n{flattened}"
    );
    assert!(
        flattened.contains("no unmerged stage here"),
        "and must not imply a stage is waiting on a `git add`; stderr=\n{flattened}"
    );
    assert!(
        !flattened.contains("The index holds unmerged stage entries"),
        "the two diagnoses must not both fire; stderr=\n{flattened}"
    );
    Ok(())
}
