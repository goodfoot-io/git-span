//! `ResolutionCore`: the layer-neutral resolved-definition result (card
//! main-157 Phase 1). One value replaces the need to resolve a span set
//! twice merely because `current.blob` or the drift label differs by
//! active layer — see `notes/architecture-and-complexity.md` "Semantic
//! Model" and the legacy `resolver/cache_v2/mod.rs`'s `build_committed_spans`
//! / `build_clean_whole_result`, which ran the resolver once per view (that
//! module was deleted at cutover in `0a8bf95e`).
//!
//! Every anchor keeps one drift observation per layer (Head, Index,
//! Worktree) rather than the single collapsed view `AnchorResolved` carries
//! today. `super::project::project_effective` reconstructs the committed
//! (`LayerSet::committed_only()`) and effective views deterministically by
//! selecting/relabeling these observations — no re-resolution.

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::types::{AnchorExtent, AnchorLocation, AnchorStatus, DriftLocus, FuzzySuccessor};

/// One layer's drift observation for one anchor: its classified status at
/// this layer, its current tracked location (if any; `blob` is `None` when
/// the layer has no blob — e.g. the worktree, or a terminal status with
/// nothing to point at), and layer-local relocation output. The public
/// [`AnchorLocation`] / [`FuzzySuccessor`] derive their own serde and are
/// embedded directly.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LayerObservationCore {
    pub(crate) status: AnchorStatus,
    pub(crate) current: Option<AnchorLocation>,
    pub(crate) content_equivalent: bool,
    pub(crate) fuzzy_successors: Vec<FuzzySuccessor>,
    /// Set only when this layer's Moved/Changed classification came from
    /// the worktree-blob fallback (card main-264): the anchor's content
    /// was found verbatim in an untracked worktree file.
    pub(crate) moved_uncommitted: bool,
}

impl LayerObservationCore {
    /// Whether this layer is eligible to be selected as a projection's drift
    /// `source`.
    ///
    /// Card main-157 sub-scope 3C bug fix (flagged): this must mirror exactly
    /// which statuses the live resolver attributes a `source`/`layer_sources`
    /// to. In `resolver/engine/anchor.rs` only `Changed` and `Moved` carry a
    /// drift source; every terminal status — `Deleted`, `Submodule`,
    /// `ContentUnavailable`, `MergeConflict`, `ResolvedPendingCommit` — and
    /// `Fresh` leave `source = None`, `layer_sources = []`. The prior
    /// `!Fresh` predicate mis-attributed a committed deletion (a `Deleted`
    /// head observation) to `Head`, so the projected porcelain source column
    /// read `H` where the direct resolver renders `-`. Restricting to
    /// `Changed`/`Moved` makes the projection byte-identical to direct
    /// resolution for these statuses; the finding itself stays reportable via
    /// the span-level `span_is_reportable_in_drift_discovery` (status !=
    /// `Fresh`), which is a separate predicate.
    pub(crate) fn shows_drift(&self) -> bool {
        matches!(self.status, AnchorStatus::Changed | AnchorStatus::Moved)
    }
}

