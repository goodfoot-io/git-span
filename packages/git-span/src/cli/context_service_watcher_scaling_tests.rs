use super::FailClosedWatcher;
use anyhow::Result;
use std::ffi::CString;
use std::fs::File;
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

/// Observe directory enumeration directly, without a timing threshold or
/// permissions assumptions. Initial watcher installation precedes this probe.
fn observe_directory_opens(path: &Path) -> Result<File> {
    // SAFETY: inotify_init1 accepts only flags and returns a new owned fd.
    let descriptor = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
    anyhow::ensure!(descriptor >= 0, "{}", std::io::Error::last_os_error());
    // SAFETY: descriptor was just allocated and has exactly one owner.
    let observer = unsafe { File::from_raw_fd(descriptor) };
    let path = CString::new(path.as_os_str().as_bytes())?;
    // SAFETY: the borrowed fd and NUL-terminated path remain alive for the call.
    let watch =
        unsafe { libc::inotify_add_watch(observer.as_raw_fd(), path.as_ptr(), libc::IN_OPEN) };
    anyhow::ensure!(watch >= 0, "{}", std::io::Error::last_os_error());
    Ok(observer)
}

fn assert_directory_was_not_enumerated(mut observer: File) {
    let mut bytes = [0; 4096];
    let result = observer.read(&mut bytes);
    assert!(
        matches!(result, Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
        "watcher enumerated an unrelated directory while draining a local change"
    );
}

#[test]
fn file_changes_do_not_rescan_existing_directory_trees() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let unrelated = temp.path().join("unrelated");
    std::fs::create_dir(&unrelated)?;
    let source = temp.path().join("source");
    std::fs::write(&source, "before")?;
    let mut watcher = FailClosedWatcher::new(vec![temp.path().to_path_buf()], vec![])?;
    let observer = observe_directory_opens(&unrelated)?;

    std::fs::write(&source, "after")?;
    assert!(watcher.drain()?.paths.contains(&source));
    assert_directory_was_not_enumerated(observer);
    Ok(())
}

#[test]
fn new_subtrees_gain_coverage_without_rescanning_unrelated_directories() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let unrelated = temp.path().join("unrelated");
    std::fs::create_dir(&unrelated)?;
    let mut watcher = FailClosedWatcher::new(vec![temp.path().to_path_buf()], vec![])?;
    let observer = observe_directory_opens(&unrelated)?;
    let nested = temp.path().join("new/nested");
    std::fs::create_dir_all(&nested)?;
    let source = nested.join("source");
    std::fs::write(&source, "before")?;

    watcher.drain()?;
    assert_directory_was_not_enumerated(observer);
    std::fs::write(&source, "after")?;
    assert!(
        watcher.drain()?.paths.contains(&source),
        "new descendants must be covered before watcher trust is restored"
    );
    Ok(())
}

#[test]
fn shared_descriptors_preserve_events_for_every_root_spelling() -> Result<()> {
    let temp = tempfile::tempdir()?;
    std::fs::create_dir(temp.path().join("child"))?;
    let alias = temp.path().join("child/..");
    let mut watcher =
        FailClosedWatcher::new(vec![temp.path().to_path_buf(), alias.clone()], vec![])?;

    let source = temp.path().join("source");
    std::fs::write(&source, "changed")?;
    let paths = watcher.drain()?.paths;
    assert!(paths.contains(&source));
    assert!(paths.contains(&alias.join("source")));
    Ok(())
}
