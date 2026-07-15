//! Embedded schema, versioning, and connection bootstrap for the SQLite
//! store (card main-157 Phase 2).
//!
//! ## Ordering invariant
//!
//! [`configure_connection`] sets the SQLite busy timeout *before any other
//! pragma*. `notes/investigation-question-log.md` Step 7 traced an eight-way
//! cold run that fell back because WAL initialization hit a lock: the old
//! `cache_v2` open (`resolver/cache_v2/mod.rs`) sets `journal_mode=WAL` before
//! `busy_timeout`, so the very pragma that can contend runs with no timeout.
//! We invert that: timeout first, then WAL, then schema.
//!
//! ## Schema layout decision
//!
//! Inline-BLOB rows (payload stored directly in the metadata table) rather
//! than a `WITHOUT ROWID` metadata table plus a separate rowid payload
//! object. See `notes/store-schema-spike.md` for the 10,000/100,000-entry
//! measurements behind that choice.

use rusqlite::Connection;

use super::error::{BypassReason, StoreError, map_sqlite};

/// Fixed SQLite `application_id` (`"gspn"` big-endian). Distinguishes this
/// store's files from the legacy `cache_v2` database on sight.
pub(crate) const APPLICATION_ID: i32 = 0x6773_706e;

/// `PRAGMA user_version` schema discriminator. Bump on any DDL shape change
/// (table/column/index). A non-zero value other than this triggers
/// quarantine-and-recreate (never a silent partial migration) —
/// `notes/correctness-contract.md` "Fail-Closed Meaning".
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// Semantic epoch stored in `meta`. Bump when the *meaning* of stored rows
/// changes even though the DDL does not (e.g. a `StateToken`/`ResolutionCore`
/// shape change). A mismatch quarantines exactly like a schema-version
/// mismatch.
pub(crate) const SEMANTIC_EPOCH: i64 = 1;

/// Store database basename under `<common_dir>/span/`.
pub(crate) const DB_BASENAME: &str = "store.db";
/// Init-lock basename guarding schema/WAL setup and quarantine/recreate.
pub(crate) const INIT_LOCK_BASENAME: &str = "store.init.lock";
/// Build-lock-shard basename prefix (`build-shard-<i>.lock`).
pub(crate) const BUILD_SHARD_PREFIX: &str = "build-shard-";

/// Number of hashed build-lock shards. Chosen by the sweep in
/// `notes/lock-shard-spike.md`: the smallest count that keeps the unrelated-key
/// serialization factor (E[max shard occupancy]) non-material across the whole
/// measured concurrency range up to the 8 concurrent builders the
/// investigation observed — factor 1.18 at P=4 and 1.66 at P=8, versus 16
/// shards crossing 2.07 at P=8 and 64 giving only diminishing returns (1.38).
pub(crate) const BUILD_SHARD_COUNT: usize = 32;

/// Default busy timeout. Publications and GC are short single transactions,
/// so a one-second ceiling covers sibling-worktree contention without a
/// user-visible stall (`notes/architecture-and-complexity.md` "Concurrency
/// And Recovery").
pub(crate) const DEFAULT_BUSY_TIMEOUT_MS: u64 = 1_000;

