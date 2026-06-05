//! Shared test fixtures for git-mesh integration tests.
//!
//! Each `tests/*.rs` file is compiled as a separate crate, so items in
//! this module that are unused by a particular crate would normally
//! warn. We `#[allow(dead_code)]` at item granularity per CLAUDE.md
//! "right way over easy way" — no blanket module-level allow.

use anyhow::Result;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

/// A scratch git repository, owned by a tempdir that's cleaned up on
/// drop. Set up with `user.name` / `user.email` so commits work without
/// global config.
#[allow(dead_code)]
pub struct TestRepo {
    pub dir: tempfile::TempDir,
}

#[allow(dead_code)]
impl TestRepo {
    /// New empty repo: `git init`, identity configured, no commits yet.
    pub fn new() -> Result<Self> {
        let dir = tempfile::tempdir()?;
        let me = Self { dir };
        me.run_git(["init", "--initial-branch=main"])?;
        me.run_git(["config", "user.name", "Test User"])?;
        me.run_git(["config", "user.email", "test@example.com"])?;
        me.run_git(["config", "commit.gpgsign", "false"])?;
        Ok(me)
    }

    /// New repo seeded with a single initial commit containing a
    /// 10-line `file1.txt` and a 16-line `file2.txt`. Convenient for
    /// staging-add tests that need a real anchor. Includes a commit-graph
    /// with changed-path Bloom filters for the reverse-indexed walker.
    pub fn seeded() -> Result<Self> {
        let me = Self::new()?;
        me.write_file(
            "file1.txt",
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        )?;
        me.write_file(
            "file2.txt",
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n",
        )?;
        me.commit_all("initial commit")?;
        me.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;
        Ok(me)
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Open the repo via `gix` for direct library calls.
    pub fn gix_repo(&self) -> Result<gix::Repository> {
        Ok(gix::open(self.dir.path())?)
    }

    pub fn write_file(&self, rel: &str, contents: &str) -> Result<()> {
        let p = self.dir.path().join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(p, contents)?;
        Ok(())
    }

    pub fn write_file_lines(&self, rel: &str, n: u32) -> Result<()> {
        let mut buf = String::with_capacity((n as usize) * 8);
        for i in 1..=n {
            buf.push_str(&format!("line{i}\n"));
        }
        self.write_file(rel, &buf)
    }

    /// `git add . && git commit -m <msg>`; returns the new HEAD sha.
    pub fn commit_all(&self, msg: &str) -> Result<String> {
        self.run_git(["add", "-A"])?;
        self.run_git(["commit", "-m", msg])?;
        self.head_sha()
    }

    /// Stage and commit a file in one shot, returning the new HEAD sha.
    pub fn commit_file(&self, rel: &str, contents: &str, msg: &str) -> Result<String> {
        self.write_file(rel, contents)?;
        self.commit_all(msg)
    }

    pub fn head_sha(&self) -> Result<String> {
        self.git_stdout(["rev-parse", "HEAD"])
    }

    pub fn run_git<I, S>(&self, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new("git");
        cmd.current_dir(self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        let out = cmd.output()?;
        anyhow::ensure!(
            out.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(out)
    }

    pub fn git_stdout<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let out = self.run_git(args)?;
        Ok(String::from_utf8(out.stdout)?.trim().to_string())
    }

    /// `git for-each-ref --format=%(refname) <prefix>`.
    pub fn list_refs(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(self
            .git_stdout(["for-each-ref", "--format=%(refname)", prefix])?
            .lines()
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect())
    }

    pub fn ref_exists(&self, name: &str) -> bool {
        self.git_stdout(["rev-parse", "--verify", "--quiet", name])
            .is_ok()
    }

    pub fn add_remote(&self, name: &str, path: &Path) -> Result<()> {
        self.run_git(["remote", "add", name, &path.to_string_lossy()])?;
        Ok(())
    }

    /// Run the `git-mesh` binary in this repo's directory.
    pub fn run_mesh<I, S>(&self, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        Ok(cmd.output()?)
    }

    /// Run the `git-mesh` binary from an explicit working directory.
    #[allow(dead_code)]
    pub fn run_mesh_from<I, S>(&self, args: I, cwd: &Path) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(cwd);
        // Point git-mesh at this repo by setting GIT_DIR / GIT_WORK_TREE.
        cmd.env("GIT_DIR", self.dir.path().join(".git"));
        cmd.env("GIT_WORK_TREE", self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        Ok(cmd.output()?)
    }

    pub fn mesh_stdout<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let out = self.run_mesh(args)?;
        anyhow::ensure!(
            out.status.success(),
            "git-mesh failed (code {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(String::from_utf8(out.stdout)?)
    }
    /// Write a commit-graph with changed-path Bloom filters for all
    /// reachable commits.  Required before calling any resolver entry
    /// point (`resolve_mesh`, `resolve_anchor`, `stale_meshes`) — the
    /// reverse-indexed walk fails closed without a commit-graph.
    #[allow(dead_code)]
    pub fn write_commit_graph(&self) -> Result<()> {
        self.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Cross-platform filesystem helpers. Integration tests must never reference
// `std::os::unix` directly (see scripts/validate.sh guardrail); they go
// through these instead so the suite compiles and runs on Windows too.
// ---------------------------------------------------------------------------

/// Create a symlink whose target is a regular file.
#[allow(dead_code)]
#[cfg(unix)]
pub fn symlink_file(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

/// Create a symlink whose target is a regular file.
#[allow(dead_code)]
#[cfg(windows)]
pub fn symlink_file(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(original, link)
}

/// Create a symlink whose target is a directory.
#[allow(dead_code)]
#[cfg(unix)]
pub fn symlink_dir(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

/// Create a symlink whose target is a directory.
#[allow(dead_code)]
#[cfg(windows)]
pub fn symlink_dir(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(original, link)
}

/// Whether the host can create symlinks. On Unix this is always true. On
/// Windows it depends on Developer Mode / `SeCreateSymbolicLinkPrivilege`,
/// so probe once and cache the result.
#[allow(dead_code)]
#[cfg(unix)]
pub fn symlinks_supported() -> bool {
    true
}

/// Whether the host can create symlinks. On Windows, probe once by creating
/// then removing a temp symlink, and cache the outcome.
#[allow(dead_code)]
#[cfg(windows)]
pub fn symlinks_supported() -> bool {
    use std::sync::OnceLock;
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        let base = std::env::temp_dir();
        let target = base.join(format!(
            "git-mesh-symlink-probe-target-{}",
            std::process::id()
        ));
        let link = base.join(format!(
            "git-mesh-symlink-probe-link-{}",
            std::process::id()
        ));
        let _ = std::fs::write(&target, b"probe");
        let ok = std::os::windows::fs::symlink_file(&target, &link).is_ok();
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_file(&target);
        ok
    })
}

/// Make `path` executable. POSIX-only; a no-op on Windows where execute
/// permission is not a file-mode bit.
#[allow(dead_code)]
#[cfg(unix)]
pub fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
}

/// Make `path` executable. No-op on Windows.
#[allow(dead_code)]
#[cfg(windows)]
pub fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// The POSIX permission bits (`mode & 0o777`) of `path`, or `None` on
/// platforms with no POSIX mode (Windows).
#[allow(dead_code)]
#[cfg(unix)]
pub fn mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|m| m.mode() & 0o777)
}

/// The POSIX permission bits of `path`. Always `None` on Windows.
#[allow(dead_code)]
#[cfg(windows)]
pub fn mode(_path: &Path) -> Option<u32> {
    None
}

/// Create a `.mesh/<name>` file with the given anchors and why, then
/// commit it with ordinary git (file-backed model).
///
/// Each anchor is `(path, start, end)`; `(file, 0, 0)` means whole-file.
/// The content hash matches `git mesh add` exactly: whole-file hashes
/// the entire file bytes; a line range hashes the `\n`-joined slice of
/// lines `[start, end]` with no trailing newline.
#[allow(dead_code)]
pub fn create_and_commit_mesh(
    repo: &gix::Repository,
    name: &str,
    anchors: &[(&str, u32, u32)],
    why: &str,
) -> Result<()> {
    let workdir = repo.workdir().expect("workdir").to_path_buf();
    let mesh_dir = workdir.join(".mesh");
    std::fs::create_dir_all(&mesh_dir)?;

    let mut records: Vec<git_mesh::mesh_file::AnchorRecord> = Vec::with_capacity(anchors.len());
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).unwrap_or_else(|_| panic!("read {path}"));
        let hashed: Vec<u8> = if *start == 0 && *end == 0 {
            bytes.clone()
        } else {
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            let lo = (*start as usize).saturating_sub(1);
            let hi = (*end as usize).min(lines.len());
            let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
            slice.join("\n").into_bytes()
        };
        let hash = format!("sha256:{}", git_mesh::types::sha256_hex(&hashed));

        records.push(git_mesh::mesh_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: "rk64".into(),
            content_hash: hash,
        });
    }

    let mf = git_mesh::mesh_file::MeshFile {
        anchors: records,
        why: why.to_string(),
    };
    let rel = format!(".mesh/{name}");
    if let Some(parent) = mesh_dir.join(name).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(mesh_dir.join(name), mf.serialize())?;
    let out = Command::new("git")
        .current_dir(&workdir)
        .args(["add", &rel])
        .output()?;
    assert!(out.status.success(), "git add {rel} failed");
    let out = Command::new("git")
        .current_dir(&workdir)
        .args(["commit", "-m", &format!("mesh: {name}")])
        .output()?;
    assert!(
        out.status.success(),
        "git commit failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// Bare upstream repo, for `fetch`/`push` round-trips.
#[allow(dead_code)]
pub struct BareRepo {
    pub dir: tempfile::TempDir,
}

#[allow(dead_code)]
impl BareRepo {
    pub fn new() -> Result<Self> {
        let dir = tempfile::tempdir()?;
        let out = Command::new("git")
            .args(["init", "--bare"])
            .arg(dir.path())
            .output()?;
        anyhow::ensure!(
            out.status.success(),
            "git init --bare failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(Self { dir })
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }
}
