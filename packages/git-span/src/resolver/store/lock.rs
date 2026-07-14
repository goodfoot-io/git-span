//! `fs4` file locks for the SQLite store (card main-157 Phase 2).
//!
//! Two lock roles, both advisory `flock(2)` locks via `fs4`:
//!
//! * **Init lock** — a single exclusive lock guarding schema/WAL
//!   initialization and quarantine/recreate, so concurrent first-openers do
//!   not race on DDL (`notes/investigation-question-log.md` Step 7: an
//!   eight-way cold run fell back on a WAL-init lock).
//! * **Build-lock shards** — a fixed set of hashed exclusive locks. A cache
//!   miss locks its shard, rechecks the database, computes strictly outside
//!   any SQLite transaction, and publishes in one short commit. Same-key
//!   callers hash to the same shard and serialize to one builder; distinct
//!   keys usually hash to different shards and build concurrently.
//!
//! `flock` locks are held by the open file description and are released
//! automatically by the kernel when the process dies — no lease expiry, no
//! stale-lock ambiguity. The `kill-builder` tests in `tests.rs` verify this
//! empirically (a killed child's shard lock is immediately reacquirable).

use std::fs::File;
use std::path::{Path, PathBuf};

use fs4::fs_std::FileExt;

use super::error::{BypassReason, StoreError, map_io};
use super::schema::{BUILD_SHARD_COUNT, BUILD_SHARD_PREFIX, INIT_LOCK_BASENAME};

/// An acquired exclusive lock. Releasing happens on drop (via the kernel when
/// the `File` closes); `_file` is kept alive for exactly that reason.
pub(crate) struct LockGuard {
    _file: File,
    #[allow(dead_code)]
    path: PathBuf,
}

fn open_lock_file(path: &Path) -> Result<File, StoreError> {
    File::create(path).map_err(|e| map_io(e, &format!("create lock `{}`", path.display())))
}

/// Acquire the exclusive init lock, blocking until it is available. Held for
/// the duration of schema init / quarantine.
pub(crate) fn acquire_init_lock(dir: &Path) -> Result<LockGuard, StoreError> {
    let path = dir.join(INIT_LOCK_BASENAME);
    let file = open_lock_file(&path)?;
    file.lock_exclusive()
        .map_err(|e| map_io(e, &format!("lock init `{}`", path.display())))?;
    Ok(LockGuard { _file: file, path })
}

/// Which build-lock shard a canonical key hashes to. A fixed function of the
/// key digest and the shard count, so every caller for one key agrees.
pub(crate) fn shard_index(key_digest: &[u8; 32], shard_count: usize) -> usize {
    // The key is already a uniform BLAKE3 digest; fold its first 8 bytes.
    let mut v = [0u8; 8];
    v.copy_from_slice(&key_digest[..8]);
    (u64::from_le_bytes(v) % shard_count as u64) as usize
}

fn shard_path(dir: &Path, shard: usize) -> PathBuf {
    dir.join(format!("{BUILD_SHARD_PREFIX}{shard}.lock"))
}

/// Acquire a build-lock shard, blocking until available.
pub(crate) fn acquire_build_shard(dir: &Path, shard: usize) -> Result<LockGuard, StoreError> {
    let path = shard_path(dir, shard);
    let file = open_lock_file(&path)?;
    file.lock_exclusive()
        .map_err(|e| map_io(e, &format!("lock shard `{}`", path.display())))?;
    Ok(LockGuard { _file: file, path })
}

/// Try to acquire a build-lock shard without blocking. Returns
/// `Ok(None)` when another holder has it (mapped to
/// [`BypassReason::LockContended`] by callers that require exclusivity).
pub(crate) fn try_acquire_build_shard(
    dir: &Path,
    shard: usize,
) -> Result<Option<LockGuard>, StoreError> {
    let path = shard_path(dir, shard);
    let file = open_lock_file(&path)?;
    let got = file
        .try_lock_exclusive()
        .map_err(|e| map_io(e, &format!("try-lock shard `{}`", path.display())))?;
    if got {
        Ok(Some(LockGuard { _file: file, path }))
    } else {
        Ok(None)
    }
}

/// Number of build-lock shards this store uses.
pub(crate) fn build_shard_count() -> usize {
    BUILD_SHARD_COUNT
}

/// Convenience for callers that treat a contended shard as a bypass.
#[allow(dead_code)]
pub(crate) fn contended() -> StoreError {
    StoreError::new(BypassReason::LockContended, "build shard contended")
}
