//! Symbol-level enclosure resolver.
//!
//! Given an absolute path on disk and an inner `(start, end)` line range,
//! returns the smallest top-level item (function, impl, struct, …) that
//! fully contains the range — used by `resolve_extent_precedence` to
//! promote ranged `Edit`/`Read` participants to `ExtentSource::Symbol`.
//!
//! Failure modes (parse error, missing file, unsupported language,
//! range spanning multiple top-level items) silently return `None`.

use std::fs;
use std::path::Path;

use tree_sitter::{Language, Node, Parser};

/// Languages this resolver knows how to dispatch.
enum Lang {
    Rust,
    TypeScript,
    Tsx,
}

fn detect_lang(abs_path: &Path) -> Option<Lang> {
    let ext = abs_path.extension()?.to_str()?;
    match ext {
        "rs" => Some(Lang::Rust),
        "ts" | "mts" => Some(Lang::TypeScript),
        "tsx" => Some(Lang::Tsx),
        _ => None,
    }
}

fn language_for(lang: &Lang) -> Language {
    match lang {
        Lang::Rust => tree_sitter_rust::language(),
        Lang::TypeScript => tree_sitter_typescript::language_typescript(),
        Lang::Tsx => tree_sitter_typescript::language_tsx(),
    }
}

/// Top-level kinds we treat as candidate enclosing items, by language.
fn is_top_level_item(lang: &Lang, kind: &str) -> bool {
    match lang {
        Lang::Rust => matches!(
            kind,
            "function_item" | "impl_item" | "struct_item" | "enum_item" | "trait_item"
        ),
        Lang::TypeScript | Lang::Tsx => matches!(
            kind,
            "function_declaration"
                | "class_declaration"
                | "method_definition"
                | "lexical_declaration"
        ),
    }
}

/// Extract a human-readable name from a top-level item node, if available.
fn item_name(node: Node, source: &[u8]) -> String {
    if let Some(n) = node.child_by_field_name("name")
        && let Ok(s) = n.utf8_text(source)
    {
        return s.to_string();
    }
    // lexical_declaration: dig into variable_declarator -> name
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator"
            && let Some(n) = child.child_by_field_name("name")
            && let Ok(s) = n.utf8_text(source)
        {
            return s.to_string();
        }
    }
    String::new()
}

/// Unwrap a TypeScript `export_statement` to its inner declaration so the
/// caller can match against `function_declaration`, `class_declaration`,
/// `lexical_declaration`, etc. Returns the node unchanged for other kinds
/// or for non-TS languages.
fn unwrap_export<'a>(lang: &Lang, node: Node<'a>) -> Node<'a> {
    if !matches!(lang, Lang::TypeScript | Lang::Tsx) {
        return node;
    }
    if node.kind() != "export_statement" {
        return node;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let k = child.kind();
        if matches!(
            k,
            "function_declaration"
                | "class_declaration"
                | "method_definition"
                | "lexical_declaration"
        ) {
            return child;
        }
    }
    node
}

/// For TS `lexical_declaration`, only count it as a candidate when its
/// initializer is an `arrow_function` (matches the plan's spec).
fn lexical_declaration_is_arrow(node: Node) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator"
            && let Some(value) = child.child_by_field_name("value")
            && value.kind() == "arrow_function"
        {
            return true;
        }
    }
    false
}

/// See module docs.
pub fn enclosing_symbol_range(abs_path: &Path, inner: (u32, u32)) -> Option<(u32, u32, String)> {
    let (in_start, in_end) = inner;
    if in_start == 0 || in_end == 0 || in_start > in_end {
        return None;
    }

    let lang = detect_lang(abs_path)?;
    let source = fs::read(abs_path).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language_for(&lang)).ok()?;
    let tree = parser.parse(&source, None)?;
    let root = tree.root_node();

    // Collect every top-level item, unwrapping `export_statement` wrappers
    // for TypeScript so `export const foo = () => {}` is reachable as a
    // `lexical_declaration` candidate.
    let mut top_level: Vec<Node> = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        let unwrapped = unwrap_export(&lang, child);
        let kind = unwrapped.kind();
        if !is_top_level_item(&lang, kind) {
            continue;
        }
        if matches!(lang, Lang::TypeScript | Lang::Tsx)
            && kind == "lexical_declaration"
            && !lexical_declaration_is_arrow(unwrapped)
        {
            continue;
        }
        top_level.push(unwrapped);
    }

    let mut containing: Vec<(u32, u32, String)> = Vec::new();
    for node in &top_level {
        let s = (node.start_position().row as u32) + 1;
        let e = (node.end_position().row as u32) + 1;
        let overlaps = !(e < in_start || s > in_end);
        let fully_contains = s <= in_start && e >= in_end;
        if overlaps && !fully_contains {
            // Hunk straddles a top-level boundary → reject.
            return None;
        }
        if fully_contains {
            containing.push((s, e, item_name(*node, &source)));
        }
    }

    containing.into_iter().min_by_key(|(s, e, _)| e - s)
}
