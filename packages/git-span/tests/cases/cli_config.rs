//! Acceptance contract for `git span config` — the read/write surface for a
//! span's trailing `[config]` block.
//!
//! The vocabulary rule under everything here: keys and values the CLI accepts
//! are exactly the ones [`parse_config_block`] accepts, validation happens
//! before any file I/O, and every write is a serializer round-trip so the
//! on-disk shape never depends on which command produced it.
//!
//! [`parse_config_block`]: git_span_core::span_file::parse_config_block

use crate::support::{self, TestRepo};

use anyhow::Result;

/// Seed a span via the CLI, then rewrite its `.span/<name>` tail so the
/// content after the anchor line is exactly `tail`, preserving the
/// CLI-written anchor line with its valid content hash. Commits the result
/// so every read layer agrees.
fn seed_with_tail(repo: &TestRepo, name: &str, tail: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    let span_path = repo.path().join(".span").join(name);
    let existing = std::fs::read_to_string(&span_path)?;
    let anchor_line = existing
        .lines()
        .next()
        .expect("span file written by `add` has an anchor line")
        .to_string();
    std::fs::write(&span_path, format!("{anchor_line}\n\n{tail}"))?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", &format!("span {name}")])?;
    Ok(())
}

fn span_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(repo.path().join(".span").join(name))?)
}

// --- Read form -----------------------------------------------------------

/// A span with no `[config]` block reads as its effective defaults — all
/// three keys printed, nothing omitted — so the output answers what the
/// resolver is actually doing.
#[test]
fn read_prints_all_three_keys_including_defaults() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "plain", "file1.txt#L1-L3"])?;

    let out = repo.span_stdout(["config", "plain"])?;
    assert_eq!(
        out,
        "Span `plain` config:\n\
         copy_detection = \"same-commit\"\n\
         ignore_whitespace = false\n\
         follow_moves = false\n",
        "read form must print the header plus every key with its current value"
    );
    Ok(())
}

/// Written values are what the read form reports — the command answers the
/// effective configuration, not the absence of a hand-written block.
#[test]
fn read_reflects_written_block_values() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "cfg",
        "Guard the resolver settings.\n\
         \n\
         [config]\n\
         copy_detection = \"any-file-in-commit\"\n\
         ignore_whitespace = true\n\
         follow_moves = false\n",
    )?;

    let out = repo.span_stdout(["config", "cfg"])?;
    assert_eq!(
        out,
        "Span `cfg` config:\n\
         copy_detection = \"any-file-in-commit\"\n\
         ignore_whitespace = true\n\
         follow_moves = false\n"
    );
    Ok(())
}

/// A span that does not exist is refused, pointing at the enumeration
/// command — reading configuration of a typo must not invent output.
#[test]
fn read_missing_span_refuses_naming_list() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["config", "nope"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("no span named `nope`"),
        "refusal must name the missing span; stderr: {stderr}"
    );
    assert!(
        stderr.contains("git span list"),
        "refusal must point at `git span list`; stderr: {stderr}"
    );
    Ok(())
}

/// A conflict-markered span file is refused with the same remediation other
/// readers attach — `config` is not a repair tool.
#[test]
fn read_conflicted_span_refuses_with_resolve_remediation() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(&repo, "conflicted", "A why sentence.\n")?;
    let span_path = repo.path().join(".span").join("conflicted");
    std::fs::write(
        &span_path,
        "<<<<<<< HEAD\na.txt sha256:111\n=======\nb.txt sha256:222\n>>>>>>> other\n",
    )?;

    let out = repo.run_span(["config", "conflicted"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("conflict"),
        "refusal must diagnose the conflict state; stderr: {stderr}"
    );
    assert!(
        stderr.contains("git status") || stderr.contains("git span resolve"),
        "refusal must carry the recovery next step; stderr: {stderr}"
    );
    Ok(())
}

/// The read view is the effective one, tombstones included: a span whose
/// worktree file was removed while committed is refused exactly like `show`
/// refuses it — one answer per state across reading commands.
#[test]
fn read_tombstoned_span_is_refused_like_show() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(&repo, "committed", "why\n")?;
    std::fs::remove_file(repo.path().join(".span").join("committed"))?;

    let out = repo.run_span(["config", "committed"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("no span named `committed`"),
        "a worktree-deleted span is an effective-view absence; stderr: {stderr}"
    );

    // Parity is the point: show answers the same state the same way.
    let shown = repo.run_span(["show", "committed"])?;
    let show_stderr = String::from_utf8_lossy(&shown.stderr);
    assert_eq!(shown.status.code(), Some(1));
    assert!(
        show_stderr.contains("no span named `committed`"),
        "show must agree with config on the tombstoned state; stderr: {show_stderr}"
    );
    Ok(())
}

