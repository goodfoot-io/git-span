//! Repository-wide ordering between recovery, readers, and span mutation.

use super::Commands;
use anyhow::{Context, Result};
use fs4::fs_std::FileExt;
use std::ffi::OsStr;
use std::fs::File;

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
        Commands::Context(_) | Commands::ContextService(_) => None,
        Commands::Drift(args) if args.fix => Some(Mode::Exclusive),
        Commands::Why(args) if args.why_text.is_some() => Some(Mode::Exclusive),
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
        | Commands::Doctor(_)
        | Commands::Tree(_)
        | Commands::History(_)
        | Commands::Resolve(_) => Some(Mode::Shared),
    }
}

pub(crate) fn acquire(repo: &gix::Repository, mode: Mode) -> Result<Guard> {
    let git_directory = RetainedDirectory::open_canonical(crate::git::git_dir(repo))?;
    let lock_directory = git_directory.descend(
        std::path::Path::new("span"),
        DirectoryPolicy::Create { mode: 0o755 },
    )?;
    let file = lock_directory
        .open_or_create_file(OsStr::new("recovery-domain.lock"), 0o600)
        .context("open repository recovery-domain lock")?;
    match mode {
        Mode::Shared => file.lock_shared(),
        Mode::Exclusive => file.lock_exclusive(),
    }
    .context("acquire repository recovery-domain lock")?;
    Ok(Guard { _file: file })
}

/// Enter the shared reader domain only after settling any crash-left prepared
/// context repair. The common path takes one shared lock and one marker stat.
/// A pending marker forces an exclusive recovery pass, followed by an atomic
/// `flock` downgrade on the same descriptor so no writer can enter between
/// recovery and the caller's read.
pub(crate) fn acquire_reader(repo: &gix::Repository, span_root: &str) -> Result<Guard> {
    let shared = acquire(repo, Mode::Shared)?;
    let Some(runtime) = super::context_repair::pending_runtime(repo, span_root)? else {
        return Ok(shared);
    };

    drop(shared);
    let exclusive = acquire(repo, Mode::Exclusive)?;
    super::context_repair::recover_pending_locked(repo, span_root, &runtime)?;
    exclusive
        ._file
        .lock_shared()
        .context("downgrade recovered repository domain to shared")?;
    Ok(exclusive)
}

/// Enter the exclusive writer domain after settling any crash-left prepared
/// context repair. Recovery runs while this same guard remains exclusive, so
/// the handler can subsequently take its per-span locks without exposing a
/// gap or inverting the repository-before-span lock order.
pub(crate) fn acquire_writer(repo: &gix::Repository, span_root: &str) -> Result<Guard> {
    let exclusive = acquire(repo, Mode::Exclusive)?;
    if let Some(runtime) = super::context_repair::pending_runtime(repo, span_root)? {
        super::context_repair::recover_pending_locked(repo, span_root, &runtime)?;
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
