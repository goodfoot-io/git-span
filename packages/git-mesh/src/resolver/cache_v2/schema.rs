//! SQLite open, schema bootstrap, key salt, and the filter/normalization
//! config hash for the file-backed (`cache_v2`) stale cache.
//!
//! The database lives at `$GIT_COMMON_DIR/mesh/stale-cache.db` and is
//! opened in WAL mode with `synchronous=NORMAL` so linked worktrees can
//! share one cache. Every row is derived data: a missing key, an
//! incomplete manifest, or a `key_salt` mismatch is a cache miss and a
//! rebuild — never an error and never a wrong answer.
//!
//! `KEY_SALT` is a namespace constant, not a migration version. Bump it
//! whenever the canonical key bytes, the payload schema, or any hashed
//! input changes; old rows simply stop being matched and a future gc
//! pass removes them.

use crate::{Error, Result};
use blake3::Hasher;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Database file basename under `<common_dir>/mesh/`.
pub(crate) const DB_BASENAME: &str = "stale-cache.db";

/// `cache_v2` cache namespace. Increment on any on-disk shape change.
pub(crate) const KEY_SALT: i64 = 2;

/// SQLite `user_version` schema discriminator.  Bump whenever `SCHEMA_SQL`
/// changes shape (new table, column, or index).  Independent of `KEY_SALT`
/// (the cache namespace / row discriminator): new tables can be added to
/// `SCHEMA_SQL` without a `KEY_SALT` bump.
const SCHEMA_VERSION: i64 = 1;

/// Resolve the cache database path for a repository. The parent
/// directory is created lazily by [`open_cache`].
pub(crate) fn db_path(repo: &gix::Repository) -> PathBuf {
    crate::git::common_dir(repo).join("mesh").join(DB_BASENAME)
}

/// Open (or create) the `cache_v2` database, applying the schema and WAL
/// pragmas.
pub(crate) fn open_cache(repo: &gix::Repository) -> Result<CacheDb> {
    open_cache_at(&db_path(repo))
}

/// Like [`open_cache`] but takes a raw filesystem path; used by tests
/// that do not want a full `gix::Repository`.
pub(crate) fn open_cache_at(path: &Path) -> Result<CacheDb> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| Error::Git(format!("create cache_v2 dir `{}`: {e}", parent.display())))?;
    }
    let conn = Connection::open(path)
        .map_err(|e| Error::Git(format!("open cache_v2 db `{}`: {e}", path.display())))?;
    // Per-connection pragmas — must run on every open.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| Error::Git(format!("set journal_mode=WAL: {e}")))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| Error::Git(format!("set synchronous=NORMAL: {e}")))?;
    conn.busy_timeout(std::time::Duration::from_millis(1_000))
        .map_err(|e| Error::Git(format!("set busy_timeout: {e}")))?;
    // Gate DDL on SCHEMA_VERSION — skip on warm opens when schema is current.
    // user_version is set AFTER apply_schema succeeds (crash safety: a crash
    // mid-schema leaves user_version at 0 and re-applies fully on next open).
    let ver: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap_or(0);
    if ver != SCHEMA_VERSION {
        apply_schema(&conn)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| Error::Git(format!("set user_version: {e}")))?;
    }
    Ok(CacheDb {
        conn,
        path: path.to_path_buf(),
    })
}

fn apply_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| Error::Git(format!("apply cache_v2 schema: {e}")))?;
    Ok(())
}

/// Canonical schema, transcribed from the card's "Schema Sketch". Only
/// the tables this implementation reads/writes are created; the full
/// set is defined so the on-disk shape matches the spec and future
/// slices can populate the remaining tables without a salt bump.
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS mesh_anchor_rows (
  mesh_tree_key  TEXT NOT NULL,
  mesh_root      TEXT NOT NULL,
  key_salt       INTEGER NOT NULL,
  anchor_key     TEXT NOT NULL,
  mesh_name      TEXT NOT NULL,
  mesh_file_path TEXT NOT NULL,
  mesh_file_line INTEGER NOT NULL,
  source_path    TEXT NOT NULL,
  start_line     INTEGER NOT NULL,
  end_line       INTEGER NOT NULL,
  hash_algorithm TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (mesh_tree_key, mesh_root, key_salt, anchor_key)
) STRICT;

