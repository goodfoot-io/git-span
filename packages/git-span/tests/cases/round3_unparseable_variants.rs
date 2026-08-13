//! Round-3 evaluation: **a refusal's claim about a command belongs to the case
//! it was written for**, not to the blocker that carries it.
//!
//! Round 2 moved *which command a refusal names* into a domain table and gated
//! it mechanically: for each named command, run it and assert the file changed
//! ([`assert_named_commands_change_the_file`]). That gate only looks at
//! refusals that name something. The refusals that name *nothing* also make a
//! claim — they say which command the operator would reach for and what running
//! it would do — and nothing checked those.
//!
//! One of them was false. `BLOCKER_UNPARSEABLE_RESIDUE` fired on a `[config]`
//! header inside a conflict block wherever that block sat, and its shared
//! sentence promised `drift --fix` "bails on this file and leaves it
//! byte-identical". True before the separator. After it — which is where
//! `[config]` actually lives, so it is the shape a default text merge produces
//! — `drift --fix` rewrites the residue and writes the side holding the
//! unparseable line back **empty**, taking the `[config]` block and everything
//! beside it with it, and exits 0. The refusal was telling the operator that
//! running a command was inert on the one input where it destroys their
//! settings.
//!
//! So this file pins the two variants *against each other*: they behave
//! oppositely under the same command, and no single message can be true of
//! both. And it adds the gate round 2 could not have: for a refusal that names
//! no command, run the command its prose talks about and check that what the
//! prose says happens is what happens.
//!
//! [`assert_named_commands_change_the_file`]: super::round2_repair_domain

use crate::support;

use super::round2_repair_domain::{
    ORIGINAL, OTHER_HASH, fenced_commands, flat, line_slice_hash, read_span_bytes,
    renamed_anchor_residue,
};
use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// The no-command gate
// ---------------------------------------------------------------------------

/// What a "no command repairs this" reason claims about the command it names.
#[derive(Debug, PartialEq, Eq)]
enum InertnessClaim {
    /// "leaves it byte-identical" — the file is not touched.
    Unchanged,
    /// The reason discloses that the command rewrites the file anyway.
    Rewrites,
}

/// The command a no-command reason talks about, and the claim it makes about
/// running it.
///
/// Panicking when neither claim is present is deliberate and is half the
/// gate's value: it is exactly what a hedge — "may leave it unchanged" — would
/// hit. A reason that names a command without committing to what running it
/// does leaves the operator to find out by running it, which on this blocker
/// costs them their `[config]`.
fn no_command_claim(stderr: &str) -> (String, InertnessClaim) {
    let flattened = flat(stderr);
    let tail = flattened
        .split_once("No git-span command repairs this.")
        .map(|(_, t)| t.to_string())
        .unwrap_or_else(|| panic!("not a no-command refusal; stderr=\n{stderr}"));
    let after_tick = tail
        .split_once("`git span ")
        .map(|(_, t)| t)
        .unwrap_or_else(|| panic!("the reason must name the command it is about; tail=\n{tail}"));
    let command = format!(
        "git span {}",
        after_tick
            .split_once('`')
            .map(|(c, _)| c)
            .unwrap_or_else(|| panic!("unterminated command in: {after_tick}"))
    );

    let says_unchanged = tail.contains("leaves it byte-identical");
    let says_rewrites = tail.contains("it rewrites the residue anyway");
    match (says_unchanged, says_rewrites) {
        (true, false) => (command, InertnessClaim::Unchanged),
        (false, true) => (command, InertnessClaim::Rewrites),
        _ => panic!(
            "a reason that names `{command}` must say what running it does, and say one thing: \
             a hedge sends the operator to find out by running it. tail=\n{tail}"
        ),
    }
}

