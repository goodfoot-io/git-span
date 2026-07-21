//! Shared drift-label formatter for `stale`, `stale --patch`, and `show`.
//!
//! Maps an anchor's resolved status to a human-readable label using the
//! seven-row vocabulary table from the card spec:
//!
//! | State | Label |
//! |---|---|
//! | Changed in worktree | `changed in the working tree` |
//! | Deleted in worktree | `deleted in the working tree` |
//! | Changed in index | `changed in the index` |
//! | Deleted in index | `deleted in the index` |
//! | Changed at sha | `changed in <sha>` |
//! | Deleted at sha | `deleted in <sha>` |
//! | Deleted (no sha) | `deleted` |
//!
//! Precedence is enforced by the engine before reaching this formatter:
//! worktree → index → HEAD history walk.

use crate::types::{AnchorStatus, DriftLocus, DriftSource, UnavailableReason};

/// Format a human-readable drift label for a single anchor.
///
/// Output is always lowercase (the bare label form). Callers that need an
/// uppercase-leading form should uppercase the first character themselves —
/// this keeps the formatter as a single source of truth for vocabulary.
///
/// # Arguments
///
/// * `status` — The resolved anchor status.
/// * `source` — The layer at which drift was detected (`None` for `Fresh`
///   and terminal statuses).
/// * `locus` — The HEAD-history locus describing the first commit on the
///   path that mutated the anchored range or removed/renamed the path
///   (`None` when `source != Head` or the anchor sha is unreachable).
/// * `current_blob_present` — `true` when the content still exists at the
///   drift locus (path present); `false` when the path has been removed
///   (deletion / orphan via rename).
pub fn format_drift_label(
    status: &AnchorStatus,
    source: Option<DriftSource>,
    locus: Option<&DriftLocus>,
    current_blob_present: bool,
) -> String {
    match status {
        AnchorStatus::Changed => match source {
            Some(DriftSource::Worktree) => {
                if current_blob_present {
                    "changed in the working tree".to_string()
                } else {
                    "deleted in the working tree".to_string()
                }
            }
            Some(DriftSource::Index) => {
                if current_blob_present {
                    "changed in the index".to_string()
                } else {
                    "deleted in the index".to_string()
                }
            }
            Some(DriftSource::Head) => match locus {
                Some(DriftLocus::ChangedAt(oid)) => {
                    format!("changed in {}", short_sha(oid))
                }
                Some(DriftLocus::OrphanedAt(oid)) => {
                    format!("deleted in {}", short_sha(oid))
                }
                // Stub-phase: `RenamedAt` is only ever produced for a
                // `Deleted` anchor (see `resolver::attribution`), so this
                // arm is not reachable yet; mirror `OrphanedAt`'s label
                // until Phase 3 differentiates it.
                Some(DriftLocus::RenamedAt(oid, _)) => {
                    format!("deleted in {}", short_sha(oid))
                }
                None => "changed".to_string(),
            },
            None => "changed".to_string(),
        },
        AnchorStatus::Deleted => match locus {
            Some(DriftLocus::OrphanedAt(oid)) => format!("deleted in {}", short_sha(oid)),
            Some(DriftLocus::ChangedAt(oid)) => format!("deleted in {}", short_sha(oid)),
            Some(DriftLocus::RenamedAt(oid, _)) => format!("deleted in {}", short_sha(oid)),
            None => "deleted".to_string(),
        },
        // The non-Changed/Deleted arms keep their existing vocabulary; the
        // callers handle them directly (this formatter is the source of
        // truth only for the seven-row drift table).
        AnchorStatus::Moved => "moved".to_string(),
        AnchorStatus::ResolvedPendingCommit => "resolved, pending commit".to_string(),
        AnchorStatus::MergeConflict => "merge conflict".to_string(),
        AnchorStatus::Submodule => "submodule".to_string(),
        AnchorStatus::ContentUnavailable(reason) => {
            let detail = match reason {
                UnavailableReason::LfsNotFetched => "LFS not fetched",
                UnavailableReason::LfsNotInstalled => "LFS not installed",
                UnavailableReason::PromisorMissing => "promisor missing",
                UnavailableReason::SparseExcluded => "sparse excluded",
                UnavailableReason::FilterFailed { .. } => "filter failed",
                UnavailableReason::IoError { .. } => "I/O error",
            };
            format!("content unavailable ({detail})")
        }
        AnchorStatus::Fresh => String::new(),
    }
}

fn short_sha(oid: &gix::ObjectId) -> String {
    let hex = oid.to_string();
    hex[..7.min(hex.len())].to_string()
}
