//! Bounded, read-only Git/index object access for explicit staged preflight.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Component, Path},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
pub(super) const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_PATHS: usize = 20_000;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Entry {
    pub path: String,
    pub mode: String,
    pub oid: String,
}
pub(super) fn checked_path(path: &str) -> Result<()> {
    ensure!(
        path.len() <= 4096
            && !path.is_empty()
            && Path::new(path)
                .components()
                .all(|c| matches!(c, Component::Normal(_))),
        "preflight path is not repository-relative: {path}"
    );
    Ok(())
}
pub(super) fn git(repo: &gix::Repository, args: &[&str]) -> Result<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.arg("--git-dir")
        .arg(std::fs::canonicalize(repo.git_dir())?)
        .arg("--work-tree")
        .arg(crate::git::work_dir(repo)?)
        .args(["-c", "core.fsmonitor=false"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().context("start bounded preflight Git query")?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(10) {
            child.kill()?;
            child.wait()?;
            anyhow::bail!("preflight Git query exceeded 10-second deadline");
        }
        std::thread::sleep(Duration::from_millis(2));
    };
    let out = reader
        .join()
        .map_err(|_| anyhow::anyhow!("preflight stdout reader panicked"))??;
    let err = errors
        .join()
        .map_err(|_| anyhow::anyhow!("preflight stderr reader panicked"))??;
    ensure!(
        out.len() <= MAX_BYTES && err.len() <= 65536,
        "preflight Git query exceeded output bound"
    );
    ensure!(
        status.success(),
        "preflight Git query {:?} failed: {}",
        args,
        String::from_utf8_lossy(&err)
    );
    Ok(out)
}
pub(super) fn entries(repo: &gix::Repository) -> Result<Vec<Entry>> {
    // Read flags from the actual index: ls-files --stage loses INTENT_TO_ADD,
    // which Git deliberately omits from the tree written by a commit.
    let path = std::env::var_os("GIT_INDEX_FILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| repo.index_path());
    ensure!(
        !path.as_os_str().is_empty(),
        "preflight index path is empty"
    );
    match std::fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
        Ok(meta) => ensure!(
            meta.len() <= MAX_BYTES as u64,
            "preflight index exceeds 16 MiB"
        ),
    }
    let index = gix::index::File::at(
        path,
        repo.object_hash(),
        false,
        gix::index::decode::Options {
            alloc_limit_bytes: Some(MAX_BYTES),
            ..Default::default()
        },
    )?;
    ensure!(
        index.entries().len() <= MAX_PATHS,
        "preflight exceeds {MAX_PATHS} indexed paths"
    );
    let mut entries = Vec::new();
    for entry in index.entries() {
        ensure!(
            entry.stage_raw() == 0,
            "preflight refuses an unmerged index"
        );
        if entry
            .flags
            .contains(gix::index::entry::Flags::INTENT_TO_ADD)
        {
            continue;
        }
        let path = std::str::from_utf8(entry.path(&index).as_ref())
            .context("preflight requires UTF-8 repository paths")?;
        checked_path(path)?;
        let mode = format!("{:o}", entry.mode.bits());
        ensure!(
            matches!(mode.as_str(), "100644" | "100755" | "120000" | "160000"),
            "preflight refuses unsupported sparse/tree index mode {mode}"
        );
        entries.push(Entry {
            path: path.into(),
            mode,
            oid: entry.id.to_string(),
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}
pub(super) fn parse_tree_entries(bytes: &[u8]) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for record in bytes.split(|b| *b == 0).filter(|v| !v.is_empty()) {
        let record =
            std::str::from_utf8(record).context("preflight requires UTF-8 repository paths")?;
        let (meta, path) = record
            .split_once('\t')
            .context("malformed preflight Git entry")?;
        checked_path(path)?;
        let fields: Vec<_> = meta.split_whitespace().collect();
        ensure!(fields.len() == 3, "malformed preflight Git entry metadata");
        let oid = fields[2];
        entries.push(Entry {
            path: path.into(),
            mode: fields[0].into(),
            oid: oid.into(),
        });
        ensure!(
            entries.len() <= MAX_PATHS,
            "preflight exceeds {MAX_PATHS} indexed paths"
        );
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}
pub(super) fn blob(repo: &gix::Repository, entry: &Entry) -> Result<Vec<u8>> {
    let oid: gix::ObjectId = entry.oid.parse()?;
    let header = repo.find_header(oid)?;
    ensure!(
        header.size() <= MAX_BYTES as u64,
        "preflight blob exceeds 16 MiB: {}",
        entry.path
    );
    let object = repo.find_object(oid)?;
    ensure!(
        object.kind == gix::objs::Kind::Blob,
        "preflight source {} is not a blob",
        entry.path
    );
    ensure!(
        object.data.len() <= MAX_BYTES,
        "preflight blob exceeds 16 MiB: {}",
        entry.path
    );
    Ok(object.data.clone())
}
pub(super) fn head_entries(repo: &gix::Repository) -> Result<Vec<Entry>> {
    if repo.head()?.is_unborn() {
        return Ok(Vec::new());
    }
    parse_tree_entries(&git(repo, &["ls-tree", "-r", "-z", "HEAD"])?)
}
pub(super) fn span_root(repo: &gix::Repository) -> Result<String> {
    Ok(crate::span_root::resolve_span_root(
        repo,
        None,
        std::env::var("GIT_SPAN_DIR").ok().as_deref(),
    )?
    .as_str()
    .to_string())
}

/// Preserve unborn-versus-failed HEAD distinction without writing Git state.
pub(super) fn head_identity(repo: &gix::Repository) -> Result<Option<String>> {
    if repo.head()?.is_unborn() {
        Ok(None)
    } else {
        Ok(Some(repo.head_id()?.to_hex().to_string()))
    }
}
