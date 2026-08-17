//! Per-user SQLite store for update-check state.
//!
//! Lives in its own per-user `update-check.db` (same directory as the
//! exe-digest cache), never the per-repo `store.db` — last-checked,
//! last-reminded, and findings are per-user facts, and per-repo state would
//! degrade "at most once per 24 hours" to once per repo per day. Path
//! precedence mirrors `exe_digest_store`: `GIT_SPAN_UPDATE_CHECK_DB` >
//! `GIT_SPAN_CACHE_HOME` > `$HOME/.cache/git-span` (> `%USERPROFILE%` on
//! Windows); no base → permanently disabled (no spawn, no note). Fail-closed:
//! every operation returns `None` on any failure.
//!
//! Schema (STRICT, `CREATE TABLE IF NOT EXISTS` only — no migrations):
//!
//! ```sql
//! CREATE TABLE IF NOT EXISTS update_check (
//!   id INTEGER PRIMARY KEY CHECK (id = 1),
//!   last_checked_at INTEGER NOT NULL,
//!   last_reminded_at INTEGER NOT NULL
//! ) STRICT;
//! CREATE TABLE IF NOT EXISTS update_check_findings (
//!   tool TEXT PRIMARY KEY,
//!   observed_version TEXT NOT NULL
//! ) STRICT;
//! ```
//!
//! One findings row per tool keeps "a third tool is a new implementation"
//! true at the schema level too — no column churn. Writes: the child claims
//! the check slot before fetching (stamps `last_checked_at` alone,
//! preserving findings and the reminder stamp), then stamps `last_checked_at`
//! plus findings (success only); the foreground claims the print slot
//! (`last_reminded_at`). Concurrent opens are safe by WAL + a 1s busy
//! timeout.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use semver::Version;

/// Database basename under the resolved base directory.
const DB_BASENAME: &str = "update-check.db";
/// Busy timeout for concurrent OS processes contending on the shared
/// per-user database (mirrors the exe-digest store).
const BUSY_TIMEOUT_MS: u64 = 1_000;

/// The persisted state: both cadence stamps plus the per-tool findings
/// (`cli` | `claude` | `codex` → observed version).
pub struct UpdateCheckState {
    pub last_checked_at: i64,
    pub last_reminded_at: i64,
    pub findings: BTreeMap<String, Version>,
}

/// Resolve the database path from the environment. `None` when no base can
/// be determined (no explicit path, no `GIT_SPAN_CACHE_HOME`, and
/// `$HOME` / `%USERPROFILE%` unset or empty) — the feature is then
/// permanently disabled.
///
/// `pub` for the orchestrator, which derives the child's log path
/// (`update-check.log`) from the same resolved base.
pub fn db_path() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("GIT_SPAN_UPDATE_CHECK_DB")
        && !explicit.is_empty()
    {
        return Some(PathBuf::from(explicit));
    }
    if let Ok(home) = std::env::var("GIT_SPAN_CACHE_HOME")
        && !home.is_empty()
    {
        return Some(PathBuf::from(home).join(DB_BASENAME));
    }
    let home = std::env::var_os("HOME");
    #[cfg(windows)]
    let home = home.or_else(|| std::env::var_os("USERPROFILE"));
    let home = home?;
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

/// One connection to the per-user update-check database.
pub struct UpdateCheckStore {
    conn: Connection,
}

impl UpdateCheckStore {
    /// Open the database at the environment-resolved path (see [`db_path`]
    /// for precedence). `None` on any failure — the feature silently skips.
    pub fn open() -> Option<Self> {
        Self::open_at(&db_path()?)
    }

