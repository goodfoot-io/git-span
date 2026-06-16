//! Read-only mesh operations via MeshFileReader — §6.5, §6.6, §10.4.
//!
//! These functions read mesh definitions from layered mesh files (HEAD /
//! index / worktree).

use crate::mesh_file::MeshFile;
use crate::mesh_file_reader::MeshFileReader;
use crate::types::{Mesh, mesh_from_file};
use crate::{Error, Result};
use std::path::Path;

pub fn list_mesh_names(repo: &gix::Repository) -> Result<Vec<String>> {
    list_mesh_names_in(repo, ".mesh")
}

pub fn list_mesh_names_in(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<String>> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let mut names = reader.list_mesh_names()?;
    names.sort();
    Ok(names)
}

/// Read the current effective mesh from layered mesh files (worktree + index + HEAD).
pub fn read_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    read_mesh_in(repo, name, ".mesh")
}

/// Read a mesh from a specific mesh root.
///
/// File-backed model: the mesh is read from the layered mesh-file view
/// (worktree overlays index overlays HEAD). There is no catalog fallback.
pub fn read_mesh_in(repo: &gix::Repository, name: &str, mesh_root: &str) -> Result<Mesh> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let file = reader
        .read_effective(name)?
        .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
    Ok(mesh_from_file(name, &file))
}

/// Result of loading all meshes: `(loaded_meshes, conflicted_names)`.
pub type LoadedMeshes = (Vec<(String, Mesh)>, Vec<String>);

/// Load every visible mesh under a specific mesh root.
///
/// Returns [`LoadedMeshes`]. Conflicted meshes (those in a Git conflict
/// state — unmerged index entry or textual conflict markers) are excluded
/// from the loaded set and returned separately so callers can surface them
/// without a second corpus scan.
pub fn load_all_meshes_in(
    repo: &gix::Repository,
    mesh_root: &str,
) -> Result<LoadedMeshes> {
    let _perf = crate::perf::span("mesh.load-all-corpus");
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    // Phase 1: 3-layer name discovery (worktree walk + HEAD tree + index).
    let mut names = crate::perf::time_list_discover(|| reader.list_mesh_names())?;
    names.sort();
    crate::perf::record_list_meshes_discovered(names.len() as u64);
    // Phase 2: per-mesh read + parse, parallelized across worker threads.
    crate::perf::time_list_parse(|| read_effective_parallel(repo, mesh_root, names))
}

/// Per-name outcome of a `read_effective` call, carried back from a worker
/// thread tagged with the name's original (sorted) index so the caller can
/// reassemble results deterministically regardless of completion order.
enum LoadSlot {
    /// `Ok(Some(file))` → a live mesh at this index.
    Loaded(Mesh),
    /// `Ok(None)` → name is tombstoned in the effective view; contributes
    /// nothing to either output vector.
    Tombstoned,
    /// `Err(MeshConflict)` → name is in a Git conflict state; surfaced in the
    /// separate `conflicted` list rather than the loaded set.
    Conflicted,
}

