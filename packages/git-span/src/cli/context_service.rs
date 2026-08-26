//! Private watched serving tier for `git span context`.

use super::ContextServiceArgs;
use super::context::{
    CONTEXT_SCHEMA_VERSION, ContextAnchorIdentity, ContextDocument, ContextMutation,
    ContextOverlap, ContextOverlapBasis, ContextScope, ContextSpan, MAX_CONTEXT_JSON_BYTES,
    build_service_seed, context_intersection,
};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

const PROTOCOL_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_CONTEXT_JSON_BYTES + 128 * 1024;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_WORKERS: usize = 16;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ServiceCounters {
    pub(crate) corpus_loads: u64,
    pub(crate) resolver_passes: u64,
    pub(crate) generation_hits: u64,
    pub(crate) invalidations: u64,
    pub(crate) watcher_overflows: u64,
    pub(crate) stale_fallbacks: u64,
    pub(crate) epoch_checks: u64,
    pub(crate) rows_decoded: u64,
    pub(crate) rpc_connect_us: u64,
    pub(crate) watcher_drain_us: u64,
    pub(crate) total_latency_us: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Request {
    protocol: u32,
    service_key: String,
    nonce: String,
    request_id: String,
    op: Operation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Operation {
    Health,
    Query {
        addresses: Vec<String>,
    },
    Repair {
        addresses: Vec<String>,
        operation_id: String,
    },
    Shutdown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Response {
    protocol: u32,
    ok: bool,
    fallback: bool,
    document: Option<ContextDocument>,
    error: Option<String>,
    counters: ServiceCounters,
}

#[derive(Debug)]
struct ServicePaths {
    directory: crate::descriptor_authority::RetainedDirectory,
    socket: PathBuf,
    key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct LocationIndexEntry {
    span: usize,
    ordinal: usize,
    id: String,
    basis: ContextOverlapBasis,
    location: super::context::ContextLocation,
}

#[derive(Debug)]
struct Generation {
    rows: Vec<Vec<u8>>,
    index: BTreeMap<String, Vec<LocationIndexEntry>>,
    known_paths: BTreeSet<String>,
}

impl Generation {
    fn build(repo: &gix::Repository, span_root: &str) -> Result<(Self, BTreeSet<PathBuf>)> {
        let _recovery = super::recovery_domain::acquire_reader(repo, span_root)?;
        Self::build_locked(repo, span_root)
    }

    fn build_locked(repo: &gix::Repository, span_root: &str) -> Result<(Self, BTreeSet<PathBuf>)> {
        let seed = build_service_seed(repo, span_root)?;
        let mut rows = Vec::with_capacity(seed.spans.len());
        let mut index: BTreeMap<String, Vec<LocationIndexEntry>> = BTreeMap::new();
        for (span_index, span) in seed.spans.into_iter().enumerate() {
            for anchor in &span.anchors {
                index
                    .entry(anchor.anchored.path.clone())
                    .or_default()
                    .push(LocationIndexEntry {
                        span: span_index,
                        ordinal: anchor.ordinal,
                        id: anchor.id.clone(),
                        basis: ContextOverlapBasis::Anchored,
                        location: anchor.anchored.clone(),
                    });
                if let Some(current) = &anchor.current
                    && current != &anchor.anchored
                {
                    index
                        .entry(current.path.clone())
                        .or_default()
                        .push(LocationIndexEntry {
                            span: span_index,
                            ordinal: anchor.ordinal,
                            id: anchor.id.clone(),
                            basis: ContextOverlapBasis::Current,
                            location: current.clone(),
                        });
                }
            }
            rows.push(serde_json::to_vec(&span).context("encode context row block")?);
        }
        for entries in index.values_mut() {
            entries.sort_by(|left, right| {
                (left.span, left.ordinal, left.basis).cmp(&(right.span, right.ordinal, right.basis))
            });
        }
        Ok((
            Self {
                rows,
                index,
                known_paths: seed.known_paths,
            },
            seed.external_watch_roots,
        ))
    }

    fn query(&self, scopes: Vec<ContextScope>) -> Result<(ContextDocument, u64)> {
        let mut selected: BTreeMap<usize, Vec<ContextOverlap>> = BTreeMap::new();
        for (scope_index, scope) in scopes.iter().enumerate() {
            let Some(entries) = self.index.get(&scope.path) else {
                continue;
            };
            for entry in entries {
                if let Some(intersection) = context_intersection(scope, &entry.location) {
                    selected
                        .entry(entry.span)
                        .or_default()
                        .push(ContextOverlap {
                            scope: scope_index,
                            anchor: ContextAnchorIdentity {
                                ordinal: entry.ordinal,
                                id: entry.id.clone(),
                            },
                            basis: entry.basis,
                            location: entry.location.clone(),
                            intersection,
                        });
                }
            }
        }

        let mut spans = Vec::with_capacity(selected.len());
        for (span_index, mut overlaps) in selected {
            overlaps.sort_by(|left, right| {
                (left.scope, left.anchor.ordinal, left.basis).cmp(&(
                    right.scope,
                    right.anchor.ordinal,
                    right.basis,
                ))
            });
            let row = self
                .rows
                .get(span_index)
                .ok_or_else(|| anyhow!("context location index refers to a missing row"))?;
            let mut span: ContextSpan =
                serde_json::from_slice(row).context("decode selected context row")?;
            span.overlaps = overlaps;
            spans.push(span);
        }
        spans.sort_by(|left, right| left.name.cmp(&right.name));
        let rows_decoded = spans.len() as u64;
        Ok((
            ContextDocument {
                schema_version: CONTEXT_SCHEMA_VERSION,
                scopes,
                mutation: ContextMutation::default(),
                spans,
            },
            rows_decoded,
        ))
    }
}

#[cfg(target_os = "linux")]
mod unix {
    use super::*;
    use super::super::context::normalize_service_scopes;
    use anyhow::ensure;
    use fs4::fs_std::FileExt;
    use std::ffi::CString;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Instant;

    #[derive(Debug)]
    struct WatchDrain {
        events: u64,
        overflow: bool,
        elapsed_us: u64,
        paths: BTreeSet<PathBuf>,
    }

    #[derive(Debug)]
    struct FailClosedWatcher {
        fd: OwnedFd,
        roots: Vec<PathBuf>,
        excluded: Vec<PathBuf>,
        watched: BTreeMap<PathBuf, i32>,
    }

    fn injected_watcher_failure(stage: &str) -> bool {
        std::env::var("GIT_SPAN_CONTEXT_TEST_WATCH_FAILURE")
            .ok()
            .is_some_and(|value| value.split(',').any(|candidate| candidate == stage))
    }

    impl FailClosedWatcher {
        fn new(roots: Vec<PathBuf>, excluded: Vec<PathBuf>) -> Result<Self> {
            ensure!(
                !injected_watcher_failure("backend") && !injected_watcher_failure("limit"),
                "injected watcher setup failure"
            );
            let raw_fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
            if raw_fd < 0 {
                return Err(std::io::Error::last_os_error()).context("initialize inotify watcher");
            }
            let mut watcher = Self {
                // SAFETY: inotify_init1 returned a new owned descriptor.
                fd: unsafe { OwnedFd::from_raw_fd(raw_fd) },
                roots,
                excluded,
                watched: BTreeMap::new(),
            };
            watcher.refresh()?;
            ensure!(!watcher.watched.is_empty(), "watcher installed no watches");
            Ok(watcher)
        }

        fn refresh(&mut self) -> Result<()> {
            ensure!(
                !injected_watcher_failure("replacement"),
                "injected watcher replacement failure"
            );
            for root in self.roots.clone() {
                if root.exists() {
                    self.add_tree(&root)?;
                }
            }
            Ok(())
        }

        fn add_tree(&mut self, path: &Path) -> Result<()> {
            let metadata = std::fs::symlink_metadata(path)
                .with_context(|| format!("stat watcher root {}", path.display()))?;
            ensure!(
                !metadata.file_type().is_symlink(),
                "watcher root is a symlink"
            );
            let watch_path = if metadata.is_dir() {
                path.to_path_buf()
            } else {
                path.parent()
                    .ok_or_else(|| anyhow!("watch path has no parent"))?
                    .to_path_buf()
            };
            if self
                .excluded
                .iter()
                .any(|excluded| watch_path.starts_with(excluded))
            {
                return Ok(());
            }
            self.add_watch(&watch_path)?;
            if !metadata.is_dir() {
                return Ok(());
            }
            let mut entries = std::fs::read_dir(path)
                .with_context(|| format!("enumerate watcher directory {}", path.display()))?
                .collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let child = entry.path();
                if self
                    .excluded
                    .iter()
                    .any(|excluded| child.starts_with(excluded))
                {
                    continue;
                }
                let kind = entry.file_type()?;
                if kind.is_dir() && !kind.is_symlink() {
                    self.add_tree(&child)?;
                }
            }
            Ok(())
        }

        fn add_watch(&mut self, path: &Path) -> Result<()> {
            if self.watched.contains_key(path) {
                return Ok(());
            }
            let c_path = CString::new(path.as_os_str().as_bytes())?;
            let mask = libc::IN_ATTRIB
                | libc::IN_CLOSE_WRITE
                | libc::IN_CREATE
                | libc::IN_DELETE
                | libc::IN_DELETE_SELF
                | libc::IN_MODIFY
                | libc::IN_MOVE_SELF
                | libc::IN_MOVED_FROM
                | libc::IN_MOVED_TO
                | libc::IN_UNMOUNT
                | libc::IN_IGNORED
                | libc::IN_Q_OVERFLOW;
            let descriptor =
                unsafe { libc::inotify_add_watch(self.fd.as_raw_fd(), c_path.as_ptr(), mask) };
            if descriptor < 0 {
                return Err(std::io::Error::last_os_error())
                    .with_context(|| format!("install watch for {}", path.display()));
            }
            self.watched.insert(path.to_path_buf(), descriptor);
            Ok(())
        }

        fn drain(&mut self) -> Result<WatchDrain> {
            let started = Instant::now();
            ensure!(
                !injected_watcher_failure("read") && !injected_watcher_failure("malformed"),
                "injected watcher drain failure"
            );
            if injected_watcher_failure("overflow") {
                return Ok(WatchDrain {
                    events: 1,
                    overflow: true,
                    elapsed_us: started.elapsed().as_micros() as u64,
                    paths: BTreeSet::new(),
                });
            }
            let mut buffer = [0_u8; 64 * 1024];
            let mut events = 0;
            let mut overflow = false;
            let mut paths = BTreeSet::new();
            loop {
                let count = unsafe {
                    libc::read(
                        self.fd.as_raw_fd(),
                        buffer.as_mut_ptr().cast(),
                        buffer.len(),
                    )
                };
                if count < 0 {
                    let error = std::io::Error::last_os_error();
                    if error.kind() == std::io::ErrorKind::WouldBlock {
                        break;
                    }
                    return Err(error).context("drain inotify events");
                }
                if count == 0 {
                    bail!("inotify watcher unexpectedly reached EOF");
                }
                let count = usize::try_from(count)?;
                let mut offset = 0;
                while offset + std::mem::size_of::<libc::inotify_event>() <= count {
                    let event = unsafe {
                        std::ptr::read_unaligned(
                            buffer.as_ptr().add(offset).cast::<libc::inotify_event>(),
                        )
                    };
                    events += 1;
                    overflow |= event.mask & libc::IN_Q_OVERFLOW != 0;
                    if let Some((root, _)) = self
                        .watched
                        .iter()
                        .find(|(_, descriptor)| **descriptor == event.wd)
                    {
                        if event.len == 0 {
                            paths.insert(root.clone());
                        } else {
                            use std::os::unix::ffi::OsStrExt;
                            let name_start = offset + std::mem::size_of::<libc::inotify_event>();
                            let raw = &buffer[name_start..name_start + event.len as usize];
                            let end = raw.iter().position(|byte| *byte == 0).unwrap_or(raw.len());
                            paths.insert(root.join(std::ffi::OsStr::from_bytes(&raw[..end])));
                        }
                    }
                    offset += std::mem::size_of::<libc::inotify_event>() + event.len as usize;
                }
            }
            if events > 0 {
                self.refresh()?;
            }
            Ok(WatchDrain {
                events,
                overflow,
                elapsed_us: started.elapsed().as_micros() as u64,
                paths,
            })
        }
    }

    struct ServiceState {
        repo_path: PathBuf,
        span_root: String,
        service_dir: PathBuf,
        runtime_dirs: Vec<PathBuf>,
        base_watch_roots: Vec<PathBuf>,
        watcher: FailClosedWatcher,
        generation: Arc<Generation>,
        epoch: u64,
        dirty: bool,
    }

    impl ServiceState {
        fn drain(&mut self, counters: &mut ServiceCounters) -> Result<()> {
            let drain = self.watcher.drain()?;
            counters.watcher_drain_us += drain.elapsed_us;
            counters.invalidations += drain.events;
            counters.watcher_overflows += u64::from(drain.overflow);
            if drain.events > 0 || drain.overflow {
                self.epoch = self.epoch.saturating_add(1);
                self.dirty = true;
            }
            Ok(())
        }

        /// Rebuild while the caller already holds the repository recovery
        /// domain before `ServiceState`'s mutex. Keeping lock acquisition out
        /// of this method makes the global order explicit: recovery, state.
        fn rebuild_locked(
            &mut self,
            repo: &gix::Repository,
            counters: &mut ServiceCounters,
        ) -> Result<()> {
            let (generation, external_roots) = Generation::build_locked(repo, &self.span_root)?;
            let mut roots = self.base_watch_roots.clone();
            roots.extend(external_roots);
            let mut excluded = self.runtime_dirs.clone();
            excluded.push(self.service_dir.clone());
            let mut watcher = FailClosedWatcher::new(roots, excluded)?;
            let drain = watcher.drain()?;
            ensure!(
                drain.events == 0 && !drain.overflow,
                "dependencies changed while publishing a context generation"
            );
            self.generation = Arc::new(generation);
            self.watcher = watcher;
            self.dirty = false;
            counters.corpus_loads += 1;
            counters.resolver_passes += 2;
            Ok(())
        }
    }

    fn query_state(
        shared: &Arc<Mutex<ServiceState>>,
        addresses: &[String],
    ) -> Result<(ContextDocument, ServiceCounters)> {
        let started = Instant::now();
        let mut counters = ServiceCounters::default();
        for attempt in 0..=1 {
            // Extract immutable identity without retaining the state mutex.
            // Every subsequent state access is ordered after the repository
            // recovery domain, matching repair publication's lock order.
            let (repo_path, span_root) = {
                let state = shared
                    .lock()
                    .map_err(|_| anyhow!("context service state was poisoned"))?;
                (state.repo_path.clone(), state.span_root.clone())
            };
            let repo = gix::open(&repo_path).context("reopen context service repository")?;
            let _recovery = crate::cli::recovery_domain::acquire_reader(&repo, &span_root)?;
            let (generation, scopes, epoch) = {
                let mut state = shared
                    .lock()
                    .map_err(|_| anyhow!("context service state was poisoned"))?;
                state.drain(&mut counters)?;
                if state.dirty {
                    state.rebuild_locked(&repo, &mut counters)?;
                } else {
                    counters.generation_hits = 1;
                }
                let scopes = normalize_service_scopes(
                    addresses,
                    &state.generation.known_paths,
                    &state.repo_path,
                )?;
                counters.epoch_checks += 1;
                (state.generation.clone(), scopes, state.epoch)
            };
            let (document, rows) = generation.query(scopes)?;
            counters.rows_decoded += rows;
            service_test_checkpoint("query-shared-before-stability")?;
            let stable = {
                let mut state = shared
                    .lock()
                    .map_err(|_| anyhow!("context service state was poisoned"))?;
                state.drain(&mut counters)?;
                counters.epoch_checks += 1;
                state.epoch == epoch
            };
            if stable {
                counters.total_latency_us = started.elapsed().as_micros() as u64;
                return Ok((document, counters));
            }
            ensure!(attempt == 0, "watcher epoch changed twice during one query");
            counters.stale_fallbacks += 1;
        }
        unreachable!("query loop returns or fails")
    }

    fn service_test_checkpoint(name: &str) -> Result<()> {
        let Ok(directory) = std::env::var("GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR") else {
            return Ok(());
        };
        let directory = Path::new(&directory);
        let arm = directory.join(format!("{name}.arm"));
        match std::fs::remove_file(&arm) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        }
        let token = uuid::Uuid::new_v4().to_string();
        std::fs::write(directory.join(format!("{name}.ready")), &token)?;
        let release = directory.join(format!("{name}.release"));
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if std::fs::read_to_string(&release).ok().as_deref() == Some(token.as_str()) {
                let _ = std::fs::remove_file(release);
                return Ok(());
            }
            thread::sleep(Duration::from_millis(5));
        }
        bail!("context service test checkpoint `{name}` timed out")
    }

    fn peer_uid(stream: &UnixStream) -> Result<u32> {
        let mut credentials = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let status = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut credentials as *mut libc::ucred).cast(),
                &mut length,
            )
        };
        ensure!(status == 0, "read Unix peer credentials failed");
        ensure!(
            length as usize == std::mem::size_of::<libc::ucred>(),
            "unexpected peer credential size"
        );
        Ok(credentials.uid)
    }

    fn read_frame(stream: &mut UnixStream, limit: usize) -> Result<Vec<u8>> {
        let mut prefix = [0_u8; 4];
        stream.read_exact(&mut prefix)?;
        let length = u32::from_be_bytes(prefix) as usize;
        ensure!(
            length > 0 && length <= limit,
            "RPC frame exceeds byte limit"
        );
        let mut payload = vec![0; length];
        stream.read_exact(&mut payload)?;
        Ok(payload)
    }

    fn write_frame(stream: &mut UnixStream, payload: &[u8], limit: usize) -> Result<()> {
        ensure!(
            !payload.is_empty() && payload.len() <= limit,
            "RPC frame exceeds byte limit"
        );
        let length = u32::try_from(payload.len())?;
        stream.write_all(&length.to_be_bytes())?;
        stream.write_all(payload)?;
        stream.flush()?;
        Ok(())
    }

    fn identity_paths(repo: &gix::Repository, span_root: &str) -> Result<ServicePaths> {
        let workdir = std::fs::canonicalize(crate::git::work_dir(repo)?)?;
        let git_dir = std::fs::canonicalize(crate::git::git_dir(repo))?;
        let common = std::fs::canonicalize(crate::git::common_dir(repo))?;
        let resolved_root = std::fs::canonicalize(workdir.join(span_root))?;
        let mut hasher = blake3::Hasher::new();
        for value in [
            workdir.as_os_str(),
            git_dir.as_os_str(),
            common.as_os_str(),
            resolved_root.as_os_str(),
            std::ffi::OsStr::new(env!("CARGO_PKG_VERSION")),
            std::ffi::OsStr::new(env!("GIT_SPAN_BUILD_ID")),
        ] {
            let bytes = value.as_bytes();
            hasher.update(&(bytes.len() as u64).to_le_bytes());
            hasher.update(bytes);
        }
        // The service inherits the spawning client's environment, but its identity must
        // vary only for values that can change repository contents or Git configuration.
        // Agent/session metadata is both volatile and output-irrelevant; hashing the whole
        // environment gives each hook process a private cold service.
        let mut environment = std::env::vars_os()
            .filter(|(name, _)| {
                matches!(
                    name.to_str(),
                    Some(
                        "GIT_INDEX_FILE"
                            | "GIT_OBJECT_DIRECTORY"
                            | "GIT_ALTERNATE_OBJECT_DIRECTORIES"
                            | "GIT_CONFIG_SYSTEM"
                            | "GIT_CONFIG_GLOBAL"
                            | "GIT_CONFIG_NOSYSTEM"
                            | "GIT_CONFIG_COUNT"
                    )
                ) || name
                    .to_str()
                    .is_some_and(|name| name.starts_with("GIT_CONFIG_KEY_") || name.starts_with("GIT_CONFIG_VALUE_"))
            })
            .collect::<Vec<_>>();
        environment.sort();
        for (name, value) in environment {
            hasher.update(name.as_bytes());
            hasher.update(&[0]);
            hasher.update(value.as_bytes());
            hasher.update(&[0xff]);
        }
        let key = hasher.finalize().to_hex().to_string();
        let runtime = crate::descriptor_authority::RuntimeAuthority::open(&key)?;
        let directory = runtime.directory()?;
        let socket = directory.descriptor_path(std::ffi::OsStr::new("service.sock"))?;
        Ok(ServicePaths {
            socket,
            directory,
            key,
        })
    }

    fn service_paths(repo: &gix::Repository, span_root: &str) -> Result<Option<ServicePaths>> {
        let paths = identity_paths(repo, span_root)?;
        if paths.socket.as_os_str().as_bytes().len() >= 100 {
            return Ok(None);
        }
        Ok(Some(paths))
    }

    fn rpc(paths: &ServicePaths, nonce: &str, op: Operation) -> Result<(Response, u64)> {
        paths
            .directory
            .validate_owned_socket(std::ffi::OsStr::new("service.sock"), 0o600)?;
        let started = Instant::now();
        let mut stream = UnixStream::connect(&paths.socket)?;
        let connect_us = started.elapsed().as_micros() as u64;
        ensure!(
            peer_uid(&stream)? == unsafe { libc::geteuid() },
            "service peer has another owner"
        );
        stream.set_read_timeout(Some(IO_TIMEOUT))?;
        stream.set_write_timeout(Some(IO_TIMEOUT))?;
        let request = Request {
            protocol: PROTOCOL_VERSION,
            service_key: paths.key.clone(),
            nonce: nonce.to_owned(),
            request_id: uuid::Uuid::new_v4().to_string(),
            op,
        };
        write_frame(
            &mut stream,
            &serde_json::to_vec(&request)?,
            MAX_REQUEST_BYTES,
        )?;
        let response: Response =
            serde_json::from_slice(&read_frame(&mut stream, MAX_RESPONSE_BYTES)?)?;
        ensure!(
            response.protocol == PROTOCOL_VERSION,
            "context service protocol mismatch"
        );
        Ok((response, connect_us))
    }

    fn read_nonce(paths: &ServicePaths) -> Result<String> {
        let bytes = paths
            .directory
            .read_optional(std::ffi::OsStr::new("instance.nonce"))?
            .ok_or_else(|| anyhow!("context service nonce is absent"))?;
        Ok(String::from_utf8(bytes)?.trim().to_owned())
    }

    fn health(paths: &ServicePaths) -> Result<String> {
        let nonce = read_nonce(paths)?;
        let (response, _) = rpc(paths, &nonce, Operation::Health)?;
        ensure!(response.ok, "context service health check failed");
        Ok(nonce)
    }

    fn write_nonce(paths: &ServicePaths, nonce: &str) -> Result<()> {
        paths.directory.atomic_write(
            std::ffi::OsStr::new("instance.nonce"),
            nonce.as_bytes(),
            0o600,
        )
    }

    fn start_service(paths: &ServicePaths, span_root: &str) -> Result<String> {
        if paths
            .directory
            .entry_exists(std::ffi::OsStr::new("service.sock"))?
        {
            match health(paths) {
                Ok(nonce) => return Ok(nonce),
                Err(error) => {
                    let timed_out = error.chain().any(|cause| {
                        cause
                            .downcast_ref::<std::io::Error>()
                            .is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut)
                    });
                    ensure!(
                        !timed_out,
                        "ambiguous context service timeout; strict fallback required"
                    );
                    paths
                        .directory
                        .validate_owned_socket(std::ffi::OsStr::new("service.sock"), 0o600)?;
                    paths
                        .directory
                        .unlink(std::ffi::OsStr::new("service.sock"))?;
                    paths.directory.sync()?;
                }
            }
        }
        let nonce = uuid::Uuid::new_v4().to_string();
        write_nonce(paths, &nonce)?;
        let mut log = paths
            .directory
            .open_or_create_file(std::ffi::OsStr::new("service.log"), 0o600)?;
        use std::io::Seek;
        log.seek(std::io::SeekFrom::End(0))?;
        let log_error = log.try_clone()?;
        let executable = std::env::current_exe()?;
        let mut command = Command::new(executable);
        command
            .arg("__context-service")
            .arg("--service-key")
            .arg(&paths.key)
            .arg("--nonce")
            .arg(&nonce)
            .arg("--span-root")
            .arg(span_root)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_error));
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn()?;
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut last = None;
        while Instant::now() < deadline {
            if let Some(status) = child.try_wait()? {
                bail!("context service exited before readiness: {status}");
            }
            match rpc(paths, &nonce, Operation::Health) {
                Ok((response, _)) if response.ok => return Ok(nonce),
                Ok(_) => last = Some(anyhow!("service rejected readiness handshake")),
                Err(error) => last = Some(error),
            }
            thread::sleep(Duration::from_millis(20));
        }
        Err(last.unwrap_or_else(|| anyhow!("context service startup timed out")))
    }

    fn acquire_supervisor(file: &File) -> Result<()> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            match file.try_lock_exclusive() {
                Ok(true) => return Ok(()),
                Ok(false) => {
                    ensure!(
                        Instant::now() < deadline,
                        "context supervisor election timed out"
                    );
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(error.into()),
            }
        }
    }

    pub(super) fn client_query(
        repo: &gix::Repository,
        span_root: &str,
        addresses: &[String],
    ) -> Result<Option<(ContextDocument, ServiceCounters)>> {
        if std::env::var_os("GIT_SPAN_CONTEXT_DISABLE_SERVICE").is_some() {
            return Ok(None);
        }
        let Some(paths) = service_paths(repo, span_root)? else {
            return Ok(None);
        };
        if let Ok(nonce) = read_nonce(&paths)
            && let Ok((mut response, connect_us)) = rpc(
                &paths,
                &nonce,
                Operation::Query {
                    addresses: addresses.to_vec(),
                },
            )
        {
            if response.ok {
                response.counters.rpc_connect_us = connect_us;
                let document = response
                    .document
                    .ok_or_else(|| anyhow!("context service omitted its document"))?;
                return Ok(Some((document, response.counters)));
            }
            if response.fallback {
                return Ok(None);
            }
            return Err(anyhow!(
                "context service rejected query: {}",
                response.error.unwrap_or_default()
            ));
        }
        let lock = paths
            .directory
            .open_or_create_file(std::ffi::OsStr::new("supervisor.lock"), 0o600)?;
        acquire_supervisor(&lock)?;
        let nonce = match health(&paths) {
            Ok(nonce) => nonce,
            Err(_) => match start_service(&paths, span_root) {
                Ok(nonce) => nonce,
                Err(_) => {
                    fs4::fs_std::FileExt::unlock(&lock)?;
                    return Ok(None);
                }
            },
        };
        fs4::fs_std::FileExt::unlock(&lock)?;
        match rpc(
            &paths,
            &nonce,
            Operation::Query {
                addresses: addresses.to_vec(),
            },
        ) {
            Ok((mut response, connect_us)) if response.ok => {
                response.counters.rpc_connect_us = connect_us;
                let document = response
                    .document
                    .ok_or_else(|| anyhow!("context service omitted its document"))?;
                Ok(Some((document, response.counters)))
            }
            Ok((response, _)) if response.fallback => Ok(None),
            Ok((response, _)) => Err(anyhow!(
                "context service rejected query: {}",
                response.error.unwrap_or_default()
            )),
            Err(_) => Ok(None),
        }
    }

    pub(super) fn client_repair(
        repo: &gix::Repository,
        span_root: &str,
        addresses: &[String],
        operation_id: uuid::Uuid,
    ) -> Result<Option<(ContextDocument, ServiceCounters)>> {
        if std::env::var_os("GIT_SPAN_CONTEXT_DISABLE_SERVICE").is_some() {
            return Ok(None);
        }
        let Some(paths) = service_paths(repo, span_root)? else {
            return Ok(None);
        };
        if let Ok(nonce) = read_nonce(&paths)
            && let Ok((mut response, connect_us)) = rpc(
                &paths,
                &nonce,
                Operation::Repair {
                    addresses: addresses.to_vec(),
                    operation_id: operation_id.to_string(),
                },
            )
        {
            if response.ok {
                response.counters.rpc_connect_us = connect_us;
                return Ok(Some((
                    response
                        .document
                        .context("context service omitted repair response")?,
                    response.counters,
                )));
            }
            if response.fallback {
                return Ok(None);
            }
            return Err(anyhow!(
                "context service rejected repair: {}",
                response.error.unwrap_or_default()
            ));
        }
        let lock = paths
            .directory
            .open_or_create_file(std::ffi::OsStr::new("supervisor.lock"), 0o600)?;
        acquire_supervisor(&lock)?;
        let nonce = match health(&paths) {
            Ok(nonce) => nonce,
            Err(_) => match start_service(&paths, span_root) {
                Ok(nonce) => nonce,
                Err(_) => {
                    fs4::fs_std::FileExt::unlock(&lock)?;
                    return Ok(None);
                }
            },
        };
        fs4::fs_std::FileExt::unlock(&lock)?;
        match rpc(
            &paths,
            &nonce,
            Operation::Repair {
                addresses: addresses.to_vec(),
                operation_id: operation_id.to_string(),
            },
        ) {
            Ok((mut response, connect_us)) if response.ok => {
                response.counters.rpc_connect_us = connect_us;
                Ok(Some((
                    response
                        .document
                        .context("context service omitted repair response")?,
                    response.counters,
                )))
            }
            Ok((response, _)) if response.fallback => Ok(None),
            Ok((response, _)) => Err(anyhow!(
                "context service rejected repair: {}",
                response.error.unwrap_or_default()
            )),
            // The service may have committed before the connection was lost.
            // Falling back with the same operation ID is a journal replay,
            // never a second mutation.
            Err(_) => Ok(None),
        }
    }

    fn repair_state(
        shared: &Arc<Mutex<ServiceState>>,
        runtime: &crate::descriptor_authority::RetainedDirectory,
        addresses: &[String],
        operation_id: uuid::Uuid,
    ) -> Result<(ContextDocument, ServiceCounters)> {
        let started = Instant::now();
        let (repo_path, span_root) = {
            let state = shared
                .lock()
                .map_err(|_| anyhow!("context service state was poisoned"))?;
            (state.repo_path.clone(), state.span_root.clone())
        };
        let repo = gix::open(&repo_path).context("reopen context service repository for repair")?;
        let mut counters = ServiceCounters::default();
        // A repair follows a caller's worktree write immediately. inotify is
        // an invalidation hint, not a publication barrier: the notification
        // is allowed to arrive after this worker accepts the RPC. Rebuild
        // synchronously before planning so repair never starts from the
        // resident generation merely because its event has not queued yet.
        {
            let _recovery = crate::cli::recovery_domain::acquire_reader(&repo, &span_root)?;
            let mut state = shared
                .lock()
                .map_err(|_| anyhow!("context service state was poisoned"))?;
            state.drain(&mut counters)?;
            state.rebuild_locked(&repo, &mut counters)?;
        }
        let document = super::super::context_repair::execute(
            &repo,
            &span_root,
            addresses,
            operation_id,
            Some(runtime),
            |prepared| {
                let (generation, external_roots) = Generation::build_locked(&repo, &span_root)?;
                let (mut proved, rows) = generation.query(prepared.scopes.clone())?;
                proved.mutation = prepared.mutation.clone();
                counters.rows_decoded += rows;
                ensure!(
                    proved == *prepared,
                    "published context generation differs from prepared repair response"
                );
                let mut state = shared
                    .lock()
                    .map_err(|_| anyhow!("context service state was poisoned"))?;
                let drain = state.watcher.drain()?;
                counters.watcher_drain_us += drain.elapsed_us;
                counters.invalidations += drain.events;
                counters.watcher_overflows += u64::from(drain.overflow);
                // Every event, expected or external, takes the conservative
                // full-generation path. Nothing is ignored during repair.
                let mut roots = state.base_watch_roots.clone();
                roots.extend(external_roots);
                let mut excluded = state.runtime_dirs.clone();
                excluded.push(state.service_dir.clone());
                let mut watcher = FailClosedWatcher::new(roots, excluded)?;
                let clean = watcher.drain()?;
                ensure!(
                    clean.events == 0 && !clean.overflow,
                    "dependency changed while publishing repaired generation"
                );
                state.generation = Arc::new(generation);
                state.watcher = watcher;
                state.epoch = state.epoch.saturating_add(1);
                state.dirty = false;
                counters.corpus_loads += 1;
                counters.resolver_passes += 2;
                Ok(())
            },
        )?;
        let _recovery = crate::cli::recovery_domain::acquire_reader(&repo, &span_root)?;
        {
            let expected = document
                .spans
                .iter()
                .map(|span| repo_path.join(&span_root).join(&span.name))
                .collect::<BTreeSet<_>>();
            let mut state = shared
                .lock()
                .map_err(|_| anyhow!("context service state was poisoned"))?;
            let drain = state.watcher.drain()?;
            counters.watcher_drain_us += drain.elapsed_us;
            counters.invalidations += drain.events;
            counters.watcher_overflows += u64::from(drain.overflow);
            let expected_only = !drain.overflow
                && drain.paths.iter().all(|path| {
                    expected.iter().any(|definition| {
                        path == definition
                            || (path.parent() == definition.parent()
                                && path.file_name().is_some_and(|leaf| {
                                    // Repair's own temp-file staging pattern
                                    // (`.context-<operation_id>-<index>.tmp`,
                                    // see context_repair.rs) is the only
                                    // sibling churn expected alongside a
                                    // watched definition file; per-entry
                                    // `.context.lock` files were deleted in
                                    // favor of the single repository-wide
                                    // recovery-domain lock, so that suffix
                                    // no longer appears here.
                                    leaf.to_string_lossy().starts_with(".context-")
                                }))
                    })
                });
            if drain.events > 0 {
                state.epoch = state.epoch.saturating_add(1);
                if !expected_only {
                    state.dirty = true;
                    state.rebuild_locked(&repo, &mut counters)?;
                }
            }
        }
        counters.total_latency_us = started.elapsed().as_micros() as u64;
        Ok((document, counters))
    }

    fn acknowledge_state(
        shared: &Arc<Mutex<ServiceState>>,
        operation_id: uuid::Uuid,
        addresses: &[String],
    ) -> Result<()> {
        let (repo_path, span_root) = {
            let state = shared
                .lock()
                .map_err(|_| anyhow!("context service state was poisoned"))?;
            (state.repo_path.clone(), state.span_root.clone())
        };
        let repo = gix::open(&repo_path)
            .context("reopen context service repository for repair acknowledgement")?;
        super::super::context_repair::acknowledge(&repo, &span_root, operation_id, addresses)
    }

    fn handle_connection(
        mut stream: UnixStream,
        state: &Arc<Mutex<ServiceState>>,
        runtime: &crate::descriptor_authority::RetainedDirectory,
        service_key: &str,
        nonce: &str,
    ) -> Result<bool> {
        stream.set_read_timeout(Some(IO_TIMEOUT))?;
        stream.set_write_timeout(Some(IO_TIMEOUT))?;
        ensure!(
            peer_uid(&stream)? == unsafe { libc::geteuid() },
            "client peer has another owner"
        );
        let request: Request =
            serde_json::from_slice(&read_frame(&mut stream, MAX_REQUEST_BYTES)?)?;
        ensure!(request.protocol == PROTOCOL_VERSION, "protocol mismatch");
        ensure!(
            request.service_key == service_key,
            "service identity mismatch"
        );
        ensure!(request.nonce == nonce, "service nonce mismatch");
        if let Ok(delay) = std::env::var("GIT_SPAN_CONTEXT_TEST_WORKER_DELAY_MS")
            && let Ok(delay) = delay.parse::<u64>()
        {
            thread::sleep(Duration::from_millis(delay.min(2_000)));
        }
        let mut shutdown = false;
        let mut acknowledgement: Option<(uuid::Uuid, Vec<String>)> = None;
        let response = match request.op {
            Operation::Health => Response {
                protocol: PROTOCOL_VERSION,
                ok: true,
                fallback: false,
                document: None,
                error: None,
                counters: ServiceCounters::default(),
            },
            Operation::Shutdown => {
                shutdown = true;
                Response {
                    protocol: PROTOCOL_VERSION,
                    ok: true,
                    fallback: false,
                    document: None,
                    error: None,
                    counters: ServiceCounters::default(),
                }
            }
            Operation::Query { addresses } => match query_state(state, &addresses) {
                Ok((document, counters)) => Response {
                    protocol: PROTOCOL_VERSION,
                    ok: true,
                    fallback: false,
                    document: Some(document),
                    error: None,
                    counters,
                },
                Err(error) => Response {
                    protocol: PROTOCOL_VERSION,
                    ok: false,
                    fallback: true,
                    document: None,
                    error: Some(format!("{error:#}")),
                    counters: ServiceCounters::default(),
                },
            },
            Operation::Repair {
                addresses,
                operation_id,
            } => match operation_id.parse::<uuid::Uuid>() {
                Ok(operation_id) => match repair_state(state, runtime, &addresses, operation_id) {
                    Ok((document, counters)) => {
                        acknowledgement = Some((operation_id, addresses));
                        Response {
                            protocol: PROTOCOL_VERSION,
                            ok: true,
                            fallback: false,
                            document: Some(document),
                            error: None,
                            counters,
                        }
                    }
                    Err(error) => Response {
                        protocol: PROTOCOL_VERSION,
                        ok: false,
                        fallback: false,
                        document: None,
                        error: Some(format!("{error:#}")),
                        counters: ServiceCounters::default(),
                    },
                },
                Err(error) => Response {
                    protocol: PROTOCOL_VERSION,
                    ok: false,
                    fallback: false,
                    document: None,
                    error: Some(format!("invalid repair operation ID: {error}")),
                    counters: ServiceCounters::default(),
                },
            },
        };
        write_frame(
            &mut stream,
            &serde_json::to_vec(&response)?,
            MAX_RESPONSE_BYTES,
        )?;
        if let Some((operation_id, addresses)) = acknowledgement {
            let _ = acknowledge_state(state, operation_id, &addresses);
        }
        Ok(shutdown)
    }

    pub(super) fn serve(repo: &gix::Repository, args: ContextServiceArgs) -> Result<i32> {
        let workdir = crate::git::work_dir(repo)?.to_path_buf();
        let git_dir = crate::git::git_dir(repo).to_path_buf();
        let common_dir = crate::git::common_dir(repo).to_path_buf();
        let runtime = crate::descriptor_authority::RuntimeAuthority::open(&args.service_key)?;
        let runtime_directory = runtime.directory()?;
        let service_dir = runtime_directory.display_path().to_path_buf();
        let socket_name = std::ffi::OsStr::new("service.sock");
        let socket_path = runtime_directory.descriptor_path(socket_name)?;
        if runtime_directory.entry_exists(socket_name)? {
            runtime_directory.validate_owned_socket(socket_name, 0o600)?;
            runtime_directory.unlink(socket_name)?;
            runtime_directory.sync()?;
        }
        let listener = UnixListener::bind(&socket_path)?;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
        runtime_directory.validate_owned_socket(socket_name, 0o600)?;

        let base_roots = vec![
            workdir.clone(),
            git_dir,
            common_dir,
            workdir.join(&args.span_root),
        ];
        let (generation, external) = Generation::build(repo, &args.span_root)?;
        let mut roots = base_roots.clone();
        roots.extend(external);
        let runtime_dirs = vec![
            crate::git::git_dir(repo).join("span"),
            crate::git::common_dir(repo).join("span"),
        ];
        let mut excluded = runtime_dirs.clone();
        excluded.push(service_dir.clone());
        let mut watcher = FailClosedWatcher::new(roots, excluded)?;
        let drain = watcher.drain()?;
        ensure!(
            drain.events == 0 && !drain.overflow,
            "dependencies changed during service startup"
        );
        let state = Arc::new(Mutex::new(ServiceState {
            repo_path: workdir,
            span_root: args.span_root,
            service_dir,
            runtime_dirs,
            base_watch_roots: base_roots,
            watcher,
            generation: Arc::new(generation),
            epoch: 0,
            dirty: false,
        }));
        listener.set_nonblocking(true)?;
        let active = Arc::new(AtomicUsize::new(0));
        let shutdown = Arc::new(AtomicUsize::new(0));
        let mut last_activity = Instant::now();
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    last_activity = Instant::now();
                    if active.load(Ordering::Acquire) >= MAX_WORKERS {
                        let mut stream = stream;
                        let response = Response {
                            protocol: PROTOCOL_VERSION,
                            ok: false,
                            fallback: true,
                            document: None,
                            error: Some("context service is at capacity".into()),
                            counters: ServiceCounters::default(),
                        };
                        let _ = write_frame(
                            &mut stream,
                            &serde_json::to_vec(&response)?,
                            MAX_RESPONSE_BYTES,
                        );
                        continue;
                    }
                    active.fetch_add(1, Ordering::AcqRel);
                    let active_worker = active.clone();
                    let state = state.clone();
                    let runtime = runtime_directory.try_clone()?;
                    let key = args.service_key.clone();
                    let nonce = args.nonce.clone();
                    let shutdown_worker = shutdown.clone();
                    thread::spawn(move || {
                        if handle_connection(stream, &state, &runtime, &key, &nonce)
                            .unwrap_or(false)
                        {
                            shutdown_worker.store(1, Ordering::Release);
                        }
                        active_worker.fetch_sub(1, Ordering::AcqRel);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if shutdown.load(Ordering::Acquire) != 0
                        || (active.load(Ordering::Acquire) == 0
                            && last_activity.elapsed() >= IDLE_TIMEOUT)
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(1));
                }
                Err(error) => return Err(error.into()),
            }
        }
        drop(listener);
        if runtime_directory.entry_exists(socket_name)? {
            runtime_directory.validate_owned_socket(socket_name, 0o600)?;
            runtime_directory.unlink(socket_name)?;
            runtime_directory.sync()?;
        }
        Ok(0)
    }

    #[cfg(test)]
    mod tests {
        use super::{client_query, identity_paths};
        use anyhow::Result;
        use std::os::unix::fs::PermissionsExt;

        #[test]
        fn client_query_propagates_runtime_authority_permission_failures() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let repo = gix::init(temp.path())?;
            std::fs::create_dir(temp.path().join(".span"))?;
            let paths = identity_paths(&repo, ".span")?;
            let identity = paths.directory.display_path().to_path_buf();
            std::fs::set_permissions(&identity, std::fs::Permissions::from_mode(0o755))?;

            let result = client_query(&repo, ".span", &[]);

            std::fs::set_permissions(&identity, std::fs::Permissions::from_mode(0o700))?;
            std::fs::remove_dir(identity)?;
            let error = result.expect_err("public runtime authority selected synchronous context");
            assert!(
                error
                    .to_string()
                    .contains("private retained directory permissions are not 0o700")
            );
            Ok(())
        }
    }
}

