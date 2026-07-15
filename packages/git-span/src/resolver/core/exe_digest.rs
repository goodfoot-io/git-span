//! Trait seam for a persistent, stat-keyed memo of executable content digests
//! (card main-157 Round 2 performance work).
//!
//! [`super::capture::filters`] proves a `filter.<driver>`'s executable
//! identity by mmap+BLAKE3-hashing its resolved program file on every
//! invocation (see that module's docs). For a large filter binary — a
//! standard git-lfs install is ~11 MiB — that hash is the dominant cost of an
//! otherwise-warm `git span stale` run, and it is paid *twice* on a cold
//! build: once for the initial capture, once again for the pre-publish
//! [`super::capture::revalidate`] re-read.
//!
//! This module defines a narrow trait a store can implement to memoize that
//! digest keyed on stat identity, so a repeat call for an unchanged file skips
//! the mmap+hash entirely. `capture.rs` depends only on this trait (and the
//! plain [`ExeStatIdentity`] struct) — never on `resolver::store` — so the
//! layering stays one-directional: `store` depends on `core`, never the
//! reverse. `None` at a call site (no store handle available, or
//! `GIT_SPAN_CACHE=0`, which never reaches capture with a memo at all) simply
//! means "always hash directly"; this seam is pure optimization and never
//! changes what digest is produced, only how often it is recomputed.
//!
//! ## Trust model
//!
//! A memoized digest is reused only when a file's *entire* stat identity —
//! size, mtime, ctime, inode, device — matches exactly what was recorded
//! alongside it. This is the same trust git's own index places in stat
//! identity to skip re-hashing unchanged worktree files: a file whose content
//! changed without moving any of those fields (a deliberate mtime/ctime
//! forgery back to the recorded values) would serve a stale digest. That is
//! an accepted trade shared with git itself, not a new risk this memo
//! introduces.

use std::path::Path;

/// Stat identity a memoized digest is keyed on. Every field must match
/// exactly for a memo row to be trusted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ExeStatIdentity {
    pub(crate) size: u64,
    pub(crate) mtime_s: i64,
    pub(crate) mtime_ns: i64,
    pub(crate) ctime_s: i64,
    pub(crate) ctime_ns: i64,
    pub(crate) ino: u64,
    pub(crate) dev: u64,
}

impl ExeStatIdentity {
    /// Read the stat identity of `path`'s current metadata. `None` when the
    /// path cannot be stat'd (the caller falls back to hashing directly,
    /// which will itself fail closed to `None` if the file cannot be read
    /// either).
    #[cfg(unix)]
    pub(crate) fn read(path: &Path) -> Option<Self> {
        use std::os::unix::fs::MetadataExt;
        let md = std::fs::metadata(path).ok()?;
        Some(Self {
            size: md.size(),
            mtime_s: md.mtime(),
            mtime_ns: md.mtime_nsec(),
            ctime_s: md.ctime(),
            ctime_ns: md.ctime_nsec(),
            ino: md.ino(),
            dev: md.dev(),
        })
    }

    /// Non-Unix platforms have no `std`-exposed inode/device/nanosecond-
    /// precision triple to key on; fail closed to "no memo" rather than
    /// approximate the identity.
    #[cfg(not(unix))]
    pub(crate) fn read(path: &Path) -> Option<Self> {
        let _ = path;
        None
    }
}

/// A store-backed memo of executable content digests, keyed on
/// [`ExeStatIdentity`]. Implemented by [`crate::resolver::store::CacheStore`];
/// `capture.rs` sees only this trait.
pub(crate) trait ExeDigestMemo {
    /// The memoized digest for `path`, if a row exists whose stat identity
    /// matches `stat` exactly. Any lookup fault is swallowed and reported as
    /// `None` (fail closed: the caller re-hashes directly) — a digest-memo
    /// failure must never fail the command or change its output.
    fn lookup(&mut self, path: &Path, stat: &ExeStatIdentity) -> Option<[u8; 32]>;

    /// Record a freshly computed digest for `path` at `stat`. Any store fault
    /// is swallowed (fail closed: caching is best-effort, never load-bearing).
    fn upsert(&mut self, path: &Path, stat: &ExeStatIdentity, digest: [u8; 32]);
}
