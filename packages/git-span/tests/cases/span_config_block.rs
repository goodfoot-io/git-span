//! Reproduction: the documented `[config]` block in span files is never
//! parsed.
//!
//! The span-file format documents a trailing `[config]` TOML block:
//!
//! ```text
//! <anchors>
//!
//! <why>
//!
//! [config]
//! copy_detection = "same-commit"
//! ignore_whitespace = false
//! follow_moves = false
//! ```
//!
//! Hypothesis under test: `SpanFile` carries only `anchors` and `why`, so
//! everything after the first blank line — including a hand-written
//! `[config]` block — is absorbed into the why prose, `span_from_file`
//! always constructs `SpanConfig` from the `DEFAULT_*` constants, and an
//! invalid value like `copy_detection = "totally-bogus-value"` is silently
//! accepted instead of producing a diagnostic.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a span via the CLI, then rewrite its `.span/<name>` file so the
/// content after the anchor block is exactly `tail` (why prose and/or a
/// `[config]` block), preserving the CLI-written anchor line with its
/// valid content hash. Commits the result so every read layer agrees.
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

/// Parse `git span <name>` TOML output into a value we can make exact
/// assertions against (substring checks would be fooled by config text
/// echoed inside a multi-line why string).
fn show_toml(repo: &TestRepo, name: &str) -> Result<toml::Value> {
    let out = repo.span_stdout([name])?;
    Ok(out.parse::<toml::Value>()?)
}

/// A valid `[config]` block must (a) be excluded from the why prose and
/// (b) drive the effective config that `git span show` reports.
#[test]
fn config_block_is_parsed_not_absorbed_into_why() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "cfg",
        "Guard the resolver settings.\n\
         \n\
         [config]\n\
         copy_detection = \"any-file-in-repo\"\n\
         ignore_whitespace = true\n\
         follow_moves = true\n",
    )?;

    let doc = show_toml(&repo, "cfg")?;

    // The why must contain ONLY the author's why sentence — the `[config]`
    // lines are configuration, not prose.
    let why = doc
        .get("why")
        .and_then(|v| v.as_str())
        .expect("show output has a `why` string")
        .to_string();
    assert_eq!(
        why, "Guard the resolver settings.",
        "why prose must not absorb the [config] block; got why={why:?}"
    );

    // The shown config must reflect the written values, not the defaults.
    let config = doc.get("config").expect("show output has a [config] table");
    assert_eq!(
        config.get("copy_detection").and_then(|v| v.as_str()),
        Some("any-file-in-repo"),
        "written copy_detection must be effective; config={config:?}"
    );
    assert_eq!(
        config.get("ignore_whitespace").and_then(|v| v.as_bool()),
        Some(true),
        "written ignore_whitespace must be effective; config={config:?}"
    );
    assert_eq!(
        config.get("follow_moves").and_then(|v| v.as_bool()),
        Some(true),
        "written follow_moves must be effective; config={config:?}"
    );
    Ok(())
}

/// An invalid `copy_detection` value must fail with a diagnostic naming
/// the offending key/value — not be silently accepted as why prose.
#[test]
fn invalid_copy_detection_value_is_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(
        &repo,
        "bogus",
        "Guard the resolver settings.\n\
         \n\
         [config]\n\
         copy_detection = \"totally-bogus-value\"\n",
    )?;

    let out = repo.run_span(["bogus"])?;
    assert!(
        !out.status.success(),
        "`git span show` must fail on an invalid copy_detection value, \
         but exited 0 with stdout:\n{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("totally-bogus-value") || stderr.contains("copy_detection"),
        "diagnostic must name the offending key or value; stderr:\n{stderr}"
    );
    Ok(())
}

/// Guard: a span file with NO `[config]` block still parses, with the
/// documented defaults (same-commit / false / false). Expected to pass
/// even before the fix.
#[test]
fn missing_config_block_yields_defaults() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_with_tail(&repo, "plain", "Just a why sentence.\n")?;

    let doc = show_toml(&repo, "plain")?;
    assert_eq!(
        doc.get("why").and_then(|v| v.as_str()),
        Some("Just a why sentence."),
        "why must be the author's sentence"
    );
    let config = doc.get("config").expect("show output has a [config] table");
    assert_eq!(
        config.get("copy_detection").and_then(|v| v.as_str()),
        Some("same-commit")
    );
    assert_eq!(
        config.get("ignore_whitespace").and_then(|v| v.as_bool()),
        Some(false)
    );
    assert_eq!(
        config.get("follow_moves").and_then(|v| v.as_bool()),
        Some(false)
    );
    Ok(())
}
