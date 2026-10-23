//! Complete current relationship context selected by immutable commit changes.

use super::{CommitContextArgs, context::ContextSpan};
use crate::types::{AnchorExtent, AnchorResolved, EngineOptions, SpanResolved};
use anyhow::{Context, Result, bail, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

pub const COMMIT_CONTEXT_SCHEMA_VERSION: u32 = 1;
pub const MAX_COMMIT_CONTEXT_COMMITS: usize = 4096;
pub const MAX_COMMIT_CONTEXT_COMPARISONS: usize = 8192;
pub const MAX_COMMIT_CONTEXT_DIFFS: usize = 8192;
pub const MAX_COMMIT_CONTEXT_HISTORY_COMMITS: usize = 4096;
pub const MAX_COMMIT_CONTEXT_HUNKS: usize = 65536;
pub const MAX_COMMIT_CONTEXT_BLOB_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_COMMIT_CONTEXT_JSON_BYTES: usize = 16 * 1024 * 1024;

/// A complete report: immutable selection identities plus full current spans.
///
/// `overlaps` on each span is empty: membership derives from commit changes,
/// not address scopes. Any incomplete selection or mapping is an error before
/// this envelope is rendered, and inspection never refreshes span definitions.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(deny_unknown_fields)]
pub struct CommitContextDocument {
    pub schema_version: u32,
    pub commits: Vec<String>,
    pub spans: Vec<ContextSpan>,
}

#[derive(Clone, Debug)]
struct Side {
    path: String,
    mode: gix::objs::tree::EntryMode,
    oid: gix::ObjectId,
}

/// Zero-based half-open source and destination changed regions.
#[derive(Clone, Debug)]
struct Hunk {
    old: (u32, u32),
    new: (u32, u32),
}

#[derive(Clone, Debug)]
struct Change {
    old: Option<Side>,
    new: Option<Side>,
    hunks: Vec<Hunk>,
    binary: bool,
    structural: bool,
}

#[derive(Clone)]
struct Baseline {
    commit: gix::ObjectId,
    path: String,
    extent: AnchorExtent,
}

#[derive(Clone)]
struct Projection {
    path: String,
    /// None denotes a whole-file anchor; an empty vector denotes absence.
    ranges: Option<Vec<(u32, u32)>>,
}

type Changes = Arc<Vec<Change>>;

struct History<'repo> {
    repo: &'repo gix::Repository,
    diffs: BTreeMap<(Option<gix::ObjectId>, gix::ObjectId), Changes>,
    hunk_count: usize,
    diff_limit: usize,
    ancestry: Vec<gix::ObjectId>,
    pending: VecDeque<gix::ObjectId>,
    visited: BTreeSet<gix::ObjectId>,
}

impl<'repo> History<'repo> {
    fn new(repo: &'repo gix::Repository) -> Self {
        Self {
            repo,
            diffs: BTreeMap::new(),
            hunk_count: 0,
            diff_limit: MAX_COMMIT_CONTEXT_DIFFS,
            ancestry: Vec::new(),
            pending: VecDeque::new(),
            visited: BTreeSet::new(),
        }
    }

    fn blob(&self, oid: gix::ObjectId) -> Result<Vec<u8>> {
        let header = self
            .repo
            .find_header(oid)
            .with_context(|| format!("read required blob {oid}"))?;
        ensure!(
            header.kind() == gix::objs::Kind::Blob,
            "required object {oid} is not a blob"
        );
        ensure!(
            header.size() <= MAX_COMMIT_CONTEXT_BLOB_BYTES as u64,
            "commit-context blob exceeds {MAX_COMMIT_CONTEXT_BLOB_BYTES}-byte limit: {oid}"
        );
        Ok(self.repo.find_blob(oid)?.data.to_vec())
    }