/// **The gate for refusals that name no command.** Round 2's gate asserts that
/// a *named* command changes the file. Its mirror is that a reason claiming a
/// command is inert is telling the truth — and, when the reason instead
/// discloses a rewrite, that the rewrite is real rather than defensive prose.
///
/// Run against the state the operator is actually in: the refused file,
/// restored before each run.
fn assert_no_command_reason_matches_behavior(
    repo: &TestRepo,
    name: &str,
    fixture: &str,
    stderr: &str,
) -> Result<()> {
    let (command, claim) = no_command_claim(stderr);
    repo.write_file(&format!(".span/{name}"), fixture)?;
    let before = read_span_bytes(repo, name)?;
    let mut args: Vec<&str> = command.split_whitespace().skip(2).collect();
    if args.first() == Some(&"drift") {
        args.push("--no-exit-code");
    }
    repo.run_span(args)?;
    let after = read_span_bytes(repo, name)?;
    match claim {
        InertnessClaim::Unchanged => assert_eq!(
            before, after,
            "the refusal claims `{command}` leaves this file byte-identical, so it must; a \
             false inertness claim is worse than naming the command outright, because the \
             operator runs it believing nothing can happen"
        ),
        InertnessClaim::Rewrites => assert_ne!(
            before, after,
            "the refusal discloses that `{command}` rewrites this file; if it does not, the \
             disclosure is scaremongering and the operator learns to discount the next one"
        ),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The two variants
// ---------------------------------------------------------------------------

/// `[config]` inside a conflict block that sits **before** the separator.
fn anchor_region_config_residue() -> String {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    format!(
        "\
<<<<<<< HEAD
file1.txt#L1-L5 rk64:{h1}
[config]
copy_detection = \"same-commit\"
=======
file1.txt#L1-L5 rk64:{OTHER_HASH}
>>>>>>> side
"
    )
}

/// `[config]` inside a conflict block that sits **after** the separator — the
/// shape a default text merge leaves when both sides edited settings and the
/// why prose above them diverged too, since `[config]` is the file's trailing
/// block.
fn why_region_config_residue() -> String {
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    format!(
        "\
file1.txt#L1-L5 rk64:{h1}

<<<<<<< HEAD
our why

[config]
copy_detection = \"same-commit\"
follow_moves = true
=======
their why

[config]
ignore_whitespace = true
follow_moves = true
>>>>>>> side
"
    )
}

/// **Variant one.** Before the separator, `drift --fix` really does bail and
/// leave the file byte-identical, so the refusal may say so — and the gate
/// checks it rather than trusting the sentence.
#[test]
fn anchor_region_unparseable_side_is_inert_under_drift_fix() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = anchor_region_config_residue();
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    let flattened = flat(&stderr);
    assert!(
        flattened.contains("leaves it byte-identical"),
        "this is the variant the claim is true of, and it is worth saying; stderr=\n{stderr}"
    );
    assert!(
        flattened.contains("in its anchor block"),
        "the refusal must name the region, because the region is what decides the claim; \
         stderr=\n{stderr}"
    );
    assert_eq!(
        no_command_claim(&stderr).1,
        InertnessClaim::Unchanged,
        "stderr=\n{stderr}"
    );
    assert_no_command_reason_matches_behavior(&repo, "m", &fixture, &stderr)
}

/// **Variant two, the defect.** After the separator the same blocker fires and
/// the opposite thing happens: `drift --fix` rewrites the file, empties the
/// side the `[config]` block stood on, and exits 0. The refusal must disclose
/// that, and must not carry the byte-identity claim that belongs to variant
/// one.
#[test]
fn why_region_unparseable_side_discloses_that_drift_fix_rewrites_it() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = why_region_config_residue();
    repo.write_file(".span/m", &fixture)?;

    // **Premise before conclusion.** Three of the four ways a fixture on this
    // card has silently tested nothing present exactly like a passing test: the
    // refusal fires, the exit is non-zero, the substring matches — and the
    // blocker reached is not the one under test. An invalid `[config]` key is
    // the undetectable one, because it makes the side unparseable for a reason
    // that has nothing to do with where the block sits. So prove the keys are
    // accepted before reading anything into the refusal.
    repo.write_file(
        ".span/valid",
        &format!(
            "file1.txt#L1-L5 rk64:{}\n\nwhy\n\n[config]\ncopy_detection = \"same-commit\"\n\
             ignore_whitespace = true\nfollow_moves = true\n",
            line_slice_hash(ORIGINAL, 1, 5)
        ),
    )?;
    let valid = repo.run_span(["show", "valid"])?;
    assert_eq!(
        valid.status.code(),
        Some(0),
        "fixture assumption: every key in this fixture's `[config]` must be one the parser          accepts, or the side is unparseable for the wrong reason; stderr=\n{}",
        String::from_utf8_lossy(&valid.stderr)
    );

    let out = repo.run_span(["resolve", "m"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    let flattened = flat(&stderr);
    // Which blocker fired, not merely that something refused: the region is
    // what selects the variant, so the refusal naming it is the discriminator.
    assert!(
        flattened.contains("`[config]` header inside a conflict block in its why text"),
        "fixture assumption: this must reach the why-region unparseable-side blocker, not the \
         anchor-region one and not a boundary refusal; stderr=\n{stderr}"
    );

    // The false claim, asserted absent on the variant it is false about.
    assert!(
        !flattened.contains("byte-identical"),
        "`drift --fix` rewrites this file; promising byte-identity here is the defect; \
         stderr=\n{stderr}"
    );
    // And hedging is not the repair: the destruction has to be stated.
    for required in [
        "it rewrites the residue anyway",
        "written back **empty**",
        "exits 0",
        "makes the loss permanent",
    ] {
        assert!(
            flattened.contains(required),
            "the refusal must disclose `{required}`; withholding the reassurance is not the \
             same as disclosing the loss; stderr=\n{stderr}"
        );
    }
    assert_eq!(
        no_command_claim(&stderr).1,
        InertnessClaim::Rewrites,
        "stderr=\n{stderr}"
    );

    assert_no_command_reason_matches_behavior(&repo, "m", &fixture, &stderr)?;

    // **Only rejections are observable.** The cell this test is about is the
    // one that *passes* every upstream gate, and passing a gate emits nothing:
    // an anchor-region block announces itself with `no space found`, an invalid
    // `[config]` key with `unknown`, and the destroying path has no positive
    // signature at all. `1 span is in a Git conflict state` is printed in every
    // cell, so it certifies nothing. What identifies this cell is the absence
    // of both rejections *and* the effect observed directly — either half alone
    // is satisfied by a run that never got here.
    repo.write_file(".span/m", &fixture)?;
    let fix = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let fix_out = format!(
        "{}{}",
        String::from_utf8_lossy(&fix.stdout),
        String::from_utf8_lossy(&fix.stderr)
    );
    for rejection in ["no space found", "unknown"] {
        assert!(
            !fix_out.contains(rejection),
            "fixture assumption: `{rejection}` means an upstream gate stopped `drift --fix` \
             before the shape under test; output=\n{fix_out}"
        );
    }

    // The claim, checked at the level the operator cares about: not merely
    // "the file changed" but "the settings are gone".
    let after = String::from_utf8(read_span_bytes(&repo, "m")?)?;
    assert!(
        !after.contains("[config]")
            && !after.contains("copy_detection")
            && !after.contains("ignore_whitespace")
            && !after.contains("follow_moves"),
        "fixture assumption: this is the loss the refusal warns about; after=\n{after}"
    );
    Ok(())
}

/// The two variants must never again reach the operator through one sentence.
/// They are the same blocker to `resolve` and opposite states of the file after
/// `drift --fix`, so a shared message is necessarily false about one of them.
#[test]
fn the_two_variants_do_not_share_a_message() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file(".span/m", &anchor_region_config_residue())?;
    let anchor = repo.run_span(["resolve", "m"])?;
    let anchor_err = flat(&String::from_utf8_lossy(&anchor.stderr));

    repo.write_file(".span/m", &why_region_config_residue())?;
    let why = repo.run_span(["resolve", "m"])?;
    let why_err = flat(&String::from_utf8_lossy(&why.stderr));

    assert_ne!(
        anchor_err, why_err,
        "one message for two opposite behaviours is how the false claim got written"
    );
    assert!(
        anchor_err.contains("leaves it byte-identical")
            && !why_err.contains("leaves it byte-identical"),
        "and the claim must land only on the variant it is true of;\nanchor=\n{anchor_err}\n\
         why=\n{why_err}"
    );
    Ok(())
}

/// **Where the settings survive, and how easily that is thrown away.** After
/// `drift --fix` has emptied the side, the merge's unmerged index stages still
/// hold all three settings and `resolve` sources `[config]` from there. That is
/// not mitigation: the refusal's own hand-edit paragraph used to route the
/// operator past it — settle the tidy little why conflict, `git add` — and
/// staging is precisely what discards the stages. This pins the mechanism the
/// text now points at. A real `git merge` with the driver unregistered, because
/// a hand-written fixture has no stages to recover from.
#[test]
fn emptied_side_is_still_recoverable_through_resolve() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let span = |why: &str, extra: &str| {
        format!("file1.txt#L1-L5 rk64:{h1}\n\n{why}\n\n[config]\n{extra}follow_moves = true\n")
    };

    repo.write_file(".span/m", &span("base why", ""))?;
    repo.commit_all("declare m")?;
    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file(".span/m", &span("their why", "ignore_whitespace = true\n"))?;
    repo.commit_all("side edits m")?;
    repo.run_git(["checkout", "main"])?;
    repo.write_file(".span/m", &span("our why", "copy_detection = \"same-commit\"\n"))?;
    repo.commit_all("main edits m")?;

    let merge = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "--no-edit", "side"])
        .output()?;
    assert!(
        !merge.status.success(),
        "fixture assumption: the merge must conflict, or there are no unmerged stages"
    );
    let conflicted = String::from_utf8(read_span_bytes(&repo, "m")?)?;
    assert!(
        conflicted.contains("<<<<<<<") && conflicted.contains("[config]"),
        "fixture assumption: `[config]` must land inside a block; file=\n{conflicted}"
    );

    // The refusal fires on the real merge's output, not just on hand-written
    // residue — this is the input an operator actually arrives with.
    let refusal = repo.run_span(["resolve", "m", "--ours"])?;
    let stderr = String::from_utf8_lossy(&refusal.stderr);
    assert_ne!(refusal.status.code(), Some(0), "stderr=\n{stderr}");
    assert!(flat(&stderr).contains("it rewrites the residue anyway"));

    // Take the path the refusal warns about, then the one it prescribes.
    repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let emptied = String::from_utf8(read_span_bytes(&repo, "m")?)?;
    assert!(
        !emptied.contains("[config]"),
        "fixture assumption: the side is emptied; file=\n{emptied}"
    );
    let staged = repo.git_stdout(["ls-files", "-u", ".span/m"])?;
    assert!(
        staged.contains("\t.span/m"),
        "the recovery depends on the stages surviving `drift --fix`; ls-files -u:\n{staged}"
    );

    let recovered = repo.run_span(["resolve", "m", "--ours"])?;
    let stdout = String::from_utf8_lossy(&recovered.stdout);
    assert_eq!(
        recovered.status.code(),
        Some(0),
        "stdout=\n{stdout}\nstderr=\n{}",
        String::from_utf8_lossy(&recovered.stderr)
    );
    let restored = String::from_utf8(read_span_bytes(&repo, "m")?)?;
    for setting in [
        "copy_detection = \"same-commit\"",
        "ignore_whitespace = true",
        "follow_moves = true",
    ] {
        assert!(
            restored.contains(setting),
            "`resolve` reads `[config]` from the index stages, so `{setting}` must come back — \
             this is why the refusal tells the operator to resolve rather than hand-edit; \
             file=\n{restored}"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The ordered fence
// ---------------------------------------------------------------------------

/// **A sequence must not end on a command with nothing to do.** The rename
/// refusal fenced `drift --fix` and then `resolve --dry-run`, under "run it,
/// then re-run `resolve` on the residue it leaves". `drift --fix` settles this
/// input outright, so there is no residue: the operator's final output was
/// ``m` has no conflict markers; nothing to resolve` — the exact sentence the
/// same refusal's closing paragraph nominates as the signature of the case
/// where `resolve` is *not* involved. It converges and then tells them they
/// were never here.
///
/// Round 2's gate covered this refusal and passed it, twice over: it filters
/// `--dry-run` out as a report, and it re-seeds the fixture per command, which
/// dissolves the ordering the defect lives in. Both choices are right for a
/// fence of alternatives. The fix is the type — [`NextStep::Ordered`] — and
/// this is its surface-level half — the fence's commands, run in the order it
/// gives them, against the state each one leaves.
#[test]
fn rename_fence_prescribes_no_command_that_has_nothing_to_do() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = renamed_anchor_residue(&repo)?;
    repo.write_file(".span/m", &residue)?;

    let out = repo.run_span(["resolve", "m", "--rehash"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr=\n{stderr}");
    let commands = fenced_commands(&stderr);
    assert!(
        commands.iter().any(|c| c == "git span drift --fix"),
        "fixture assumption: this must reach the rename-signal blocker; stderr=\n{stderr}"
    );
    assert!(
        !commands.iter().any(|c| c.contains("--dry-run")),
        "a prescribed sequence ending in a report leaves the operator holding `nothing to \
         resolve`; stderr=\n{stderr}"
    );

    // The rename paragraph and its fence are pushed last, so the final fenced
    // block *is* the ordered sequence. Taking it apart from the alternatives
    // fences above matters: those are a menu, and running them in order settles
    // the file before the sequence is ever reached.
    let sequence = fenced_blocks(&stderr)
        .pop()
        .unwrap_or_else(|| panic!("the refusal must fence the rename exit; stderr=\n{stderr}"));
    assert_eq!(
        sequence,
        vec!["git span drift --fix".to_string()],
        "stderr=\n{stderr}"
    );
    assert_ordered_fence_ends_by_moving_the_file(&repo, "m", &sequence)?;

    // And the claim the fence now rests on: `drift --fix` alone settles it, so
    // there is nothing after it for a second command to act on.
    let settled = String::from_utf8(read_span_bytes(&repo, "m")?)?;
    assert!(
        !settled.contains("<<<<<<<"),
        "the fence stops at `drift --fix` because `drift --fix` finishes the job here; \
         file=\n{settled}"
    );
    Ok(())
}

/// Each fenced ```bash block's commands, as blocks rather than one flat list.
/// [`fenced_commands`] flattens them, which is right for "is this command
/// offered anywhere" and wrong for anything about a single fence.
fn fenced_blocks(stderr: &str) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut current: Option<Vec<String>> = None;
    for line in stderr.lines() {
        if line.trim_start().starts_with("```") {
            match current.take() {
                Some(block) => blocks.push(block),
                None => current = Some(Vec::new()),
            }
            continue;
        }
        if let Some(block) = current.as_mut()
            && !line.trim().is_empty()
        {
            block.push(line.trim().to_string());
        }
    }
    blocks
}

/// **The ordered gate proper.** Round 2's gate re-seeds the refused fixture
/// before each command, which is right when the fence is a menu and wrong when
/// it is a sequence: it evaluates every step against a state the operator will
/// not be in by then. `resolve --dry-run` is perfectly sensible against the
/// *refused* file; it is inert only against what `drift --fix` leaves behind,
/// which is the only state the sequence ever puts it in.
///
/// So this runs the steps in order, against the state each one leaves, and
/// requires the *last* to move the file. A sequence whose final command changes
/// nothing has, as its parting output, a report about a state the operator is
/// no longer in.
fn assert_ordered_fence_ends_by_moving_the_file(
    repo: &TestRepo,
    name: &str,
    commands: &[String],
) -> Result<()> {
    let (last, leading) = commands.split_last().expect("an empty sequence prescribes nothing");
    for cmd in leading {
        repo.run_span(cmd.split_whitespace().skip(2).collect::<Vec<_>>())?;
    }
    let before = read_span_bytes(repo, name)?;
    let mut args: Vec<&str> = last.split_whitespace().skip(2).collect();
    if args.first() == Some(&"drift") {
        args.push("--no-exit-code");
    }
    repo.run_span(args)?;
    assert_ne!(
        before,
        read_span_bytes(repo, name)?,
        "`{last}` is the last step of a prescribed sequence and it changed nothing against the \
         state the earlier steps left; that is the operator's final output telling them there \
         was nothing to do"
    );
    Ok(())
}
