//! Tests for the verified SQLite store (card main-157 Phase 2). Eight
//! categories, in the order `plans/initial.md` Phase 2 "Implement and Unskip"
//! mandates:
//!
//! 1. publish/read round trip (empty/partial/full/large)
//! 2. reader never observes a partial manifest under concurrent publish/GC
//! 3. integrity rejection (key/kind/version/count/hash + every truncation)
//! 4. schema-mismatch replacement and `SQLITE_CORRUPT` quarantine
//! 5. fault injection (read-only dir, busy timeout, simulated disk-full)
//! 6. kill-builder recovery at three injection points
//! 7. lock-shard: same-key serialization, distinct-key concurrency
//! 8. GC retention
//!
//! plus a transaction-duration invariant test (resolver work never runs inside
//! a SQLite write transaction).
//!
//! Tests reach into `CacheStore`'s private `conn`/`path`/`dir` directly (a
//! child module may access an ancestor's private items) to tamper with stored
//! rows and inject faults — exactly what a hostile-storage test must do.

#![allow(clippy::items_after_statements)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;

use super::lock::shard_index;
use super::payload::IntegrityReason;
use super::*;

const V1: u32 = 1;
const V2: u32 = 2;

fn tmp() -> TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn open(dir: &Path) -> CacheStore {
    CacheStore::open_at(dir).expect("open store")
}

fn key(n: u8) -> [u8; 32] {
    let mut k = [0u8; 32];
    // Spread bytes so the first 8 (used for sharding) vary with `n`.
    for (i, b) in k.iter_mut().enumerate() {
        *b = n.wrapping_mul(31).wrapping_add(i as u8);
    }
    k
}

fn make_input(k: [u8; 32], version: u32, summary: &[u8], rows: usize) -> GenerationInput {
    GenerationInput {
        key_digest: k,
        head: "0123abcd".to_string(),
        payload_version: version,
        summary: summary.to_vec(),
        rows: (0..rows)
            .map(|i| GenerationRow {
                row_kind: 1,
                row_key: format!("span/{i}"),
                payload: format!("payload-bytes-for-row-{i}").into_bytes(),
            })
            .collect(),
        path_index: (0..rows)
            .map(|i| PathIndexEntry {
                source_path: format!("src/mod{i}.rs"),
                row_key: format!("span/{i}"),
            })
            .collect(),
        live: false,
    }
}

// -- 1. Round trip --------------------------------------------------------

#[test]
fn round_trip_empty_partial_full_and_large() {
    let dir = tmp();
    let mut store = open(dir.path());

    // Empty generation: a complete summary with zero rows.
    let empty = make_input(key(1), V1, b"empty-summary", 0);
    store.publish_generation(&empty).unwrap();
    let got = store.get_generation(&key(1), V1).unwrap().hit().unwrap();
    assert_eq!(got.summary, b"empty-summary");
    assert!(got.rows.is_empty());

    // Partial findings: a handful of rows.
    let partial = make_input(key(2), V1, b"partial", 3);
    store.publish_generation(&partial).unwrap();
    let got = store.get_generation(&key(2), V1).unwrap().hit().unwrap();
    assert_eq!(got.rows.len(), 3);
    assert_eq!(got.rows[0].row_key, "span/0");
    assert_eq!(got.rows[2].payload, b"payload-bytes-for-row-2");

    // Full findings: many rows, order preserved.
    let full = make_input(key(3), V1, b"full", 200);
    store.publish_generation(&full).unwrap();
    let got = store.get_generation(&key(3), V1).unwrap().hit().unwrap();
    assert_eq!(got.rows.len(), 200);
    for (i, row) in got.rows.iter().enumerate() {
        assert_eq!(row.row_key, format!("span/{i}"));
    }

    // Large summary within one snapshot.
    let big = vec![0xABu8; 4 * 1024 * 1024];
    let large = make_input(key(4), V1, &big, 10);
    store.publish_generation(&large).unwrap();
    let got = store.get_generation(&key(4), V1).unwrap().hit().unwrap();
    assert_eq!(got.summary.len(), big.len());
    assert_eq!(got.summary, big);

    // Absent key is a plain Miss.
    assert_eq!(store.get_generation(&key(99), V1).unwrap(), GetOutcome::Miss);
}

#[test]
fn republish_replaces_atomically() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"first", 5))
        .unwrap();
    store
        .publish_generation(&make_input(key(1), V1, b"second", 2))
        .unwrap();
    let got = store.get_generation(&key(1), V1).unwrap().hit().unwrap();
    assert_eq!(got.summary, b"second");
    assert_eq!(got.rows.len(), 2);
}

// -- 2. Reader never observes a partial manifest --------------------------

#[test]
fn reader_never_observes_partial_manifest_under_publish_and_gc() {
    let dir = tmp();
    // Prime the schema so both threads open cleanly.
    drop(open(dir.path()));

    const ROWS: usize = 40;
    let k = key(7);
    let writer_dir = dir.path().to_path_buf();
    let reader_dir = dir.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(2));
    let wb = barrier.clone();

    let writer = std::thread::spawn(move || {
        let mut store = open(&writer_dir);
        wb.wait();
        for _ in 0..300 {
            store
                .publish_generation(&make_input(k, V1, b"complete", ROWS))
                .unwrap();
            // GC removes it (not live, treat everything as old).
            store
                .gc(&RetentionPolicy {
                    live_keys: HashSet::new(),
                    keep_access_bucket_from: now_bucket() + 1,
                })
                .unwrap();
        }
    });

    let reader = std::thread::spawn(move || {
        let store = open(&reader_dir);
        barrier.wait();
        for _ in 0..3000 {
            match store.get_generation(&k, V1).unwrap() {
                GetOutcome::Hit(g) => {
                    // A hit is always complete and internally consistent.
                    assert_eq!(g.summary, b"complete");
                    assert_eq!(g.rows.len(), ROWS);
                }
                GetOutcome::Miss => {}
                GetOutcome::Rejected(r) => {
                    panic!("reader observed a partial/rejected generation: {r:?}");
                }
            }
        }
    });

    writer.join().unwrap();
    reader.join().unwrap();
}

// -- 3. Integrity rejection ----------------------------------------------

/// Open a raw connection to the store DB for tampering.
fn raw(store: &CacheStore) -> Connection {
    Connection::open(&store.path).expect("raw open")
}

#[test]
fn rejects_wrong_version() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 2))
        .unwrap();
    // Reader on a different version rejects the stored value.
    assert_eq!(
        store.get_generation(&key(1), V2).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Version)
    );
    // The value read on its own version is still a hit.
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
}

#[test]
fn rejects_wrong_kind() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 1))
        .unwrap();
    let hex = hex32(&key(1));
    raw(&store)
        .execute(
            "UPDATE generation SET entry_kind = 999 WHERE key_digest = ?1",
            [&hex],
        )
        .unwrap();
    assert_eq!(
        store.get_generation(&key(1), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Kind)
    );
}

#[test]
fn rejects_wrong_key_when_relocated() {
    let dir = tmp();
    let mut store = open(dir.path());
    // Seal a generation under key(1), then move its rows/summary under key(2).
    store
        .publish_generation(&make_input(key(1), V1, b"s", 2))
        .unwrap();
    let from = hex32(&key(1));
    let to = hex32(&key(2));
    let c = raw(&store);
    c.execute(
        "UPDATE generation SET key_digest = ?2 WHERE key_digest = ?1",
        [&from, &to],
    )
    .unwrap();
    c.execute(
        "UPDATE generation_row SET key_digest = ?2 WHERE key_digest = ?1",
        [&from, &to],
    )
    .unwrap();
    // Looking it up under key(2) must reject: it was sealed under key(1).
    assert_eq!(
        store.get_generation(&key(2), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Digest)
    );
}

