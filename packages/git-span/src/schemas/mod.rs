//! Generator for the published JSON Schemas and the command reference page.
//!
//! The `gen-schemas` binary is a thin wrapper over [`run`]: both modes build
//! the same [`artifacts`] list, so generate and `--check` cannot disagree —
//! generate writes every artifact, `--check` byte-compares every artifact
//! against its committed file (a missing file counts as stale) and exits 1
//! after reporting all failures.
//!
//! Two artifact families share this module:
//!
//! - **Schemas** — one JSON Schema per versioned `--format json` family,
//!   derived from the same Rust types that serialize the CLI output, with
//!   `$id` equal to the family's stable URL (`https://git-span.com/schemas/
//!   cli/v{family_url_version}/{family}.json`).
//! - **The command reference** — `commands.mdx`, rendered from the clap
//!   [`CommandFactory`](clap::CommandFactory) tree, so no hand-written copy
//!   of the command surface exists anywhere.

use std::path::{Path, PathBuf};

use clap::CommandFactory as _;
use schemars::generate::SchemaSettings;
use schemars::json_schema;
use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde_json::Value as JsonValue;

/// A generated file the CLI owns.
///
/// `path` is relative to the website package directory (resolved by the
/// `gen-schemas` binary, overridable via argv); `content` is the exact byte
/// string written in generate mode and compared in `--check` mode.
pub struct Artifact {
    /// Human-readable name used in staleness messages (`commands.mdx`,
    /// `schema drift`).
    pub label: String,
    /// Artifact path relative to the website package directory.
    pub path: PathBuf,
    /// Exact file contents.
    pub content: String,
}

/// The five versioned `--format json` families published at stable URLs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Family {
    Mutation,
    Resolve,
    Context,
    History,
    Drift,
}

impl Family {
    /// The URL path segment naming this family.
    pub fn key(self) -> &'static str {
        match self {
            Family::Mutation => "mutation",
            Family::Resolve => "resolve",
            Family::Context => "context",
            Family::History => "history",
            Family::Drift => "drift",
        }
    }
}

/// The URL version for a family, from an explicit mapping — never inferred
/// from the artifact path string, so a published URL's meaning is a declared
/// fact rather than an accident of file layout. All five families publish at
/// `v1`; a breaking change bumps a family's entry here and lands the new
/// schema at a new path, leaving the old URL's bytes untouched.
pub fn family_url_version(family: &Family) -> u32 {
    match family {
        Family::Mutation
        | Family::Resolve
        | Family::Context
        | Family::History
        | Family::Drift => 1,
    }
}

/// The stable `$id` URL for a family's schema.
pub fn family_schema_url(family: &Family) -> String {
    format!(
        "https://git-span.com/schemas/cli/v{}/{}.json",
        family_url_version(family),
        family.key()
    )
}

/// One row of the static subcommand ↔ family mapping.
pub struct JsonCommandMapping {
    /// clap subcommand name.
    pub subcommand: &'static str,
    /// The published family this subcommand's `--format json` output belongs
    /// to, or `None` for the unversioned emitters.
    pub family: Option<Family>,
}

/// Every subcommand that accepts `--format json`, mapped to its published
/// family. The `None` rows are the unversioned emitters (`replace`, `tree`):
/// publishing them would require adding a `schema_version` key to their
/// output, which is a change to an existing output shape and therefore out
/// of scope — they stay unversioned and the reference page states it.
///
/// The table is exhaustive by contract: a new JSON-capable subcommand
/// absent from this table fails the mapping test rather than silently
/// skipping publication.
pub fn json_command_mappings() -> &'static [JsonCommandMapping] {
    &[
        JsonCommandMapping {
            subcommand: "add",
            family: Some(Family::Mutation),
        },
        JsonCommandMapping {
            subcommand: "why",
            family: Some(Family::Mutation),
        },
        JsonCommandMapping {
            subcommand: "resolve",
            family: Some(Family::Resolve),
        },
        JsonCommandMapping {
            subcommand: "context",
            family: Some(Family::Context),
        },
        JsonCommandMapping {
            subcommand: "history",
            family: Some(Family::History),
        },
        JsonCommandMapping {
            subcommand: "drift",
            family: Some(Family::Drift),
        },
        JsonCommandMapping {
            subcommand: "replace",
            family: None,
        },
        JsonCommandMapping {
            subcommand: "tree",
            family: None,
        },
    ]
}

