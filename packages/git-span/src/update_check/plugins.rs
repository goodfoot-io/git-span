//! Plugin-cache staleness checkers for the bundled integrations.
//!
//! Both Claude Code and Codex keep per-user plugin caches on disk
//! (verified layouts, 2026-08-14):
//!
//! * Claude — `~/.claude/plugins/cache/git-span/git-span/{version}/.claude-plugin/plugin.json`
//! * Codex — `~/.codex/plugins/cache/git-span/git-span/{version}/.codex-plugin/plugin.json`
//!
//! Multiple version dirs coexist, and the directory name is the
//! install-time marketplace version (or `local` on some Codex builds) —
//! never truth. Each checker therefore reads every cached copy's own
//! `plugin.json` (`name == "git-span"`), parses `version` as semver, and
//! reports the max. Unparseable or absent copies are ignored (fail-closed:
//! no finding rather than a wrong one). Scan roots honor
//! `CLAUDE_CONFIG_DIR` / `CODEX_HOME` when set;
//! `GIT_SPAN_PLUGIN_CACHE_ROOT` overrides the base for tests.

use std::path::Path;

use semver::Version;

/// One plugin-cache checker: the tool key (`claude` | `codex`) and the max
/// semver found among that tool's cached `git-span` copies under
/// `cache_root` (the tool-specific root, e.g.
/// `{base}/claude/plugins/cache`).
pub trait PluginCacheChecker {
    fn tool(&self) -> &'static str;
    fn find_cached_version(&self, cache_root: &Path) -> Option<Version>;
}

/// Claude Code plugin cache checker.
pub struct ClaudeCodeChecker;

/// Codex plugin cache checker.
pub struct CodexChecker;

impl PluginCacheChecker for ClaudeCodeChecker {
    fn tool(&self) -> &'static str {
        "claude"
    }

    fn find_cached_version(&self, cache_root: &Path) -> Option<Version> {
        let _ = cache_root;
        None
    }
}

impl PluginCacheChecker for CodexChecker {
    fn tool(&self) -> &'static str {
        "codex"
    }

    fn find_cached_version(&self, cache_root: &Path) -> Option<Version> {
        let _ = cache_root;
        None
    }
}

/// The two bundled-plugin checkers, in rendering order.
pub fn checkers() -> Vec<Box<dyn PluginCacheChecker>> {
    todo!("Phase 3: return the Claude and Codex checkers")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Write one cached plugin copy under `root`:
    /// `git-span/git-span/{version_dir}/{plugin_subdir}/plugin.json`.
    fn write_plugin_copy(
        root: &Path,
        plugin_subdir: &str,
        version_dir: &str,
        name: &str,
        version: &str,
    ) {
        let dir = root
            .join("git-span")
            .join("git-span")
            .join(version_dir)
            .join(plugin_subdir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("plugin.json"),
            format!(r#"{{"name": "{name}", "version": "{version}"}}"#),
        )
        .unwrap();
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn claude_newest_of_many_copies_wins() {
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.134", "git-span", "1.0.134");
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.145", "git-span", "1.0.145");
        assert_eq!(
            ClaudeCodeChecker.find_cached_version(dir.path()),
            Some(Version::new(1, 0, 145))
        );
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn codex_semver_version_dir_wins() {
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".codex-plugin", "1.1.5", "git-span", "1.1.5");
        assert_eq!(
            CodexChecker.find_cached_version(dir.path()),
            Some(Version::new(1, 1, 5))
        );
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn local_version_dir_name_is_ignored() {
        // The repo's install doc documents a `local` version dir for
        // local-path marketplaces on some Codex builds; the directory name
        // is never parsed as a version.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".codex-plugin", "local", "git-span", "9.9.9");
        assert_eq!(CodexChecker.find_cached_version(dir.path()), None);
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn wrong_plugin_name_is_skipped() {
        // The cache root also holds unrelated marketplaces; matching on the
        // plugin `name` field bounds the scan.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.134", "other-plugin", "9.9.9");
        assert_eq!(ClaudeCodeChecker.find_cached_version(dir.path()), None);
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn unparseable_version_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(
            dir.path(),
            ".claude-plugin",
            "1.0.134",
            "git-span",
            "not-a-version",
        );
        assert_eq!(ClaudeCodeChecker.find_cached_version(dir.path()), None);
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn absent_cache_root_yields_no_finding() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            ClaudeCodeChecker.find_cached_version(&dir.path().join("missing")),
            None
        );
    }

    #[test]
    #[ignore = "Phase 3: plugin-cache scanning not implemented"]
    fn checkers_are_claude_and_codex() {
        let tools: Vec<&'static str> = checkers().iter().map(|checker| checker.tool()).collect();
        assert_eq!(tools, vec!["claude", "codex"]);
    }
}
