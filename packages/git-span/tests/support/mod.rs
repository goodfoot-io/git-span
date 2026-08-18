//! Shared test fixtures for git-span integration tests.
//!
//! All test cases compile as modules of a single crate (via
//! `tests/integration.rs` + `tests/cases/`), so every item in this
//! module is used by at least one caller. No `#[allow(dead_code)]`
//! annotations are needed.

use anyhow::{Context, Result};
use std::fs;
use std::io;
use std::path::Path;
use std::process::{Command, Output};

/// Spawn `cmd` and capture its output, naming the binary when the spawn
/// itself fails.
///
/// A bare `cmd.output()?` propagates the raw `io::Error`, so a failed spawn
/// surfaces as a context-free `No such file or directory (os error 2)` with
/// no indication of *which* binary was missing — an expensive thing to
/// diagnose from a test log.
///
/// The `NotFound`-and-absent case gets a pointed message because it has a
/// known cause here: the cargo target root is shared across worktrees (see
/// `scripts/with-target-lock.sh`), every cargo task holds only a *shared*
/// lock, and cargo's own `.cargo-lock` serializes build-vs-build but not
/// build-vs-run. A sibling worktree relinking `git-span` can therefore
/// unlink the binary out from under an already-running test's spawn.
///
/// This is diagnosis, not a fix: it makes the race legible, it does not
/// prevent it. Deliberately no retry — the flake should stay visible.
fn capture(cmd: &mut Command) -> Result<Output> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    match cmd.output() {
        Ok(out) => Ok(out),
        Err(err) if err.kind() == io::ErrorKind::NotFound && !Path::new(&program).exists() => {
            anyhow::bail!(
                "`{program}` did not exist at spawn time: {err}\n\
                 The cargo target root is shared across worktrees and scripted cargo tasks \
                 take only a shared lock, so a sibling worktree's relink can remove this \
                 binary mid-run. Re-run to confirm it is the race and not a missing build."
            )
        }
        Err(err) => Err(err).with_context(|| format!("failed to spawn `{program}`")),
    }
}

