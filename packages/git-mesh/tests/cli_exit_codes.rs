//! Exit-code convention tests.
//!
//! `git-mesh` follows the POSIX/`git`/`cargo` convention:
//!
//! - 0 — success
//! - 1 — operational failure (well-formed command, environment or
//!   state prevents completion: missing mesh, nothing to do, …)
//! - 2 — usage error (clap rejected the argv: bad flag, missing
//!   required arg, unknown subcommand)
//!
//! The split lives in `packages/git-mesh/src/main.rs`: the dispatch
//! wrapper downcasts `anyhow::Error` to `clap::Error` and lets clap's
//! own `.exit()` produce code 2; everything else maps to code 1.
//!
//! Removed commands (`fetch`, `push`, `commit`, `restore`, `revert`,
//! `config`, `hooks`, `rewrite`, `compact`) now produce exit 2 (clap
//! unknown-subcommand) — tested by `removed_commands_produce_usage_error`.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn delete_missing_mesh_exits_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["delete", "never-existed"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]
fn unknown_subcommand_is_runtime_show_failure() -> Result<()> {
    // Bare `git mesh <name>` routes to `show <name>`; an unknown
    // mesh name is an operational failure (exit 1), not a usage
    // error — clap accepted the argv.
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["definitely-not-a-mesh"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]
fn help_exits_zero() -> Result<()> {
    // `--help` / `--version` are clap-handled and exit 0 via
    // `clap::Error::exit()` — the wrapper must not redirect them
    // through the runtime exit-1 path.
    let repo = TestRepo::seeded()?;
    let help = repo.run_mesh(["--help"])?;
    assert_eq!(help.status.code(), Some(0));
    let version = repo.run_mesh(["--version"])?;
    assert_eq!(version.status.code(), Some(0));
    Ok(())
}

/// Removed commands that clap recognises as unknown subcommands produce exit
/// code 2.  Commands whose names look like valid mesh names are routed through
/// `show` and produce exit 1 instead — that is acceptable and tested
/// separately.
#[test]
fn removed_commands_produce_usage_error() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // These are unambiguously unrecognised as subcommands (not close enough
    // to any valid subcommand to be routed through `show`).
    let clap_rejected = [
        "commit", "restore", "revert", "config", "fetch", "push", "hooks", "rewrite",
    ];
    for cmd in clap_rejected {
        let out = repo.run_mesh([cmd])?;
        assert_eq!(
            out.status.code(),
            Some(2),
            "removed command '{cmd}' should exit 2 (usage error), got {:?}",
            out.status.code()
        );
    }
    Ok(())
}

/// `compact` looks like a mesh name, so the CLI routes it to `show`; the
/// mesh does not exist → operational failure exit 1.
#[test]
fn compact_treated_as_show_exits_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["compact"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "compact should be routed to show and exit 1 (no such mesh)"
    );
    Ok(())
}
