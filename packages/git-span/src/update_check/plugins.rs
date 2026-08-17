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
//! reports the max **among copies marked in use** — a copy whose version
//! dir carries an `.in_use` marker is the one the host actually runs;
//! orphaned newer copies would otherwise both misstate the version the
//! user is on and mask real staleness. When no copy is marked in use
//! (fresh installs, hosts that never orphan), the max over all copies is
//! the fallback. Unparseable or absent copies are ignored (fail-closed: no
//! finding rather than a wrong one). Scan roots honor `CLAUDE_CONFIG_DIR` /
//! `CODEX_HOME` when set; `GIT_SPAN_PLUGIN_CACHE_ROOT` overrides the base
//! for tests.

use std::path::Path;

use semver::Version;
use serde::Deserialize;

/// Maximum directory depth below the cache root to walk for `plugin.json`
/// files. The verified layouts put the file at depth 5
/// (`git-span/git-span/{version}/.{claude,codex}-plugin/plugin.json`); 6
/// bounds the walk while covering that shape and shallow variations. Depth
/// is the second bound on the walk (symlinks are never followed, so a
/// cyclic tree cannot run away either).
const MAX_DEPTH: usize = 6;

/// One cached plugin manifest. Only the two fields the staleness filter
/// needs are bound; unknown fields are ignored by serde.
#[derive(Deserialize)]
struct PluginMeta {
    name: String,
    version: String,
}

/// Bounded depth-first walk of `cache_root` for cached plugin copies,
/// returning the highest semver among copies whose manifest names
/// `git-span`, preferring copies marked in use (an `.in_use` entry in the
/// version dir) — see the module docs. `None` on an absent root, no
/// matching copy, or any read / parse failure along the way (fail-closed:
/// no finding rather than a wrong one).
fn find_cached_plugin_version(cache_root: &Path) -> Option<Version> {
    let mut best_in_use: Option<Version> = None;
    let mut best_any: Option<Version> = None;
    walk_plugin_copies(cache_root, MAX_DEPTH, &mut best_in_use, &mut best_any);
    best_in_use.or(best_any)
}

/// Recursive walk body. Files named exactly `plugin.json` whose grandparent
/// directory (the cache's version dir) parses as semver are read as plugin
/// manifests; directory names are never used as the *reported* version —
/// the manifest's own `version` field is the only truth. A non-semver
/// version dir (`local`, from local-path marketplaces) gates the whole copy
/// out: it is the user's own dev snapshot, never an update target. Copies
/// with an `.in_use` entry in their version dir feed `best_in_use`; every
/// copy feeds `best_any`.
fn walk_plugin_copies(
    dir: &Path,
    depth: usize,
    best_in_use: &mut Option<Version>,
    best_any: &mut Option<Version>,
) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue; // never follow links: cycles, escapes
        }
        let path = entry.path();
        if file_type.is_dir() {
            walk_plugin_copies(&path, depth - 1, best_in_use, best_any);
        } else if path.file_name().is_some_and(|name| name == "plugin.json") {
            let Some(version_dir) = path.parent().and_then(Path::parent) else {
                continue;
            };
            let Some(version_dir_name) = version_dir.file_name().and_then(|name| name.to_str())
            else {
                continue;
            };
            if Version::parse(version_dir_name).is_err() {
                continue;
            }
            let Some(version) = read_cached_plugin_version(&path) else {
                continue;
            };
            if best_any.as_ref().is_none_or(|current| version > *current) {
                *best_any = Some(version.clone());
            }
            // The `.in_use` marker is an entry (a directory on observed
            // hosts) directly inside the version dir; existence is the
            // signal, not its type.
            if version_dir.join(".in_use").exists()
                && best_in_use.as_ref().is_none_or(|current| version > *current)
            {
                *best_in_use = Some(version);
            }
        }
    }
}

/// Read one cached `plugin.json`, keeping the copy only when it names
/// `git-span` and its version parses as semver.
fn read_cached_plugin_version(path: &Path) -> Option<Version> {
    let text = std::fs::read_to_string(path).ok()?;
    let meta: PluginMeta = serde_json::from_str(&text).ok()?;
    if meta.name != "git-span" {
        return None;
    }
    Version::parse(&meta.version).ok()
}

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
        find_cached_plugin_version(cache_root)
    }
}

impl PluginCacheChecker for CodexChecker {
    fn tool(&self) -> &'static str {
        "codex"
    }

    fn find_cached_version(&self, cache_root: &Path) -> Option<Version> {
        find_cached_plugin_version(cache_root)
    }
}

/// The two bundled-plugin checkers, in rendering order.
pub fn checkers() -> Vec<Box<dyn PluginCacheChecker>> {
    vec![Box::new(ClaudeCodeChecker), Box::new(CodexChecker)]
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
    fn in_use_copy_beats_orphaned_newer_copy() {
        // The observed real-machine state: the older copy (1.0.134) carries
        // the `.in_use` marker — it is the one the host runs — while a newer
        // orphan (1.0.145) sits alongside. The in-use copy's version is the
        // user's truth; the orphan must not mask staleness.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.145", "git-span", "1.0.145");
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.134", "git-span", "1.0.134");
        fs::create_dir(
            dir.path()
                .join("git-span")
                .join("git-span")
                .join("1.0.134")
                .join(".in_use"),
        )
        .unwrap();
        assert_eq!(
            ClaudeCodeChecker.find_cached_version(dir.path()),
            Some(Version::new(1, 0, 134))
        );
    }

    #[test]
    fn orphaned_at_alone_does_not_count_as_in_use() {
        // `.orphaned_at` marks a copy as orphaned, never active — with no
        // `.in_use` anywhere, the max-over-all fallback applies.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.145", "git-span", "1.0.145");
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.134", "git-span", "1.0.134");
        fs::write(
            dir.path()
                .join("git-span")
                .join("git-span")
                .join("1.0.134")
                .join(".orphaned_at"),
            b"1700000000",
        )
        .unwrap();
        assert_eq!(
            ClaudeCodeChecker.find_cached_version(dir.path()),
            Some(Version::new(1, 0, 145))
        );
    }

    #[test]
    fn codex_semver_version_dir_wins() {
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".codex-plugin", "1.1.5", "git-span", "1.1.5");
        assert_eq!(
            CodexChecker.find_cached_version(dir.path()),
            Some(Version::new(1, 1, 5))
        );
    }

    #[test]
    fn local_version_dir_name_is_ignored() {
        // The repo's install doc documents a `local` version dir for
        // local-path marketplaces on some Codex builds; the directory name
        // is never parsed as a version.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".codex-plugin", "local", "git-span", "9.9.9");
        assert_eq!(CodexChecker.find_cached_version(dir.path()), None);
    }

    #[test]
    fn wrong_plugin_name_is_skipped() {
        // The cache root also holds unrelated marketplaces; matching on the
        // plugin `name` field bounds the scan.
        let dir = tempfile::tempdir().unwrap();
        write_plugin_copy(dir.path(), ".claude-plugin", "1.0.134", "other-plugin", "9.9.9");
        assert_eq!(ClaudeCodeChecker.find_cached_version(dir.path()), None);
    }

    #[test]
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
    fn absent_cache_root_yields_no_finding() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            ClaudeCodeChecker.find_cached_version(&dir.path().join("missing")),
            None
        );
    }

    #[test]
    fn checkers_are_claude_and_codex() {
        let tools: Vec<&'static str> = checkers().iter().map(|checker| checker.tool()).collect();
        assert_eq!(tools, vec!["claude", "codex"]);
    }
}
