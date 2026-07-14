//! Verified SQLite storage engine for `git span stale` (card main-157
//! Phase 2: "Build The Verified SQLite Core").
//!
//! [`CacheStore`] is a *standalone* store: this phase builds and verifies it
//! in isolation, with no execution-path wiring (that is Phase 3). It owns one
//! SQLite connection to a database in the Git common directory and enforces
//! the correctness contract from `notes/correctness-contract.md`:
//!
//! * **Atomic generations.** A generation becomes visible only when its
//!   summary, every `generation_row`, and its `span_path_index` entries are
//!   committed in one transaction ([`CacheStore::publish_generation`]); GC
//!   deletes a whole generation in one transaction ([`CacheStore::gc`]).
//!   A reader ([`CacheStore::get_generation`]) reads inside one SQLite
//!   snapshot and verifies cardinality, so it can never observe a manifest
//!   with a subset of its rows — the `cache_v2` defect this replaces.
//! * **Verified payloads.** Every row embeds and re-verifies entry kind,
//!   payload version, canonical key digest, cardinality, and a BLAKE3 payload
//!   digest (see [`payload`]). A decoded-but-mismatched value is rejected with
//!   a structured [`payload::IntegrityReason`], never trusted.
//! * **Fail-closed faults.** A read-only directory, a full disk, a busy
//!   timeout, corruption, or a schema mismatch all map to a typed
//!   [`error::BypassReason`]; the caller records it and runs the authoritative
//!   resolver. Publication either fully lands or does not happen.
//! * **Crash/concurrency safety.** WAL plus `fs4` locks: an exclusive init
//!   lock guards schema/WAL setup and quarantine; hashed build-lock shards
//!   ([`build_or_get`]) serialize same-key builders to one compute while
//!   letting distinct keys proceed concurrently, and release on process death.
//!
//! Resolver work never runs inside a SQLite write transaction: `build_or_get`
//! computes strictly before opening the publish transaction, and
//! [`CacheStore::is_in_write_txn`] exposes the invariant so a test can catch a
//! violation (`notes/architecture-and-complexity.md` "Concurrency And
//! Recovery": "Compute outside the database transaction").

pub(crate) mod error;
pub(crate) mod lock;
pub(crate) mod payload;
pub(crate) mod schema;

#[cfg(test)]
mod tests;

use std::cell::Cell;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use error::{BypassReason, StoreError, map_io, map_sqlite};
use lock::{LockGuard, acquire_build_shard, acquire_init_lock, shard_index};
use payload::{
    DOMAIN_GENERATION, DOMAIN_ROW, EntryKind, IntegrityReason, envelope_digest, verify_envelope,
};
use schema::{DB_BASENAME, DEFAULT_BUSY_TIMEOUT_MS, ProbeOutcome, probe_and_init, set_busy_timeout};

/// Width of an access bucket, in seconds. Warm reads only rewrite
/// `access_bucket` when the bucket changes, so a hot read does not become a
/// write on every hit (`notes/architecture-and-complexity.md` GC section:
/// "Bucketed/sampled access avoids a write on every hit").
pub(crate) const ACCESS_BUCKET_SECS: i64 = 3_600;

/// One immutable normalized reuse row within a generation. `row_kind` is a
/// caller-defined discriminant (e.g. span blob vs. resolution); `row_key` is
/// the row's stable identity (e.g. an ordinal span identity).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GenerationRow {
    pub(crate) row_kind: u32,
    pub(crate) row_key: String,
    pub(crate) payload: Vec<u8>,
}

/// One reverse-index entry: a source path that a row depends on. Populated for
/// later incremental/dirty phases; carried through publish/GC atomically now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PathIndexEntry {
    pub(crate) source_path: String,
    pub(crate) row_key: String,
}

/// A complete generation to publish.
#[derive(Clone, Debug)]
pub(crate) struct GenerationInput {
    /// Canonical key digest (from `StateToken::canonical_key_digest`).
    pub(crate) key_digest: [u8; 32],
    /// HEAD derivation hint (not part of the key).
    pub(crate) head: String,
    /// Caller-defined payload/schema version for every value in this
    /// generation.
    pub(crate) payload_version: u32,
    /// The compact authoritative stale summary.
    pub(crate) summary: Vec<u8>,
    /// Immutable normalized reuse rows, in stored order.
    pub(crate) rows: Vec<GenerationRow>,
    /// Reverse `(source_path -> row_key)` index entries.
    pub(crate) path_index: Vec<PathIndexEntry>,
    /// Whether this generation is referenced by an active worktree/ref at
    /// publish time (a retention signal for GC).
    pub(crate) live: bool,
}