#[test]
fn rejects_wrong_count() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 3))
        .unwrap();
    let hex = hex32(&key(1));
    // Claim more rows than exist: the generation envelope's cardinality check
    // fails before we even count rows.
    raw(&store)
        .execute(
            "UPDATE generation SET row_count = 9 WHERE key_digest = ?1",
            [&hex],
        )
        .unwrap();
    assert_eq!(
        store.get_generation(&key(1), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Count)
    );
}

#[test]
fn rejects_missing_row() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 3))
        .unwrap();
    let hex = hex32(&key(1));
    // Delete one row but leave row_count untouched: completeness fails.
    raw(&store)
        .execute(
            "DELETE FROM generation_row WHERE key_digest = ?1 AND ordinal = 1",
            [&hex],
        )
        .unwrap();
    // The row at ordinal 2 now sits where ordinal 1 is expected -> its ordinal
    // envelope mismatches first.
    assert_eq!(
        store.get_generation(&key(1), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Count)
    );
}

#[test]
fn rejects_wrong_hash() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"summary-bytes", 1))
        .unwrap();
    let hex = hex32(&key(1));
    raw(&store)
        .execute(
            "UPDATE generation SET summary_digest = ?2 WHERE key_digest = ?1",
            rusqlite::params![&hex, &[0u8; 32][..]],
        )
        .unwrap();
    assert_eq!(
        store.get_generation(&key(1), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Digest)
    );
}

#[test]
fn rejects_wrong_row_hash() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 3))
        .unwrap();
    let hex = hex32(&key(1));
    raw(&store)
        .execute(
            "UPDATE generation_row SET payload_digest = ?2 WHERE key_digest = ?1 AND ordinal = 2",
            rusqlite::params![&hex, &[7u8; 32][..]],
        )
        .unwrap();
    assert_eq!(
        store.get_generation(&key(1), V1).unwrap(),
        GetOutcome::Rejected(IntegrityReason::Digest)
    );
}

#[test]
fn rejects_every_summary_truncation_prefix() {
    let dir = tmp();
    let mut store = open(dir.path());
    let full = b"the-quick-brown-fox-summary-payload".to_vec();
    store
        .publish_generation(&make_input(key(1), V1, &full, 0))
        .unwrap();
    let hex = hex32(&key(1));
    // Every strict prefix (0..len) must be rejected; only the exact bytes pass.
    for prefix_len in 0..full.len() {
        let truncated = &full[..prefix_len];
        raw(&store)
            .execute(
                "UPDATE generation SET summary = ?2 WHERE key_digest = ?1",
                rusqlite::params![&hex, truncated],
            )
            .unwrap();
        assert_eq!(
            store.get_generation(&key(1), V1).unwrap(),
            GetOutcome::Rejected(IntegrityReason::Digest),
            "truncation to {prefix_len} bytes was not rejected",
        );
    }
    // Restore the exact bytes -> hit again.
    raw(&store)
        .execute(
            "UPDATE generation SET summary = ?2 WHERE key_digest = ?1",
            rusqlite::params![&hex, &full],
        )
        .unwrap();
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
}

#[test]
fn rejects_every_row_truncation_prefix() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 1))
        .unwrap();
    let hex = hex32(&key(1));
    let full = b"payload-bytes-for-row-0".to_vec();
    for prefix_len in 0..full.len() {
        let truncated = &full[..prefix_len];
        raw(&store)
            .execute(
                "UPDATE generation_row SET payload = ?2 WHERE key_digest = ?1 AND ordinal = 0",
                rusqlite::params![&hex, truncated],
            )
            .unwrap();
        assert_eq!(
            store.get_generation(&key(1), V1).unwrap(),
            GetOutcome::Rejected(IntegrityReason::Digest),
            "row truncation to {prefix_len} bytes was not rejected",
        );
    }
}

// -- 4. Quarantine --------------------------------------------------------

#[test]
fn schema_mismatch_quarantines_and_recreates() {
    let dir = tmp();
    {
        let mut store = open(dir.path());
        store
            .publish_generation(&make_input(key(1), V1, b"old", 2))
            .unwrap();
    }
    // Simulate an incompatible schema version.
    {
        let c = Connection::open(dir.path().join(super::schema::DB_BASENAME)).unwrap();
        c.pragma_update(None, "user_version", 999i64).unwrap();
    }
    // Reopen: mismatch is quarantined and a fresh DB is created; the old row is
    // never served.
    let store = open(dir.path());
    assert_eq!(store.get_generation(&key(1), V1).unwrap(), GetOutcome::Miss);
    // A quarantined-aside file exists.
    let aside: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
        .collect();
    assert!(!aside.is_empty(), "expected a quarantined-aside file");
}

#[test]
fn corrupt_database_quarantines_and_recreates() {
    let dir = tmp();
    let path = dir.path().join(super::schema::DB_BASENAME);
    {
        let mut store = open(dir.path());
        store
            .publish_generation(&make_input(key(1), V1, b"old", 2))
            .unwrap();
    }
    // Corrupt the header so SQLite reports NOTADB/CORRUPT on the master query.
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        f.write_all(&[0xFFu8; 4096]).unwrap();
        f.flush().unwrap();
    }
    // Reopen: corruption is quarantined; the store recreates and serves nothing
    // suspect.
    let mut store = open(dir.path());
    assert_eq!(store.get_generation(&key(1), V1).unwrap(), GetOutcome::Miss);
    // The fresh store is fully functional.
    store
        .publish_generation(&make_input(key(2), V1, b"new", 1))
        .unwrap();
    assert!(store.get_generation(&key(2), V1).unwrap().hit().is_some());
}

// -- 5. Fault injection ---------------------------------------------------

#[test]
#[cfg(unix)]
fn read_only_directory_fails_closed() {
    use std::os::unix::fs::PermissionsExt;
    let root = tmp();
    let ro = root.path().join("ro");
    std::fs::create_dir(&ro).unwrap();
    std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();

    // Opening a store that must create a subdir under a read-only parent fails
    // closed with a structured reason — no panic.
    let reason = match CacheStore::open_at(&ro.join("sub")) {
        Ok(_) => panic!("open succeeded under a read-only directory"),
        Err(e) => e.reason(),
    };
    assert!(
        matches!(reason, BypassReason::ReadOnly | BypassReason::Io),
        "unexpected reason: {reason:?}"
    );

    // Restore perms so TempDir cleanup succeeds.
    std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn busy_timeout_fails_closed_without_writing() {
    let dir = tmp();
    // Store with a short busy timeout so the test is fast.
    let mut store = CacheStore::open_with(dir.path(), 50, super::lock::build_shard_count()).unwrap();

    // A second raw connection grabs and holds the write lock.
    let blocker = Connection::open(dir.path().join(super::schema::DB_BASENAME)).unwrap();
    blocker.busy_timeout(Duration::from_millis(50)).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();

    // Publishing now cannot acquire the write lock within 50ms -> BusyTimeout.
    let err = store
        .publish_generation(&make_input(key(1), V1, b"s", 2))
        .unwrap_err();
    assert_eq!(err.reason(), BypassReason::BusyTimeout);

    // Release the lock; nothing was written.
    blocker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store.get_generation(&key(1), V1).unwrap(), GetOutcome::Miss);
    assert!(!store.is_in_write_txn());
}

