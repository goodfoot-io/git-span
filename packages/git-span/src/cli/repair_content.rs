//! Per-repair canonical content cache. Source bytes and line indexing are paid
//! once per (layer, path), even when many relocated anchors share a file.
use crate::git::IndexEntrySnapshot;
use crate::resolver::layers::{CustomFilters, normalize_worktree_bytes};
use crate::types::{AnchorExtent, AnchorResolved, DriftSource};
use anyhow::{Context, Result, ensure};
use git_span_core::{LineIndex, cheap_fingerprint_indexed, rk64_to_hex};
use std::collections::HashMap;
use std::sync::Arc;

struct PhysicalContent {
    bytes: Vec<u8>,
    symlink: bool,
}

struct Content {
    index: LineIndex<'static>,
    raw_line_count: Option<usize>,
    utf8: bool,
}

pub(super) struct RepairContentCache {
    index: Vec<IndexEntrySnapshot>,
    head: Option<String>,
    contents: HashMap<(DriftSource, String, String), Content>,
    filters: CustomFilters,
    physical: HashMap<String, PhysicalContent>,
}

impl RepairContentCache {
    pub(super) fn new(repo: &gix::Repository, index: Vec<IndexEntrySnapshot>) -> Self {
        Self {
            index,
            head: repo
                .rev_parse_single("HEAD")
                .ok()
                .map(|id| id.detach().to_string()),
            contents: HashMap::new(),
            filters: CustomFilters::new(),
            physical: HashMap::new(),
        }
    }

    /// Preserve identity across a path-dependent normalization change. The
    /// destination may have a different canonical representation (e.g. ident),
    /// but its bytes must still match the reviewed content under the old rules.
    pub(super) fn relocation_hash(
        &mut self,
        repo: &gix::Repository,
        source: DriftSource,
        anchor: &AnchorResolved,
        stored_hash: &str,
    ) -> Result<Option<String>> {
        let current = anchor
            .current
            .as_ref()
            .context("relocation has no destination")?;
        let path = current.path.to_string_lossy();
        let destination = self.hash(repo, source, &path, &current.extent)?;
        if destination == stored_hash {
            return Ok(Some(destination));
        }
        if source == DriftSource::Worktree && current.path != anchor.anchored.path {
            let original = self.hash_with_rules(
                repo,
                source,
                &path,
                &anchor.anchored.path.to_string_lossy(),
                &current.extent,
            )?;
            if original == stored_hash {
                return Ok(Some(destination));
            }
        }
        Ok(None)
    }

    pub(super) fn hash(
        &mut self,
        repo: &gix::Repository,
        source: DriftSource,
        path: &str,
        extent: &AnchorExtent,
    ) -> Result<String> {
        self.hash_with_rules(repo, source, path, path, extent)
    }

