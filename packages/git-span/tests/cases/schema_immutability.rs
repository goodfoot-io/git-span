//! Immutability gate for the published v1 schemas.
//!
//! Once published, `https://git-span.com/schemas/cli/v1/*.json` is frozen:
//! the committed `sha256-manifest.txt` beside the schemas records each
//! file's digest, and this test recomputes and compares. The manifest is
//! **not** a generator artifact — it never enters the artifact list and is
//! never regenerated — and this test is manifest-driven (every entry must
//! exist and digest-match, and the five family names must all be present),
//! not glob-driven, so a v1 file deleted on a future family bump fails
//! loudly instead of silently shrinking the corpus. A breaking change
//! lands at a `v2` path; the v1 bytes stay byte-for-byte what they were.
//!
//! `#[ignore]`-marked until the first real generation run commits the
//! manifest; unskipped in the wiring unit.

use sha2::{Digest, Sha256};
use std::path::Path;

/// The committed v1 schema directory, relative to the git-span package.
const SCHEMA_DIR: &str = "../website/public/schemas/cli/v1";

const FAMILIES: [&str; 5] = ["context", "drift", "history", "mutation", "resolve"];

#[test]
#[ignore = "unskipped after the first real generation run commits the digest manifest"]
fn every_published_schema_digest_matches_the_manifest() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(SCHEMA_DIR);
    let manifest_path = dir.join("sha256-manifest.txt");
    let manifest = std::fs::read_to_string(&manifest_path)
        .unwrap_or_else(|e| panic!("read manifest {}: {e}", manifest_path.display()));

    let mut covered: Vec<&str> = Vec::new();
    for line in manifest.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (hex, name) = line
            .split_once("  ")
            .unwrap_or_else(|| panic!("manifest line must be `<hex>  <filename>`: {line}"));
        let bytes = std::fs::read(dir.join(name))
            .unwrap_or_else(|e| panic!("manifest entry {name} does not exist: {e}"));
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let digest = format!("{:x}", hasher.finalize());
        assert_eq!(
            digest, hex,
            "{name} digest mismatch — published schema bytes must never change"
        );
        covered.push(name);
    }

    covered.sort_unstable();
    let mut expected: Vec<String> = FAMILIES.iter().map(|f| format!("{f}.json")).collect();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "the manifest must cover exactly the five published v1 schemas"
    );
}
