//! Exit-code convention tests.
//!
//! `git-span` follows the POSIX/`git`/`cargo` convention:
//!
//! - 0 — success
//! - 1 — operational failure (well-formed command, environment or
//!   state prevents completion: missing span, nothing to do, …)
//! - 2 — usage error (clap rejected the argv: bad flag, missing
//!   required arg, unknown subcommand)
//!
//! The split lives in `packages/git-span/src/main.rs`: the dispatch
//! wrapper downcasts `anyhow::Error` to `clap::Error` and lets clap's
//! own `.exit()` produce code 2; everything else maps to code 1.
//!
//! Two commands add a retryable exception to that base convention.
//! `git span drift` returns 2 when its post-scan trailer compare fires —
//! the index changed mid-scan, so the finding set is indeterminate: the
//! retryable condition, distinct from both 0 (clean) and 1 (drift)
//! (`src/cli/drift_output.rs`). The mutation surfaces `run_add` and
//! `run_why` (write mode) return the same three-state contract as drift:
//!
//! | Code | Meaning |
//! |---|---|
//! | 0 | write succeeded and the post-write check completed and found no actionable drift |
//! | 1 | write succeeded but actionable drift remains, **or** the post-write check itself errored (the output says which: remains lines vs. `state unverified`; JSON: `DRIFT` vs `UNKNOWN` + `reason`) |
//! | 2 | write succeeded but the span-wide state is indeterminate — the resolver's `index_changed` verdict **only** (retryable, exactly as drift defines it) |
//!
//! The check-error case maps to 1, not 2, because drift does the same:
//! every non-clap error is an `Err` → exit 1, and only the index-changed
//! verdict returns 2. If the check error were 2, a retrying script could
//! loop forever on a fatal condition and exit 2 would be ambiguous between
//! retryable and fatal. Pre-write failures are unchanged (operational
//! errors → 1; clap usage errors → 2). The add/why exit rows are pinned in
//! `tests/cases/cli_reconcile_output.rs`, and the index-changed seam (the
//! only 2 that is not a clap usage error) is pinned by the unit test in
//! `src/resolver/engine/mod.rs` driving `reconcile_exit_code`.
//!
//! Removed commands (`fetch`, `push`, `commit`, `restore`, `revert`,
//! `config`, `hooks`, `rewrite`, `compact`) now produce exit 2 (clap
//! unknown-subcommand) — tested by `removed_commands_produce_usage_error`.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn delete_missing_span_exits_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["delete", "never-existed"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]
fn unknown_subcommand_is_runtime_show_failure() -> Result<()> {
    // Bare `git span <name>` routes to `show <name>`; an unknown
    // span name is an operational failure (exit 1), not a usage
    // error — clap accepted the argv.
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["definitely-not-a-span"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]
fn help_exits_zero() -> Result<()> {
    // `--help` is clap-handled and exits 0 via `clap::Error::exit()`
    // — the wrapper must not redirect it through the runtime exit-1 path.
    let repo = TestRepo::seeded()?;
    let help = repo.run_span(["--help"])?;
    assert_eq!(help.status.code(), Some(0));
    Ok(())
}

/// Removed commands that clap recognises as unknown subcommands produce exit
/// code 2.  Commands whose names look like valid span names are routed through
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
        let out = repo.run_span([cmd])?;
        assert_eq!(
            out.status.code(),
            Some(2),
            "removed command '{cmd}' should exit 2 (usage error), got {:?}",
            out.status.code()
        );
    }
    Ok(())
}

/// `compact` looks like a span name, so the CLI routes it to `show`; the
/// span does not exist → operational failure exit 1.
#[test]
fn compact_treated_as_show_exits_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["compact"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "compact should be routed to show and exit 1 (no such span)"
    );
    Ok(())
}
