use crate::support::TestRepo;
use anyhow::Result;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn why_without_prose_fails_when_stdin_is_not_a_terminal() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["why", "automation", "the seeded reason"])?;

    let mut child = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(["why", "automation"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let deadline = Instant::now() + Duration::from_secs(1);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            child.kill()?;
            child.wait()?;
            break None;
        }
        thread::sleep(Duration::from_millis(10));
    };

    let status = status.expect(
        "`git span why <name>` blocked while its non-terminal stdin remained open; it must fail promptly",
    );
    assert_eq!(status.code(), Some(1));

    let output = child.wait_with_output()?;
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("stdin") && stderr.contains("terminal"),
        "the error must explain that non-terminal stdin is unsupported; stderr:\n{stderr}"
    );
    Ok(())
}
