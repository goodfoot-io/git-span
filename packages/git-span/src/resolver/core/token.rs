//! `StateToken`: the complete invocation-state snapshot (card main-157
//! Phase 1).
//!
//! Captures every output-affecting input to a `stale` resolution as one
//! typed value. See `notes/architecture-and-complexity.md` "Semantic Model"
//! and `notes/correctness-contract.md` "Incomplete Semantic Keys" /
//! "Mutable-State Publication Races" for the defects this closes: today's
//! keys omit rename budget, copy detection, filter dependencies, and
//! availability, and mutable state is captured once and never revalidated.
//!
//! The token is meant to be captured before resolution and re-read before
//! publication (wiring for that lands in a later phase); a mismatch
//! discards the candidate rather than publishing under a stale key.
//! [`StateToken::canonical_key_digest`] intentionally excludes `head`: HEAD
//! is a derivation hint for locating an incremental-parent generation, not
//! part of the exact key, while output remains content-only (source tree
//! identity) — see `notes/correctness-contract.md` "Explicit Decisions" and
//! the `same_tree_different_commit_history_is_output_stable` guard test in
//! `tests.rs`, which fails loudly the moment a future output field starts
//! depending on commit identity.

use crate::types::CopyDetection;
use blake3::Hasher;
use serde::{Deserialize, Serialize};

/// Length-prefix `bytes` into `h` so concatenated fields cannot collide
/// (mirrors `resolver/cache_v2/schema.rs::write_prefixed`).
fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

fn write_opt_str(h: &mut Hasher, s: &Option<String>) {
    match s {
        Some(v) => {
            h.update(&[1u8]);
            write_prefixed(h, v.as_bytes());
        }
        None => {
            h.update(&[0u8]);
        }
    }
}

/// One `filter.<driver>.*` (or `.gitattributes` `filter=<name>`) dependency.
/// Persistence for output that transits this filter is eligible only when
/// both halves of its identity are proven — a command string alone is not
/// proof (`notes/investigation-question-log.md` Step 6, "Can external
/// filters be safely cached?").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FilterDependency {
    /// Driver name (e.g. `lfs`, a custom `filter.<name>`).
    pub(crate) driver: String,
    /// Configured clean/smudge command text. Not itself proof of identity —
    /// see `has_complete_identity`.
    pub(crate) command: String,
    /// BLAKE3 digest of the resolved executable's bytes (or another proven
    /// content identity for it), when provable. `None` means "unproven".
    pub(crate) executable_digest: Option<[u8; 32]>,
    /// BLAKE3 digest of the declared environment dependency (e.g. relevant
    /// env var values the filter reads), when provable.
    pub(crate) env_digest: Option<[u8; 32]>,
}

impl FilterDependency {
    /// A filter dependency may be trusted for persistence only when both
    /// halves of its identity are proven, not merely its command text.
    pub(crate) fn has_complete_identity(&self) -> bool {
        self.executable_digest.is_some() && self.env_digest.is_some()
    }

    fn write(&self, h: &mut Hasher) {
        write_prefixed(h, self.driver.as_bytes());
        write_prefixed(h, self.command.as_bytes());
        match &self.executable_digest {
            Some(d) => {
                h.update(&[1u8]);
                h.update(d);
            }
            None => {
                h.update(&[0u8]);
            }
        }
        match &self.env_digest {
            Some(d) => {
                h.update(&[1u8]);
                h.update(d);
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
}

/// Typed identity of one relevant path's index/staged/worktree content.
/// Never falls back to wall-clock time on a read failure — `Unreadable` is
/// a typed failure distinct from `Absent`
/// (`notes/correctness-contract.md` "Mutable-State Publication Races": "Read
/// failures are typed failures, not the same identity as an absent path").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PathState {
    /// Path does not exist at this layer.
    Absent,
    /// Tracked content identified by blob OID (hex).
    Tracked { blob: String },
    /// Untracked/worktree-only content identified by a digest of its
    /// normalized bytes (hex).
    WorktreeContent { content_digest: String },
    /// Unmerged (conflicted) index entry.
    Conflict,
    /// Read failed. Fail-closed: never conflated with `Absent`, and never a
    /// wall-clock-seeded placeholder (the current index-checksum fallback
    /// this replaces — see `resolver/cache_v2/keys.rs::index_checksum_bytes`
    /// — allows different indices in one second to collide).
    Unreadable,
}

impl PathState {
    fn write(&self, h: &mut Hasher) {
        match self {
            PathState::Absent => {
                h.update(&[0u8]);
            }
            PathState::Tracked { blob } => {
                h.update(&[1u8]);
                write_prefixed(h, blob.as_bytes());
            }
            PathState::WorktreeContent { content_digest } => {
                h.update(&[2u8]);
                write_prefixed(h, content_digest.as_bytes());
            }
            PathState::Conflict => {
                h.update(&[3u8]);
            }
            PathState::Unreadable => {
                h.update(&[4u8]);
            }
        }
    }
}

/// One path's typed state, paired with its repo-relative path. Kept as a
/// `Vec` (not a `HashMap`) so serialization and key derivation are
/// order-stable; callers are responsible for sorting by path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PathStateEntry {
    pub(crate) path: String,
    pub(crate) state: PathState,
}

/// Sparse/promisor/LFS proof for one path whose resolution depends on
/// object availability (`notes/correctness-contract.md` "Availability
/// Aliasing": today's availability digest is only installed/sparse/promisor
/// booleans and does not cover per-path proofs, so a fetched object or a
/// sparse-pattern change can leave the digest unchanged).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PathAvailability {
    pub(crate) path: String,
    pub(crate) available: bool,
}

