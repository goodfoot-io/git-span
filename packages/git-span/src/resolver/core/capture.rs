//! Live capture and pre-publish revalidation of a [`StateToken`] (card
//! main-157 Phase 3, sub-scope 3B).
//!
//! Phase 1 froze the *shape* of [`StateToken`] (`super::token`); this module
//! is the first code that builds a real one from an actual `git span stale`
//! invocation's live git/filesystem/option state, and the companion
//! [`revalidate`] that re-reads every mutable component after computation and
//! reports whether the snapshot still holds. Together they implement the
//! `notes/correctness-contract.md` "Snapshot Rules":
//!
//! 1. state observation yields exact immutable identities or a typed
//!    ineligibility reason (never a wall-clock or other non-deterministic
//!    fallback — every "I couldn't read this" is [`PathState::Unreadable`]);
//! 3. before publish, HEAD / span state / relevant config / index / relevant
//!    worktree identities / availability proofs are re-read;
//! 4. if any token field changed, the caller discards the candidate.
//!
//! This module deliberately does **no** storage, no env switch, and no wiring
//! into [`stale_spans_retaining_source_layers`](crate::resolver::engine)
//! — that is sibling task 3C, which calls [`capture_state_token`] before
//! resolution and [`revalidate`] before publication. Every git read reuses the
//! existing plumbing layer ([`crate::git`], [`crate::span_file_reader`],
//! [`crate::resolver::walker::rename_budget`]) rather than reinventing it.
//!
//! ## Deliberate scope boundaries (documented gaps for later phases)
//!
//! - **Filter dependency identity is captured as unproven.** Every configured
//!   `filter.<driver>` in git config becomes a [`FilterDependency`] with
//!   `executable_digest`/`env_digest` both `None`, because the resolver does
//!   not prove a filter executable's content identity anywhere today. This is
//!   fail-closed by construction: [`StateToken::persistence_eligible`] returns
//!   `false` whenever any filter lacks a complete identity, so a repo with a
//!   custom/LFS filter configured is never persisted until a later phase adds
//!   real executable-identity proofs.
//! - **Per-path availability proofs are empty.** [`AvailabilityProof::paths`]
//!   is left empty: the resolver computes only the three global
//!   sparse/promisor/LFS booleans today (the "Availability Aliasing" gap the
//!   token anticipates but no existing subsystem fills). `lfs_installed` here
//!   means "HEAD's root `.gitattributes` declares `filter=lfs`" — a real,
//!   deterministic, non-forking signal — rather than probing `git lfs
//!   version` (which forks and does not belong in a snapshot capture).
//! - **Worktree content identity is a digest of raw bytes**, matching the
//!   existing `cache_v2::file_content_identity` behavior, not filter-normalized
//!   bytes. Any content mutation still changes the digest (which is all
//!   revalidation needs); normalized-content identity is a key-precision
//!   refinement for a later phase.

use super::token::{
    AvailabilityProof, FilterDependency, PathState, PathStateEntry, SpanBlobIdentity, StateToken,
};
use crate::span_file_reader::SpanFileReader;
use crate::Result;
use crate::types::{CopyDetection, EngineOptions, Span};
use blake3::Hasher;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Namespace/version discriminator for the whole token shape. Bump on any
/// `StateToken` field addition/removal (mirrors `cache_v2`'s `KEY_SALT`).
pub(crate) const SEMANTIC_EPOCH: u32 = 1;

