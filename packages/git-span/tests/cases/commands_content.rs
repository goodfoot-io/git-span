//! Sentinel-phrase gate for the generated command reference.
//!
//! `commands.mdx` is rendered from the clap tree, with the behavioral prose
//! living in the subcommands' doc comments. This test asserts that the
//! distinctive prose of each section — the behavioral contract, the callout
//! substance, the exit-behavior sentences — survives in the generated page,
//! so migrating prose into doc comments cannot silently drop content.

use std::path::Path;

/// `(section, sentinel)` — a distinctive phrase from the current
/// hand-written page that the generated page must still contain.
const SENTINELS: &[(&str, &str)] = &[
    ("global options", "does not list every span"),
    ("global exit behavior", "exits 2"),
    ("add", "resolved 1 in place"),
    ("add exit contract", "index changed during check) — retryable"),
    ("remove", "Each anchor must match an existing one on the span exactly"),
    ("replace", "there is never an intermediate state with both or neither"),
    ("why read-mode refusal", "read mode rejects it fail-closed (exit 1, no stdout)"),
    ("delete", "Destructive. Run"),
    ("show", "positional form is equivalent to"),
    ("list", "one tab-separated row per anchor"),
    ("tree", "Roots are file paths and globs only"),
    ("history", "rename-aware by content similarity"),
    ("history scoped output", "Treat scoped JSON output as a partial record"),
    ("drift clean shape", "does not imply `findings: []`"),
    ("drift fix callout", "will not touch it"),
    ("drift exit codes", "never maskable by"),
    ("doctor", "store-size summary (bytes used)"),
    ("merge-driver", "Same-anchor range/hash divergence is deferred"),
];

#[test]
fn generated_page_preserves_every_section_sentinel() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../website/content/docs/commands.mdx");
    let page = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read generated page {}: {e}", path.display()));
    for (section, sentinel) in SENTINELS {
        assert!(
            page.contains(sentinel),
            "generated commands.mdx lost the {section} sentinel `{sentinel}` — \
             the prose must survive migration into the clap doc comments"
        );
    }
}