CREATE TABLE IF NOT EXISTS anchor_manifest (
  mesh_tree_key   TEXT NOT NULL,
  mesh_root       TEXT NOT NULL,
  key_salt        INTEGER NOT NULL,
  parser_version  INTEGER NOT NULL,
  anchor_count    INTEGER NOT NULL,
  mesh_file_count INTEGER NOT NULL,
  complete        INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (mesh_tree_key, mesh_root, key_salt, parser_version)
) STRICT;

CREATE INDEX IF NOT EXISTS mesh_anchor_rows_by_mesh_file
ON mesh_anchor_rows (mesh_tree_key, mesh_root, key_salt, mesh_file_path);

CREATE INDEX IF NOT EXISTS mesh_anchor_rows_by_path
ON mesh_anchor_rows (mesh_tree_key, mesh_root, key_salt, source_path);

CREATE TABLE IF NOT EXISTS moved_location_rows (
  source_tree_key    TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  hash_algorithm     TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  extent_kind        TEXT NOT NULL,
  line_count         INTEGER NOT NULL,
  source_path        TEXT NOT NULL,
  start_line         INTEGER NOT NULL,
  end_line           INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (
    source_tree_key, filter_config_hash, key_salt, hash_algorithm,
    content_hash, extent_kind, line_count, source_path, start_line, end_line
  )
) STRICT;

CREATE TABLE IF NOT EXISTS moved_scan_manifest (
  source_tree_key    TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  hash_algorithm     TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  extent_kind        TEXT NOT NULL,
  line_count         INTEGER NOT NULL,
  complete           INTEGER NOT NULL,
  location_count     INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (
    source_tree_key, filter_config_hash, key_salt, hash_algorithm,
    content_hash, extent_kind, line_count
  )
) STRICT;

CREATE TABLE IF NOT EXISTS committed_stale_finding_rows (
  source_tree_key    TEXT NOT NULL,
  mesh_tree_key      TEXT NOT NULL,
  mesh_root          TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  anchor_key         TEXT NOT NULL,
  status             TEXT NOT NULL,
  payload            BLOB NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (
    source_tree_key, mesh_tree_key, mesh_root,
    filter_config_hash, key_salt, anchor_key
  )
) STRICT;

CREATE TABLE IF NOT EXISTS committed_stale_summary (
  source_tree_key    TEXT NOT NULL,
  mesh_tree_key      TEXT NOT NULL,
  mesh_root          TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  payload            BLOB NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (
    source_tree_key, mesh_tree_key, mesh_root, filter_config_hash, key_salt
  )
) STRICT;

CREATE TABLE IF NOT EXISTS committed_baseline_manifest (
  source_tree_key    TEXT NOT NULL,
  mesh_tree_key      TEXT NOT NULL,
  mesh_root          TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  availability_hash  TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  complete           INTEGER NOT NULL,
  non_fresh_count    INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (
    source_tree_key, mesh_tree_key, mesh_root,
    filter_config_hash, availability_hash, key_salt
  )
) STRICT;

CREATE TABLE IF NOT EXISTS dirty_stale_finding_rows (
  overlay_key BLOB NOT NULL,
  anchor_key  TEXT NOT NULL,
  status      TEXT NOT NULL,
  payload     BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (overlay_key, anchor_key)
) STRICT;

