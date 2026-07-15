//! Shared per-user store for the executable-digest memo (Round 5 performance
//! work).
//!
//! [`ExeDigestMemo`] is keyed on a file's absolute path plus its full stat
//! identity (see [`ExeStatIdentity`]) — a fact about a file on the local
//! machine, not about any one repository. The Round 2 implementation
//! (`CacheStore::exe_digest_lookup`/`upsert`) nonetheless stored it inside the
//! *per-repo* `<common_dir>/span/store.db`, so every repository on a machine
//! that shares the same filter executable (e.g. a system-wide `git-lfs`
//! install) paid its own independent BLAKE3 hash on a cold run. Mirroring the
//! workspace's `$HOME/.cache/git-span/cargo-target/` pattern for
//! per-user-scoped build artifacts, this module hoists the memo to one shared
//! per-user database instead. Greenfield: this fully replaces the per-repo
//! `exe_digest` table — `store::schema` bumped `SCHEMA_VERSION` so an old
//! per-repo row is never consulted, and `CacheStore` no longer implements
//! `ExeDigestMemo` at all.
//!
//! ## Database location (precedence)
//!
//! 1. `GIT_SPAN_EXE_DIGEST_DB` — an explicit full path to the database file
//!    (CI isolation / tests).
//! 2. `GIT_SPAN_CACHE_HOME` — a base directory; the database lives at
//!    `<dir>/exe-digest.db`.
//! 3. Default: `$HOME/.cache/git-span/exe-digest.db`.
//!
//! ## `GIT_SPAN_CACHE=0`
//!
//! Bypassed exactly like every other cache tier: the only two call sites that
//! construct a [`SharedExeDigestMemo`] (`resolver::exact::stale_spans_new_store`'s
//! initial state-token capture and its pre-publish revalidate) live entirely
//! behind that entry point's `cache_disabled()` guard, so a disabled run never
//! reads or writes this database.
//!
//! ## Fail-closed
//!
//! Any failure to resolve `$HOME`, create the directory, open the connection,
//! or run a query is swallowed and reported as "no memo" / "not recorded" —
//! `capture::filters()` re-hashes directly rather than trusting (or failing
//! the command over) a broken shared store. This mirrors the posture
//! [`ExeDigestMemo`]'s own doc comment specifies for the trait in general.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};

use super::exe_digest::{ExeDigestMemo, ExeStatIdentity};

/// Database basename under the resolved base directory.
const DB_BASENAME: &str = "exe-digest.db";
/// Busy timeout for concurrent OS processes contending on this shared
/// per-user database (mirrors `store::schema::DEFAULT_BUSY_TIMEOUT_MS`).
const BUSY_TIMEOUT_MS: u64 = 1_000;

/// Resolve the database path from the environment. See the module docs for
/// precedence. `None` when no base can be determined (no explicit path, no
/// `GIT_SPAN_CACHE_HOME`, and `$HOME` unset/empty) — the caller falls back to
/// hashing directly.
fn db_path() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("GIT_SPAN_EXE_DIGEST_DB")
        && !explicit.is_empty()
    {
        return Some(PathBuf::from(explicit));
    }
    if let Ok(home) = std::env::var("GIT_SPAN_CACHE_HOME")
        && !home.is_empty()
    {
        return Some(PathBuf::from(home).join(DB_BASENAME));
    }
    let home = std::env::var_os("HOME")?;
    if home.is_empty() {
        return None;
    }
    Some(
        PathBuf::from(home)
            .join(".cache")
            .join("git-span")
            .join(DB_BASENAME),
    )
}

/// One connection to the shared per-user executable-digest database.
struct SharedExeDigestStore {
    conn: Connection,
}

impl SharedExeDigestStore {
    /// Resolve the database path from the environment and open it (see
    /// [`db_path`] for precedence). `None` on any failure.
    fn open() -> Option<Self> {
        Self::open_at(&db_path()?)
    }

