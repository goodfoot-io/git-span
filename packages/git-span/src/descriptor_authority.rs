//! Retained directory-descriptor authority for git-span's mutable state.
//!
//! The public path used to discover an authority is diagnostic context only
//! after construction. Every operation is relative to a retained directory
//! descriptor so replacing a validated parent cannot redirect a transaction.

use anyhow::{Result, bail};
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::path::{Path, PathBuf};

/// Creation policy for a descendant directory chain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectoryPolicy {
    /// Every component must already exist.
    Existing,
    /// Missing components are created with owner-only permissions.
    CreatePrivate,
}

/// A directory inode retained independently of the pathname used to find it.
#[derive(Debug)]
pub struct RetainedDirectory {
    descriptor: File,
    display_path: PathBuf,
}

impl RetainedDirectory {
    /// Open one canonical directory as the root of a descriptor authority.
    pub fn open_canonical(path: &Path) -> Result<Self> {
        let _ = path;
        bail!("descriptor authority is not implemented")
    }

    /// Retain a no-follow descendant directory chain.
    pub fn descend(&self, relative: &Path, policy: DirectoryPolicy) -> Result<Self> {
        let _ = (&self.descriptor, relative, policy);
        bail!("descriptor authority is not implemented")
    }

    /// Open an existing regular file without following its final component.
    pub fn open_file(&self, name: &OsStr, writable: bool) -> Result<File> {
        let _ = (&self.descriptor, name, writable);
        bail!("descriptor authority is not implemented")
    }

    /// Create a new regular file without following its final component.
    pub fn create_file(&self, name: &OsStr, mode: u32) -> Result<File> {
        let _ = (&self.descriptor, name, mode);
        bail!("descriptor authority is not implemented")
    }

    /// Atomically replace `destination` with `source` inside this directory.
    pub fn rename(&self, source: &OsStr, destination: &OsStr) -> Result<()> {
        let _ = (&self.descriptor, source, destination);
        bail!("descriptor authority is not implemented")
    }

    /// Remove one regular file or socket without following it.
    pub fn unlink(&self, name: &OsStr) -> Result<()> {
        let _ = (&self.descriptor, name);
        bail!("descriptor authority is not implemented")
    }

    /// Persist directory-entry changes made through this authority.
    pub fn sync(&self) -> Result<()> {
        let _ = &self.descriptor;
        bail!("descriptor authority is not implemented")
    }

    /// Duplicate the retained descriptor without consulting its old path.
    pub fn try_clone(&self) -> Result<Self> {
        let _ = &self.descriptor;
        bail!("descriptor authority is not implemented")
    }

    /// A descriptor-rooted path for APIs such as Unix socket bind that lack
    /// an `*at` form. It never traverses the discovery pathname again.
    pub fn descriptor_path(&self, name: &OsStr) -> Result<PathBuf> {
        let _ = (&self.descriptor, name);
        bail!("descriptor authority is not implemented")
    }

    /// Original discovery path, retained only for actionable diagnostics.
    pub fn display_path(&self) -> &Path {
        &self.display_path
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
    worktree: RetainedDirectory,
    span_root: RetainedDirectory,
}

impl SpanRootAuthority {
    /// Retain the canonical worktree and no-follow span-root chain.
    pub fn open(worktree: &Path, span_root: &str, policy: DirectoryPolicy) -> Result<Self> {
        let _ = (worktree, span_root, policy);
        bail!("span-root descriptor authority is not implemented")
    }

    /// Retain every parent of a validated hierarchical span name.
    pub fn target(&self, span_name: &str, policy: DirectoryPolicy) -> Result<SpanTarget> {
        let _ = (&self.worktree, &self.span_root, span_name, policy);
        bail!("span target descriptor authority is not implemented")
    }

    /// Retained descriptor for control files directly under the span root.
    pub fn root(&self) -> Result<RetainedDirectory> {
        self.span_root.try_clone()
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
        let _ = (git_dir, service_key);
        bail!("runtime descriptor authority is not implemented")
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
    #[ignore = "TDD bootstrap: descriptor implementation follows the compiling contract"]
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
    #[ignore = "TDD bootstrap: descriptor implementation follows the compiling contract"]
    fn span_authority_survives_root_and_hierarchical_parent_swaps() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let worktree = temp.path().join("worktree");
        std::fs::create_dir(&worktree)?;
        let authority =
            SpanRootAuthority::open(&worktree, ".span", DirectoryPolicy::CreatePrivate)?;
        let target = authority.target("team/component", DirectoryPolicy::CreatePrivate)?;

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
    #[ignore = "TDD bootstrap: descriptor implementation follows the compiling contract"]
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
    #[ignore = "TDD bootstrap: descriptor implementation follows the compiling contract"]
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