/// Layer-neutral resolution of one anchor: the pinned definition plus one
/// drift observation per layer, and the single HEAD-history locus (only
/// ever meaningful when Head is the selected source).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AnchorCore {
    pub(crate) anchor_id: String,
    pub(crate) anchor_sha: String,
    /// The anchor record's recorded hash (`"<algorithm>:<content_hash>"`),
    /// carried through from `Anchor::stored_hash`. `serde(default)` so a
    /// cache written before this field existed still deserializes.
    #[serde(default)]
    pub(crate) stored_hash: String,
    pub(crate) anchored: AnchorLocation,
    pub(crate) head: LayerObservationCore,
    pub(crate) index: LayerObservationCore,
    pub(crate) worktree: LayerObservationCore,
    /// The collapsed full-effective (Head+Index+Worktree) observation,
    /// captured unconditionally.
    ///
    /// Card main-157 sub-scope 3C bug fix (flagged, additive): the per-layer
    /// `head`/`index`/`worktree` observations carry *drift attribution* (which
    /// layer introduces drift), but a projection's rendered `current`/`status`
    /// must be the DEEPEST-enabled-layer view, which is not the drift-source
    /// layer's view. For a HEAD-sourced `Changed` with a clean worktree, the
    /// effective `current.blob` is `None` (the worktree file carries no
    /// committed blob OID) while the Head observation's `current.blob` is the
    /// HEAD blob — so projecting the Head observation's `current` diverged from
    /// direct effective resolution (visible only in `--format json`). This
    /// field is exactly the deepest-layer effective observation the effective
    /// projection renders from; the per-layer observations still drive
    /// `source`/`layer_sources`. `super::project::project_effective` reads it
    /// when the worktree layer is enabled.
    pub(crate) full: LayerObservationCore,
    /// HEAD-history drift locus. Populated only from the Head observation;
    /// meaningless (and never attached) when a projection's source is
    /// Index or Worktree — see `super::project`.
    pub(crate) locus: Option<DriftLocus>,
}

/// Explicit ordinal identity for a definition, replacing an address-keyed
/// map: `(span identity, source ordinal, canonical definition digest)`.
/// Duplicate anchor addresses are valid parser input
/// (`notes/correctness-contract.md` "Completeness, Identity, And Order")
/// and must never collapse to one row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct DefinitionOrdinal {
    /// Identity of the containing span (its name).
    pub(crate) span_identity: String,
    /// Position among definitions sharing the same address within the
    /// span, in stored/parse order. `0` for the first (or only)
    /// occurrence.
    pub(crate) source_ordinal: u32,
    /// BLAKE3 digest of the canonical definition bytes (address + anchor
    /// identity), distinguishing definitions that share an address but not
    /// content.
    pub(crate) definition_digest: [u8; 32],
}

impl DefinitionOrdinal {
    /// Deterministic digest of `(anchor_id, anchor_sha, path, extent)` —
    /// the ordinal's `definition_digest`, distinguishing two definitions
    /// that share an address but not content.
    ///
    /// A manual hash, not serde: `path` contributes its lossy UTF-8 bytes
    /// (anchored paths are built from span-file `String`s, so this is the
    /// path's own string) and `extent` a `0` tag, or a `1` tag followed by
    /// `start` / `end` little-endian.
    pub(crate) fn digest_definition(
        anchor_id: &str,
        anchor_sha: &str,
        path: &Path,
        extent: AnchorExtent,
    ) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.core.definition-digest\0");
        write_prefixed(&mut h, anchor_id.as_bytes());
        write_prefixed(&mut h, anchor_sha.as_bytes());
        write_prefixed(&mut h, path.to_string_lossy().as_bytes());
        match extent {
            AnchorExtent::WholeFile => {
                h.update(&[0u8]);
            }
            AnchorExtent::LineRange { start, end } => {
                h.update(&[1u8]);
                h.update(&start.to_le_bytes());
                h.update(&end.to_le_bytes());
            }
        }
        *h.finalize().as_bytes()
    }
}

pub(crate) fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

/// One span's layer-neutral resolution: its definitions in stored order,
/// each carrying explicit ordinal identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SpanCore {
    pub(crate) name: String,
    pub(crate) why: String,
    pub(crate) follow_moves: bool,
    /// `(ordinal, anchor)` pairs in stored order. A `Vec`, never a HashMap
    /// keyed by address — duplicate addresses are legal input.
    pub(crate) anchors: Vec<(DefinitionOrdinal, AnchorCore)>,
}

/// The layer-neutral resolved-definition result for a whole invocation.
/// Deterministic projections (`super::project`) turn this into the
/// committed or effective `SpanResolved` views without re-resolving.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ResolutionCore {
    pub(crate) spans: Vec<SpanCore>,
}