/// Read and parse the effective view of each `name` concurrently, then
/// reassemble the loaded meshes and conflicted names in the original sorted
/// order. Output is byte-identical to a serial loop over `names`:
///
/// * `(loaded, conflicted)` are both ordered by the input (sorted) name order.
/// * The first hard error in sorted order wins and is returned (matching the
///   serial `?` early-exit; concurrency only changes which error is *observed*
///   first, never which one is *reported*).
///
/// `gix::Repository` is `!Sync` (it holds a `RefCell` buffer free-list), so a
/// single reader cannot be shared by reference across threads. Each worker
/// instead owns a cheap `repo.clone()` (handles are designed for this — see
/// `gix::Repository`'s `Clone` impl) and builds its own `MeshFileReader`.
/// `Repository` is `Send` (the `parallel` gix feature, active here transitively
/// via `max-performance-safe`), so moving an owned clone into a scoped thread
/// is sound. This mirrors the established pattern in
/// `resolver::engine::resolve_named_meshes_parallel`.
fn read_effective_parallel(
    repo: &gix::Repository,
    mesh_root: &str,
    names: Vec<String>,
) -> Result<LoadedMeshes> {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    // Serial fast path for trivial corpora / single-core hosts: avoids thread
    // spawn overhead and keeps the common small-repo case allocation-light.
    if names.len() <= 1 || cpus <= 1 {
        return read_effective_serial(repo, mesh_root, &names);
    }
    // Cap workers at the corpus size and a fixed ceiling: per-name reads are
    // I/O-bound (fuse round-trips overlap), so a modest pool saturates the
    // filesystem without spawning a thread per mesh.
    let workers = cpus.min(names.len()).min(16);

    let next_idx = AtomicUsize::new(0);
    // Each worker drains a private buffer of (index, slot) into the shared
    // vec once, under a single lock acquisition, to keep contention off the
    // hot read path.
    let slots: Mutex<Vec<(usize, LoadSlot)>> = Mutex::new(Vec::with_capacity(names.len()));
    let fatal: Mutex<Option<Error>> = Mutex::new(None);

    std::thread::scope(|s| {
        for _ in 0..workers {
            // Per-thread owned reader over a cheap repo handle clone: gix's
            // RefCell buffer pool means the reader is not shareable by &ref.
            let repo = repo.clone();
            let names = &names;
            let next_idx = &next_idx;
            let slots = &slots;
            let fatal = &fatal;
            s.spawn(move || {
                let reader = MeshFileReader::new(&repo, mesh_root.to_string());
                let mut local: Vec<(usize, LoadSlot)> = Vec::new();
                loop {
                    if fatal.lock().unwrap().is_some() {
                        break;
                    }
                    let i = next_idx.fetch_add(1, Ordering::Relaxed);
                    if i >= names.len() {
                        break;
                    }
                    let name = &names[i];
                    match reader.read_effective(name) {
                        Ok(Some(file)) => {
                            local.push((i, LoadSlot::Loaded(mesh_from_file(name, &file))));
                        }
                        Ok(None) => local.push((i, LoadSlot::Tombstoned)),
                        Err(Error::MeshConflict(_)) => local.push((i, LoadSlot::Conflicted)),
                        Err(e) => {
                            fatal.lock().unwrap().get_or_insert(e);
                            break;
                        }
                    }
                }
                slots.lock().unwrap().extend(local);
            });
        }
    });

    if let Some(e) = fatal.into_inner().unwrap() {
        return Err(e);
    }

    // Reassemble in the original sorted order: index the slots, then walk
    // names by index so both output vectors match the serial loop exactly.
    let mut by_index: Vec<Option<LoadSlot>> = (0..names.len()).map(|_| None).collect();
    for (i, slot) in slots.into_inner().unwrap() {
        by_index[i] = Some(slot);
    }
    let mut out = Vec::with_capacity(names.len());
    let mut conflicted = Vec::new();
    for (name, slot) in names.into_iter().zip(by_index) {
        match slot.expect("every index is filled when no fatal error is recorded") {
            LoadSlot::Loaded(mesh) => {
                crate::perf::record_list_mesh_parsed();
                out.push((name, mesh));
            }
            LoadSlot::Tombstoned => {}
            LoadSlot::Conflicted => conflicted.push(name),
        }
    }
    Ok((out, conflicted))
}

/// Serial read+parse over `names`, used for trivial corpora and single-core
/// hosts. Kept byte-identical to the parallel reassembly: same ordering, same
/// conflict handling, same first-error-wins `?` semantics.
fn read_effective_serial(
    repo: &gix::Repository,
    mesh_root: &str,
    names: &[String],
) -> Result<LoadedMeshes> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let mut out = Vec::with_capacity(names.len());
    let mut conflicted = Vec::new();
    for name in names {
        // A name can appear in `list_mesh_names` (e.g. present in HEAD)
        // yet be tombstoned in the effective view; skip those rather
        // than erroring so the batch resolves the live set.
        //
        // A mesh in a Git conflict state cannot be read reliably. It is
        // surfaced separately as a `Conflict` finding by the stale path;
        // collecting it here lets callers avoid a separate
        // `conflicted_mesh_names_in` scan (still fail-closed: the conflict
        // is reported, exit is non-zero).
        match reader.read_effective(name) {
            Ok(Some(file)) => {
                crate::perf::record_list_mesh_parsed();
                out.push((name.clone(), mesh_from_file(name, &file)));
            }
            Ok(None) => {}
            Err(Error::MeshConflict(_)) => conflicted.push(name.clone()),
            Err(e) => return Err(e),
        }
    }
    Ok((out, conflicted))
}

