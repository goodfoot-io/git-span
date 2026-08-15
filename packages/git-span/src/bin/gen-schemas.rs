//! Generator for the published JSON Schemas and the command reference page.
//!
//! Writes every artifact from [`git_span::schemas::artifacts`]; with
//! `--check`, byte-compares each artifact against its committed file and
//! exits 1 when any is stale.
//!
//! Artifacts resolve against the website package directory —
//! `$CARGO_MANIFEST_DIR/../website` by default, overridable via argv for
//! worktree-local runs.
//!
//! Run via `cargo run --bin gen-schemas -- [--check] [<website-dir>]`.

use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let mut check = false;
    let mut website_dir: Option<PathBuf> = None;
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--check" => check = true,
            other => website_dir = Some(PathBuf::from(other)),
        }
    }
    let website_dir = website_dir.unwrap_or_else(|| {
        let manifest_dir =
            std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(manifest_dir).join("..").join("website")
    });
    git_span::schemas::run(check, &website_dir)
}