/// Widen a subschema with an explicit null alternative.
///
/// For keys that are **always emitted** (never `skip_serializing_if`-skipped)
/// but hold `null` when absent — drift's `source`, `current`,
/// `auto_followed`, and friends. `#[schemars(required)]` alone marks the key
/// required but wrongly strips nullability, so the recipe is
/// `#[schemars(required, schema_with = "crate::schemas::nullable_schema::<T>")]`
/// on an `Option<T>` field, yielding `anyOf [inner, {type: null}]` with the
/// key in `required` (settled by the schemars-derive-semantics spike).
pub fn nullable_schema<T: JsonSchema>(generator: &mut SchemaGenerator) -> Schema {
    let inner = generator.subschema_for::<T>();
    json_schema!({ "anyOf": [inner, { "type": "null" }] })
}

/// A permissive schema for payloads a family deliberately leaves
/// unconstrained (context's `ContentUnavailable.detail` blob): the boolean
/// `true` schema accepts any value.
pub fn any_schema(_generator: &mut SchemaGenerator) -> Schema {
    json_schema!(true)
}

/// Derive one family's root schema from its serialization-shaped document
/// type — the same types that produce the CLI's bytes, so the schema cannot
/// describe an output shape the binary does not emit.
fn family_schema(family: &Family) -> Schema {
    let generator = SchemaSettings::draft2020_12().into_generator();
    match family {
        Family::Mutation => {
            generator.into_root_schema_for::<crate::cli::commit::MutationDocument>()
        }
        Family::Resolve => {
            generator.into_root_schema_for::<crate::cli::resolve::ResolveFamilyDoc>()
        }
        Family::Context => {
            generator.into_root_schema_for::<crate::cli::context::ContextDocument>()
        }
        Family::History => {
            generator.into_root_schema_for::<crate::cli::history::HistoryDocument>()
        }
        Family::Drift => {
            generator.into_root_schema_for::<crate::cli::drift_output::DriftDocument>()
        }
    }
}

/// Build every artifact the generator owns, in both modes.
///
/// Fail-closed guards fire here (not in the binary), so they hold in
/// generate mode and `--check` mode alike: the schema non-vacuity and
/// mapping tests, and the commands.mdx renderer's own guards (visible-
/// subcommand bijection, description non-vacuity, MDX escape checks).
pub fn artifacts() -> Vec<Artifact> {
    let mut artifacts = Vec::new();
    for family in [
        Family::Mutation,
        Family::Resolve,
        Family::Context,
        Family::History,
        Family::Drift,
    ] {
        let mut schema = family_schema(&family);
        // `$id` is the family's stable URL; schemars emits `$schema`
        // (draft 2020-12) itself but never an id.
        schema.insert(
            "$id".to_owned(),
            JsonValue::String(family_schema_url(&family)),
        );
        let content = serde_json::to_string_pretty(&schema)
            .expect("a generated schema is always JSON-serializable")
            + "\n";
        artifacts.push(Artifact {
            label: format!("schema {}", family.key()),
            path: PathBuf::from(format!(
                "public/schemas/cli/v{}/{}.json",
                family_url_version(&family),
                family.key()
            )),
            content,
        });
    }
    artifacts.push(Artifact {
        label: "commands.mdx".to_owned(),
        path: PathBuf::from("content/docs/commands.mdx"),
        content: commands_mdx(),
    });
    artifacts
}

