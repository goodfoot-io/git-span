//! Daily update check for the git-span CLI and the bundled plugin caches.
//!
//! Once a day at most, on an interactive `git span` invocation, a user who
//! is behind the latest release sees a short informational note naming what
//! is out of date and the exact command that brings it current. The GitHub
//! API call and plugin-cache reads happen in a detached background child of
//! the invoking process; the foreground command's latency and exit code are
//! untouched; nothing blocks on any failure. Automated or scripted use never
//! triggers the check or the message (see [`suppress`]).
//!
//! Flow: [`maybe_engage`] (called from `dispatch` after span-root resolution
//! and the recovery-domain guard) runs the suppression gate, reads the
//! cadence state, and when the 24h check is due spawns the detached
//! `__update-check` child — never waiting on it. The child
//! ([`run_update_check_child`]) re-reads `last_checked_at` at start (a
//! parallel invocation may have won the spawn race), fetches the releases
//! payload, scans the Claude and Codex plugin caches, and stamps
//! `last_checked_at` unconditionally — with an empty findings map on fetch
//! failure, so an offline machine pays one failed attempt per day. The child
//! never prints to stdout; it appends one diagnostic line per run to
//! `update-check.log`, the same sink its stdio is redirected to when
//! detached. On a command's `Ok` path, [`maybe_remind`] runs the
//! suppression gate again, re-reads the state immediately before printing,
//! and when the 24h reminder cadence has elapsed and something is behind the
//! stored latest release claims the print slot with an atomic conditional
//! stamp ([`store::UpdateCheckStore::claim_reminded`]) — of two concurrent
//! TTY runs that both decided to remind, exactly one wins and prints (the
//! stored `cli` finding *is* the latest release — the child records the
//! fetched release version). Every failure at any step is a silent no-op;
//! the note never changes a command's exit code.

pub mod decide;
pub mod message;
pub mod plugins;
pub mod releases;
pub mod store;
pub mod suppress;

use std::collections::BTreeMap;
use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use semver::Version;

use crate::cli::Cli;
use crate::update_check::store::UpdateCheckStore;

/// The GitHub Releases API endpoint the child fetches. Overridable via
/// `GIT_SPAN_UPDATE_CHECK_URL` — the integration tests point it at a local
/// one-shot HTTP server.
const DEFAULT_RELEASES_URL: &str =
    "https://api.github.com/repos/goodfoot-io/git-span/releases?per_page=5";

/// Foreground seam, called from `dispatch` after span-root resolution and
/// the recovery-domain guard: read the suppression signals, decide whether
/// the 24h check cadence is due, and spawn the detached `__update-check`
/// child. Never waits on the child; a failure at any step is a silent no-op.
pub fn maybe_engage(cli: &Cli) {
    // Suppression gate first — an automated or machine-readable context
    // never even reads the store, so the feature leaves no trace there.
    if suppress::signals_for(cli, std::io::stdout().is_terminal()).suppressed() {
        return;
    }
    let Some(store) = UpdateCheckStore::open() else {
        return;
    };
    let state = store.read_state();
    let Some(now) = now_secs() else {
        return;
    };
    if !decide::should_spawn_check(state.as_ref(), now) {
        return;
    }
    spawn_detached_child();
}

