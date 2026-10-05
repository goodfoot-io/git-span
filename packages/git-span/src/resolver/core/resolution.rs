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

/// Serde adapters that persist a `gix::ObjectId` as its hex string — the
/// exact bincode bytes the core types wrote when they stored the hex `String`
/// itself, so the reuse-row encoding (`exact::SUMMARY_VERSION`) is unchanged.
/// Parsing happens once, at decode: a malformed stored OID fails the row's
/// deserialization (which `reuse_rows_to_core` skips, fail-closed) instead of
/// surviving until projection.
mod oid_hex {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::str::FromStr;

    fn parse<E: serde::de::Error>(hex: &str) -> Result<gix::ObjectId, E> {
        gix::ObjectId::from_str(hex).map_err(|e| E::custom(format!("invalid oid `{hex}`: {e}")))
    }

    pub(super) fn serialize<S: Serializer>(oid: &gix::ObjectId, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&oid.to_string())
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<gix::ObjectId, D::Error> {
        parse(&String::deserialize(d)?)
    }

    /// `Option<gix::ObjectId>` counterpart, encoded as `Option<String>`.
    pub(super) mod option {
        use serde::{Deserialize, Deserializer, Serialize, Serializer};

        pub(in super::super) fn serialize<S: Serializer>(
            oid: &Option<gix::ObjectId>,
            s: S,
        ) -> Result<S::Ok, S::Error> {
            oid.map(|o| o.to_string()).serialize(s)
        }

        pub(in super::super) fn deserialize<'de, D: Deserializer<'de>>(
            d: D,
        ) -> Result<Option<gix::ObjectId>, D::Error> {
            Option::<String>::deserialize(d)?
                .map(|hex| super::parse(&hex))
                .transpose()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::super::{DriftLocusCore, ExtentCore, LocationCore};

        /// The adapters must keep the persisted bytes identical to the former
        /// hex-`String` fields, or `exact::SUMMARY_VERSION` would need a bump.
        #[test]
        fn oid_fields_encode_as_their_former_hex_strings() {
            // The former hex-`String` shape. bincode encodes the variant by
            // index, so only the variant order has to match `DriftLocusCore`.
            #[derive(serde::Serialize)]
            enum LegacyLocus<'a> {
                _Changed(&'a str),
                _Orphaned(&'a str),
                Renamed(&'a str, &'a str),
            }
            let oid = gix::ObjectId::from_hex(b"0123456789abcdef0123456789abcdef01234567")
                .expect("valid hex");
            let hex = oid.to_string();
            let loc = LocationCore {
                path: "a.rs".into(),
                extent: ExtentCore::WholeFile,
                blob: Some(oid),
            };
            assert_eq!(
                bincode::serialize(&loc).expect("serialize LocationCore"),
                bincode::serialize(&("a.rs", ExtentCore::WholeFile, Some(hex.as_str())))
                    .expect("serialize legacy shape"),
            );
            let renamed = DriftLocusCore::RenamedAt(oid, "b.rs".into());
            let bytes = bincode::serialize(&renamed).expect("serialize DriftLocusCore");
            assert_eq!(
                bytes,
                bincode::serialize(&LegacyLocus::Renamed(&hex, "b.rs"))
                    .expect("serialize legacy locus"),
            );
            assert_eq!(
                bincode::deserialize::<DriftLocusCore>(&bytes).expect("round-trip"),
                renamed
            );
        }

        #[test]
        fn malformed_stored_oid_fails_decode() {
            let bytes = bincode::serialize(&("a.rs", ExtentCore::WholeFile, Some("not-hex")))
                .expect("serialize legacy shape");
            assert!(bincode::deserialize::<LocationCore>(&bytes).is_err());
        }
    }
}

/// A location at one layer: path, extent, and blob identity (`None` when the
/// layer has no blob — e.g. the worktree, or a terminal status with nothing
/// to point at).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LocationCore {
    pub(crate) path: String,
    pub(crate) extent: ExtentCore,
    #[serde(with = "oid_hex::option")]
    pub(crate) blob: Option<gix::ObjectId>,
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

/// Serde-capable mirror of `DriftLocus` (which derives no serde); the OIDs
/// persist as hex strings through `oid_hex`.
///
/// Variant names intentionally mirror `DriftLocus` exactly (`ChangedAt` /
/// `OrphanedAt` / `RenamedAt`) so the two stay obviously in lockstep; the
/// shared `At` postfix is a deliberate naming convention, not an oversight.
#[expect(
    clippy::enum_variant_names,
    reason = "variants mirror the exported `DriftLocus` 1:1 so the conversions read in lockstep"
)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum DriftLocusCore {
    ChangedAt(#[serde(with = "oid_hex")] gix::ObjectId),
    OrphanedAt(#[serde(with = "oid_hex")] gix::ObjectId),
    RenamedAt(#[serde(with = "oid_hex")] gix::ObjectId, String),
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
    /// the ordinal's `definition_digest`, distinguishing two definitions
    /// that share an address but not content.
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