/// Generate mode writes every artifact; `--check` byte-compares every
/// artifact against its committed file and fails when any is stale.
pub fn run(check: bool, website_dir: &Path) -> anyhow::Result<()> {
    let artifacts = artifacts();
    let mut stale: Vec<&Artifact> = Vec::new();
    for artifact in &artifacts {
        let target = website_dir.join(&artifact.path);
        if check {
            let matches = std::fs::read_to_string(&target)
                .map(|committed| committed == artifact.content)
                .unwrap_or(false);
            if !matches {
                stale.push(artifact);
            }
        } else if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
            std::fs::write(&target, &artifact.content)?;
        }
    }
    if !stale.is_empty() {
        let count = stale.len();
        for artifact in stale {
            eprintln!("{} is stale; run yarn build:schemas", artifact.label);
        }
        anyhow::bail!("{count} artifact(s) stale");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Command reference (commands.mdx) rendering
// ---------------------------------------------------------------------------

/// Static frontmatter, generated-page marker, and Global-options prose for
/// the command reference. The bare-invocation sentence records verified
/// behavior: `main` prints the command help and exits 0 when invoked with
/// no arguments; `git span list` with no targets lists every span.
const COMMANDS_MDX_HEADER: &str = "\
---
title: Command reference
description: Every git-span subcommand, grouped by task, with flags and exit behavior.
---

{/* GENERATED by gen-schemas. Do not edit by hand. */}

## Global options

Every subcommand accepts:

- `--perf` — emit performance timings for major git-span operation groups to stderr. Can also be enabled with `GIT_SPAN_PERF=1`.
- `-h`, `--help` — print help (a summary with `-h`, full help with `--help`).
- `-V`, `--version` — print the version (top-level only).

Bare `git span` with no arguments prints help and exits 0 — it does not list every span. Run `git span list` with no arguments for that. Any clap usage error (bad flag, missing required argument) exits 2.

";

/// Static assignment of subcommands to the page's task groups, in page
/// order. Fail-closed: every visible subcommand must appear exactly once
/// (checked in the group-table bijection test), so a new subcommand cannot
/// ship without a home on the reference page.
const SECTION_GROUPS: &[(&str, &[&str])] = &[
    (
        "Declare and edit",
        &["add", "remove", "replace", "why", "delete"],
    ),
    ("Inspect", &["show", "list", "tree", "history", "context"]),
    (
        "Audit and automate",
        &["drift", "doctor", "merge-driver", "resolve"],
    ),
];

/// The subcommands the page renders: everything visible, minus clap's
/// auto-generated `help` subcommand (documented in the Global-options
/// prose). Hidden subcommands (`__context-service`) are excluded by design.
fn visible_subcommands(cmd: &clap::Command) -> Vec<clap::Command> {
    cmd.get_subcommands()
        .filter(|sub| !sub.is_hide_set() && sub.get_name() != "help")
        .cloned()
        .collect()
}

/// Throw on prose a markdown/MDX pipeline would misparse: a raw `{`, `}`,
/// `<`, or `>` outside a code span parses as JSX or an expression in MDX
/// and silently vanishes (the sibling repo's markdownCell lesson). Code
/// spans and fenced blocks are exempt — their content is verbatim.
///
/// Fences obey the doc-comment convention clap can preserve: clap joins
/// the lines of a paragraph with spaces, so every fence marker and every
/// code line must be its own paragraph (`\n\n`-separated). A fence
/// paragraph is exactly ` ``` ` (close) or ` ```lang ` (open, with an
/// alphanumeric language id — anything else would be MDX expression or
/// comment syntax); a fence marker glued to prose, an opener inside a
/// fenced block, an unclosed fence, or an unbalanced backtick run all
/// panic, so a doc-comment edit cannot silently ship mangled markup.
/// Whether the site's highlighter can register a given language id is
/// enforced where the highlighter lives: the website suite fails loudly
/// on an unknown id rather than rendering it silently.
fn mdx_prose(owner: &str, text: &str) -> String {
    let mut in_fence = false;
    let mut in_code = false;
    for line in text.split_inclusive('\n') {
        let line = line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if trimmed == "```" {
                assert!(
                    in_fence,
                    "commands.mdx renderer: {owner} has a closing fence with no opener"
                );
                in_fence = false;
            } else {
                assert!(
                    !in_fence,
                    "commands.mdx renderer: {owner} nests a fence opener inside a fenced block"
                );
                let lang = trimmed.strip_prefix("```").expect("starts_with checked above");
                assert!(
                    lang.chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                    "commands.mdx renderer: {owner} fence opener `{trimmed}` must be ```` ```lang ```` with an alphanumeric language id"
                );
                in_fence = true;
            }
            continue;
        }
        if in_fence {
            continue;
        }
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '`' {
                let mut run = 1;
                while chars.peek() == Some(&'`') {
                    chars.next();
                    run += 1;
                }
                assert!(
                    run < 3,
                    "commands.mdx renderer: {owner} has a fence marker glued to prose — \
                     every fence line must be its own paragraph"
                );
                if run % 2 == 1 {
                    in_code = !in_code;
                }
                continue;
            }
            if !in_code && matches!(c, '{' | '}' | '<' | '>') {
                panic!(
                    "commands.mdx renderer: {owner} contains an unescaped `{c}` — \
                     wrap the span in backticks"
                );
            }
        }
    }
    assert!(
        !in_code,
        "commands.mdx renderer: {owner} has an unbalanced backtick run"
    );
    assert!(
        !in_fence,
        "commands.mdx renderer: {owner} has an unclosed fenced block"
    );
    text.to_string()
}

