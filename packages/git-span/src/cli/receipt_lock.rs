//! Process-scoped receipt mutex. The stable lock inode is never removed.

use anyhow::{Context, Result, ensure};
use clap::Args;
use fs4::fs_std::FileExt;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, TryRecvError};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Args)]
pub struct ReceiptLockArgs {
    #[arg(long)]
    pub directory: PathBuf,
    #[arg(long)]
    pub key: String,
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..=30_000))]
    pub wait_ms: u64,
}

const STRIPES: u64 = 128;

/// Historical identities share bounded, permanent mutex inodes. Nesting order is
/// invocation -> association -> capacity; each role has disjoint stripes. The
/// generic namespace supports standalone claims only and must never nest itself.
fn lock_name(key: &str) -> String {
    if key == "capacity" {
        return "capacity.lock".to_owned();
    }
    let role = if key.starts_with("invocation-") {
        "invocation"
    } else if key.starts_with("association-") {
        "association"
    } else {
        "generic"
    };
    // FNV-1a is explicit rather than DefaultHasher, whose algorithm is unstable.
    let hash = key.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("{role}-{:03}.lock", hash % STRIPES)
}

/// Re-check one retained inode within the acquisition budget. virtiofs can
/// transiently report uid 0 while neighboring directory entries are published;
/// neither that observation nor elapsed time ever authorizes access. Every
/// accepted descriptor still has the exact required owner and private mode.
#[cfg(unix)]
fn require_private(file: &File, directory: bool, owner: u32, deadline: Instant) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    loop {
        let metadata = file.metadata()?;
        ensure!(
            if directory {
                metadata.is_dir()
            } else {
                metadata.is_file() && metadata.nlink() == 1
            },
            "invalid receipt lock inode type or link count"
        );
        ensure!(
            metadata.mode() & 0o077 == 0,
            "receipt lock inode is not private: mode={:o}",
            metadata.mode()
        );
        if metadata.uid() == owner {
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "receipt lock inode ownership unavailable within acquisition deadline: uid={} required={}",
            metadata.uid(),
            owner
        );
        std::thread::sleep(
            Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn open_lock(args: &ReceiptLockArgs, deadline: Instant) -> Result<File> {
    ensure!(
        args.directory.is_absolute(),
        "receipt lock directory must be absolute"
    );
    ensure!(
        !args.key.is_empty()
            && args
                .key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'),
        "invalid receipt lock key"
    );
    #[cfg(unix)]
    let file = {
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::fs::OpenOptionsExt;
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&args.directory)
            .context("open receipt lock directory")?;
        require_private(
            &directory,
            true,
            crate::descriptor_authority::effective_uid(),
            deadline,
        )?;
        let name = std::ffi::CString::new(lock_name(&args.key))?;
        // SAFETY: directory is a retained descriptor, name is a valid C string,
        // and the returned descriptor is immediately given one owned File.
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDWR
                    | libc::O_CREAT
                    | libc::O_NOFOLLOW
                    | libc::O_NONBLOCK
                    | libc::O_CLOEXEC,
                0o600,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error()).context("open receipt lock");
        }
        // SAFETY: successful openat returned a fresh descriptor owned here.
        let file = unsafe { File::from_raw_fd(descriptor) };
        require_private(
            &file,
            false,
            crate::descriptor_authority::effective_uid(),
            deadline,
        )?;
        file
    };
    #[cfg(not(unix))]
    let file = {
        let directory = std::fs::symlink_metadata(&args.directory)?;
        ensure!(
            directory.is_dir() && !directory.file_type().is_symlink(),
            "invalid receipt lock directory"
        );
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
        }
        let file = options
            .open(args.directory.join(lock_name(&args.key)))
            .context("open receipt lock")?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && !metadata.file_type().is_symlink(),
            "receipt lock is not a regular file"
        );
        let _ = deadline;
        file
    };
    Ok(file)
}

