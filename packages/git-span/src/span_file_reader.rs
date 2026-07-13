//! Layered span file reader: HEAD / index / worktree with overlay semantics.
//!
//! Default effective view: worktree overlays index overlays HEAD.
//!
//! **Tombstone semantics:** a file absent from a higher layer hides any
//! version present in lower layers.  If a higher-layer file exists but
//! fails to parse, the error is surfaced (fail closed) — no fallback to
//! lower layers.

use std::collections::BTreeSet;
use std::path::Path;

use crate::span_file::SpanFile;
use crate::{Error, Result};

/// Reads span files from the three Git layers (HEAD / index / worktree)
/// with configurable overlay semantics.
pub struct SpanFileReader<'repo> {
    repo: &'repo gix::Repository,
    span_root: String,
}

impl<'repo> SpanFileReader<'repo> {
    /// Create a new reader for the given repository and span root.
    ///
    /// The `span_root` should be a repo-relative directory path
    /// (e.g. `".span"`), typically obtained from
    /// [`crate::span_root::resolve_span_root`].
    pub fn new(repo: &'repo gix::Repository, span_root: String) -> Self {
        SpanFileReader { repo, span_root }
    }

    /// Read the effective span view: worktree overlays index overlays HEAD.
    ///
    /// Returns `Ok(None)` when the span file is absent from all layers, or
    /// when a higher-layer absence acts as a tombstone hiding lower layers.
    pub fn read_effective(&self, name: &str) -> Result<Option<SpanFile>> {
        // Fail-closed: an unmerged (stage 1/2/3) index entry for the span
        // file means an unresolved merge. Refuse to present any layer's
        // content as valid — the effective view is unreliable.
        if self.is_unmerged_in_index(name)? {
            return Err(Error::SpanConflict(name.to_string()));
        }
        // Worktree layer (highest priority).
        if let Some(span) = self.read_worktree(name)? {
            return Ok(Some(span));
        }

        // Worktree absent.  If the file exists in index or HEAD, the
        // worktree absence is a deletion tombstone — do NOT fall through.
        if self.exists_in_index(name)? || self.exists_in_head(name)? {
            return Ok(None);
        }

        // Index layer.
        if let Some(span) = self.read_staged(name)? {
            return Ok(Some(span));
        }

        // Index absent.  If the file exists in HEAD, index absence is a
        // deletion tombstone.
        if self.exists_in_head(name)? {
            return Ok(None);
        }

        // HEAD layer.
        self.read_head(name)
    }

    /// Read the span file from the HEAD tree only.
    pub fn read_head(&self, name: &str) -> Result<Option<SpanFile>> {
        let span_path = self.span_path(name);
        match crate::git::tree_entry_at(self.repo, "HEAD", Path::new(&span_path))? {
            Some((_mode, oid)) => {
                let text = crate::git::read_git_text(self.repo, &oid.to_string())?;
                crate::perf::record_list_layer_read();
                crate::perf::record_list_bytes_parsed(text.len() as u64);
                SpanFile::parse(&text).map(Some).map_err(Into::into)
            }
            None => Ok(None),
        }
    }

    /// Read the span file from the index (staged) layer.
    ///
    /// Index overlays HEAD: if the file is present in the index it is
    /// returned; if absent from the index the result is `None` regardless
    /// of HEAD (index deletion tombstone).
    pub fn read_staged(&self, name: &str) -> Result<Option<SpanFile>> {
        let span_path = self.span_path(name);
        let index = self
            .repo
            .index_or_load_from_head()
            .map_err(|e| Error::Git(format!("load index: {e}")))?;
        for entry in index.entries() {
            let ep = entry.path(&index).to_string();
            if ep == span_path {
                let text = self.read_index_blob_text(entry.id)?;
                crate::perf::record_list_layer_read();
                crate::perf::record_list_bytes_parsed(text.len() as u64);
                return SpanFile::parse(&text).map(Some).map_err(Into::into);
            }
        }
        Ok(None)
    }

    /// Read the span file from the working tree only.
    ///
    /// Returns `Ok(None)` when the file does not exist in the worktree.
    /// Used mainly for diagnostics.
    pub fn read_worktree(&self, name: &str) -> Result<Option<SpanFile>> {
        let abs = self.worktree_path(name);
        // A directory at the span path (e.g. after `a/b` was renamed to
        // `a/b/index`, leaving `.span/a/b` as a directory) is not a
        // readable leaf span file; treat it as absent in this layer
        // rather than letting `read_to_string` fail with "Is a directory".
        if abs.is_file() {
            let content = std::fs::read_to_string(&abs)?;
            crate::perf::record_list_layer_read();
            crate::perf::record_list_bytes_parsed(content.len() as u64);
            SpanFile::parse(&content).map(Some).map_err(Into::into)
        } else {
            Ok(None)
        }
    }

