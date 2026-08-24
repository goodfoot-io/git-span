//! Layered span file reader: HEAD / index / worktree with overlay semantics.
//!
//! Default effective view: worktree overlays index overlays HEAD.
//!
//! **Tombstone semantics:** a file absent from a higher layer hides any
//! version present in lower layers.  If a higher-layer file exists but
//! fails to parse, the error is surfaced (fail closed) — no fallback to
//! lower layers.
//!
//! **Per-run snapshots:** corpus operations that read one effective view
//! per span capture a [`LayerSnapshot`] once at their entry point and pass
//! it to the `_with_layers` variants, so index materializations and HEAD
//! peels cost once per run instead of once per span times several probes.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, OnceLock};

use crate::span_file::SpanFile;
use crate::{Error, Result};

/// Parse a layer's text, naming the span in any error it raises.
///
/// The kernel parses a string and has no name to put in its error; this layer
/// does. Routing every parse through here is what lets
/// `Error::SpanConflict { span, kind }` carry both halves — the name for the
/// operator and the kind for the surface deciding what to advise — instead of
/// the kernel's detail string arriving where a span name was expected.
fn parse_named(name: &str, text: &str) -> Result<SpanFile> {
    SpanFile::parse(text).map_err(|e| match e {
        git_span_core::Error::SpanConflict(kind) => Error::SpanConflict {
            span: name.to_string(),
            kind,
        },
        other => other.into(),
    })
}

/// Reads span files from the three Git layers (HEAD / index / worktree)
/// with configurable overlay semantics.
pub struct SpanFileReader<'repo> {
    repo: &'repo gix::Repository,
    span_root: String,
}

// ---------------------------------------------------------------------------
// Per-run layer snapshots (card main-290)
//
// One `read_effective` call probes the lower git layers several times: the
// unmerged-entry conflict check materializes a full index snapshot (one
// owned `String` per entry), `exists_in_index` and `read_staged` each reload
// the index, and `exists_in_head` re-parses HEAD and re-peels its tree —
// twice per read. Corpus operations that read one effective view per span
// (drift/list/doctor) therefore paid O(spans × index-size) allocation plus
// two HEAD peels per span. `LayerSnapshot` captures both lower layers once
// per run — an index-path table and a resolved HEAD span-subtree map, the
// effective-read counterpart of [`SpanFileReader::committed_span_entries`] —
// and the `_with_layers` read variants consult it instead.
//
// Capture discipline mirrors the resolver session's `index_entries_memo`
// (card main-300), which this reader-side snapshot complements:
// `span_file_reader` sits below the resolver session's layering and is also
// driven by CLI paths (doctor, list, commit) that never construct a session,
// so the memo cannot be reused here. Like the session memos, a snapshot is
// treated as immutable for the run it backs; callers must not hold one
// across index or HEAD mutations.
// ---------------------------------------------------------------------------

/// One path's merged view of every index entry at that exact path.
#[derive(Debug)]
struct IndexPathEntry {
    /// Any entry at this path has a stage other than `Unconflicted` — the
    /// canonical Git signal for an unresolved merge conflict.
    unmerged: bool,
    /// Blob id of the FIRST index entry at this path. Git sorts index
    /// entries by `(path, stage)`, so for an unmerged path this is the
    /// lowest stage — exactly what the legacy first-match linear scan in
    /// `read_staged` returned.
    oid: gix::ObjectId,
}

/// Materialized index-layer capture: one owned entry per distinct path in
/// the index. Authoritative for both presence (`exists_in_index`) and
/// staged content (`read_staged`) because it is folded from the same
/// complete entry list those probes used to scan per span.
type IndexTable = BTreeMap<Box<str>, IndexPathEntry>;

/// Outcome of capturing one lower git layer into a [`LayerSnapshot`].
///
/// The capture is strict-or-failed: either it completed against the same
/// data the legacy probes would have walked (and is then authoritative for
/// every name), or any anomaly was hit — unreadable commit/tree object, a
/// subtree that will not peel — and the snapshot degrades to per-span
/// legacy probes so every accessor reproduces its pre-snapshot behavior
/// byte-for-byte (including which accessors swallow an index-load failure
/// versus propagate it). A degraded snapshot never answers from partial
/// data: fail-closed over fail-open.
#[derive(Debug)]
enum LayerCapture<T> {
    Complete(T),
    Failed,
}

