//! Shared location and tree-listing helpers for the resolver: the
//! [`Tracked`] location type, the rename-detection budget, the hunk-to-range
//! projection used by layer replay, and whole-tree path listings.

use crate::{Error, Result};

#[derive(Clone, Debug)]
pub(crate) struct Tracked {
    pub(crate) path: String,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

pub(crate) const RENAME_BUDGET_DEFAULT: usize = 1000;

pub(crate) fn rename_budget() -> usize {
    std::env::var("GIT_SPAN_RENAME_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(RENAME_BUDGET_DEFAULT)
}

pub(crate) fn apply_hunks_to_range(
    hunks: &[(u32, u32, u32, u32)],
    start: u32,
    end: u32,
) -> (u32, u32) {
    let mut s = start as i64;
    let mut e = end as i64;
    for (os, oc, _ns, nc) in hunks {
        let os = *os as i64;
        let oc = *oc as i64;
        let nc = *nc as i64;
        let delta = nc - oc;
        if oc == 0 {
            if os < s {
                s += delta;
                e += delta;
            } else if os >= e {
                // no effect
            } else {
                e += delta;
            }
            continue;
        }
        let old_last = os + oc - 1;
        if old_last < s {
            s += delta;
            e += delta;
        } else if os > e {
            // no effect
        } else {
            let new_last = if nc == 0 { os } else { os + nc - 1 };
            s = (s.min(os)).max(1);
            e = new_last.max(e + delta);
        }
    }
    let s = s.max(1) as u32;
    let e = e.max(s as i64) as u32;
    (s, e)
}

/// Collect all blob paths from `tree` into a `Vec<(path, blob_oid_string)>`.
pub(crate) fn tree_blob_paths(tree: &gix::Tree<'_>) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    tree.traverse()
        .breadthfirst
        .files()
        .map_err(|e| Error::Git(format!("tree traverse: {e}")))?
        .into_iter()
        .for_each(|entry| {
            let path = entry.filepath.to_string();
            let oid = entry.oid.to_string();
            out.push((path, oid));
        });
    Ok(out)
}

/// Collect every entry path present in `tree` — blobs, directories,
/// symlinks, and gitlinks alike — via one breadth-first traversal.
///
/// Entry-universe proof: `crate::git::tree_entry_at` resolves through
/// `gix`'s per-component tree lookup (`Tree::lookup_entry_by_path` ->
/// `gix_object::tree::next_entry`), which returns `Some(entry)` for the
/// final path component once the component iterator is exhausted,
/// regardless of that entry's `EntryMode` — a directory-only path is a
/// legitimate `Some`. The `gix_traverse::tree::Recorder` used here (via
/// `.breadthfirst.files()`, whose name is misleading — it does not filter
/// by kind) records every entry the same way: `visit_tree` and
/// `visit_nontree` both push to `records`. So this function's output set
/// has exactly the same membership as `tree_entry_at(tree, path).is_some()`
/// for every path reachable from `tree`: a path that names a directory in
/// this tree is "taken" here just as it would be via a direct probe, so a
/// candidate that later becomes a file is still correctly excluded from
/// being treated as unclaimed.
pub(crate) fn tree_all_paths(tree: &gix::Tree<'_>) -> Result<std::collections::HashSet<String>> {
    let mut out = std::collections::HashSet::new();
    tree.traverse()
        .breadthfirst
        .files()
        .map_err(|e| Error::Git(format!("tree traverse: {e}")))?
        .into_iter()
        .for_each(|entry| {
            out.insert(entry.filepath.to_string());
        });
    Ok(out)
}

