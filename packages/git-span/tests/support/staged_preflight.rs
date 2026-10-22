//! Minimal portable fixture for standalone staged-preflight CLI contracts.
use anyhow::{Result, ensure};
use serde_json::Value;
use std::process::{Command, Output};
pub struct Repo(pub tempfile::TempDir);
impl Repo {
    pub fn new() -> Result<Self> {
        let repo = Self(tempfile::tempdir()?);
        repo.git(&["init", "-q"])?;
        repo.git(&["config", "user.name", "preflight-test"])?;
        repo.git(&["config", "user.email", "preflight@example.test"])?;
        repo.write("a.txt", "first\nsecond\n")?;
        repo.git(&["add", "."])?;
        repo.git(&["commit", "-qm", "initial"])?;
        Ok(repo)
    }
    pub fn write(&self, path: &str, body: &str) -> Result<()> {
        if let Some(parent) = self.0.path().join(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(self.0.path().join(path), body)?;
        Ok(())
    }
    pub fn git(&self, args: &[&str]) -> Result<String> {
        let out = Command::new("git")
            .current_dir(self.0.path())
            .args(args)
            .output()?;
        ensure!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(String::from_utf8(out.stdout)?.trim().into())
    }
    pub fn output(&self, args: &[&str]) -> Result<Output> {
        Ok(Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(self.0.path())
            .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
            .args(args)
            .output()?)
    }
    pub fn span(&self, args: &[&str]) -> Result<Value> {
        let out = self.output(args)?;
        ensure!(
            out.status.success(),
            "span {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(serde_json::from_slice(&out.stdout)?)
    }
}

#[cfg(unix)]
pub fn stage_symlink(repo: &Repo) -> Result<()> {
    std::os::unix::fs::symlink("a.txt", repo.0.path().join("link"))?;
    repo.git(&["add", "link"])?;
    Ok(())
}
#[cfg(not(unix))]
pub fn stage_symlink(_repo: &Repo) -> Result<()> {
    Ok(())
}