pub(crate) fn query(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
) -> Result<Option<(ContextDocument, ServiceCounters)>> {
    #[cfg(target_os = "linux")]
    {
        unix::client_query(repo, span_root, addresses)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (repo, span_root, addresses);
        Ok(None)
    }
}

pub(crate) fn repair(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
    operation_id: uuid::Uuid,
) -> Result<(ContextDocument, ServiceCounters)> {
    #[cfg(target_os = "linux")]
    {
        // A repository with no span root has nothing to journal or publish.
        // Preserve the normal input validation and return an explicit no-op
        // mutation result without creating public span state as a side effect.
        if crate::descriptor_authority::SpanRootAuthority::open_optional(
            crate::git::work_dir(repo)?,
            span_root,
        )?
        .is_none()
        {
            let mut document = super::context::run_context_read_only(repo, addresses, span_root)?;
            document.mutation.requested = true;
            return Ok((document, ServiceCounters::default()));
        }
        if let Some(response) = unix::client_repair(repo, span_root, addresses, operation_id)? {
            return Ok(response);
        }
        let document =
            super::context_repair::execute(repo, span_root, addresses, operation_id, None, |_| {
                Ok(())
            })?;
        Ok((document, ServiceCounters::default()))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (repo, span_root, addresses, operation_id);
        bail!("context repair requires descriptor-relative Unix filesystem operations")
    }
}

pub(crate) fn acknowledge_repair(
    repo: &gix::Repository,
    span_root: &str,
    addresses: &[String],
    operation_id: uuid::Uuid,
) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        super::context_repair::acknowledge(repo, span_root, operation_id, addresses)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (repo, span_root, addresses, operation_id);
        Ok(())
    }
}

pub(crate) fn serve(repo: &gix::Repository, args: ContextServiceArgs) -> Result<i32> {
    #[cfg(target_os = "linux")]
    {
        unix::serve(repo, args)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (repo, args);
        bail!("the private context service requires Linux inotify")
    }
}
