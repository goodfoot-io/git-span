//! Byte-fidelity gate for the published `--format json` families.
//!
//! The counterpart of `json_fixtures.rs`: where the capture test *writes*
//! `tests/fixtures/json/`, this test re-renders each family's scenario and
//! byte-compares against the committed fixture. A promotion or renderer
//! change that alters emitted bytes fails here in the normal suite — the
//! capture is `#[ignore]`-marked, so it can never silently rewrite its own
//! contract. When an intentional output change lands, regenerate the
//! fixtures with `yarn test -- --run-ignored ignored-only json_fixtures`
//! and commit both halves together.

use anyhow::Result;
use std::path::Path;

use super::json_fixtures::FIXTURE_DIR;

fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(FIXTURE_DIR)
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

fn assert_golden(name: &str, actual: Vec<u8>) {
    let expected = fixture_bytes(name);
    assert_eq!(
        String::from_utf8_lossy(&actual),
        String::from_utf8_lossy(&expected),
        "{} output drifted from the committed fixture; \
         regenerate with `yarn test -- --run-ignored ignored-only json_fixtures` \
         and commit both together",
        name
    );
}

#[test]
fn mutation_output_matches_fixture() -> Result<()> {
    assert_golden("mutation.json", super::json_fixtures::mutation_scenario()?);
    Ok(())
}

#[test]
fn resolve_output_matches_fixture() -> Result<()> {
    assert_golden("resolve.json", super::json_fixtures::resolve_scenario()?);
    Ok(())
}

#[test]
fn resolve_dry_run_output_matches_fixture() -> Result<()> {
    assert_golden(
        "resolve-dry-run.json",
        super::json_fixtures::resolve_dry_run_scenario()?,
    );
    Ok(())
}

#[test]
fn context_output_matches_fixture() -> Result<()> {
    assert_golden("context.json", super::json_fixtures::context_scenario()?);
    Ok(())
}

#[test]
fn history_output_matches_fixture() -> Result<()> {
    assert_golden("history.json", super::json_fixtures::history_scenario()?);
    Ok(())
}

#[test]
fn drift_output_matches_fixture() -> Result<()> {
    assert_golden("drift.json", super::json_fixtures::drift_dirty_scenario()?);
    Ok(())
}

#[test]
fn drift_clean_output_matches_fixture() -> Result<()> {
    assert_golden(
        "drift-clean.json",
        super::json_fixtures::drift_clean_scenario()?,
    );
    Ok(())
}
