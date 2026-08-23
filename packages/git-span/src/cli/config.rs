//! `git span config` — read or set a span's trailing `[config]` block.
//!
//! The command owns no emission path of its own: reads render the
//! effective [`SpanConfig`] and writes go through the same
//! parse/serialize round-trip every other mutating command uses, so the
//! block's canonical shape (trailing position, three explicit keys,
//! default elision) is owned by `git-span-core` alone.
//!
//! The accepted vocabulary is [`parse_config_block`]'s vocabulary, and it
//! is checked before any file I/O: a rejected key or value leaves the
//! span byte-identical. Writes run under the exclusive repository lock
//! taken at dispatch (`recovery_domain::command_mode` classifies config
//! by the presence of a value, exactly like `why`) — there is no
//! per-span lock to take.
//!
//! [`SpanConfig`]: git_span_core::SpanConfig
//! [`parse_config_block`]: git_span_core::span_file::parse_config_block

use anyhow::Result;
use gix::Repository;

use super::commit::{read_worktree_span, write_worktree_span};
use super::{CliError, ConfigArgs, NextStep};
use crate::span_file::SpanConfig;
use crate::span_file_reader::SpanFileReader;

/// One validated `<key> <value>` pair, parsed against the parser's
/// vocabulary before anything touches the filesystem.
enum Setting {
    CopyDetection(git_span_core::CopyDetection),
    IgnoreWhitespace(bool),
    FollowMoves(bool),
}

pub fn run_config(repo: &Repository, args: ConfigArgs, span_root: &str) -> Result<i32> {
    let ConfigArgs { name, key, value } = args;

    crate::validation::validate_span_name(&name)?;

    match (key, value) {
        (Some(key), Some(value)) => {
            let _perf = crate::perf::span("config.write");
            run_config_write(repo, &name, &key, &value, span_root)
        }
        (None, None) => {
            let _perf = crate::perf::span("config.read");
            run_config_reader(repo, &name, span_root)
        }
        // Unreachable by construction: each positional `requires` the other,
        // so clap rejects the one-sided spellings with a usage error.
        _ => unreachable!("clap requires key and value together"),
    }
}

// ---------------------------------------------------------------------------
// Read form
// ---------------------------------------------------------------------------

fn run_config_reader(repo: &Repository, name: &str, span_root: &str) -> Result<i32> {
    let span = read_effective_or_refuse(repo, name, span_root)?;

    println!("Span `{name}` config:");
    println!("copy_detection = \"{}\"", span.config.copy_detection.wire_name());
    println!("ignore_whitespace = {}", span.config.ignore_whitespace);
    println!("follow_moves = {}", span.config.follow_moves);
    Ok(0)
}

/// The effective span (worktree overlays index overlays HEAD), with the two
/// shared refusals attached: a Git-conflicted declaration gets the conflict
/// diagnosis and recovery steps other readers attach, and an effective-view
/// absence — including the worktree-deletion tombstone — gets `show`'s
/// no-span-named answer, so every reading command gives one answer per
/// state.
fn read_effective_or_refuse(
    repo: &Repository,
    name: &str,
    span_root: &str,
) -> Result<crate::span_file::SpanFile> {
    let reader = SpanFileReader::new(repo, span_root.to_string());
    reader
        .read_effective(name)
        .map_err(|e| -> anyhow::Error {
            if let crate::Error::SpanConflict { kind, .. } = e {
                CliError {
                    subcommand: "config",
                    summary: format!("span `{name}` is in a Git conflict state."),
                    what_happened: super::resolve::conflict_diagnosis(name, kind),
                    next_steps: {
                        let mut steps =
                            vec![NextStep::Bash(format!("git status {span_root}/{name}"))];
                        steps.extend(super::resolve::conflict_remediation(
                            &[name], span_root, kind,
                        ));
                        steps
                    },
                }
                .into()
            } else {
                e.into()
            }
        })?
        .ok_or_else(|| anyhow::Error::from(no_span_named(name)))
}

fn no_span_named(name: &str) -> CliError {
    CliError {
        subcommand: "config",
        summary: format!("no span named `{name}`."),
        what_happened: format!(
            "No declaration for `{name}` exists in the effective view \
             (worktree, index, or HEAD)."
        ),
        next_steps: vec![NextStep::Bash("git span list".into())],
    }
}