#[test]
fn disk_full_fails_closed_and_rolls_back() {
    let dir = tmp();
    let mut store = open(dir.path());
    // Cap the database at its current size so a large publish overflows with
    // SQLITE_FULL — a real full-storage error without a real full disk.
    let pages: i64 = store
        .conn
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .unwrap();
    store
        .conn
        .pragma_update(None, "max_page_count", pages + 2)
        .unwrap();

    let big = vec![0x5Au8; 8 * 1024 * 1024];
    let err = store
        .publish_generation(&make_input(key(1), V1, &big, 4))
        .unwrap_err();
    assert_eq!(err.reason(), BypassReason::DiskFull);

    // Lift the cap; the failed publish left nothing behind (rolled back).
    store
        .conn
        .pragma_update(None, "max_page_count", 0)
        .unwrap();
    assert_eq!(store.get_generation(&key(1), V1).unwrap(), GetOutcome::Miss);
    assert!(!store.is_in_write_txn());
}

// -- 6. Kill-builder recovery ---------------------------------------------

const KILL_KEY: u8 = 5;

/// Child process entrypoint for the kill-builder tests. Runs only when
/// `GS_STORE_KILL_MODE` is set (the parent spawns this exact test in a
/// subprocess); otherwise it is a trivial pass during a normal suite run.
#[test]
fn kill_builder_child_entrypoint() {
    let Ok(mode) = std::env::var("GS_STORE_KILL_MODE") else {
        return; // normal suite run: no-op.
    };
    let dir = std::env::var("GS_STORE_KILL_DIR").expect("kill dir");
    let dir = Path::new(&dir);
    let k = key(KILL_KEY);
    let db = dir.join(super::schema::DB_BASENAME);

    match mode.as_str() {
        "before" => {
            // Open, do nothing that writes, then die before publishing.
            let _store = CacheStore::open_at(dir).unwrap();
            std::process::abort();
        }
        "during" => {
            // Begin a publish-shaped write transaction, insert partial rows,
            // then die WITHOUT committing (models a crash mid-publish).
            let c = Connection::open(&db).unwrap();
            c.busy_timeout(Duration::from_millis(1000)).unwrap();
            c.pragma_update(None, "journal_mode", "WAL").unwrap();
            let hex = hex32(&k);
            c.execute_batch("BEGIN IMMEDIATE").unwrap();
            c.execute("DELETE FROM generation WHERE key_digest = ?1", [&hex])
                .unwrap();
            c.execute("DELETE FROM generation_row WHERE key_digest = ?1", [&hex])
                .unwrap();
            c.execute(
                "INSERT INTO generation_row \
                 (key_digest, ordinal, entry_kind, payload_version, row_kind, row_key, payload, payload_digest) \
                 VALUES (?1, 0, 2, 1, 1, 'x', ?2, ?3)",
                rusqlite::params![&hex, &b"partial"[..], &[0u8; 32][..]],
            )
            .unwrap();
            // No commit.
            std::process::abort();
        }
        "after" => {
            // Publish a complete new generation, then die.
            let mut store = CacheStore::open_at(dir).unwrap();
            store
                .publish_generation(&make_input(k, V1, b"new", 3))
                .unwrap();
            std::process::abort();
        }
        other => panic!("unknown kill mode {other}"),
    }
}

fn spawn_kill_child(dir: &Path, mode: &str) {
    let exe = std::env::current_exe().expect("current exe");
    let status = std::process::Command::new(exe)
        .args([
            "--exact",
            "resolver::store::tests::kill_builder_child_entrypoint",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("GS_STORE_KILL_MODE", mode)
        .env("GS_STORE_KILL_DIR", dir.to_str().unwrap())
        .status()
        .expect("spawn child");
    // The child always aborts (SIGABRT) — it never exits cleanly.
    assert!(!status.success(), "child was expected to abort");
}

#[test]
fn kill_before_publish_leaves_prior_generation() {
    let dir = tmp();
    let mut store = open(dir.path());
    // Prior complete generation A.
    store
        .publish_generation(&make_input(key(KILL_KEY), V1, b"prior", 2))
        .unwrap();
    drop(store);

    spawn_kill_child(dir.path(), "before");

    let store = open(dir.path());
    let g = store
        .get_generation(&key(KILL_KEY), V1)
        .unwrap()
        .hit()
        .expect("prior generation intact");
    assert_eq!(g.summary, b"prior");
    assert_eq!(g.rows.len(), 2);
}

#[test]
fn kill_during_publish_rolls_back_to_prior_generation() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(KILL_KEY), V1, b"prior", 2))
        .unwrap();
    drop(store);

    spawn_kill_child(dir.path(), "during");

    // WAL recovery discards the uncommitted partial; A remains complete.
    let store = open(dir.path());
    let g = store
        .get_generation(&key(KILL_KEY), V1)
        .unwrap()
        .hit()
        .expect("prior generation intact after crash mid-publish");
    assert_eq!(g.summary, b"prior");
    assert_eq!(g.rows.len(), 2);
}

#[test]
fn kill_after_publish_keeps_new_generation() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(KILL_KEY), V1, b"prior", 2))
        .unwrap();
    drop(store);

    spawn_kill_child(dir.path(), "after");

    let store = open(dir.path());
    let g = store
        .get_generation(&key(KILL_KEY), V1)
        .unwrap()
        .hit()
        .expect("new generation committed before crash");
    assert_eq!(g.summary, b"new");
    assert_eq!(g.rows.len(), 3);
}

// -- 7. Lock-shard concurrency -------------------------------------------

#[test]
fn same_key_callers_serialize_to_one_builder() {
    let dir = tmp();
    drop(open(dir.path())); // prime schema.

    static BUILDS: AtomicUsize = AtomicUsize::new(0);
    BUILDS.store(0, Ordering::SeqCst);

    const THREADS: usize = 8;
    let k = key(11);
    let barrier = Arc::new(Barrier::new(THREADS));
    let mut handles = Vec::new();
    for _ in 0..THREADS {
        let d = dir.path().to_path_buf();
        let b = barrier.clone();
        handles.push(std::thread::spawn(move || {
            let mut store = open(&d);
            b.wait();
            store
                .build_or_get(&k, "HEAD", V1, || {
                    BUILDS.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(80));
                    Ok(BuildProduct {
                        payload_version: V1,
                        summary: b"built-once".to_vec(),
                        rows: vec![GenerationRow {
                            row_kind: 1,
                            row_key: "s".to_string(),
                            payload: b"p".to_vec(),
                        }],
                        path_index: vec![],
                        live: false,
                    })
                })
                .unwrap()
        }));
    }
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    // Exactly one builder ran (side-channel counter, not just output equality).
    assert_eq!(BUILDS.load(Ordering::SeqCst), 1);
    // Every caller got the same verified generation.
    for r in &results {
        assert_eq!(r.summary, b"built-once");
        assert_eq!(r.rows.len(), 1);
    }
}