// --- Write form ----------------------------------------------------------

/// Setting a key on a span without a block appends the canonical trailing
/// block — all three keys explicit, in serialize()'s shape — and reports the
/// transition with the previous value.
#[test]
fn write_creates_canonical_trailing_block_on_span_without_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "fresh", "file1.txt#L1-L3"])?;
    let before = span_bytes(&repo, "fresh")?;

    let out = repo.span_stdout(["config", "fresh", "copy_detection", "off"])?;
    assert_eq!(
        out,
        "Set `copy_detection` to \"off\" on span `fresh` (was \"same-commit\"). \
         Stage and commit with git add .span && git commit.\n",
        "write must report key, new value, and previous value; got: {out}"
    );

    let after = span_bytes(&repo, "fresh")?;
    let after_text = String::from_utf8(after.clone())?;
    assert_eq!(
        after_text.rfind("[config]").map(|i| &after_text[i..]),
        Some(
            "[config]\ncopy_detection = \"off\"\nignore_whitespace = false\nfollow_moves = false\n"
        ),
        "block must be the serializer's canonical trailing shape; file:\n{after_text}"
    );
    // The untouched prefix (anchors, why) survives byte-for-byte above the
    // appended separator+block.
    let before_text = String::from_utf8(before)?;
    let prefix_len = before_text.trim_end().len();
    assert_eq!(
        &after_text[..prefix_len],
        &before_text[..prefix_len],
        "existing content must be preserved above the new block"
    );

    // And the write is visible to the rest of the CLI through the normal
    // parser — proving vocabulary parity end-to-end.
    let shown = repo.span_stdout(["show", "fresh"])?;
    let doc = shown.parse::<toml::Value>()?;
    assert_eq!(
        doc["config"]["copy_detection"].as_str(),
        Some("off"),
        "the written key must drive the effective config show reports"
    );
    Ok(())
}

/// Updating one key of an existing block keeps the other two keys' stored
/// values — a single-key write is not a reset of the block.
#[test]
fn write_updates_one_key_preserving_others() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "multi",
        "why\n\n[config]\ncopy_detection = \"off\"\nignore_whitespace = true\nfollow_moves = false\n",
    )?;

    let out = repo.span_stdout(["config", "multi", "follow_moves", "true"])?;
    assert_eq!(
        out,
        "Set `follow_moves` to true on span `multi` (was false). \
         Stage and commit with git add .span && git commit.\n"
    );

    let shown = repo.span_stdout(["show", "multi"])?;
    let doc = shown.parse::<toml::Value>()?;
    assert_eq!(doc["config"]["follow_moves"].as_bool(), Some(true));
    assert_eq!(
        doc["config"]["copy_detection"].as_str(),
        Some("off"),
        "unrelated stored keys must survive the single-key write"
    );
    assert_eq!(doc["config"]["ignore_whitespace"].as_bool(), Some(true));
    Ok(())
}

/// Returning the last non-default key to its default removes the whole
/// block rather than leaving an empty `[config]` header behind.
#[test]
fn write_back_to_default_removes_the_entire_block() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "restore-defaults",
        "why\n\n[config]\ncopy_detection = \"same-commit\"\nignore_whitespace = true\nfollow_moves = false\n",
    )?;

    repo.span_stdout(["config", "restore-defaults", "ignore_whitespace", "false"])?;

    let text = String::from_utf8(span_bytes(&repo, "restore-defaults")?)?;
    assert!(
        !text.contains("[config]"),
        "a default-equal configuration must serialize without a block; file:\n{text}"
    );

    // Round-trip parity: the parser agrees the span is back to defaults.
    let shown = repo.span_stdout(["show", "restore-defaults"])?;
    let doc = shown.parse::<toml::Value>()?;
    assert_eq!(doc["config"]["ignore_whitespace"].as_bool(), Some(false));
    assert_eq!(doc["config"]["copy_detection"].as_str(), Some("same-commit"));
    Ok(())
}

/// Setting a key to the value it already holds says so explicitly and
/// rewrites nothing — byte-identity is unconditional for no-ops.
#[test]
fn noop_write_reports_already_set_and_never_touches_the_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "noop",
        "why\n\n[config]\ncopy_detection = \"off\"\nignore_whitespace = true\nfollow_moves = false\n",
    )?;
    let before = span_bytes(&repo, "noop")?;

    let out = repo.span_stdout(["config", "noop", "copy_detection", "off"])?;
    assert_eq!(
        out,
        "copy_detection is already \"off\" on span `noop`; nothing changed.\n",
        "a no-op write must say so explicitly; got: {out}"
    );
    assert_eq!(
        span_bytes(&repo, "noop")?,
        before,
        "a no-op write must leave the span file byte-identical"
    );
    Ok(())
}