/// Announce readiness only after acquisition; EOF releases even after parent death.
pub fn run(args: ReceiptLockArgs) -> Result<i32> {
    let deadline = Instant::now() + Duration::from_millis(args.wait_ms);
    let file = open_lock(&args, deadline)?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut byte = [0_u8];
        let result = std::io::stdin().read(&mut byte);
        let _ = sender.send(result);
    });
    loop {
        match receiver.try_recv() {
            Ok(_) | Err(TryRecvError::Disconnected) => return Ok(0),
            Err(TryRecvError::Empty) => {}
        }
        if FileExt::try_lock_exclusive(&file).context("acquire receipt lock")? {
            break;
        }
        if Instant::now() >= deadline {
            anyhow::bail!("receipt lock acquisition deadline exhausted");
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(b"locked\n")?;
    stdout.flush()?;
    drop(stdout);
    let read = receiver
        .recv()
        .context("receipt lock caller monitor failed")??;
    ensure!(read == 0, "receipt lock protocol requires EOF");
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_lock(args: &ReceiptLockArgs) -> Result<File> {
        super::open_lock(args, Instant::now() + Duration::from_millis(args.wait_ms))
    }

    fn arguments(directory: &std::path::Path) -> ReceiptLockArgs {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        ReceiptLockArgs {
            directory: directory.to_owned(),
            key: "capacity".into(),
            wait_ms: 100,
        }
    }

    #[test]
    fn stable_file_serializes_independent_descriptors_and_survives_release() {
        let root = tempfile::tempdir().unwrap();
        let args = arguments(root.path());
        let first = open_lock(&args).unwrap();
        let second = open_lock(&args).unwrap();
        assert!(FileExt::try_lock_exclusive(&first).unwrap());
        assert!(!FileExt::try_lock_exclusive(&second).unwrap());
        drop(first);
        assert!(FileExt::try_lock_exclusive(&second).unwrap());
        drop(second);
        assert!(root.path().join("capacity.lock").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn retained_inode_with_another_owner_is_never_accepted_and_wait_is_bounded() {
        let root = tempfile::tempdir().unwrap();
        let args = arguments(root.path());
        let file = File::open(&args.directory).unwrap();
        let other_owner = crate::descriptor_authority::effective_uid().wrapping_add(1);
        let started = Instant::now();
        let result = require_private(
            &file,
            true,
            other_owner,
            started + Duration::from_millis(40),
        );
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("ownership unavailable")
        );
        assert!(started.elapsed() >= Duration::from_millis(40));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_directory_symlink_without_following_it() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let mut args = arguments(root.path());
        let link = root.path().join("redirect");
        symlink(root.path(), &link).unwrap();
        args.directory = link;
        assert!(open_lock(&args).is_err());
        assert!(!root.path().join("capacity.lock").exists());
    }

    #[test]
    fn historical_claim_keys_use_a_bounded_number_of_permanent_files() {
        let root = tempfile::tempdir().unwrap();
        let mut args = arguments(root.path());
        open_lock(&args).unwrap();
        for role in ["invocation", "association", "fixture"] {
            for identity in 0..1024 {
                args.key = format!("{role}-{identity}");
                open_lock(&args).unwrap();
            }
        }
        let count = std::fs::read_dir(root.path()).unwrap().count();
        assert!(
            count <= 1 + 3 * STRIPES as usize,
            "unbounded mutex inodes: {count}"
        );
        assert!(count > STRIPES as usize);
    }

    #[test]
    fn invocation_collisions_serialize_but_other_stripes_and_nested_roles_do_not() {
        let root = tempfile::tempdir().unwrap();
        let mut args = arguments(root.path());
        args.key = "invocation-first".into();
        let first_name = lock_name(&args.key);
        let first = open_lock(&args).unwrap();
        assert!(FileExt::try_lock_exclusive(&first).unwrap());

        let collision = (0..10_000)
            .map(|id| format!("invocation-{id}"))
            .find(|key| lock_name(key) == first_name)
            .unwrap();
        args.key = collision;
        let colliding = open_lock(&args).unwrap();
        assert!(!FileExt::try_lock_exclusive(&colliding).unwrap());

        args.key = (0..10_000)
            .map(|id| format!("invocation-{id}"))
            .find(|key| lock_name(key) != first_name)
            .unwrap();
        let distinct = open_lock(&args).unwrap();
        assert!(FileExt::try_lock_exclusive(&distinct).unwrap());

        args.key = "association-first".into();
        let association = open_lock(&args).unwrap();
        assert!(FileExt::try_lock_exclusive(&association).unwrap());
        args.key = "capacity".into();
        let capacity = open_lock(&args).unwrap();
        assert!(FileExt::try_lock_exclusive(&capacity).unwrap());

        drop(first);
        assert!(FileExt::try_lock_exclusive(&colliding).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_public_directories_and_public_lock_files() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let root = tempfile::tempdir().unwrap();
        let args = arguments(root.path());
        let target = root.path().join("target");
        std::fs::write(&target, b"untouched").unwrap();
        let path = root.path().join("capacity.lock");
        symlink(&target, &path).unwrap();
        assert!(open_lock(&args).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"untouched");
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, b"").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(open_lock(&args).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(open_lock(&args).is_err());
    }
}