/// Inline-BLOB schema. Every persisted value embeds kind, version, canonical
/// key digest, cardinality, and a BLAKE3 payload digest (see
/// [`super::payload`]). A generation becomes visible only when its summary
/// row, every referenced `generation_row`, and its `span_path_index` entries
/// are committed in one transaction — closing the `cache_v2` defect where GC
/// deleted related tables in separate autocommit statements and a reader could
/// observe a complete manifest with missing rows
/// (`notes/correctness-contract.md` "Completeness, Identity, And Order").
pub(crate) const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  application_id INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  semantic_epoch INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS generation (
  key_digest      TEXT PRIMARY KEY,
  entry_kind      INTEGER NOT NULL,
  payload_version INTEGER NOT NULL,
  head            TEXT NOT NULL,
  row_count       INTEGER NOT NULL,
  summary         BLOB NOT NULL,
  summary_digest  BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  access_bucket   INTEGER NOT NULL,
  live            INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX IF NOT EXISTS generation_by_head ON generation (head);

CREATE TABLE IF NOT EXISTS generation_row (
  key_digest      TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  entry_kind      INTEGER NOT NULL,
  payload_version INTEGER NOT NULL,
  row_kind        INTEGER NOT NULL,
  row_key         TEXT NOT NULL,
  payload         BLOB NOT NULL,
  payload_digest  BLOB NOT NULL,
  PRIMARY KEY (key_digest, ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS span_path_index (
  key_digest  TEXT NOT NULL,
  source_path TEXT NOT NULL,
  row_key     TEXT NOT NULL,
  PRIMARY KEY (key_digest, source_path, row_key)
) STRICT;

CREATE INDEX IF NOT EXISTS span_path_index_by_path
  ON span_path_index (source_path);
"#;

/// Outcome of probing an opened connection: usable, or must be quarantined.
pub(crate) enum ProbeOutcome {
    /// Connection is on the current schema/epoch and safe to serve from.
    Ready,
    /// The database is corrupt, not a database, or on an incompatible
    /// schema/epoch — the caller must quarantine and recreate under the init
    /// lock (`notes/architecture-and-complexity.md` "Concurrency And
    /// Recovery").
    Quarantine(BypassReason),
}

/// Set the busy timeout — the **first** pragma on any connection, before WAL or
/// schema work. `notes/investigation-question-log.md` Step 7's ordering fix.
pub(crate) fn set_busy_timeout(conn: &Connection, busy_timeout_ms: u64) -> Result<(), StoreError> {
    conn.busy_timeout(std::time::Duration::from_millis(busy_timeout_ms))
        .map_err(map_sqlite)
}

/// Turn a SQLite error into either a quarantine signal (corruption) or a hard
/// error. Corruption/not-a-database is never a hard failure: the caller
/// quarantines and recreates.
fn quarantine_or_err(e: rusqlite::Error) -> Result<ProbeOutcome, StoreError> {
    let mapped = map_sqlite(e);
    match mapped.reason {
        BypassReason::Corrupt => Ok(ProbeOutcome::Quarantine(BypassReason::Corrupt)),
        other => Err(StoreError {
            reason: other,
            detail: mapped.detail,
        }),
    }
}

/// Probe a connection whose busy timeout is already set: detect corruption
/// (via a read-only master query, *before* any write pragma), set the WAL
/// pragmas, and — if the database is fresh — apply the schema and stamp
/// `meta`/`user_version`. Must be called while holding the init lock.
pub(crate) fn probe_and_init(conn: &Connection) -> Result<ProbeOutcome, StoreError> {
    // Cheap read-only corruption/not-a-database probe FIRST: a garbage file
    // fails here with SQLITE_NOTADB/SQLITE_CORRUPT before any write pragma
    // (setting WAL on a corrupt file would otherwise mask this as a hard error).
    let table_count: i64 = match conn.query_row(
        "SELECT count(*) FROM sqlite_master",
        [],
        |r| r.get(0),
    ) {
        Ok(n) => n,
        Err(e) => return quarantine_or_err(e),
    };

    // Only now — after the file is proven to be a database — set the write
    // pragmas. On a fresh database, `auto_vacuum` must be set *before* WAL:
    // switching to WAL writes the header page (page 1), and SQLite only honors
    // an `auto_vacuum` change while the database is still empty of any page
    // content. INCREMENTAL mode moves a deleted generation's pages onto a
    // freelist that `PRAGMA incremental_vacuum` reclaims into a smaller file
    // during quota maintenance — without it, quota GC frees rows but the file
    // never shrinks below the cap (card main-157 Phase 6A).
    if table_count == 0 {
        // `2` is INCREMENTAL; the integer form is unambiguous where a quoted
        // keyword string can be silently parsed as NONE.
        conn.pragma_update(None, "auto_vacuum", 2i64)
            .map_err(map_sqlite)?;
    }
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(map_sqlite)?;
    if let Err(e) = conn.pragma_update(None, "journal_mode", "WAL") {
        return quarantine_or_err(e);
    }

    let user_version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(map_sqlite)?;

    if table_count == 0 && user_version == 0 {
        // Fresh database: apply schema and stamp identity.
        conn.execute_batch(SCHEMA_SQL).map_err(map_sqlite)?;
        conn.pragma_update(None, "application_id", APPLICATION_ID)
            .map_err(map_sqlite)?;
        conn.execute(
            "INSERT OR REPLACE INTO meta \
             (id, application_id, schema_version, semantic_epoch, created_at) \
             VALUES (1, ?1, ?2, ?3, ?4)",
            rusqlite::params![APPLICATION_ID, SCHEMA_VERSION, SEMANTIC_EPOCH, super::now_secs()],
        )
        .map_err(map_sqlite)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(map_sqlite)?;
        return Ok(ProbeOutcome::Ready);
    }

    if user_version != SCHEMA_VERSION {
        return Ok(ProbeOutcome::Quarantine(BypassReason::SchemaMismatch));
    }

    // Schema version matches; verify the semantic epoch and app id in `meta`.
    let epoch: Result<i64, _> = conn.query_row(
        "SELECT semantic_epoch FROM meta WHERE id = 1",
        [],
        |r| r.get(0),
    );
    match epoch {
        Ok(e) if e == SEMANTIC_EPOCH => Ok(ProbeOutcome::Ready),
        Ok(_) => Ok(ProbeOutcome::Quarantine(BypassReason::SchemaMismatch)),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Ok(ProbeOutcome::Quarantine(BypassReason::SchemaMismatch))
        }
        Err(e) => {
            let mapped = map_sqlite(e);
            match mapped.reason {
                BypassReason::Corrupt => Ok(ProbeOutcome::Quarantine(BypassReason::Corrupt)),
                other => Err(StoreError {
                    reason: other,
                    detail: mapped.detail,
                }),
            }
        }
    }
}
