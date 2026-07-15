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

/// What one GC/maintenance pass did. The eviction counters are populated by
/// both [`CacheStore::gc`] (policy-driven) and [`CacheStore::maintain`]
/// (quota-driven); the byte and corruption-recovery fields are populated by
/// [`CacheStore::maintain`] and left at their defaults by [`CacheStore::gc`]
/// (which does not measure size). Carries enough for 6B's diagnostics surface
/// and 6C's measured exit gates.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct GcStats {
    /// Generations deleted (each in its own bounded transaction).
    pub(crate) generations_removed: u64,
    /// Reuse rows deleted across those generations.
    pub(crate) rows_removed: u64,
    /// On-disk footprint (main file + WAL) before the pass, in bytes.
    /// [`CacheStore::maintain`] only.
    pub(crate) bytes_before: u64,
    /// On-disk footprint after the pass (post reclaim + WAL truncate), in
    /// bytes. [`CacheStore::maintain`] only.
    pub(crate) bytes_after: u64,
    /// Whether this store recovered from a quarantined (corrupt or
    /// schema-incompatible) database on open — a corruption-recovery event 6B's
    /// diagnostics surface reports. [`CacheStore::maintain`] only.
    pub(crate) corruption_recovered: bool,
}

pub(crate) type StoreResult<T> = Result<T, StoreError>;