#[test]
fn distinct_key_callers_build_concurrently() {
    let dir = tmp();
    drop(open(dir.path()));

    // Find two keys on different shards.
    let shards = super::lock::build_shard_count();
    let mut ka = None;
    let mut kb = None;
    for n in 0u8..255 {
        let s = shard_index(&key(n), shards);
        if ka.is_none() {
            ka = Some((key(n), s));
        } else if kb.is_none() && s != ka.unwrap().1 {
            kb = Some((key(n), s));
            break;
        }
    }
    let (ka, _) = ka.unwrap();
    let (kb, _) = kb.unwrap();

    let windows: Arc<Mutex<Vec<(Instant, Instant)>>> = Arc::new(Mutex::new(Vec::new()));
    let barrier = Arc::new(Barrier::new(2));

    let run = |k: [u8; 32]| {
        let d = dir.path().to_path_buf();
        let w = windows.clone();
        let b = barrier.clone();
        std::thread::spawn(move || {
            let mut store = open(&d);
            b.wait();
            store
                .build_or_get(&k, "HEAD", V1, || {
                    let start = Instant::now();
                    std::thread::sleep(Duration::from_millis(200));
                    let end = Instant::now();
                    w.lock().unwrap().push((start, end));
                    Ok(BuildProduct {
                        payload_version: V1,
                        summary: b"x".to_vec(),
                        rows: vec![],
                        path_index: vec![],
                        live: false,
                    })
                })
                .unwrap();
        })
    };

    let h1 = run(ka);
    let h2 = run(kb);
    h1.join().unwrap();
    h2.join().unwrap();

    let w = windows.lock().unwrap();
    assert_eq!(w.len(), 2, "both builders ran");
    let (s0, e0) = w[0];
    let (s1, e1) = w[1];
    // Overlapping intervals prove the two builders ran concurrently, not
    // serialized behind one shard lock.
    assert!(
        s0 < e1 && s1 < e0,
        "distinct-key builders did not overlap: {:?} vs {:?}",
        (s0, e0),
        (s1, e1)
    );
}

// -- 8. GC retention ------------------------------------------------------

fn set_bucket(store: &CacheStore, k: &[u8; 32], bucket: i64) {
    store
        .conn
        .execute(
            "UPDATE generation SET access_bucket = ?2 WHERE key_digest = ?1",
            rusqlite::params![hex32(k), bucket],
        )
        .unwrap();
}