    /// Open (creating the parent directory and file as needed) and ensure
    /// the schema exists. `None` on any failure — the caller falls back to
    /// hashing directly.
    fn open_at(path: &Path) -> Option<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }
        let conn = Connection::open(path).ok()?;
        // First pragma, before any other — mirrors `store::schema`'s WAL
        // ordering rationale: an unset busy timeout on a contended WAL switch
        // surfaces as a spurious lock error instead of a bounded wait.
        conn.busy_timeout(Duration::from_millis(BUSY_TIMEOUT_MS))
            .ok()?;
        conn.pragma_update(None, "journal_mode", "WAL").ok()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS exe_digest (
               path     TEXT PRIMARY KEY,
               size     INTEGER NOT NULL,
               mtime_s  INTEGER NOT NULL,
               mtime_ns INTEGER NOT NULL,
               ctime_s  INTEGER NOT NULL,
               ctime_ns INTEGER NOT NULL,
               ino      INTEGER NOT NULL,
               dev      INTEGER NOT NULL,
               digest   BLOB NOT NULL
             ) STRICT;",
        )
        .ok()?;
        Some(Self { conn })
    }

    /// Same trust model as the Round 2 per-repo memo: every stat field must
    /// match exactly for a row to be served.
    fn lookup(&self, path: &Path, stat: &ExeStatIdentity) -> Option<[u8; 32]> {
        type Row = (i64, i64, i64, i64, i64, i64, i64, Vec<u8>);
        let path_key = path.to_string_lossy().into_owned();
        let row: Option<Row> = self
            .conn
            .query_row(
                "SELECT size, mtime_s, mtime_ns, ctime_s, ctime_ns, ino, dev, digest \
                 FROM exe_digest WHERE path = ?1",
                [&path_key],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .optional()
            .ok()?;
        let (size, mtime_s, mtime_ns, ctime_s, ctime_ns, ino, dev, digest) = row?;
        let matches = size as u64 == stat.size
            && mtime_s == stat.mtime_s
            && mtime_ns == stat.mtime_ns
            && ctime_s == stat.ctime_s
            && ctime_ns == stat.ctime_ns
            && ino as u64 == stat.ino
            && dev as u64 == stat.dev;
        if !matches || digest.len() != 32 {
            return None;
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&digest);
        Some(out)
    }

    fn upsert(&self, path: &Path, stat: &ExeStatIdentity, digest: [u8; 32]) {
        let path_key = path.to_string_lossy().into_owned();
        let _ = self.conn.execute(
            "INSERT INTO exe_digest \
             (path, size, mtime_s, mtime_ns, ctime_s, ctime_ns, ino, dev, digest) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(path) DO UPDATE SET \
               size = excluded.size, \
               mtime_s = excluded.mtime_s, \
               mtime_ns = excluded.mtime_ns, \
               ctime_s = excluded.ctime_s, \
               ctime_ns = excluded.ctime_ns, \
               ino = excluded.ino, \
               dev = excluded.dev, \
               digest = excluded.digest",
            params![
                &path_key,
                stat.size as i64,
                stat.mtime_s,
                stat.mtime_ns,
                stat.ctime_s,
                stat.ctime_ns,
                stat.ino as i64,
                stat.dev as i64,
                &digest[..],
            ],
        );
    }
}

/// Process-wide handle: opened lazily on first use and cached for the rest of
/// the process's lifetime (a `git span` invocation is a fresh process, so
/// there is no cross-invocation staleness to reason about). `None` means
/// "failed to open" — cached too, so a broken environment doesn't retry the
/// open on every call within one run.
static SHARED: OnceLock<Mutex<Option<SharedExeDigestStore>>> = OnceLock::new();

/// Run `f` against the shared store if one is open. A poisoned lock (another
/// thread panicked while holding it) or a failed open both fail closed to
/// `None` — never a panic or a wrong digest.
fn with_shared_store<T>(f: impl FnOnce(&SharedExeDigestStore) -> T) -> Option<T> {
    let cell = SHARED.get_or_init(|| Mutex::new(SharedExeDigestStore::open()));
    let guard = cell.lock().ok()?;
    guard.as_ref().map(f)
}

/// [`ExeDigestMemo`] backed by the process-wide shared per-user store. A unit
/// struct — the actual connection lives behind [`SHARED`], guarded by a
/// `Mutex` — so it is sound to construct at more than one call site (the
/// initial state-token capture and the pre-publish revalidate both use one)
/// even under concurrent access.
pub(crate) struct SharedExeDigestMemo;

impl ExeDigestMemo for SharedExeDigestMemo {
    fn lookup(&mut self, path: &Path, stat: &ExeStatIdentity) -> Option<[u8; 32]> {
        with_shared_store(|s| s.lookup(path, stat)).flatten()
    }

    fn upsert(&mut self, path: &Path, stat: &ExeStatIdentity, digest: [u8; 32]) {
        with_shared_store(|s| s.upsert(path, stat, digest));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exe_stat(size: u64, mtime_s: i64) -> ExeStatIdentity {
        ExeStatIdentity {
            size,
            mtime_s,
            mtime_ns: 0,
            ctime_s: mtime_s,
            ctime_ns: 0,
            ino: 1,
            dev: 1,
        }
    }

    /// A digest memoized under one stat identity is returned as-is when
    /// looked up again under the *same* stat identity.
    #[test]
    fn round_trips_when_stat_unchanged() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SharedExeDigestStore::open_at(&dir.path().join(DB_BASENAME))
            .expect("open shared store");
        let path = Path::new("/opt/git-lfs/git-lfs");
        let stat = exe_stat(11 * 1024 * 1024, 1_700_000_000);
        let digest = [7u8; 32];

        assert_eq!(store.lookup(path, &stat), None, "empty memo is a miss");
        store.upsert(path, &stat, digest);
        assert_eq!(
            store.lookup(path, &stat),
            Some(digest),
            "unchanged stat identity must serve the memoized digest"
        );
    }