    pub(super) fn hash_with_rules(
        &mut self,
        repo: &gix::Repository,
        source: DriftSource,
        path: &str,
        rules_path: &str,
        extent: &AnchorExtent,
    ) -> Result<String> {
        let key = (source, path.to_owned(), rules_path.to_owned());
        if let std::collections::hash_map::Entry::Vacant(slot) = self.contents.entry(key.clone()) {
            let (bytes, raw_line_count) = match source {
                DriftSource::Head => {
                    let head = self.head.as_ref().context("repair source has no HEAD")?;
                    let oid = crate::git::path_blob_at(repo, head, path).or_else(|_| {
                        self.index
                            .iter()
                            .find(|entry| {
                                entry.path == path
                                    && entry.stage == gix::index::entry::Stage::Unconflicted
                            })
                            .map(|entry| entry.oid.to_string())
                            .context("repair source is absent from HEAD and index")
                    })?;
                    (crate::git::read_blob_bytes(repo, &oid)?, None)
                }
                DriftSource::Index => {
                    let entry = self
                        .index
                        .iter()
                        .find(|entry| {
                            entry.path == path
                                && entry.stage == gix::index::entry::Stage::Unconflicted
                        })
                        .context("repair source is absent from the index")?;
                    (
                        crate::git::read_blob_bytes(repo, &entry.oid.to_string())?,
                        None,
                    )
                }
                DriftSource::Worktree => {
                    // Failed filters cannot establish canonical identity. Unlike
                    // add, automatic repair never falls back to raw content.
                    if let std::collections::hash_map::Entry::Vacant(slot) =
                        self.physical.entry(path.to_owned())
                    {
                        let abs = crate::git::work_dir(repo)?.join(path);
                        let metadata = std::fs::symlink_metadata(&abs)?;
                        let symlink = metadata.file_type().is_symlink();
                        let bytes = if symlink {
                            std::fs::read_link(&abs)?
                                .to_string_lossy()
                                .as_bytes()
                                .to_vec()
                        } else {
                            std::fs::read(&abs)?
                        };
                        slot.insert(PhysicalContent { bytes, symlink });
                    }
                    let physical = &self.physical[path];
                    let bytes = if physical.symlink {
                        physical.bytes.clone()
                    } else {
                        normalize_worktree_bytes(
                            repo,
                            &mut self.filters,
                            rules_path,
                            &physical.bytes,
                        )?
                    };
                    let count = std::str::from_utf8(&physical.bytes)
                        .map(|text| text.lines().count())
                        .unwrap_or(0);
                    (bytes, Some(count))
                }
            };
            ensure!(
                bytes.len() <= u32::MAX as usize,
                "repair source exceeds line-index size limit"
            );
            slot.insert(Content {
                utf8: std::str::from_utf8(&bytes).is_ok(),
                index: LineIndex::build_shared(Arc::from(bytes)),
                raw_line_count,
            });
        }
        let content = &self.contents[&key];
        if let AnchorExtent::LineRange { start, end } = extent {
            ensure!(content.utf8, "line repair source is not UTF-8");
            ensure!(
                *start >= 1 && *end >= *start && (*end as usize) <= content.index.line_count(),
                "repair extent is outside its source content"
            );
            ensure!(
                content
                    .raw_line_count
                    .is_none_or(|count| count == content.index.line_count()),
                "git's clean filter rewrites the repair source line count"
            );
        }
        Ok(rk64_to_hex(cheap_fingerprint_indexed(
            &content.index,
            extent,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caches_file_reads_and_line_index_across_extents_but_separates_layers() -> Result<()> {
        let root = tempfile::tempdir()?;
        let init = std::process::Command::new("git")
            .current_dir(root.path())
            .args(["init", "--quiet"])
            .output()?;
        ensure!(init.status.success(), "git init failed");
        let path = root.path().join("source.txt");
        std::fs::write(&path, "index one\nindex two\n")?;
        let add = std::process::Command::new("git")
            .current_dir(root.path())
            .args(["add", "source.txt"])
            .output()?;
        ensure!(add.status.success(), "git add failed");
        std::fs::write(root.path().join(".gitattributes"), "original.txt ident\n")?;
        let repo = gix::discover(root.path())?;
        std::fs::write(&path, "worktree one\nworktree two $Id: abc $\n")?;
        let mut cache = RepairContentCache::new(&repo, crate::git::index_entries(&repo)?);
        let first = AnchorExtent::LineRange { start: 1, end: 1 };
        let second = AnchorExtent::LineRange { start: 2, end: 2 };
        cache.hash(&repo, DriftSource::Worktree, "source.txt", &first)?;
        // A second extent in the same repair must reuse the canonical file
        // snapshot and its line index, rather than invoke filters/read again.
        std::fs::remove_file(path)?;
        let worktree = cache.hash(&repo, DriftSource::Worktree, "source.txt", &second)?;
        assert_eq!(
            worktree,
            rk64_to_hex(git_span_core::cheap_fingerprint_with_extent(
                b"worktree two $Id: abc $",
                &AnchorExtent::WholeFile,
            ))
        );
        let original_rules = cache.hash_with_rules(
            &repo,
            DriftSource::Worktree,
            "source.txt",
            "original.txt",
            &second,
        )?;
        assert_eq!(
            original_rules,
            rk64_to_hex(git_span_core::cheap_fingerprint_with_extent(
                b"worktree two $Id$",
                &AnchorExtent::WholeFile,
            )),
            "both rule contexts must use the same captured physical bytes"
        );
        let index = cache.hash(&repo, DriftSource::Index, "source.txt", &second)?;
        assert_ne!(
            index, worktree,
            "staged and worktree content cannot share a cache entry"
        );
        assert!(
            cache
                .hash(
                    &repo,
                    DriftSource::Worktree,
                    "source.txt",
                    &AnchorExtent::LineRange { start: 2, end: 3 }
                )
                .is_err()
        );
        Ok(())
    }
}
