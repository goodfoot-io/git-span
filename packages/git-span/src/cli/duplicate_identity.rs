//! Read-time surfacing of duplicate anchor identities (two or more records
//! sharing one `(path, start_line, end_line)`).
//!
//! `SpanFile::parse` accepts duplicates deliberately — it is a pure
//! text→struct transform, so a hand-edited or merge-damaged span stays
//! loadable and therefore repairable. Nothing about a duplicate is
//! ill-formed, so `validate` has nothing to say about it either; the state
//! only shows itself as one identity reported in two different drift states.
//! `doctor` is the audit surface that names it before an operator trips over
//! it, as a **loud, actionable, per-identity** report. This mirrors the
//! interior-anchor surfacing in [`crate::cli::interior_anchor`] exactly.

use crate::span_file::AnchorRecord;
use crate::span_file_reader::SpanFileReader;

/// One duplicate-identity group found in a single span file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuplicateIdentity {
    /// Span name (its path under the span root).
    pub span_name: String,
    /// The duplicated anchor address as stored (path plus optional line range).
    pub address: String,
    /// How many records share that identity (always >= 2).
    pub records: usize,
}

impl DuplicateIdentity {
    /// The repo-relative path to the span file carrying the duplicate.
    pub fn span_file_path(&self, span_root: &str) -> String {
        format!("{}/{}", span_root.trim_end_matches('/'), self.span_name)
    }

    /// A loud, actionable multi-line report block naming the span file, the
    /// duplicated identity, the record count, and the one command that
    /// actually repairs it.
    ///
    /// The fix is `git span drift --fix` and nothing else. `git span add`
    /// looks like an alternative — it collapses every record at the identity
    /// it is handed — but its existence probe and `validate_add_target` both
    /// run *before* the span file is read, so it refuses outright on a path
    /// that no longer exists in the worktree. Naming it here as an
    /// interchangeable option would send an operator down a path that
    /// fail-closes for exactly the population most likely to have collected a
    /// duplicate.
    ///
    /// The block also carries the layer caveat, for the same reason
    /// `drift --fix`'s interior-anchor repair carries one: this scan reads the
    /// *effective* span, which is the worktree file whenever one exists, and
    /// every mutation path writes that same worktree file. A duplicate living
    /// only in HEAD or the index — no worktree copy — is outside both: the
    /// missing worktree file reads as a deletion tombstone, so the scan never
    /// reports it, and `--fix` would not write it either. Stating the scope in
    /// the finding is what keeps an operator from reading a clean `doctor` as
    /// proof that a duplicate they saw elsewhere is gone.
    pub fn report_block(&self, span_root: &str) -> String {
        let file = self.span_file_path(span_root);
        format!(
            "span `{name}` carries {records} records for one anchor identity:\n  \
             span file:    {file}\n  \
             identity:     {address}\n  \
             records:      {records}\n  \
             why:          records sharing one (path, start line, end line) can carry\n                \
             different content hashes, so the identity reports in two states at once\n  \
             fix:          git span drift --fix\n                \
             (`git span add` cannot repair this: its existence probe runs before\n                 \
             the span file is read, so it refuses on a path that no longer exists\n                 \
             in the worktree)\n  \
             caveat:       this check reads the effective span — the worktree file\n                \
             whenever one exists — and every mutation writes that same worktree\n                \
             file. A duplicate present only in HEAD or the index, with no worktree\n                \
             copy, is outside both: the missing worktree file reads as a deletion\n                \
             tombstone, so it is not reported here and `git span drift --fix` would\n                \
             not write it either. Restore {file} in the worktree first, then fix.",
            name = self.span_name,
            file = file,
            address = self.address,
            records = self.records,
        )
    }
}