// --- Vocabulary parity (rejected before any file I/O) --------------------

/// An unknown key is rejected with the full accepted set named, and the
/// span file is left byte-identical.
#[test]
fn unknown_key_is_rejected_before_io_with_accepted_set_named() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "guard", "file1.txt#L1-L3"])?;
    let before = span_bytes(&repo, "guard")?;

    let out = repo.run_span(["config", "guard", "follow_renames", "true"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("follow_renames"),
        "error must name the offending key; stderr: {stderr}"
    );
    for accepted in ["copy_detection", "ignore_whitespace", "follow_moves"] {
        assert!(
            stderr.contains(accepted),
            "error must name accepted key `{accepted}`; stderr: {stderr}"
        );
    }
    assert_eq!(
        span_bytes(&repo, "guard")?,
        before,
        "a rejected key must leave the span file byte-identical"
    );
    Ok(())
}

/// An out-of-vocabulary `copy_detection` value is rejected with the
/// documented wire names enumerated.
#[test]
fn invalid_copy_detection_value_is_rejected_before_io() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "bogusval", "file1.txt#L1-L3"])?;
    let before = span_bytes(&repo, "bogusval")?;

    let out = repo.run_span(["config", "bogusval", "copy_detection", "totally-bogus"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("totally-bogus"),
        "error must echo the rejected value; stderr: {stderr}"
    );
    for accepted in ["off", "same-commit", "any-file-in-commit", "any-file-in-repo"] {
        assert!(
            stderr.contains(accepted),
            "error must name accepted value `{accepted}`; stderr: {stderr}"
        );
    }
    assert_eq!(span_bytes(&repo, "bogusval")?, before);
    Ok(())
}

/// Booleans accept only `true`/`false` — the parser's rule, not clap's
/// bool coercion (`yes`/`1` must fail).
#[test]
fn invalid_bool_value_is_rejected_before_io() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "yesno", "file1.txt#L1-L3"])?;
    let before = span_bytes(&repo, "yesno")?;

    let out = repo.run_span(["config", "yesno", "ignore_whitespace", "yes"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("expected true or false"),
        "error must state the boolean grammar; stderr: {stderr}"
    );
    assert_eq!(span_bytes(&repo, "yesno")?, before);
    Ok(())
}

/// A tombstoned span (worktree file removed while committed) cannot be
/// written: the refusal is the show-style no-span-named — and critically,
/// no anchor-less replacement file may materialize, since that would
/// destroy the committed declaration on the next commit.
#[test]
fn write_tombstoned_span_refuses_without_creating_a_replacement() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(&repo, "ghost", "why\n")?;
    std::fs::remove_file(repo.path().join(".span").join("ghost"))?;

    let out = repo.run_span(["config", "ghost", "follow_moves", "true"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("no span named `ghost`"),
        "refusal must match show's answer for the tombstoned state; stderr: {stderr}"
    );
    assert!(
        !repo.path().join(".span").join("ghost").exists(),
        "a refused write must not materialize an anchor-less span file"
    );
    Ok(())
}

// --- Grammar -------------------------------------------------------------

/// Exactly-one of the two positionals cannot be expressed — trailing
/// positionals fill left to right, so `config <name>` with no more
/// arguments *is* the read form. What clap owns: a missing `<name>`, a key
/// without its value, and any surplus argument.
#[test]
fn one_sided_positionals_are_usage_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    for args in [
        vec!["config"],
        vec!["config", "s", "copy_detection"],
        vec!["config", "s", "copy_detection", "off", "surplus"],
    ] {
        let out = repo.run_span(&args)?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(
            out.status.code(),
            Some(2),
            "`{args:?}` must be clap's usage exit; stderr: {stderr}"
        );
        assert!(
            stdout_of(&out).is_empty(),
            "usage errors print nothing on stdout; got: {}",
            stdout_of(&out)
        );
    }
    Ok(())
}

fn stdout_of(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

// --- Reserved-name interplay ----------------------------------------------

/// A pre-reservation span literally named `config` stays readable through
/// the explicit `show` spelling — adding the subcommand must not strand
/// legacy declarations.
#[test]
fn pre_reservation_span_named_config_still_reads_via_show() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    support::create_and_commit_span(
        &gix,
        "config",
        &[("file1.txt", 1, 3)],
        "Legacy span created before `config` became reserved.",
    )?;

    let shown = repo.span_stdout(["show", "config"])?;
    let doc = shown.parse::<toml::Value>()?;
    assert_eq!(doc["name"].as_str(), Some("config"));

    // The subcommand owns the bare token: `git span config` alone is a usage
    // error about <NAME>, not an implicit read of the legacy span.
    let bare = repo.run_span(["config"])?;
    assert_eq!(bare.status.code(), Some(2));
    Ok(())
}
