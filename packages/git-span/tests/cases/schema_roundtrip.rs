//! Round-trip gate: real `--format json` stdout from the binary, validated
//! against the **committed** schema files with the `jsonschema` crate.
//!
//! This closes the loop the generator opens: the schemas are derived from
//! the same types that serialize the output, and this test proves that
//! claim against the actual bytes a user receives — a schema the binary
//! violates fails here, not at a consumer's validator.

use anyhow::{Result, bail};
use serde_json::Value;
use std::path::Path;

use super::json_fixtures;
use crate::support::TestRepo;

/// The committed schema root; URL versions are per-family and distinct from
/// the version of the wire document (for example, drift document v3 at URL v1).
const SCHEMA_ROOT: &str = "../website/public/schemas/cli";

fn committed_schema(family: &str, version: u64) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(SCHEMA_ROOT)
        .join(format!("v{version}"))
        .join(format!("{family}.json"));
    let bytes = std::fs::read(&path)
        .unwrap_or_else(|e| panic!("read committed schema {}: {e}", path.display()));
    serde_json::from_slice(&bytes).expect("committed schema is valid JSON")
}

fn validate_against(scenario: impl Fn() -> Result<Vec<u8>>, family: &str) -> Result<()> {
    let doc: Value = serde_json::from_slice(&scenario()?)?;
    let url_version = if family == "context" { 2 } else { 1 };
    let schema = committed_schema(family, url_version);
    let validator = jsonschema::validator_for(&schema).expect("committed schema compiles");
    if let Err(errors) = validator.validate(&doc) {
        bail!("{family} output invalid against the committed schema: {errors}");
    }
    Ok(())
}

macro_rules! roundtrip_test {
    ($name:ident, $scenario:ident, $family:literal) => {
        #[test]
        fn $name() -> Result<()> {
            validate_against(json_fixtures::$scenario, $family)
        }
    };
}

roundtrip_test!(mutation_roundtrip, mutation_scenario, "mutation");
roundtrip_test!(
    mutation_drift_remains_roundtrip,
    mutation_drift_remains_scenario,
    "mutation"
);
roundtrip_test!(resolve_roundtrip, resolve_scenario, "resolve");
roundtrip_test!(
    resolve_dry_run_roundtrip,
    resolve_dry_run_scenario,
    "resolve"
);
roundtrip_test!(context_roundtrip, context_scenario, "context");
roundtrip_test!(history_roundtrip, history_scenario, "history");
roundtrip_test!(drift_roundtrip, drift_dirty_scenario, "drift");
roundtrip_test!(drift_clean_roundtrip, drift_clean_scenario, "drift");

/// Negative control: prove the validator is actually engaged by removing a
/// required key from real output — it must reject the document.
#[test]
fn validator_rejects_a_document_missing_a_required_key() -> Result<()> {
    let schema = committed_schema("mutation", 1);
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

#[test]
fn context_v2_validator_rejects_a_span_without_evidence_revision() -> Result<()> {
    let schema = committed_schema("context", 2);
    let validator = jsonschema::validator_for(&schema).expect("committed schema compiles");
    let mut doc: Value = serde_json::from_slice(&json_fixtures::context_scenario()?)?;
    assert_eq!(doc["schema_version"], 2);
    doc["spans"][0]
        .as_object_mut()
        .expect("context span is an object")
        .remove("evidence_revision");
    assert!(
        validator.validate(&doc).is_err(),
        "context v2 requires an evidence revision"
    );
    Ok(())
}

#[test]
fn staged_preflight_validates_against_its_published_schema() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let validator = jsonschema::validator_for(&committed_schema("preflight", 1))?;
    let preflight: Value =
        serde_json::from_str(&repo.span_stdout(["preflight", "--format", "json"])?)?;
    validator
        .validate(&preflight)
        .expect("real preflight output matches schema");
    repo.span_stdout(["add", "schema-contract", "file1.txt#L1-L3"])?;
    repo.commit_all("declare staged obligation")?;
    repo.run_git(["rm", "--cached", "file1.txt"])?;
    let missing: Value =
        serde_json::from_str(&repo.span_stdout(["preflight", "--format", "json"])?)?;
    assert_eq!(
        missing["obligations"][0]["anchors"][0]["blob_oid"],
        Value::Null
    );
    assert_eq!(missing["obligations"][0]["anchors"][0]["present"], false);
    validator
        .validate(&missing)
        .expect("missing staged blobs remain schema-valid");
    repo.run_git(["rm", "--cached", ".span/schema-contract"])?;
    let removed: Value =
        serde_json::from_str(&repo.span_stdout(["preflight", "--format", "json"])?)?;
    assert_eq!(removed["removed_spans"][0]["name"], "schema-contract");
    validator
        .validate(&removed)
        .expect("removed obligations remain schema-valid");
    let mut invalid = preflight;
    invalid
        .as_object_mut()
        .expect("preflight envelope")
        .remove("evidence_revision");
    assert!(validator.validate(&invalid).is_err());
    Ok(())
}