/// A verified generation read back from the store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredGeneration {
    pub(crate) key_digest: [u8; 32],
    pub(crate) head: String,
    pub(crate) payload_version: u32,
    pub(crate) summary: Vec<u8>,
    pub(crate) rows: Vec<GenerationRow>,
}

/// A verified ancestor generation located by HEAD hint, carrying its canonical
/// key digest alongside the loaded generation (card main-157 Phase 4B). The
/// generation's [`StoredGeneration::head`] is the ancestor commit the
/// incremental path diffs the current tree against.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AncestorGeneration {
    pub(crate) key_digest: [u8; 32],
    pub(crate) generation: StoredGeneration,
}

/// Outcome of a read: a verified hit, a plain miss (absent), or a structured
/// rejection (present but failed integrity — quarantined, never served).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GetOutcome {
    Hit(StoredGeneration),
    Miss,
    Rejected(IntegrityReason),
}

impl GetOutcome {
    /// The verified generation, if this was a hit.
    pub(crate) fn hit(self) -> Option<StoredGeneration> {
        match self {
            GetOutcome::Hit(g) => Some(g),
            _ => None,
        }
    }
}

/// What a `build_or_get` builder closure produces once it has computed the
/// value outside any transaction.
#[derive(Clone, Debug)]
pub(crate) struct BuildProduct {
    pub(crate) payload_version: u32,
    pub(crate) summary: Vec<u8>,
    pub(crate) rows: Vec<GenerationRow>,
    pub(crate) path_index: Vec<PathIndexEntry>,
    pub(crate) live: bool,
}

/// GC retention policy. A generation survives if it is in `live_keys` (an
/// active worktree/ref references it) or was accessed in a recent-enough
/// bucket (`access_bucket >= keep_access_bucket_from`). Everything else is an
/// eviction candidate.
#[derive(Clone, Debug, Default)]
pub(crate) struct RetentionPolicy {
    pub(crate) live_keys: HashSet<[u8; 32]>,
    pub(crate) keep_access_bucket_from: i64,
}

/// What one GC pass removed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct GcStats {
    pub(crate) generations_removed: u64,
    pub(crate) rows_removed: u64,
}

pub(crate) type StoreResult<T> = Result<T, StoreError>;

/// The verified SQLite store. One owner of one connection.
pub(crate) struct CacheStore {
    conn: Connection,
    dir: PathBuf,
    #[allow(dead_code)]
    path: PathBuf,
    shard_count: usize,
    /// True only while a publish/GC write transaction is open. Read by
    /// [`Self::is_in_write_txn`] so a test can assert resolver work never runs
    /// inside a write transaction.
    in_write_txn: Cell<bool>,
}

impl CacheStore {
    /// Open (or create) the store for a repository, in
    /// `<common_dir>/span/store.db`.
    pub(crate) fn open(repo: &gix::Repository) -> StoreResult<Self> {
        let dir = crate::git::common_dir(repo).join("span");
        Self::open_at(&dir)
    }

    /// Open (or create) the store in `dir` with default tuning.
    pub(crate) fn open_at(dir: &Path) -> StoreResult<Self> {
        Self::open_with(dir, DEFAULT_BUSY_TIMEOUT_MS, lock::build_shard_count())
    }

    /// Open (or create) the store with explicit busy timeout and shard count.
    /// Schema/WAL init and any quarantine/recreate run under the exclusive
    /// init lock.
    pub(crate) fn open_with(
        dir: &Path,
        busy_timeout_ms: u64,
        shard_count: usize,
    ) -> StoreResult<Self> {
        std::fs::create_dir_all(dir)
            .map_err(|e| map_io(e, &format!("create store dir `{}`", dir.display())))?;

        // Everything below runs under the init lock: fresh schema application,
        // and (crucially) quarantine/recreate, so two first-openers cannot
        // race on DDL or fight over a corrupt file.
        let _init = acquire_init_lock(dir)?;
        let path = dir.join(DB_BASENAME);

        // At most one quarantine before giving up: recreate once, then the
        // fresh database must probe Ready or we surface the fault.
        for attempt in 0..2 {
            let conn = Connection::open(&path).map_err(map_sqlite)?;
            set_busy_timeout(&conn, busy_timeout_ms)?;
            match probe_and_init(&conn) {
                Ok(ProbeOutcome::Ready) => {
                    return Ok(Self {
                        conn,
                        dir: dir.to_path_buf(),
                        path,
                        shard_count,
                        in_write_txn: Cell::new(false),
                    });
                }
                Ok(ProbeOutcome::Quarantine(reason)) => {
                    if attempt == 1 {
                        return Err(StoreError::new(
                            reason,
                            "database still unusable after quarantine/recreate",
                        ));
                    }
                    drop(conn);
                    quarantine(&path)?;
                    // loop: recreate fresh
                }
                Err(e) => return Err(e),
            }
        }
        unreachable!("open_with loop always returns")
    }

