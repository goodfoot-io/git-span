//! Repository-wide ordering between recovery, readers, and span mutation.

use super::Commands;
use anyhow::{Context, Result, bail};
use fs4::fs_std::FileExt;
use std::ffi::OsStr;
use std::fs::File;
use std::time::{Duration, Instant};

use crate::descriptor_authority::{DirectoryPolicy, RetainedDirectory};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Mode {
    Shared,
    Exclusive,
}

pub(crate) struct Guard {
    _file: File,
}

pub(crate) fn command_mode(command: &Commands) -> Option<Mode> {
    match command {
        Commands::Context(_) | Commands::ContextService(_) | Commands::UpdateCheck => None,
        Commands::Drift(args) if args.fix => Some(Mode::Exclusive),
        Commands::Why(args) if args.why_text.is_some() => Some(Mode::Exclusive),
        Commands::Config(args) if args.value.is_some() => Some(Mode::Exclusive),
        Commands::Resolve(args) if !args.dry_run => Some(Mode::Exclusive),
        Commands::Add(_)
        | Commands::Remove(_)
        | Commands::Replace(_)
        | Commands::Delete(_)
        | Commands::MergeDriver(_) => Some(Mode::Exclusive),
        Commands::Show(_)
        | Commands::List(_)
        | Commands::Drift(_)
        | Commands::Why(_)
        | Commands::Config(_)
        | Commands::Doctor(_)
        | Commands::Tree(_)
        | Commands::History(_)
        | Commands::Resolve(_) => Some(Mode::Shared),
    }
}

/// Try to take `mode` on `file` without blocking. `Ok(true)` means acquired.
///
/// Called through fully-qualified trait syntax: `std::fs::File` has grown
/// its own inherent `try_lock_shared` with a different (`Result<(),
/// TryLockError>`) signature, which would otherwise shadow [`fs4`]'s
/// extension method of the same name and silently change which lock API
/// gets called depending on the mode.
fn try_acquire(file: &File, mode: Mode) -> std::io::Result<bool> {
    match mode {
        Mode::Shared => FileExt::try_lock_shared(file),
        Mode::Exclusive => FileExt::try_lock_exclusive(file),
    }
}