/// Foreground seam, called on a command's `Ok` path: read the stored
/// findings and the reminder cadence, atomically claim the print slot, and
/// print the note when something is behind and the claim wins. Never
/// affects the command's output beyond the note or its exit code.
pub fn maybe_remind(cli: &Cli) {
    if suppress::signals_for(cli, std::io::stdout().is_terminal()).suppressed() {
        return;
    }
    let Some(store) = UpdateCheckStore::open() else {
        return;
    };
    // Re-read immediately before printing — the state is whatever the check
    // child last wrote, and a concurrent TTY run may have just reminded.
    let Some(state) = store.read_state() else {
        return;
    };
    let Some(current) = current_version() else {
        return;
    };
    let Some(now) = now_secs() else {
        return;
    };
    let Some(reminder) = decide::should_remind(Some(&state), &current, now) else {
        return;
    };
    // `should_remind` only returns a reminder when the stored `cli` row
    // exists (it is the staleness baseline), so the guard is unreachable in
    // practice — kept for the fail-closed no-panic contract.
    let Some(latest) = state.findings.get("cli") else {
        return;
    };
    // Claim the print slot atomically BEFORE printing: the conditional stamp
    // compares against the `last_reminded_at` this decision was computed
    // from, so of two concurrent TTY runs that both decided to remind,
    // exactly one wins the claim — the other prints nothing. (The naive
    // print-then-stamp order leaves the window open: both can read the old
    // stamp and print before either writes.)
    let Some(claimed) = store.claim_reminded(state.last_reminded_at, now) else {
        return;
    };
    if !claimed {
        return;
    }
    let note = message::render(&reminder, latest);
    // The note is informational: a write failure (dead PTY — the invoking
    // shell exited mid-run) silently drops it. It must never panic (a
    // `print!` on a dead PTY panics with exit 101) or change the command's
    // exit code.
    let _ = std::io::stdout().write_all(note.as_bytes());
}

/// The `__update-check` child body: re-read `last_checked_at` at start
/// (another process may have refreshed it meanwhile — the parallel
/// invocation spawn race then degrades to a harmless no-op), fetch the
/// releases payload, scan the plugin caches, and stamp `last_checked_at`
/// unconditionally with the findings on success only (an empty map on fetch
/// failure — one failed attempt per day). Never prints to stdout: its one
/// diagnostic line per run is appended to `update-check.log`, the same sink
/// the detached spawn redirects its stdio to — a silent failure is then
/// still distinguishable from a clean check by looking at the log.
pub fn run_update_check_child() {
    let Some(store) = UpdateCheckStore::open() else {
        return;
    };
    let Some(now) = now_secs() else {
        return;
    };
    let state = store.read_state();
    if let Some(state) = state.as_ref()
        && now - state.last_checked_at < decide::DAY
    {
        // A parallel spawn won the race and refreshed the state meanwhile.
        return;
    }
    // Claim the check slot BEFORE fetching: a fresh install's first few
    // invocations each see an empty store and decide the check is due, so
    // several children can spawn and fetch before the first one stamps.
    // Pre-stamping collapses the burst — the next invocation reads a
    // same-day stamp and spawns nothing, even while this fetch is in
    // flight. Findings and the reminder stamp are untouched (the
    // `ON CONFLICT` updates `last_checked_at` only).
    let _ = store.stamp_checked(now);
    let findings = fetch_findings();
    let _ = store.write_checked(now, &findings);
    append_child_log_line(now, &findings);
}

/// Append the child's one diagnostic line to `update-check.log` beside the
/// store: the stamp time, the outcome, and the stored findings. Failures
/// are silent no-ops — diagnostics must never take down the check.
fn append_child_log_line(now: i64, findings: &BTreeMap<String, Version>) {
    let Some(db_path) = store::db_path() else {
        return;
    };
    let Ok(mut log) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(db_path.with_extension("log"))
    else {
        return;
    };
    if findings.is_empty() {
        let _ = writeln!(log, "checked at {now}: fetch failed");
    } else {
        let summary = findings
            .iter()
            .map(|(tool, version)| format!("{tool}={version}"))
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(log, "checked at {now}: {summary}");
    }
}

/// Unix seconds now — the cadence stamp convention shared with the store.
fn now_secs() -> Option<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

/// The running CLI's version. A parse failure fails closed: no reminder,
/// silent.
fn current_version() -> Option<Version> {
    Version::parse(env!("CARGO_PKG_VERSION")).ok()
}