    /// Directory the store lives in.
    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }

    /// Number of build-lock shards.
    pub(crate) fn shard_count(&self) -> usize {
        self.shard_count
    }

    /// Whether a publish/GC write transaction is currently open. Used by the
    /// transaction-duration invariant test.
    pub(crate) fn is_in_write_txn(&self) -> bool {
        self.in_write_txn.get()
    }

    /// Publish a complete generation in one transaction. Rows and index
    /// entries are inserted first; the `generation` row (the visibility gate)
    /// is inserted last, so a reader either sees the whole generation or none
    /// of it. A republish of an existing key atomically replaces it.
    pub(crate) fn publish_generation(&mut self, input: &GenerationInput) -> StoreResult<()> {
        self.in_write_txn.set(true);
        let outcome = self.publish_txn(input);
        self.in_write_txn.set(false);
        outcome
    }

    fn publish_txn(&mut self, input: &GenerationInput) -> StoreResult<()> {
        let key_hex = hex32(&input.key_digest);
        let created = now_secs();
        let bucket = now_bucket();
        let row_count = input.rows.len() as u64;
        let summary_digest = envelope_digest(
            DOMAIN_GENERATION,
            EntryKind::Generation.as_u32(),
            input.payload_version,
            &input.key_digest,
            row_count,
            &input.summary,
        );

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;

        // Atomic replace: clear any prior generation for this key first.
        tx.execute("DELETE FROM generation_row WHERE key_digest = ?1", [&key_hex])
            .map_err(map_sqlite)?;
        tx.execute("DELETE FROM span_path_index WHERE key_digest = ?1", [&key_hex])
            .map_err(map_sqlite)?;
        tx.execute("DELETE FROM generation WHERE key_digest = ?1", [&key_hex])
            .map_err(map_sqlite)?;

        for (ordinal, row) in input.rows.iter().enumerate() {
            let ord = ordinal as u64;
            let digest = envelope_digest(
                DOMAIN_ROW,
                EntryKind::GenerationRow.as_u32(),
                input.payload_version,
                &input.key_digest,
                ord,
                &row.payload,
            );
            tx.execute(
                "INSERT INTO generation_row \
                 (key_digest, ordinal, entry_kind, payload_version, row_kind, row_key, payload, payload_digest) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    &key_hex,
                    ord as i64,
                    EntryKind::GenerationRow.as_u32() as i64,
                    input.payload_version as i64,
                    row.row_kind as i64,
                    &row.row_key,
                    &row.payload,
                    &digest[..],
                ],
            )
            .map_err(map_sqlite)?;
        }

        for entry in &input.path_index {
            tx.execute(
                "INSERT OR IGNORE INTO span_path_index (key_digest, source_path, row_key) \
                 VALUES (?1, ?2, ?3)",
                params![&key_hex, &entry.source_path, &entry.row_key],
            )
            .map_err(map_sqlite)?;
        }

        // Visibility gate: the generation row lands last.
        tx.execute(
            "INSERT INTO generation \
             (key_digest, entry_kind, payload_version, head, row_count, summary, summary_digest, created_at, access_bucket, live) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &key_hex,
                EntryKind::Generation.as_u32() as i64,
                input.payload_version as i64,
                &input.head,
                row_count as i64,
                &input.summary,
                &summary_digest[..],
                created,
                bucket,
                i64::from(input.live),
            ],
        )
        .map_err(map_sqlite)?;

        tx.commit().map_err(map_sqlite)?;
        Ok(())
    }

    /// Read and verify a generation by canonical key. `expected_version` is the
    /// reader's current payload version; a stored value on any other version is
    /// rejected (a miss + rebuild in a later phase). The whole read runs in one
    /// SQLite snapshot so a concurrent publish/GC cannot expose a partial
    /// generation.
    pub(crate) fn get_generation(
        &self,
        key_digest: &[u8; 32],
        expected_version: u32,
    ) -> StoreResult<GetOutcome> {
        let key_hex = hex32(key_digest);
        // Deferred read transaction: a consistent WAL snapshot as of the first
        // read, spanning the generation row and all its rows.
        let tx = self.conn.unchecked_transaction().map_err(map_sqlite)?;

        let gen_row = tx
            .query_row(
                "SELECT entry_kind, payload_version, head, row_count, summary, summary_digest \
                 FROM generation WHERE key_digest = ?1",
                [&key_hex],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,        // entry_kind
                        r.get::<_, i64>(1)?,        // payload_version
                        r.get::<_, String>(2)?,     // head
                        r.get::<_, i64>(3)?,        // row_count
                        r.get::<_, Vec<u8>>(4)?,    // summary
                        r.get::<_, Vec<u8>>(5)?,    // summary_digest
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite)?;

        let Some((kind, version, head, row_count, summary, summary_digest)) = gen_row else {
            return Ok(GetOutcome::Miss);
        };
        let row_count = row_count.max(0) as u64;

        // Cross-check the declared cardinality against the actual number of
        // stored rows before trusting anything else. This catches a tampered
        // `row_count` claim and a deleted/extra row uniformly as a Count
        // rejection (not merely as a digest mismatch).
        let actual_rows: i64 = tx
            .query_row(
                "SELECT count(*) FROM generation_row WHERE key_digest = ?1",
                [&key_hex],
                |r| r.get(0),
            )
            .map_err(map_sqlite)?;
        if actual_rows.max(0) as u64 != row_count {
            return Ok(GetOutcome::Rejected(IntegrityReason::Count));
        }

        if let Err(reason) = verify_envelope(
            DOMAIN_GENERATION,
            EntryKind::Generation.as_u32(),
            u32_from_i64(kind),
            expected_version,
            u32_from_i64(version),
            key_digest,
            key_digest,
            row_count,
            row_count,
            &summary,
            &summary_digest,
        ) {
            return Ok(GetOutcome::Rejected(reason));
        }

        // Read every row in ordinal order within the same snapshot.
        let mut stmt = tx
            .prepare(
                "SELECT ordinal, entry_kind, payload_version, row_kind, row_key, payload, payload_digest \
                 FROM generation_row WHERE key_digest = ?1 ORDER BY ordinal",
            )
            .map_err(map_sqlite)?;
        let mut rows_iter = stmt.query([&key_hex]).map_err(map_sqlite)?;

        let mut rows: Vec<GenerationRow> = Vec::new();
        let mut expected_ordinal: u64 = 0;
        while let Some(r) = rows_iter.next().map_err(map_sqlite)? {
            let ordinal: i64 = r.get(0).map_err(map_sqlite)?;
            let entry_kind: i64 = r.get(1).map_err(map_sqlite)?;
            let row_version: i64 = r.get(2).map_err(map_sqlite)?;
            let row_kind: i64 = r.get(3).map_err(map_sqlite)?;
            let row_key: String = r.get(4).map_err(map_sqlite)?;
            let payload: Vec<u8> = r.get(5).map_err(map_sqlite)?;
            let digest: Vec<u8> = r.get(6).map_err(map_sqlite)?;

            let ord = ordinal.max(0) as u64;
            if let Err(reason) = verify_envelope(
                DOMAIN_ROW,
                EntryKind::GenerationRow.as_u32(),
                u32_from_i64(entry_kind),
                expected_version,
                u32_from_i64(row_version),
                key_digest,
                key_digest,
                expected_ordinal,
                ord,
                &payload,
                &digest,
            ) {
                return Ok(GetOutcome::Rejected(reason));
            }
            rows.push(GenerationRow {
                row_kind: u32_from_i64(row_kind),
                row_key,
                payload,
            });
            expected_ordinal += 1;
        }

        // Completeness: the number of rows present must equal the declared
        // cardinality. A missing (or extra) row is a rejection, not a hit.
        if rows.len() as u64 != row_count {
            return Ok(GetOutcome::Rejected(IntegrityReason::MissingRow));
        }

        Ok(GetOutcome::Hit(StoredGeneration {
            key_digest: *key_digest,
            head,
            payload_version: expected_version,
            summary,
            rows,
        }))
    }

    /// Locate a cached generation whose stored HEAD hint matches one of
    /// `head_candidates` (used to find an incremental ancestor in a later
    /// phase). Returns the first match's canonical key digest.
    pub(crate) fn find_ancestor(
        &self,
        head_candidates: &[String],
    ) -> StoreResult<Option<[u8; 32]>> {
        for head in head_candidates {
            let hex: Option<String> = self
                .conn
                .query_row(
                    "SELECT key_digest FROM generation WHERE head = ?1 LIMIT 1",
                    [head],
                    |r| r.get(0),
                )
                .optional()
                .map_err(map_sqlite)?;
            if let Some(hex) = hex
                && let Some(digest) = unhex32(&hex)
            {
                return Ok(Some(digest));
            }
        }
        Ok(None)
    }

    /// Locate and fully load the first cached generation whose stored HEAD hint
    /// matches one of `head_candidates` (card main-157 Phase 4B).
    ///
    /// Combines [`Self::find_ancestor`] (which only yields a key) with
    /// [`Self::get_generation`] so the incremental path gets the ancestor's
    /// canonical key **and** its verified reuse rows in one call. A candidate
    /// whose generation is on a different payload version, absent, or
    /// integrity-rejected yields `None` (the caller degrades to a full resolve)
    /// rather than a partial or unverified result — fail closed, exactly like a
    /// plain miss.
    pub(crate) fn load_ancestor_generation(
        &self,
        head_candidates: &[String],
        expected_version: u32,
    ) -> StoreResult<Option<AncestorGeneration>> {
        let Some(key_digest) = self.find_ancestor(head_candidates)? else {
            return Ok(None);
        };
        match self.get_generation(&key_digest, expected_version)? {
            GetOutcome::Hit(generation) => Ok(Some(AncestorGeneration {
                key_digest,
                generation,
            })),
            // Present-but-unverifiable or a vanished race: no reusable ancestor.
            GetOutcome::Miss | GetOutcome::Rejected(_) => Ok(None),
        }
    }

    /// Record an access, advancing `access_bucket` only when the bucket
    /// actually changed — so a warm hit does not rewrite on every access.
    pub(crate) fn touch(&mut self, key_digest: &[u8; 32]) -> StoreResult<()> {
        let key_hex = hex32(key_digest);
        let bucket = now_bucket();
        self.conn
            .execute(
                "UPDATE generation SET access_bucket = ?2 \
                 WHERE key_digest = ?1 AND access_bucket <> ?2",
                params![&key_hex, bucket],
            )
            .map_err(map_sqlite)?;
        Ok(())
    }

    /// Mark/unmark a generation as referenced by an active worktree/ref.
    pub(crate) fn set_live(&mut self, key_digest: &[u8; 32], live: bool) -> StoreResult<()> {
        let key_hex = hex32(key_digest);
        self.conn
            .execute(
                "UPDATE generation SET live = ?2 WHERE key_digest = ?1",
                params![&key_hex, i64::from(live)],
            )
            .map_err(map_sqlite)?;
        Ok(())
    }

    /// Singleflight build: return the verified generation for `key_digest`,
    /// building it exactly once across concurrent same-key callers.
    ///
    /// Fast-path reads without a lock; on a miss, locks the key's build-lock
    /// shard, rechecks the database (a sibling may have published while we
    /// waited), computes the value **outside any SQLite transaction** via
    /// `builder`, then publishes in one short transaction. Distinct keys on
    /// different shards proceed concurrently.
    pub(crate) fn build_or_get<F>(
        &mut self,
        key_digest: &[u8; 32],
        head: &str,
        expected_version: u32,
        builder: F,
    ) -> StoreResult<StoredGeneration>
    where
        F: FnOnce() -> StoreResult<BuildProduct>,
    {
        // Fast path.
        if let GetOutcome::Hit(g) = self.get_generation(key_digest, expected_version)? {
            return Ok(g);
        }

        let shard = shard_index(key_digest, self.shard_count);
        let _guard: LockGuard = acquire_build_shard(&self.dir, shard)?;

        // Recheck under the lock.
        if let GetOutcome::Hit(g) = self.get_generation(key_digest, expected_version)? {
            return Ok(g);
        }

        // Compute strictly outside any transaction.
        debug_assert!(
            !self.is_in_write_txn(),
            "resolver work must not run inside a SQLite write transaction"
        );
        let product = builder()?;

        let input = GenerationInput {
            key_digest: *key_digest,
            head: head.to_string(),
            payload_version: product.payload_version,
            summary: product.summary,
            rows: product.rows,
            path_index: product.path_index,
            live: product.live,
        };
        self.publish_generation(&input)?;

        match self.get_generation(key_digest, expected_version)? {
            GetOutcome::Hit(g) => Ok(g),
            GetOutcome::Miss => Err(StoreError::new(
                BypassReason::Io,
                "generation absent immediately after publish",
            )),
            GetOutcome::Rejected(reason) => Err(StoreError::new(
                BypassReason::Corrupt,
                format!("published generation failed verification: {reason:?}"),
            )),
        }
    }

    /// Evict generations that are neither live nor recently accessed, in
    /// bounded transactional batches. Each batch deletes a generation and all
    /// of its rows/index entries in one transaction, so a concurrent reader
    /// never sees a half-deleted generation.
    pub(crate) fn gc(&mut self, policy: &RetentionPolicy) -> StoreResult<GcStats> {
        // Collect eviction candidates first (a read), then delete each in its
        // own short transaction.
        let candidates: Vec<(String, u64)> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT key_digest, row_count FROM generation \
                     WHERE live = 0 AND access_bucket < ?1",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([policy.keep_access_bucket_from], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?.max(0) as u64))
                })
                .map_err(map_sqlite)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_sqlite)?);
            }
            out
        };

        let mut stats = GcStats::default();
        for (key_hex, row_count) in candidates {
            // A live_keys entry always wins, even if the access bucket is old.
            if let Some(digest) = unhex32(&key_hex)
                && policy.live_keys.contains(&digest)
            {
                continue;
            }
            self.in_write_txn.set(true);
            let result = self.gc_delete_one(&key_hex);
            self.in_write_txn.set(false);
            result?;
            stats.generations_removed += 1;
            stats.rows_removed += row_count;
        }
        Ok(stats)
    }

    fn gc_delete_one(&mut self, key_hex: &str) -> StoreResult<()> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        // Generation row (visibility gate) first, so a reader that started
        // after commit sees Miss rather than a manifest without rows.
        tx.execute("DELETE FROM generation WHERE key_digest = ?1", [key_hex])
            .map_err(map_sqlite)?;
        tx.execute("DELETE FROM generation_row WHERE key_digest = ?1", [key_hex])
            .map_err(map_sqlite)?;
        tx.execute("DELETE FROM span_path_index WHERE key_digest = ?1", [key_hex])
            .map_err(map_sqlite)?;
        tx.commit().map_err(map_sqlite)?;
        Ok(())
    }
}