    /// List all unique span names visible across all layers.
    ///
    /// Collects names from HEAD tree, index, and worktree, deduplicates
    /// them, and returns a sorted vector.
    pub fn list_span_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();

        // Collect from worktree.
        self.collect_worktree_names(&mut names)?;

        // Collect from HEAD tree.
        self.collect_head_names(&mut names)?;

        // Collect from index.
        self.collect_index_names(&mut names)?;

        Ok(names.into_iter().collect())
    }

    /// List span names committed at `HEAD` (the HEAD tree under the span
    /// root only — index and worktree layers excluded).
    ///
    /// This is the enumeration the `cache_v2` committed baseline keys on:
    /// the baseline is resolved with `LayerSet::committed_only` and keyed
    /// by the HEAD span tree, so it must contain exactly the spans
    /// present at HEAD. Worktree-only spans (untracked or gitignored)
    /// are uncommitted state and are handled by the dirty-overlay path,
    /// never baked into the HEAD-keyed baseline.
    pub fn committed_span_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();
        self.collect_head_names(&mut names)?;
        Ok(names.into_iter().collect())
    }

    /// List span names present on the worktree filesystem under the span
    /// root, including untracked and gitignored files.
    ///
    /// This is a raw directory walk — it deliberately does not consult
    /// git's tracked/ignored state, so the dirty-overlay path can observe
    /// uncommitted span files that `git status` never reports.
    pub fn worktree_span_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();
        self.collect_worktree_names(&mut names)?;
        Ok(names.into_iter().collect())
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// Build the span-relative path: `<span_root>/<name>`.
    fn span_path(&self, name: &str) -> String {
        format!("{}/{}", self.span_root, name)
    }

    /// Build the absolute worktree path: `<workdir>/<span_root>/<name>`.
    fn worktree_path(&self, name: &str) -> std::path::PathBuf {
        let workdir = self
            .repo
            .workdir()
            .expect("SpanFileReader only works in non-bare repositories");
        workdir.join(&self.span_root).join(name)
    }

    /// Check whether the span file has an unmerged (stage 1/2/3) index
    /// entry — the canonical Git signal for an unresolved merge conflict.
    fn is_unmerged_in_index(&self, name: &str) -> Result<bool> {
        let span_path = self.span_path(name);
        let entries = match crate::git::index_entries(self.repo) {
            Ok(e) => e,
            // No index / unreadable index is not, by itself, a conflict;
            // the worktree-marker backstop in `SpanFile::parse` still
            // fails closed if conflict text is present.
            Err(_) => return Ok(false),
        };
        Ok(entries
            .iter()
            .any(|e| e.path == span_path && e.stage != gix::index::entry::Stage::Unconflicted))
    }

    /// Check whether a file path exists in the index.
    fn exists_in_index(&self, name: &str) -> Result<bool> {
        let span_path = self.span_path(name);
        let index = self
            .repo
            .index_or_load_from_head()
            .map_err(|e| Error::Git(format!("load index: {e}")))?;
        Ok(index
            .entries()
            .iter()
            .any(|e| e.path(&index) == span_path.as_str()))
    }

    /// Check whether a file path exists in the HEAD tree.
    fn exists_in_head(&self, name: &str) -> Result<bool> {
        let span_path = self.span_path(name);
        match crate::git::tree_entry_at(self.repo, "HEAD", Path::new(&span_path))? {
            Some(_) => Ok(true),
            None => Ok(false),
        }
    }

    /// Read the text content of a staged blob by OID.
    fn read_index_blob_text(&self, oid: gix::ObjectId) -> Result<String> {
        let obj = self
            .repo
            .find_object(oid)
            .map_err(|e| Error::Git(format!("find staged blob `{oid}`: {e}")))?;
        let blob = obj.into_blob();
        String::from_utf8(blob.detach().data)
            .map_err(|e| Error::Parse(format!("staged blob not utf-8: {e}")))
    }

    /// Collect span names from the worktree filesystem.
    fn collect_worktree_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let Some(workdir) = self.repo.workdir() else {
            return Ok(());
        };
        let span_dir = workdir.join(&self.span_root);
        if !span_dir.exists() {
            return Ok(());
        }
        collect_file_names(&span_dir, "", names).map_err(Error::Io)
    }

    /// Collect span names from the HEAD tree under the span root.
    fn collect_head_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let head_id = match self.repo.head_id() {
            Ok(id) => id.detach(),
            Err(_) => return Ok(()),
        };
        let commit = match self.repo.find_commit(head_id) {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };
        let tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        let entry = match tree.lookup_entry_by_path(Path::new(&self.span_root)) {
            Ok(Some(e)) => e,
            _ => return Ok(()),
        };
        if !entry.mode().is_tree() {
            return Ok(());
        }
        let oid = entry.object_id();
        let obj = match self.repo.find_object(oid) {
            Ok(o) => o,
            Err(_) => return Ok(()),
        };
        let span_tree = match obj.peel_to_tree() {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        collect_tree_entry_names(self.repo, &span_tree, "", names)
    }

    /// Collect span names from the index, filtering by span root prefix.
    fn collect_index_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let index = match self.repo.index_or_load_from_head() {
            Ok(i) => i,
            Err(_) => return Ok(()),
        };
        let prefix = format!("{}/", self.span_root);
        for entry in index.entries() {
            let ep = entry.path(&index).to_string();
            if let Some(rest) = ep.strip_prefix(&prefix)
                && rest.split('/').all(is_span_name_segment)
            {
                names.insert(rest.to_string());
            }
        }
        Ok(())
    }
}

