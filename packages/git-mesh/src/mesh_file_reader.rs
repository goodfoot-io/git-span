//! Layered mesh file reader: HEAD / index / worktree with overlay semantics.
//!
//! Default effective view: worktree overlays index overlays HEAD.
//!
//! **Tombstone semantics:** a file absent from a higher layer hides any
//! version present in lower layers.  If a higher-layer file exists but
//! fails to parse, the error is surfaced (fail closed) — no fallback to
//! lower layers.

use std::collections::BTreeSet;
use std::path::Path;

use crate::mesh_file::MeshFile;
use crate::{Error, Result};

/// Reads mesh files from the three Git layers (HEAD / index / worktree)
/// with configurable overlay semantics.
pub struct MeshFileReader<'repo> {
    repo: &'repo gix::Repository,
    mesh_root: String,
}

impl<'repo> MeshFileReader<'repo> {
    /// Create a new reader for the given repository and mesh root.
    ///
    /// The `mesh_root` should be a repo-relative directory path
    /// (e.g. `".mesh"`), typically obtained from
    /// [`crate::mesh_root::resolve_mesh_root`].
    pub fn new(repo: &'repo gix::Repository, mesh_root: String) -> Self {
        MeshFileReader { repo, mesh_root }
    }

    /// Read the effective mesh view: worktree overlays index overlays HEAD.
    ///
    /// Returns `Ok(None)` when the mesh file is absent from all layers, or
    /// when a higher-layer absence acts as a tombstone hiding lower layers.
    pub fn read_effective(&self, name: &str) -> Result<Option<MeshFile>> {
        // Fail-closed: an unmerged (stage 1/2/3) index entry for the mesh
        // file means an unresolved merge. Refuse to present any layer's
        // content as valid — the effective view is unreliable.
        if self.is_unmerged_in_index(name)? {
            return Err(Error::MeshConflict(name.to_string()));
        }
        // Worktree layer (highest priority).
        if let Some(mesh) = self.read_worktree(name)? {
            return Ok(Some(mesh));
        }

        // Worktree absent.  If the file exists in index or HEAD, the
        // worktree absence is a deletion tombstone — do NOT fall through.
        if self.exists_in_index(name)? || self.exists_in_head(name)? {
            return Ok(None);
        }

        // Index layer.
        if let Some(mesh) = self.read_staged(name)? {
            return Ok(Some(mesh));
        }

        // Index absent.  If the file exists in HEAD, index absence is a
        // deletion tombstone.
        if self.exists_in_head(name)? {
            return Ok(None);
        }

        // HEAD layer.
        self.read_head(name)
    }

    /// Read the mesh file from the HEAD tree only.
    pub fn read_head(&self, name: &str) -> Result<Option<MeshFile>> {
        let mesh_path = self.mesh_path(name);
        match crate::git::tree_entry_at(self.repo, "HEAD", Path::new(&mesh_path))? {
            Some((_mode, oid)) => {
                let text = crate::git::read_git_text(self.repo, &oid.to_string())?;
                MeshFile::parse(&text).map(Some).map_err(Into::into)
            }
            None => Ok(None),
        }
    }

    /// Read the mesh file from the index (staged) layer.
    ///
    /// Index overlays HEAD: if the file is present in the index it is
    /// returned; if absent from the index the result is `None` regardless
    /// of HEAD (index deletion tombstone).
    pub fn read_staged(&self, name: &str) -> Result<Option<MeshFile>> {
        let mesh_path = self.mesh_path(name);
        let index = self
            .repo
            .index_or_load_from_head()
            .map_err(|e| Error::Git(format!("load index: {e}")))?;
        for entry in index.entries() {
            let ep = entry.path(&index).to_string();
            if ep == mesh_path {
                let text = self.read_index_blob_text(entry.id)?;
                return MeshFile::parse(&text).map(Some).map_err(Into::into);
            }
        }
        Ok(None)
    }

    /// Read the mesh file from the working tree only.
    ///
    /// Returns `Ok(None)` when the file does not exist in the worktree.
    /// Used mainly for diagnostics.
    pub fn read_worktree(&self, name: &str) -> Result<Option<MeshFile>> {
        let abs = self.worktree_path(name);
        // A directory at the mesh path (e.g. after `a/b` was renamed to
        // `a/b/index`, leaving `.mesh/a/b` as a directory) is not a
        // readable leaf mesh file; treat it as absent in this layer
        // rather than letting `read_to_string` fail with "Is a directory".
        if abs.is_file() {
            let content = std::fs::read_to_string(&abs)?;
            MeshFile::parse(&content).map(Some).map_err(Into::into)
        } else {
            Ok(None)
        }
    }

    /// List all unique mesh names visible across all layers.
    ///
    /// Collects names from HEAD tree, index, and worktree, deduplicates
    /// them, and returns a sorted vector.
    pub fn list_mesh_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();

        // Collect from worktree.
        self.collect_worktree_names(&mut names)?;

        // Collect from HEAD tree.
        self.collect_head_names(&mut names)?;

        // Collect from index.
        self.collect_index_names(&mut names)?;

