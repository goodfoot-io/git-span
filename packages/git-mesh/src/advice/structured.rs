//! Structured-English display types and overlap predicates for the advice CLI.

use std::fmt;

use crate::types::{AnchorExtent, AnchorResolved};

// ── Action ────────────────────────────────────────────────────────────────────

/// A developer action that may overlap with a mesh anchor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// A line-range read or edit on a specific path.
    Range { path: String, start: u32, end: u32 },
    /// A whole-file read or edit.
    WholeFile { path: String },
}

/// Return true when `action` overlaps `anchor` on the **read** path.
///
/// Rules:
/// - `Action::Range` matches only `AnchorExtent::LineRange` anchors on the
///   same path where the line spans intersect (`max(starts) <= min(ends)`).
/// - `Action::WholeFile` matches only `AnchorExtent::WholeFile` anchors on
///   the same path.
///
/// Cross-kind matches (range action vs whole-file anchor, or vice versa) are
/// intentionally excluded: the spec treats them as distinct coverage types
/// and `read` actions always carry exact extent information.
pub fn read_overlaps(action: &Action, anchor: &AnchorResolved) -> bool {
    let anchor_path = anchor.anchored.path.to_string_lossy();
    match (action, &anchor.anchored.extent) {
        (
            Action::Range {
                path,
                start: a_start,
                end: a_end,
            },
            AnchorExtent::LineRange {
                start: r_start,
                end: r_end,
            },
        ) => {
            if path.as_str() != anchor_path.as_ref() {
                return false;
            }
            // Intersect: [a_start..a_end] ∩ [r_start..r_end] is non-empty.
            let lo = (*a_start).max(*r_start);
            let hi = (*a_end).min(*r_end);
            lo <= hi
        }
        (Action::WholeFile { path }, AnchorExtent::WholeFile) => {
            path.as_str() == anchor_path.as_ref()
        }
        // Cross-kind: no match.
        _ => false,
    }
}

/// Return true when `action` overlaps `anchor` on the **edit** path.
///
/// Same as [`read_overlaps`] for range actions. For `Action::WholeFile`,
/// matches **both** whole-file and range anchors on the same path, because
/// snapshot-derived edits carry no hunk bounds — `Action::WholeFile` is a
/// fallback that means "something changed in this file" and any anchor on
/// the path is potentially affected.
pub fn edit_overlaps(action: &Action, anchor: &AnchorResolved) -> bool {
    let anchor_path = anchor.anchored.path.to_string_lossy();
    match (action, &anchor.anchored.extent) {
        // Range action: same strict intersection as read_overlaps.
        (
            Action::Range {
                path,
                start: a_start,
                end: a_end,
            },
            AnchorExtent::LineRange {
                start: r_start,
                end: r_end,
            },
        ) => {
            if path.as_str() != anchor_path.as_ref() {
                return false;
            }
            let lo = (*a_start).max(*r_start);
            let hi = (*a_end).min(*r_end);
            lo <= hi
        }
        // Range action vs whole-file anchor: no match (same as read_overlaps).
        (Action::Range { .. }, AnchorExtent::WholeFile) => false,
        // Whole-file action: matches both whole-file AND range anchors on same path.
        // This is the relaxed companion: snapshot-derived edits lack hunk bounds,
        // so any anchor on the path is considered potentially affected.
        (Action::WholeFile { path }, _) => path.as_str() == anchor_path.as_ref(),
    }
}

// ── BasicOutput ───────────────────────────────────────────────────────────────

/// One mesh announce block as specified by the structured-English spec's
/// `BASIC_OUTPUT` template:
///
/// ```text
/// <active_anchor> is in the <mesh_name> mesh with:
/// - <non_active_anchor_1>
/// - <non_active_anchor_2>
///
/// <why>
/// ```
pub struct BasicOutput {
    /// The anchor whose action triggered this output.
    pub active_anchor: String,
    /// Mesh name (the `refs/meshes/v1/<name>` suffix).
    pub mesh_name: String,
    /// One-sentence description from `git mesh why`.
    pub why: String,
    /// The other anchors in the mesh (excluding the active anchor).
    pub non_active_anchors: Vec<String>,
}

impl fmt::Display for BasicOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "{} is in the `{}` mesh with:",
            self.active_anchor, self.mesh_name
        )?;
        for anchor in &self.non_active_anchors {
            writeln!(f, "- {anchor}")?;
        }
        if !self.why.is_empty() {
            writeln!(f)?;
            writeln!(f, "Why: {}", self.why)?;
        }
        Ok(())
    }
}

/// Format an `AnchorResolved` as `path#L<start>-L<end>` (range) or `path` (whole-file).
pub fn format_anchor_resolved(a: &AnchorResolved) -> String {
    let path = a.anchored.path.to_string_lossy();
    match &a.anchored.extent {
        AnchorExtent::LineRange { start, end } => format!("{path}#L{start}-L{end}"),
        AnchorExtent::WholeFile => path.into_owned(),
    }
}

/// Convenience: build an `Action` from a plain repo-relative path string
/// (no `#L` suffix → whole-file; `path#L<s>-L<e>` → range).
pub fn action_from_spec(spec: &str) -> Option<Action> {
    if let Some((path, frag)) = spec.split_once("#L") {
        let (s, e) = frag.split_once("-L")?;
        let start: u32 = s.parse().ok()?;
        let end: u32 = e.parse().ok()?;
        Some(Action::Range {
            path: path.to_string(),
            start,
            end,
        })
    } else {
        Some(Action::WholeFile {
            path: spec.to_string(),
        })
    }
}
