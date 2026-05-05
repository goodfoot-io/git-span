//! Symbol-level enclosure resolver.
//!
//! Given an absolute path on disk and an inner `(start, end)` line range,
//! returns the smallest top-level item (function, impl, struct, …) that
//! fully contains the range — used by `resolve_extent_precedence` to
//! promote ranged `Edit`/`Read` participants to `ExtentSource::Symbol`.
//!
//! Failure modes (parse error, missing file, unsupported language,
//! range spanning multiple top-level items) silently return `None`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tree_sitter::{Language, Node, Parser};

/// Hard cap on file size we'll feed to tree-sitter. Files above this skip
/// symbol enclosure entirely (parser cost is roughly linear in source size,
/// and the cap keeps a single pipeline run bounded).
pub const MAX_PARSE_BYTES: u64 = 256 * 1024;

/// One top-level item resolved from a parsed file: 1-based start/end line
/// and a printable name (empty when no name field is available).
#[derive(Clone, Debug)]
pub struct TopLevelItem {
    pub start: u32,
    pub end: u32,
    pub name: String,
}

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

/// Parse `abs_path` and return its top-level items. `None` on unsupported
/// language, missing/oversized file, IO/parse error, or any `has_error`
/// recovery in the AST (recovered trees produce silently-degraded answers
/// — we'd rather give no answer than a wrong one).
pub fn parse_top_level_items(abs_path: &Path) -> Option<Vec<TopLevelItem>> {
    let lang = detect_lang(abs_path)?;
    let meta = fs::metadata(abs_path).ok()?;
    if meta.len() > MAX_PARSE_BYTES {
        return None;
    }
    let source = fs::read(abs_path).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language_for(&lang)).ok()?;
    let tree = parser.parse(&source, None)?;
    if tree.root_node().has_error() {
        // Tree-sitter ERROR-recovery emits a tree but with synthesized nodes
        // around the broken region; treat any such file as un-resolvable.
        return None;
    }
    let root = tree.root_node();

    let mut items: Vec<TopLevelItem> = Vec::new();
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
        let s = (unwrapped.start_position().row as u32) + 1;
        let e = (unwrapped.end_position().row as u32) + 1;
        items.push(TopLevelItem {
            start: s,
            end: e,
            name: item_name(unwrapped, &source),
        });
    }
    Some(items)
}

/// Pick the smallest top-level item that fully contains `inner`. Returns
/// `None` if no item contains it, or if `inner` straddles a top-level
/// boundary (overlapping but not fully contained by some item).
pub fn smallest_enclosing(
    items: &[TopLevelItem],
    inner: (u32, u32),
) -> Option<(u32, u32, String)> {
    let (in_start, in_end) = inner;
    let mut containing: Vec<(u32, u32, String)> = Vec::new();
    for item in items {
        let overlaps = !(item.end < in_start || item.start > in_end);
        let fully_contains = item.start <= in_start && item.end >= in_end;
        if overlaps && !fully_contains {
            return None;
        }
        if fully_contains {
            containing.push((item.start, item.end, item.name.clone()));
        }
    }
    containing.into_iter().min_by_key(|(s, e, _)| e - s)
}

/// Per-pipeline-run cache keyed on (path, mtime, size) so a single
/// `run_suggest_pipeline` invocation parses each file at most once.
/// Cache lives only as long as the pipeline run — bounded memory, no
/// cross-flush staleness.
#[derive(Default)]
pub struct SymbolCache {
    items: BTreeMap<(PathBuf, SystemTime, u64), Option<Vec<TopLevelItem>>>,
}

impl SymbolCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Resolve the smallest enclosing top-level item for `inner`, parsing
    /// (and caching) `abs_path` on first touch. Returns `None` for the
    /// same reasons as `parse_top_level_items` plus the no-enclosure case.
    pub fn enclosing(
        &mut self,
        abs_path: &Path,
        inner: (u32, u32),
    ) -> Option<(u32, u32, String)> {
        let (in_start, in_end) = inner;
        if in_start == 0 || in_end == 0 || in_start > in_end {
            return None;
        }
        let meta = fs::metadata(abs_path).ok()?;
        let mtime = meta.modified().ok()?;
        let size = meta.len();
        if size > MAX_PARSE_BYTES {
            return None;
        }
        let key = (abs_path.to_path_buf(), mtime, size);
        let items = self
            .items
            .entry(key)
            .or_insert_with(|| parse_top_level_items(abs_path))
            .clone()?;
        smallest_enclosing(&items, inner)
    }
}

/// One-shot wrapper kept for the standalone tests and historical callers.
pub fn enclosing_symbol_range(abs_path: &Path, inner: (u32, u32)) -> Option<(u32, u32, String)> {
    SymbolCache::new().enclosing(abs_path, inner)
}
