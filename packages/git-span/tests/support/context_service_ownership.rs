//! A service instance must retain exclusive ownership for its entire lifetime.

#![cfg(target_os = "linux")]

use anyhow::{Context, Result};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
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

fn spawn_service(repo: &Path, key: &str, nonce: &str) -> Result<Service> {
    Ok(Service(
        Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo)
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

pub fn assert_single_owner() -> Result<()> {
    let repo = tempfile::tempdir()?;
    gix::init(repo.path())?;
    std::fs::create_dir(repo.path().join(".span"))?;
    let key = uuid::Uuid::new_v4().simple().to_string();
    let runtime = git_span::descriptor_authority::RuntimeAuthority::open(&key)?;
    let directory = runtime.directory()?;
    let socket = directory.display_path().join("service.sock");
    let nonce = uuid::Uuid::new_v4().to_string();
    directory.atomic_write(
        std::ffi::OsStr::new("instance.nonce"),
        nonce.as_bytes(),
        0o600,
    )?;
    let mut first = spawn_service(repo.path(), &key, &nonce)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if health(&socket, &key, &nonce).is_ok() {
            break;
        }
        anyhow::ensure!(first.0.try_wait()?.is_none(), "first service exited");
        anyhow::ensure!(
            Instant::now() < deadline,
            "first service never became ready"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let original_inode = std::fs::metadata(&socket)?.ino();
    let mut second = spawn_service(repo.path(), &key, &uuid::Uuid::new_v4().to_string())?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let inode = std::fs::metadata(&socket)
            .context("second service removed the live owner's socket")?
            .ino();
        assert_eq!(
            inode, original_inode,
            "second service replaced a live owner's socket, leaving two daemons for one service key"
        );
        if second.0.try_wait()?.is_some() {
            break;
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "duplicate service did not reject ownership"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    health(&socket, &key, &nonce).context("original service lost ownership")?;
    drop(second);
    drop(first);
    std::fs::remove_dir_all(directory.display_path())?;
    Ok(())
}