    fn diff(&mut self, old: Option<gix::ObjectId>, new: gix::ObjectId) -> Result<Changes> {
        if let Some(changes) = self.diffs.get(&(old, new)) {
            return Ok(Arc::clone(changes));
        }
        ensure!(
            self.diffs.len() < self.diff_limit,
            "commit-context total tree-diff limit exceeded ({})",
            self.diff_limit
        );
        let old_tree = match old {
            Some(id) => self.repo.find_commit(id)?.tree()?,
            None => self.repo.empty_tree(),
        };
        let new_tree = self.repo.find_commit(new)?.tree()?;
        let mut options = gix::diff::Options::default();
        options.track_rewrites(None);
        let raw = self
            .repo
            .diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(options))?;
        // Verify object bounds before the rewrite detector can load them, and
        // bound the complete candidate set so rewrite tracking cannot downgrade.
        let preliminary = raw
            .into_iter()
            .filter_map(convert_change)
            .collect::<Result<Vec<_>>>()?;
        let budget = crate::resolver::walker::rename_budget();
        ensure!(
            preliminary.len() <= budget,
            "commit-context rename candidate limit exceeded: {} > {budget}",
            preliminary.len()
        );
        for change in &preliminary {
            for side in [change.old.as_ref(), change.new.as_ref()]
                .into_iter()
                .flatten()
            {
                self.blob(side.oid)?;
            }
        }
        let mut options = gix::diff::Options::default();
        options.track_rewrites(Some(gix::diff::Rewrites {
            limit: 0,
            track_empty: true,
            ..Default::default()
        }));
        let renamed =
            self.repo
                .diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(options))?;
        let mut changes = renamed
            .into_iter()
            .filter_map(convert_change)
            .collect::<Result<Vec<_>>>()?;
        reject_ambiguous_rewrites(self, &preliminary, &changes)?;
        for change in &mut changes {
            let before = change
                .old
                .as_ref()
                .map(|side| self.blob(side.oid))
                .transpose()?
                .unwrap_or_default();
            let after = change
                .new
                .as_ref()
                .map(|side| self.blob(side.oid))
                .transpose()?
                .unwrap_or_default();
            change.binary = before.contains(&0) || after.contains(&0);
            if !change.binary && before != after {
                change.hunks = blob_hunks(&before, &after);
                account_hunks(&mut self.hunk_count, change.hunks.len())?;
            }
        }
        let changes = Arc::new(changes);
        self.diffs.insert((old, new), Arc::clone(&changes));
        Ok(changes)
    }

    fn project(
        &mut self,
        baseline: &Baseline,
        target: Option<gix::ObjectId>,
    ) -> Result<Option<Projection>> {
        let Some(target) = target else {
            return Ok(None);
        };
        let ranges = match baseline.extent {
            AnchorExtent::WholeFile => None,
            AnchorExtent::LineRange { start, end } => Some(vec![(start - 1, end)]),
        };
        let mut projected = Projection {
            path: baseline.path.clone(),
            ranges,
        };
        if baseline.commit == target {
            return Ok(Some(projected));
        }
        let changes = self.diff(Some(baseline.commit), target)?;
        if let Some(change) = changes.iter().find(|change| {
            change
                .old
                .as_ref()
                .is_some_and(|side| side.path == baseline.path)
        }) {
            let Some(new) = &change.new else {
                return Ok(None);
            };
            projected.path = new.path.clone();
            if let Some(ranges) = projected.ranges.as_mut() {
                ensure!(
                    !change.binary,
                    "cannot project line anchor through binary change: {}",
                    baseline.path
                );
                *ranges = project_ranges(ranges, &change.hunks);
                if ranges.is_empty() {
                    return Ok(None);
                }
            }
        }
        Ok(Some(projected))
    }

    fn matching_baseline(
        &self,
        commit: gix::ObjectId,
        path: &str,
        extent: AnchorExtent,
        stored: &str,
        search: bool,
    ) -> Result<Option<Baseline>> {
        let Some((mode, oid)) =
            crate::git::tree_entry_at(self.repo, &commit.to_string(), Path::new(path))?
        else {
            return Ok(None);
        };
        ensure!(
            mode.is_blob_or_symlink(),
            "unsupported historical anchor type: {path}"
        );
        let bytes = self.blob(oid)?;
        let index = git_span_core::LineIndex::build(&bytes);
        let in_bounds = match extent {
            AnchorExtent::WholeFile => true,
            AnchorExtent::LineRange { start, end } => {
                start >= 1 && start <= end && end as usize <= index.line_count()
            }
        };
        let token = |extent: &AnchorExtent| {
            format!(
                "rk64:{}",
                git_span_core::rk64_to_hex(git_span_core::cheap_fingerprint_indexed(
                    &index, extent
                ))
            )
        };
        if in_bounds && token(&extent) == stored {
            return Ok(Some(Baseline {
                commit,
                path: path.to_owned(),
                extent,
            }));
        }
        if search && matches!(extent, AnchorExtent::LineRange { .. }) {
            let hash = stored
                .strip_prefix("rk64:")
                .and_then(git_span_core::rk64_from_hex)
                .context("unsupported recorded fingerprint")?;
            let matches = git_span_core::scan_indexed_rk64_one(path, &index, hash, extent, None);
            if let [location] = matches.as_slice() {
                return Ok(Some(Baseline {
                    commit,
                    path: path.to_owned(),
                    extent: AnchorExtent::LineRange {
                        start: location.start_line,
                        end: location.end_line,
                    },
                }));
            }
        }
        Ok(None)
    }

    fn next_ancestor(&mut self) -> Result<Option<gix::ObjectId>> {
        while let Some(id) = self.pending.pop_front() {
            if !self.visited.insert(id) {
                continue;
            }
            ensure!(
                self.ancestry.len() < MAX_COMMIT_CONTEXT_HISTORY_COMMITS,
                "commit-context historical baseline search exceeds {MAX_COMMIT_CONTEXT_HISTORY_COMMITS}-commit limit"
            );
            let commit = self
                .repo
                .find_commit(id)
                .with_context(|| format!("required historical commit is unavailable: {id}"))?;
            self.pending
                .extend(commit.parent_ids().map(|id| id.detach()));
            self.ancestry.push(id);
            return Ok(Some(id));
        }
        Ok(None)
    }

    fn baseline_at_head(
        &mut self,
        head: gix::ObjectId,
        anchor: &AnchorResolved,
    ) -> Result<Baseline> {
        if let Some(location) = &anchor.current {
            let path = location.path.to_str().context("non-UTF-8 anchor path")?;
            if let Some(baseline) =
                self.matching_baseline(head, path, location.extent, &anchor.stored_hash, false)?
            {
                return Ok(baseline);
            }
        }
        let path = anchor
            .anchored
            .path
            .to_str()
            .context("non-UTF-8 declared anchor path")?;
        if self.ancestry.is_empty() && self.visited.is_empty() {
            self.pending.push_back(head);
        }
        let mut cursor = 0;
        loop {
            let commit = if let Some(id) = self.ancestry.get(cursor).copied() {
                Some(id)
            } else {
                self.next_ancestor()?
            };
            let Some(commit) = commit else {
                bail!("no verified historical baseline for {path}")
            };
            cursor += 1;
            if let Some(baseline) = self.matching_baseline(
                commit,
                path,
                anchor.anchored.extent,
                &anchor.stored_hash,
                true,
            )? {
                return Ok(baseline);
            }
        }
    }
}