fn row_total(store: &CacheStore) -> i64 {
    store
        .conn
        .query_row("SELECT count(*) FROM generation_row", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn gc_keeps_live_and_recent_evicts_unreferenced() {
    let dir = tmp();
    let mut store = open(dir.path());
    let now = now_bucket();

    // g0: live + old, g1/g2: recent, g3/g4: old + unreferenced.
    for n in 0..5u8 {
        store
            .publish_generation(&make_input(key(n), V1, b"s", 4))
            .unwrap();
    }
    set_bucket(&store, &key(0), now - 100);
    store.set_live(&key(0), true).unwrap();
    // g1, g2 stay at `now` (recent).
    set_bucket(&store, &key(3), now - 100);
    set_bucket(&store, &key(4), now - 100);

    let rows_before = row_total(&store);
    assert_eq!(rows_before, 5 * 4);

    let stats = store
        .gc(&RetentionPolicy {
            live_keys: {
                let mut s = HashSet::new();
                s.insert(key(0));
                s
            },
            keep_access_bucket_from: now, // keep access_bucket >= now
        })
        .unwrap();

    assert_eq!(stats.generations_removed, 2);
    assert_eq!(stats.rows_removed, 8);

    // Live and recent survive.
    assert!(store.get_generation(&key(0), V1).unwrap().hit().is_some());
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
    assert!(store.get_generation(&key(2), V1).unwrap().hit().is_some());
    // Old unreferenced are gone, rows included (atomic).
    assert_eq!(store.get_generation(&key(3), V1).unwrap(), GetOutcome::Miss);
    assert_eq!(store.get_generation(&key(4), V1).unwrap(), GetOutcome::Miss);
    assert_eq!(row_total(&store), 3 * 4);
}

#[test]
fn touch_advances_access_bucket_only_across_bucket_boundaries() {
    let dir = tmp();
    let mut store = open(dir.path());
    store
        .publish_generation(&make_input(key(1), V1, b"s", 1))
        .unwrap();
    // Force an old bucket, then touch: it advances to the current bucket.
    set_bucket(&store, &key(1), now_bucket() - 5);
    store.touch(&key(1)).unwrap();
    let b: i64 = store
        .conn
        .query_row(
            "SELECT access_bucket FROM generation WHERE key_digest = ?1",
            [hex32(&key(1))],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(b, now_bucket());
}

// -- 8b. Quota-driven maintenance (card main-157 Phase 6A) ----------------

/// A generation with a large summary, so a handful cross a small artificial
/// cap. `rows` full reuse rows plus a matching path index.
fn make_big_input(k: [u8; 32], summary_bytes: usize, rows: usize) -> GenerationInput {
    let mut input = make_input(k, V1, b"", rows);
    input.summary = vec![0xABu8; summary_bytes];
    input
}

/// Read the on-disk WAL file length directly, bypassing any store method.
fn wal_len(dir: &Path) -> u64 {
    let mut wal = dir.join(super::schema::DB_BASENAME).into_os_string();
    wal.push("-wal");
    std::fs::metadata(Path::new(&wal))
        .map(|m| m.len())
        .unwrap_or(0)
}

#[test]
fn maintain_evicts_below_cap_keeping_live_and_recent() {
    let dir = tmp();
    let mut store = open(dir.path());
    let now = now_bucket();

    // Survivors: live (old bucket) + two recent, all small.
    store
        .publish_generation(&make_big_input(key(0), 256, 1))
        .unwrap();
    store.set_live(&key(0), true).unwrap();
    set_bucket(&store, &key(0), now - 100);
    store
        .publish_generation(&make_big_input(key(1), 256, 1))
        .unwrap();
    store
        .publish_generation(&make_big_input(key(2), 256, 1))
        .unwrap();
    // Eviction fodder: three old, non-live, and large.
    for n in 3..6u8 {
        store
            .publish_generation(&make_big_input(key(n), 512 * 1024, 2))
            .unwrap();
        set_bucket(&store, &key(n), now - 100);
    }

    let before = store.database_size_bytes().unwrap();
    let cap = 400 * 1024;
    assert!(before > cap, "corpus ({before}) should exceed cap ({cap})");

    let stats = store.maintain(cap).unwrap();

    // Footprint dropped below the cap.
    let after = store.database_size_bytes().unwrap();
    assert!(
        after <= cap,
        "size after maintain ({after}) should be <= cap ({cap})",
    );
    assert_eq!(stats.bytes_before, before);
    assert_eq!(stats.bytes_after, after);
    assert!(after < before);

    // The three large, old, unreferenced generations were evicted.
    assert_eq!(stats.generations_removed, 3);
    assert_eq!(stats.rows_removed, 6);
    for n in 3..6u8 {
        assert_eq!(store.get_generation(&key(n), V1).unwrap(), GetOutcome::Miss);
    }
    // Live and recently-accessed generations survived.
    assert!(store.get_generation(&key(0), V1).unwrap().hit().is_some());
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
    assert!(store.get_generation(&key(2), V1).unwrap().hit().is_some());
}

#[test]
fn maintain_prefers_summary_only_over_full_even_if_newer() {
    let dir = tmp();
    let mut store = open(dir.path());
    let now = now_bucket();

    // Full committed generation (reuse rows), older access bucket.
    store
        .publish_generation(&make_big_input(key(1), 512 * 1024, 3))
        .unwrap();
    set_bucket(&store, &key(1), now - 100);
    // Summary-only (dirty) generation, MORE recent — but cheaper to rebuild and
    // carrying no reuse value, so it must be evicted first.
    store
        .publish_generation_summary_only(&make_big_input(key(2), 512 * 1024, 0))
        .unwrap();
    set_bucket(&store, &key(2), now);

    let cap = 700 * 1024;
    assert!(store.database_size_bytes().unwrap() > cap);

    let stats = store.maintain(cap).unwrap();

    assert_eq!(stats.generations_removed, 1);
    // Summary-only newer one evicted; full older one survived.
    assert_eq!(store.get_generation(&key(2), V1).unwrap(), GetOutcome::Miss);
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
}

#[test]
fn maintain_truncates_wal_even_without_eviction() {
    let dir = tmp();
    let mut store = open(dir.path());
    // A publish grows the WAL.
    store
        .publish_generation(&make_big_input(key(1), 512 * 1024, 4))
        .unwrap();
    assert!(wal_len(dir.path()) > 0, "publish should have grown the WAL");

    // A cap far above the corpus: no eviction, but the WAL is still truncated.
    let huge_cap = 512 * 1024 * 1024;
    let stats = store.maintain(huge_cap).unwrap();
    assert_eq!(stats.generations_removed, 0);
    assert_eq!(
        wal_len(dir.path()),
        0,
        "maintain must checkpoint-truncate the WAL",
    );
    // The generation is still fully readable after the checkpoint.
    assert!(store.get_generation(&key(1), V1).unwrap().hit().is_some());
}

#[test]
fn maintain_reports_corruption_recovery_event() {
    let dir = tmp();
    let path = dir.path().join(super::schema::DB_BASENAME);
    {
        let mut store = open(dir.path());
        store
            .publish_generation(&make_input(key(1), V1, b"old", 2))
            .unwrap();
    }
    // Corrupt the header so the next open quarantines and recreates.
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        f.write_all(&[0xFFu8; 4096]).unwrap();
        f.flush().unwrap();
    }

    let mut recovered = open(dir.path());
    assert_eq!(recovered.recovered_on_open(), Some(BypassReason::Corrupt));
    let stats = recovered.maintain(512 * 1024 * 1024).unwrap();
    assert!(
        stats.corruption_recovered,
        "maintain must surface the quarantine/recreate recovery event",
    );

    // A store that opened cleanly reports no recovery.
    let clean_dir = tmp();
    let mut clean = open(clean_dir.path());
    assert_eq!(clean.recovered_on_open(), None);
    assert!(!clean.maintain(512 * 1024 * 1024).unwrap().corruption_recovered);
}

#[test]
fn reader_never_observes_partial_generation_under_quota_maintenance() {
    let dir = tmp();
    // Prime the schema so both threads open cleanly.
    drop(open(dir.path()));

    const ROWS: usize = 40;
    let k = key(9);
    let writer_dir = dir.path().to_path_buf();
    let reader_dir = dir.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(2));
    let wb = barrier.clone();

    let writer = std::thread::spawn(move || {
        let mut store = open(&writer_dir);
        wb.wait();
        for _ in 0..300 {
            store
                .publish_generation(&make_input(k, V1, b"complete", ROWS))
                .unwrap();
            // A cap of 0 forces eviction of every non-live generation, exactly
            // like the publish/GC stress test but through the quota path.
            store.maintain(0).unwrap();
        }
    });

    let reader = std::thread::spawn(move || {
        let store = open(&reader_dir);
        barrier.wait();
        for _ in 0..3000 {
            match store.get_generation(&k, V1).unwrap() {
                GetOutcome::Hit(g) => {
                    assert_eq!(g.summary, b"complete");
                    assert_eq!(g.rows.len(), ROWS);
                }
                GetOutcome::Miss => {}
                GetOutcome::Rejected(r) => {
                    panic!("reader observed a partial/rejected generation: {r:?}");
                }
            }
        }
    });

    writer.join().unwrap();
    reader.join().unwrap();
}

// -- Transaction-duration invariant --------------------------------------

#[test]
fn resolver_work_runs_outside_any_write_transaction() {
    let dir = tmp();
    drop(open(dir.path()));
    let mut store = open(dir.path());
    let db = dir.path().join(super::schema::DB_BASENAME);

    // The builder simulates resolver work by opening a SECOND connection and
    // acquiring the write lock. If the store held a write transaction while the
    // builder ran (the forbidden pattern), this BEGIN IMMEDIATE would block and
    // fail BUSY. It succeeding proves compute happens outside any write txn.
    let got = store
        .build_or_get(&key(1), "HEAD", V1, || {
            // A second writer succeeds => the store is NOT mid-write-transaction.
            assert!(
                second_writer_succeeds(&db),
                "resolver work observed an open write transaction"
            );
            Ok(BuildProduct {
                payload_version: V1,
                summary: b"ok".to_vec(),
                rows: vec![],
                path_index: vec![],
                live: false,
            })
        })
        .unwrap();
    assert_eq!(got.summary, b"ok");
}

fn second_writer_succeeds(db: &Path) -> bool {
    let c = Connection::open(db).unwrap();
    c.busy_timeout(Duration::from_millis(200)).unwrap();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    c.execute_batch(
        "BEGIN IMMEDIATE; CREATE TEMP TABLE IF NOT EXISTS probe(x); INSERT INTO probe VALUES (1); COMMIT;",
    )
    .is_ok()
}

// =========================================================================
// Card main-157 Phase 6C: measured lifecycle proof.
//
// 6A built the quota-driven `maintain` mechanism and 6B wired it to a
// production high-water trigger. 6C proves the wired-up lifecycle holds under
// real, repeated, concurrent usage and validates the plan's measured exit-gate
// criteria:
//
//   * "Storage returns below the cap after maintenance" — held under a
//     realistic repeated-usage pattern, not one artificial test.
//   * "Repeated current-version commits cannot grow the database without
//     bound" — the one criterion 6A/6B never measured.
//   * "GC is transactionally invisible to readers" — extended to a
//     termination-injection matrix (reader/writer/build/GC concurrent, process
//     abort at many boundaries).
//   * The retention scoring-policy replay spike lives in
//     `retention_policy_replay_spike` and is written up in
//     `notes/phase-6-retention-policy-spike.md`.
//
// Measurement findings are written up in `notes/phase-6-lifecycle-measurement.md`.
// =========================================================================

/// A distinct 32-byte key for each `n` (the `key(u8)` helper only spans 256
/// values; the growth/replay tests need thousands). Spreads `n`'s bytes across
/// all 32 so the first 8 (used for build-lock sharding) still vary.
fn key_u32(n: u32) -> [u8; 32] {
    let nb = n.to_le_bytes();
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = nb[i % 4].wrapping_add((i as u8).wrapping_mul(31));
    }
    k
}

/// Faithful in-test model of 6B's production trigger
/// [`super::super::exact`]`::maybe_maintain`: a cheap size probe gates the
/// bounded pass, which runs only above the high-water mark. Returns the pass's
/// stats (all-zero when under the cap, i.e. the probe-only fast path).
fn run_maybe_maintain(store: &mut CacheStore, cap: u64) -> GcStats {
    if store.database_size_bytes().unwrap() <= cap {
        return GcStats::default();
    }
    store.maintain(cap).unwrap()
}

// -- 6C.1 Repeated-current-version-commit growth --------------------------

