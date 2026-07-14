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
use std::path::Path;
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
