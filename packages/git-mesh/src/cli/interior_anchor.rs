//! Read-time surfacing of interior anchors (anchors pointing inside the
//! resolved mesh root).
//!
//! `MeshFile::parse` is a pure text→struct transform and deliberately does
//! NOT reject interior anchors — that would make a hand-edited / poisoned
//! mesh un-loadable, breaking the very repair commands (`remove`, `delete`,
//! `move`, `stale --fix`) an operator needs to fix it. Instead, the
//! reporting/validate surfaces (`stale`, `doctor`) load each mesh
//! independently and surface interior anchors here as a **loud, actionable,
//! per-mesh** report. One poisoned mesh never blanks the others.

use crate::mesh_root::classify_interior_anchor;

/// One interior-anchor violation found in a single mesh file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InteriorAnchorViolation {
    /// Mesh name (its path under the mesh root).
    pub mesh_name: String,
    /// The offending anchor address as stored (path plus optional line range).
    pub address: String,
    /// Human-readable detail clause from `classify_interior_anchor`.
    pub detail: String,
}

impl InteriorAnchorViolation {
    /// The repo-relative path to the mesh file carrying the violation.
    pub fn mesh_file_path(&self, mesh_root: &str) -> String {
        format!("{}/{}", mesh_root.trim_end_matches('/'), self.mesh_name)
    }

    /// A loud, actionable multi-line report block naming the mesh file, the
    /// offending anchor, the resolved mesh root, and a concrete fix using only
    /// commands that work on a poisoned mesh (`remove`, `delete`, or a
    /// hand-edit). It deliberately does NOT suggest `git mesh doctor <name>`
    /// (doctor takes no positional argument) nor `git mesh list` as the fix.
    pub fn report_block(&self, mesh_root: &str) -> String {
        let file = self.mesh_file_path(mesh_root);
        format!(
            "mesh `{name}` has an anchor inside the mesh root:\n  \
             mesh file:    {file}\n  \
             anchor:       {address}\n  \
             mesh root:    {mesh_root}\n  \
             why:          {detail}\n  \
             fix:          git mesh remove {name} {address}\n                \
             (or `git mesh delete {name}` to drop the whole mesh, or hand-edit\n                 \
             {file} to remove the offending anchor line)",
            name = self.mesh_name,
            file = file,
            address = self.address,
            mesh_root = mesh_root,
            detail = self.detail,
        )
    }
}

/// Scan every visible mesh and collect interior-anchor violations, one entry
/// per offending anchor. Loads each mesh independently so a single poisoned
/// mesh cannot abort the scan or hide clean meshes.
///
/// `load_all_meshes_in` skips meshes that fail to *parse* (conflict markers,
/// malformed lines); those are surfaced by the separate conflict / parse
/// reporting paths. Here we only classify anchor containment over the meshes
/// that loaded successfully.
pub fn scan_interior_anchors(
    repo: &gix::Repository,
    mesh_root: &str,
) -> crate::Result<Vec<InteriorAnchorViolation>> {
    let meshes = crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0;
    Ok(scan_interior_anchors_in(mesh_root, &meshes))
}

/// Same scan as [`scan_interior_anchors`] but over an already-loaded corpus,
/// so the stale path can reuse a single corpus load for both the backfill and
/// this scan. Byte-identical to the loading variant: it iterates the corpus in
/// the same order and emits one violation per offending anchor identically.
pub fn scan_interior_anchors_in(
    mesh_root: &str,
    meshes: &[(String, crate::types::Mesh)],
) -> Vec<InteriorAnchorViolation> {
    let mut violations = Vec::new();
    for (name, mesh) in meshes {
        for (_anchor_id, anchor) in &mesh.anchors {
            if let Some(detail) = classify_interior_anchor(mesh_root, &anchor.path) {
                violations.push(InteriorAnchorViolation {
                    mesh_name: name.clone(),
                    address: address_for(&anchor.path, &anchor.extent),
                    detail,
                });
            }
        }
    }
    violations
}

/// Whether any mesh in scope carries an interior anchor (an anchor whose path
/// is under `mesh_root`), classified over an already-loaded corpus so the
/// `stale --fix` pre-scan can reuse the single pre-fix corpus load instead of
/// re-reading every mesh file.
///
/// `stale --fix` uses this as a fail-closed gate: when an interior anchor is
/// present, the scoped post-fix splice and source-layer reuse are unsound (a
/// rewritten mesh file is also an anchor target, so reused pre-fix
/// `worktree_diffs` and un-re-resolved sibling meshes can render stale drift
/// status). In that case the caller falls back to a full whole-corpus /
/// full-named re-resolve, which matches the baseline byte-for-byte. Interior
/// anchors are a loud, rare error condition, so the perf cost of the fallback
/// is irrelevant — correctness wins.
///
/// `scope` is `None` for a bare scan (check the whole corpus) or `Some(names)`
/// for a named-scope query (check only the requested meshes), mirroring the
/// scoping `run_stale` already applies to `scan_interior_anchors`.
pub(crate) fn scope_has_interior_anchor_in(
    mesh_root: &str,
    meshes: &[(String, crate::types::Mesh)],
    scope: Option<&std::collections::HashSet<String>>,
) -> bool {
    for (name, mesh) in meshes {
        if let Some(names) = scope
            && !names.contains(name)
        {
            continue;
        }
        for (_anchor_id, anchor) in &mesh.anchors {
            if classify_interior_anchor(mesh_root, &anchor.path).is_some() {
                return true;
            }
        }
    }
    false
}

/// Format a stored anchor address (`path` or `path#L<start>-L<end>`) for
/// display in a violation report — the same shape `git mesh remove` accepts.
fn address_for(path: &str, extent: &crate::types::AnchorExtent) -> String {
    match extent {
        crate::types::AnchorExtent::WholeFile => path.to_string(),
        crate::types::AnchorExtent::LineRange { start, end } => {
            format!("{path}#L{start}-L{end}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn violation() -> InteriorAnchorViolation {
        InteriorAnchorViolation {
            mesh_name: "billing/flow".to_string(),
            address: ".mesh/other".to_string(),
            detail: "path `.mesh/other` points inside the mesh root `.mesh`".to_string(),
        }
    }

    #[test]
    fn report_block_names_file_anchor_root_and_working_fix() {
        let v = violation();
        let block = v.report_block(".mesh");
        assert!(block.contains(".mesh/billing/flow"), "names mesh file: {block}");
        assert!(block.contains(".mesh/other"), "names anchor: {block}");
        assert!(block.contains("mesh root:    .mesh"), "names root: {block}");
        assert!(
            block.contains("git mesh remove billing/flow .mesh/other"),
            "names working repair command: {block}"
        );
        assert!(
            block.contains("git mesh delete billing/flow"),
            "names working delete command: {block}"
        );
    }

    #[test]
    fn report_block_does_not_suggest_broken_guidance() {
        let block = violation().report_block(".mesh");
        assert!(
            !block.contains("git mesh doctor billing/flow"),
            "must not suggest positional `doctor <name>`: {block}"
        );
        // `git mesh list` must not appear as the fix line.
        assert!(
            !block.contains("fix:          git mesh list"),
            "must not name `list` as the fix: {block}"
        );
    }
}
