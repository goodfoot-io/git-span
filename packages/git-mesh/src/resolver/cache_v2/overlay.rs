//! Dirty overlay: row-level findings for only the meshes whose anchors
//! are affected by the current index/worktree changes, keyed by the
//! `overlay_key`.
//!
//! The overlay stores the *full* re-resolved state of each affected
//! mesh (its reportable anchors) so merging onto the committed baseline
//! is a per-mesh replace: an affected mesh takes its overlay value, an
//! unaffected mesh keeps its baseline value. The `dirty_overlay_manifest`
//! row (with `complete = 1`) records positive/negative completion so an
//! affected set that resolves to "no findings" is a hit, not a rebuild.

use super::dto::AnchorResolvedDto;
use super::keys::OverlayKeyInputs;
use super::schema::{CacheDb, now_secs};
use crate::types::MeshResolved;
use crate::{Error, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const FORMAT_VERSION: u8 = 1;

/// One overlay finding row: a non-`Fresh` anchor of an affected mesh,
/// plus the mesh context needed to regroup it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct OverlayRowPayload {
    format_version: u8,
    mesh_name: String,
    mesh_message: String,
    follow_moves: bool,
    mesh_order: u32,
    anchor: AnchorResolvedDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct OverlaySummaryPayload {
    format_version: u8,
    /// Names of every mesh the overlay re-resolved, even those that
    /// became all-`Fresh` (so the merge knows to drop them).
    affected_meshes: Vec<String>,
}

/// In-memory overlay: the affected mesh set + their re-resolved
/// reportable form.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DirtyOverlay {
    pub(crate) affected_meshes: Vec<String>,
    pub(crate) meshes: Vec<MeshResolved>,
}

