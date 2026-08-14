//! Update-check integration cases — Phase 2, skipped against Phase 1 stubs.
//!
//! Every case is `#[ignore]` with a one-line reason; the cases compile
//! against the stub surface and must appear as skipped in `cargo nextest
//! run`, never failing. Phase 3 implements and unskips them one at a time.
//!
//! The local HTTP server and PTY plumbing here are the *real* mechanisms the
//! plan pins — no mocks: `GIT_SPAN_UPDATE_CHECK_URL` points the child at a
//! `std::net::TcpListener` serving a synthetic payload once;
//! `script -qec` gives the foreground a real TTY (piped capture would
//! self-suppress); `which` guards the PTY cases on hosts without `script`.
//!
//! Exit-code assertions mirror `cases/cli_exit_codes.rs`: the update check
//! must never shift 0 / 1 / 2.

use crate::support;

use anyhow::{Context, Result};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::time::Duration;
use support::TestRepo;

/// The synthetic tag the local releases server reports as latest — newer
/// than the built CLI's `CARGO_PKG_VERSION` (1.1.5), so the CLI itself is
/// behind.
const NEWER_TAG: &str = "git-span-v9.9.9";

/// The heading every update-check note carries. The absence assertions grep
/// for this exact string, so Phase 3's `message::render` must emit it.
const NOTE_HEADING: &str = "Update available";

/// A two-release payload whose first entry is [`NEWER_TAG`] — GitHub lists
/// newest-first by creation time, so the checker takes the first entry that
/// passes the draft/prerelease filter.
fn synthetic_payload() -> String {
    format!(
        r#"[
          {{ "tag_name": "{NEWER_TAG}", "name": "{NEWER_TAG}", "draft": false, "prerelease": false }},
          {{ "tag_name": "git-span-v1.1.4", "name": "git-span-v1.1.4", "draft": false, "prerelease": false }}
        ]"#
    )
}

/// Bind a one-shot HTTP server on an ephemeral port that answers any
/// request with `body` after `delay`, then closes. The listener lives on
/// the serving thread; returns the port.
fn serve_once(body: String, delay: Duration) -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if let Ok((mut stream, _)) = listener.accept() {
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok(port)
}

/// The update-check env overrides shared by every case: a local releases
/// URL, an isolated store, and an empty plugin-cache base.
fn update_env(port: u16, db: &Path, cache: &Path) -> Vec<(String, String)> {
    vec![
        (
            "GIT_SPAN_UPDATE_CHECK_URL".to_string(),
            format!("http://127.0.0.1:{port}/"),
        ),
        (
            "GIT_SPAN_UPDATE_CHECK_DB".to_string(),
            db.to_str().expect("db path is utf-8").to_string(),
        ),
        (
            "GIT_SPAN_PLUGIN_CACHE_ROOT".to_string(),
            cache.to_str().expect("cache path is utf-8").to_string(),
        ),
    ]
}

/// Borrowed view of [`update_env`]'s output for the harness entry points.
fn env_refs(env: &[(String, String)]) -> Vec<(&str, &str)> {
    env.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect()
}

/// Run `command` inside a real PTY (`script -qec`) so git-span observes a
/// TTY stdout. Returns `Ok(None)` when `script` is not available on this
/// host — the `which` guard the plan requires.
fn run_pty(
    repo: &TestRepo,
    env: &[(&str, &str)],
    command: &str,
) -> Result<Option<std::process::Output>> {
    let Ok(script) = which::which("script") else {
        return Ok(None);
    };
    let mut cmd = std::process::Command::new(script);
    cmd.current_dir(repo.path());
    for (key, value) in env {
        cmd.env(key, value);
    }
    cmd.arg("-qec").arg(command).arg("/dev/null");
    let out = cmd.output().context("spawn script")?;
    Ok(Some(out))
}

