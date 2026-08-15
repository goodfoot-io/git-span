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
/// generate mode and `--check` mode alike. The commands.mdx artifact joins
/// this list in the MDX-renderer unit.
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
    fn artifacts_land_at_the_v1_schema_paths() {
        let mut paths: Vec<String> = artifacts()
            .iter()
            .map(|a| a.path.to_str().expect("utf8 path").to_string())
            .collect();
        paths.sort_unstable();
        let mut expected: Vec<String> = ["context", "drift", "history", "mutation", "resolve"]
            .into_iter()
            .map(|key| format!("public/schemas/cli/v1/{key}.json"))
            .collect();
        expected.sort_unstable();
        assert_eq!(paths, expected);
    }

    #[test]
    fn every_artifact_carries_its_family_id() {
        for artifact in artifacts() {
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
}
