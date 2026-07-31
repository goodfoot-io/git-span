//! A broken downstream pipe (`git span history ... | head`).

use super::*;


/// `git span history … | head` must never panic. `main` restores the default
/// `SIGPIPE` disposition before any output, so once the reader is gone the
/// renderer dies the way `git log | head` does — killed by the signal, no
/// stderr at all. Two terminations are legitimate, and which one occurs is a
/// kernel-timing race the test must not pretend to pin:
///
///  - the buffered write blocks on the full pipe, the reader closes, and the
///    next write raises `SIGPIPE` → death by signal 13, silent;
///  - the write returns `EPIPE` before the signal is delivered → the error
///    propagates through `main`'s raw-error branch as exit 1 with a single
///    broken-pipe line on stderr.
///
/// Both are non-panicking, non-zero terminations with nothing resembling a
/// crash on stderr; a Rust panic (`abort`, backtrace prose) is the one outcome
/// this test exists to rule out.
#[cfg(unix)]
#[test]
fn a_broken_downstream_pipe_never_panics_the_history_renderer() -> Result<()> {
    use std::io::Read as _;

    let repo = oversized_history_repo("bp")?;
    // Fixture assumption: the rendered document is at least twice a Linux
    // pipe's default 64KiB capacity, so the child cannot complete its write
    // before the read end closes.
    let full = history_text(&repo, "bp")?;
    anyhow::ensure!(
        full.len() > 128 * 1024,
        "fixture too small to overflow a pipe buffer: {} bytes",
        full.len()
    );

    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(["history", "bp"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    // Read a small prefix, then close the read end while the child is still
    // blocked writing the rest — the moment `head` exits mid-stream.
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut prefix = [0u8; 512];
    let n = stdout.read(&mut prefix)?;
    anyhow::ensure!(n > 0, "the child produced no output before the close");
    drop(stdout);

    let status = child.wait()?;
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("stderr is piped")
        .read_to_string(&mut stderr)?;

    assert!(
        !stderr.contains("panicked") && !stderr.contains("RUST_BACKTRACE"),
        "a broken pipe is not a crash; stderr:\n{stderr}"
    );
    assert!(
        !status.success(),
        "a truncated document must not read as a delivered one; stderr:\n{stderr}"
    );
    let died_by_sigpipe = support::terminating_signal(&status) == Some(libc::SIGPIPE);
    let errored_on_write = status.code() == Some(1) && stderr.contains("Broken pipe");
    assert!(
        died_by_sigpipe || errored_on_write,
        "expected SIGPIPE death or the raw broken-pipe error, got {status:?}; stderr:\n{stderr}"
    );
    if died_by_sigpipe {
        assert!(
            stderr.is_empty(),
            "death by SIGPIPE says nothing; stderr:\n{stderr}"
        );
    }
    Ok(())
}