#[test]
#[ignore = "Phase 3: maybe_engage must spawn a detached child that never prints on first run"]
fn first_tty_run_prints_nothing_and_only_spawns() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // The slow server keeps the detached child from finishing before the
    // foreground command, so the first run has nothing stored to print.
    let port = serve_once(synthetic_payload(), Duration::from_secs(2))?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    let Some(out) = run_pty(&repo, &env, "git span list")? else {
        return Ok(()); // no PTY runner on this host — nothing to assert
    };
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "the first run must print no note (spawn only); stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: the child must fetch, scan, and stamp the store synchronously"]
fn direct_sync_child_stamps_the_store() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let db = db_dir.path().join("update-check.db");
    let env = update_env(port, &db, cache_dir.path());
    let env = env_refs(&env);

    let out = repo.run_span_with_envs(["__update-check"], &env)?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !String::from_utf8(out.stdout)?.contains(NOTE_HEADING),
        "the child itself must not print a note"
    );

    // The child stamped last_checked_at unconditionally and wrote the cli
    // finding on success.
    let conn = rusqlite::Connection::open(&db)?;
    use rusqlite::OptionalExtension;
    let checked: Option<i64> = conn
        .query_row(
            "SELECT last_checked_at FROM update_check WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    assert!(checked.is_some(), "the child must stamp last_checked_at");
    let version: String = conn.query_row(
        "SELECT observed_version FROM update_check_findings WHERE tool = 'cli'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(version, "9.9.9", "the cli finding must record the newer tag");
    Ok(())
}

#[test]
#[ignore = "Phase 3: maybe_remind must print once per 24h, then stay silent"]
fn tty_first_run_prints_note_second_run_prints_nothing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    // Seed the store synchronously so the reminder has findings to show —
    // the detached child of a foreground run races the command and cannot
    // be awaited (the feature never waits).
    let out = repo.run_span_with_envs(["__update-check"], &env)?;
    assert_eq!(out.status.code(), Some(0));

    let Some(first) = run_pty(&repo, &env, "git span list")? else {
        return Ok(());
    };
    assert_eq!(first.status.code(), Some(0));
    let stdout = String::from_utf8(first.stdout)?;
    assert!(
        stdout.contains(NOTE_HEADING),
        "a TTY run behind the latest release must print the note; stdout:\n{stdout}"
    );

    // The reminder stamped last_reminded_at; a second run the same day
    // prints nothing.
    let Some(second) = run_pty(&repo, &env, "git span list")? else {
        return Ok(());
    };
    assert_eq!(second.status.code(), Some(0));
    let stdout = String::from_utf8(second.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "the second run the same day must stay silent; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: effective-format machine-output suppression not implemented"]
fn porcelain_invocation_prints_nothing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    let Some(out) = run_pty(&repo, &env, "git span list --porcelain")? else {
        return Ok(());
    };
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "machine-readable output must suppress the note; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: non-TTY stdout suppression not implemented"]
fn piped_stdout_prints_nothing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    // run_span captures stdout through a pipe — the harness itself is the
    // non-TTY caller.
    let out = repo.run_span_with_envs(["list"], &env)?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "piped stdout must suppress the note; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: env-var suppression not implemented"]
fn disable_env_var_prints_nothing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let mut env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    env.push((
        "GIT_SPAN_DISABLE_UPDATE_CHECK".to_string(),
        "1".to_string(),
    ));
    let env = env_refs(&env);

    let Some(out) = run_pty(&repo, &env, "git span list")? else {
        return Ok(());
    };
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "GIT_SPAN_DISABLE_UPDATE_CHECK must suppress the note; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: the pre-parse classifier splice is what makes this case pass"]
fn update_check_subcommand_runs_synchronously_and_is_not_a_span_name() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    let out = repo.run_span_with_envs(["__update-check"], &env)?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8(out.stderr)?;
    assert!(
        !stderr.contains("no such span") && !stderr.contains("does not exist"),
        "`__update-check` must not be misclassified as a span name; stderr:\n{stderr}"
    );
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains(NOTE_HEADING),
        "the child must not print a note (internal commands never engage); stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "Phase 3: nothing in the update-check wiring may shift exit codes"]
fn exit_codes_unchanged_with_update_check_env() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let port = serve_once(synthetic_payload(), Duration::ZERO)?;
    let db_dir = tempfile::tempdir()?;
    let cache_dir = tempfile::tempdir()?;
    let env = update_env(port, &db_dir.path().join("update-check.db"), cache_dir.path());
    let env = env_refs(&env);

    let ok = repo.run_span_with_envs(["list"], &env)?;
    assert_eq!(ok.status.code(), Some(0), "success stays 0");

    let operational = repo.run_span_with_envs(["delete", "never-existed"], &env)?;
    assert_eq!(operational.status.code(), Some(1), "operational stays 1");

    let usage = repo.run_span_with_envs(["commit"], &env)?;
    assert_eq!(usage.status.code(), Some(2), "usage stays 2");
    Ok(())
}
