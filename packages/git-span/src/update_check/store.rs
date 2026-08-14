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
//! true at the schema level too — no column churn. Writes: the child stamps
//! `last_checked_at` (always) plus findings (success only); the foreground
//! stamps `last_reminded_at`. Concurrent opens are safe by WAL + a 1s busy
//! timeout.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
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
fn db_path() -> Option<PathBuf> {
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
        let _ = (path, BUSY_TIMEOUT_MS);
        None
    }

    /// The persisted state, or `None` when no row has been written yet or
    /// the read fails.
    pub fn read_state(&self) -> Option<UpdateCheckState> {
        let _ = &self.conn;
        None
    }

    /// Stamp `last_checked_at` (unconditionally) and replace the findings
    /// rows. The child calls this on success with the fetched findings and
    /// on fetch failure with an empty map — one failed attempt per day,
    /// never per invocation.
    pub fn write_checked(&self, now: i64, findings: &BTreeMap<String, Version>) -> Option<()> {
        let _ = (&self.conn, now, findings);
        None
    }

    /// Stamp `last_reminded_at`. Called by the foreground immediately after
    /// printing the note.
    pub fn write_reminded(&self, now: i64) -> Option<()> {
        let _ = (&self.conn, now);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(tools: &[(&str, &str)]) -> BTreeMap<String, Version> {
        tools
            .iter()
            .map(|(tool, version)| (tool.to_string(), Version::parse(version).unwrap()))
            .collect()
    }

    #[test]
    #[ignore = "Phase 3: store not implemented"]
    fn checked_and_reminded_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        assert!(store.read_state().is_none(), "fresh store has no state");

        let _ = store.write_checked(1_700_000_000, &findings(&[("cli", "1.1.4")]));
        let _ = store.write_reminded(1_700_000_100);

        let state = store.read_state().expect("state after writes");
        assert_eq!(state.last_checked_at, 1_700_000_000);
        assert_eq!(state.last_reminded_at, 1_700_000_100);
        assert_eq!(state.findings.get("cli"), Some(&Version::new(1, 1, 4)));
    }

    #[test]
    #[ignore = "Phase 3: store not implemented"]
    fn absent_store_has_no_state() {
        let dir = tempfile::tempdir().unwrap();
        let store = UpdateCheckStore::open_at(&dir.path().join(DB_BASENAME)).expect("open");
        assert!(store.read_state().is_none());
    }

    #[test]
    #[ignore = "Phase 3: store not implemented"]
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
    #[ignore = "Phase 3: store not implemented"]
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
    #[ignore = "Phase 3: store not implemented"]
    fn no_home_disables() {
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
    #[ignore = "Phase 3: store not implemented"]
    fn db_path_precedence() {
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
