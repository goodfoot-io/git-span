//! Raw RPC fixture for requests arriving while a capture holds shared state.

#![cfg(target_os = "linux")]

use anyhow::{Context, Result};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Service(Child);

impl Drop for Service {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn_service(repo: &Path, key: &str, nonce: &str, hooks: &Path) -> Result<Service> {
    Ok(Service(
        Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo)
            .env("GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR", hooks)
            .args([
                "__context-service",
                "--service-key",
                key,
                "--nonce",
                nonce,
                "--span-root",
                ".span",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    ))
}

fn health(socket: &Path, key: &str, nonce: &str) -> Result<()> {
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let request = serde_json::to_vec(&serde_json::json!({
        "protocol": 1,
        "service_key": key,
        "nonce": nonce,
        "request_id": uuid::Uuid::new_v4().to_string(),
        "op": {"kind": "health"}
    }))?;
    stream.write_all(&(request.len() as u32).to_be_bytes())?;
    stream.write_all(&request)?;
    let mut prefix = [0; 4];
    stream.read_exact(&mut prefix)?;
    let mut response = vec![0; u32::from_be_bytes(prefix) as usize];
    stream.read_exact(&mut response)?;
    let response: serde_json::Value = serde_json::from_slice(&response)?;
    anyhow::ensure!(response["ok"] == true, "health request rejected");
    Ok(())
}

fn send_query(socket: &Path, key: &str, nonce: &str) -> Result<UnixStream> {
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(Duration::from_millis(350)))?;
    let request = serde_json::to_vec(&serde_json::json!({
        "protocol": 1, "service_key": key, "nonce": nonce,
        "request_id": uuid::Uuid::new_v4().to_string(),
        "op": {"kind": "query", "addresses": ["source"]}
    }))?;
    stream.write_all(&(request.len() as u32).to_be_bytes())?;
    stream.write_all(&request)?;
    Ok(stream)
}

pub fn assert_busy_query_returns_fallback() -> Result<()> {
    let repo = tempfile::tempdir()?;
    gix::init(repo.path())?;
    std::fs::create_dir(repo.path().join(".span"))?;
    std::fs::write(repo.path().join("source"), "content\n")?;
    anyhow::ensure!(
        Command::new("git")
            .current_dir(repo.path())
            .args(["add", "source"])
            .status()?
            .success()
    );
    anyhow::ensure!(
        Command::new("git")
            .current_dir(repo.path())
            .args([
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "seed"
            ])
            .status()?
            .success()
    );
    let hooks = tempfile::tempdir()?;
    let key = uuid::Uuid::new_v4().simple().to_string();
    let runtime = git_span::descriptor_authority::RuntimeAuthority::open(&key)?;
    let directory = runtime.directory()?;
    let socket = directory.display_path().join("service.sock");
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut service = spawn_service(repo.path(), &key, &nonce, hooks.path())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while health(&socket, &key, &nonce).is_err() {
        anyhow::ensure!(service.0.try_wait()?.is_none(), "service exited");
        anyhow::ensure!(Instant::now() < deadline, "service never became ready");
        std::thread::sleep(Duration::from_millis(10));
    }
    let checkpoint = "generation-before-publication";
    std::fs::write(hooks.path().join(format!("{checkpoint}.arm")), "armed")?;
    let first = send_query(&socket, &key, &nonce)?;
    let ready = hooks.path().join(format!("{checkpoint}.ready"));
    let deadline = Instant::now() + Duration::from_secs(5);
    let token = loop {
        if let Ok(token) = std::fs::read_to_string(&ready) {
            break token;
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "first query never held state mutex"
        );
        std::thread::sleep(Duration::from_millis(5));
    };
    let mut second = send_query(&socket, &key, &nonce)?;
    let mut prefix = [0; 4];
    let result = second.read_exact(&mut prefix);
    std::fs::write(hooks.path().join(format!("{checkpoint}.release")), token)?;
    result.context(
        "busy context query queued behind another capture instead of returning fallback",
    )?;
    let mut response = vec![0; u32::from_be_bytes(prefix) as usize];
    second.read_exact(&mut response)?;
    let response: serde_json::Value = serde_json::from_slice(&response)?;
    assert_eq!(response["ok"], false);
    assert_eq!(response["fallback"], true);
    drop(first);
    drop(second);
    drop(service);
    std::fs::remove_dir_all(directory.display_path())?;
    Ok(())
}