/// Global availability proofs, independent of any single path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AvailabilityProof {
    pub(crate) lfs_installed: bool,
    pub(crate) sparse_active: bool,
    pub(crate) promisor_active: bool,
    /// Per-path availability proofs, sorted by path, for paths whose
    /// resolution actually depends on LFS/promisor/sparse availability.
    pub(crate) paths: Vec<PathAvailability>,
}

/// Ordered `(path, blob)` identity of one span file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SpanBlobIdentity {
    pub(crate) path: String,
    pub(crate) blob: String,
}

/// Every output-affecting `LayerSet` toggle, captured explicitly so the
/// projection layer (`super::project`) never has to re-derive it from
/// `EngineOptions`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LayerSetToken {
    pub(crate) worktree: bool,
    pub(crate) index: bool,
    pub(crate) staged_span: bool,
}

impl From<crate::types::LayerSet> for LayerSetToken {
    fn from(l: crate::types::LayerSet) -> Self {
        Self {
            worktree: l.worktree,
            index: l.index,
            staged_span: l.staged_span,
        }
    }
}

/// The complete invocation-state snapshot: everything that determines a
/// `stale` resolution's output. See module docs and
/// `notes/architecture-and-complexity.md` "Semantic Model" for the field
/// rationale.
///
/// `head` is a derivation hint (used to locate an incremental-parent
/// generation in later phases), not part of `canonical_key_digest` — see
/// "Explicit Decisions" in `notes/correctness-contract.md`. Every other
/// field participates in the canonical digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StateToken {
    /// Namespace/version discriminator for the whole token shape. Bump on
    /// any field addition/removal, exactly like `cache_v2`'s `KEY_SALT`.
    pub(crate) semantic_epoch: u32,

    // -- Every output-affecting `EngineOptions` field --
    pub(crate) layers: LayerSetToken,
    pub(crate) ignore_unavailable: bool,
    pub(crate) needs_all_layers: bool,
    /// `fuzzy_threshold` as basis points (0..=10000): an exact integer, no
    /// float in a type that participates in key derivation or equality.
    pub(crate) fuzzy_threshold_bps: u32,
    /// `--since <commit-ish>`, already resolved to a hex OID.
    pub(crate) since: Option<String>,

    /// HEAD commit — derivation hint ONLY. Excluded from
    /// `canonical_key_digest`.
    pub(crate) head: String,

    /// Source tree OID — content identity.
    pub(crate) source_tree: String,
    /// Span root path (e.g. `.span`).
    pub(crate) span_root: String,
    /// Span subtree OID at `source_tree` (the empty-tree sentinel hex when
    /// the span root does not exist at `HEAD`).
    pub(crate) span_subtree: String,
    /// Ordered `(path, blob)` identity of every span file under
    /// `span_root`, in enumeration order (order is semantic, not merely
    /// incidental — see `notes/correctness-contract.md` "Completeness,
    /// Identity, And Order").
    pub(crate) span_blobs: Vec<SpanBlobIdentity>,

    pub(crate) rename_budget: u32,
    pub(crate) copy_detection: CopyDetection,
    /// Sorted `"<source-oid>:<dest-oid>"` pairs from every configured `git
    /// replace` ref that can affect history/rename walks.
    pub(crate) replace_refs: Vec<String>,

    /// Filter commands and their declared dependencies.
    pub(crate) filters: Vec<FilterDependency>,
    /// Digest of every relevant `.gitattributes`-derived attribute identity
    /// beyond the `filter` driver name itself (e.g. whitespace/eol
    /// attributes that participate in normalization).
    pub(crate) attributes_digest: [u8; 32],
    /// Digest of `core.autocrlf`/`core.eol`/`core.safecrlf` and other
    /// normalization configuration (mirrors
    /// `resolver/cache_v2/schema.rs::filter_config_hash`'s inputs).
    pub(crate) normalization_digest: [u8; 32],

    /// Typed index identity — never a wall-clock fallback (see `PathState`
    /// docs).
    pub(crate) index_identity: PathState,
    /// Typed staged content identity for every path relevant to this
    /// invocation, sorted by path.
    pub(crate) staged_state: Vec<PathStateEntry>,
    /// Typed worktree content identity for every path relevant to this
    /// invocation, sorted by path.
    pub(crate) worktree_state: Vec<PathStateEntry>,

    pub(crate) availability: AvailabilityProof,
}