/// Gix's deterministic tie-break is not proof of a unique correspondence.
/// Exact duplicates and plausible alternate edited-rename pairings are rejected.
/// A byte-line intersection is an upper bound on rename similarity, so it can
/// safely eliminate unrelated metadata without asserting a unique fuzzy match.
fn reject_ambiguous_rewrites(
    history: &History<'_>,
    raw: &[Change],
    rewritten: &[Change],
) -> Result<()> {
    let deleted = raw
        .iter()
        .filter(|change| change.new.is_none())
        .filter_map(|change| change.old.as_ref())
        .collect::<Vec<_>>();
    let added = raw
        .iter()
        .filter(|change| change.old.is_none())
        .filter_map(|change| change.new.as_ref())
        .collect::<Vec<_>>();
    for old in &deleted {
        let destinations = added.iter().filter(|new| new.oid == old.oid).count();
        if destinations != 0 {
            let sources = deleted
                .iter()
                .filter(|source| source.oid == old.oid)
                .count();
            ensure!(
                sources == 1 && destinations == 1,
                "ambiguous commit-context rename correspondence: {}",
                old.path
            );
        }
    }
    for change in rewritten {
        let Some((old, new)) = change.old.as_ref().zip(change.new.as_ref()) else {
            continue;
        };
        if old.path == new.path || old.oid == new.oid {
            continue;
        }
        let before = history.blob(old.oid)?;
        let after = history.blob(new.oid)?;
        for source in &deleted {
            if source.path != old.path && !added.iter().any(|new| new.oid == source.oid) {
                ensure!(
                    !plausible_rename(&history.blob(source.oid)?, &after),
                    "ambiguous commit-context edited rename correspondence"
                );
            }
        }
        for destination in &added {
            if destination.path != new.path && !deleted.iter().any(|old| old.oid == destination.oid)
            {
                ensure!(
                    !plausible_rename(&before, &history.blob(destination.oid)?),
                    "ambiguous commit-context edited rename correspondence"
                );
            }
        }
    }

    Ok(())
}

