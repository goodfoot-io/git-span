//! Lazy moved-location cache.
//!
//! Keyed by `(source_tree_key, filter_config_hash, key_salt,
//! hash_algorithm, content_hash, extent_kind, line_count)` — it is
//! intentionally independent of `mesh_root` and `mesh_tree_key`:
//! mesh-file edits must not invalidate source-content location scans.
//!
//! `moved_scan_manifest` records positive **and negative** completion
//! per scan key. A complete manifest with `location_count = 0` is a
//! valid hit: without it an empty moved lookup would repeat the
//! expensive repository scan on every run.

use super::schema::{CacheDb, KEY_SALT, now_secs};
use crate::{Error, Result};
use rusqlite::OptionalExtension;

/// Stable identity of one moved-scan query: a stored content hash plus
/// the extent shape, scoped to a source tree + normalization config.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MovedScanKey {
    pub(crate) source_tree_key: String,
    pub(crate) filter_config_hash_hex: String,
    pub(crate) hash_algorithm: String,
    pub(crate) content_hash: String,
    /// `"whole-file"` or `"line-range"`.
    pub(crate) extent_kind: String,
    /// Number of lines in the extent (`0` for whole-file).
    pub(crate) line_count: i64,
}

/// One candidate location where the stored content hash was found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MovedLocation {
    pub(crate) source_path: String,
    pub(crate) start_line: u32,
    pub(crate) end_line: u32,
}

/// Persist the scan result for `key`. `locations` may be empty; the
/// manifest still records `complete = 1` so the negative result is a
/// cache hit on the next run.
pub(crate) fn store_scan(
    db: &CacheDb,
    key: &MovedScanKey,
    locations: &[MovedLocation],
) -> Result<()> {
    let tx = db
        .conn
        .unchecked_transaction()
        .map_err(|e| Error::Git(format!("cache_v2 moved tx: {e}")))?;
    tx.execute(
        "DELETE FROM moved_location_rows \
         WHERE source_tree_key=?1 AND filter_config_hash=?2 AND key_salt=?3 \
           AND hash_algorithm=?4 AND content_hash=?5 AND extent_kind=?6 \
           AND line_count=?7",
        rusqlite::params![
            key.source_tree_key,
            key.filter_config_hash_hex,
            KEY_SALT,
            key.hash_algorithm,
            key.content_hash,
            key.extent_kind,
            key.line_count
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 moved clear: {e}")))?;
    for loc in locations {
        tx.execute(
            "INSERT OR REPLACE INTO moved_location_rows \
             (source_tree_key, filter_config_hash, key_salt, hash_algorithm, \
              content_hash, extent_kind, line_count, source_path, start_line, \
              end_line, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                key.source_tree_key,
                key.filter_config_hash_hex,
                KEY_SALT,
                key.hash_algorithm,
                key.content_hash,
                key.extent_kind,
                key.line_count,
                loc.source_path,
                loc.start_line as i64,
                loc.end_line as i64,
                now_secs()
            ],
        )
        .map_err(|e| Error::Git(format!("cache_v2 moved insert: {e}")))?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO moved_scan_manifest \
         (source_tree_key, filter_config_hash, key_salt, hash_algorithm, \
          content_hash, extent_kind, line_count, complete, location_count, \
          created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,?9)",
        rusqlite::params![
            key.source_tree_key,
            key.filter_config_hash_hex,
            KEY_SALT,
            key.hash_algorithm,
            key.content_hash,
            key.extent_kind,
            key.line_count,
            locations.len() as i64,
            now_secs()
        ],
    )
    .map_err(|e| Error::Git(format!("cache_v2 moved manifest insert: {e}")))?;
    tx.commit()
        .map_err(|e| Error::Git(format!("cache_v2 moved commit: {e}")))?;
    Ok(())
}

/// Load the cached scan for `key`. `Ok(Some(vec))` (possibly empty) is
/// a hit backed by a complete manifest; `Ok(None)` is a miss that
/// requires a scan.
pub(crate) fn load_scan(db: &CacheDb, key: &MovedScanKey) -> Result<Option<Vec<MovedLocation>>> {
    let complete: Option<i64> = db
        .conn
        .query_row(
            "SELECT complete FROM moved_scan_manifest \
             WHERE source_tree_key=?1 AND filter_config_hash=?2 AND key_salt=?3 \
               AND hash_algorithm=?4 AND content_hash=?5 AND extent_kind=?6 \
               AND line_count=?7",
            rusqlite::params![
                key.source_tree_key,
                key.filter_config_hash_hex,
                KEY_SALT,
                key.hash_algorithm,
                key.content_hash,
                key.extent_kind,
                key.line_count
            ],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| Error::Git(format!("cache_v2 moved manifest select: {e}")))?;
    let Some(complete) = complete else {
        return Ok(None);
    };
    if complete != 1 {
        return Ok(None);
    }
    let mut stmt = db
        .conn
        .prepare(
            "SELECT source_path, start_line, end_line FROM moved_location_rows \
             WHERE source_tree_key=?1 AND filter_config_hash=?2 AND key_salt=?3 \
               AND hash_algorithm=?4 AND content_hash=?5 AND extent_kind=?6 \
               AND line_count=?7",
        )
        .map_err(|e| Error::Git(format!("cache_v2 moved prepare: {e}")))?;
    let rows = stmt
        .query_map(
            rusqlite::params![
                key.source_tree_key,
                key.filter_config_hash_hex,
                KEY_SALT,
                key.hash_algorithm,
                key.content_hash,
                key.extent_kind,
                key.line_count
            ],
            |r| {
                Ok(MovedLocation {
                    source_path: r.get(0)?,
                    start_line: r.get::<_, i64>(1)? as u32,
                    end_line: r.get::<_, i64>(2)? as u32,
                })
            },
        )
        .map_err(|e| Error::Git(format!("cache_v2 moved query: {e}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| Error::Git(format!("cache_v2 moved row: {e}")))?);
    }
    Ok(Some(out))
}