impl StateToken {
    /// The canonical key digest: every semantic field except `head`. Two
    /// tokens with the same digest must resolve to the same output; any
    /// semantic field change must change this digest, and `head` alone
    /// changing must NOT change it while output remains content-only. See
    /// `tests.rs`'s per-field sensitivity property tests and
    /// `same_tree_different_commit_history_is_output_stable`.
    pub(crate) fn canonical_key_digest(&self) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.core.state-token\0");
        h.update(&self.semantic_epoch.to_le_bytes());

        h.update(&[
            u8::from(self.layers.worktree),
            u8::from(self.layers.index),
            u8::from(self.layers.staged_span),
            u8::from(self.ignore_unavailable),
            u8::from(self.needs_all_layers),
        ]);
        h.update(&self.fuzzy_threshold_bps.to_le_bytes());
        write_opt_str(&mut h, &self.since);

        // `head` intentionally omitted — derivation hint only.

        write_prefixed(&mut h, self.source_tree.as_bytes());
        write_prefixed(&mut h, self.span_root.as_bytes());
        write_prefixed(&mut h, self.span_subtree.as_bytes());
        h.update(&(self.span_blobs.len() as u64).to_le_bytes());
        for s in &self.span_blobs {
            write_prefixed(&mut h, s.path.as_bytes());
            write_prefixed(&mut h, s.blob.as_bytes());
        }

        h.update(&self.rename_budget.to_le_bytes());
        h.update(&[copy_detection_byte(self.copy_detection)]);
        h.update(&(self.replace_refs.len() as u64).to_le_bytes());
        for r in &self.replace_refs {
            write_prefixed(&mut h, r.as_bytes());
        }

        h.update(&(self.filters.len() as u64).to_le_bytes());
        for f in &self.filters {
            f.write(&mut h);
        }
        h.update(&self.attributes_digest);
        h.update(&self.normalization_digest);

        self.index_identity.write(&mut h);
        h.update(&(self.staged_state.len() as u64).to_le_bytes());
        for e in &self.staged_state {
            write_prefixed(&mut h, e.path.as_bytes());
            e.state.write(&mut h);
        }
        h.update(&(self.worktree_state.len() as u64).to_le_bytes());
        for e in &self.worktree_state {
            write_prefixed(&mut h, e.path.as_bytes());
            e.state.write(&mut h);
        }

        h.update(&[
            u8::from(self.availability.lfs_installed),
            u8::from(self.availability.sparse_active),
            u8::from(self.availability.promisor_active),
        ]);
        h.update(&(self.availability.paths.len() as u64).to_le_bytes());
        for p in &self.availability.paths {
            write_prefixed(&mut h, p.path.as_bytes());
            h.update(&[u8::from(p.available)]);
        }

