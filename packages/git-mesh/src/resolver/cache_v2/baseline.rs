//! Committed baseline: row-level non-`Fresh` finding rows + summary +
//! manifest, keyed by the composite committed key.
//!
//! The committed baseline is the HEAD-only resolution of every mesh.
//! Rendering only reports meshes that have at least one non-`Fresh`
//! anchor, so the cache stores **one row per non-`Fresh` anchor**
//! (carrying enough mesh context to regroup) rather than a whole
//! `Vec<MeshResolved>` blob. The manifest's `complete = 1` row
//! distinguishes "built and empty" (every mesh Fresh) from "not built
//! yet", so a fully-clean repository is a cache hit, not a perpetual
//! rebuild.

use super::dto::AnchorResolvedDto;
use super::keys::CommittedKey;
use super::schema::{CacheDb, KEY_SALT, now_secs};
use crate::types::{AnchorStatus, MeshResolved};
use crate::{Error, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

const FORMAT_VERSION: u8 = 1;

/// Payload stored per non-`Fresh` committed anchor finding.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct FindingRowPayload {
    format_version: u8,
    mesh_name: String,
    mesh_message: String,
    follow_moves: bool,
    /// Position of the mesh in the full resolved order, so regrouping
    /// preserves deterministic output ordering.
    mesh_order: u32,
    anchor: AnchorResolvedDto,
}

/// Aggregate counts persisted alongside the rows for output formats
/// that need totals without scanning every anchor.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct BaselineCounts {
    pub(crate) anchors_fresh: u64,
    pub(crate) anchors_moved: u64,
    pub(crate) anchors_changed: u64,
    pub(crate) anchors_deleted: u64,
    pub(crate) anchors_merge_conflict: u64,
    pub(crate) anchors_unavailable: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct SummaryPayload {
    format_version: u8,
    counts: BaselineCounts,
}

impl BaselineCounts {
    pub(crate) fn from_meshes(meshes: &[MeshResolved]) -> Self {
        use AnchorStatus::*;
        let mut c = Self::default();
        for m in meshes {
            for a in &m.anchors {
                match &a.status {
                    Fresh => c.anchors_fresh += 1,
                    Moved => c.anchors_moved += 1,
                    Changed => c.anchors_changed += 1,
                    Deleted => c.anchors_deleted += 1,
                    MergeConflict => c.anchors_merge_conflict += 1,
                    Submodule | ContentUnavailable(_) => c.anchors_unavailable += 1,
                }
            }
        }
        c
    }
}

fn status_tag(s: &AnchorStatus) -> &'static str {
    use AnchorStatus::*;
    match s {
        Fresh => "fresh",
        Moved => "moved",
        Changed => "changed",
        Deleted => "deleted",
        MergeConflict => "conflict",
        Submodule => "submodule",
        ContentUnavailable(_) => "unavailable",
    }
}

