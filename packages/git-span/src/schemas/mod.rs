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

use schemars::json_schema;
use schemars::{JsonSchema, Schema, SchemaGenerator};

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

/// Build every artifact the generator owns, in both modes.
///
/// Fail-closed guards fire here (not in the binary), so they hold in
/// generate mode and `--check` mode alike.
pub fn artifacts() -> Vec<Artifact> {
    todo!("derive the five family schemas from the document types and render commands.mdx from the clap tree")
}

/// Generate mode writes every artifact; `--check` byte-compares every
/// artifact against its committed file and fails when any is stale.
pub fn run(check: bool, website_dir: &Path) -> anyhow::Result<()> {
    let _ = (check, website_dir, artifacts());
    todo!("write artifacts in generate mode; byte-compare and exit 1 on staleness in --check mode")
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
}