/// A scratch git repository, owned by a tempdir that's cleaned up on
/// drop. Set up with `user.name` / `user.email` so commits work without
/// global config.
pub struct TestRepo {
    pub dir: tempfile::TempDir,
}

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

    /// Raw-byte variant of [`Self::write_file`], for fixtures whose content is
    /// deliberately not UTF-8.
    pub fn write_file_bytes(&self, rel: &str, contents: &[u8]) -> Result<()> {
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
        let out = capture(&mut cmd)?;
        anyhow::ensure!(
            out.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(out)
    }

    /// `run_git` with extra environment. The one thing a git *flag* cannot set
    /// is the committer date, and the commit-time ordering of the history walk
    /// is keyed on exactly that — so a fixture that needs the walk to disagree
    /// with topology has to reach it through the environment.
    pub fn run_git_with_env<I, S>(&self, args: I, env: &[(&str, &str)]) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new("git");
        cmd.current_dir(self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        for (k, v) in env {
            cmd.env(k, v);
        }
        let out = capture(&mut cmd)?;
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
    #[allow(dead_code)]
    pub fn list_refs(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(self
            .git_stdout(["for-each-ref", "--format=%(refname)", prefix])?
            .lines()
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect())
    }

    #[allow(dead_code)]
    pub fn ref_exists(&self, name: &str) -> bool {
        self.git_stdout(["rev-parse", "--verify", "--quiet", name])
            .is_ok()
    }

    #[allow(dead_code)]
    pub fn add_remote(&self, name: &str, path: &Path) -> Result<()> {
        self.run_git(["remote", "add", name, &path.to_string_lossy()])?;
        Ok(())
    }

    /// Run the `git-span` binary in this repo's directory.
    pub fn run_span<I, S>(&self, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
        cmd.current_dir(self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        capture(&mut cmd)
    }

    /// Find the backtick-quoted `git span …` command in `stdout` that starts
    /// with `prefix`, and run **that exact string** — never a hand-written
    /// argv reconstructed from it.
    ///
    /// This exists because the alternative silently defeats its own test. A
    /// case that asserts `stdout.contains("git span add a.txt#L1-L2")` and
    /// then calls `run_span(["add", "some-span", "a.txt#L1-L2"])` has
    /// supplied the span name the printed command was missing; it passes
    /// while the printed command exits 2 on the operator who copies it. Any
    /// test claiming an operator can follow printed advice has to take its
    /// argv from the output under test, so that a malformed command fails
    /// the assertion instead of being quietly repaired by the harness.
    ///
    /// Splitting on whitespace is sufficient and deliberate: every argument
    /// these commands print is a span name or an anchor address, neither of
    /// which may contain a space. A printed command that needed quoting
    /// would be one no operator could paste either, so failing here is the
    /// correct outcome rather than a gap to paper over.
    ///
    /// Panics when no command in `stdout` matches `prefix`, or when a match
    /// still carries an unfilled `<placeholder>` — a placeholder is a blank
    /// only the operator can fill, so a test that tries to execute one is
    /// asserting the wrong thing.
    #[allow(dead_code)]
    pub fn run_printed_command(&self, stdout: &str, prefix: &str) -> Result<Output> {
        let cmd = stdout
            .split('`')
            .find(|seg| seg.starts_with(prefix))
            .unwrap_or_else(|| {
                panic!("no backticked command starting with `{prefix}` in stdout:\n{stdout}")
            })
            .trim();
        assert!(
            !cmd.contains('<'),
            "the printed command `{cmd}` carries an operator placeholder and \
             cannot be executed as printed; stdout:\n{stdout}"
        );
        let argv: Vec<&str> = cmd.split_whitespace().collect();
        assert_eq!(
            &argv[..2],
            &["git", "span"],
            "printed command is not a `git span` invocation: `{cmd}`"
        );
        self.run_span(&argv[2..])
    }

    /// Run the `git-span` binary in this repo's directory with one extra
    /// environment variable set. Used to drive the `GIT_SPAN_CACHE=0`
    /// off-switch for cache vs cache-off parity assertions.
    #[allow(dead_code)]
    pub fn run_span_with_env<I, S>(&self, args: I, key: &str, val: &str) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        self.run_span_with_envs(args, &[(key, val)])
    }

    /// Run the `git-span` binary with several environment variables set.
    #[allow(dead_code)]
    pub fn run_span_with_envs<I, S>(&self, args: I, env: &[(&str, &str)]) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
        cmd.current_dir(self.dir.path());
        for (key, val) in env {
            cmd.env(key, val);
        }
        for a in args {
            cmd.arg(a.as_ref());
        }
        capture(&mut cmd)
    }

    /// Run the `git-span` binary from an explicit working directory.
    #[allow(dead_code)]
    pub fn run_span_from<I, S>(&self, args: I, cwd: &Path) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
        cmd.current_dir(cwd);
        // Point git-span at this repo by setting GIT_DIR / GIT_WORK_TREE.
        cmd.env("GIT_DIR", self.dir.path().join(".git"));
        cmd.env("GIT_WORK_TREE", self.dir.path());
        for a in args {
            cmd.arg(a.as_ref());
        }
        capture(&mut cmd)
    }

    pub fn span_stdout<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let out = self.run_span(args)?;
        anyhow::ensure!(
            out.status.success(),
            "git-span failed (code {:?}): {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(String::from_utf8(out.stdout)?)
    }
    /// Write a commit-graph with changed-path Bloom filters for all
    /// reachable commits.  Required before calling any resolver entry
    /// point (`resolve_span`, `resolve_anchor`, `drift_spans`) — the
    /// reverse-indexed walk fails closed without a commit-graph.
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
#[cfg(unix)]
pub fn symlink_file(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

/// Create a symlink whose target is a regular file.
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
#[cfg(windows)]
pub fn symlink_dir(original: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(original, link)
}

/// Whether the host can create symlinks. On Unix this is always true. On
/// Windows it depends on Developer Mode / `SeCreateSymbolicLinkPrivilege`,
/// so probe once and cache the result.
#[cfg(unix)]
pub fn symlinks_supported() -> bool {
    true
}

#[cfg(unix)]
pub fn stall_unix_socket(path: &Path) -> std::io::Result<std::thread::JoinHandle<()>> {
    let stream = std::os::unix::net::UnixStream::connect(path)?;
    Ok(std::thread::spawn(move || {
        let _stream = stream;
        std::thread::sleep(std::time::Duration::from_secs(3));
    }))
}

/// Whether the host can create symlinks. On Windows, probe once by creating
/// then removing a temp symlink, and cache the outcome.
#[cfg(windows)]
pub fn symlinks_supported() -> bool {
    use std::sync::OnceLock;
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        let base = std::env::temp_dir();
        let target = base.join(format!(
            "git-span-symlink-probe-target-{}",
            std::process::id()
        ));
        let link = base.join(format!(
            "git-span-symlink-probe-link-{}",
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
#[cfg(windows)]
pub fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Clear the read-only bit on `path` so it can be rewritten — loose git
/// objects, for instance, are written read-only. On Unix the owner-write bit
/// is OR'd into the existing mode rather than going through
/// `Permissions::set_readonly(false)`, which would leave the file *world*
/// writable.
#[allow(dead_code)]
#[cfg(unix)]
pub fn make_writable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(perms.mode() | 0o200);
    std::fs::set_permissions(path, perms)
}

/// Clear the read-only bit on `path`. On Windows read-only is a single file
/// attribute with no mode bits behind it, so `set_readonly` is the API.
#[cfg(windows)]
pub fn make_writable(path: &Path) -> std::io::Result<()> {
    let mut perms = std::fs::metadata(path)?.permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(path, perms)
}

/// Make `path` unreadable to its owner (mode 0o000). POSIX-only; a no-op on
/// Windows where read permission is not a file-mode bit. Used to verify that
/// scans which encounter an unreadable candidate skip it instead of aborting.
/// Restore permissions with [`make_writable`] before the fixture is torn down
/// so the tempdir can be removed.
#[allow(dead_code)]
#[cfg(unix)]
pub fn make_unreadable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o000);
    std::fs::set_permissions(path, perms)
}

/// Make `path` unreadable. No-op on Windows.
#[cfg(windows)]
pub fn make_unreadable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// The signal that terminated `status`, if any. Always `None` on Windows,
/// where processes are not signal-terminated.
#[allow(dead_code)]
#[cfg(unix)]
pub fn terminating_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

/// The signal that terminated `status`. Always `None` on Windows.
#[allow(dead_code)]
#[cfg(windows)]
pub fn terminating_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
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
#[cfg(windows)]
pub fn mode(_path: &Path) -> Option<u32> {
    None
}

/// Create a `.span/<name>` file with the given anchors and why, then
/// commit it with ordinary git (file-backed model).
///
/// Each anchor is `(path, start, end)`; `(file, 0, 0)` means whole-file.
/// The content hash matches `git span add` exactly: the canonical rk64
/// fingerprint of the whole file, or of the `\n`-joined slice of lines
/// `[start, end]` with no trailing newline.
pub fn create_and_commit_span(
    repo: &gix::Repository,
    name: &str,
    anchors: &[(&str, u32, u32)],
    why: &str,
) -> Result<()> {
    let workdir = repo.workdir().expect("workdir").to_path_buf();
    let span_dir = workdir.join(".span");
    std::fs::create_dir_all(&span_dir)?;

    let mut records: Vec<git_span::span_file::AnchorRecord> = Vec::with_capacity(anchors.len());
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).unwrap_or_else(|_| panic!("read {path}"));
        let extent = if *start == 0 && *end == 0 {
            git_span::AnchorExtent::WholeFile
        } else {
            git_span::AnchorExtent::LineRange {
                start: *start,
                end: *end,
            }
        };
        let fp = git_span_core::cheap_fingerprint_with_extent(&bytes, &extent);
        let hash = git_span_core::rk64_to_hex(fp);

        records.push(git_span::span_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: git_span_core::RK64_ALGORITHM.into(),
            content_hash: hash,
        });
    }

    let mf = git_span::span_file::SpanFile {
        anchors: records,
        why: why.to_string(),
        config: git_span_core::SpanConfig::default(),
        resolved: Vec::new(),
    };
    let rel = format!(".span/{name}");
    if let Some(parent) = span_dir.join(name).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(span_dir.join(name), mf.serialize())?;
    let out = capture(
        Command::new("git")
            .current_dir(&workdir)
            .args(["add", &rel]),
    )?;
    assert!(out.status.success(), "git add {rel} failed");
    let out = capture(Command::new("git").current_dir(&workdir).args([
        "commit",
        "-m",
        &format!("span: {name}"),
    ]))?;
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
        let out = capture(Command::new("git").args(["init", "--bare"]).arg(dir.path()))?;
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
