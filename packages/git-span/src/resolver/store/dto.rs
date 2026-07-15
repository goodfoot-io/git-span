//! Serializable mirrors of the runtime resolver types.
//!
//! The runtime `SpanResolved` / `AnchorResolved` / `AnchorLocation` types
//! embed `gix::ObjectId`, `PathBuf`, and other non-`serde` shapes. To
//! persist them across invocations we round-trip through pure-bytes DTOs
//! that derive `Serialize` + `Deserialize` over `String` / `Vec<u8>`.
//! Conversion is total: every runtime instance has exactly one DTO
//! representation and vice versa.
//!
//! These DTOs back the compact, render-ready generation summary the store
//! persists (`resolver::exact::StaleSummary`): the summary is
//! `bincode::serialize`(DTO). A `format_version: u8` field is the first
//! field of every top-level DTO so a future shape change can be detected as
//! a deserialization failure (and reported as a miss). The store's
//! canonical-key digest is the primary invalidation mechanism;
//! `format_version` is a belt-and-braces second line of defense.

use crate::types::{
    AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, DriftLocus, DriftSource,
    FuzzySuccessor, SpanResolved, UnavailableReason,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;

pub(crate) const FORMAT_VERSION: u8 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum AnchorExtentDto {
    WholeFile,
    LineRange { start: u32, end: u32 },
}

impl From<AnchorExtent> for AnchorExtentDto {
    fn from(e: AnchorExtent) -> Self {
        match e {
            AnchorExtent::WholeFile => AnchorExtentDto::WholeFile,
            AnchorExtent::LineRange { start, end } => AnchorExtentDto::LineRange { start, end },
        }
    }
}

impl AnchorExtentDto {
    // `AnchorExtent` lives in `git-span-core`, so a `From<AnchorExtentDto>
    // for AnchorExtent` impl would violate the orphan rule (both the trait
    // and the target type are foreign). An inherent method on the local DTO
    // is the equivalent total conversion.
    pub(crate) fn into_extent(self) -> AnchorExtent {
        match self {
            AnchorExtentDto::WholeFile => AnchorExtent::WholeFile,
            AnchorExtentDto::LineRange { start, end } => AnchorExtent::LineRange { start, end },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AnchorLocationDto {
    pub(crate) path: String,
    pub(crate) extent: AnchorExtentDto,
    /// Hex object id when present.
    pub(crate) blob: Option<String>,
}

impl From<&AnchorLocation> for AnchorLocationDto {
    fn from(l: &AnchorLocation) -> Self {
        Self {
            path: l.path.to_string_lossy().into_owned(),
            extent: l.extent.into(),
            blob: l.blob.map(|b| b.to_string()),
        }
    }
}

impl TryFrom<AnchorLocationDto> for AnchorLocation {
    type Error = crate::Error;
    fn try_from(dto: AnchorLocationDto) -> Result<Self, Self::Error> {
        let blob = match dto.blob {
            Some(s) => Some(gix::ObjectId::from_str(&s).map_err(|e| {
                crate::Error::Git(format!("store dto: parse blob oid `{s}`: {e}"))
            })?),
            None => None,
        };
        Ok(AnchorLocation {
            path: PathBuf::from(dto.path),
            extent: dto.extent.into_extent(),
            blob,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum UnavailableReasonDto {
    LfsNotFetched,
    LfsNotInstalled,
    PromisorMissing,
    SparseExcluded,
    FilterFailed { filter: String },
    IoError { message: String },
}

impl From<&UnavailableReason> for UnavailableReasonDto {
    fn from(r: &UnavailableReason) -> Self {
        match r {
            UnavailableReason::LfsNotFetched => UnavailableReasonDto::LfsNotFetched,
            UnavailableReason::LfsNotInstalled => UnavailableReasonDto::LfsNotInstalled,
            UnavailableReason::PromisorMissing => UnavailableReasonDto::PromisorMissing,
            UnavailableReason::SparseExcluded => UnavailableReasonDto::SparseExcluded,
            UnavailableReason::FilterFailed { filter } => UnavailableReasonDto::FilterFailed {
                filter: filter.clone(),
            },
            UnavailableReason::IoError { message } => UnavailableReasonDto::IoError {
                message: message.clone(),
            },
        }
    }
}

impl From<UnavailableReasonDto> for UnavailableReason {
    fn from(r: UnavailableReasonDto) -> Self {
        match r {
            UnavailableReasonDto::LfsNotFetched => UnavailableReason::LfsNotFetched,
            UnavailableReasonDto::LfsNotInstalled => UnavailableReason::LfsNotInstalled,
            UnavailableReasonDto::PromisorMissing => UnavailableReason::PromisorMissing,
            UnavailableReasonDto::SparseExcluded => UnavailableReason::SparseExcluded,
            UnavailableReasonDto::FilterFailed { filter } => {
                UnavailableReason::FilterFailed { filter }
            }
            UnavailableReasonDto::IoError { message } => UnavailableReason::IoError { message },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum AnchorStatusDto {
    Fresh,
    ResolvedPendingCommit,
    Moved,
    Changed,
    Deleted,
    MergeConflict,
    Submodule,
    ContentUnavailable(UnavailableReasonDto),
}

impl From<&AnchorStatus> for AnchorStatusDto {
    fn from(s: &AnchorStatus) -> Self {
        match s {
            AnchorStatus::Fresh => AnchorStatusDto::Fresh,
            AnchorStatus::ResolvedPendingCommit => AnchorStatusDto::ResolvedPendingCommit,
            AnchorStatus::Moved => AnchorStatusDto::Moved,
            AnchorStatus::Changed => AnchorStatusDto::Changed,
            AnchorStatus::Deleted => AnchorStatusDto::Deleted,
            AnchorStatus::MergeConflict => AnchorStatusDto::MergeConflict,
            AnchorStatus::Submodule => AnchorStatusDto::Submodule,
            AnchorStatus::ContentUnavailable(r) => AnchorStatusDto::ContentUnavailable(r.into()),
        }
    }
}

impl From<AnchorStatusDto> for AnchorStatus {
    fn from(s: AnchorStatusDto) -> Self {
        match s {
            AnchorStatusDto::Fresh => AnchorStatus::Fresh,
            AnchorStatusDto::ResolvedPendingCommit => AnchorStatus::ResolvedPendingCommit,
            AnchorStatusDto::Moved => AnchorStatus::Moved,
            AnchorStatusDto::Changed => AnchorStatus::Changed,
            AnchorStatusDto::Deleted => AnchorStatus::Deleted,
            AnchorStatusDto::MergeConflict => AnchorStatus::MergeConflict,
            AnchorStatusDto::Submodule => AnchorStatus::Submodule,
            AnchorStatusDto::ContentUnavailable(r) => AnchorStatus::ContentUnavailable(r.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum DriftSourceDto {
    Head,
    Index,
    Worktree,
}

impl From<DriftSource> for DriftSourceDto {
    fn from(s: DriftSource) -> Self {
        match s {
            DriftSource::Head => DriftSourceDto::Head,
            DriftSource::Index => DriftSourceDto::Index,
            DriftSource::Worktree => DriftSourceDto::Worktree,
        }
    }
}

impl From<DriftSourceDto> for DriftSource {
    fn from(s: DriftSourceDto) -> Self {
        match s {
            DriftSourceDto::Head => DriftSource::Head,
            DriftSourceDto::Index => DriftSource::Index,
            DriftSourceDto::Worktree => DriftSource::Worktree,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum DriftLocusDto {
    ChangedAt(String),
    OrphanedAt(String),
}

impl From<DriftLocus> for DriftLocusDto {
    fn from(l: DriftLocus) -> Self {
        match l {
            DriftLocus::ChangedAt(oid) => DriftLocusDto::ChangedAt(oid.to_string()),
            DriftLocus::OrphanedAt(oid) => DriftLocusDto::OrphanedAt(oid.to_string()),
        }
    }
}

impl TryFrom<DriftLocusDto> for DriftLocus {
    type Error = crate::Error;
    fn try_from(dto: DriftLocusDto) -> Result<Self, Self::Error> {
        Ok(match dto {
            DriftLocusDto::ChangedAt(s) => {
                DriftLocus::ChangedAt(gix::ObjectId::from_str(&s).map_err(|e| {
                    crate::Error::Git(format!("store dto: parse locus oid: {e}"))
                })?)
            }
            DriftLocusDto::OrphanedAt(s) => {
                DriftLocus::OrphanedAt(gix::ObjectId::from_str(&s).map_err(|e| {
                    crate::Error::Git(format!("store dto: parse locus oid: {e}"))
                })?)
            }
        })
    }
}

/// DTO mirror of [`FuzzySuccessor`] with `Eq` by storing confidence as
/// basis points (0-10000 → 0.00%–100.00%).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct FuzzySuccessorDto {
    pub(crate) path: String,
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// Confidence × 10000 (basis points). 0.9500 → 9500.
    pub(crate) confidence_bps: u32,
}

impl From<&FuzzySuccessor> for FuzzySuccessorDto {
    fn from(f: &FuzzySuccessor) -> Self {
        Self {
            path: f.path.clone(),
            start: f.start,
            end: f.end,
            confidence_bps: (f.confidence * 10000.0).round() as u32,
        }
    }
}

impl From<&FuzzySuccessorDto> for FuzzySuccessor {
    fn from(d: &FuzzySuccessorDto) -> Self {
        FuzzySuccessor {
            path: d.path.clone(),
            start: d.start,
            end: d.end,
            confidence: d.confidence_bps as f64 / 10000.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AnchorResolvedDto {
    pub(crate) anchor_id: String,
    pub(crate) anchor_sha: String,
    pub(crate) anchored: AnchorLocationDto,
    pub(crate) current: Option<AnchorLocationDto>,
    pub(crate) status: AnchorStatusDto,
    #[serde(default)]
    pub(crate) content_equivalent: bool,
    pub(crate) source: Option<DriftSourceDto>,
    pub(crate) layer_sources: Vec<DriftSourceDto>,
    pub(crate) locus: Option<DriftLocusDto>,
    /// Fuzzy successors (empty for anchors without fuzzy matches). Serde
    /// default so cached data from older format versions deserializes
    /// without error.
    #[serde(default)]
    pub(crate) fuzzy_successors: Vec<FuzzySuccessorDto>,
}

impl From<&AnchorResolved> for AnchorResolvedDto {
    fn from(a: &AnchorResolved) -> Self {
        Self {
            anchor_id: a.anchor_id.clone(),
            anchor_sha: a.anchor_sha.clone(),
            anchored: (&a.anchored).into(),
            current: a.current.as_ref().map(Into::into),
            status: (&a.status).into(),
            content_equivalent: a.content_equivalent,
            source: a.source.map(Into::into),
            layer_sources: a.layer_sources.iter().copied().map(Into::into).collect(),
            locus: a.locus.map(Into::into),
            fuzzy_successors: a.fuzzy_successors.iter().map(Into::into).collect(),
        }
    }
}

impl TryFrom<AnchorResolvedDto> for AnchorResolved {
    type Error = crate::Error;
    fn try_from(d: AnchorResolvedDto) -> Result<Self, Self::Error> {
        let current = match d.current {
            Some(c) => Some(c.try_into()?),
            None => None,
        };
        let locus = match d.locus {
            Some(l) => Some(l.try_into()?),
            None => None,
        };
        Ok(AnchorResolved {
            anchor_id: d.anchor_id,
            anchor_sha: d.anchor_sha,
            anchored: d.anchored.try_into()?,
            current,
            status: d.status.into(),
            content_equivalent: d.content_equivalent,
            source: d.source.map(Into::into),
            layer_sources: d.layer_sources.into_iter().map(Into::into).collect(),
            locus,
            fuzzy_successors: d.fuzzy_successors.iter().map(Into::into).collect(),
        })
    }
}

/// Persisted shape of `SpanResolved`. The persistent baseline captures the
/// committed (HEAD-only) resolution.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct SpanResolvedDto {
    pub(crate) format_version: u8,
    pub(crate) name: String,
    pub(crate) message: String,
    pub(crate) anchors: Vec<AnchorResolvedDto>,
    pub(crate) follow_moves: bool,
}

impl From<&SpanResolved> for SpanResolvedDto {
    fn from(m: &SpanResolved) -> Self {
        Self {
            format_version: FORMAT_VERSION,
            name: m.name.clone(),
            message: m.message.clone(),
            anchors: m.anchors.iter().map(Into::into).collect(),
            follow_moves: m.follow_moves,
        }
    }
}

impl TryFrom<SpanResolvedDto> for SpanResolved {
    type Error = crate::Error;
    fn try_from(d: SpanResolvedDto) -> Result<Self, Self::Error> {
        if d.format_version != FORMAT_VERSION {
            return Err(crate::Error::Git(format!(
                "store dto: format_version {} != expected {}",
                d.format_version, FORMAT_VERSION
            )));
        }
        let mut anchors = Vec::with_capacity(d.anchors.len());
        for a in d.anchors {
            anchors.push(a.try_into()?);
        }
        Ok(SpanResolved {
            name: d.name,
            message: d.message,
            anchors,
            follow_moves: d.follow_moves,
        })
    }
}