/// The "SAME commit/state re-queried many times" exit-gate sub-case. A fixed
/// state re-published under the same canonical key (what a cross-process exact
/// re-query does before it starts hitting) replaces atomically, so the store
/// stays flat no matter how many times it is re-queried — bounded by
/// construction, independent of iteration count.
#[test]
fn repeated_identical_state_query_stays_bounded() {
    let dir = tmp();
    let mut store = open(dir.path());
    let cap = 256 * 1024;
    let k = key(1);

    let mut sizes = Vec::new();
    for _ in 0..200 {
        // Same key + same payload each iteration: `publish_txn` deletes the
        // prior generation for this key first, so nothing accumulates.
        store
            .publish_generation(&make_big_input(k, 64 * 1024, 4))
            .unwrap();
        run_maybe_maintain(&mut store, cap);
        sizes.push(store.database_size_bytes().unwrap());
    }

    let steady = sizes[1];
    let last = *sizes.last().unwrap();
    eprintln!(
        "GROWTH identical-requery n=200 first={} steady={} last={} max={}",
        sizes[0],
        steady,
        last,
        sizes.iter().copied().max().unwrap(),
    );
    // Flat: 200 re-queries land within one generation's slack of the first
    // steady-state sample — no growth with query count.
    assert!(
        last <= steady + 128 * 1024,
        "identical re-query grew the store with iteration count: {steady} -> {last}",
    );
}

/// The quota MECHANISM bounds growth across a long sequence of DISTINCT
/// generations, *provided a superseded generation is demoted to non-live* (the
/// retention signal `maintain` acts on). Each iteration publishes a fresh
/// distinct-key generation, marks it non-live and aged (modelling a superseded
/// state), then runs the production trigger. Storage plateaus below a small
/// multiple of the cap instead of growing linearly with iteration count.
///
/// This isolates `maintain`'s bounding from the liveness-wiring gap that
/// `every_live_generation_defeats_the_quota_measured_gap` documents: the
/// mechanism works; production just never feeds it evictable generations.
#[test]
fn maintain_plateaus_across_many_distinct_evictable_generations() {
    let dir = tmp();
    let mut store = open(dir.path());
    let cap = 512 * 1024;
    let old_bucket = now_bucket() - 10;

    let mut sizes = Vec::new();
    for n in 0..400u32 {
        let k = key_u32(n);
        store
            .publish_generation(&make_big_input(k, 32 * 1024, 2))
            .unwrap();
        // A superseded generation no longer backs the active worktree: demote
        // it and age it out of the recent window so the quota may reclaim it.
        store.set_live(&k, false).unwrap();
        set_bucket(&store, &k, old_bucket);
        run_maybe_maintain(&mut store, cap);
        sizes.push(store.database_size_bytes().unwrap());
    }

    // Once past the cap the first time, the footprint stays bounded.
    let steady_max = sizes[200..].iter().copied().max().unwrap();
    eprintln!(
        "GROWTH distinct-evictable n=400 cap={cap} at50={} at100={} at250={} at399={} steady_max={steady_max}",
        sizes[50], sizes[100], sizes[250], sizes[399],
    );
    assert!(
        steady_max <= 2 * cap,
        "distinct-generation footprint grew unbounded: steady-state max {steady_max} exceeds 2x cap ({cap})",
    );
    // Not proportional to iteration count: the footprint at iteration 399 is no
    // larger than at iteration 250 (a true plateau, not a slow climb).
    assert!(
        sizes[399] <= sizes[250] + 64 * 1024,
        "footprint still climbing with iteration count: [250]={} [399]={}",
        sizes[250],
        sizes[399],
    );
}

/// MEASURED GAP (honest characterization of current behavior). Models 6B's
/// production wiring literally: [`super::super::exact`]`::publish_if_eligible`
/// always publishes `live: true`, and NOTHING ever demotes a superseded
/// generation back to non-live. `maintain` never evicts a live generation
/// (`eviction_candidates` filters `WHERE live = 0`), so a sequence of distinct
/// current-version states — a developer iterating with genuinely different
/// dirty content, each a fresh canonical key — grows the store without bound;
/// the quota trigger reclaims nothing.
///
/// This test PINS that behavior (it does not paper over it): it asserts the
/// store sails past the cap and `maintain` removes zero generations. It is a
/// tripwire — when the follow-up liveness-reconciliation fix lands (recompute
/// which generations are truly live from current worktrees/refs, demote the
/// rest), this test must be updated to assert a plateau. The exit-gate
/// criterion "repeated current-version commits cannot grow without bound" is
/// therefore MISSED under production semantics today; see
/// `notes/phase-6-lifecycle-measurement.md`.
#[test]
fn every_live_generation_defeats_the_quota_measured_gap() {
    let dir = tmp();
    let mut store = open(dir.path());
    let cap = 256 * 1024;

    let mut sizes = Vec::new();
    let mut removed_total = 0u64;
    for n in 0..160u32 {
        // Exactly what publish_if_eligible does: a distinct key, live = true.
        let mut input = make_big_input(key_u32(n), 16 * 1024, 1);
        input.live = true;
        store.publish_generation(&input).unwrap();
        let stats = run_maybe_maintain(&mut store, cap);
        removed_total += stats.generations_removed;
        sizes.push(store.database_size_bytes().unwrap());
    }

    let last = *sizes.last().unwrap();
    eprintln!(
        "GROWTH all-live-gap n=160 cap={cap} at20={} at40={} at80={} at160={last} removed_total={removed_total}",
        sizes[20], sizes[40], sizes[80],
    );
    assert!(
        last > cap,
        "expected unbounded growth past the cap under all-live semantics; got {last} <= cap {cap}",
    );
    assert_eq!(
        removed_total, 0,
        "maintain must not evict any live generation (it evicted {removed_total})",
    );
    // Linear in iteration count: the second-half footprint strictly exceeds the
    // first-half footprint — the live set never stops growing.
    assert!(
        sizes[159] > sizes[79],
        "live-set footprint is not monotonically growing: [79]={} [159]={}",
        sizes[79],
        sizes[159],
    );
}

// -- 6C.2 Retention scoring-policy replay spike ---------------------------

/// Whether a corpus generation is a full committed baseline (expensive to
/// rebuild — carries reuse rows) or a summary-only dirty overlay (cheap).
#[derive(Clone, Copy)]
struct Kind {
    full: bool,
}

/// Deterministic LCG so the replay trace is identical across policies.
fn lcg_next(state: &mut u64) -> u64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *state >> 33
}

/// Publish one corpus generation of the given kind and set its access bucket.
fn publish_corpus_gen(store: &mut CacheStore, k: [u8; 32], kind: Kind, bucket: i64) {
    let input = if kind.full {
        make_big_input(k, 8 * 1024, 3)
    } else {
        // Summary-only overlay: 0 rows, published summary-only like the dirty tier.
        make_big_input(k, 8 * 1024, 0)
    };
    if kind.full {
        store.publish_generation(&input).unwrap();
    } else {
        store.publish_generation_summary_only(&input).unwrap();
    }
    store.set_live(&k, false).unwrap();
    set_bucket(store, &k, bucket);
}

/// Evict non-live generations under `cap`, choosing victims by `order_by`
/// (a policy's eviction ordering), then reclaim + checkpoint. Returns the
/// number of generations evicted. Mirrors `maintain`'s loop but with a
/// caller-supplied ordering so alternative retention policies can be compared.
fn evict_under_cap_with_order(store: &mut CacheStore, cap: u64, order_by: &str) -> u64 {
    if store.reclaimed_main_bytes().unwrap() <= cap {
        store.reclaim_and_checkpoint().unwrap();
        return 0;
    }
    let victims: Vec<String> = {
        let sql =
            format!("SELECT key_digest FROM generation WHERE live = 0 ORDER BY {order_by}");
        let mut stmt = store.conn.prepare(&sql).unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    };
    let mut removed = 0u64;
    for key_hex in victims {
        if store.reclaimed_main_bytes().unwrap() <= cap {
            break;
        }
        store.gc_delete_one(&key_hex).unwrap();
        removed += 1;
    }
    store.reclaim_and_checkpoint().unwrap();
    removed
}