        Ok(names.into_iter().collect())
    }

    /// List mesh names committed at `HEAD` (the HEAD tree under the mesh
    /// root only — index and worktree layers excluded).
    ///
    /// This is the enumeration the `cache_v2` committed baseline keys on:
    /// the baseline is resolved with `LayerSet::committed_only` and keyed
    /// by the HEAD mesh tree, so it must contain exactly the meshes
    /// present at HEAD. Worktree-only meshes (untracked or gitignored)
    /// are uncommitted state and are handled by the dirty-overlay path,
    /// never baked into the HEAD-keyed baseline.
    pub fn committed_mesh_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();
        self.collect_head_names(&mut names)?;
        Ok(names.into_iter().collect())
    }

    /// List mesh names present on the worktree filesystem under the mesh
    /// root, including untracked and gitignored files.
    ///
    /// This is a raw directory walk — it deliberately does not consult
    /// git's tracked/ignored state, so the dirty-overlay path can observe
    /// uncommitted mesh files that `git status` never reports.
    pub fn worktree_mesh_names(&self) -> Result<Vec<String>> {
        let mut names: BTreeSet<String> = BTreeSet::new();
        self.collect_worktree_names(&mut names)?;
        Ok(names.into_iter().collect())
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// Build the mesh-relative path: `<mesh_root>/<name>`.
    fn mesh_path(&self, name: &str) -> String {
        format!("{}/{}", self.mesh_root, name)
    }

    /// Build the absolute worktree path: `<workdir>/<mesh_root>/<name>`.
    fn worktree_path(&self, name: &str) -> std::path::PathBuf {
        let workdir = self
            .repo
            .workdir()
            .expect("MeshFileReader only works in non-bare repositories");
        workdir.join(&self.mesh_root).join(name)
    }

    /// Check whether the mesh file has an unmerged (stage 1/2/3) index
    /// entry — the canonical Git signal for an unresolved merge conflict.
    fn is_unmerged_in_index(&self, name: &str) -> Result<bool> {
        let mesh_path = self.mesh_path(name);
        let entries = match crate::git::index_entries(self.repo) {
            Ok(e) => e,
            // No index / unreadable index is not, by itself, a conflict;
            // the worktree-marker backstop in `MeshFile::parse` still
            // fails closed if conflict text is present.
            Err(_) => return Ok(false),
        };
        Ok(entries
            .iter()
            .any(|e| e.path == mesh_path && e.stage != gix::index::entry::Stage::Unconflicted))
    }

    /// Check whether a file path exists in the index.
    fn exists_in_index(&self, name: &str) -> Result<bool> {
        let mesh_path = self.mesh_path(name);
        let index = self
            .repo
            .index_or_load_from_head()
            .map_err(|e| Error::Git(format!("load index: {e}")))?;
        Ok(index
            .entries()
            .iter()
            .any(|e| e.path(&index) == mesh_path.as_str()))
    }

    /// Check whether a file path exists in the HEAD tree.
    fn exists_in_head(&self, name: &str) -> Result<bool> {
        let mesh_path = self.mesh_path(name);
        match crate::git::tree_entry_at(self.repo, "HEAD", Path::new(&mesh_path))? {
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

    /// Collect mesh names from the worktree filesystem.
    fn collect_worktree_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let Some(workdir) = self.repo.workdir() else {
            return Ok(());
        };
        let mesh_dir = workdir.join(&self.mesh_root);
        if !mesh_dir.exists() {
            return Ok(());
        }
        collect_file_names(&mesh_dir, "", names).map_err(Error::Io)
    }

    /// Collect mesh names from the HEAD tree under the mesh root.
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
        let entry = match tree.lookup_entry_by_path(Path::new(&self.mesh_root)) {
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
        let mesh_tree = match obj.peel_to_tree() {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        collect_tree_entry_names(self.repo, &mesh_tree, "", names)
    }

    /// Collect mesh names from the index, filtering by mesh root prefix.
    fn collect_index_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let index = match self.repo.index_or_load_from_head() {
            Ok(i) => i,
            Err(_) => return Ok(()),
        };
        let prefix = format!("{}/", self.mesh_root);
        for entry in index.entries() {
            let ep = entry.path(&index).to_string();
            if let Some(rest) = ep.strip_prefix(&prefix)
                && rest.split('/').all(is_mesh_name_segment)
            {
                names.insert(rest.to_string());
            }
        }
        Ok(())
    }
}

/// Whether a directory-entry basename names a mesh (or mesh subdirectory).
///
/// Mesh names and slugs never begin with `.`, so any dotfile or
/// dot-directory under the mesh root (e.g. the `.hookignore` config
/// sibling) is a non-mesh config artifact and must be skipped by every
/// enumeration path — filesystem walk, HEAD-tree walk, and index scan.
/// This is the single choke-point predicate shared by all three.
fn is_mesh_name_segment(basename: &str) -> bool {
    !basename.starts_with('.')
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
        if !is_mesh_name_segment(&name) {
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
        if !is_mesh_name_segment(&name) {
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
    use super::is_mesh_name_segment;

    #[test]
    fn accepts_normal_names() {
        assert!(is_mesh_name_segment("checkout-flow"));
        assert!(is_mesh_name_segment("billing"));
        assert!(is_mesh_name_segment("index"));
    }

    #[test]
    fn rejects_dotfiles_and_dot_dirs() {
        assert!(!is_mesh_name_segment(".hookignore"));
        assert!(!is_mesh_name_segment(".config"));
        assert!(!is_mesh_name_segment(".git"));
        assert!(!is_mesh_name_segment("."));
    }
}