/// Render description prose with two doc-comment conventions:
/// - a paragraph beginning with `WARNING:` becomes a Fumadocs warn Callout;
/// - fence paragraphs — ` ``` ` (close) and ` ```lang ` (open), each its
///   own paragraph because clap joins paragraph lines with spaces —
///   reconstruct a fenced code block, one paragraph per code line.
fn render_prose_paragraphs(owner: &str, text: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for paragraph in text.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        if paragraph.starts_with("```") {
            if paragraph == "```" {
                out.push_str("```\n\n");
                in_fence = false;
            } else {
                out.push_str(paragraph);
                out.push('\n');
                in_fence = true;
            }
            continue;
        }
        if in_fence {
            out.push_str(paragraph);
            out.push('\n');
            continue;
        }
        if let Some(rest) = paragraph.strip_prefix("WARNING:") {
            out.push_str("<Callout type=\"warn\">\n");
            out.push_str(rest.trim());
            out.push_str("\n</Callout>\n\n");
        } else {
            out.push_str(paragraph);
            out.push_str("\n\n");
        }
    }
    debug_assert!(!out.is_empty(), "empty prose for {owner}");
    out
}

/// The page's usage fence line: clap's rendered usage for the subcommand,
/// expressed as `git span ...` (the invocation users actually type).
fn subcommand_usage(sub: &clap::Command) -> String {
    // A bare subcommand clone renders usage without its own name, so the
    // bin name carries it: "git span add <name> <anchors>...".
    let usage = sub
        .clone()
        .bin_name(format!("git span {}", sub.get_name()))
        .render_usage()
        .to_string();
    let usage = usage
        .strip_prefix("Usage: ")
        .unwrap_or(&usage)
        .to_string();
    assert!(
        usage.starts_with("git span "),
        "unexpected usage shape for `{}`: {usage}",
        sub.get_name()
    );
    usage
}

/// The Flag column for one row of a subcommand's flags table: clap's value
/// name (or the joined possible values for a value-enum flag) inside angle
/// brackets, all backtick-wrapped.
fn flag_cell(arg: &clap::Arg) -> String {
    let mut flags: Vec<String> = Vec::new();
    if let Some(short) = arg.get_short() {
        flags.push(format!("-{short}"));
    }
    if let Some(long) = arg.get_long() {
        flags.push(format!("--{long}"));
    }
    assert!(
        !flags.is_empty(),
        "flag cell for positional arg `{}`",
        arg.get_id()
    );
    // SetTrue actions (boolean flags) take no value — clap still reports
    // `<true|false>` possible values for them, so gate on takes_values.
    let possible_values = arg.get_possible_values();
    let placeholder = if !arg.get_action().takes_values() {
        String::new()
    } else if !possible_values.is_empty() {
        let values: Vec<&str> = possible_values
            .iter()
            .map(|possible| possible.get_name())
            .collect();
        // `\|` inside the backticked cell renders as a literal `|` but cannot
        // terminate the table cell; an unescaped pipe breaks the row and
        // leaves MDX parsing a stray `<value` tag fragment.
        format!("<{}>", values.join("\\|"))
    } else {
        arg.get_value_names()
            .and_then(|names| names.first())
            .map(|name| format!("<{name}>"))
            .unwrap_or_default()
    };
    if placeholder.is_empty() {
        format!("`{}`", flags.join(", "))
    } else {
        format!("`{} {placeholder}`", flags.join(", "))
    }
}