/// Open (creating if needed) the repository lock file under a freshly
/// descended `<git-dir>/span` directory.
///
/// On the shared virtiofs worktree mount, an `openat(O_CREAT)` against a
/// retained directory fd can misreport `NotFound` for an entry it
/// nevertheless materializes — observed natively at roughly even odds — and
/// retrying on the same descriptor keeps failing because the stale negative
/// entry stays bound to that descriptor chain. Re-descending from the
/// trusted git-directory root forces a fresh directory walk, which does see
/// the created file. The round bound keeps a genuinely absent parent
/// erroring instead of looping; every other errno fails immediately.
fn acquire_lock_file(git_directory: &RetainedDirectory) -> Result<File> {
    const NOT_FOUND_ROUNDS: usize = 3;
    for round in 0..=NOT_FOUND_ROUNDS {
        let lock_directory = git_directory.descend(
            std::path::Path::new("span"),
            DirectoryPolicy::Create { mode: 0o755 },
        )?;
        match lock_directory.open_or_create_file(OsStr::new("recovery-domain.lock"), 0o600) {
            Ok(file) => return Ok(file),
            Err(error)
                if round < NOT_FOUND_ROUNDS
                    && error
                        .downcast_ref::<std::io::Error>()
                        .is_some_and(|io| io.kind() == std::io::ErrorKind::NotFound) =>
            {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(error) => return Err(error).context("open repository recovery-domain lock"),
        }
    }
    unreachable!("the loop body returns Ok or Err on every path")
}

/// Acquire the repository-wide recovery-domain lock at
/// `<git_dir>/span/recovery-domain.lock`, shared or exclusive per `mode`.
///
/// Acquisition is attempted without blocking first. When another process
/// holds the lock, this names the lock path it is waiting on and then waits
/// a bounded [`lock_wait`] before giving up with an error. An unbounded,
/// silent block was the wrong shape here: a reader waiting behind a long
/// `drift --fix` had no way to tell a hang from ordinary contention, and a
/// CI harness could only kill the job — leaving no diagnostic naming which
/// lock it was stuck on. A caller that would rather wait longer can re-run;
/// a caller that cannot wait now gets told what to do about it. The lock
/// inode itself is never suggested for deletion: it is a permanent
/// rendezvous point for every `git span` invocation against this
/// repository, not a stale artifact.
pub(crate) fn acquire(repo: &gix::Repository, mode: Mode) -> Result<Guard> {
    let git_directory = RetainedDirectory::open_canonical(crate::git::git_dir(repo))?;
    let file = acquire_lock_file(&git_directory)?;
    let lock_path = git_directory
        .display_path()
        .join("span")
        .join("recovery-domain.lock");

    // Fast path: uncontended, which is every ordinary invocation.
    if try_acquire(&file, mode).context("acquire repository recovery-domain lock")? {
        return Ok(Guard { _file: file });
    }

    // Contended. Say so before waiting — a silent wait is indistinguishable
    // from a hang, and the operator cannot tell which lock is blocked.
    let budget = lock_wait();
    eprintln!(
        "waiting for another `git span` process to release the repository lock \
         `{}` (up to {}s)",
        lock_path.display(),
        budget.as_secs()
    );

    let deadline = Instant::now() + budget;
    loop {
        if try_acquire(&file, mode).context("acquire repository recovery-domain lock")? {
            return Ok(Guard { _file: file });
        }
        if Instant::now() >= deadline {
            bail!(
                "timed out after {}s waiting for the repository lock `{}`. \
                 Another `git span` process is still holding it — wait for it \
                 to finish and re-run.",
                budget.as_secs(),
                lock_path.display(),
            );
        }
        std::thread::sleep(LOCK_POLL);
    }
}

/// How long [`acquire`] waits for a contended repository lock before failing
/// with a diagnostic. Long enough to ride out a concurrent `add` or
/// `--fix` on a large corpus, short enough that a CI job fails with a
/// message rather than being killed on a job timeout.
const LOCK_WAIT_DEFAULT_SECS: u64 = 30;

/// Poll interval while waiting. `flock` has no timed variant, so the wait is
/// a try-loop; the interval is short enough to be imperceptible and long
/// enough not to spin.
const LOCK_POLL: Duration = Duration::from_millis(25);

/// The contended-lock wait budget, overridable by `GIT_SPAN_LOCK_WAIT_SECS`.
///
/// A harness that would rather fail fast than hold a job open — and the
/// tests that exercise the timeout path — set it low; an operator on a slow
/// filesystem sets it high. An unparseable or absent value takes the
/// default rather than failing, since a bad knob must not break a command
/// that would otherwise have acquired the lock immediately.
fn lock_wait() -> Duration {
    let secs = std::env::var("GIT_SPAN_LOCK_WAIT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(LOCK_WAIT_DEFAULT_SECS);
    Duration::from_secs(secs)
}

/// Enter the shared reader domain only after settling any crash-left prepared
/// context repair. The common path takes one shared lock and one marker stat.
/// A pending marker forces an exclusive recovery pass, followed by an atomic
/// `flock` downgrade on the same descriptor so no writer can enter between
/// recovery and the caller's read.
pub(crate) fn acquire_reader(repo: &gix::Repository, span_root: &str) -> Result<Guard> {
    let shared = acquire(repo, Mode::Shared)?;
    let Some(recovery) = super::context_repair::pending_recovery(repo, span_root)? else {
        return Ok(shared);
    };

    drop(shared);
    let exclusive = acquire(repo, Mode::Exclusive)?;
    super::context_repair::recover_pending_locked(repo, span_root, &recovery)?;
    exclusive
        ._file
        .lock_shared()
        .context("downgrade recovered repository domain to shared")?;
    Ok(exclusive)
}

/// Enter the exclusive writer domain after settling any crash-left prepared
/// context repair. Recovery runs while this same guard remains exclusive, so
/// the handler's whole read-modify-write against the span root runs under
/// one uninterrupted hold of the repository lock, with no gap between
/// recovery and the mutation it guards.
pub(crate) fn acquire_writer(repo: &gix::Repository, span_root: &str) -> Result<Guard> {
    let exclusive = acquire(repo, Mode::Exclusive)?;
    if let Some(recovery) = super::context_repair::pending_recovery(repo, span_root)? {
        super::context_repair::recover_pending_locked(repo, span_root, &recovery)?;
    }
    Ok(exclusive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    fn parsed_mode(args: &[&str]) -> Option<Mode> {
        let cli = crate::cli::Cli::try_parse_from(args).expect("command should parse");
        command_mode(cli.command.as_ref().expect("command should be present"))
    }

    #[test]
    fn every_public_command_enters_the_declared_recovery_domain() {
        for args in [
            &["git-span", "show", "s"][..],
            &["git-span", "list"][..],
            &["git-span", "drift"][..],
            &["git-span", "why", "s"][..],
            &["git-span", "config", "s"][..],
            &["git-span", "doctor"][..],
            &["git-span", "tree", "file.txt"][..],
            &["git-span", "history", "s"][..],
            &["git-span", "resolve", "s", "--dry-run"][..],
        ] {
            assert_eq!(parsed_mode(args), Some(Mode::Shared), "{args:?}");
        }
        for args in [
            &["git-span", "drift", "--fix"][..],
            &["git-span", "add", "s", "file.txt"][..],
            &["git-span", "remove", "s", "file.txt"][..],
            &["git-span", "replace", "s", "file.txt", "other.txt"][..],
            &["git-span", "why", "s", "because it matters"][..],
            &[
                "git-span",
                "config",
                "s",
                "copy_detection",
                "any-file-in-repo",
            ][..],
            &["git-span", "delete", "s"][..],
            &["git-span", "merge-driver", "base", "ours", "theirs", "7"][..],
            &["git-span", "resolve", "s"][..],
        ] {
            assert_eq!(parsed_mode(args), Some(Mode::Exclusive), "{args:?}");
        }
    }

    #[test]
    fn shared_holders_block_an_exclusive_writer() -> Result<()> {
        let directory = tempfile::tempdir()?;
        gix::init(directory.path())?;
        let repo = gix::open(directory.path())?;
        let first = acquire(&repo, Mode::Shared)?;
        let path = directory.path().to_path_buf();
        let (tx, rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || -> Result<()> {
            let repo = gix::open(path)?;
            let _guard = acquire(&repo, Mode::Exclusive)?;
            tx.send(())?;
            Ok(())
        });
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(100))
                .is_err()
        );
        drop(first);
        rx.recv_timeout(std::time::Duration::from_secs(2))?;
        writer.join().expect("writer thread panicked")?;
        Ok(())
    }

    #[test]
    fn acquire_uncontended_succeeds_without_waiting() -> Result<()> {
        let directory = tempfile::tempdir()?;
        gix::init(directory.path())?;
        let repo = gix::open(directory.path())?;
        let started = Instant::now();
        let guard = acquire(&repo, Mode::Exclusive)?;
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "an uncontended acquisition must take the fast try-lock path, not wait"
        );
        drop(guard);
        Ok(())
    }

    #[test]
    fn contended_exclusive_lock_times_out_within_budget_with_named_message() -> Result<()> {
        // SAFETY: nextest runs each test in its own process, so no other
        // thread in this process reads or writes the environment.
        unsafe {
            std::env::set_var("GIT_SPAN_LOCK_WAIT_SECS", "1");
        }
        let result = (|| -> Result<()> {
            let directory = tempfile::tempdir()?;
            gix::init(directory.path())?;
            let repo = gix::open(directory.path())?;
            let _held = acquire(&repo, Mode::Exclusive)?;

            let started = Instant::now();
            let result = acquire(&repo, Mode::Exclusive);
            let elapsed = started.elapsed();
            let err = match result {
                Ok(_) => panic!("a second exclusive acquisition must fail once the budget elapses"),
                Err(e) => e,
            };

            assert!(
                elapsed < Duration::from_secs(10),
                "the wait must be bounded by the 1s budget, not hang; took {elapsed:?}"
            );
            let message = err.to_string();
            assert!(
                message.contains("timed out after 1s waiting for the repository lock `"),
                "message should name the timeout budget; got: {message}"
            );
            assert!(
                message.ends_with(
                    "recovery-domain.lock`. Another `git span` process is \
                     still holding it — wait for it to finish and re-run."
                ),
                "message should name the lock path and give the recovery instruction, \
                 without suggesting the lock file be deleted; got: {message}"
            );
            Ok(())
        })();
        // SAFETY: see the matching `set_var` above.
        unsafe {
            std::env::remove_var("GIT_SPAN_LOCK_WAIT_SECS");
        }
        result
    }

    #[test]
    #[cfg(unix)]
    fn lock_creation_stays_on_retained_git_directory_after_parent_swap() -> Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir()?;
        gix::init(directory.path())?;
        let repo = gix::open(directory.path())?;
        let public = directory.path().join(".git/span");
        std::fs::create_dir(&public)?;
        let retained = directory.path().join(".git/span-retained");
        let attacker = directory.path().join("attacker-runtime");
        std::fs::create_dir(&attacker)?;
        let public_for_hook = public.clone();
        let retained_for_hook = retained.clone();
        let attacker_for_hook = attacker.clone();
        let mut swapped = false;
        let guard = crate::descriptor_authority::with_test_boundary_hook(
            move |boundary| {
                if boundary == "open-or-create" && !swapped {
                    std::fs::rename(&public_for_hook, &retained_for_hook).unwrap();
                    symlink(&attacker_for_hook, &public_for_hook).unwrap();
                    swapped = true;
                }
            },
            || acquire(&repo, Mode::Shared),
        )?;
        assert!(retained.join("recovery-domain.lock").is_file());
        assert!(!attacker.join("recovery-domain.lock").exists());
        drop(guard);
        Ok(())
    }
}
