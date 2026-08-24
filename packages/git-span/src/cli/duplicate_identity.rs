//! Read-time surfacing of duplicate anchor identities (two or more records
//! sharing one `(path, start_line, end_line)`).
//!
//! `SpanFile::parse` accepts duplicates deliberately — it is a pure
//! text→struct transform, so a hand-edited or merge-damaged span stays
//! loadable and therefore repairable. Nothing about a duplicate is
//! ill-formed, so `validate` has nothing to say about it either; the state
//! only shows itself later — as one identity reported in two drift states
//! when the records disagree, or as a silently doubled record when they
//! agree. `doctor` is the audit surface that names it before an operator
//! trips over it, as a **loud, actionable, per-identity** report. This
//! mirrors the interior-anchor surfacing in [`crate::cli::interior_anchor`]
//! exactly.

use crate::span_file::AnchorRecord;
use crate::span_file_reader::SpanFileReader;

/// One duplicate-identity group found in a single span file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuplicateIdentity {
    /// Span name (its path under the span root).
    pub span_name: String,
    /// The anchored path, without the line range.
    pub path: String,
    /// The duplicated anchor address as stored (path plus optional line range).
    pub address: String,
    /// How many records share that identity (always >= 2).
    pub records: usize,
    /// Whether every record at the identity carries the same
    /// `(algorithm, content_hash)`.
    ///
    /// This is the common case and not the alarming one: `drift --fix`
    /// re-anchoring two ranges onto one destination produces exactly it, and
    /// the records agree completely about what the identity tracks. The
    /// divergent case is the one where the identity genuinely reports in two
    /// states at once. The finding's `why:` line branches on this, because a
    /// sentence that is true of one is false of the other.
    pub hashes_agree: bool,
    /// Why `git span add <name> <address>` would refuse this identity, or
    /// `None` when it will run. See [`add_refusal`].
    pub add_refusal: Option<AddRefusal>,
}

/// A reason `git span add <NAME> <ADDRESS>` fails *before* it ever reads the
/// span file, and therefore a reason no surface may name it as the one-step
/// repair for a duplicate identity at that address.
///
/// These refusals are the whole reason `add` cannot be recommended
/// unconditionally. They are also easy to under-count: gating on existence
/// alone is necessary and not sufficient, because a file that exists can
/// still be too short to hold the anchored range, and `add` rejects that
/// with a bare `anyhow` bail — no `CliError` block, no next steps — which is
/// the worst version of the refusal for the operator to receive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddRefusal {
    /// Neither tracked in the index nor present in the worktree, so `add`'s
    /// existence probe rejects it.
    PathMissing,
    /// The file is there but has fewer lines than the anchored range needs,
    /// so `add`'s range check rejects it (`end` exceeds the line count).
    RangePastEof {
        /// Lines the file actually has now.
        lines: u32,
    },
}

/// Will `git span add <NAME> <address>` actually run against this address?
///
/// One predicate, because the alternative is what produced three defects in
/// one card: independent gates at each surface, each covering the subset of
/// refusals whoever wrote it happened to think of. `doctor`'s `fix:` line and
/// the collapsed-duplicate annotations in [`crate::cli::drift_output`] and
/// [`crate::cli::drift_fix`] all answer to this one rule: **a surface may
/// recommend `add` only where `add` runs.**
///
/// The third instance is worth recording, because it is the one that proves
/// why the rule has to be a shared function rather than a shared intention.
/// The drift annotation's first attempt gated on `AnchorStatus::Deleted`,
/// reasoning that the resolver already reports `Deleted` both for a vanished
/// path *and* for a file that no longer reaches the anchored end. The second
/// half of that is false — a truncated file resolves `Changed` — so the
/// annotation kept printing an `add` that exits 1, at the same address where
/// `doctor`, gated on the real predicate, correctly withheld it. A status is
/// a fact about drift; whether `add` runs is a fact about the filesystem, and
/// no amount of care spent picking the right status proxy makes it the same
/// question. See [`AddAvailability`], which is how the surfaces ask.
///
/// `line_count` is `None` for a whole-file address, which has no range to
/// outrun, and for a path that could not be read — the caller has already
/// established existence by then, so an unreadable file is left to `add`'s
/// own error rather than guessed at here.
///
/// Deliberately *not* exhaustive over every precheck in
/// [`crate::types::validate_add_target`]: binary content, symlinks,
/// gitignored paths, and submodule interiors all refuse too, but none of
/// them can be reached by a duplicate identity that a previous `add` or
/// `drift --fix` created, because those same prechecks would have rejected
/// the record when it was written. Existence and range are the two that a
/// *later* edit to the repository can introduce under a record that was
/// legal when it was made, which is exactly why they are the two that bite.
pub fn add_refusal(path_exists: bool, end_line: u32, line_count: Option<u32>) -> Option<AddRefusal> {
    if !path_exists {
        return Some(AddRefusal::PathMissing);
    }
    match line_count {
        Some(lines) if end_line > lines => Some(AddRefusal::RangePastEof { lines }),
        _ => None,
    }
}