/// The Description column: the arg's full help text, escape-checked, with
/// paragraph breaks as `<br />` (tables cannot hold paragraphs) and `|`
/// escaped so the cell cannot break the table.
fn flag_description(arg: &clap::Arg) -> String {
    let owner = format!("the `--{}` help", arg.get_id());
    let text = arg
        .get_long_help()
        .or_else(|| arg.get_help())
        .unwrap_or_else(|| panic!("commands.mdx renderer: flag `{}` has no help text", arg.get_id()))
        .to_string();
    mdx_prose(&owner, &text);
    text.replace("\n\n", " <br /> ")
        .replace('\n', " ")
        .replace('|', "\\|")
}

/// The prose body of one subcommand section: its long description, with
/// WARNING paragraphs rendered as Callouts.
fn subcommand_prose(sub: &clap::Command) -> String {
    let owner = format!("`git span {}` description", sub.get_name());
    let text = sub
        .get_long_about()
        .or_else(|| sub.get_about())
        .unwrap_or_else(|| {
            panic!("commands.mdx renderer: subcommand `{}` has no description", sub.get_name())
        })
        .to_string();
    assert!(
        !text.trim().is_empty(),
        "commands.mdx renderer: subcommand `{}` has an empty description",
        sub.get_name()
    );
    mdx_prose(&owner, &text);
    render_prose_paragraphs(&owner, &text)
}

/// One subcommand section: usage fence, description prose (with Callouts),
/// then a flags table over the command's non-positional, non-hidden,
/// non-global arguments.
fn render_subcommand_section(sub: &clap::Command) -> String {
    let name = sub.get_name();
    let mut out = String::new();
    out.push_str(&format!("### {name}\n\n"));
    out.push_str("```bash\n");
    out.push_str(&subcommand_usage(sub));
    out.push_str("\n```\n\n");
    out.push_str(&subcommand_prose(sub));
    let mut rows: Vec<(String, String)> = Vec::new();
    for arg in sub.get_arguments() {
        if arg.is_hide_set() || arg.is_global_set() {
            continue;
        }
        if matches!(arg.get_id().as_str(), "help" | "version") {
            continue;
        }
        if arg.get_long().is_none() && arg.get_short().is_none() {
            continue; // positional — named in the usage fence
        }
        rows.push((flag_cell(arg), flag_description(arg)));
    }
    if !rows.is_empty() {
        out.push_str("Key flags:\n\n| Flag | Description |\n|------|-------------|\n");
        for (flag, description) in rows {
            out.push_str(&format!("| {flag} | {description} |\n"));
        }
        out.push('\n');
    }
    out
}

