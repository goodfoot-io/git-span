//! Structured bypass reasons for the SQLite store (card main-157 Phase 2).
//!
//! Fail-closed applies to cache *trust*, not to the availability of an
//! optional optimization (`notes/correctness-contract.md` "Fail-Closed
//! Meaning"). Every failure the store can hit — a read-only directory, a full
//! disk, a busy timeout, a corrupt file, an incompatible schema — is mapped to
//! a typed [`BypassReason`] the caller can record in diagnostics and then run
//! the authoritative resolver. A write error prevents publication; it never
//! replaces or suppresses the authoritative result, and it never crashes.

use rusqlite::ErrorCode;

/// Why the store could not serve or accept a value. Structured so the caller
/// (and `doctor`/perf diagnostics in a later phase) can attribute a bypass
/// without string-sniffing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BypassReason {
    /// The cache directory or database file is not writable.
    ReadOnly,
    /// The write could not be persisted because storage is full
    /// (`SQLITE_FULL`, including a `max_page_count` ceiling).
    DiskFull,
    /// A lock could not be acquired within the busy timeout
    /// (`SQLITE_BUSY`/`SQLITE_LOCKED`).
    BusyTimeout,
    /// The database is corrupt or not a SQLite database
    /// (`SQLITE_CORRUPT`/`SQLITE_NOTADB`).
    Corrupt,
    /// The database is on an incompatible schema version or semantic epoch.
    SchemaMismatch,
    /// A build-lock shard could not be acquired.
    LockContended,
    /// Any other I/O or SQLite failure.
    Io,
}

/// A store operation that failed closed. The authoritative path proceeds; this
/// is a bypass, never a hard error the caller must abort on.
#[derive(Clone, Debug)]
pub(crate) struct StoreError {
    pub(crate) reason: BypassReason,
    pub(crate) detail: String,
}

impl StoreError {
    pub(crate) fn new(reason: BypassReason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: detail.into(),
        }
    }

    /// The structured reason, for diagnostics.
    pub(crate) fn reason(&self) -> BypassReason {
        self.reason
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "store bypass ({:?}): {}", self.reason, self.detail)
    }
}

impl std::error::Error for StoreError {}

/// Map a `rusqlite::Error` to a typed [`StoreError`]. Unknown failures fall
/// through to [`BypassReason::Io`] so nothing is silently trusted.
pub(crate) fn map_sqlite(e: rusqlite::Error) -> StoreError {
    let detail = e.to_string();
    let reason = match e.sqlite_error() {
        Some(err) => match err.code {
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => BypassReason::BusyTimeout,
            ErrorCode::DiskFull => BypassReason::DiskFull,
            ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => BypassReason::Corrupt,
            ErrorCode::ReadOnly => BypassReason::ReadOnly,
            _ => BypassReason::Io,
        },
        None => BypassReason::Io,
    };
    StoreError { reason, detail }
}

/// Map a filesystem I/O error hit during open/quarantine to a typed reason:
/// permission failures are [`BypassReason::ReadOnly`], everything else is
/// [`BypassReason::Io`].
pub(crate) fn map_io(e: std::io::Error, context: &str) -> StoreError {
    let reason = match e.kind() {
        std::io::ErrorKind::PermissionDenied => BypassReason::ReadOnly,
        _ => BypassReason::Io,
    };
    StoreError {
        reason,
        detail: format!("{context}: {e}"),
    }
}