/// Names of all visible meshes that are currently in a Git conflict
/// state (unmerged index entry or textual conflict markers). The stale
/// path renders each as a `Conflict` finding and forces a non-zero exit.
pub fn conflicted_mesh_names_in(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<String>> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let mut names = reader.list_mesh_names()?;
    names.sort();
    let mut conflicted = Vec::new();
    for name in names {
        if let Err(Error::MeshConflict(_)) = reader.read_effective(&name) {
            conflicted.push(name);
        }
    }
    Ok(conflicted)
}

/// True when an anchor of `extent` matches the optional 1-based inclusive
/// line `range`. A whole-file anchor matches any range query; a line anchor
/// matches when the ranges overlap; with no range every anchor matches.
fn extent_in_range(extent: crate::types::AnchorExtent, range: Option<(u32, u32)>) -> bool {
    use crate::types::AnchorExtent;
    match (extent, range) {
        (_, None) => true,
        (AnchorExtent::WholeFile, Some(_)) => true,
        (AnchorExtent::LineRange { start, end }, Some((qs, qe))) => start <= qe && end >= qs,
    }
}

/// In-memory index over every visible mesh's anchors, built by reading the
/// whole corpus **once**. Resolving many positional paths (e.g. a
/// shell-expanded `public/**/*` glob) must reuse a single index instead of
/// calling [`meshes_matching_path_in`] per arg — the latter reloads and
/// reparses all meshes on every call, which is O(args × meshes) and freezes
/// on large repos. See [`MeshPathIndex::matching_names`] /
/// [`MeshPathIndex::matching_names_glob`].
pub struct MeshPathIndex {
    /// Exact anchor-path → (mesh name, extent) pairs, for the common
    /// non-glob lookup.
    by_path: std::collections::HashMap<String, Vec<(String, crate::types::AnchorExtent)>>,
    /// Flat (mesh name, anchor path, extent) list, scanned for glob queries.
    all: Vec<(String, String, crate::types::AnchorExtent)>,
}

impl MeshPathIndex {
    /// Load the full mesh corpus once and build the index.
    pub fn load_in(repo: &gix::Repository, mesh_root: &str) -> Result<Self> {
        let (meshes, _conflicted) = load_all_meshes_in(repo, mesh_root)?;
        Self::from_loaded_meshes(&meshes)
    }

    /// Build the index from already-loaded meshes so callers that hold a
    /// single [`load_all_meshes_in`] result can reuse it without a second
    /// corpus parse.
    pub fn from_loaded_meshes(meshes: &[(String, Mesh)]) -> Result<Self> {
        let mut by_path: std::collections::HashMap<
            String,
            Vec<(String, crate::types::AnchorExtent)>,
        > = std::collections::HashMap::new();
        let mut all = Vec::new();
        for (name, mesh) in meshes {
            for (_id, a) in &mesh.anchors {
                by_path
                    .entry(a.path.clone())
                    .or_default()
                    .push((name.clone(), a.extent));
                all.push((name.clone(), a.path.clone(), a.extent));
            }
        }
        Ok(Self { by_path, all })
    }

    /// Names of meshes with an anchor whose path equals `path` and whose
    /// extent matches the optional line `range`. Sorted and deduped.
    pub fn matching_names(&self, path: &str, range: Option<(u32, u32)>) -> Vec<String> {
        let mut names: Vec<String> = match self.by_path.get(path) {
            None => return Vec::new(),
            Some(entries) => entries
                .iter()
                .filter(|(_, extent)| extent_in_range(*extent, range))
                .map(|(name, _)| name.clone())
                .collect(),
        };
        names.sort();
        names.dedup();
        names
    }

