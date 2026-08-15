//! Gate tests for the generated schema artifacts.
//!
//! `gen-schemas` builds an artifact list and either writes it (generate
//! mode) or byte-compares it against committed files (`--check` mode,
//! exit 1 with an `ERROR: {label} is stale; run yarn build:schemas` line per
//! stale artifact — the `ERROR:` token keeps the line in the validate
//! failure-summary tail). The temp-dir units below exercise both modes
//! against a throwaway tree; the committed-artifact check runs against the
//! real website package.

use assert_cmd::Command;
use predicates::prelude::PredicateBooleanExt;
use std::path::{Path, PathBuf};

const SCHEMA_DIR: &str = "public/schemas/cli/v1";

fn website_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("website")
}

fn gen_schemas(args: &[&str]) -> assert_cmd::Command {
    let mut cmd = Command::cargo_bin("gen-schemas").expect("gen-schemas binary not found");
    cmd.args(args);
    cmd
}

fn artifact_path(tree: &Path, name: &str) -> PathBuf {
    tree.join(SCHEMA_DIR).join(name)
}

#[test]
fn checked_in_schema_artifacts_are_fresh() {
    gen_schemas(&["--check"])
        .arg(website_dir())
        .assert()
        .success();
}

#[test]
fn check_passes_against_a_just_generated_tree() {
    let tmp = tempfile::tempdir().expect("tempdir");
    gen_schemas(&[tmp.path().to_str().expect("utf8 path")])
        .assert()
        .success();
    gen_schemas(&["--check", tmp.path().to_str().expect("utf8 path")])
        .assert()
        .success();
}

#[test]
fn check_reports_a_tampered_artifact_with_its_label() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let tree = tmp.path().to_str().expect("utf8 path");
    gen_schemas(&[tree]).assert().success();

    // Tamper one artifact; the other four must still verify.
    let mutation = artifact_path(tmp.path(), "mutation.json");
    let mut bytes = std::fs::read(&mutation).expect("read generated mutation schema");
    bytes.push(b' ');
    std::fs::write(&mutation, bytes).expect("tamper mutation schema");

    gen_schemas(&["--check", tree])
        .assert()
        .failure()
        .stderr(predicates::str::contains(
            "ERROR: schema mutation is stale; run yarn build:schemas",
        ))
        .stderr(predicates::str::contains("schema resolve").not());
}

#[test]
fn check_reports_a_missing_artifact_as_stale() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let tree = tmp.path().to_str().expect("utf8 path");
    gen_schemas(&[tree]).assert().success();

    std::fs::remove_file(artifact_path(tmp.path(), "drift.json")).expect("remove drift schema");

    gen_schemas(&["--check", tree])
        .assert()
        .failure()
        .stderr(predicates::str::contains(
            "ERROR: schema drift is stale; run yarn build:schemas",
        ));
}

#[test]
fn generate_rewrites_identical_bytes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let tree = tmp.path().to_str().expect("utf8 path");
    gen_schemas(&[tree]).assert().success();

    let schema_dir = tmp.path().join(SCHEMA_DIR);
    let first_pass: Vec<(PathBuf, Vec<u8>)> = std::fs::read_dir(&schema_dir)
        .expect("list schema dir")
        .map(|entry| {
            let path = entry.expect("dir entry").path();
            let bytes = std::fs::read(&path).expect("read schema");
            (path, bytes)
        })
        .collect();
    assert!(!first_pass.is_empty(), "generator wrote no schemas");

    std::fs::remove_dir_all(&schema_dir).expect("wipe schema dir");
    gen_schemas(&[tree]).assert().success();

    for (path, expected) in first_pass {
        let regenerated = std::fs::read(&path).expect("read regenerated schema");
        assert_eq!(
            regenerated, expected,
            "{} regenerated to different bytes",
            path.display()
        );
    }
}
