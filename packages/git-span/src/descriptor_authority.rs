//! Retained directory-descriptor authority for git-span's mutable state.
//!
//! The public path used to discover an authority is diagnostic context only
//! after construction. Every operation is relative to a retained directory
//! descriptor so replacing a validated parent cannot redirect a transaction.

use anyhow::{Context, Result, bail, ensure};
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(test)]
thread_local! {
    static TEST_BOUNDARY_HOOK: std::cell::RefCell<Option<Box<dyn FnMut(&str)>>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn test_boundary(name: &str) {
    TEST_BOUNDARY_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            hook(name);
        }
    });
}

#[cfg(test)]
pub(crate) fn with_test_boundary_hook<T>(
    hook: impl FnMut(&str) + 'static,
    action: impl FnOnce() -> T,
) -> T {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            TEST_BOUNDARY_HOOK.with(|slot| *slot.borrow_mut() = None);
        }
    }
    TEST_BOUNDARY_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
    let _reset = Reset;
    action()
}

#[cfg(unix)]
use std::ffi::CString;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;

/// Creation policy for a descendant directory chain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectoryPolicy {
    /// Every component must already exist.
    Existing,
    /// Missing components are created with the requested permissions.
    Create { mode: u32 },
    /// Missing components are created privately and every component must be
    /// owned by the effective user with exactly the requested mode.
    Private { mode: u32 },
}

#[cfg(unix)]
fn component_c_string(component: &OsStr) -> Result<CString> {
    ensure_single_component(component)?;
    let bytes = component.as_bytes();
    CString::new(bytes).context("descriptor-relative name contains NUL")
}

fn ensure_single_component(component: &OsStr) -> Result<()> {
    let mut components = Path::new(component).components();
    ensure!(
        matches!(components.next(), Some(std::path::Component::Normal(_)))
            && components.next().is_none(),
        "descriptor-relative name must be one safe path component"
    );
    Ok(())
}

#[cfg(unix)]
fn open_directory_at(parent: &File, component: &OsStr) -> Result<File> {
    let component = component_c_string(component)?;
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            component.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error()).context("open retained directory component");
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

/// A directory inode retained independently of the pathname used to find it.
#[derive(Debug)]
pub struct RetainedDirectory {
    ancestors: Vec<File>,
    descriptor: File,
    display_path: PathBuf,
}