// ---------------------------------------------------------------------------
// Write form
// ---------------------------------------------------------------------------

fn run_config_write(
    repo: &Repository,
    name: &str,
    key: &str,
    value: &str,
    span_root: &str,
) -> Result<i32> {
    // Vocabulary parity first — pure validation, no I/O, so a rejection can
    // never have half-happened and an unknown span cannot mask the real
    // mistake (the typo'd key).
    let setting = parse_setting(key, value)?;

    // Existence pass with the shared refusals: an effective-view absence
    // (including the worktree-deletion tombstone) refuses here instead of
    // letting the worktree read below fabricate an empty declaration.
    let _effective = read_effective_or_refuse(repo, name, span_root)?;

    // An effective `Some` above implies the worktree layer parsed — so this
    // read sees the same declaration the operator is configuring. Under the
    // dispatch-held exclusive lock nothing can move between the two reads.
    let mut span = read_worktree_span(repo, span_root, name)?;
    let previous = span.config;
    let updated = apply(previous, setting);

    if updated == previous {
        println!(
            "{key} is already {} on span `{name}`; nothing changed.",
            render_field(&previous, key)
        );
        return Ok(0);
    }

    span.config = updated;
    write_worktree_span(repo, span_root, name, &mut span)?;
    println!(
        "Set `{key}` to {} on span `{name}` (was {}). Stage and commit with git add .span && git commit.",
        render_field(&updated, key),
        render_field(&previous, key)
    );
    Ok(0)
}

// ---------------------------------------------------------------------------
// Vocabulary parity
// ---------------------------------------------------------------------------

fn parse_setting(key: &str, value: &str) -> Result<Setting> {
    match key {
        "copy_detection" => {
            let detected = git_span_core::CopyDetection::from_wire(value).ok_or_else(|| {
                invalid_value(
                    key,
                    value,
                    "expected \"off\", \"same-commit\", \"any-file-in-commit\", or \"any-file-in-repo\"",
                )
            })?;
            Ok(Setting::CopyDetection(detected))
        }
        "ignore_whitespace" => Ok(Setting::IgnoreWhitespace(parse_bool(key, value)?)),
        "follow_moves" => Ok(Setting::FollowMoves(parse_bool(key, value)?)),
        other => Err(CliError {
            subcommand: "config",
            summary: format!("unknown [config] key `{other}`."),
            what_happened: "The only configuration keys are the three the span-file parser \
                            accepts; anything else would poison the span on the next read."
                .into(),
            next_steps: vec![NextStep::Prose(
                "Accepted keys: copy_detection, ignore_whitespace, follow_moves.".into(),
            )],
        }
        .into()),
    }
}

fn parse_bool(key: &str, value: &str) -> Result<bool> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        other => Err(invalid_value(key, other, "expected true or false").into()),
    }
}

fn invalid_value(key: &str, value: &str, expectation: &str) -> CliError {
    CliError {
        subcommand: "config",
        summary: format!("invalid {key} value `{value}`: {expectation}."),
        what_happened: "The value must come from the same vocabulary [config] parsing \
                        accepts; writing anything else would make the span unparseable."
            .into(),
        next_steps: vec![NextStep::Prose(
            "See git span show <name> for the current configuration.".into(),
        )],
    }
}

fn apply(config: SpanConfig, setting: Setting) -> SpanConfig {
    match setting {
        Setting::CopyDetection(v) => SpanConfig {
            copy_detection: v,
            ..config
        },
        Setting::IgnoreWhitespace(v) => SpanConfig {
            ignore_whitespace: v,
            ..config
        },
        Setting::FollowMoves(v) => SpanConfig {
            follow_moves: v,
            ..config
        },
    }
}

/// Render one field's value the way the span file writes it: quoted wire
/// name for `copy_detection`, bare boolean otherwise. Used for both the new
/// and the previous value so the transition report reads like the block.
fn render_field(config: &SpanConfig, key: &str) -> String {
    match key {
        "copy_detection" => format!("\"{}\"", config.copy_detection.wire_name()),
        "ignore_whitespace" => config.ignore_whitespace.to_string(),
        "follow_moves" => config.follow_moves.to_string(),
        // unreachable: parse_setting validated the key before any caller.
        _ => unreachable!("render_field called with a rejected key"),
    }
}