fn plausible_rename(before: &[u8], after: &[u8]) -> bool {
    if before.contains(&0) || after.contains(&0) || before.is_empty() || after.is_empty() {
        return false;
    }
    if before.len().min(after.len()).saturating_mul(2) < before.len().max(after.len()) {
        return false;
    }
    let mut lines = BTreeMap::<&[u8], usize>::new();
    for line in gix::diff::blob::sources::byte_lines(before) {
        *lines.entry(line).or_default() += 1;
    }
    let mut common = 0;
    for line in gix::diff::blob::sources::byte_lines(after) {
        if let Some(count) = lines.get_mut(line)
            && *count != 0
        {
            common += line.len();
            *count -= 1;
        }
    }
    common.saturating_mul(2) >= before.len().max(after.len())
}

fn checked_side(path: &[u8], mode: gix::objs::tree::EntryMode, oid: gix::ObjectId) -> Result<Side> {
    ensure!(mode.is_blob_or_symlink(), "unsupported changed entry type");
    let path = std::str::from_utf8(path)
        .context("non-UTF-8 changed path")?
        .to_owned();
    crate::span_root::validate_repo_relative_path("changed path", &path)?;
    Ok(Side { path, mode, oid })
}

fn convert_change(change: gix::object::tree::diff::ChangeDetached) -> Option<Result<Change>> {
    use gix::object::tree::diff::ChangeDetached as C;
    let pair = match change {
        C::Addition {
            location,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() {
                return None;
            }
            (
                Ok(None),
                checked_side(location.as_slice(), entry_mode, id).map(Some),
            )
        }
        C::Deletion {
            location,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() {
                return None;
            }
            (
                checked_side(location.as_slice(), entry_mode, id).map(Some),
                Ok(None),
            )
        }
        C::Modification {
            location,
            previous_entry_mode,
            previous_id,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() && previous_entry_mode.is_tree() {
                return None;
            }
            (
                checked_side(location.as_slice(), previous_entry_mode, previous_id).map(Some),
                checked_side(location.as_slice(), entry_mode, id).map(Some),
            )
        }
        C::Rewrite {
            source_location,
            source_entry_mode,
            source_id,
            location,
            entry_mode,
            id,
            ..
        } => (
            checked_side(source_location.as_slice(), source_entry_mode, source_id).map(Some),
            checked_side(location.as_slice(), entry_mode, id).map(Some),
        ),
    };
    Some((|| {
        let (old, new) = (pair.0?, pair.1?);
        let structural = old
            .as_ref()
            .zip(new.as_ref())
            .is_some_and(|(old, new)| old.path != new.path || old.mode != new.mode);
        Ok(Change {
            old,
            new,
            hunks: Vec::new(),
            binary: false,
            structural,
        })
    })())
}