CREATE TABLE IF NOT EXISTS dirty_stale_summary (
  overlay_key BLOB PRIMARY KEY,
  payload     BLOB NOT NULL,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS dirty_overlay_manifest (
  overlay_key           BLOB PRIMARY KEY,
  complete              INTEGER NOT NULL,
  affected_anchor_count INTEGER NOT NULL,
  non_fresh_count       INTEGER NOT NULL,
  created_at            INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS committed_stale_whole_result (
  source_tree_key    TEXT NOT NULL,
  mesh_tree_key      TEXT NOT NULL,
  mesh_root          TEXT NOT NULL,
  filter_config_hash TEXT NOT NULL,
  key_salt           INTEGER NOT NULL,
  payload            BLOB NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (source_tree_key, mesh_tree_key, mesh_root, filter_config_hash, key_salt)
) STRICT;
"#;

/// Open `cache_v2` database handle.
pub(crate) struct CacheDb {
    pub(crate) conn: Connection,
    pub(crate) path: PathBuf,
}

impl CacheDb {
    /// Best-effort gc: drop rows whose `key_salt` is not the current
    /// [`KEY_SALT`], and overlay rows older than `max_age_secs`. GC is
    /// never required for correctness (key-based invalidation handles
    /// that); it only bounds disk growth.
    pub(crate) fn gc(&self, max_age_secs: i64) -> Result<()> {
        for table in [
            "mesh_anchor_rows",
            "anchor_manifest",
            "moved_location_rows",
            "moved_scan_manifest",
            "committed_stale_finding_rows",
            "committed_stale_summary",
            "committed_baseline_manifest",
            "committed_stale_whole_result",
        ] {
            self.conn
                .execute(
                    &format!("DELETE FROM {table} WHERE key_salt != ?1"),
                    [KEY_SALT],
                )
                .map_err(|e| Error::Git(format!("cache_v2 gc {table}: {e}")))?;
        }
        let cutoff = now_secs() - max_age_secs.max(0);
        for table in [
            "dirty_stale_finding_rows",
            "dirty_stale_summary",
            "dirty_overlay_manifest",
        ] {
            self.conn
                .execute(
                    &format!("DELETE FROM {table} WHERE created_at < ?1"),
                    [cutoff],
                )
                .map_err(|e| Error::Git(format!("cache_v2 gc {table}: {e}")))?;
        }
        Ok(())
    }
}

/// Seconds since the Unix epoch; `0` if the clock is before the epoch.
pub(crate) fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Lowercase-hex of a 32-byte digest. Stable, fixed width, safe as a
/// SQLite TEXT primary-key component.
pub(crate) fn hex32(b: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for byte in b {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

/// Length-prefix `bytes` into `h` so concatenated fields cannot collide.
pub(crate) fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

/// Canonical hash of every filter-pipeline / normalization input that
/// can change a resolution's output without HEAD or the mesh tree
/// changing: `core.autocrlf`, `core.eol`, `core.safecrlf`, and every
/// configured `filter.<driver>.{clean,smudge,required}` triple. Missing
/// keys hash differently from empty strings. A dirty `.gitattributes`
/// or filter-driver change must therefore invalidate dependent rows.
pub(crate) fn filter_config_hash(repo: &gix::Repository) -> [u8; 32] {
    let mut entries: BTreeMap<String, Option<String>> = BTreeMap::new();
    let snap = repo.config_snapshot();
    for key in ["core.autocrlf", "core.eol", "core.safecrlf"] {
        entries.insert(key.to_string(), snap.string(key).map(|v| v.to_string()));
    }
    let file = snap.plumbing();
    let mut filter_pairs: Vec<(String, String, String)> = Vec::new();
    if let Some(sections) = file.sections_by_name("filter") {
        for section in sections {
            let header = section.header();
            let sub_name = header
                .subsection_name()
                .map(|b| b.to_string())
                .unwrap_or_default();
            let body = section.body();
            let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            for name in body.value_names() {
                seen.insert(name.as_ref().to_string());
            }
            for name in seen {
                for v in body.values(&name) {
                    filter_pairs.push((sub_name.clone(), name.clone(), v.to_string()));
                }
            }
        }
    }
    filter_pairs.sort();
    let mut h = Hasher::new();
    h.update(b"gm.cache_v2.filter-config\0");
    h.update(&KEY_SALT.to_le_bytes());
    for (k, v) in &entries {
        write_prefixed(&mut h, k.as_bytes());
        match v {
            Some(s) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, s.as_bytes());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    for (sub, key, val) in &filter_pairs {
        write_prefixed(&mut h, sub.as_bytes());
        write_prefixed(&mut h, key.as_bytes());
        write_prefixed(&mut h, val.as_bytes());
    }
    *h.finalize().as_bytes()
}