/// The filesystem probes behind [`add_refusal`], gathered once and asked
/// many times.
///
/// This is the shared form of the predicate — the thing a surface holds so
/// that it *cannot* answer "will `add` run here" by any other means. Every
/// caller that recommends `add` builds one of these and asks it; none of them
/// re-derive the answer from a status, a path string, or a hunch.
///
/// Cheap to hold and cheap to ask: the index is read once at construction,
/// and only the range check touches the disk, only for a ranged address, only
/// on a path that already passed the existence probe.
pub struct AddAvailability {
    /// Paths tracked in the index, for the half of `add`'s existence probe
    /// that a file absent from the worktree can still satisfy.
    index_paths: std::collections::HashSet<String>,
    /// The worktree root, absent in a bare repository — in which case the
    /// existence probe falls back to the index alone, which errs toward
    /// reporting a refusal rather than toward advice that fail-closes.
    workdir: Option<std::path::PathBuf>,
}

impl AddAvailability {
    /// Read the probes out of `repo`. Reading the index is best-effort for
    /// the same reason it is in the scan: a repository without a readable
    /// index should degrade to worktree-only existence testing, not fail.
    pub fn probe(repo: &gix::Repository) -> Self {
        Self {
            index_paths: crate::git::index_entries(repo)
                .unwrap_or_default()
                .into_iter()
                .map(|en| en.path)
                .collect(),
            workdir: repo.workdir().map(std::path::Path::to_path_buf),
        }
    }

    /// Why `git span add <NAME> <path>#L<..>-L<end_line>` would refuse, or
    /// `None` when it will run.
    ///
    /// `end_line` is `0` for a whole-file address, which has no range to
    /// outrun and is therefore never gated on length.
    pub fn refusal(&self, path: &str, end_line: u32) -> Option<AddRefusal> {
        let exists = self.index_paths.contains(path)
            || self
                .workdir
                .as_ref()
                .is_some_and(|w| w.join(path).exists());
        let line_count = if end_line == 0 {
            None
        } else {
            self.line_count(path)
        };
        add_refusal(exists, end_line, line_count)
    }

    /// Lines in the worktree copy of `path`, or `None` when there is no
    /// worktree copy to count.
    ///
    /// The worktree file is the right one to measure: it is the content
    /// `add` would hash, and the same effective span the duplicate scan
    /// reads. A path tracked but not materialized here yields `None`, which
    /// leaves the range ungated — `add`'s own error for that case names the
    /// real condition better than a guess made from a missing file would.
    fn line_count(&self, path: &str) -> Option<u32> {
        let bytes = std::fs::read(self.workdir.as_ref()?.join(path)).ok()?;
        if bytes.is_empty() {
            return Some(0);
        }
        let mut lines = bytes.iter().filter(|b| **b == b'\n').count();
        if !bytes.ends_with(b"\n") {
            lines += 1;
        }
        u32::try_from(lines).ok()
    }
}

impl DuplicateIdentity {
    /// The repo-relative path to the span file carrying the duplicate.
    pub fn span_file_path(&self, span_root: &str) -> String {
        format!("{}/{}", span_root.trim_end_matches('/'), self.span_name)
    }

