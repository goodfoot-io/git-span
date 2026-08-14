//! Repository-wide ordering between recovery, readers, and span mutation.

#![allow(dead_code)] // Removed when the dispatcher activates this TDD contract.

use super::Commands;
use anyhow::Result;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Mode {
    Shared,
    Exclusive,
}

pub(crate) struct Guard;

pub(crate) fn command_mode(command: &Commands) -> Mode {
    match command {
        Commands::Drift(args) if args.fix => Mode::Exclusive,
        Commands::Why(args) if args.why_text.is_some() => Mode::Exclusive,
        Commands::Resolve(args) if !args.dry_run => Mode::Exclusive,
        Commands::Add(_)
        | Commands::Remove(_)
        | Commands::Replace(_)
        | Commands::Delete(_)
        | Commands::MergeDriver(_) => Mode::Exclusive,
        Commands::Show(_)
        | Commands::List(_)
        | Commands::Drift(_)
        | Commands::Why(_)
        | Commands::Doctor(_)
        | Commands::Tree(_)
        | Commands::History(_)
        | Commands::Resolve(_) => Mode::Shared,
    }
}

pub(crate) fn acquire(_repo: &gix::Repository, _mode: Mode) -> Result<Guard> {
    anyhow::bail!("recovery-domain contract is not implemented")
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    fn parsed_mode(args: &[&str]) -> Mode {
        let cli = crate::cli::Cli::try_parse_from(args).expect("command should parse");
        command_mode(cli.command.as_ref().expect("command should be present"))
    }

    #[test]
    #[ignore = "TDD contract: activate with retained descriptor acquisition"]
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
            assert_eq!(parsed_mode(args), Mode::Shared, "{args:?}");
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
            assert_eq!(parsed_mode(args), Mode::Exclusive, "{args:?}");
        }
    }

    #[test]
    #[ignore = "TDD contract: activate with retained descriptor acquisition"]
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
}