    /// Any stat field changing (mtime, in this case) invalidates the
    /// memoized row: a lookup under the new stat is a miss, not a stale hit.
    #[test]
    fn invalidated_when_mtime_changes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SharedExeDigestStore::open_at(&dir.path().join(DB_BASENAME))
            .expect("open shared store");
        let path = Path::new("/opt/git-lfs/git-lfs");
        let original_stat = exe_stat(11 * 1024 * 1024, 1_700_000_000);
        let digest = [7u8; 32];
        store.upsert(path, &original_stat, digest);

        let touched_stat = exe_stat(11 * 1024 * 1024, 1_700_000_500);
        assert_eq!(
            store.lookup(path, &touched_stat),
            None,
            "a changed mtime must miss even though every other stat field matches"
        );

        let new_digest = [9u8; 32];
        store.upsert(path, &touched_stat, new_digest);
        assert_eq!(store.lookup(path, &touched_stat), Some(new_digest));
        assert_eq!(
            store.lookup(path, &original_stat),
            None,
            "the row is now keyed on the new stat; the stale stat no longer matches"
        );
    }

    /// A parent path that is itself a regular file can never become a
    /// directory (`create_dir_all` fails with `ENOTDIR` regardless of
    /// permissions, even running as root) — a reliable, environment-
    /// independent way to force an unwritable-location failure.
    #[test]
    fn open_at_fails_closed_when_parent_is_unwritable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blocker = dir.path().join("not-a-directory");
        std::fs::write(&blocker, b"x").expect("write blocker file");
        let db_path = blocker.join("nested").join(DB_BASENAME);

        assert!(
            SharedExeDigestStore::open_at(&db_path).is_none(),
            "open_at must fail closed (None) rather than panic or error out"
        );
    }

    /// `SharedExeDigestMemo::lookup`/`upsert` fail closed to "no memo" when
    /// no store could be opened, rather than panicking.
    #[test]
    fn memo_fails_closed_without_panicking_when_store_unavailable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blocker = dir.path().join("not-a-directory");
        std::fs::write(&blocker, b"x").expect("write blocker file");
        unsafe {
            std::env::set_var(
                "GIT_SPAN_EXE_DIGEST_DB",
                blocker.join("nested").join(DB_BASENAME),
            );
        }
        let mut memo = SharedExeDigestMemo;
        let stat = exe_stat(1024, 1_700_000_000);
        assert_eq!(memo.lookup(Path::new("/bin/true"), &stat), None);
        // Must not panic.
        memo.upsert(Path::new("/bin/true"), &stat, [1u8; 32]);
        assert_eq!(memo.lookup(Path::new("/bin/true"), &stat), None);
    }

    /// `GIT_SPAN_EXE_DIGEST_DB` takes precedence over `GIT_SPAN_CACHE_HOME`,
    /// which in turn takes precedence over the `$HOME`-derived default.
    #[test]
    fn db_path_precedence() {
        let explicit_dir = tempfile::tempdir().expect("tempdir");
        let explicit = explicit_dir.path().join("explicit.db");
        let cache_home_dir = tempfile::tempdir().expect("tempdir");

        unsafe {
            std::env::set_var("GIT_SPAN_EXE_DIGEST_DB", &explicit);
            std::env::set_var("GIT_SPAN_CACHE_HOME", cache_home_dir.path());
        }
        assert_eq!(db_path().as_deref(), Some(explicit.as_path()));

        unsafe {
            std::env::remove_var("GIT_SPAN_EXE_DIGEST_DB");
        }
        assert_eq!(
            db_path().as_deref(),
            Some(cache_home_dir.path().join(DB_BASENAME)).as_deref()
        );

        unsafe {
            std::env::remove_var("GIT_SPAN_CACHE_HOME");
        }
        // Default falls back to `$HOME/.cache/git-span/exe-digest.db` — only
        // assert the shape, since `$HOME` is environment-dependent.
        let default = db_path().expect("HOME is set in the test environment");
        assert!(default.ends_with(".cache/git-span/exe-digest.db"));
    }

    /// End-to-end through the process-wide [`SharedExeDigestMemo`] singleton
    /// (not the direct `SharedExeDigestStore` the other tests use), proving
    /// the `OnceLock`/`Mutex` wiring round-trips a digest exactly like the
    /// direct store does.
    #[test]
    fn shared_memo_round_trips_through_the_singleton() {
        let dir = tempfile::tempdir().expect("tempdir");
        unsafe {
            std::env::set_var("GIT_SPAN_EXE_DIGEST_DB", dir.path().join(DB_BASENAME));
        }
        let mut memo = SharedExeDigestMemo;
        let path = Path::new("/usr/bin/git-lfs");
        let stat = exe_stat(11 * 1024 * 1024, 1_700_000_000);
        let digest = [42u8; 32];

        assert_eq!(memo.lookup(path, &stat), None);
        memo.upsert(path, &stat, digest);
        assert_eq!(memo.lookup(path, &stat), Some(digest));
    }
}