    /// A loud, actionable multi-line report block naming the span file, the
    /// duplicated identity, the record count, and the command that actually
    /// repairs it *for this finding*.
    ///
    /// Both the `why:` and the `fix:` line branch, because the unconditional
    /// forms of each were wrong for one of the two populations they served.
    ///
    /// `fix:` branches on [`Self::add_refusal`]. `git span add` is the
    /// one-step repair — it removes every record at the identity it is handed
    /// and installs one hashed from the named content — but several of its
    /// prechecks run *before* the span file is read, and each one turns the
    /// recommendation into a command that exits non-zero. Gating on existence
    /// alone was necessary and not sufficient: a file that still exists but
    /// has been truncated below the anchored end refuses too, with a bare
    /// `invalid anchor: end=N exceeds file line count (M)` and no next steps,
    /// while `drift --fix` repairs it perfectly well. The gate is the shared
    /// [`add_refusal`] predicate, so widening it widens every surface at
    /// once. When `add` runs, say `add`; when it does not, say `drift --fix`
    /// and say precisely which refusal is in the way.
    ///
    /// `why:` branches on [`Self::hashes_agree`]. "the identity reports in
    /// two states at once" is a true and useful sentence about a divergent
    /// pair and a false one about an agreed pair, whose records agree
    /// completely — so for the agreed case the clause is dropped rather than
    /// qualified. A hedge would leave the reader holding a claim plus a
    /// retraction of it.
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
        let why = if self.hashes_agree {
            "records sharing one (path, start line, end line) are one identity\n                \
             stored more than once; these records carry the same content hash"
                .to_string()
        } else {
            "records sharing one (path, start line, end line) can carry\n                \
             different content hashes, and these do, so the identity reports in\n                \
             two states at once"
                .to_string()
        };
        let fix = match self.add_refusal {
            None => format!(
                "git span add {name} {address}\n                \
                 (one step: `add` retires every record at the identity and installs\n                 \
                 one hashed from the named content. `git span drift --fix` also\n                 \
                 collapses it, over a whole-repository sweep rather than this anchor)",
                name = self.span_name,
                address = self.address,
            ),
            Some(AddRefusal::PathMissing) => format!(
                "git span drift --fix\n                \
                 (`git span add {name} {address}` cannot repair this one: its existence\n                 \
                 probe runs before the span file is read, and `{path}` is neither\n                 \
                 tracked nor present in the worktree, so `add` refuses outright)",
                name = self.span_name,
                address = self.address,
                path = self.path,
            ),
            Some(AddRefusal::RangePastEof { lines }) => format!(
                "git span drift --fix\n                \
                 (`git span add {name} {address}` cannot repair this one: `{path}` is\n                 \
                 {lines} line{plural} long, so the anchored range runs past its end and\n                 \
                 `add`'s range check refuses before the span file is read)",
                name = self.span_name,
                address = self.address,
                path = self.path,
                plural = if lines == 1 { "" } else { "s" },
            ),
        };
        format!(
            "span `{name}` carries {records} records for one anchor identity:\n  \
             span file:    {file}\n  \
             identity:     {address}\n  \
             records:      {records}\n  \
             why:          {why}\n  \
             fix:          {fix}\n  \
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
            why = why,
            fix = fix,
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
    // The same prechecks `git span add` runs before it reads the span file,
    // asked through the same object every other surface asks — so `doctor`'s
    // `fix:` line offers `add` exactly when the drift annotations do, and
    // exactly when `add` will not refuse.
    let available = AddAvailability::probe(repo);

    let reader = SpanFileReader::new(repo, span_root.to_string());
    let mut findings = Vec::new();
    // One capture for the whole per-span scan (card main-290).
    let layers = crate::span_file_reader::LayerSnapshot::default();
    for name in reader.list_span_names()? {
        let Ok(Some(file)) = reader.read_effective_with_layers(&name, &layers) else {
            continue;
        };
        findings.extend(duplicates_in(&name, &file.anchors, &|path, end| {
            available.refusal(path, end)
        }));
    }
    Ok(findings)
}

/// Group `anchors` by identity and emit one finding per group holding more
/// than one record, in canonical `(path, start_line, end_line)` order so the
/// report is independent of the file's record order.
fn duplicates_in(
    span_name: &str,
    anchors: &[AnchorRecord],
    refusal: &impl Fn(&str, u32) -> Option<AddRefusal>,
) -> Vec<DuplicateIdentity> {
    // Group the records themselves rather than counting them: whether the
    // group's hashes agree decides which `why:` sentence is true of it, and
    // that cannot be recovered from a tally.
    let mut groups: std::collections::BTreeMap<(&str, u32, u32), Vec<&AnchorRecord>> =
        std::collections::BTreeMap::new();
    for a in anchors {
        groups
            .entry((&*a.path, a.start_line, a.end_line))
            .or_default()
            .push(a);
    }
    groups
        .into_iter()
        .filter(|(_, group)| group.len() > 1)
        .map(|((path, start, end), group)| {
            let first = group[0];
            let hashes_agree = group
                .iter()
                .all(|a| a.algorithm == first.algorithm && a.content_hash == first.content_hash);
            DuplicateIdentity {
                span_name: span_name.to_string(),
                path: path.into(),
                address: address_for(path, start, end),
                records: group.len(),
                hashes_agree,
                add_refusal: refusal(path, end),
            }
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
            path: path.into(),
            start_line: start,
            end_line: end,
            algorithm: "rk64".into(),
            content_hash: hash.into(),
        }
    }

    fn finding(hashes_agree: bool, path_exists: bool) -> DuplicateIdentity {
        DuplicateIdentity {
            span_name: "billing/flow".to_string(),
            path: "src/a.rs".to_string(),
            address: "src/a.rs#L1-L5".to_string(),
            records: 2,
            hashes_agree,
            add_refusal: add_refusal(path_exists, 5, Some(5)),
        }
    }

    /// Every path present and long enough, so the gate never fires except
    /// where a test sets out to fire it.
    fn add_runs(_: &str, _: u32) -> Option<AddRefusal> {
        None
    }

    #[test]
    fn duplicates_are_grouped_by_identity_not_by_hash() {
        let anchors = vec![
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/b.rs", 1, 5, "cccccccccccccccc"),
            record("src/a.rs", 1, 5, "bbbbbbbbbbbbbbbb"),
            record("src/a.rs", 1, 5, "dddddddddddddddd"),
        ];
        let found = duplicates_in("billing/flow", &anchors, &add_runs);
        assert_eq!(found.len(), 1, "one finding per identity: {found:?}");
        assert_eq!(found[0].address, "src/a.rs#L1-L5");
        assert_eq!(found[0].records, 3, "the true N, not a pairwise count");
        assert!(!found[0].hashes_agree, "three distinct hashes diverge");
    }

    #[test]
    fn a_span_without_duplicates_reports_nothing() {
        let anchors = vec![
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/a.rs", 6, 9, "bbbbbbbbbbbbbbbb"),
            record("src/b.rs", 1, 5, "cccccccccccccccc"),
        ];
        assert!(duplicates_in("billing/flow", &anchors, &add_runs).is_empty());
    }

    #[test]
    fn identical_hash_duplicates_are_reported_as_agreeing() {
        let anchors = vec![
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/a.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/a.rs", 9, 9, "bbbbbbbbbbbbbbbb"),
        ];
        let found = duplicates_in("billing/flow", &anchors, &add_runs);
        assert_eq!(found.len(), 1, "the neighbour is not a duplicate: {found:?}");
        assert!(
            found[0].hashes_agree,
            "two records with one hash agree: {found:?}"
        );
    }

    #[test]
    fn the_existence_probe_decides_add_availability_per_finding() {
        let anchors = vec![
            record("src/present.rs", 1, 5, "aaaaaaaaaaaaaaaa"),
            record("src/present.rs", 1, 5, "bbbbbbbbbbbbbbbb"),
            record("src/gone.rs", 1, 5, "cccccccccccccccc"),
            record("src/gone.rs", 1, 5, "dddddddddddddddd"),
        ];
        let found = duplicates_in("billing/flow", &anchors, &|p, _| {
            (p != "src/present.rs").then_some(AddRefusal::PathMissing)
        });
        assert_eq!(found.len(), 2, "{found:?}");
        let present = found.iter().find(|f| f.path == "src/present.rs").unwrap();
        let gone = found.iter().find(|f| f.path == "src/gone.rs").unwrap();
        assert_eq!(present.add_refusal, None);
        assert_eq!(gone.add_refusal, Some(AddRefusal::PathMissing));
    }

    #[test]
    fn report_block_names_file_identity_count_and_the_layer_caveat() {
        let block = finding(false, true).report_block(".span");
        assert!(
            block.contains(".span/billing/flow"),
            "names span file: {block}"
        );
        assert!(block.contains("src/a.rs#L1-L5"), "names identity: {block}");
        assert!(block.contains("records:      2"), "names count: {block}");
        assert!(
            block.contains("present only in HEAD or the index, with no worktree"),
            "states the non-worktree-layer caveat: {block}"
        );
    }

    #[test]
    fn an_existing_path_gets_the_one_step_add_repair() {
        let block = finding(false, true).report_block(".span");
        assert!(
            block.contains("fix:          git span add billing/flow src/a.rs#L1-L5"),
            "names `add`, with the span and the address filled in: {block}"
        );
        assert!(
            !block.contains("cannot repair this one"),
            "does not tell an operator `add` is unavailable when it is: {block}"
        );
    }

    #[test]
    fn a_missing_path_gets_drift_fix_and_the_reason_add_would_refuse() {
        let block = finding(false, false).report_block(".span");
        assert!(
            block.contains("fix:          git span drift --fix"),
            "names the command that still works: {block}"
        );
        assert!(
            !block.contains("fix:          git span add"),
            "`add` is not offered as the fix when its probe would refuse: {block}"
        );
        assert!(
            block.contains("neither\n                 tracked nor present in the worktree"),
            "names why `add` would refuse: {block}"
        );
    }

    #[test]
    fn agreed_hashes_drop_the_two_state_clause_rather_than_qualifying_it() {
        let block = finding(true, true).report_block(".span");
        assert!(
            !block.contains("two states at once"),
            "records that agree never report in two states: {block}"
        );
        assert!(
            block.contains("carry the same content hash"),
            "says what is actually true of them: {block}"
        );
    }

    #[test]
    fn divergent_hashes_keep_the_two_state_clause() {
        let block = finding(false, true).report_block(".span");
        assert!(
            block.contains("two states at once"),
            "divergent records do report in two states: {block}"
        );
    }
}