pub(crate) fn store_overlay(
    db: &CacheDb,
    inputs: &OverlayKeyInputs,
    overlay: &DirtyOverlay,
) -> Result<()> {
    let key = inputs.key().to_vec();
    let tx = db
        .conn
        .unchecked_transaction()
        .map_err(|e| Error::Git(format!("cache_v2 overlay tx: {e}")))?;
    tx.execute(
        "DELETE FROM dirty_stale_finding_rows WHERE overlay_key=?1",
        rusqlite::params![key],
    )
    .map_err(|e| Error::Git(format!("cache_v2 overlay clear: {e}")))?;

    let mut non_fresh = 0u64;
    let mut affected_anchor_count = 0u64;
    for (order, mesh) in overlay.meshes.iter().enumerate() {
        for a in &mesh.anchors {
            affected_anchor_count += 1;
            if a.status == crate::types::AnchorStatus::Fresh {
                continue;
            }
            non_fresh += 1;
            let payload = OverlayRowPayload {
                format_version: FORMAT_VERSION,
                mesh_name: mesh.name.clone(),
                mesh_message: mesh.message.clone(),
                follow_moves: mesh.follow_moves,
                mesh_order: order as u32,
                anchor: AnchorResolvedDto::from(a),
            };
            let bytes = bincode::serialize(&payload)
                .map_err(|e| Error::Git(format!("cache_v2 overlay serialize: {e}")))?;
            tx.execute(
                "INSERT OR REPLACE INTO dirty_stale_finding_rows \
                 (overlay_key, anchor_key, status, payload, created_at) \
                 VALUES (?1,?2,?3,?4,?5)",
                rusqlite::params![
                    key,
                    a.anchor_id,
                    format!("{:?}", a.status),
                    bytes,
                    now_secs()
                ],
            )
            .map_err(|e| Error::Git(format!("cache_v2 overlay insert: {e}")))?;
        }
    }

    let summary = OverlaySummaryPayload {
        format_version: FORMAT_VERSION,
        affected_meshes: overlay.affected_meshes.clone(),
    };
    let summary_bytes = bincode::serialize(&summary)
        .map_err(|e| Error::Git(format!("cache_v2 overlay summary serialize: {e}")))?;
    tx.execute(
        "INSERT OR REPLACE INTO dirty_stale_summary (overlay_key, payload, created_at) \
         VALUES (?1,?2,?3)",
        rusqlite::params![key, summary_bytes, now_secs()],
    )
    .map_err(|e| Error::Git(format!("cache_v2 overlay summary insert: {e}")))?;

    tx.execute(
        "INSERT OR REPLACE INTO dirty_overlay_manifest \
         (overlay_key, complete, affected_anchor_count, non_fresh_count, created_at) \
         VALUES (?1,1,?2,?3,?4)",
        rusqlite::params![
            key,
            affected_anchor_count as i64,
            non_fresh as i64,
            now_secs()
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 overlay manifest insert: {e}")))?;

    tx.commit()
        .map_err(|e| Error::Git(format!("cache_v2 overlay commit: {e}")))?;
    Ok(())
}

pub(crate) fn load_overlay(
    db: &CacheDb,
    inputs: &OverlayKeyInputs,
) -> Result<Option<DirtyOverlay>> {
    let key = inputs.key().to_vec();
    let complete: Option<i64> = db
        .conn
        .query_row(
            "SELECT complete FROM dirty_overlay_manifest WHERE overlay_key=?1",
            rusqlite::params![key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| Error::Git(format!("cache_v2 overlay manifest select: {e}")))?;
    let Some(complete) = complete else {
        return Ok(None);
    };
    if complete != 1 {
        return Ok(None);
    }

    let summary: Option<Vec<u8>> = db
        .conn
        .query_row(
            "SELECT payload FROM dirty_stale_summary WHERE overlay_key=?1",
            rusqlite::params![key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| Error::Git(format!("cache_v2 overlay summary select: {e}")))?;
    let affected_meshes = match summary {
        Some(bytes) => match bincode::deserialize::<OverlaySummaryPayload>(&bytes) {
            Ok(s) if s.format_version == FORMAT_VERSION => s.affected_meshes,
            _ => return Ok(None),
        },
        None => return Ok(None),
    };

    let mut stmt = db
        .conn
        .prepare("SELECT payload FROM dirty_stale_finding_rows WHERE overlay_key=?1")
        .map_err(|e| Error::Git(format!("cache_v2 overlay prepare: {e}")))?;
    let rows = stmt
        .query_map(rusqlite::params![key], |r| r.get::<_, Vec<u8>>(0))
        .map_err(|e| Error::Git(format!("cache_v2 overlay query: {e}")))?;
    let mut grouped: std::collections::BTreeMap<(u32, String), MeshResolved> =
        std::collections::BTreeMap::new();
    for row in rows {
        let bytes = row.map_err(|e| Error::Git(format!("cache_v2 overlay row: {e}")))?;
        let payload: OverlayRowPayload = match bincode::deserialize(&bytes) {
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
        grouped
            .entry((payload.mesh_order, payload.mesh_name.clone()))
            .or_insert_with(|| MeshResolved {
                name: payload.mesh_name.clone(),
                message: payload.mesh_message.clone(),
                anchors: Vec::new(),
                pending: Vec::new(),
                follow_moves: payload.follow_moves,
            })
            .anchors
            .push(anchor);
    }
    Ok(Some(DirtyOverlay {
        affected_meshes,
        meshes: grouped.into_values().collect(),
    }))
}

/// Merge `overlay` onto `baseline_meshes` (the reportable committed
/// meshes). A mesh named in `affected_meshes` takes its overlay value
/// (or is dropped if the overlay produced no reportable form); every
/// other mesh keeps its baseline value. Baseline order is preserved;
/// overlay-only meshes are appended.
pub(crate) fn apply_overlay(
    baseline_meshes: &[MeshResolved],
    overlay: &DirtyOverlay,
) -> Vec<MeshResolved> {
    let affected: HashSet<&str> = overlay.affected_meshes.iter().map(|s| s.as_str()).collect();
    let overlay_by_name: std::collections::HashMap<&str, &MeshResolved> = overlay
        .meshes
        .iter()
        .map(|m| (m.name.as_str(), m))
        .collect();
    let mut out: Vec<MeshResolved> =
        Vec::with_capacity(baseline_meshes.len() + overlay.meshes.len());
    let mut seen: HashSet<String> = HashSet::new();
    for m in baseline_meshes {
        if affected.contains(m.name.as_str()) {
            seen.insert(m.name.clone());
            if let Some(rep) = overlay_by_name.get(m.name.as_str()) {
                out.push((*rep).clone());
            }
            // Affected but no reportable overlay form ⇒ mesh became
            // all-Fresh; drop it from the rendered set.
            continue;
        }
        out.push(m.clone());
    }
    for m in &overlay.meshes {
        if !seen.contains(&m.name) {
            out.push(m.clone());
        }
    }
    out
}
