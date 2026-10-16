//! Generator for the `git-mora` manual pages and HTML help pages.
//!
//! Writes roff pages (`git-mora.1` and one per subcommand) into `argv[1]` and HTML pages into
//! `argv[2]`, defaulting to `$CARGO_MANIFEST_DIR/man` and `$CARGO_MANIFEST_DIR/doc`.
//! Run via `cargo run --bin gen-manpage -- [<man-dir> <html-dir>]`.

use std::path::PathBuf;

fn main() -> std::io::Result<()> {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_owned()));
    let mut args = std::env::args().skip(1).map(PathBuf::from);
    let man = args.next().unwrap_or_else(|| root.join("man"));
    let html = args.next().unwrap_or_else(|| root.join("doc"));
    git_mora::write_man_pages(&man)?;
    git_mora::write_html_pages(&html)
}