/// Render the generated command reference page from the clap tree.
///
/// Fail-closed guards: the static group table must biject with the visible
/// subcommands (both directions — a new subcommand without a group row, or
/// a group row naming a missing or hidden subcommand, panics here), and
/// every rendered subcommand and flag description must survive the MDX
/// escape checks above.
fn commands_mdx() -> String {
    let cmd = crate::cli::Cli::command();
    let visible = visible_subcommands(&cmd);
    assert!(
        !visible.is_empty(),
        "commands.mdx renderer: the command tree has no visible subcommands"
    );
    let mut rendered_names: Vec<&str> = Vec::new();
    for (_, subs) in SECTION_GROUPS {
        rendered_names.extend_from_slice(subs);
    }
    let mut expected: Vec<&str> = visible.iter().map(|sub| sub.get_name()).collect();
    let mut actual = rendered_names.clone();
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(
        actual, expected,
        "commands.mdx renderer: SECTION_GROUPS must name exactly the visible subcommands"
    );

    let mut out = String::from(COMMANDS_MDX_HEADER);
    for (group, subs) in SECTION_GROUPS {
        out.push_str(&format!("## {group}\n\n"));
        for name in *subs {
            let sub = cmd
                .find_subcommand(name)
                .unwrap_or_else(|| panic!("unknown subcommand `{name}` in SECTION_GROUPS"));
            out.push_str(&render_subcommand_section(sub));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping_table_has_no_duplicate_subcommands() {
        let mappings = json_command_mappings();
        let mut names: Vec<&str> = mappings.iter().map(|m| m.subcommand).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), mappings.len(), "duplicate subcommand row");
    }

    #[test]
    fn mapping_table_covers_all_eight_json_emitters() {
        assert_eq!(json_command_mappings().len(), 8);
    }

    #[test]
    fn replace_and_tree_are_unversioned() {
        for name in ["replace", "tree"] {
            let row = json_command_mappings()
                .iter()
                .find(|m| m.subcommand == name)
                .expect("row exists");
            assert!(row.family.is_none(), "{name} must stay unversioned");
        }
    }

    #[test]
    fn every_versioned_family_publishes_v1() {
        for family in json_command_mappings().iter().filter_map(|m| m.family) {
            assert_eq!(family_url_version(&family), 1);
        }
    }

    #[test]
    fn schema_urls_are_stable() {
        assert_eq!(
            family_schema_url(&Family::Mutation),
            "https://git-span.com/schemas/cli/v1/mutation.json"
        );
        assert_eq!(
            family_schema_url(&Family::Drift),
            "https://git-span.com/schemas/cli/v1/drift.json"
        );
    }

    #[test]
    fn artifacts_are_deterministic_across_runs() {
        let first = artifacts();
        let second = artifacts();
        assert_eq!(first.len(), second.len());
        for (a, b) in first.iter().zip(&second) {
            assert_eq!(a.label, b.label);
            assert_eq!(a.path, b.path);
            assert_eq!(
                a.content, b.content,
                "{} content differs across two generation runs",
                a.label
            );
        }
    }

    #[test]
    fn artifacts_land_at_their_committed_paths() {
        let mut paths: Vec<String> = artifacts()
            .iter()
            .map(|a| a.path.to_str().expect("utf8 path").to_string())
            .collect();
        paths.sort_unstable();
        let mut expected: Vec<String> = ["context", "drift", "history", "mutation", "resolve"]
            .into_iter()
            .map(|key| format!("public/schemas/cli/v1/{key}.json"))
            .collect();
        expected.push("content/docs/commands.mdx".to_string());
        expected.sort_unstable();
        assert_eq!(paths, expected);
    }

    #[test]
    fn every_schema_artifact_carries_its_family_id() {
        for artifact in artifacts()
            .into_iter()
            .filter(|a| a.label.starts_with("schema "))
        {
            let parsed: serde_json::Value =
                serde_json::from_str(&artifact.content).expect("artifact is valid JSON");
            let id = parsed["$id"].as_str().expect("schema has a string $id");
            assert!(
                id.starts_with("https://git-span.com/schemas/cli/v1/")
                    && id.ends_with(".json"),
                "unexpected $id {id}"
            );
        }
    }

    #[test]
    fn mapping_table_is_a_bijection_with_the_clap_tree() {
        use clap::CommandFactory as _;
        let cmd = crate::cli::Cli::command();
        let mut json_subcommands: Vec<String> = cmd
            .get_subcommands()
            .filter(|sub| {
                sub.get_arguments().any(|arg| {
                    arg.get_id() == "format"
                        && arg
                            .get_possible_values()
                            .iter()
                            .any(|possible| possible.get_name() == "json")
                })
            })
            .map(|sub| sub.get_name().to_string())
            .collect();
        json_subcommands.sort_unstable();

        let mut table: Vec<String> = json_command_mappings()
            .iter()
            .map(|m| m.subcommand.to_string())
            .collect();
        table.sort_unstable();

        assert_eq!(
            json_subcommands, table,
            "the mapping table must name exactly the subcommands whose `--format` accepts json"
        );
    }

    #[test]
    fn versioned_rows_cover_each_family_exactly_once() {
        let mut families: Vec<Family> = json_command_mappings()
            .iter()
            .filter_map(|m| m.family)
            .collect();
        families.sort_by_key(|f| f.key());
        families.dedup();
        assert_eq!(
            families.len(),
            5,
            "each of the five families must be mapped by exactly one versioned row"
        );
    }

    // -----------------------------------------------------------------------
    // commands.mdx renderer
    // -----------------------------------------------------------------------

    fn commands_mdx_artifact() -> Artifact {
        artifacts()
            .into_iter()
            .find(|a| a.label == "commands.mdx")
            .expect("commands.mdx artifact exists")
    }

    #[test]
    fn generated_page_has_frontmatter_and_marker() {
        let page = commands_mdx_artifact().content;
        assert!(
            page.starts_with("---\ntitle: Command reference\n"),
            "page must carry the docs frontmatter; starts with {:.60}",
            page
        );
        assert!(
            page.contains("{/* GENERATED by gen-schemas. Do not edit by hand. */}"),
            "page must carry the generated-page marker"
        );
    }

    #[test]
    fn generated_page_covers_every_visible_subcommand_in_a_section() {
        let page = commands_mdx_artifact().content;
        let cmd = crate::cli::Cli::command();
        for sub in visible_subcommands(&cmd) {
            let name = sub.get_name();
            assert!(
                page.contains(&format!("### {name}\n")),
                "generated page lost the `{name}` section"
            );
        }
    }

    #[test]
    fn generated_page_excludes_hidden_subcommands() {
        let page = commands_mdx_artifact().content;
        assert!(
            !page.contains("__context-service"),
            "hidden subcommands must not appear on the reference page"
        );
    }

    #[test]
    fn generated_page_renders_usage_fences_as_git_span() {
        let page = commands_mdx_artifact().content;
        assert!(
            page.contains("```bash\ngit span add [OPTIONS] <NAME> <ANCHORS>...\n```"),
            "add's usage fence must read `git span add [OPTIONS] <NAME> <ANCHORS>...`; page:\n{page}"
        );
        assert!(
            page.contains("```bash\ngit span drift [OPTIONS] [PATHS]...\n```"),
            "drift's usage fence must keep its optional variadic paths"
        );
    }

    #[test]
    fn flag_cell_formats_possible_values_and_short_flags() {
        let cmd = crate::cli::Cli::command();
        let drift = cmd.find_subcommand("drift").expect("drift exists");
        let format = drift
            .get_arguments()
            .find(|a| a.get_id() == "format")
            .expect("format arg exists");
        assert_eq!(flag_cell(format), "`--format <human\\|porcelain\\|json>`");
        let tree = cmd.find_subcommand("tree").expect("tree exists");
        let depth = tree
            .get_arguments()
            .find(|a| a.get_id() == "depth")
            .expect("depth arg exists");
        assert_eq!(flag_cell(depth), "`-d, --depth <N>`");
    }

    #[test]
    fn flag_description_escapes_table_pipes() {
        let arg = clap::Arg::new("pipe").long("pipe").help("a | b");
        assert_eq!(flag_description(&arg), "a \\| b");
    }

    #[test]
    #[should_panic(expected = "unescaped `<`")]
    fn mdx_prose_throws_on_a_raw_angle_bracket() {
        mdx_prose("test", "anchors are <path> or <path>#L<start>-L<end>");
    }

    #[test]
    #[should_panic(expected = "unescaped `{`")]
    fn mdx_prose_throws_on_a_raw_brace() {
        mdx_prose("test", "emits { \"members\": [...] }");
    }

    #[test]
    fn mdx_prose_accepts_backticked_and_fenced_sigils() {
        assert_eq!(mdx_prose("test", "anchors are `<path>`"), "anchors are `<path>`");
        let fenced = "```gitattributes\n\n.span/** merge=span\n\n```\n";
        assert_eq!(mdx_prose("test", fenced), fenced);
    }

    #[test]
    #[should_panic(expected = "fence marker glued to prose")]
    fn mdx_prose_throws_on_a_fence_glued_to_prose() {
        mdx_prose("test", "Register in `.gitattributes`: ```gitattributes .span/** merge=span ```");
    }

    #[test]
    #[should_panic(expected = "alphanumeric language id")]
    fn mdx_prose_throws_on_a_non_alphanumeric_fence_language() {
        mdx_prose("test", "```{jsx}\n\nconst x = <A />;\n\n```\n");
    }

    #[test]
    #[should_panic(expected = "unbalanced backtick run")]
    fn mdx_prose_throws_on_an_unbalanced_backtick_run() {
        mdx_prose("test", "anchors are `<path>");
    }

    #[test]
    #[should_panic(expected = "unclosed fenced block")]
    fn mdx_prose_throws_on_an_unclosed_fenced_block() {
        mdx_prose("test", "```gitattributes\n\n.span/** merge=span\n");
    }

    #[test]
    fn render_prose_paragraphs_reconstructs_fenced_blocks() {
        let prose = "Register in `.gitattributes`:\n\n```gitattributes\n\n.span/** merge=span\n\n```\n\nRegister in `.git/config`:\n\n```ini\n\n[merge \"span\"]\n\nname = git-span structural span merge\n\ndriver = git span merge-driver %O %A %B %L\n\n```\n";
        let rendered = render_prose_paragraphs("test", prose);
        assert_eq!(
            rendered,
            "Register in `.gitattributes`:\n\n```gitattributes\n.span/** merge=span\n```\n\nRegister in `.git/config`:\n\n```ini\n[merge \"span\"]\nname = git-span structural span merge\ndriver = git span merge-driver %O %A %B %L\n```\n\n",
            "paragraph-per-line fences must reconstruct into fenced blocks"
        );
    }

    #[test]
    fn warning_paragraph_becomes_a_warn_callout() {
        let prose = "Report drift.\n\nWARNING: `--fix` re-anchors `Moved` anchors unconditionally.\n\nExit codes: 0 or 1.";
        let rendered = render_prose_paragraphs("test", prose);
        assert!(
            rendered.contains("<Callout type=\"warn\">\n`--fix` re-anchors `Moved` anchors unconditionally.\n</Callout>"),
            "WARNING: paragraphs must render as warn Callouts; got:\n{rendered}"
        );
        assert!(
            rendered.starts_with("Report drift.\n\n")
                && rendered.ends_with("Exit codes: 0 or 1.\n\n"),
            "non-WARNING paragraphs must pass through; got:\n{rendered}"
        );
    }

    #[test]
    fn generated_page_preserves_the_global_options_sentinel() {
        let page = commands_mdx_artifact().content;
        assert!(page.contains("it does not list every span"));
        assert!(page.contains("exits 2"));
    }

    /// Sentinel phrases in `commands_content.rs` may span wrapped source
    /// lines only if clap joins them with spaces in the stored help text.
    /// This probe pins that fact: fail here, and the sentinels must be
    /// rewritten onto single source lines.
    #[test]
    fn clap_joins_wrapped_doc_comment_lines_with_spaces() {
        let cmd = crate::cli::Cli::command();
        let add = cmd.find_subcommand("add").expect("add exists");
        let about = add.get_long_about().expect("add has a long description").to_string();
        assert!(
            about.contains("index changed during check) — retryable"),
            "clap must join wrapped doc lines with spaces; stored help:\n{about}"
        );
        let why = cmd.find_subcommand("why").expect("why exists");
        let about = why.get_long_about().expect("why has a long description").to_string();
        assert!(
            about.contains("read mode rejects it fail-closed (exit 1, no stdout)"),
            "clap must join wrapped doc lines with spaces; stored help:\n{about}"
        );
    }
}
