//! Read-time surfacing of interior anchors (anchors pointing inside the
//! resolved span root).
//!
//! `SpanFile::parse` is a pure text→struct transform and deliberately does
//! NOT reject interior anchors — that would make a hand-edited / poisoned
//! span un-loadable, breaking the very repair commands (`remove`, `delete`,
//! `move`, `stale --fix`) an operator needs to fix it. Instead, the
//! reporting/validate surfaces (`stale`, `doctor`) load each span
//! independently and surface interior anchors here as a **loud, actionable,
//! per-span** report. One poisoned span never blanks the others.

use crate::span_root::classify_interior_anchor;

/// One interior-anchor violation found in a single span file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InteriorAnchorViolation {
    /// Span name (its path under the span root).
    pub span_name: String,
    /// The offending anchor address as stored (path plus optional line range).
    pub address: String,
    /// Human-readable detail clause from `classify_interior_anchor`.
    pub detail: String,
}

impl InteriorAnchorViolation {
    /// The repo-relative path to the span file carrying the violation.
    pub fn span_file_path(&self, span_root: &str) -> String {
        format!("{}/{}", span_root.trim_end_matches('/'), self.span_name)
    }

    /// A loud, actionable multi-line report block naming the span file, the
    /// offending anchor, the resolved span root, and a concrete fix using only
    /// commands that work on a poisoned span (`remove`, `delete`, or a
    /// hand-edit). It deliberately does NOT suggest `git span doctor <name>`
    /// (doctor takes no positional argument) nor `git span list` as the fix.
    pub fn report_block(&self, span_root: &str) -> String {
        let file = self.span_file_path(span_root);
        format!(
            "span `{name}` has an anchor inside the span root:\n  \
             span file:    {file}\n  \
             anchor:       {address}\n  \
             span root:    {span_root}\n  \
             why:          {detail}\n  \
             fix:          git span remove {name} {address}\n                \
             (or `git span delete {name}` to drop the whole span, or hand-edit\n                 \
             {file} to remove the offending anchor line)",
            name = self.span_name,
            file = file,
            address = self.address,
            span_root = span_root,
            detail = self.detail,
        )
    }
}

/// Scan every visible span and collect interior-anchor violations, one entry
/// per offending anchor. Loads each span independently so a single poisoned
/// span cannot abort the scan or hide clean spans.
///
/// `load_all_spans_in` skips spans that fail to *parse* (conflict markers,
/// malformed lines); those are surfaced by the separate conflict / parse
/// reporting paths. Here we only classify anchor containment over the spans
/// that loaded successfully.
pub fn scan_interior_anchors(
    repo: &gix::Repository,
    span_root: &str,
) -> crate::Result<Vec<InteriorAnchorViolation>> {
    let spans = crate::span::read::load_all_spans_in(repo, span_root)?.0;
    Ok(scan_interior_anchors_in(span_root, &spans))
}

/// Same scan as [`scan_interior_anchors`] but over an already-loaded corpus,
/// so the stale path can reuse a single corpus load for both the backfill and
/// this scan. Byte-identical to the loading variant: it iterates the corpus in
/// the same order and emits one violation per offending anchor identically.
pub fn scan_interior_anchors_in(
    span_root: &str,
    spans: &[(String, crate::types::Span)],
) -> Vec<InteriorAnchorViolation> {
    let mut violations = Vec::new();
    for (name, span) in spans {
        for (_anchor_id, anchor) in &span.anchors {
            if let Some(detail) = classify_interior_anchor(span_root, &anchor.path) {
                violations.push(InteriorAnchorViolation {
                    span_name: name.clone(),
                    address: address_for(&anchor.path, &anchor.extent),
                    detail,
                });
            }
        }
    }
    violations
}

/// Whether any span in scope carries an interior anchor (an anchor whose path
/// is under `span_root`), classified over an already-loaded corpus so the
/// `stale --fix` pre-scan can reuse the single pre-fix corpus load instead of
/// re-reading every span file.
///
/// `stale --fix` uses this as a fail-closed gate: when an interior anchor is
/// present, the scoped post-fix splice and source-layer reuse are unsound (a
/// rewritten span file is also an anchor target, so reused pre-fix
/// `worktree_diffs` and un-re-resolved sibling spans can render stale drift
/// status). In that case the caller falls back to a full whole-corpus /
/// full-named re-resolve, which matches the baseline byte-for-byte. Interior
/// anchors are a loud, rare error condition, so the perf cost of the fallback
/// is irrelevant — correctness wins.
///
/// `scope` is `None` for a bare scan (check the whole corpus) or `Some(names)`
/// for a named-scope query (check only the requested spans), mirroring the
/// scoping `run_stale` already applies to `scan_interior_anchors`.
pub(crate) fn scope_has_interior_anchor_in(
    span_root: &str,
    spans: &[(String, crate::types::Span)],
    scope: Option<&std::collections::HashSet<String>>,
) -> bool {
    for (name, span) in spans {
        if let Some(names) = scope
            && !names.contains(name)
        {
            continue;
        }
        for (_anchor_id, anchor) in &span.anchors {
            if classify_interior_anchor(span_root, &anchor.path).is_some() {
                return true;
            }
        }
    }
    false
}

/// Format a stored anchor address (`path` or `path#L<start>-L<end>`) for
/// display in a violation report — the same shape `git span remove` accepts.
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
            span_name: "billing/flow".to_string(),
            address: ".span/other".to_string(),
            detail: "path `.span/other` points inside the span root `.span`".to_string(),
        }
    }

    #[test]
    fn report_block_names_file_anchor_root_and_working_fix() {
        let v = violation();
        let block = v.report_block(".span");
        assert!(block.contains(".span/billing/flow"), "names span file: {block}");
        assert!(block.contains(".span/other"), "names anchor: {block}");
        assert!(block.contains("span root:    .span"), "names root: {block}");
        assert!(
            block.contains("git span remove billing/flow .span/other"),
            "names working repair command: {block}"
        );
        assert!(
            block.contains("git span delete billing/flow"),
            "names working delete command: {block}"
        );
    }

    #[test]
    fn report_block_does_not_suggest_broken_guidance() {
        let block = violation().report_block(".span");
        assert!(
            !block.contains("git span doctor billing/flow"),
            "must not suggest positional `doctor <name>`: {block}"
        );
        // `git span list` must not appear as the fix line.
        assert!(
            !block.contains("fix:          git span list"),
            "must not name `list` as the fix: {block}"
        );
    }
}