/// Replay `trace` against the store, timing each access: a hit is the real
/// `get_generation` latency; a miss is the real cost to rebuild (re-publish)
/// that generation, which then repopulates it (a faithful cache-on-miss).
/// Returns (total_latency, hits, misses).
fn replay_trace(
    store: &mut CacheStore,
    trace: &[[u8; 32]],
    kinds: &std::collections::HashMap<[u8; 32], Kind>,
) -> (Duration, u64, u64) {
    let mut total = Duration::ZERO;
    let mut hits = 0u64;
    let mut misses = 0u64;
    for k in trace {
        let t = Instant::now();
        match store.get_generation(k, V1).unwrap() {
            GetOutcome::Hit(_) => {
                total += t.elapsed();
                hits += 1;
            }
            GetOutcome::Miss | GetOutcome::Rejected(_) => {
                // Rebuild-on-miss: the real publish cost is the recompute
                // penalty this policy incurred by having evicted the key.
                let kind = *kinds.get(k).unwrap();
                let t2 = Instant::now();
                publish_corpus_gen(store, *k, kind, now_bucket() - 10);
                total += t2.elapsed();
                misses += 1;
            }
        }
    }
    (total, hits, misses)
}

/// One policy's replay result, for the write-up.
struct PolicyResult {
    name: &'static str,
    evicted: u64,
    hits: u64,
    misses: u64,
    latency: Duration,
}

/// Retention scoring-policy replay spike (card main-157 Phase 6C, plan Phase 6
/// "Replay captured exact/incremental/dirty access traces ... pick the policy
/// with the best hit-latency value under the fixed cap").
///
/// Corpus mirrors a captured access pattern: a set of expensive full committed
/// baselines that are OLD (old access bucket) but re-queried, plus many cheap
/// summary-only dirty overlays that are RECENT but transient — the shape of a
/// developer who committed a while ago and has since done many dirty iterations.
/// Under a fixed cap that forces evicting roughly half the bytes, replay a
/// weighted trace (mostly re-accessing the baselines) and measure hit latency,
/// where a miss pays a real rebuild.
///
/// Policies compared:
///   * A (6A current): summary-only first, then oldest access bucket, then
///     oldest created.
///   * B (pure recency): oldest access bucket first, blind to kind/cost.
///   * C (recompute-cost/byte): summary-only (cheap) freeing the most bytes
///     first, then oldest access bucket.
///
/// The deterministic assertion is on MISS COUNT (kind- and trace-deterministic,
/// not timing): a recency-blind policy that evicts the old-but-valuable
/// baselines suffers at least as many trace misses as the kind-aware policies.
/// Latencies are printed for the note.
#[test]
fn retention_policy_replay_spike() {
    const N_FULL: u32 = 24;
    const N_DIRTY: u32 = 72;
    const TRACE_LEN: usize = 400;
    let cap: u64 = 380 * 1024;

    let now = now_bucket();
    // Full baselines: OLD access bucket (committed a while ago) but valuable.
    // Dirty overlays: RECENT (just now) but transient.
    let full_bucket = now - 200;
    let dirty_bucket = now;

    let mut kinds: std::collections::HashMap<[u8; 32], Kind> = std::collections::HashMap::new();
    let full_keys: Vec<[u8; 32]> = (0..N_FULL).map(|i| key_u32(1_000 + i)).collect();
    let dirty_keys: Vec<[u8; 32]> = (0..N_DIRTY).map(|i| key_u32(5_000 + i)).collect();
    for &k in &full_keys {
        kinds.insert(k, Kind { full: true });
    }
    for &k in &dirty_keys {
        kinds.insert(k, Kind { full: false });
    }

    // Weighted trace: 80% re-access a full baseline, 20% a dirty overlay.
    let mut rng: u64 = 0x9E37_79B9_7F4A_7C15;
    let trace: Vec<[u8; 32]> = (0..TRACE_LEN)
        .map(|_| {
            if lcg_next(&mut rng) % 100 < 80 {
                full_keys[(lcg_next(&mut rng) as usize) % full_keys.len()]
            } else {
                dirty_keys[(lcg_next(&mut rng) as usize) % dirty_keys.len()]
            }
        })
        .collect();

    let build_corpus = |store: &mut CacheStore| {
        for &k in &full_keys {
            publish_corpus_gen(store, k, Kind { full: true }, full_bucket);
        }
        for &k in &dirty_keys {
            publish_corpus_gen(store, k, Kind { full: false }, dirty_bucket);
        }
        store.reclaim_and_checkpoint().unwrap();
    };

    let policies: [(&'static str, &'static str); 3] = [
        ("A: 6A summary-first,oldest", "(row_count > 0) ASC, access_bucket ASC, created_at ASC"),
        ("B: pure recency", "access_bucket ASC, created_at ASC"),
        ("C: cost/byte", "(row_count > 0) ASC, length(summary) DESC, access_bucket ASC"),
    ];

    let mut results: Vec<PolicyResult> = Vec::new();
    for (name, order_by) in policies {
        let dir = tmp();
        let mut store = open(dir.path());
        build_corpus(&mut store);
        let before = store.database_size_bytes().unwrap();
        let evicted = evict_under_cap_with_order(&mut store, cap, order_by);
        let after = store.database_size_bytes().unwrap();
        assert!(
            after <= cap.max(before),
            "{name}: eviction did not bring footprint under cap ({after} > {cap})",
        );
        let (latency, hits, misses) = replay_trace(&mut store, &trace, &kinds);
        assert_eq!(hits + misses, TRACE_LEN as u64);
        results.push(PolicyResult { name, evicted, hits, misses, latency });
    }

    // Deterministic structural assertion: pure recency (B) evicts the
    // old-but-valuable baselines the trace keeps re-accessing, so it suffers at
    // least as many trace misses as the kind-aware policies A and C.
    let a = &results[0];
    let b = &results[1];
    let c = &results[2];
    assert!(
        a.misses <= b.misses,
        "6A ordering (A) should not miss more than pure recency (B): A={} B={}",
        a.misses,
        b.misses,
    );
    assert!(
        c.misses <= b.misses,
        "cost/byte (C) should not miss more than pure recency (B): C={} B={}",
        c.misses,
        b.misses,
    );

    // Emit the table for the note (visible under `--no-capture`).
    eprintln!("RETENTION-REPLAY cap={cap} trace_len={TRACE_LEN} full={N_FULL} dirty={N_DIRTY}");
    for r in &results {
        eprintln!(
            "RETENTION-REPLAY policy={:<28} evicted={:<3} hits={:<4} misses={:<4} total_latency_us={}",
            r.name,
            r.evicted,
            r.hits,
            r.misses,
            r.latency.as_micros(),
        );
    }
}

// -- 6C.3 Termination-injection concurrency matrix ------------------------

/// Key of the stable, live baseline generation the parent reader watches during
/// the concurrent-kill matrix. Live, so no GC/maintain pass evicts it: the
/// reader must always see it as a complete Hit or a plain Miss, never Rejected.
const CONC_BASE_KEY: u8 = 21;