        *h.finalize().as_bytes()
    }

    /// Digest over only the *resolution-config* inputs of this token: the
    /// subset of [`Self::canonical_key_digest`] that actually determines the
    /// layer-neutral per-span cores the incremental and dirty reuse tiers store
    /// and replay.
    ///
    /// The reuse tiers locate a baseline generation by HEAD alone
    /// (`find_ancestor` / `find_generation_by_head`), and HEAD is excluded from
    /// the canonical key. A baseline published at the same HEAD can therefore
    /// carry a DIFFERENT config than the current invocation — a changed
    /// `core.autocrlf`/`core.eol` normalization, a different filter
    /// executable/env identity, an added `replace` ref, a changed rename budget
    /// or copy-detection mode, an activated sparse-checkout — every one of which
    /// changes what
    /// [`capture_resolution_core`](crate::resolver::engine::capture_resolution_core)
    /// resolves, while none of them moves HEAD. Reusing the baseline's stored
    /// cores under the new config would silently re-serve (and re-publish) a
    /// stale result under the new key. Persisting this fingerprint alongside a
    /// baseline's reuse rows lets the reuse tiers prove the resolution config
    /// still matches before trusting any stored core, and fall through to a full
    /// cold resolve when it does not (fail closed).
    ///
    /// Two field classes are deliberately EXCLUDED:
    ///
    /// * **Content identity** — `head`, `source_tree`, `span_subtree`,
    ///   `span_blobs`, and the index/staged/worktree identities. These carry the
    ///   very commit/dirty changes the reuse tiers reuse across.
    /// * **Output/projection shaping** — `layers`, `needs_all_layers`,
    ///   `ignore_unavailable`, `fuzzy_threshold_bps`, and `since`. None of these
    ///   reach [`capture_resolution_core`](crate::resolver::engine::capture_resolution_core),
    ///   which always resolves the FULL layer set at a fixed `0.95` threshold
    ///   with no `--since` bound; they only select layers / shape findings at
    ///   projection time, so the stored layer-neutral cores are independent of
    ///   them. Folding them in would spuriously reject a legitimate reuse across
    ///   an output-format change (e.g. `needs_all_layers` is `true` only for the
    ///   Human renderer), the exact false positive this exclusion prevents.
    pub(crate) fn config_fingerprint(&self) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.core.state-token.config\0");
        h.update(&self.semantic_epoch.to_le_bytes());

        write_prefixed(&mut h, self.span_root.as_bytes());

        h.update(&self.rename_budget.to_le_bytes());
        h.update(&[copy_detection_byte(self.copy_detection)]);
        h.update(&(self.replace_refs.len() as u64).to_le_bytes());
        for r in &self.replace_refs {
            write_prefixed(&mut h, r.as_bytes());
        }

        h.update(&(self.filters.len() as u64).to_le_bytes());
        for f in &self.filters {
            f.write(&mut h);
        }
        h.update(&self.attributes_digest);
        h.update(&self.normalization_digest);

        h.update(&[
            u8::from(self.availability.lfs_installed),
            u8::from(self.availability.sparse_active),
            u8::from(self.availability.promisor_active),
        ]);
        h.update(&(self.availability.paths.len() as u64).to_le_bytes());
        for p in &self.availability.paths {
            write_prefixed(&mut h, p.path.as_bytes());
            h.update(&[u8::from(p.available)]);
        }

        *h.finalize().as_bytes()
    }

    /// Fail-closed persistence eligibility: `false` unless every filter
    /// dependency carries a complete identity and the index/staged/
    /// worktree states are all readable (no `Unreadable`/wall-clock
    /// fallback). See `notes/investigation-question-log.md` Step 6 and
    /// `notes/correctness-contract.md` "Mutable-State Publication Races".
    pub(crate) fn persistence_eligible(&self) -> bool {
        if self.filters.iter().any(|f| !f.has_complete_identity()) {
            return false;
        }
        if matches!(self.index_identity, PathState::Unreadable) {
            return false;
        }
        if self
            .staged_state
            .iter()
            .any(|e| matches!(e.state, PathState::Unreadable))
        {
            return false;
        }
        if self
            .worktree_state
            .iter()
            .any(|e| matches!(e.state, PathState::Unreadable))
        {
            return false;
        }
        true
    }
}

fn copy_detection_byte(cd: CopyDetection) -> u8 {
    match cd {
        CopyDetection::Off => 0,
        CopyDetection::SameCommit => 1,
        CopyDetection::AnyFileInCommit => 2,
        CopyDetection::AnyFileInRepo => 3,
    }
}