/// Spawn the detached `__update-check` child: `current_exe()` with the
/// hidden subcommand, stdin `/dev/null`, stdout+stderr appended to
/// `update-check.log` beside the per-user store, session-detached on Unix
/// and window-less in a fresh process group on Windows (the
/// `context_service` spawn shape). Never waits on the child — spawn, drop
/// the handle, return. Every failure is a silent no-op.
fn spawn_detached_child() {
    let Some(db_path) = store::db_path() else {
        return;
    };
    let log_path = db_path.with_extension("log");
    let Some(executable) = std::env::current_exe().ok() else {
        return;
    };
    let Ok(log) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path)
    else {
        return;
    };
    let Ok(log_error) = log.try_clone() else {
        return;
    };
    let mut command = Command::new(executable);
    command
        .arg("__update-check")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_error));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Detach into a new session so the child survives the foreground
        // process exiting (the context-service spawn shape).
        unsafe {
            let _ = command.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{
            CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
        };
        // First Windows detached-spawn in the crate: no console window, and
        // its own process group. The child still belongs to the parent's
        // console session, so closing the terminal can interrupt it
        // mid-check — harmless, the next day retries (acknowledged
        // limitation; the cfg(windows) path is not compiled on this host).
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    // Never wait on the child; the dropped handle detaches it (std's Child
    // does not kill on drop).
    let _ = command.spawn();
}

/// Fetch the latest release version: one GET with a 10s end-to-end timeout,
/// no retries, no auth. `GIT_SPAN_UPDATE_CHECK_URL` overrides the default
/// GitHub Releases API endpoint (tests point it at a local server). Any
/// failure — DNS, connect, timeout, non-2xx, malformed payload — is `None`
/// (fail-closed: no finding).
fn fetch_latest_release() -> Option<Version> {
    let url = std::env::var("GIT_SPAN_UPDATE_CHECK_URL")
        .unwrap_or_else(|_| DEFAULT_RELEASES_URL.to_string());
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .new_agent();
    let mut response = agent.get(url).call().ok()?;
    let payload = response.body_mut().read_to_string().ok()?;
    releases::latest_release_from_payload(&payload)
}

/// The scan root for one tool's plugin cache. Precedence (plugins.rs module
/// docs): `GIT_SPAN_PLUGIN_CACHE_ROOT/{tool}/plugins/cache` (the test
/// override), then the tool's config-dir override (`CLAUDE_CONFIG_DIR` /
/// `CODEX_HOME` — non-empty only), then `$HOME/.{claude,codex}/plugins/cache`.
fn cache_root_for(tool: &str) -> Option<PathBuf> {
    if let Ok(root) = std::env::var("GIT_SPAN_PLUGIN_CACHE_ROOT")
        && !root.is_empty()
    {
        return Some(PathBuf::from(root).join(tool).join("plugins").join("cache"));
    }
    match tool {
        "claude" => {
            if let Ok(config_dir) = std::env::var("CLAUDE_CONFIG_DIR")
                && !config_dir.is_empty()
            {
                return Some(PathBuf::from(config_dir).join("plugins").join("cache"));
            }
            home_dir().map(|home| home.join(".claude").join("plugins").join("cache"))
        }
        "codex" => {
            if let Ok(codex_home) = std::env::var("CODEX_HOME")
                && !codex_home.is_empty()
            {
                return Some(PathBuf::from(codex_home).join("plugins").join("cache"));
            }
            home_dir().map(|home| home.join(".codex").join("plugins").join("cache"))
        }
        _ => None,
    }
}

/// The resolved home directory (`$HOME`, `%USERPROFILE%` on Windows), or
/// `None` when unset or empty.
fn home_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME");
    #[cfg(windows)]
    let home = home.or_else(|| std::env::var_os("USERPROFILE"));
    let home = home?;
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home))
}

/// Collect the child's findings: the fetched latest release under `cli`,
/// plus each bundled plugin's newest cached copy under its tool key. On
/// fetch failure the map is empty — the caller still stamps
/// `last_checked_at`, so an offline machine pays one failed attempt per day.
fn fetch_findings() -> BTreeMap<String, Version> {
    let mut findings = BTreeMap::new();
    let Some(latest) = fetch_latest_release() else {
        return findings;
    };
    findings.insert("cli".to_string(), latest);
    for checker in plugins::checkers() {
        let Some(root) = cache_root_for(checker.tool()) else {
            continue;
        };
        if let Some(version) = checker.find_cached_version(&root) {
            findings.insert(checker.tool().to_string(), version);
        }
    }
    findings
}
