//! Round-trip gate: real `--format json` stdout from the binary, validated
//! against the **committed** schema files with the `jsonschema` crate.
//!
//! This closes the loop the generator opens: the schemas are derived from
//! the same types that serialize the output, and this test proves that
//! claim against the actual bytes a user receives — a schema the binary
//! violates fails here, not at a consumer's validator.
//!
//! `#[ignore]`-marked until the first real generation run commits
//! `packages/website/public/schemas/cli/v1/`; unskipped in the wiring unit.

use anyhow::{bail, Result};
use serde_json::Value;
use std::path::Path;

use super::json_fixtures;

/// The committed v1 schema directory, relative to the git-span package.
const SCHEMA_ROOT: &str = "../website/public/schemas/cli/v1";

fn committed_schema(family: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(SCHEMA_ROOT)
        .join(format!("{family}.json"));
    let bytes = std::fs::read(&path)
        .unwrap_or_else(|e| panic!("read committed schema {}: {e}", path.display()));
    serde_json::from_slice(&bytes).expect("committed schema is valid JSON")
}

fn validate_against(scenario: impl Fn() -> Result<Vec<u8>>, family: &str) -> Result<()> {
    let schema = committed_schema(family);
    let validator = jsonschema::validator_for(&schema).expect("committed schema compiles");
    let doc: Value = serde_json::from_slice(&scenario()?)?;
    if let Err(errors) = validator.validate(&doc) {
        bail!("{family} output invalid against the committed schema: {errors}");
    }
    Ok(())
}

macro_rules! roundtrip_test {
    ($name:ident, $scenario:ident, $family:literal) => {
        #[test]
        #[ignore = "unskipped after the first real generation run commits the schemas"]
        fn $name() -> Result<()> {
            validate_against(json_fixtures::$scenario, $family)
        }
    };
}

roundtrip_test!(mutation_roundtrip, mutation_scenario, "mutation");
roundtrip_test!(resolve_roundtrip, resolve_scenario, "resolve");
roundtrip_test!(resolve_dry_run_roundtrip, resolve_dry_run_scenario, "resolve");
roundtrip_test!(context_roundtrip, context_scenario, "context");
roundtrip_test!(history_roundtrip, history_scenario, "history");
roundtrip_test!(drift_roundtrip, drift_dirty_scenario, "drift");
roundtrip_test!(drift_clean_roundtrip, drift_clean_scenario, "drift");

/// Negative control: prove the validator is actually engaged by removing a
/// required key from real output — it must reject the document.
#[test]
#[ignore = "unskipped after the first real generation run commits the schemas"]
fn validator_rejects_a_document_missing_a_required_key() -> Result<()> {
    let schema = committed_schema("mutation");
    let validator = jsonschema::validator_for(&schema).expect("committed schema compiles");
    let mut doc: Value = serde_json::from_slice(&json_fixtures::mutation_scenario()?)?;
    doc.as_object_mut()
        .expect("mutation document is an object")
        .remove("span_health");
    assert!(
        validator.validate(&doc).is_err(),
        "validator must reject a mutation document without the required span_health key"
    );
    Ok(())
}