impl RetainedDirectory {
    /// Open one canonical directory as the root of a descriptor authority.
    pub fn open_canonical(path: &Path) -> Result<Self> {
        #[cfg(unix)]
        {
            let canonical = std::fs::canonicalize(path)
                .with_context(|| format!("canonicalize directory `{}`", path.display()))?;
            let encoded = CString::new(canonical.as_os_str().as_bytes())
                .context("canonical directory contains NUL")?;
            let descriptor = unsafe {
                libc::open(
                    encoded.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!("open canonical directory `{}`", canonical.display())
                });
            }
            Ok(Self {
                ancestors: Vec::new(),
                descriptor: unsafe { File::from_raw_fd(descriptor) },
                display_path: canonical,
            })
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Retain a no-follow descendant directory chain.
    pub fn descend(&self, relative: &Path, policy: DirectoryPolicy) -> Result<Self> {
        #[cfg(unix)]
        {
            let mut ancestors = self
                .ancestors
                .iter()
                .map(File::try_clone)
                .collect::<std::io::Result<Vec<_>>>()?;
            let mut current = self.descriptor.try_clone()?;
            let mut display_path = self.display_path.clone();
            let mut saw_component = false;
            for component in relative.components() {
                let std::path::Component::Normal(component) = component else {
                    bail!("descriptor descendant must be a non-empty relative path");
                };
                saw_component = true;
                let next = match open_directory_at(&current, component) {
                    Ok(next) => next,
                    Err(error)
                        if matches!(
                            policy,
                            DirectoryPolicy::Create { .. } | DirectoryPolicy::Private { .. }
                        ) && error
                            .downcast_ref::<std::io::Error>()
                            .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound) =>
                    {
                        let mode = match policy {
                            DirectoryPolicy::Create { mode }
                            | DirectoryPolicy::Private { mode } => mode,
                            DirectoryPolicy::Existing => unreachable!(),
                        };
                        let component_c = component_c_string(component)?;
                        let result = unsafe {
                            libc::mkdirat(current.as_raw_fd(), component_c.as_ptr(), mode)
                        };
                        if result < 0 {
                            let mkdir_error = std::io::Error::last_os_error();
                            if mkdir_error.kind() != std::io::ErrorKind::AlreadyExists {
                                return Err(mkdir_error)
                                    .context("create retained directory component");
                            }
                        }
                        open_directory_at(&current, component)?
                    }
                    Err(error) => return Err(error),
                };
                if let DirectoryPolicy::Private { mode } = policy {
                    use std::os::unix::fs::MetadataExt;
                    let metadata = next.metadata()?;
                    ensure!(
                        metadata.uid() == unsafe { libc::geteuid() },
                        "private retained directory has another owner"
                    );
                    ensure!(
                        metadata.mode() & 0o777 == mode,
                        "private retained directory permissions are not {mode:#o}"
                    );
                }
                ancestors.push(current);
                current = next;
                display_path.push(component);
            }
            ensure!(saw_component, "descriptor descendant must not be empty");
            Ok(Self {
                ancestors,
                descriptor: current,
                display_path,
            })
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, relative, policy);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Open an existing regular file without following its final component.
    pub fn open_file(&self, name: &OsStr, writable: bool) -> Result<File> {
        #[cfg(unix)]
        {
            let name = component_c_string(name)?;
            let access = if writable {
                libc::O_RDWR
            } else {
                libc::O_RDONLY
            };
            let descriptor = unsafe {
                libc::openat(
                    self.descriptor.as_raw_fd(),
                    name.as_ptr(),
                    access | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error()).context("open retained file");
            }
            let file = unsafe { File::from_raw_fd(descriptor) };
            ensure!(
                file.metadata()?.is_file(),
                "retained entry is not a regular file"
            );
            Ok(file)
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, name, writable);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Create a new regular file without following its final component.
    pub fn create_file(&self, name: &OsStr, mode: u32) -> Result<File> {
        #[cfg(unix)]
        {
            let name = component_c_string(name)?;
            let descriptor = unsafe {
                libc::openat(
                    self.descriptor.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDWR
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    mode,
                )
            };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error()).context("create retained file");
            }
            Ok(unsafe { File::from_raw_fd(descriptor) })
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, name, mode);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Open or create one stable regular file without truncating it.
    pub fn open_or_create_file(&self, name: &OsStr, mode: u32) -> Result<File> {
        #[cfg(unix)]
        {
            #[cfg(test)]
            test_boundary("open-or-create");
            let name = component_c_string(name)?;
            let descriptor = unsafe {
                libc::openat(
                    self.descriptor.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDWR | libc::O_CREAT | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    mode,
                )
            };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error())
                    .context("open or create retained file");
            }
            let file = unsafe { File::from_raw_fd(descriptor) };
            ensure!(
                file.metadata()?.is_file(),
                "retained entry is not a regular file"
            );
            Ok(file)
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, name, mode);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Read a regular file, distinguishing a missing leaf from every unsafe
    /// or unreadable state.
    pub fn read_optional(&self, name: &OsStr) -> Result<Option<Vec<u8>>> {
        #[cfg(test)]
        test_boundary("read");
        match self.open_file(name, false) {
            Ok(mut file) => {
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)?;
                Ok(Some(bytes))
            }
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    /// Durably replace one regular file using an exclusive sibling temp.
    pub fn atomic_write(&self, destination: &OsStr, contents: &[u8], mode: u32) -> Result<()> {
        ensure_single_component(destination)?;
        let temporary = OsString::from(format!(
            ".{}.{}.tmp",
            destination.to_string_lossy(),
            uuid::Uuid::new_v4()
        ));
        let result = (|| {
            #[cfg(test)]
            test_boundary("temp-create");
            let mut file = self.create_file(&temporary, mode)?;
            file.write_all(contents)?;
            #[cfg(test)]
            test_boundary("temp-fsync");
            file.sync_all()?;
            #[cfg(test)]
            test_boundary("rename");
            self.rename(&temporary, destination)?;
            #[cfg(test)]
            test_boundary("final-fsync");
            self.open_file(destination, false)?.sync_all()?;
            #[cfg(test)]
            test_boundary("directory-fsync");
            self.sync()
        })();
        if result.is_err() {
            let _ = self.unlink(&temporary);
        }
        result
    }

    /// Atomically replace `destination` with `source` inside this directory.
    pub fn rename(&self, source: &OsStr, destination: &OsStr) -> Result<()> {
        self.rename_to(source, self, destination)
    }

    /// Atomically move an entry between two retained directories.
    pub fn rename_to(
        &self,
        source: &OsStr,
        destination_directory: &Self,
        destination: &OsStr,
    ) -> Result<()> {
        #[cfg(unix)]
        {
            #[cfg(test)]
            test_boundary("rename-to");
            let source = component_c_string(source)?;
            let destination = component_c_string(destination)?;
            let result = unsafe {
                libc::renameat(
                    self.descriptor.as_raw_fd(),
                    source.as_ptr(),
                    destination_directory.descriptor.as_raw_fd(),
                    destination.as_ptr(),
                )
            };
            if result < 0 {
                return Err(std::io::Error::last_os_error()).context("rename retained entry");
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = (
                &self.descriptor,
                source,
                &destination_directory.descriptor,
                destination,
            );
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Remove a missing-or-present leaf without following it.
    pub fn unlink_if_exists(&self, name: &OsStr) -> Result<bool> {
        match self.unlink(name) {
            Ok(()) => Ok(true),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound) =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Remove an empty descendant directory without following it.
    pub fn unlink_empty_directory(&self, name: &OsStr) -> Result<bool> {
        #[cfg(unix)]
        {
            #[cfg(test)]
            test_boundary("unlink-directory");
            let name = component_c_string(name)?;
            let result = unsafe {
                libc::unlinkat(
                    self.descriptor.as_raw_fd(),
                    name.as_ptr(),
                    libc::AT_REMOVEDIR,
                )
            };
            if result == 0 {
                return Ok(true);
            }
            let error = std::io::Error::last_os_error();
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) || error.raw_os_error() == Some(libc::EEXIST)
            {
                return Ok(false);
            }
            Err(error).context("unlink empty retained directory")
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, name);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Retained immediate parent and this directory's leaf within it.
    pub fn parent(&self) -> Result<Option<(Self, OsString)>> {
        let Some((parent_descriptor, earlier)) = self.ancestors.split_last() else {
            return Ok(None);
        };
        let leaf = self
            .display_path
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("retained directory has no parent leaf"))?
            .to_os_string();
        let parent = Self {
            ancestors: earlier
                .iter()
                .map(File::try_clone)
                .collect::<std::io::Result<Vec<_>>>()?,
            descriptor: parent_descriptor.try_clone()?,
            display_path: self
                .display_path
                .parent()
                .ok_or_else(|| anyhow::anyhow!("retained directory has no parent"))?
                .to_path_buf(),
        };
        Ok(Some((parent, leaf)))
    }

    /// Remove one regular file or socket without following it.
    pub fn unlink(&self, name: &OsStr) -> Result<()> {
        #[cfg(unix)]
        {
            #[cfg(test)]
            test_boundary("unlink");
            let name = component_c_string(name)?;
            let result = unsafe { libc::unlinkat(self.descriptor.as_raw_fd(), name.as_ptr(), 0) };
            if result < 0 {
                return Err(std::io::Error::last_os_error()).context("unlink retained entry");
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = (&self.descriptor, name);
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Persist directory-entry changes made through this authority.
    pub fn sync(&self) -> Result<()> {
        self.descriptor
            .sync_all()
            .context("fsync retained directory")
    }

    /// Duplicate the retained descriptor without consulting its old path.
    pub fn try_clone(&self) -> Result<Self> {
        Ok(Self {
            ancestors: self
                .ancestors
                .iter()
                .map(File::try_clone)
                .collect::<std::io::Result<Vec<_>>>()?,
            descriptor: self.descriptor.try_clone()?,
            display_path: self.display_path.clone(),
        })
    }

    /// A descriptor-rooted path for APIs such as Unix socket bind that lack
    /// an `*at` form. It never traverses the discovery pathname again.
    pub fn descriptor_path(&self, name: &OsStr) -> Result<PathBuf> {
        #[cfg(target_os = "linux")]
        {
            component_c_string(name)?;
            Ok(PathBuf::from(format!(
                "/proc/self/fd/{}/{}",
                self.descriptor.as_raw_fd(),
                name.to_string_lossy()
            )))
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = name;
            bail!("descriptor-rooted socket paths require Linux procfs")
        }
    }

    /// Whether a final entry exists, inspected without following it.
    pub fn entry_exists(&self, name: &OsStr) -> Result<bool> {
        #[cfg(unix)]
        {
            let name = component_c_string(name)?;
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            let status = unsafe {
                libc::fstatat(
                    self.descriptor.as_raw_fd(),
                    name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if status == 0 {
                return Ok(true);
            }
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(false);
            }
            Err(error).context("inspect retained entry")
        }
        #[cfg(not(unix))]
        {
            let _ = name;
            bail!("descriptor authority requires openat-style platform support")
        }
    }

    /// Recursively enumerate regular-file leaves from this retained inode.
    pub fn regular_file_names(&self) -> Result<Vec<PathBuf>> {
        #[cfg(target_os = "linux")]
        fn walk(
            directory: &RetainedDirectory,
            prefix: &Path,
            output: &mut Vec<PathBuf>,
        ) -> Result<()> {
            let path = PathBuf::from(format!(
                "/proc/self/fd/{}",
                directory.descriptor.as_raw_fd()
            ));
            let mut entries = std::fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(std::fs::DirEntry::file_name);
            for entry in entries {
                let name = entry.file_name();
                ensure_single_component(&name)?;
                let relative = prefix.join(&name);
                let kind = entry.file_type()?;
                ensure!(!kind.is_symlink(), "retained directory contains a symlink");
                if kind.is_dir() {
                    let child = directory.descend(Path::new(&name), DirectoryPolicy::Existing)?;
                    walk(&child, &relative, output)?;
                } else if kind.is_file() {
                    output.push(relative);
                } else {
                    bail!("retained directory contains a non-file entry")
                }
            }
            Ok(())
        }

        #[cfg(target_os = "linux")]
        {
            let mut output = Vec::new();
            walk(self, Path::new(""), &mut output)?;
            Ok(output)
        }
        #[cfg(not(target_os = "linux"))]
        {
            bail!("descriptor-rooted enumeration requires Linux procfs")
        }
    }

    /// Validate a private Unix socket without following its final component.
    #[cfg(target_os = "linux")]
    pub fn validate_owned_socket(&self, name: &OsStr, mode: u32) -> Result<()> {
        use std::os::unix::fs::FileTypeExt;
        use std::os::unix::fs::MetadataExt;
        let path = self.descriptor_path(name)?;
        let metadata = std::fs::symlink_metadata(&path)?;
        ensure!(
            metadata.file_type().is_socket(),
            "retained entry is not a Unix socket"
        );
        ensure!(
            metadata.uid() == unsafe { libc::geteuid() },
            "retained socket has another owner"
        );
        ensure!(
            metadata.mode() & 0o777 == mode,
            "retained socket permissions are not {mode:#o}"
        );
        Ok(())
    }

    /// Original discovery path, retained only for actionable diagnostics.
    pub fn display_path(&self) -> &Path {
        &self.display_path
    }

    /// Prove the original discovery pathname still names this retained inode.
    /// Pathnames are never used for mutation after authority is retained; this
    /// check only turns a parent replacement into a fail-closed publication
    /// result instead of reporting bytes through an inode no longer reachable
    /// at the configured location.
    pub fn validate_path_binding(&self) -> Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let path = std::fs::symlink_metadata(&self.display_path).with_context(|| {
                format!(
                    "revalidate retained directory `{}`",
                    self.display_path.display()
                )
            })?;
            ensure!(
                !path.file_type().is_symlink(),
                "retained directory path was replaced by a symlink"
            );
            let retained = self.descriptor.metadata()?;
            ensure!(
                path.dev() == retained.dev() && path.ino() == retained.ino(),
                "retained directory path now names a different inode"
            );
            Ok(())
        }
        #[cfg(not(unix))]
        {
            bail!("descriptor authority requires openat-style platform support")
        }
    }
}

/// A validated span name split into its retained parent and final leaf.
#[derive(Debug)]
pub struct SpanTarget {
    pub parent: RetainedDirectory,
    pub leaf: OsString,
}

/// Authority rooted at one canonical worktree and resolved span root.
#[derive(Debug)]
pub struct SpanRootAuthority {
    _worktree: RetainedDirectory,
    span_root: RetainedDirectory,
}

impl SpanRootAuthority {
    /// Retain an existing span root, or report that no root existed at the
    /// descriptor lookup's linearization point. Other lookup failures remain
    /// fail-closed (notably symlinks and permission errors).
    pub fn open_optional(worktree: &Path, span_root: &str) -> Result<Option<Self>> {
        match Self::open(worktree, span_root, DirectoryPolicy::Existing) {
            Ok(authority) => Ok(Some(authority)),
            Err(error)
                if error
                    .chain()
                    .filter_map(|cause| cause.downcast_ref::<std::io::Error>())
                    .any(|io| io.kind() == std::io::ErrorKind::NotFound) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    /// Retain the canonical worktree and no-follow span-root chain.
    pub fn open(worktree: &Path, span_root: &str, policy: DirectoryPolicy) -> Result<Self> {
        git_span_core::validate_repo_relative_path("span root", span_root)?;
        let worktree = RetainedDirectory::open_canonical(worktree)?;
        let span_root_directory = worktree.descend(Path::new(span_root), policy)?;
        Ok(Self {
            _worktree: worktree,
            span_root: span_root_directory,
        })
    }

    /// Retain every parent of a validated hierarchical span name.
    pub fn target(&self, span_name: &str, policy: DirectoryPolicy) -> Result<SpanTarget> {
        git_span_core::validate_span_name_shape(span_name)?;
        let (parent, leaf) = match span_name.rsplit_once('/') {
            Some((parent, leaf)) => (
                self.span_root.descend(Path::new(parent), policy)?,
                OsString::from(leaf),
            ),
            None => (self.span_root.try_clone()?, OsString::from(span_name)),
        };
        Ok(SpanTarget { parent, leaf })
    }

    /// Retained descriptor for control files directly under the span root.
    pub fn root(&self) -> Result<RetainedDirectory> {
        self.span_root.try_clone()
    }

    /// Revalidate that both public roots still name their retained inodes.
    pub fn validate_bindings(&self) -> Result<()> {
        self._worktree.validate_path_binding()?;
        self.span_root.validate_path_binding()
    }
}

/// Authority for private service state below a per-worktree Git directory.
#[derive(Debug)]
pub struct RuntimeAuthority {
    directory: RetainedDirectory,
}

impl RuntimeAuthority {
    /// Retain `<git-dir>/span/context/<service-key-prefix>` with mode 0700.
    pub fn open(git_dir: &Path, service_key: &str) -> Result<Self> {
        ensure!(
            service_key.len() >= 16 && service_key.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "service key must be at least sixteen hexadecimal characters"
        );
        let git_dir = RetainedDirectory::open_canonical(git_dir)?;
        // `.git/span` is shared with the resolver store and may predate the
        // service. Retain it without weakening its established permissions;
        // the service-owned context subtree and identity leaf are private.
        let span = git_dir.descend(Path::new("span"), DirectoryPolicy::Create { mode: 0o755 })?;
        let context = span.descend(
            Path::new("context"),
            DirectoryPolicy::Private { mode: 0o700 },
        )?;
        let directory = context.descend(
            Path::new(&service_key[..16]),
            DirectoryPolicy::Private { mode: 0o700 },
        )?;
        Ok(Self { directory })
    }

    /// Duplicate the private runtime directory authority.
    pub fn directory(&self) -> Result<RetainedDirectory> {
        self.directory.try_clone()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{DirectoryPolicy, RetainedDirectory, RuntimeAuthority, SpanRootAuthority};
    use anyhow::Result;
    use std::ffi::OsStr;
    use std::io::{Read, Write};
    use std::os::unix::fs::symlink;
    use std::path::Path;

    fn replace_through(directory: &RetainedDirectory, contents: &[u8]) -> Result<()> {
        let mut temporary = directory.create_file(OsStr::new(".value.tmp"), 0o600)?;
        temporary.write_all(contents)?;
        temporary.sync_all()?;
        directory.rename(OsStr::new(".value.tmp"), OsStr::new("value"))?;
        directory.sync()
    }

    fn read_through(directory: &RetainedDirectory) -> Result<Vec<u8>> {
        let mut file = directory.open_file(OsStr::new("value"), false)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    #[test]
    fn retained_directory_survives_parent_swap_for_every_file_operation() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let trusted = temp.path().join("trusted");
        let attacker = temp.path().join("attacker");
        std::fs::create_dir(&trusted)?;
        std::fs::create_dir(&attacker)?;
        let authority = RetainedDirectory::open_canonical(&trusted)?;

        std::fs::rename(&trusted, temp.path().join("trusted-retained"))?;
        symlink(&attacker, &trusted)?;
        replace_through(&authority, b"retained")?;
        assert_eq!(read_through(&authority)?, b"retained");
        assert_eq!(
            std::fs::read(temp.path().join("trusted-retained/value"))?,
            b"retained"
        );
        assert!(!attacker.join("value").exists());

        authority.unlink(OsStr::new("value"))?;
        authority.sync()?;
        assert!(!temp.path().join("trusted-retained/value").exists());
        Ok(())
    }

    #[test]
    fn span_authority_survives_root_and_hierarchical_parent_swaps() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let worktree = temp.path().join("worktree");
        std::fs::create_dir(&worktree)?;
        let authority =
            SpanRootAuthority::open(&worktree, ".span", DirectoryPolicy::Create { mode: 0o755 })?;
        let target = authority.target("team/component", DirectoryPolicy::Create { mode: 0o755 })?;

        let retained_root = worktree.join(".span-retained");
        std::fs::rename(worktree.join(".span"), &retained_root)?;
        let attacker_root = temp.path().join("attacker-root");
        std::fs::create_dir(&attacker_root)?;
        symlink(&attacker_root, worktree.join(".span"))?;

        let retained_parent = retained_root.join("team-retained");
        std::fs::rename(retained_root.join("team"), &retained_parent)?;
        let attacker_parent = temp.path().join("attacker-parent");
        std::fs::create_dir(&attacker_parent)?;
        symlink(&attacker_parent, retained_root.join("team"))?;

        let mut temporary = target
            .parent
            .create_file(OsStr::new(".component.tmp"), 0o600)?;
        temporary.write_all(b"span")?;
        temporary.sync_all()?;
        target
            .parent
            .rename(OsStr::new(".component.tmp"), &target.leaf)?;
        target.parent.sync()?;

        assert_eq!(std::fs::read(retained_parent.join("component"))?, b"span");
        assert!(!attacker_root.join("team/component").exists());
        assert!(!attacker_parent.join("component").exists());
        Ok(())
    }

    #[test]
    fn runtime_authority_survives_each_private_parent_swap() -> Result<()> {
        for swapped in ["span", "context", "service"] {
            let temp = tempfile::tempdir()?;
            let git_dir = temp.path().join("git-dir");
            std::fs::create_dir(&git_dir)?;
            let runtime = RuntimeAuthority::open(&git_dir, "0123456789abcdef0123456789abcdef")?;
            let directory = runtime.directory()?;
            let relative = match swapped {
                "span" => Path::new("span").to_path_buf(),
                "context" => Path::new("span/context").to_path_buf(),
                "service" => Path::new("span/context/0123456789abcdef").to_path_buf(),
                _ => unreachable!(),
            };
            let original = git_dir.join(&relative);
            let retained = original.with_extension("retained");
            std::fs::rename(&original, &retained)?;
            let attacker = temp.path().join(format!("attacker-{swapped}"));
            std::fs::create_dir(&attacker)?;
            symlink(&attacker, &original)?;

            replace_through(&directory, b"runtime")?;
            assert_eq!(read_through(&directory)?, b"runtime");
            assert!(!attacker.join("value").exists());
        }
        Ok(())
    }

    #[test]
    fn symlinked_descendants_and_leaf_files_fail_closed() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("root");
        let attacker = temp.path().join("attacker");
        std::fs::create_dir(&root)?;
        std::fs::create_dir(&attacker)?;
        symlink(&attacker, root.join("linked"))?;
        let authority = RetainedDirectory::open_canonical(&root)?;
        assert!(
            authority
                .descend(Path::new("linked"), DirectoryPolicy::Existing)
                .is_err()
        );

        symlink(attacker.join("payload"), root.join("leaf"))?;
        assert!(authority.open_file(OsStr::new("leaf"), false).is_err());
        assert!(authority.create_file(OsStr::new("leaf"), 0o600).is_err());
        assert!(!attacker.join("payload").exists());
        Ok(())
    }
}