/// Whether a directory-entry basename names a span (or span subdirectory).
///
/// Span names and slugs never begin with `.`, so any dotfile or
/// dot-directory under the span root (e.g. the `.hookignore` config
/// sibling, or the reconciler dispatcher's `.manual-run` marker) is a
/// non-span config artifact and must be skipped by every enumeration path —
/// filesystem walk, HEAD-tree walk, and index scan. This is the single
/// choke-point predicate shared by all three.
fn is_span_name_segment(basename: &str) -> bool {
    // Dot-prefixed names are config artifacts (e.g. .hookignore, .manual-run,
    // .gitignore, .gitattributes).
    if basename.starts_with('.') {
        return false;
    }
    // Editor scratch files (e.g. myflow.EDITMSG) left behind after a
    // failed run_why_editor must never be enumerated as spans.
    if basename.ends_with(".EDITMSG") {
        return false;
    }
    // Log files written by the reconciler dispatcher (e.g. dispatcher.log,
    // agent-<claimId>.log) are runtime diagnostics, not span content.
    if basename.ends_with(".log") {
        return false;
    }
    // Generated manual-run dispatch scripts (see
    // packages/agent-hooks/src/dispatcher.ts) are shell scripts, not span
    // content.
    if basename.starts_with("manual-hook-dispatch-") && basename.ends_with(".sh") {
        return false;
    }
    true
}

/// Recursively collect file names from a directory tree.
fn collect_file_names(
    dir: &Path,
    prefix: &str,
    names: &mut BTreeSet<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_span_name_segment(&name) {
            continue;
        }
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if entry.file_type()?.is_dir() {
            collect_file_names(&entry.path(), &rel, names)?;
        } else {
            names.insert(rel);
        }
    }
    Ok(())
}

/// Recursively collect entry names from a tree object.
fn collect_tree_entry_names(
    repo: &gix::Repository,
    tree: &gix::Tree,
    prefix: &str,
    names: &mut BTreeSet<String>,
) -> Result<()> {
    for entry in tree.iter() {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.filename().to_string();
        if !is_span_name_segment(&name) {
            continue;
        }
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if entry.mode().is_tree()
            && let Ok(obj) = repo.find_object(entry.object_id())
            && let Ok(subtree) = obj.peel_to_tree()
        {
            collect_tree_entry_names(repo, &subtree, &rel, names)?;
        } else {
            names.insert(rel);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_span_name_segment;

    #[test]
    fn accepts_normal_names() {
        assert!(is_span_name_segment("checkout-flow"));
        assert!(is_span_name_segment("billing"));
        assert!(is_span_name_segment("index"));
    }

    #[test]
    fn rejects_dotfiles_and_dot_dirs() {
        assert!(!is_span_name_segment(".hookignore"));
        assert!(!is_span_name_segment(".config"));
        assert!(!is_span_name_segment(".git"));
        assert!(!is_span_name_segment("."));
        assert!(!is_span_name_segment(".manual-run"));
        assert!(!is_span_name_segment(".gitignore"));
        assert!(!is_span_name_segment(".gitattributes"));
    }

    #[test]
    fn rejects_dispatcher_generated_artifacts() {
        assert!(!is_span_name_segment("dispatcher.log"));
        assert!(!is_span_name_segment("agent-daf06226-85d1-471c-b59c-43733590a3f0.log"));
        assert!(!is_span_name_segment(
            "manual-hook-dispatch-2026-07-08T21-02-05-537Z.sh"
        ));
    }

    #[test]
    fn accepts_names_that_merely_contain_but_do_not_match_reserved_suffixes() {
        // A real span name could plausibly contain "log" or "sh" as a
        // substring without matching the reserved suffix/prefix rules.
        assert!(is_span_name_segment("logging-pipeline"));
        assert!(is_span_name_segment("shell-completion"));
    }
}
