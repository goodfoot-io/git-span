//! `ResolutionCore`: the layer-neutral resolved-definition result (card
//! main-157 Phase 1). One value replaces the need to resolve a span set
//! twice merely because `current.blob` or the drift label differs by
//! active layer — see `notes/architecture-and-complexity.md` "Semantic
//! Model" and `resolver/cache_v2/mod.rs`'s `build_committed_spans` /
//! `build_clean_whole_result`, which today run the resolver once per view.
//!
//! Every anchor keeps one drift observation per layer (Head, Index,
//! Worktree) rather than the single collapsed view `AnchorResolved` carries
//! today. `super::project::project_committed` and `project_effective`
//! reconstruct the two views deterministically by selecting/relabeling
//! these observations — no re-resolution.

use blake3::Hasher;
use serde::{Deserialize, Serialize};

use crate::types::AnchorStatus;

/// Extent mirror with full `Serialize` + `Deserialize` (git-span-core's
/// `AnchorExtent` only derives `Serialize` under its `serde` feature, so it
/// cannot round-trip through a persisted payload on its own).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum ExtentCore {
    WholeFile,
    LineRange { start: u32, end: u32 },
}

impl From<git_span_core::AnchorExtent> for ExtentCore {
    fn from(e: git_span_core::AnchorExtent) -> Self {
        match e {
            git_span_core::AnchorExtent::WholeFile => ExtentCore::WholeFile,
            git_span_core::AnchorExtent::LineRange { start, end } => {
                ExtentCore::LineRange { start, end }
            }
        }
    }
}

impl From<ExtentCore> for git_span_core::AnchorExtent {
    fn from(e: ExtentCore) -> Self {
        match e {
            ExtentCore::WholeFile => git_span_core::AnchorExtent::WholeFile,
            ExtentCore::LineRange { start, end } => {
                git_span_core::AnchorExtent::LineRange { start, end }
            }
        }
    }
}

/// A location at one layer: path, extent, and blob identity (hex OID;
/// `None` when the layer has no blob — e.g. the worktree, or a terminal
/// status with nothing to point at).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LocationCore {
    pub(crate) path: String,
    pub(crate) extent: ExtentCore,
    pub(crate) blob: Option<String>,
}

/// Serde-safe mirror of `FuzzySuccessor` (confidence stored as basis points
/// so the type can derive `Eq`, matching `cache_v2/dto.rs::FuzzySuccessorDto`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FuzzySuccessorCore {
    pub(crate) path: String,
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) confidence_bps: u32,
}

/// Serde-safe mirror of `DriftLocus` (hex OID instead of `gix::ObjectId`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum DriftLocusCore {
    ChangedAt(String),
    OrphanedAt(String),
}

/// One layer's drift observation for one anchor: its classified status at
/// this layer, its current tracked location (if any), and layer-local
/// relocation output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LayerObservationCore {
    pub(crate) status: AnchorStatus,
    pub(crate) current: Option<LocationCore>,
    pub(crate) content_equivalent: bool,
    pub(crate) fuzzy_successors: Vec<FuzzySuccessorCore>,
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
    /// the span-level `span_is_reportable_in_stale_discovery` (status !=
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
    pub(crate) anchored: LocationCore,
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
    pub(crate) locus: Option<DriftLocusCore>,
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
    /// used both as the ordinal's `definition_digest` input and to prove
    /// two candidate ordinals are byte-identical before treating them as
    /// the same entry during merge.
    pub(crate) fn digest_definition(
        anchor_id: &str,
        anchor_sha: &str,
        path: &str,
        extent: ExtentCore,
    ) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.core.definition-digest\0");
        write_prefixed(&mut h, anchor_id.as_bytes());
        write_prefixed(&mut h, anchor_sha.as_bytes());
        write_prefixed(&mut h, path.as_bytes());
        match extent {
            ExtentCore::WholeFile => {
                h.update(&[0u8]);
            }
            ExtentCore::LineRange { start, end } => {
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
    pub(crate) message: String,
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

impl ResolutionCore {
    /// Merge `other` into `self`, span-by-span: a span present in both is
    /// replaced by `other`'s copy (later-wins, matching "last write wins"
    /// dedup elsewhere in this crate); ordinal identity for every
    /// surviving anchor is carried through unchanged, never
    /// address-collapsed. Order is: spans only in `self` (original
    /// position), then spans only in `other` (their position), with
    /// shared spans replaced in `self`'s position.
    pub(crate) fn merge(mut self, other: ResolutionCore) -> ResolutionCore {
        for incoming in other.spans {
            if let Some(slot) = self.spans.iter_mut().find(|s| s.name == incoming.name) {
                *slot = incoming;
            } else {
                self.spans.push(incoming);
            }
        }
        self
    }
}