/// Scan every visible span's *effective* content and collect duplicate
/// identities, one entry per duplicated identity (not per record). Loads each
/// span independently so a single unreadable span cannot abort the scan or
/// hide clean spans.
///
/// Spans that fail to read or parse are skipped silently here — `doctor`
/// already reports those through its own parse check, and a second report of
/// the same file would say nothing new.
pub fn scan_duplicate_identities(
    repo: &gix::Repository,
    span_root: &str,
) -> crate::Result<Vec<DuplicateIdentity>> {
    let reader = SpanFileReader::new(repo, span_root.to_string());
    let mut findings = Vec::new();
    for name in reader.list_span_names()? {
        let Ok(Some(file)) = reader.read_effective(&name) else {
            continue;
        };
        findings.extend(duplicates_in(&name, &file.anchors));
    }
    Ok(findings)
}

/// Group `anchors` by identity and emit one finding per group holding more
/// than one record, in canonical `(path, start_line, end_line)` order so the
/// report is independent of the file's record order.
fn duplicates_in(span_name: &str, anchors: &[AnchorRecord]) -> Vec<DuplicateIdentity> {
    let mut counts: std::collections::BTreeMap<(&str, u32, u32), usize> =
        std::collections::BTreeMap::new();
    for a in anchors {
        *counts
            .entry((a.path.as_str(), a.start_line, a.end_line))
            .or_insert(0) += 1;
    }
    counts
        .into_iter()
        .filter(|(_, n)| *n > 1)
        .map(|((path, start, end), records)| DuplicateIdentity {
            span_name: span_name.to_string(),
            address: address_for(path, start, end),
            records,
        })
        .collect()
}

/// Format a stored anchor address (`path` or `path#L<start>-L<end>`) — the
/// same shape `git span add`/`remove` accept, and the same shape the
/// interior-anchor report uses.
fn address_for(path: &str, start: u32, end: u32) -> String {
    if start == 0 && end == 0 {
        path.to_string()
    } else {
        format!("{path}#L{start}-L{end}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(path: &str, start: u32, end: u32, hash: &str) -> AnchorRecord {
        AnchorRecord {
            path: path.to_string(),
            start_line: start,
            end_line: end,
            algorithm: "rk64".to_string(),
            content_hash: hash.to_string(),
        }
    }

    #[test]
    fn duplicates_are_grouped_by_identity_not_by_hash() {
        let anchors = vec![
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/b.rs", 1, 5, "cccccccccccccccc"),
            record("src/a.rs", 1, 5, "bbbbbbbbbbbbbbbb"),
            record("src/a.rs", 1, 5, "dddddddddddddddd"),
        ];
        let found = duplicates_in("billing/flow", &anchors);
        assert_eq!(found.len(), 1, "one finding per identity: {found:?}");
        assert_eq!(found[0].address, "src/a.rs#L1-L5");
        assert_eq!(found[0].records, 3, "the true N, not a pairwise count");
    }

    #[test]
    fn a_span_without_duplicates_reports_nothing() {
        let anchors = vec![
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/a.rs", 6, 9, "bbbbbbbbbbbbbbbb"),
            record("src/b.rs", 1, 5, "cccccccccccccccc"),
        ];
        assert!(duplicates_in("billing/flow", &anchors).is_empty());
    }

    #[test]
    fn report_block_names_file_identity_count_and_the_only_working_fix() {
        let f = DuplicateIdentity {
            span_name: "billing/flow".to_string(),
            address: "src/a.rs#L1-L5".to_string(),
            records: 2,
        };
        let block = f.report_block(".span");
        assert!(
            block.contains(".span/billing/flow"),
            "names span file: {block}"
        );
        assert!(block.contains("src/a.rs#L1-L5"), "names identity: {block}");
        assert!(block.contains("records:      2"), "names count: {block}");
        assert!(
            block.contains("fix:          git span drift --fix"),
            "names the working repair command: {block}"
        );
    }

    #[test]
    fn report_block_does_not_offer_add_as_the_fix_and_states_the_layer_caveat() {
        let f = DuplicateIdentity {
            span_name: "billing/flow".to_string(),
            address: "src/a.rs#L1-L5".to_string(),
            records: 2,
        };
        let block = f.report_block(".span");
        assert!(
            !block.contains("fix:          git span add"),
            "`add` must never be named as the fix: {block}"
        );
        assert!(
            block.contains("present only in HEAD or the index, with no worktree"),
            "states the non-worktree-layer caveat: {block}"
        );
    }
}