/// Persist the committed baseline derived from a full HEAD-only
/// resolution. Only non-`Fresh` anchors produce rows; the manifest is
/// always written (with `complete = 1`) so an all-Fresh repository is a
/// valid cache hit.
pub(crate) fn store_baseline(
    db: &CacheDb,
    key: &CommittedKey,
    availability_hex: &str,
    meshes: &[MeshResolved],
) -> Result<()> {
    let filter_hex = key.filter_hex();
    let counts = BaselineCounts::from_meshes(meshes);
    let mut non_fresh = 0u64;

    let tx = db
        .conn
        .unchecked_transaction()
        .map_err(|e| Error::Git(format!("cache_v2 baseline tx: {e}")))?;

    // Replace any prior rows for this exact key first so a rebuild does
    // not leave stale anchor rows behind.
    tx.execute(
        "DELETE FROM committed_stale_finding_rows \
         WHERE source_tree_key=?1 AND mesh_tree_key=?2 AND mesh_root=?3 \
           AND filter_config_hash=?4 AND key_salt=?5",
        rusqlite::params![
            key.source_tree_key,
            key.mesh_tree_key,
            key.mesh_root,
            filter_hex,
            key.key_salt
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 baseline clear: {e}")))?;

    for (order, mesh) in meshes.iter().enumerate() {
        for a in &mesh.anchors {
            if a.status == AnchorStatus::Fresh {
                continue;
            }
            non_fresh += 1;
            let payload = FindingRowPayload {
                format_version: FORMAT_VERSION,
                mesh_name: mesh.name.clone(),
                mesh_message: mesh.message.clone(),
                follow_moves: mesh.follow_moves,
                mesh_order: order as u32,
                anchor: AnchorResolvedDto::from(a),
            };
            let bytes = bincode::serialize(&payload)
                .map_err(|e| Error::Git(format!("cache_v2 finding serialize: {e}")))?;
            tx.execute(
                "INSERT OR REPLACE INTO committed_stale_finding_rows \
                 (source_tree_key, mesh_tree_key, mesh_root, filter_config_hash, \
                  key_salt, anchor_key, status, payload, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                rusqlite::params![
                    key.source_tree_key,
                    key.mesh_tree_key,
                    key.mesh_root,
                    filter_hex,
                    key.key_salt,
                    a.anchor_id,
                    status_tag(&a.status),
                    bytes,
                    now_secs()
                ],
            )
            .map_err(|e| Error::Git(format!("cache_v2 finding insert: {e}")))?;
        }
    }

    let summary = SummaryPayload {
        format_version: FORMAT_VERSION,
        counts,
    };
    let summary_bytes = bincode::serialize(&summary)
        .map_err(|e| Error::Git(format!("cache_v2 summary serialize: {e}")))?;
    tx.execute(
        "INSERT OR REPLACE INTO committed_stale_summary \
         (source_tree_key, mesh_tree_key, mesh_root, filter_config_hash, \
          key_salt, payload, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![
            key.source_tree_key,
            key.mesh_tree_key,
            key.mesh_root,
            filter_hex,
            key.key_salt,
            summary_bytes,
            now_secs()
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 summary insert: {e}")))?;

    tx.execute(
        "INSERT OR REPLACE INTO committed_baseline_manifest \
         (source_tree_key, mesh_tree_key, mesh_root, filter_config_hash, \
          availability_hash, key_salt, complete, non_fresh_count, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8)",
        rusqlite::params![
            key.source_tree_key,
            key.mesh_tree_key,
            key.mesh_root,
            filter_hex,
            availability_hex,
            key.key_salt,
            non_fresh as i64,
            now_secs()
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 manifest insert: {e}")))?;

    tx.commit()
        .map_err(|e| Error::Git(format!("cache_v2 baseline commit: {e}")))?;
    Ok(())
}

/// A loaded committed baseline: the reportable meshes (those with at
/// least one non-`Fresh` anchor), regrouped from finding rows, plus the
/// aggregate counts.
#[derive(Clone, Debug, Default)]
pub(crate) struct LoadedBaseline {
    pub(crate) meshes: Vec<MeshResolved>,
    pub(crate) counts: BaselineCounts,
    pub(crate) non_fresh_count: u64,
}

/// Load the committed baseline for `key` + `availability_hex`. Returns
/// `Ok(None)` on any miss: absent manifest, incomplete manifest, salt
/// mismatch, or a corrupt/shape-mismatched payload. Never errors on a
/// cache problem — a miss triggers a rebuild.
pub(crate) fn load_baseline(
    db: &CacheDb,
    key: &CommittedKey,
    availability_hex: &str,
) -> Result<Option<LoadedBaseline>> {
    let filter_hex = key.filter_hex();
    let manifest: Option<(i64, i64)> = db
        .conn
        .query_row(
            "SELECT complete, non_fresh_count FROM committed_baseline_manifest \
             WHERE source_tree_key=?1 AND mesh_tree_key=?2 AND mesh_root=?3 \
               AND filter_config_hash=?4 AND availability_hash=?5 AND key_salt=?6",
            rusqlite::params![
                key.source_tree_key,
                key.mesh_tree_key,
                key.mesh_root,
                filter_hex,
                availability_hex,
                key.key_salt
            ],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| Error::Git(format!("cache_v2 manifest select: {e}")))?;

    let Some((complete, non_fresh_count)) = manifest else {
        return Ok(None);
    };
    if complete != 1 {
        return Ok(None);
    }

    let mut stmt = db
        .conn
        .prepare(
            "SELECT payload FROM committed_stale_finding_rows \
             WHERE source_tree_key=?1 AND mesh_tree_key=?2 AND mesh_root=?3 \
               AND filter_config_hash=?4 AND key_salt=?5",
        )
        .map_err(|e| Error::Git(format!("cache_v2 finding prepare: {e}")))?;
    let rows = stmt
        .query_map(
            rusqlite::params![
                key.source_tree_key,
                key.mesh_tree_key,
                key.mesh_root,
                filter_hex,
                key.key_salt
            ],
            |r| r.get::<_, Vec<u8>>(0),
        )
        .map_err(|e| Error::Git(format!("cache_v2 finding query: {e}")))?;

    // Regroup rows into per-mesh resolved objects, preserving the
    // original mesh order captured at store time.
    let mut grouped: std::collections::BTreeMap<(u32, String), MeshResolved> =
        std::collections::BTreeMap::new();
    for row in rows {
        let bytes = row.map_err(|e| Error::Git(format!("cache_v2 finding row: {e}")))?;
        let payload: FindingRowPayload = match bincode::deserialize(&bytes) {
            Ok(p) => p,
            Err(_) => return Ok(None),
        };
        if payload.format_version != FORMAT_VERSION {
            return Ok(None);
        }
        let anchor = match payload.anchor.try_into() {
            Ok(a) => a,
            Err(_) => return Ok(None),
        };
        let entry = grouped
            .entry((payload.mesh_order, payload.mesh_name.clone()))
            .or_insert_with(|| MeshResolved {
                name: payload.mesh_name.clone(),
                message: payload.mesh_message.clone(),
                anchors: Vec::new(),
                pending: Vec::new(),
                follow_moves: payload.follow_moves,
            });
        entry.anchors.push(anchor);
    }
    let meshes: Vec<MeshResolved> = grouped.into_values().collect();

    let summary: Option<Vec<u8>> = db
        .conn
        .query_row(
            "SELECT payload FROM committed_stale_summary \
             WHERE source_tree_key=?1 AND mesh_tree_key=?2 AND mesh_root=?3 \
               AND filter_config_hash=?4 AND key_salt=?5",
            rusqlite::params![
                key.source_tree_key,
                key.mesh_tree_key,
                key.mesh_root,
                filter_hex,
                key.key_salt
            ],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| Error::Git(format!("cache_v2 summary select: {e}")))?;
    let counts = match summary {
        Some(bytes) => match bincode::deserialize::<SummaryPayload>(&bytes) {
            Ok(s) if s.format_version == FORMAT_VERSION => s.counts,
            _ => return Ok(None),
        },
        None => return Ok(None),
    };

    Ok(Some(LoadedBaseline {
        meshes,
        counts,
        non_fresh_count: non_fresh_count as u64,
    }))
}

/// Delete the committed baseline for this exact key (tests only; the
/// runtime invalidates by key, not by deletion). `_ = KEY_SALT` keeps
/// the salt constant referenced from this module.
pub(crate) fn delete_baseline(db: &CacheDb, key: &CommittedKey, availability_hex: &str) -> Result<()> {
    let _ = KEY_SALT;
    let filter_hex = key.filter_hex();
    db.conn
        .execute(
            "DELETE FROM committed_baseline_manifest \
             WHERE source_tree_key=?1 AND mesh_tree_key=?2 AND mesh_root=?3 \
               AND filter_config_hash=?4 AND availability_hash=?5 AND key_salt=?6",
            rusqlite::params![
                key.source_tree_key,
                key.mesh_tree_key,
                key.mesh_root,
                filter_hex,
                availability_hex,
                key.key_salt
            ],
        )
        .map_err(|e| Error::Git(format!("cache_v2 manifest delete: {e}")))?;
    Ok(())
}