/// Move a suspect database file aside (best effort: rename, else delete) along
/// with its WAL companions, so a fresh one is created under the init lock.
/// Never serves suspect rows: the caller recreates before returning.
fn quarantine(path: &Path) -> StoreResult<()> {
    let ts = now_secs();
    let aside = path.with_extension(format!("corrupt-{ts}"));
    // Rename the main file aside; if that fails, remove it outright.
    match std::fs::rename(path, &aside) {
        Ok(()) => {}
        Err(_) => {
            if path.exists() {
                std::fs::remove_file(path)
                    .map_err(|e| map_io(e, &format!("remove corrupt db `{}`", path.display())))?;
            }
        }
    }
    // WAL/SHM companions must go regardless so the fresh DB starts clean.
    for suffix in ["-wal", "-shm"] {
        let companion = sibling_with_suffix(path, suffix);
        let _ = std::fs::remove_file(&companion);
    }
    Ok(())
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn u32_from_i64(v: i64) -> u32 {
    // Column values are small non-negative discriminants; clamp defensively so
    // a corrupted negative/oversized value simply fails the equality check
    // rather than panicking.
    if (0..=i64::from(u32::MAX)).contains(&v) {
        v as u32
    } else {
        u32::MAX
    }
}

/// Seconds since the Unix epoch; `0` before the epoch.
pub(crate) fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Current access bucket (coarsened wall-clock, see [`ACCESS_BUCKET_SECS`]).
pub(crate) fn now_bucket() -> i64 {
    now_secs() / ACCESS_BUCKET_SECS
}

/// Lowercase-hex of a 32-byte digest — a stable, fixed-width SQLite TEXT key.
pub(crate) fn hex32(b: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for byte in b {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

/// Parse a 64-char lowercase-hex string back into a 32-byte digest.
pub(crate) fn unhex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}