fn account_hunks(count: &mut usize, additional: usize) -> Result<()> {
    ensure!(
        additional <= MAX_COMMIT_CONTEXT_HUNKS.saturating_sub(*count),
        "commit-context hunk limit exceeded ({MAX_COMMIT_CONTEXT_HUNKS})"
    );
    *count += additional;
    Ok(())
}

fn blob_hunks(before: &[u8], after: &[u8]) -> Vec<Hunk> {
    use gix::diff::blob::{Algorithm, Diff, InternedInput, sources::byte_lines};
    let input = InternedInput::new(byte_lines(before), byte_lines(after));
    Diff::compute(Algorithm::Histogram, &input)
        .hunks()
        .map(|hunk| Hunk {
            old: (hunk.before.start, hunk.before.end),
            new: (hunk.after.start, hunk.after.end),
        })
        .collect()
}

fn intersect(left: (u32, u32), right: (u32, u32)) -> Option<(u32, u32)> {
    let (start, end) = (left.0.max(right.0), left.1.min(right.1));
    (start < end).then_some((start, end))
}

fn project_ranges(ranges: &[(u32, u32)], hunks: &[Hunk]) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    for &(start, end) in ranges {
        let (mut cursor, mut delta) = (0, 0_i64);
        for hunk in hunks {
            if let Some((lo, hi)) = intersect((start, end), (cursor, hunk.old.0)) {
                out.push((
                    (i64::from(lo) + delta) as u32,
                    (i64::from(hi) + delta) as u32,
                ));
            }
            let touched = intersect((start, end), hunk.old).is_some()
                || (hunk.old.0 == hunk.old.1 && start < hunk.old.0 && hunk.old.0 < end);
            if touched && hunk.new.0 < hunk.new.1 {
                out.push(hunk.new);
            }
            cursor = hunk.old.1;
            delta = i64::from(hunk.new.1) - i64::from(cursor);
        }
        let lo = start.max(cursor);
        if lo < end {
            out.push((
                (i64::from(lo) + delta) as u32,
                (i64::from(end) + delta) as u32,
            ));
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn side_overlap(projection: &Projection, change: &Change, old: bool) -> Result<bool> {
    let side = if old { &change.old } else { &change.new };
    if !side
        .as_ref()
        .is_some_and(|side| side.path == projection.path)
    {
        return Ok(false);
    }
    let Some(ranges) = &projection.ranges else {
        return Ok(true);
    };
    ensure!(
        !change.binary,
        "cannot select line anchor through binary change: {}",
        projection.path
    );
    Ok(change.structural
        || change.hunks.iter().any(|hunk| {
            let changed = if old { hunk.old } else { hunk.new };
            ranges
                .iter()
                .any(|range| intersect(*range, changed).is_some())
        }))
}

fn validated_commits(repo: &gix::Repository, commits: &[String]) -> Result<Vec<gix::ObjectId>> {
    ensure!(
        !commits.is_empty(),
        "commit-context requires at least one full commit ID"
    );
    let mut unique = BTreeSet::new();
    for commit in commits {
        ensure!(
            commit.len() == repo.object_hash().len_in_hex()
                && commit
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
            "commit-context requires a full lowercase commit ID: {commit}"
        );
        let id = gix::ObjectId::from_hex(commit.as_bytes())?;
        repo.find_commit(id)
            .with_context(|| format!("required commit is unavailable: {commit}"))?;
        unique.insert(id);
        ensure!(
            unique.len() <= MAX_COMMIT_CONTEXT_COMMITS,
            "commit-context commit limit exceeded ({MAX_COMMIT_CONTEXT_COMMITS})"
        );
    }
    Ok(unique.into_iter().collect())
}

/// Query full current context selected by each commit's changes, read-only.
pub fn query_commit_context(
    repo: &gix::Repository,
    commits: &[String],
    span_root: &str,
) -> Result<CommitContextDocument> {
    crate::git::reject_replacement_topology(repo)?;
    let ids = validated_commits(repo, commits)?;
    let _reader = super::recovery_domain::acquire_reader(repo, span_root)?;
    let mut history = History::new(repo);
    let mut pairs = Vec::new();
    for id in &ids {
        let parents = repo
            .find_commit(*id)?
            .parent_ids()
            .map(|id| id.detach())
            .collect::<Vec<_>>();
        for parent in if parents.is_empty() {
            vec![None]
        } else {
            parents.into_iter().map(Some).collect()
        } {
            ensure!(
                pairs.len() < MAX_COMMIT_CONTEXT_COMPARISONS,
                "commit-context comparison limit exceeded ({MAX_COMMIT_CONTEXT_COMPARISONS})"
            );
            pairs.push((parent, *id));
        }
    }
    let comparisons = pairs
        .into_iter()
        .map(|(parent, id)| {
            history
                .diff(parent, id)
                .map(|changes| (parent, id, changes))
        })
        .collect::<Result<Vec<_>>>()?;
    let Some(authority) = crate::descriptor_authority::SpanRootAuthority::open_optional(
        crate::git::work_dir(repo)?,
        span_root,
    )?
    else {
        return Ok(CommitContextDocument {
            schema_version: COMMIT_CONTEXT_SCHEMA_VERSION,
            commits: ids.iter().map(ToString::to_string).collect(),
            spans: Vec::new(),
        });
    };
    let snapshot = super::context::capture_snapshot(repo, span_root, &authority)?;
    let capture = super::context::close_context_capture(
        repo,
        span_root,
        &snapshot,
        &authority,
        Vec::<String>::new(),
    )?;
    let head = gix::ObjectId::from_hex(capture.token.head.as_bytes())?;
    let committed = crate::resolver::resolve_loaded_spans(
        repo,
        &snapshot.definitions,
        EngineOptions::committed_only(),
    )?;
    let mut selected = BTreeSet::new();
    for span in committed {
        let mut unresolved = None;
        for anchor in span.anchors {
            let membership = (|| -> Result<bool> {
                let baseline = history.baseline_at_head(head, &anchor)?;
                for (parent, commit, changes) in &comparisons {
                    let before = history.project(&baseline, *parent)?;
                    let after = history.project(&baseline, Some(*commit))?;
                    for change in changes.iter() {
                        if before
                            .as_ref()
                            .map(|projection| side_overlap(projection, change, true))
                            .transpose()?
                            .unwrap_or(false)
                            || after
                                .as_ref()
                                .map(|projection| side_overlap(projection, change, false))
                                .transpose()?
                                .unwrap_or(false)
                        {
                            return Ok(true);
                        }
                    }
                }
                Ok(false)
            })();
            match membership {
                Ok(true) => {
                    selected.insert(span.name.clone());
                    break;
                }
                Ok(false) => {}
                Err(error) => unresolved = Some(error),
            }
        }
        if !selected.contains(&span.name)
            && let Some(error) = unresolved
        {
            return Err(error)
                .with_context(|| format!("cannot completely select relationship {}", span.name));
        }
    }
    let resolved = capture
        .resolved
        .into_iter()
        .filter(|span| selected.contains(&span.name))
        .collect::<Vec<SpanResolved>>();
    let document = CommitContextDocument {
        schema_version: COMMIT_CONTEXT_SCHEMA_VERSION,
        commits: ids.iter().map(ToString::to_string).collect(),
        spans: super::context::complete_context_spans(resolved, &capture.token),
    };
    super::context::context_test_checkpoint(repo, "commit-context-before-validation")?;
    ensure!(
        crate::git::head_oid(repo)? == head.to_string(),
        "repository HEAD changed while selecting commit context"
    );
    match crate::resolver::core::capture::revalidate_with_extra_paths(
        repo,
        span_root,
        EngineOptions::full(),
        &capture.paths,
        &capture.token,
    )? {
        crate::resolver::core::capture::Revalidation::Unchanged => {}
        crate::resolver::core::capture::Revalidation::Changed { field } => {
            bail!("repository {field} changed while selecting commit context")
        }
    }
    Ok(document)
}

/// Render one bounded, all-or-nothing JSON commit-context envelope.
pub fn run_commit_context(
    repo: &gix::Repository,
    args: CommitContextArgs,
    span_root: &str,
) -> Result<i32> {
    let document = query_commit_context(repo, &args.commits, span_root)?;
    let mut bytes = serde_json::to_vec(&document)?;
    bytes.push(b'\n');
    ensure!(
        bytes.len() <= MAX_COMMIT_CONTEXT_JSON_BYTES,
        "commit-context response exceeds {MAX_COMMIT_CONTEXT_JSON_BYTES}-byte JSON limit"
    );
    std::io::stdout().lock().write_all(&bytes)?;
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunk_budget_accepts_exact_limit_and_rejects_next_without_consuming_it() -> Result<()> {
        let mut count = MAX_COMMIT_CONTEXT_HUNKS - 1;
        account_hunks(&mut count, 1)?;
        assert_eq!(count, MAX_COMMIT_CONTEXT_HUNKS);
        assert!(account_hunks(&mut count, 1).is_err());
        assert_eq!(count, MAX_COMMIT_CONTEXT_HUNKS);
        Ok(())
    }

    #[test]
    fn real_blob_diff_enforces_cumulative_hunk_budget() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let git = |args: &[&str]| -> Result<String> {
            let output = std::process::Command::new("git")
                .current_dir(temp.path())
                .args(args)
                .output()?;
            ensure!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(String::from_utf8(output.stdout)?.trim().to_owned())
        };
        git(&["init", "--initial-branch=main"])?;
        git(&["config", "user.name", "Test"])?;
        git(&["config", "user.email", "test@example.com"])?;
        git(&["config", "commit.gpgsign", "false"])?;
        let source = temp.path().join("source.txt");
        std::fs::write(&source, "one\nbefore1\nmid\nbefore2\nend\nbefore3\n")?;
        git(&["add", "."])?;
        git(&["commit", "-m", "old source"])?;
        let old = gix::ObjectId::from_hex(git(&["rev-parse", "HEAD"])?.as_bytes())?;
        std::fs::write(&source, "one\nafter1\nmid\nafter2\nend\nafter3\n")?;
        git(&["commit", "-am", "new source"])?;
        let new = gix::ObjectId::from_hex(git(&["rev-parse", "HEAD"])?.as_bytes())?;
        let repo = gix::open(temp.path())?;
        let mut bounded = History::new(&repo);
        bounded.diff_limit = 2;
        bounded.diff(None, old)?;
        bounded.diff(Some(old), new)?;
        assert_eq!(bounded.diffs.len(), 2);
        bounded.diff(Some(old), new)?; // A cache hit performs no extra tree diff.
        assert_eq!(bounded.diffs.len(), 2);
        let error = bounded
            .diff(None, new)
            .expect_err("fresh miss exceeds the two-diff work budget");
        assert!(error.to_string().contains("total tree-diff limit"));
        assert_eq!(bounded.diffs.len(), 2);
        let mut history = History::new(&repo);
        history.hunk_count = MAX_COMMIT_CONTEXT_HUNKS - 2;
        let error = history
            .diff(Some(old), new)
            .expect_err("three real hunks exceed remaining budget of two");
        assert!(error.to_string().contains("hunk limit"));
        Ok(())
    }
}