/// Hex of the empty git tree object id (`4b825dc...`). Used as `span_subtree`
/// when the span root is absent at `HEAD`, so "no span files committed" is a
/// distinct, deterministic identity rather than a read failure.
const EMPTY_TREE_HEX: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Build a complete [`StateToken`] from the live invocation state.
///
/// Reads HEAD, the source/span trees, the committed span set (for ordered
/// span/blob identities and the effective copy-detection mode), the index and
/// worktree identities for every relevant path, output-affecting config
/// (rename budget, copy detection, replace refs, filters, normalization,
/// attributes), and the availability proofs — all through the resolver's
/// existing git access layer. Every "couldn't read" case is a typed
/// [`PathState::Unreadable`], never a wall-clock or other non-deterministic
/// proxy.
///
/// `options` is the caller's [`EngineOptions`]; `span_root` is the already
/// precedence-resolved span root (as `stale_spans_cached` receives it).
pub(crate) fn capture_state_token(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<StateToken> {
    let committed = load_committed(repo, span_root)?;

    // Relevant path set: every committed span file plus every anchored source
    // path across the committed corpus. These are the paths whose index and
    // worktree identities can affect this invocation's output.
    let mut relevant: BTreeSet<String> = BTreeSet::new();
    let mut anchored: BTreeSet<String> = BTreeSet::new();
    for b in &committed.blobs {
        relevant.insert(b.path.clone());
    }
    for s in &committed.spans {
        for (_, a) in &s.anchors {
            anchored.insert(a.path.clone());
            relevant.insert(a.path.clone());
        }
    }

    // Effective copy-detection mode: the most-permissive across the span set,
    // exactly as `ResolveSession` derives `max_copy` for the reverse walk.
    let copy_detection = committed
        .spans
        .iter()
        .map(|s| s.config.copy_detection)
        .max()
        .unwrap_or(CopyDetection::Off);

    Ok(StateToken {
        semantic_epoch: SEMANTIC_EPOCH,
        layers: options.layers.into(),
        ignore_unavailable: options.ignore_unavailable,
        needs_all_layers: options.needs_all_layers,
        fuzzy_threshold_bps: fuzzy_threshold_bps(options.fuzzy_threshold),
        since: options.since.map(|o| o.to_string()),
        head: crate::git::head_oid(repo)?,
        source_tree: source_tree_oid(repo)?,
        span_root: span_root.to_string(),
        span_subtree: span_subtree_oid(repo, span_root)?,
        span_blobs: committed.blobs,
        rename_budget: rename_budget_u32(),
        copy_detection,
        replace_refs: replace_refs(repo),
        filters: filters(repo),
        attributes_digest: attributes_digest(repo, &anchored),
        normalization_digest: normalization_digest(repo),
        index_identity: index_identity(repo),
        staged_state: staged_states(repo, &relevant),
        worktree_state: worktree_states(repo, &relevant)?,
        availability: availability(repo),
    })
}

/// Result of a pre-publish revalidation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Revalidation {
    /// Every mutable (and immutable) component matches the originally captured
    /// token; the candidate may be published.
    Unchanged,
    /// A component changed between capture and re-read. `field` names the
    /// first differing [`StateToken`] field; the caller must discard the
    /// candidate (one bounded retry may re-capture, per Snapshot Rule 4).
    Changed { field: &'static str },
}

/// Re-read the live state and compare it against `original`.
///
/// Called after computation, before publication. A fresh [`StateToken`] is
/// captured from the same inputs and diffed field-by-field; the first differing
/// field is reported. HEAD is compared even though it is excluded from
/// [`StateToken::canonical_key_digest`] — a HEAD move invalidates the
/// incremental-parent derivation hint even when the exact key is unchanged, so
/// revalidation must still surface it (`notes/correctness-contract.md`
/// "Explicit Decisions").
pub(crate) fn revalidate(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    original: &StateToken,
) -> Result<Revalidation> {
    let fresh = capture_state_token(repo, span_root, options)?;
    Ok(diff_tokens(original, &fresh))
}

/// Field-by-field diff, in a fixed priority order. HEAD is checked first so a
/// pure HEAD move is reported as `head` rather than shadowed by a coincident
/// content field.
fn diff_tokens(a: &StateToken, b: &StateToken) -> Revalidation {
    macro_rules! check {
        ($field:ident) => {
            if a.$field != b.$field {
                return Revalidation::Changed {
                    field: stringify!($field),
                };
            }
        };
    }
    check!(head);
    check!(source_tree);
    check!(span_root);
    check!(span_subtree);
    check!(span_blobs);
    check!(index_identity);
    check!(staged_state);
    check!(worktree_state);
    check!(availability);
    check!(filters);
    check!(attributes_digest);
    check!(normalization_digest);
    check!(rename_budget);
    check!(copy_detection);
    check!(replace_refs);
    check!(layers);
    check!(ignore_unavailable);
    check!(needs_all_layers);
    check!(fuzzy_threshold_bps);
    check!(since);
    check!(semantic_epoch);
    Revalidation::Unchanged
}

// ---------------------------------------------------------------------------
// Committed span enumeration
// ---------------------------------------------------------------------------

/// The committed-at-HEAD span corpus: ordered `(span-file-path, blob)`
/// identities plus the parsed [`Span`]s (for config + anchored paths).
struct CommittedSpans {
    /// Sorted by span-file path (`committed_span_names` yields sorted names).
    blobs: Vec<SpanBlobIdentity>,
    spans: Vec<Span>,
}

fn load_committed(repo: &gix::Repository, span_root: &str) -> Result<CommittedSpans> {
    let reader = SpanFileReader::new(repo, span_root.to_string());
    let names = reader.committed_span_names()?;
    let mut blobs = Vec::with_capacity(names.len());
    let mut spans = Vec::with_capacity(names.len());
    for name in &names {
        let span_path = format!("{span_root}/{name}");
        if let Some((mode, oid)) = crate::git::tree_entry_at(repo, "HEAD", Path::new(&span_path))?
            && mode.is_blob()
        {
            blobs.push(SpanBlobIdentity {
                path: span_path,
                blob: oid.to_string(),
            });
        }
        if let Some(file) = reader.read_head(name)? {
            spans.push(crate::types::span_from_file(name, &file));
        }
    }
    Ok(CommittedSpans { blobs, spans })
}

// ---------------------------------------------------------------------------
// Tree / HEAD identities
// ---------------------------------------------------------------------------

/// Tree object id of the `HEAD` commit — the source tree content identity.
fn source_tree_oid(repo: &gix::Repository) -> Result<String> {
    let head = repo
        .head_commit()
        .map_err(|e| crate::Error::Git(format!("capture head commit: {e}")))?;
    let tree = head
        .tree_id()
        .map_err(|e| crate::Error::Git(format!("capture head tree: {e}")))?;
    Ok(tree.detach().to_string())
}

/// Tree object id of the span root at `HEAD`, or the empty-tree sentinel when
/// the span root is absent at `HEAD`.
fn span_subtree_oid(repo: &gix::Repository, span_root: &str) -> Result<String> {
    match crate::git::tree_entry_at(repo, "HEAD", Path::new(span_root))? {
        Some((mode, oid)) if mode.is_tree() => Ok(oid.to_string()),
        _ => Ok(EMPTY_TREE_HEX.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// `fuzzy_threshold` (0.0..=1.0 float) → basis points (0..=10000 integer), so
/// no float participates in key derivation or equality.
fn fuzzy_threshold_bps(t: f64) -> u32 {
    (t.clamp(0.0, 1.0) * 10_000.0).round() as u32
}

fn rename_budget_u32() -> u32 {
    u32::try_from(crate::resolver::walker::rename_budget()).unwrap_or(u32::MAX)
}

// ---------------------------------------------------------------------------
// Config-derived identities: replace refs, filters, attributes, normalization
// ---------------------------------------------------------------------------

/// Sorted `"<original-oid>:<replacement-oid>"` pairs from every `refs/replace/`
/// ref. Empty when none are configured. Reuses the same `repo.references()`
/// entry point the copy-pool walk uses.
fn replace_refs(repo: &gix::Repository) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Ok(platform) = repo.references() else {
        return out;
    };
    let Ok(all) = platform.all() else {
        return out;
    };
    for r in all.flatten() {
        let mut r = r;
        let name = r.name().as_bstr().to_string();
        let Some(original) = name.strip_prefix("refs/replace/") else {
            continue;
        };
        let original = original.to_string();
        let Ok(id) = r.peel_to_id() else {
            continue;
        };
        out.push(format!("{original}:{}", id.detach()));
    }
    out.sort();
    out
}

/// Every configured `filter.<driver>` as a [`FilterDependency`], with unproven
/// executable/env identity (see module docs). Mirrors the config inputs of
/// `cache_v2::schema::filter_config_hash`, promoted to structured entries.
fn filters(repo: &gix::Repository) -> Vec<FilterDependency> {
    let snap = repo.config_snapshot();
    let file = snap.plumbing();
    // driver -> (value-name -> value)
    let mut by_driver: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    if let Some(sections) = file.sections_by_name("filter") {
        for section in sections {
            let sub = section
                .header()
                .subsection_name()
                .map(|b| b.to_string())
                .unwrap_or_default();
            let body = section.body();
            let mut names: BTreeSet<String> = BTreeSet::new();
            for name in body.value_names() {
                names.insert(name.as_ref().to_string());
            }
            let entry = by_driver.entry(sub).or_default();
            for name in names {
                for v in body.values(&name) {
                    entry.insert(name.clone(), v.to_string());
                }
            }
        }
    }
    by_driver
        .into_iter()
        .map(|(driver, kv)| {
            let command = kv
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("\n");
            FilterDependency {
                driver,
                command,
                executable_digest: None,
                env_digest: None,
            }
        })
        .collect()
}

/// Digest over the sorted `(path, blob-oid?)` identity of every `.gitattributes`
/// committed at `HEAD` that can govern an anchored path: the repo root plus
/// each ancestor directory of an anchored path. A `None` records "probed,
/// absent" so a later addition of a `.gitattributes` changes the digest.
fn attributes_digest(repo: &gix::Repository, anchored: &BTreeSet<String>) -> [u8; 32] {
    let mut attrs: BTreeMap<String, Option<String>> = BTreeMap::new();
    collect_gitattributes(repo, Path::new(".gitattributes"), &mut attrs);
    for p in anchored {
        let mut dir = Path::new(p).parent();
        while let Some(d) = dir {
            collect_gitattributes(repo, &d.join(".gitattributes"), &mut attrs);
            dir = d.parent();
        }
    }
    let mut h = Hasher::new();
    h.update(b"gm.core.attributes\0");
    h.update(&(attrs.len() as u64).to_le_bytes());
    for (path, oid) in &attrs {
        write_prefixed(&mut h, path.as_bytes());
        match oid {
            Some(o) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, o.as_bytes());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    *h.finalize().as_bytes()
}

fn collect_gitattributes(
    repo: &gix::Repository,
    path: &Path,
    out: &mut BTreeMap<String, Option<String>>,
) {
    let key = path.to_string_lossy().replace('\\', "/");
    if out.contains_key(&key) {
        return;
    }
    let oid = match crate::git::tree_entry_at(repo, "HEAD", path) {
        Ok(Some((mode, oid))) if mode.is_blob() => Some(oid.to_string()),
        _ => None,
    };
    out.insert(key, oid);
}

/// Digest of `core.autocrlf`/`core.eol`/`core.safecrlf` (missing distinguished
/// from empty). Mirrors the normalization inputs of `filter_config_hash`.
fn normalization_digest(repo: &gix::Repository) -> [u8; 32] {
    let snap = repo.config_snapshot();
    let mut h = Hasher::new();
    h.update(b"gm.core.normalization\0");
    for key in ["core.autocrlf", "core.eol", "core.safecrlf"] {
        write_prefixed(&mut h, key.as_bytes());
        match snap.string(key) {
            Some(v) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, v.to_string().as_bytes());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    *h.finalize().as_bytes()
}

// ---------------------------------------------------------------------------
// Index / staged / worktree identities
// ---------------------------------------------------------------------------

/// Typed whole-index identity from `.git/index`'s trailer checksum. Never a
/// wall-clock fallback: an unreadable/too-short index is `Unreadable`, a
/// missing index file (synthesized from HEAD) is `Absent`. This is the exact
/// defect `cache_v2::keys::index_checksum_bytes` (wall-clock-seeded on an
/// unreadable trailer) must not repeat.
fn index_identity(repo: &gix::Repository) -> PathState {
    let index_path = crate::git::git_dir(repo).join("index");
    match std::fs::read(&index_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => PathState::Absent,
        Err(_) => PathState::Unreadable,
        Ok(bytes) if bytes.len() >= 20 => PathState::Tracked {
            blob: hex_bytes(&bytes[bytes.len() - 20..]),
        },
        Ok(_) => PathState::Unreadable,
    }
}

/// Typed staged identity for every relevant path, read from the index once.
/// A path with any unmerged (stage 1/2/3) entry is `Conflict`; a normal entry
/// is `Tracked{blob}`; a relevant path absent from the index is `Absent`. An
/// unreadable index makes every relevant path `Unreadable` (fail-closed).
fn staged_states(repo: &gix::Repository, relevant: &BTreeSet<String>) -> Vec<PathStateEntry> {
    let entries = match crate::git::index_entries(repo) {
        Ok(e) => e,
        Err(_) => {
            return relevant
                .iter()
                .map(|p| PathStateEntry {
                    path: p.clone(),
                    state: PathState::Unreadable,
                })
                .collect();
        }
    };
    let mut by_path: BTreeMap<&str, PathState> = BTreeMap::new();
    for e in &entries {
        let slot = by_path.entry(e.path.as_str()).or_insert(PathState::Absent);
        if e.stage == gix::index::entry::Stage::Unconflicted {
            // A real stage-0 entry, unless a conflict stage already claimed it.
            if !matches!(slot, PathState::Conflict) {
                *slot = PathState::Tracked {
                    blob: e.oid.to_string(),
                };
            }
        } else {
            *slot = PathState::Conflict;
        }
    }
    relevant
        .iter()
        .map(|p| PathStateEntry {
            path: p.clone(),
            state: by_path.get(p.as_str()).cloned().unwrap_or(PathState::Absent),
        })
        .collect()
}

/// Typed worktree identity for every relevant path. Read failures are typed
/// `Unreadable` (a directory where a file is expected, a permission error),
/// never conflated with `Absent` and never seeded with wall-clock time.
fn worktree_states(
    repo: &gix::Repository,
    relevant: &BTreeSet<String>,
) -> Result<Vec<PathStateEntry>> {
    let workdir = crate::git::work_dir(repo)?;
    Ok(relevant
        .iter()
        .map(|p| PathStateEntry {
            path: p.clone(),
            state: worktree_path_state(workdir, p),
        })
        .collect())
}

fn worktree_path_state(workdir: &Path, rel: &str) -> PathState {
    let abs = workdir.join(rel);
    let md = match std::fs::symlink_metadata(&abs) {
        Ok(md) => md,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return PathState::Absent,
        Err(_) => return PathState::Unreadable,
    };
    let ft = md.file_type();
    if ft.is_symlink() {
        match std::fs::read_link(&abs) {
            Ok(target) => PathState::WorktreeContent {
                content_digest: hex_bytes(
                    blake3::hash(target.to_string_lossy().as_bytes()).as_bytes(),
                ),
            },
            Err(_) => PathState::Unreadable,
        }
    } else if ft.is_file() {
        match std::fs::read(&abs) {
            Ok(bytes) => PathState::WorktreeContent {
                content_digest: hex_bytes(blake3::hash(&bytes).as_bytes()),
            },
            Err(_) => PathState::Unreadable,
        }
    } else {
        // A directory, fifo, socket, etc. is not readable file content.
        PathState::Unreadable
    }
}

// ---------------------------------------------------------------------------
// Availability proofs
// ---------------------------------------------------------------------------

/// Global sparse/promisor/LFS availability proofs from the resolver's existing
/// signals. Per-path proofs are not computed by any subsystem today (see module
/// docs) and are left empty.
fn availability(repo: &gix::Repository) -> AvailabilityProof {
    AvailabilityProof {
        lfs_installed: head_root_gitattributes_declares_lfs(repo),
        sparse_active: crate::git::common_dir(repo)
            .join("info")
            .join("sparse-checkout")
            .exists(),
        promisor_active: crate::git::promisor_active(repo),
        paths: Vec::new(),
    }
}

/// Whether HEAD's root `.gitattributes` blob declares `filter=lfs`. A real,
/// deterministic, non-forking signal (unlike a `git lfs version` probe).
fn head_root_gitattributes_declares_lfs(repo: &gix::Repository) -> bool {
    match crate::git::tree_entry_at(repo, "HEAD", Path::new(".gitattributes")) {
        Ok(Some((mode, oid))) if mode.is_blob() => match repo.find_object(oid) {
            Ok(obj) => obj
                .into_blob()
                .detach()
                .data
                .windows(10)
                .any(|w| w == b"filter=lfs"),
            Err(_) => false,
        },
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

fn hex_bytes(b: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(b.len() * 2);
    for byte in b {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests;