    /// Open (creating the parent directory and file as needed) and ensure
    /// the schema exists, exe-digest bootstrap shape: busy timeout first,
    /// then WAL, then `CREATE TABLE IF NOT EXISTS … STRICT`. `None` on any
    /// failure.
    pub fn open_at(path: &Path) -> Option<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }
        let conn = Connection::open(path).ok()?;
        // Busy timeout first, before any other pragma — mirrors the
        // exe-digest store's ordering rationale: an unset busy timeout on a
        // contended WAL switch surfaces as a spurious lock error instead of
        // a bounded wait. rusqlite opens lazily, so the journal-mode pragma
        // (the first statement that touches the file) is also what makes a
        // corrupt database fail here, at bootstrap, rather than at first
        // read.
        conn.busy_timeout(Duration::from_millis(BUSY_TIMEOUT_MS))
            .ok()?;
        conn.pragma_update(None, "journal_mode", "WAL").ok()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS update_check (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               last_checked_at INTEGER NOT NULL,
               last_reminded_at INTEGER NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS update_check_findings (
               tool TEXT PRIMARY KEY,
               observed_version TEXT NOT NULL
             ) STRICT;",
        )
        .ok()?;
        Some(Self { conn })
    }

    /// The persisted state, or `None` when no row has been written yet or
    /// the read fails.
    pub fn read_state(&self) -> Option<UpdateCheckState> {
        type StampRow = (i64, i64);
        let row: Option<StampRow> = self
            .conn
            .query_row(
                "SELECT last_checked_at, last_reminded_at FROM update_check WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()?;
        let (last_checked_at, last_reminded_at) = row?;

        let mut stmt = self
            .conn
            .prepare("SELECT tool, observed_version FROM update_check_findings")
            .ok()?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .ok()?;
        let mut findings = BTreeMap::new();
        for row in rows {
            let (tool, version) = row.ok()?;
            // A stored version that no longer parses as semver fails the
            // whole read closed — a partial or wrong finding is worse than
            // none, and the missing state simply re-triggers the next check.
            findings.insert(tool, Version::parse(&version).ok()?);
        }
        Some(UpdateCheckState {
            last_checked_at,
            last_reminded_at,
            findings,
        })
    }

    /// Stamp `last_checked_at` (unconditionally) and replace the findings
    /// rows. The child calls this on success with the fetched findings and
    /// on fetch failure with an empty map — one failed attempt per day,
    /// never per invocation.
    pub fn write_checked(&self, now: i64, findings: &BTreeMap<String, Version>) -> Option<()> {
        // `&self`-compatible transaction: `Transaction::new_unchecked` is the
        // documented escape hatch for `Connection::transaction`'s `&mut`
        // requirement (which this fail-closed API cannot offer). A dropped
        // transaction rolls back, so any mid-way failure leaves the previous
        // state intact.
        let tx = Transaction::new_unchecked(&self.conn, TransactionBehavior::Deferred).ok()?;
        tx.execute(
            "INSERT INTO update_check (id, last_checked_at, last_reminded_at) \
             VALUES (1, ?1, 0) \
             ON CONFLICT(id) DO UPDATE SET last_checked_at = excluded.last_checked_at",
            [now],
        )
        .ok()?;
        tx.execute("DELETE FROM update_check_findings", []).ok()?;
        for (tool, version) in findings {
            tx.execute(
                "INSERT INTO update_check_findings (tool, observed_version) VALUES (?1, ?2)",
                [tool.as_str(), &version.to_string()],
            )
            .ok()?;
        }
        tx.commit().ok()
    }

    /// Stamp `last_checked_at` alone — the child's pre-fetch claim.
    /// Findings and `last_reminded_at` are untouched (the `ON CONFLICT`
    /// updates `last_checked_at` only, and no findings rows are written), so
    /// a claim can never destroy a stored finding or reset a reminder stamp.
    pub fn stamp_checked(&self, now: i64) -> Option<()> {
        self.conn
            .execute(
                "INSERT INTO update_check (id, last_checked_at, last_reminded_at) \
                 VALUES (1, ?1, 0) \
                 ON CONFLICT(id) DO UPDATE SET last_checked_at = excluded.last_checked_at",
                [now],
            )
            .ok()?;
        Some(())
    }

    /// Atomically claim the reminder print slot: set `last_reminded_at` to
    /// `now` only when it still equals `expected` — the value the reminder
    /// decision was computed from. Returns `Some(true)` when this caller won
    /// the claim (and must print) and `Some(false)` when a concurrent TTY
    /// run claimed first (print nothing). The single conditional `UPDATE` is
    /// atomic in SQLite, so exactly one of the racers sees a changed row —
    /// this is what actually closes the two-concurrent-TTY double-print
    /// window; a print-then-stamp order leaves it open between the read and
    /// the stamp. The row exists whenever a reminder can fire (the decision
    /// requires stored findings, which `write_checked` wrote alongside the
    /// row), so an `UPDATE` suffices — no `INSERT … ON CONFLICT` fallback.
    pub fn claim_reminded(&self, expected: i64, now: i64) -> Option<bool> {
        let changed = self
            .conn
            .execute(
                "UPDATE update_check SET last_reminded_at = ?1 \
                 WHERE id = 1 AND last_reminded_at = ?2",
                [now, expected],
            )
            .ok()?;
        Some(changed == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes the env-mutating cases in this module: `set_var` /
    /// `remove_var` mutate process-global state, and the test harness runs
    /// cases in parallel — two cases racing on the same variables would
    /// flake nondeterministically. Env-touching cases take this lock.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn findings(tools: &[(&str, &str)]) -> BTreeMap<String, Version> {
        tools
            .iter()
            .map(|(tool, version)| (tool.to_string(), Version::parse(version).unwrap()))
            .collect()
    }

    #[test]
    fn checked_and_reminded_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        assert!(store.read_state().is_none(), "fresh store has no state");

        let _ = store.write_checked(1_700_000_000, &findings(&[("cli", "1.1.4")]));
        let claimed = store.claim_reminded(0, 1_700_000_100).expect("claim");
        assert!(claimed, "the first claim against a fresh row must win");

        let state = store.read_state().expect("state after writes");
        assert_eq!(state.last_checked_at, 1_700_000_000);
        assert_eq!(state.last_reminded_at, 1_700_000_100);
        assert_eq!(state.findings.get("cli"), Some(&Version::new(1, 1, 4)));
    }

    #[test]
    fn concurrent_reminder_claim_only_one_wins() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        let _ = store.write_checked(1_700_000_000, &findings(&[("cli", "1.1.4")]));

        // Two foregrounds read the same state (last_reminded_at = 0) and
        // race to claim the print slot. Exactly one wins; the loser must not
        // print.
        let first = store.claim_reminded(0, 1_700_000_100).expect("claim");
        let second = store.claim_reminded(0, 1_700_000_101).expect("claim");
        assert!(first, "one racer wins");
        assert!(!second, "the second racer must lose against the same expected value");

        let state = store.read_state().expect("state");
        assert_eq!(state.last_reminded_at, 1_700_000_100, "the winner's stamp holds");
    }

    #[test]
    fn stamp_checked_creates_the_row_on_a_fresh_store() {
        // The fresh-install burst: the first child claims the check slot
        // BEFORE fetching, so invocations that arrive while the fetch is in
        // flight see a same-day stamp and spawn nothing further.
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        assert!(store.read_state().is_none(), "fresh store has no state");

        let _ = store.stamp_checked(1_700_000_000).expect("stamp");
        let state = store.read_state().expect("state");
        assert_eq!(state.last_checked_at, 1_700_000_000);
        assert_eq!(state.last_reminded_at, 0);
        assert!(state.findings.is_empty());
    }

    #[test]
    fn stamp_checked_preserves_findings_and_reminder() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        let _ = store.write_checked(1_700_000_000, &findings(&[("cli", "1.1.4")]));
        let _ = store.claim_reminded(0, 1_700_000_100);

        let _ = store.stamp_checked(1_700_000_200).expect("stamp");
        let state = store.read_state().expect("state");
        assert_eq!(state.last_checked_at, 1_700_000_200, "the claim refreshes the check");
        assert_eq!(
            state.last_reminded_at, 1_700_000_100,
            "the reminder stamp survives the pre-fetch claim"
        );
        assert_eq!(
            state.findings.get("cli"),
            Some(&Version::new(1, 1, 4)),
            "stored findings survive the pre-fetch claim"
        );
    }

    #[test]
    fn absent_store_has_no_state() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        assert!(store.read_state().is_none());
    }

    #[test]
    fn corrupt_database_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join(DB_BASENAME);
        std::fs::write(&db, b"this is not a sqlite database").unwrap();
        assert!(
            UpdateCheckStore::open_at(&db).is_none(),
            "a corrupt database must fail closed (None), not panic or error"
        );
    }

    #[test]
    fn unwritable_parent_fails_closed() {
        // A parent path that is itself a regular file can never become a
        // directory — a reliable, environment-independent unwritable
        // location.
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-directory");
        std::fs::write(&blocker, b"x").unwrap();
        assert!(
            UpdateCheckStore::open_at(&blocker.join("nested").join(DB_BASENAME)).is_none(),
            "an unwritable parent must fail closed (None), not panic"
        );
    }

    #[test]
    fn no_home_disables() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var("GIT_SPAN_UPDATE_CHECK_DB");
            std::env::remove_var("GIT_SPAN_CACHE_HOME");
            std::env::remove_var("HOME");
            #[cfg(windows)]
            std::env::remove_var("USERPROFILE");
        }
        assert_eq!(
            db_path(),
            None,
            "no resolvable base directory must disable the check"
        );
    }

    #[test]
    fn db_path_precedence() {
        let _guard = ENV_LOCK.lock().unwrap();
        let explicit_dir = tempfile::tempdir().unwrap();
        let explicit = explicit_dir.path().join("explicit.db");
        let cache_home_dir = tempfile::tempdir().unwrap();

        unsafe {
            std::env::set_var("GIT_SPAN_UPDATE_CHECK_DB", &explicit);
            std::env::set_var("GIT_SPAN_CACHE_HOME", cache_home_dir.path());
            std::env::set_var("HOME", explicit_dir.path());
        }
        assert_eq!(db_path().as_deref(), Some(explicit.as_path()));

        unsafe {
            std::env::remove_var("GIT_SPAN_UPDATE_CHECK_DB");
        }
        assert_eq!(
            db_path().as_deref(),
            Some(cache_home_dir.path().join(DB_BASENAME)).as_deref()
        );

        unsafe {
            std::env::remove_var("GIT_SPAN_CACHE_HOME");
        }
        // Default falls back to `$HOME/.cache/git-span/update-check.db` —
        // only assert the shape, since the test sets HOME explicitly above.
        let default = db_path().expect("HOME is set in this test");
        assert!(default.ends_with(".cache/git-span/update-check.db"));
    }
}