/// The verified SQLite store. One owner of one connection.
pub(crate) struct CacheStore {
    conn: Connection,
    dir: PathBuf,
    path: PathBuf,
    shard_count: usize,
    /// True only while a publish/GC write transaction is open. Read by
    /// [`Self::is_in_write_txn`] so a test can assert resolver work never runs
    /// inside a write transaction.
    in_write_txn: Cell<bool>,
    /// Set when this open quarantined-and-recreated a corrupt or
    /// schema-incompatible database (the reason it was quarantined). Surfaced
    /// through [`GcStats::corruption_recovered`] by [`Self::maintain`] so a
    /// silent recovery becomes a reportable diagnostics event.
    recovered_on_open: Option<BypassReason>,
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
        // fresh database must probe Ready or we surface the fault. If we did
        // quarantine, remember why so `maintain` can report the recovery.
        let mut recovered_on_open: Option<BypassReason> = None;
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
                        recovered_on_open,
                    });
                }
                Ok(ProbeOutcome::Quarantine(reason)) => {
                    if attempt == 1 {
                        return Err(StoreError::new(
                            reason,
                            "database still unusable after quarantine/recreate",
                        ));
                    }
                    recovered_on_open = Some(reason);
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
        let outcome = self.publish_txn(input, true);
        self.in_write_txn.set(false);
        outcome
    }

    /// Publish only the generation row and its compact summary — WITHOUT the
    /// per-span reuse rows or the reverse path index (card main-157 Phase 5C).
    ///
    /// A dirty-overlay generation is never a *reconstruction baseline*: the
    /// clean same-HEAD baseline it reused from already is one, and both
    /// [`Self::find_generation_by_head`] and [`Self::find_ancestor`] only ever
    /// select a rows-bearing generation (`row_count > 0`). Persisting a dirty
    /// generation's full reuse-row set therefore duplicates the whole corpus on
    /// every dirty call for a reader that never comes — the O(corpus) publish
    /// cost that made the dirty tier scale super-linearly with corpus size (5C's
    /// measurement). Storing summary-only keeps publish proportional to the
    /// affected set (one BLOB, no per-span rows) while exact-hit repeat of an
    /// identical dirty state still works: it reads only this compact summary.
    ///
    /// The stored generation declares `row_count = 0`, so its integrity envelope
    /// and cardinality check ([`Self::get_generation`]) verify against the rows
    /// physically present (none) — a hit, never a spurious rejection.
    pub(crate) fn publish_generation_summary_only(
        &mut self,
        input: &GenerationInput,
    ) -> StoreResult<()> {
        self.in_write_txn.set(true);
        let outcome = self.publish_txn(input, false);
        self.in_write_txn.set(false);
        outcome
    }

    fn publish_txn(&mut self, input: &GenerationInput, store_rows: bool) -> StoreResult<()> {
        let key_hex = hex32(&input.key_digest);
        let created = now_secs();
        let bucket = now_bucket();
        // A summary-only publish declares zero rows so that the generation's
        // cardinality (and integrity envelope) match the rows it physically
        // stores (none).
        let row_count = if store_rows { input.rows.len() as u64 } else { 0 };
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

        // Summary-only generations store neither reuse rows nor the reverse
        // path index — they are never reconstruction baselines, so the rows
        // would only cost O(corpus) to write and never be read (Phase 5C).
        if store_rows {
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
    /// `head_candidates` (used to find an incremental ancestor or a dirty
    /// baseline). Returns the first match's canonical key digest.
    ///
    /// Only a **rows-bearing** generation (`row_count > 0`) qualifies: the
    /// caller reuses the located generation's per-span reuse rows to reconstruct
    /// a new generation, so a rows-empty one (a Phase-3 legacy summary, or a
    /// summary-only dirty generation — see
    /// [`Self::publish_generation_summary_only`]) is useless as a baseline and
    /// is skipped. This also keeps a summary-only dirty sibling published at the
    /// same HEAD from shadowing the clean committed baseline the dirty path must
    /// reuse (5C: the dirty tier degrading to a cold rebuild because it found an
    /// empty baseline).
    pub(crate) fn find_ancestor(
        &self,
        head_candidates: &[String],
    ) -> StoreResult<Option<[u8; 32]>> {
        for head in head_candidates {
            let hex: Option<String> = self
                .conn
                .query_row(
                    "SELECT key_digest FROM generation WHERE head = ?1 AND row_count > 0 LIMIT 1",
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

    /// Locate a cached generation whose stored HEAD hint **exactly** matches
    /// `head` (card main-157 Phase 5A). Returns the first match's canonical key
    /// digest.
    ///
    /// This is the HEAD-*inclusive* counterpart to [`Self::find_ancestor`]:
    /// [`crate::git::head_ancestors`] deliberately excludes HEAD itself
    /// (its candidates are strictly earlier commits), so the natural *dirty*
    /// baseline — a clean generation published at the SAME commit the dirty
    /// worktree sits on — never appears in an ancestor candidate list. The
    /// dirty path looks it up directly by the current HEAD.
    pub(crate) fn find_generation_by_head(&self, head: &str) -> StoreResult<Option<[u8; 32]>> {
        self.find_ancestor(std::slice::from_ref(&head.to_string()))
    }

    /// Locate and fully load the first cached generation published at `head`
    /// (card main-157 Phase 5A) — the dirty path's same-HEAD baseline.
    ///
    /// Combines [`Self::find_generation_by_head`] with [`Self::get_generation`]
    /// so the dirty path gets the baseline's canonical key **and** its verified
    /// reuse rows in one call, exactly like [`Self::load_ancestor_generation`]
    /// does for the incremental path. A baseline on a different payload
    /// version, absent, or integrity-rejected yields `None` (the caller
    /// degrades to a full resolve) — fail closed, exactly like a plain miss.
    pub(crate) fn load_head_baseline(
        &self,
        head: &str,
        expected_version: u32,
    ) -> StoreResult<Option<AncestorGeneration>> {
        let Some(key_digest) = self.find_generation_by_head(head)? else {
            return Ok(None);
        };
        match self.get_generation(&key_digest, expected_version)? {
            GetOutcome::Hit(generation) => Ok(Some(AncestorGeneration {
                key_digest,
                generation,
            })),
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

    /// Reconcile stored liveness against the genuinely-live HEAD set: demote to
    /// non-live every generation whose publish-time HEAD hint is not one of
    /// `live_heads` (the commit OIDs currently checked out by an active
    /// worktree, per [`crate::git::live_worktree_heads`]). Returns the number
    /// of generations demoted.
    ///
    /// This is the missing production step that makes 6A's quota
    /// [`Self::maintain`] able to reclaim anything: publish always marks the
    /// new generation `live` ("the current worktree references it now"), but a
    /// later commit/checkout supersedes it and *nothing else ever demotes it*.
    /// Without reconciliation every generation ever published stays permanently
    /// live, and [`Self::eviction_candidates`]' `WHERE live = 0` filter yields
    /// nothing — the quota is silently defeated (card main-157 Phase 6C's
    /// measured gap). A generation at a HEAD no worktree currently sits on is
    /// backed by no active worktree; demoting it lets `maintain` evict it by
    /// recency/value, while a generation at a live HEAD (including a sibling
    /// worktree's) is retained.
    ///
    /// The eviction mechanism itself is unchanged: this only flips the `live`
    /// flag the existing candidate query already reads. Each demotion is a
    /// single indexed `UPDATE ... WHERE head = ?` (the `generation_by_head`
    /// index), touching only rows currently marked live.
    pub(crate) fn reconcile_live_heads(
        &mut self,
        live_heads: &HashSet<String>,
    ) -> StoreResult<u64> {
        // The distinct HEAD hints currently marked live. Demoting per-head
        // (rather than per-row) keeps the scan small and lets each UPDATE ride
        // the `generation_by_head` index.
        let live_gen_heads: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT DISTINCT head FROM generation WHERE live = 1")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(map_sqlite)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_sqlite)?);
            }
            out
        };

        let mut demoted = 0u64;
        for head in live_gen_heads {
            if live_heads.contains(&head) {
                continue;
            }
            let n = self
                .conn
                .execute(
                    "UPDATE generation SET live = 0 WHERE live = 1 AND head = ?1",
                    [&head],
                )
                .map_err(map_sqlite)?;
            demoted += n as u64;
        }
        Ok(demoted)
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

    /// The corruption/schema-mismatch recovery this open performed, if any. A
    /// convenience accessor for 6B's diagnostics surface; [`Self::maintain`]
    /// already folds it into [`GcStats::corruption_recovered`].
    pub(crate) fn recovered_on_open(&self) -> Option<BypassReason> {
        self.recovered_on_open
    }

    /// Actual on-disk footprint of the store: the main database file
    /// (`page_count * page_size`) plus the live WAL file. WAL bytes are real
    /// disk usage until a checkpoint truncates them, so the quota must count
    /// them (`notes/architecture-and-complexity.md` GC section). Cheap header
    /// reads — safe to call anywhere, but the quota decision that consumes it
    /// (`maintain`) is never on a hot read path.
    pub(crate) fn database_size_bytes(&self) -> StoreResult<u64> {
        let page_count: i64 = self
            .conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        let page_size: i64 = self
            .conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        let main = (page_count.max(0) as u64).saturating_mul(page_size.max(0) as u64);
        Ok(main + self.wal_size_bytes())
    }

    /// Size of the live WAL file on disk, or 0 if it does not exist yet.
    fn wal_size_bytes(&self) -> u64 {
        std::fs::metadata(sibling_with_suffix(&self.path, "-wal"))
            .map(|m| m.len())
            .unwrap_or(0)
    }

    /// Projected footprint of the main file *after* the freelist is reclaimed:
    /// `(page_count - freelist_count) * page_size`. Deleting a generation moves
    /// its pages onto the freelist (auto-vacuum INCREMENTAL) without shrinking
    /// the file, so this — not [`Self::database_size_bytes`] — is what the
    /// eviction loop tests against, so freed-but-not-yet-reclaimed pages do not
    /// keep it looping. WAL is excluded because the pass truncates it at the
    /// end.
    fn reclaimed_main_bytes(&self) -> StoreResult<u64> {
        let page_count: i64 = self
            .conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        let freelist: i64 = self
            .conn
            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        let page_size: i64 = self
            .conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        let live_pages = (page_count - freelist).max(0) as u64;
        Ok(live_pages.saturating_mul(page_size.max(0) as u64))
    }

    /// Quota-driven bounded maintenance. Measures the current footprint; if it
    /// is over `cap_bytes`, evicts non-live generations — cheapest-to-rebuild
    /// and least-recently-accessed first — in bounded per-generation
    /// transactions until the projected footprint is under the cap or nothing
    /// further is evictable. Then, whether or not anything was evicted,
    /// reclaims freed pages and checkpoint-truncates the WAL so the on-disk
    /// footprint actually drops.
    ///
    /// Retention: a `live` generation is never evicted (it backs an active
    /// worktree/ref). Among non-live generations, eviction order prefers
    /// summary-only/dirty generations (`row_count = 0`, cheap to rebuild, no
    /// reuse value) over full committed generations that carry reuse rows, and
    /// within each group evicts the oldest access bucket first — so recently
    /// accessed generations survive as long as evicting older ones frees enough
    /// space.
    ///
    /// Invisibility: each eviction is [`Self::gc_delete_one`]'s single
    /// transaction (generation row first), so a concurrent reader sees a whole
    /// generation or a plain miss, never a partial one — the same discipline
    /// publish and [`Self::gc`] already hold. Page reclamation and the WAL
    /// checkpoint are transactional and run **only here**, never on any read
    /// path.
    ///
    /// This is a callable mechanism, not a production trigger: 6B invokes it
    /// from a real high-water-mark path.
    pub(crate) fn maintain(&mut self, cap_bytes: u64) -> StoreResult<GcStats> {
        let mut stats = GcStats {
            corruption_recovered: self.recovered_on_open.is_some(),
            bytes_before: self.database_size_bytes()?,
            ..GcStats::default()
        };

        // Only evict when over the cap. Decide against the reclaimed projection
        // so freed-but-unreclaimed pages from an earlier deletion don't inflate
        // the measurement mid-loop.
        if self.reclaimed_main_bytes()? > cap_bytes {
            for cand in self.eviction_candidates()? {
                if self.reclaimed_main_bytes()? <= cap_bytes {
                    break;
                }
                self.in_write_txn.set(true);
                let result = self.gc_delete_one(&cand.key_hex);
                self.in_write_txn.set(false);
                result?;
                stats.generations_removed += 1;
                stats.rows_removed += cand.row_count;
            }
        }

        // Post-maintenance, always: reclaim freed pages so the file shrinks,
        // then truncate the WAL. Never triggered by a read path.
        self.reclaim_and_checkpoint()?;

        stats.bytes_after = self.database_size_bytes()?;
        Ok(stats)
    }

    /// Non-live generations in eviction order (worst retention value first):
    /// summary-only before full, then oldest access bucket, then oldest
    /// creation. See [`Self::maintain`] for the rationale.
    fn eviction_candidates(&self) -> StoreResult<Vec<EvictionCandidate>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT key_digest, row_count FROM generation \
                 WHERE live = 0 \
                 ORDER BY (row_count > 0) ASC, access_bucket ASC, created_at ASC",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(EvictionCandidate {
                    key_hex: r.get::<_, String>(0)?,
                    row_count: r.get::<_, i64>(1)?.max(0) as u64,
                })
            })
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(map_sqlite)?);
        }
        Ok(out)
    }

    /// Reclaim freelist pages into a smaller file (`PRAGMA incremental_vacuum`,
    /// bounded by the free-page count) and then checkpoint-truncate the WAL
    /// (`PRAGMA wal_checkpoint(TRUNCATE)`). A concurrent reader can make the
    /// TRUNCATE checkpoint report "busy" and defer — that is not an error, so
    /// it is ignored; maintenance never fails just because a reader is mid-read.
    /// Both run outside any open transaction and only from [`Self::maintain`].
    fn reclaim_and_checkpoint(&mut self) -> StoreResult<()> {
        // Materialize freed pages from the WAL into the main file first: in WAL
        // mode `incremental_vacuum` cannot reclaim pages that are still only
        // recorded in the WAL, so without this the freelist never shrinks the
        // file. `wal_checkpoint` returns a (busy, log, checkpointed) row; a
        // non-zero `busy` means a reader held it back, which we tolerate.
        self.conn
            .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |_| Ok(()))
            .map_err(map_sqlite)?;
        // Reclaim freelist pages into a smaller main file. `incremental_vacuum`
        // frees one page per stepped result row, so it must be stepped to
        // completion — `conn.pragma` does that, where a single `query_row`/
        // `execute_batch` would free only one page. The page count bounds the
        // work.
        let freelist: i64 = self
            .conn
            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
            .map_err(map_sqlite)?;
        if freelist > 0 {
            self.conn
                .pragma(None, "incremental_vacuum", freelist, |_| Ok(()))
                .map_err(map_sqlite)?;
        }
        // Truncate the WAL the vacuum just produced back to zero bytes.
        self.conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .map_err(map_sqlite)?;
        Ok(())
    }
}

/// One non-live generation selected for quota eviction.
struct EvictionCandidate {
    key_hex: String,
    row_count: u64,
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
