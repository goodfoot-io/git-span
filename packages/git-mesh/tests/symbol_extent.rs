//! Integration tests for the tree-sitter symbol enclosure resolver.

use std::path::PathBuf;

use git_mesh::advice::suggest::symbol_extent::enclosing_symbol_range;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("symbol_extent")
        .join(name)
}

#[test]
fn rust_inner_range_resolves_to_enclosing_function() {
    let path = fixture("rust_function.rs");
    let got = enclosing_symbol_range(&path, (15, 18))
        .expect("inner range inside `foo` should resolve to its enclosing function");
    assert_eq!(got.0, 10, "start matches `pub fn foo` line");
    assert_eq!(got.1, 25, "end matches function closing brace line");
    assert_eq!(got.2, "foo");
}

#[test]
fn rust_range_straddling_two_top_level_items_returns_none() {
    let path = fixture("rust_inner_block.rs");
    // Range spanning lines 3..=8 covers both `alpha` and `beta`.
    let got = enclosing_symbol_range(&path, (3, 8));
    assert!(
        got.is_none(),
        "range straddling two items must return None, got {:?}",
        got
    );
}

#[test]
fn typescript_arrow_function_resolves_to_lexical_declaration() {
    let path = fixture("typescript_class.ts");
    // Inner range inside the arrow function body.
    let got = enclosing_symbol_range(&path, (4, 7))
        .expect("inner range inside the arrow function should resolve");
    assert_eq!(got.0, 3, "start of `export const handler = ...`");
    assert_eq!(got.1, 9, "end of the lexical_declaration");
    assert_eq!(got.2, "handler");
}

#[test]
fn unknown_extension_returns_none() {
    let path = fixture("unknown_extension.txt");
    assert!(enclosing_symbol_range(&path, (1, 1)).is_none());
}

#[test]
fn missing_file_returns_none() {
    let path = fixture("does_not_exist.rs");
    assert!(enclosing_symbol_range(&path, (1, 5)).is_none());
}