/// One-per-run snapshot of the index and HEAD layers backing repeated
/// layered span reads (card main-290).
///
/// Create once at a corpus operation's entry point, share it (by reference,
/// or clone the `Arc` across worker threads), and pass it to the
/// `_with_layers` read variants. Both captures initialize lazily inside a
/// [`OnceLock`] on the first probe that needs them — single-flight under
/// concurrency, zero cost when a run turns out to need only the worktree
/// layer — exactly like the resolver session's lazy memos.
///
/// The index capture folds [`crate::git::index_entries`]'s full snapshot
/// (the same materialization the per-span unmerged probe paid) into one
/// owned entry per distinct path; the HEAD capture resolves the span-root
/// subtree once via the same walk [`Self::committed_span_entries`]-style
/// enumeration uses, mapping every leaf name to its object id.
pub(crate) struct LayerSnapshot {
    index: OnceLock<LayerCapture<Arc<IndexTable>>>,
    head: OnceLock<LayerCapture<Arc<BTreeMap<String, gix::ObjectId>>>>,
}

impl Default for LayerSnapshot {
    fn default() -> Self {
        Self {
            index: OnceLock::new(),
            head: OnceLock::new(),
        }
    }
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
        self.read_effective_layers(None, name)
    }

    /// [`Self::read_effective`] backed by one shared per-run
    /// [`LayerSnapshot`].
    ///
    /// All index and HEAD probes consult `layers` — materialized at most
    /// once per snapshot regardless of how many names are read through it —
    /// instead of re-loading the index and re-peeling HEAD per probe. The
    /// overlay logic, layer priority, tombstone semantics, and every error/
    /// outcome are identical to `read_effective`; only repeated git-level
    /// work disappears. See the `LayerSnapshot` capture-discipline notes:
    /// the caller must not hold `layers` across index or HEAD mutations.
    pub(crate) fn read_effective_with_layers(
        &self,
        name: &str,
        layers: &LayerSnapshot,
    ) -> Result<Option<SpanFile>> {
        self.read_effective_layers(Some(layers), name)
    }

    /// The single-copy effective-overlay skeleton. `None` layers = legacy
    /// per-probe behavior (each probe re-reads git); `Some` = probes answer
    /// from the shared snapshot, degrading per-layer to legacy whenever its
    /// capture failed.
    fn read_effective_layers(
        &self,
        layers: Option<&LayerSnapshot>,
        name: &str,
    ) -> Result<Option<SpanFile>> {
        // Fail-closed: an unmerged (stage 1/2/3) index entry for the span
        // file means an unresolved merge. Refuse to present any layer's
        // content as valid — the effective view is unreliable.
        if self.is_unmerged_in_index(layers, name)? {
            return Err(Error::SpanConflict {
                span: name.to_string(),
                kind: git_span_core::ConflictKind::UnmergedIndex,
            });
        }
        // Worktree layer (highest priority).
        if let Some(span) = self.read_worktree(name)? {
            return Ok(Some(span));
        }

        // Worktree absent.  If the file exists in index or HEAD, the
        // worktree absence is a deletion tombstone — do NOT fall through.
        if self.exists_in_index(layers, name)? || self.exists_in_head(layers, name)? {
            return Ok(None);
        }

        // Index layer.
        if let Some(span) = self.read_staged_layers(layers, name)? {
            return Ok(Some(span));
        }

        // Index absent.  If the file exists in HEAD, index absence is a
        // deletion tombstone.
        if self.exists_in_head(layers, name)? {
            return Ok(None);
        }

        // HEAD layer.
        self.read_head_layers(layers, name)
    }

    /// Effective layered read whose worktree authority is a retained span
    /// root, backed by one shared per-run [`LayerSnapshot`] — same capture
    /// discipline as [`Self::read_effective_with_layers`].
    pub(crate) fn read_effective_retained_with_layers(
        &self,
        name: &str,
        authority: &crate::descriptor_authority::SpanRootAuthority,
        layers: &LayerSnapshot,
    ) -> Result<Option<SpanFile>> {
        let layers = Some(layers);
        if self.is_unmerged_in_index(layers, name)? {
            return Err(Error::SpanConflict {
                span: name.to_string(),
                kind: git_span_core::ConflictKind::UnmergedIndex,
            });
        }
        let worktree =
            match authority.target(name, crate::descriptor_authority::DirectoryPolicy::Existing) {
                Ok(target) => target.parent.read_optional(&target.leaf).map_err(|error| {
                    Error::Io(std::io::Error::other(format!(
                        "retained span read: {error:#}"
                    )))
                })?,
                Err(error)
                    if error.chain().any(|cause| {
                        cause
                            .downcast_ref::<std::io::Error>()
                            .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound)
                    }) =>
                {
                    None
                }
                Err(error) => {
                    return Err(Error::Io(std::io::Error::other(format!(
                        "retain span parent: {error:#}"
                    ))));
                }
            };
        if let Some(bytes) = worktree {
            let text = String::from_utf8(bytes)
                .map_err(|error| Error::Parse(format!("worktree span not utf-8: {error}")))?;
            return parse_named(name, &text).map(Some);
        }
        if self.exists_in_index(layers, name)? || self.exists_in_head(layers, name)? {
            return Ok(None);
        }
        if let Some(span) = self.read_staged_layers(layers, name)? {
            return Ok(Some(span));
        }
        if self.exists_in_head(layers, name)? {
            return Ok(None);
        }
        self.read_head_layers(layers, name)
    }

    /// Read the span file from the HEAD tree only.
    pub fn read_head(&self, name: &str) -> Result<Option<SpanFile>> {
        self.read_head_layers(None, name)
    }

    fn read_head_layers(&self, layers: Option<&LayerSnapshot>, name: &str) -> Result<Option<SpanFile>> {
        if let Some(names) = self.head_names(layers) {
            // The capture is complete (strict-or-failed), so a missing key
            // is authoritative absence — no fallback probe needed.
            return match names.get(name) {
                Some(oid) => self.read_head_blob(name, *oid).map(Some),
                None => Ok(None),
            };
        }
        let span_path = self.span_path(name);
        match crate::git::tree_entry_at(self.repo, "HEAD", Path::new(&span_path))? {
            Some((_mode, oid)) => self.read_head_blob(name, oid).map(Some),
            None => Ok(None),
        }
    }

    /// Read and parse a committed span object whose id is already resolved.
    ///
    /// This is the O(1) counterpart to [`Self::read_head`]: given an object
    /// id already obtained from a single HEAD `.span`-subtree enumeration
    /// (see [`Self::committed_span_entries`]), it skips the per-name
    /// `tree_entry_at` HEAD re-walk that `read_head` performs internally.
    /// Byte-for-byte identical read/parse to `read_head`'s inner branch, so a
    /// caller with a resolved id gets exactly the same `SpanFile`.
    pub fn read_head_blob(&self, name: &str, oid: gix::ObjectId) -> Result<SpanFile> {
        let text = crate::git::read_git_text(self.repo, &oid.to_string())?;
        crate::perf::record_list_layer_read();
        crate::perf::record_list_bytes_parsed(text.len() as u64);
        parse_named(name, &text)
    }

    /// Read the span file from the index (staged) layer.
    ///
    /// Index overlays HEAD: if the file is present in the index it is
    /// returned; if absent from the index the result is `None` regardless
    /// of HEAD (index deletion tombstone).
    pub fn read_staged(&self, name: &str) -> Result<Option<SpanFile>> {
        self.read_staged_layers(None, name)
    }

    fn read_staged_layers(
        &self,
        layers: Option<&LayerSnapshot>,
        name: &str,
    ) -> Result<Option<SpanFile>> {
        let span_path = self.span_path(name);
        if let Some(table) = self.index_table(layers) {
            // Same first-entry-at-path semantics as the legacy scan below:
            // the table keeps each path's lowest-stage blob (see
            // `IndexPathEntry::oid`).
            return match table.get(span_path.as_str()) {
                Some(entry) => {
                    let text = self.read_index_blob_text(entry.oid)?;
                    crate::perf::record_list_layer_read();
                    crate::perf::record_list_bytes_parsed(text.len() as u64);
                    parse_named(name, &text).map(Some)
                }
                None => Ok(None),
            };
        }
        let index = crate::git::load_index(self.repo)?;
        for entry in index.entries() {
            let ep = entry.path(&index).to_string();
            if ep == span_path {
                let text = self.read_index_blob_text(entry.id)?;
                crate::perf::record_list_layer_read();
                crate::perf::record_list_bytes_parsed(text.len() as u64);
                return parse_named(name, &text).map(Some);
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
            parse_named(name, &content).map(Some)
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

    pub(crate) fn list_git_span_names(&self) -> Result<Vec<String>> {
        let mut names = BTreeSet::new();
        self.collect_head_names(&mut names)?;
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

    /// Enumerate every committed span leaf under the span root at `HEAD` in a
    /// single tree walk, mapping span name to its `(mode, object-id)`.
    ///
    /// This is the O(N) alternative to calling
    /// [`crate::git::tree_entry_at`] once per span name — which re-parses
    /// `HEAD`, re-peels its tree, and re-decodes the entire span subtree on
    /// every call, making per-span lookups O(N²) across a corpus of N spans.
    /// One decode of the span subtree here yields every entry; callers then
    /// look each span up by name (O(log N)) and read its blob directly via
    /// [`Self::read_head_blob`] with the already-resolved id.
    ///
    /// The set of keys is exactly [`Self::committed_span_names`]'s output
    /// (same HEAD-tree walk, same [`is_span_name_segment`] filtering, same
    /// leaf-vs-subtree recursion), and each value is exactly what
    /// `tree_entry_at(repo, "HEAD", "<span_root>/<name>")` would return, so
    /// this changes performance only, never which spans or identities are seen.
    pub fn committed_span_entries(
        &self,
    ) -> Result<BTreeMap<String, (gix::objs::tree::EntryMode, gix::ObjectId)>> {
        let mut entries: BTreeMap<String, (gix::objs::tree::EntryMode, gix::ObjectId)> =
            BTreeMap::new();
        let Some(span_tree) = self.head_span_tree()? else {
            return Ok(entries);
        };
        collect_tree_leaf_entries(self.repo, &span_tree, "", &mut entries)?;
        Ok(entries)
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

    /// Resolve the snapshot's index table, materializing it at most once
    /// per snapshot ([`OnceLock`] single-flight, mirroring the resolver
    /// session's `index_entries_memo`). `None` means no snapshot is in
    /// play, or its capture failed — the caller then runs the legacy
    /// per-span probe.
    fn index_table<'a>(
        &'a self,
        layers: Option<&'a LayerSnapshot>,
    ) -> Option<&'a BTreeMap<Box<str>, IndexPathEntry>> {
        let layers = layers?;
        match layers.index.get_or_init(|| self.build_index_capture()) {
            LayerCapture::Complete(table) => Some(table),
            LayerCapture::Failed => None,
        }
    }

    /// Resolve the snapshot's HEAD span-name → blob-id map; same contract
    /// as [`Self::index_table`].
    fn head_names<'a>(
        &'a self,
        layers: Option<&'a LayerSnapshot>,
    ) -> Option<&'a BTreeMap<String, gix::ObjectId>> {
        let layers = layers?;
        match layers.head.get_or_init(|| self.build_head_capture()) {
            LayerCapture::Complete(names) => Some(names),
            LayerCapture::Failed => None,
        }
    }

    /// Fold one full [`crate::git::index_entries`] materialization — the
    /// same snapshot the per-span unmerged probe already paid — into an
    /// owned entry per distinct path. Any load failure degrades the whole
    /// capture so every index accessor falls back to its exact legacy
    /// error policy instead of sharing a guessed answer.
    fn build_index_capture(&self) -> LayerCapture<Arc<IndexTable>> {
        let entries = match crate::git::index_entries(self.repo) {
            Ok(entries) => entries,
            Err(_) => return LayerCapture::Failed,
        };
        let mut table: IndexTable = BTreeMap::new();
        for entry in entries {
            // `or_insert` keeps the FIRST entry per path (lowest stage in
            // git's `(path, stage)` sort order), matching the legacy
            // first-match scan `read_staged` performed.
            let slot = table.entry(entry.path.into_boxed_str()).or_insert(IndexPathEntry {
                unmerged: false,
                oid: entry.oid,
            });
            slot.unmerged |= entry.stage != gix::index::entry::Stage::Unconflicted;
        }
        LayerCapture::Complete(Arc::new(table))
    }

    /// Resolve HEAD's span-root subtree once and map EVERY leaf name to its
    /// object id — the effective-read counterpart of
    /// [`Self::committed_span_entries`], replacing the two per-span
    /// rev-parse-and-peel walks `exists_in_head` used to pay.
    ///
    /// Unlike name enumeration, the walk applies NO
    /// [`is_span_name_segment`] filtering (per-name `tree_entry_at` probes
    /// never filtered either, so e.g. a dot-named file under the span root
    /// stays reachable exactly as before) and is strict: any unreadable or
    /// non-descentable entry aborts the whole capture into
    /// [`LayerCapture::Failed`] rather than yielding a partial map. Only
    /// benign absences — unborn HEAD, missing span root — complete as an
    /// authoritative empty map, matching what `tree_entry_at` returns for
    /// them.
    fn build_head_capture(&self) -> LayerCapture<Arc<BTreeMap<String, gix::ObjectId>>> {
        enum Walk {
            Complete(BTreeMap<String, gix::ObjectId>),
            Abort,
        }
        let walked = || -> Walk {
            let head_id = match self.repo.head_id() {
                Ok(id) => id.detach(),
                // Unborn HEAD: `tree_entry_at`'s rev-parse fails for every
                // probe, which surfaces as Ok(None)/Ok(false) — empty map.
                Err(_) => return Walk::Complete(BTreeMap::new()),
            };
            let commit = match self.repo.find_commit(head_id) {
                Ok(commit) => commit,
                Err(_) => return Walk::Abort,
            };
            let tree = match commit.tree() {
                Ok(tree) => tree,
                Err(_) => return Walk::Abort,
            };
            match tree.lookup_entry_by_path(Path::new(&self.span_root)) {
                // Span root absent at HEAD: every probe is absent.
                Ok(None) => Walk::Complete(BTreeMap::new()),
                Ok(Some(entry)) => {
                    if !entry.mode().is_tree() {
                        // A non-tree span root cannot be descended through;
                        // let legacy probes define the answer.
                        return Walk::Abort;
                    }
                    let obj = match self.repo.find_object(entry.object_id()) {
                        Ok(obj) => obj,
                        Err(_) => return Walk::Abort,
                    };
                    let span_tree = match obj.peel_to_tree() {
                        Ok(tree) => tree,
                        Err(_) => return Walk::Abort,
                    };
                    let mut names = BTreeMap::new();
                    match collect_tree_leaf_oids(self.repo, &span_tree, "", &mut names) {
                        Ok(()) => Walk::Complete(names),
                        Err(()) => Walk::Abort,
                    }
                }
                Err(_) => Walk::Abort,
            }
        }();
        match walked {
            Walk::Complete(names) => LayerCapture::Complete(Arc::new(names)),
            Walk::Abort => LayerCapture::Failed,
        }
    }

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
    fn is_unmerged_in_index(
        &self,
        layers: Option<&LayerSnapshot>,
        name: &str,
    ) -> Result<bool> {
        let span_path = self.span_path(name);
        if let Some(table) = self.index_table(layers) {
            return Ok(table
                .get(span_path.as_str())
                .is_some_and(|entry| entry.unmerged));
        }
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
    fn exists_in_index(&self, layers: Option<&LayerSnapshot>, name: &str) -> Result<bool> {
        let span_path = self.span_path(name);
        if let Some(table) = self.index_table(layers) {
            return Ok(table.contains_key(span_path.as_str()));
        }
        let index = crate::git::load_index(self.repo)?;
        Ok(index
            .entries()
            .iter()
            .any(|e| e.path(&index) == span_path.as_str()))
    }

    /// Check whether a file path exists in the HEAD tree.
    fn exists_in_head(&self, layers: Option<&LayerSnapshot>, name: &str) -> Result<bool> {
        if let Some(names) = self.head_names(layers) {
            return Ok(names.contains_key(name));
        }
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
        let Some(span_tree) = self.head_span_tree()? else {
            return Ok(());
        };
        collect_tree_entry_names(self.repo, &span_tree, "", names)
    }

    /// Resolve the span-root subtree object at `HEAD`, or `None` when `HEAD`
    /// is unresolvable, the span root is absent, or it is not a tree. The
    /// single choke point both name enumeration ([`Self::collect_head_names`])
    /// and entry enumeration ([`Self::committed_span_entries`]) resolve
    /// through, so they always agree on which subtree they walk.
    fn head_span_tree(&self) -> Result<Option<gix::Tree<'repo>>> {
        let head_id = match self.repo.head_id() {
            Ok(id) => id.detach(),
            Err(_) => return Ok(None),
        };
        let commit = match self.repo.find_commit(head_id) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        let tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };
        let entry = match tree.lookup_entry_by_path(Path::new(&self.span_root)) {
            Ok(Some(e)) => e,
            _ => return Ok(None),
        };
        if !entry.mode().is_tree() {
            return Ok(None);
        }
        let obj = match self.repo.find_object(entry.object_id()) {
            Ok(o) => o,
            Err(_) => return Ok(None),
        };
        match obj.peel_to_tree() {
            Ok(t) => Ok(Some(t)),
            Err(_) => Ok(None),
        }
    }

    /// Collect span names from the index, filtering by span root prefix.
    fn collect_index_names(&self, names: &mut BTreeSet<String>) -> Result<()> {
        let index = match crate::git::load_index(self.repo) {
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
/// sibling) is a non-span config artifact and must be skipped by every
/// enumeration path — filesystem walk, HEAD-tree walk, and index scan.
/// This is the single choke-point predicate shared by all three.
fn is_span_name_segment(basename: &str) -> bool {
    // Dot-prefixed names are config artifacts (e.g. .hookignore,
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

/// Strict single-walk leaf collection for the HEAD layer capture: maps
/// every leaf under `tree` to its object id with NO name-segment filtering
/// (per-name `tree_entry_at` probes never filtered) and no silent skips —
/// any unreadable entry or non-peelable subtree aborts with `Err(())` so
/// the caller falls back to legacy per-name probes instead of trusting a
/// partial map. The key set is therefore exactly what one
/// `tree_entry_at(repo, "HEAD", "<span_root>/<name>")` probe per leaf would
/// resolve.
fn collect_tree_leaf_oids(
    repo: &gix::Repository,
    tree: &gix::Tree,
    prefix: &str,
    leaves: &mut BTreeMap<String, gix::ObjectId>,
) -> std::result::Result<(), ()> {
    for entry in tree.iter() {
        let entry = entry.map_err(|_| ())?;
        let name = entry.filename();
        let rel = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };
        if entry.mode().is_tree() {
            let obj = repo.find_object(entry.object_id()).map_err(|_| ())?;
            let subtree = obj.peel_to_tree().map_err(|_| ())?;
            collect_tree_leaf_oids(repo, &subtree, &rel, leaves)?;
        } else {
            leaves.insert(rel, entry.object_id());
        }
    }
    Ok(())
}

/// Recursively collect leaf `(name -> (mode, object-id))` entries from a tree
/// object. Structurally identical to [`collect_tree_entry_names`] — same
/// [`is_span_name_segment`] filtering, same recurse-into-readable-subtree /
/// treat-everything-else-as-a-leaf rule — so its key set is exactly that
/// function's, but it additionally carries each leaf's mode and object id so a
/// caller need not re-resolve them via `tree_entry_at`.
fn collect_tree_leaf_entries(
    repo: &gix::Repository,
    tree: &gix::Tree,
    prefix: &str,
    entries: &mut BTreeMap<String, (gix::objs::tree::EntryMode, gix::ObjectId)>,
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
            collect_tree_leaf_entries(repo, &subtree, &rel, entries)?;
        } else {
            entries.insert(rel, (entry.mode(), entry.object_id()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // Card main-290 evidence: one `LayerSnapshot` per run keeps index
    // materializations and HEAD peels constant (here: 1 / 1 / 0) no matter
    // how many names are read through it, and every snapshotted outcome is
    // identical to the legacy per-probe read.
    // ------------------------------------------------------------------

    /// Run a git command in `dir` and assert success.
    fn git(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("git spawn");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    /// Write a file relative to `dir`, creating parent directories as needed.
    fn write(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    /// Minimal valid span file: one whole-file anchor + why line.
    fn span_text(anchor_path: &str) -> String {
        format!(
            "{anchor_path} sha256:0000000000000000000000000000000000000000000000000000000000000000\n\ntest\n"
        )
    }

    /// Comparable form of a layered-read outcome: full span content on
    /// success, Display of the error otherwise — so legacy and snapshotted
    /// reads must match byte-for-byte, not just by discriminant.
    fn outcome_key(outcome: &Result<Option<SpanFile>>) -> String {
        match outcome {
            Ok(Some(file)) => format!("ok:{file:?}"),
            Ok(None) => "tombstone".to_string(),
            Err(e) => format!("err:{e}"),
        }
    }

    /// Corpus covering every layer state a snapshot must reproduce:
    ///
    /// - `live`       → worktree hit
    /// - `dirty`      → worktree + index both modified (staged edit)
    /// - `tombstoned` → committed, worktree copy deleted (index tombstone)
    /// - `headonly`   → committed, then `rm --cached` + deleted from the
    ///                  worktree (index absent, HEAD present)
    /// - `unmerged`   → stages 2/3 in the index (conflict fires first)
    fn build_corpus() -> tempfile::TempDir {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();

        git(dir, &["init", "--initial-branch=main"]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "commit.gpgsign", "false"]);

        write(dir, "file.txt", "content\n");
        git(dir, &["add", "."]);
        git(dir, &["commit", "-m", "init"]);

        for name in ["live", "dirty", "tombstoned", "headonly"] {
            write(dir, &format!(".span/{name}"), &span_text("file.txt"));
        }
        git(dir, &["add", "."]);
        git(dir, &["commit", "-m", "add spans"]);

        // dirty: staged edit (index blob differs from HEAD's).
        write(dir, ".span/dirty", &format!("{}\n# edited\n", span_text("file.txt")));
        git(dir, &["add", ".span/dirty"]);

        std::fs::remove_file(dir.join(".span/tombstoned")).unwrap();

        // headonly: unstage AND delete, leaving only the HEAD layer.
        git(dir, &["rm", "--cached", "--", ".span/headonly"]);
        std::fs::remove_file(dir.join(".span/headonly")).unwrap();

        // unmerged: stages 2 and 3, no stage 0.
        let ours = span_text("file.txt");
        let theirs = format!("{}\n# alt\n", span_text("file.txt"));
        write(dir, ".span/_ours", &ours);
        write(dir, ".span/_theirs", &theirs);
        let oid_ours = git(
            dir,
            &[
                "hash-object",
                "-w",
                &dir.join(".span/_ours").to_string_lossy(),
            ],
        );
        let oid_theirs = git(
            dir,
            &[
                "hash-object",
                "-w",
                &dir.join(".span/_theirs").to_string_lossy(),
            ],
        );
        {
            use std::io::Write;
            let input =
                format!("100644 {oid_ours} 2\t.span/unmerged\n100644 {oid_theirs} 3\t.span/unmerged\n");
            let mut child = std::process::Command::new("git")
                .current_dir(dir)
                .args(["update-index", "--index-info"])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .expect("git update-index spawn");
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(input.as_bytes())
                .unwrap();
            assert!(child.wait().unwrap().success());
        }
        let _ = std::fs::remove_file(dir.join(".span/_ours"));
        let _ = std::fs::remove_file(dir.join(".span/_theirs"));

        td
    }

    #[test]
    fn snapshot_matches_legacy_and_keeps_git_costs_constant() {
        let td = build_corpus();
        let dir = td.path();
        let repo = gix::open(dir).expect("gix::open");
        let reader = SpanFileReader::new(&repo, ".span".into());

        let names_small = ["live", "tombstoned"];
        let names_full = [
            "live",
            "dirty",
            "tombstoned",
            "headonly",
            "unmerged",
            "absent-everywhere",
        ];

        // Legacy baseline: fresh per-probe behavior, no snapshot involved.
        let legacy: Vec<String> = names_full
            .iter()
            .map(|n| outcome_key(&reader.read_effective(n)))
            .collect();
        let legacy_staged: Vec<String> = names_full
            .iter()
            .map(|n| match reader.read_staged(n) {
                Ok(Some(f)) => format!("ok:{f:?}"),
                Ok(None) => "absent".to_string(),
                Err(e) => format!("err:{e}"),
            })
            .collect();
        let legacy_head: Vec<String> = names_full
            .iter()
            .map(|n| match reader.read_head(n) {
                Ok(Some(f)) => format!("ok:{f:?}"),
                Ok(None) => "absent".to_string(),
                Err(e) => format!("err:{e}"),
            })
            .collect();

        for names in [&names_small as &[_], &names_full] {
            crate::git::reset_index_entries_call_count();
            crate::git::reset_load_index_call_count();
            crate::git::reset_tree_entry_at_call_count();

            let layers = LayerSnapshot::default();
            let snapshotted: Vec<String> = names
                .iter()
                .map(|n| outcome_key(&reader.read_effective_with_layers(n, &layers)))
                .collect();
            let staged: Vec<String> = names
                .iter()
                .map(|n| match reader.read_staged_layers(Some(&layers), n) {
                    Ok(Some(f)) => format!("ok:{f:?}"),
                    Ok(None) => "absent".to_string(),
                    Err(e) => format!("err:{e}"),
                })
                .collect();
            let head: Vec<String> = names
                .iter()
                .map(|n| match reader.read_head_layers(Some(&layers), n) {
                    Ok(Some(f)) => format!("ok:{f:?}"),
                    Ok(None) => "absent".to_string(),
                    Err(e) => format!("err:{e}"),
                })
                .collect();

            // Outcomes byte-identical to the legacy probes.
            for (i, name) in names.iter().enumerate() {
                let j = names_full.iter().position(|n| n == name).unwrap();
                assert_eq!(
                    snapshotted[i], legacy[j],
                    "read_effective({name}) diverged under the snapshot"
                );
                assert_eq!(
                    staged[i], legacy_staged[j],
                    "read_staged({name}) diverged under the snapshot"
                );
                assert_eq!(
                    head[i], legacy_head[j],
                    "read_head({name}) diverged under the snapshot"
                );
            }
            // Spot-check the states actually fired (non-vacuous parity).
            // Names outside the current subset simply don't get checked.
            let spot = |n: &str| names.iter().position(|x| *x == n);
            if let Some(i) = spot("live") {
                assert!(snapshotted[i].starts_with("ok:"), "live span must read");
            }
            if let Some(i) = spot("tombstoned") {
                assert_eq!(snapshotted[i], "tombstone");
            }
            if let Some(i) = spot("headonly") {
                assert_eq!(
                    snapshotted[i], "tombstone",
                    "HEAD-only tombstone must hide behind the snapshot too"
                );
            }
            if let Some(i) = spot("unmerged") {
                assert!(
                    snapshotted[i]
                        .starts_with("err:span `unmerged` is in a Git conflict state"),
                    "unmerged entry must still surface its conflict"
                );
            }

            // The acceptance signal: exactly ONE index materialization and
            // ONE HEAD resolution per run, zero legacy fallback loads, and
            // none of it scaling with the name count (3 vs 6 above).
            assert_eq!(
                crate::git::index_entries_call_count(),
                1,
                "the index capture must materialize exactly once per run"
            );
            assert_eq!(
                crate::git::load_index_call_count(),
                1,
                "the only direct index load is the capture's own \
                 materialization (inside `index_entries`); more means some \
                 probe fell back to a per-span legacy load"
            );
            assert_eq!(
                crate::git::tree_entry_at_call_count(),
                0,
                "no probe may re-peel HEAD per name while the capture is \
                 complete"
            );

            // Reusing the SAME snapshot costs nothing further.
            let _ = reader.read_effective_with_layers("live", &layers);
            assert_eq!(crate::git::index_entries_call_count(), 1);
            assert_eq!(crate::git::tree_entry_at_call_count(), 0);
        }
    }

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
        assert!(!is_span_name_segment(".gitignore"));
        assert!(!is_span_name_segment(".gitattributes"));
    }

    #[test]
    fn rejects_dispatcher_generated_artifacts() {
        assert!(!is_span_name_segment("dispatcher.log"));
        assert!(!is_span_name_segment(
            "agent-daf06226-85d1-471c-b59c-43733590a3f0.log"
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