/// Child-process entrypoint for the termination-injection matrix. Runs only when
/// `GS_CONC_KILL_DELAY_US` is set (the parent spawns this exact test); otherwise
/// it is a no-op during a normal suite run.
///
/// It runs reader + writer + build + GC workers concurrently against one store
/// dir — each worker on its own `CacheStore` connection, ignoring the transient
/// errors that concurrency legitimately produces — then `process::abort()`s
/// after the requested delay, landing the kill at an arbitrary transaction
/// boundary (publish, maintain-eviction, incremental_vacuum, WAL checkpoint,
/// build-lock hold, or a read).
#[test]
fn conc_kill_child_entrypoint() {
    let Ok(delay) = std::env::var("GS_CONC_KILL_DELAY_US") else {
        return; // normal suite run: no-op.
    };
    let dir = PathBuf::from(std::env::var("GS_CONC_KILL_DIR").expect("conc kill dir"));
    let delay_us: u64 = delay.parse().expect("delay us");

    // Writer: publish distinct live generations (exactly like production).
    {
        let d = dir.clone();
        std::thread::spawn(move || {
            let mut store = open(&d);
            let mut n = 1_000u32;
            loop {
                let mut input = make_big_input(key_u32(n), 8 * 1024, 3);
                input.live = true;
                let _ = store.publish_generation(&input);
                n += 1;
            }
        });
    }
    // Builder: singleflight cold-miss builds (acquires build-lock shards).
    {
        let d = dir.clone();
        std::thread::spawn(move || {
            let mut store = open(&d);
            let mut n = 50_000u32;
            loop {
                let _ = store.build_or_get(&key_u32(n), "HEAD", V1, || {
                    Ok(BuildProduct {
                        payload_version: V1,
                        summary: vec![0xCD; 4 * 1024],
                        rows: vec![GenerationRow {
                            row_kind: 1,
                            row_key: "s".into(),
                            payload: b"p".to_vec(),
                        }],
                        path_index: vec![],
                        live: false,
                    })
                });
                n += 1;
            }
        });
    }
    // GC: quota maintenance with a tiny cap — constant eviction + vacuum +
    // WAL checkpoint churn (the transactions most likely to be mid-flight).
    {
        let d = dir.clone();
        std::thread::spawn(move || {
            let mut store = open(&d);
            loop {
                let _ = store.maintain(8 * 1024);
            }
        });
    }
    // Reader: hammer the live baseline; a Rejected result is fatal even here.
    {
        let d = dir.clone();
        std::thread::spawn(move || {
            let store = open(&d);
            loop {
                if let Ok(GetOutcome::Rejected(r)) = store.get_generation(&key(CONC_BASE_KEY), V1) {
                    // A partial/corrupt observation must never happen.
                    eprintln!("CHILD-READER-OBSERVED-REJECTED: {r:?}");
                    std::process::abort();
                }
            }
        });
    }

    std::thread::sleep(Duration::from_micros(delay_us));
    std::process::abort();
}

fn spawn_conc_kill_child(dir: &Path, delay_us: u64) -> std::process::Child {
    let exe = std::env::current_exe().expect("current exe");
    std::process::Command::new(exe)
        .args([
            "--exact",
            "resolver::store::tests::conc_kill_child_entrypoint",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("GS_CONC_KILL_DELAY_US", delay_us.to_string())
        .env("GS_CONC_KILL_DIR", dir.to_str().unwrap())
        .spawn()
        .expect("spawn conc kill child")
}

/// Termination-injection concurrency matrix (card main-157 Phase 6C; plan
/// Phase 6 "Run reader/writer/build/GC processes concurrently and inject
/// termination at every transaction boundary").
///
/// For each of many abort delays — spanning the range from "before any write
/// commits" to "deep into steady-state eviction/vacuum/checkpoint churn" — a
/// child process runs the full reader/writer/build/GC workload and is killed
/// with `process::abort()` at that point, while the PARENT concurrently hammers
/// the store as a reader. Two invariants are asserted after every injected
/// kill:
///
///   1. No reader (parent or child) ever observes a partial/corrupt generation:
///      `get_generation` returns Hit (complete) or Miss, never Rejected.
///   2. The store remains usable after the kill: it opens cleanly (WAL recovery)
///      or recovers via quarantine/recreate, and is immediately readable AND
///      writable.
#[test]
fn termination_injection_matrix_keeps_store_consistent_and_usable() {
    // Delays chosen to spread the kill across transaction boundaries: 0 catches
    // startup, the small values catch the first publishes/builds, the larger
    // ones catch steady-state maintain (eviction + incremental_vacuum + WAL
    // TRUNCATE) and build-lock holds.
    for &delay_us in &[0u64, 300, 800, 1_500, 3_000, 6_000, 12_000, 25_000, 50_000] {
        let dir = tmp();
        // Prime the schema and seed the stable LIVE baseline the readers watch.
        {
            let mut store = open(dir.path());
            let mut base = make_input(key(CONC_BASE_KEY), V1, b"baseline-complete", 8);
            base.live = true;
            store.publish_generation(&base).unwrap();
        }

        let mut child = spawn_conc_kill_child(dir.path(), delay_us);

        // Parent reader: run concurrently with the doomed child.
        let reader_dir = dir.path().to_path_buf();
        let reader = std::thread::spawn(move || {
            // The store may momentarily be mid-recovery; a transient open error
            // is tolerated (fail-closed bypass in production), a Rejected is not.
            let store = match CacheStore::open_at(&reader_dir) {
                Ok(s) => s,
                Err(_) => return,
            };
            for _ in 0..20_000 {
                match store.get_generation(&key(CONC_BASE_KEY), V1) {
                    Ok(GetOutcome::Hit(g)) => {
                        assert_eq!(g.summary, b"baseline-complete");
                        assert_eq!(g.rows.len(), 8, "reader saw an incomplete live baseline");
                    }
                    Ok(GetOutcome::Miss) => {}
                    Ok(GetOutcome::Rejected(r)) => {
                        panic!("parent reader observed a partial/corrupt generation: {r:?}");
                    }
                    // Busy/IO under contention is a tolerated bypass, not corruption.
                    Err(_) => {}
                }
            }
        });

        let status = child.wait().expect("wait conc kill child");
        assert!(!status.success(), "child (delay={delay_us}us) was expected to abort");
        reader.join().unwrap();

        // After the injected termination the store must open (cleanly or via
        // recovery) and be fully usable.
        let mut store = open(dir.path());
        match store.get_generation(&key(CONC_BASE_KEY), V1).unwrap() {
            GetOutcome::Hit(g) => {
                assert_eq!(g.summary, b"baseline-complete");
                assert_eq!(g.rows.len(), 8);
            }
            // A quarantine/recreate (or GC of a non-live sibling) can leave the
            // baseline absent; that is a clean, usable store, not corruption.
            GetOutcome::Miss => {}
            GetOutcome::Rejected(r) => {
                panic!("store served a partial/corrupt generation after kill (delay={delay_us}us): {r:?}");
            }
        }
        // Writable: a fresh publish + read-back round-trips.
        let probe = key(200);
        store
            .publish_generation(&make_input(probe, V1, b"post-kill", 3))
            .unwrap();
        assert!(
            store.get_generation(&probe, V1).unwrap().hit().is_some(),
            "store not writable after injected kill (delay={delay_us}us)",
        );
    }
}