    /// Names of meshes with an anchor whose path matches the `pattern` glob
    /// (path separators are literal) and whose extent matches the optional
    /// line `range`. Sorted.
    pub fn matching_names_glob(
        &self,
        pattern: &str,
        range: Option<(u32, u32)>,
    ) -> Result<Vec<String>> {
        crate::perf::time_list_glob_scan(|| {
            let glob = globset::GlobBuilder::new(pattern)
                .literal_separator(true)
                .build()
                .map_err(|e| Error::Parse(format!("invalid glob `{pattern}`: {e}")))?
                .compile_matcher();
            let mut matched: std::collections::BTreeSet<String> =
                std::collections::BTreeSet::new();
            for (name, path, extent) in &self.all {
                if glob.is_match(path) && extent_in_range(*extent, range) {
                    matched.insert(name.clone());
                }
            }
            Ok(matched.into_iter().collect())
        })
    }
}

/// Path index over the mesh files: return the
/// names of all visible meshes that have at least one anchor matching
/// `path` (exact path equality) and the optional 1-based inclusive line
/// `range`. A whole-file anchor matches any range query on its path; a
/// line anchor matches when the ranges overlap. Names are sorted.
pub fn meshes_matching_path(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    meshes_matching_path_in(repo, path, range, ".mesh")
}

/// Path-match scan under a specific mesh root.
pub fn meshes_matching_path_in(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
    mesh_root: &str,
) -> Result<Vec<String>> {
    let mut names: Vec<String> = Vec::new();
    for (name, mesh) in load_all_meshes_in(repo, mesh_root)?.0 {
        let hit = mesh
            .anchors
            .iter()
            .any(|(_, a)| a.path == path && extent_in_range(a.extent, range));
        if hit {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

/// Alias for the path-index lookup, named for path-matching callers.
pub fn matching_mesh_names(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    meshes_matching_path(repo, path, range)
}

/// File-backed alias under a specific mesh root.
pub fn matching_mesh_names_in(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
    mesh_root: &str,
) -> Result<Vec<String>> {
    meshes_matching_path_in(repo, path, range, mesh_root)
}

pub fn is_glob_pattern(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[') || s.contains('{')
}

/// File-backed glob match over visible meshes' anchor paths.
pub fn matching_mesh_names_glob(
    repo: &gix::Repository,
    pattern: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    matching_mesh_names_glob_in(repo, pattern, range, ".mesh")
}

/// File-backed glob match under a specific mesh root.
pub fn matching_mesh_names_glob_in(
    repo: &gix::Repository,
    pattern: &str,
    range: Option<(u32, u32)>,
    mesh_root: &str,
) -> Result<Vec<String>> {
    let glob = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| Error::Parse(format!("invalid glob `{pattern}`: {e}")))?
        .compile_matcher();
    let mut matched: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for (name, mesh) in load_all_meshes_in(repo, mesh_root)?.0 {
        for (_id, a) in &mesh.anchors {
            if glob.is_match(&a.path) && extent_in_range(a.extent, range) {
                matched.insert(name.clone());
                break;
            }
        }
    }
    Ok(matched.into_iter().collect())
}

/// Read a mesh as it existed at a specific commit.
///
/// When `commit_ish` is `None`, reads the latest effective state
/// (worktree overlays index overlays HEAD). When `commit_ish` is
/// `Some`, reads the mesh file from the git tree at that commit.
pub fn read_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    read_mesh_at_in(repo, name, commit_ish, ".mesh")
}

pub fn read_mesh_at_in(
    repo: &gix::Repository,
    name: &str,
    commit_ish: Option<&str>,
    mesh_root: &str,
) -> Result<Mesh> {
    match commit_ish {
        None => read_mesh_in(repo, name, mesh_root),
        Some(commit_ish) => {
            let mesh_path = format!("{mesh_root}/{name}");
            let (_mode, oid) = crate::git::tree_entry_at(repo, commit_ish, Path::new(&mesh_path))?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
            let text = crate::git::read_git_text(repo, &oid.to_string())?;
            let file = MeshFile::parse(&text)?;
            Ok(mesh_from_file(name, &file))
        }
    }
}

/// Show alias for read_mesh.
pub fn show_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    read_mesh(repo, name)
}

/// Show alias for read_mesh_at.
pub fn show_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    read_mesh_at(repo, name, commit_ish)
}
