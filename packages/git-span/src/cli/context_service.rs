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
// The service is optional acceleration inside a five-second hook subprocess.
// Share this allowance across election, startup and all RPCs, leaving most
// of the hook budget for directly validated computation when it is unavailable.
const SERVICE_BUDGET: Duration = Duration::from_millis(750);
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
    #[cfg(test)]
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
    use super::super::context::normalize_service_scopes;
    use super::*;
    use anyhow::ensure;
    use fs4::fs_std::FileExt;
    use std::ffi::CString;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
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
        #[cfg(test)]
        paths: BTreeSet<PathBuf>,
    }

    #[derive(Debug)]
    struct FailClosedWatcher {
        /// The inotify instance, held as a `File` so events drain through
        /// safe `Read` rather than raw `read(2)`.
        fd: File,
        roots: Vec<PathBuf>,
        excluded: Vec<PathBuf>,
        watched: BTreeMap<PathBuf, i32>,
        coverage_valid: bool,
        #[cfg(test)]
        drain_batch_delay: Duration,
    }

    /// Size of the fixed `struct inotify_event` header that precedes each
    /// event's optional NUL-padded name in an inotify read.
    const INOTIFY_EVENT_HEADER: usize = std::mem::size_of::<libc::inotify_event>();

    /// The fields of one `struct inotify_event` header the watcher consumes,
    /// decoded from native-endian bytes at the kernel's field offsets rather
    /// than by reinterpreting the read buffer as the C struct.
    struct InotifyEventHeader {
        wd: libc::c_int,
        mask: u32,
        len: usize,
    }

    impl InotifyEventHeader {
        /// Decode `header`, which must be exactly [`INOTIFY_EVENT_HEADER`]
        /// bytes long; the caller slices it from bytes the kernel returned.
        fn parse(header: &[u8]) -> Self {
            let word = |offset: usize| {
                [
                    header[offset],
                    header[offset + 1],
                    header[offset + 2],
                    header[offset + 3],
                ]
            };
            Self {
                wd: libc::c_int::from_ne_bytes(word(std::mem::offset_of!(libc::inotify_event, wd))),
                mask: u32::from_ne_bytes(word(std::mem::offset_of!(libc::inotify_event, mask))),
                len: u32::from_ne_bytes(word(std::mem::offset_of!(libc::inotify_event, len)))
                    as usize,
            }
        }
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
            // SAFETY: inotify_init1(2) takes only a flag word and touches no
            // caller memory; failure is reported through the return value.
            let raw_fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
            if raw_fd < 0 {
                return Err(std::io::Error::last_os_error()).context("initialize inotify watcher");
            }
            // SAFETY: a non-negative inotify_init1 result is a descriptor the
            // kernel just allocated for this call. It is wrapped exactly once,
            // here, so the `File` is its sole owner and closes it exactly once.
            let fd = unsafe { File::from_raw_fd(raw_fd) };
            let mut watcher = Self {
                fd,
                roots,
                excluded,
                watched: BTreeMap::new(),
                coverage_valid: true,
                #[cfg(test)]
                drain_batch_delay: Duration::ZERO,
            };
            watcher.refresh()?;
            ensure!(!watcher.watched.is_empty(), "watcher installed no watches");
            Ok(watcher)
        }

        fn refresh(&mut self) -> Result<()> {
            self.coverage_valid = false;
            ensure!(
                !injected_watcher_failure("replacement"),
                "injected watcher replacement failure"
            );
            for root in self.roots.clone() {
                ensure!(
                    root.exists(),
                    "required context watch root {} is missing",
                    root.display()
                );
                self.add_tree(&root)?;
                let watch_path = if root.is_dir() {
                    root.as_path()
                } else {
                    root.parent()
                        .ok_or_else(|| anyhow!("context watch root has no parent"))?
                };
                ensure!(
                    self.watched.contains_key(watch_path),
                    "context watch root {} lost coverage",
                    root.display()
                );
            }
            self.coverage_valid = true;
            Ok(())
        }

        fn add_tree(&mut self, path: &Path) -> Result<()> {
            let metadata = match std::fs::symlink_metadata(path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("stat watcher root {}", path.display()));
                }
            };
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
                let kind = match entry.file_type() {
                    Ok(kind) => kind,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.into()),
                };
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
            // SAFETY: `self.fd` is borrowed across the call, so the inotify
            // descriptor stays open; `c_path` is a NUL-terminated string that
            // outlives the call and inotify_add_watch only reads it.
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
            if !self.coverage_valid {
                *self = Self::new(self.roots.clone(), self.excluded.clone())?;
                return Ok(WatchDrain {
                    events: 1,
                    overflow: true,
                    elapsed_us: 0,
                    #[cfg(test)]
                    paths: BTreeSet::new(),
                });
            }
            let result = self.drain_inner();
            if result.is_err() {
                self.coverage_valid = false;
            }
            result
        }

        fn drain_inner(&mut self) -> Result<WatchDrain> {
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
                    #[cfg(test)]
                    paths: BTreeSet::new(),
                });
            }
            let mut buffer = [0_u8; 64 * 1024];
            let mut events = 0;
            let mut overflow = false;
            let mut batches = 0;
            #[cfg(test)]
            let mut paths = BTreeSet::new();
            loop {
                let count = match (&self.fd).read(&mut buffer) {
                    Ok(0) => bail!("inotify watcher unexpectedly reached EOF"),
                    Ok(count) => count,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) => return Err(error).context("drain inotify events"),
                };
                // Confirm that another batch exists before treating the drain
                // as incomplete. A descheduled worker with one fully consumed
                // (possibly excluded) batch has not lost any notifications.
                if batches > 0 && started.elapsed() >= Duration::from_millis(20) {
                    overflow = true;
                    break;
                }
                batches += 1;
                let mut offset = 0;
                while offset + INOTIFY_EVENT_HEADER <= count {
                    let event =
                        InotifyEventHeader::parse(&buffer[offset..offset + INOTIFY_EVENT_HEADER]);
                    let name_start = offset + INOTIFY_EVENT_HEADER;
                    let name_end = name_start + event.len;
                    ensure!(
                        name_end <= count,
                        "inotify event overruns the bytes the kernel returned"
                    );
                    let root = self
                        .watched
                        .iter()
                        .find(|(_, descriptor)| **descriptor == event.wd)
                        .map(|(path, _)| path.clone());
                    let path = root.map(|root| {
                        if event.len == 0 {
                            root
                        } else {
                            let raw = &buffer[name_start..name_end];
                            let end = raw.iter().position(|byte| *byte == 0).unwrap_or(raw.len());
                            root.join(std::ffi::OsStr::from_bytes(&raw[..end]))
                        }
                    });
                    let excluded = path.as_ref().is_some_and(|path| {
                        self.excluded
                            .iter()
                            .any(|excluded| path.starts_with(excluded))
                    });
                    if !excluded {
                        events += 1;
                        overflow |= event.mask
                            & (libc::IN_Q_OVERFLOW
                                | libc::IN_IGNORED
                                | libc::IN_UNMOUNT
                                | libc::IN_DELETE_SELF
                                | libc::IN_MOVE_SELF)
                            != 0
                            || path.is_none();
                        #[cfg(test)]
                        if let Some(path) = path {
                            paths.insert(path);
                        }
                    }
                    offset = name_end;
                }
                #[cfg(test)]
                thread::sleep(self.drain_batch_delay);
            }
            if overflow {
                // Reusing a path-to-descriptor map after watch loss can hide
                // writes beneath a recreated directory. Reestablish complete
                // coverage before any subsequent capture may become trusted.
                *self = Self::new(self.roots.clone(), self.excluded.clone())?;
            } else if events > 0 {
                self.refresh()?;
            }
            Ok(WatchDrain {
                events,
                overflow,
                elapsed_us: started.elapsed().as_micros() as u64,
                #[cfg(test)]
                paths,
            })
        }
    }

    struct ServiceState {
        repo_path: PathBuf,
        span_root: String,
        base_watch_roots: Vec<PathBuf>,
        watcher: FailClosedWatcher,
        generation: Arc<Generation>,
        epoch: u64,
        dirty: bool,
    }

    impl ServiceState {
        fn drain(&mut self, counters: &mut ServiceCounters) -> Result<()> {
            let drain = match self.watcher.drain() {
                Ok(drain) => drain,
                Err(_) => {
                    // Rediscover the current closure under base coverage. A
                    // removed historical dependency must not poison reuse
                    // forever, while no old generation survives this reset.
                    self.dirty = true;
                    self.epoch = self.epoch.saturating_add(1);
                    self.watcher = FailClosedWatcher::new(
                        self.base_watch_roots.clone(),
                        self.watcher.excluded.clone(),
                    )?;
                    counters.watcher_overflows += 1;
                    return Ok(());
                }
            };
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
            // Keep coverage alive through capture. New external dependencies
            // discovered by the resolver require watches and a second capture;
            // the first capture predates coverage and cannot be published.
            self.dirty = true;
            self.drain(counters)?;
            for attempt in 0..2 {
                let (generation, external_roots) = Generation::build_locked(repo, &self.span_root)?;
                let new_roots = external_roots
                    .into_iter()
                    .filter(|root| !self.watcher.roots.contains(root))
                    .collect::<Vec<_>>();
                if !new_roots.is_empty() {
                    self.watcher.roots.extend(new_roots);
                    self.watcher.refresh()?;
                    ensure!(
                        attempt == 0,
                        "context watch coverage changed repeatedly during capture"
                    );
                    continue;
                }
                service_test_checkpoint("generation-before-publication")?;
                let epoch = self.epoch;
                self.drain(counters)?;
                self.generation = Arc::new(generation);
                self.dirty = self.epoch != epoch;
                counters.corpus_loads += 1;
                counters.resolver_passes += 2;
                return Ok(());
            }
            unreachable!("capture either publishes or expands coverage once")
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
                    ensure!(
                        !state.dirty,
                        "context dependencies changed during capture; direct validation required"
                    );
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
        // SAFETY: `stream` is borrowed across the call, so its socket stays
        // open. `credentials` is a live, initialized `ucred` and `length`
        // holds exactly its size, so getsockopt writes at most that many bytes
        // into it and updates `length` in place; both outlive the call.
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
                ) || name.to_str().is_some_and(|name| {
                    name.starts_with("GIT_CONFIG_KEY_") || name.starts_with("GIT_CONFIG_VALUE_")
                })
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

    fn remaining(deadline: Instant) -> Result<Duration> {
        deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "context service budget exhausted",
                )
                .into()
            })
    }

    fn connect_before(path: &Path, deadline: Instant) -> Result<UnixStream> {
        remaining(deadline)?;
        let bytes = path.as_os_str().as_bytes();
        let mut address = libc::sockaddr_un {
            sun_family: libc::AF_UNIX as libc::sa_family_t,
            sun_path: [0; 108],
        };
        ensure!(
            bytes.len() < address.sun_path.len(),
            "context service socket path is too long"
        );
        for (target, byte) in address.sun_path.iter_mut().zip(bytes) {
            *target = *byte as libc::c_char;
        }
        // SAFETY: socket(2) takes only scalar flags; a successful result is a
        // fresh descriptor transferred exactly once to UnixStream below.
        let fd = unsafe {
            libc::socket(
                libc::AF_UNIX,
                libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
                0,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        // SAFETY: fd is a newly allocated socket descriptor, and this stream
        // becomes its sole owner even if connecting subsequently fails.
        let stream = unsafe { UnixStream::from_raw_fd(fd) };
        loop {
            remaining(deadline)?;
            // SAFETY: address is an initialized sockaddr_un containing a
            // NUL-terminated path; connect reads it only for this call.
            let status = unsafe {
                libc::connect(
                    fd,
                    (&address as *const libc::sockaddr_un).cast(),
                    std::mem::size_of_val(&address) as libc::socklen_t,
                )
            };
            if status == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            match error.raw_os_error() {
                Some(libc::EISCONN) => break,
                Some(libc::EAGAIN | libc::EINPROGRESS | libc::EALREADY | libc::EINTR) => {
                    thread::sleep(remaining(deadline)?.min(Duration::from_millis(5)));
                }
                _ => return Err(error.into()),
            }
        }
        stream.set_nonblocking(false)?;
        Ok(stream)
    }

    fn read_before(stream: &mut UnixStream, mut bytes: &mut [u8], deadline: Instant) -> Result<()> {
        while !bytes.is_empty() {
            stream.set_read_timeout(Some(remaining(deadline)?))?;
            match stream.read(bytes) {
                Ok(0) => return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof).into()),
                Ok(count) => bytes = &mut bytes[count..],
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    fn write_before(stream: &mut UnixStream, mut bytes: &[u8], deadline: Instant) -> Result<()> {
        while !bytes.is_empty() {
            stream.set_write_timeout(Some(remaining(deadline)?))?;
            match stream.write(bytes) {
                Ok(0) => return Err(std::io::Error::from(std::io::ErrorKind::WriteZero).into()),
                Ok(count) => bytes = &bytes[count..],
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    fn rpc(
        paths: &ServicePaths,
        nonce: &str,
        op: Operation,
        deadline: Instant,
    ) -> Result<(Response, u64)> {
        remaining(deadline)?;
        paths
            .directory
            .validate_owned_socket(std::ffi::OsStr::new("service.sock"), 0o600)?;
        let started = Instant::now();
        let mut stream = connect_before(&paths.socket, deadline)?;
        let connect_us = started.elapsed().as_micros() as u64;
        ensure!(
            peer_uid(&stream)? == crate::descriptor_authority::effective_uid(),
            "service peer has another owner"
        );
        let request = Request {
            protocol: PROTOCOL_VERSION,
            service_key: paths.key.clone(),
            nonce: nonce.to_owned(),
            request_id: uuid::Uuid::new_v4().to_string(),
            op,
        };
        let request = serde_json::to_vec(&request)?;
        ensure!(
            !request.is_empty() && request.len() <= MAX_REQUEST_BYTES,
            "RPC frame exceeds byte limit"
        );
        write_before(
            &mut stream,
            &u32::try_from(request.len())?.to_be_bytes(),
            deadline,
        )?;
        write_before(&mut stream, &request, deadline)?;
        let mut prefix = [0; 4];
        read_before(&mut stream, &mut prefix, deadline)?;
        let length = u32::from_be_bytes(prefix) as usize;
        ensure!(
            length > 0 && length <= MAX_RESPONSE_BYTES,
            "RPC frame exceeds byte limit"
        );
        let mut payload = vec![0; length];
        read_before(&mut stream, &mut payload, deadline)?;
        let response: Response = serde_json::from_slice(&payload)?;
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

    fn health(paths: &ServicePaths, deadline: Instant) -> Result<String> {
        let nonce = read_nonce(paths)?;
        let (response, _) = rpc(paths, &nonce, Operation::Health, deadline)?;
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

    fn start_service(paths: &ServicePaths, span_root: &str, deadline: Instant) -> Result<String> {
        if paths
            .directory
            .entry_exists(std::ffi::OsStr::new("service.sock"))?
        {
            match health(paths, deadline) {
                Ok(nonce) => return Ok(nonce),
                Err(error) => {
                    let timed_out = error.chain().any(|cause| {
                        cause.downcast_ref::<std::io::Error>().is_some_and(|io| {
                            matches!(
                                io.kind(),
                                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                            )
                        })
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
        remaining(deadline)?;
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
        // Detach into a new session so the service outlives this client
        // process and its controlling terminal.
        let detach = || {
            // SAFETY: setsid(2) takes no arguments and touches no caller
            // memory; failure is reported through the return value and errno.
            if unsafe { libc::setsid() } < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        };
        // SAFETY: `detach` runs in the forked child before exec, where only
        // async-signal-safe work is sound. It calls setsid(2), which POSIX
        // lists as async-signal-safe, and on failure reads errno into an
        // `io::Error` OS-code value, which neither allocates nor takes a
        // lock. It captures nothing, so it cannot observe state that another
        // parent thread left mid-update at fork time.
        unsafe {
            command.pre_exec(detach);
        }
        let mut child = command.spawn()?;
        let mut last = None;
        while Instant::now() < deadline {
            if let Some(status) = child.try_wait()? {
                bail!("context service exited before readiness: {status}");
            }
            match rpc(paths, &nonce, Operation::Health, deadline) {
                Ok((response, _)) if response.ok => return Ok(nonce),
                Ok(_) => last = Some(anyhow!("service rejected readiness handshake")),
                Err(error) => last = Some(error),
            }
            thread::sleep(remaining(deadline)?.min(Duration::from_millis(20)));
        }
        Err(last.unwrap_or_else(|| anyhow!("context service startup timed out")))
    }

    fn acquire_supervisor(file: &File, deadline: Instant) -> Result<()> {
        loop {
            match file.try_lock_exclusive() {
                Ok(true) => return Ok(()),
                Ok(false) => {
                    ensure!(
                        Instant::now() < deadline,
                        "context supervisor election timed out"
                    );
                    thread::sleep(remaining(deadline)?.min(Duration::from_millis(20)));
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
        // Warm-up has no foreground direct computation to reserve time for.
        let budget = if addresses.is_empty() {
            Duration::from_secs(4)
        } else {
            SERVICE_BUDGET
        };
        let deadline = Instant::now() + budget;
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
                deadline,
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
        if remaining(deadline).is_err() {
            return Ok(None);
        }
        let lock = paths
            .directory
            .open_or_create_file(std::ffi::OsStr::new("supervisor.lock"), 0o600)?;
        if acquire_supervisor(&lock, deadline).is_err() {
            return Ok(None);
        }
        let nonce = match start_service(&paths, span_root, deadline) {
            Ok(nonce) => nonce,
            Err(_) => {
                fs4::fs_std::FileExt::unlock(&lock)?;
                return Ok(None);
            }
        };
        fs4::fs_std::FileExt::unlock(&lock)?;
        match rpc(
            &paths,
            &nonce,
            Operation::Query {
                addresses: addresses.to_vec(),
            },
            deadline,
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
        let deadline = Instant::now() + SERVICE_BUDGET;
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
                deadline,
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
        if remaining(deadline).is_err() {
            return Ok(None);
        }
        let lock = paths
            .directory
            .open_or_create_file(std::ffi::OsStr::new("supervisor.lock"), 0o600)?;
        if acquire_supervisor(&lock, deadline).is_err() {
            return Ok(None);
        }
        let nonce = match start_service(&paths, span_root, deadline) {
            Ok(nonce) => nonce,
            Err(_) => {
                fs4::fs_std::FileExt::unlock(&lock)?;
                return Ok(None);
            }
        };
        fs4::fs_std::FileExt::unlock(&lock)?;
        match rpc(
            &paths,
            &nonce,
            Operation::Repair {
                addresses: addresses.to_vec(),
                operation_id: operation_id.to_string(),
            },
            deadline,
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
        let document = super::super::context_repair::execute(
            &repo,
            &span_root,
            addresses,
            operation_id,
            Some(runtime),
            |_| {
                let mut state = shared
                    .lock()
                    .map_err(|_| anyhow!("context service state was poisoned"))?;
                // The transaction has its own validated prepared response.
                // Cache publication is optional: churn or watcher faults leave
                // it dirty without turning a committed repair into failure.
                if state.rebuild_locked(&repo, &mut counters).is_err() {
                    state.dirty = true;
                }
                Ok(())
            },
        )?;
        // Late notifications must invalidate the optional generation, but
        // cannot change the journaled mutation outcome already returned.
        if let Ok(mut state) = shared.lock() {
            let _ = state.drain(&mut counters);
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
            peer_uid(&stream)? == crate::descriptor_authority::effective_uid(),
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
        let runtime_dirs = vec![
            crate::git::git_dir(repo).join("span"),
            crate::git::common_dir(repo).join("span"),
        ];
        let mut excluded = runtime_dirs.clone();
        excluded.push(service_dir.clone());
        // Git's read-only probes may stage an optional index refresh. The
        // lockfile is never a resolver input; publication to index itself is
        // still watched and invalidates the generation.
        excluded.push(crate::git::git_dir(repo).join("index.lock"));
        excluded.push(crate::git::common_dir(repo).join("index.lock"));
        let watcher = FailClosedWatcher::new(base_roots.clone(), excluded)?;
        // Readiness belongs to the service. A reusable generation is built
        // under live watch coverage by the first request, never before it.
        let generation = Generation {
            rows: Vec::new(),
            index: BTreeMap::new(),
            known_paths: BTreeSet::new(),
        };
        let state = Arc::new(Mutex::new(ServiceState {
            repo_path: workdir,
            span_root: args.span_root,
            base_watch_roots: base_roots,
            watcher,
            generation: Arc::new(generation),
            epoch: 0,
            dirty: true,
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
        fn delayed_complete_runtime_batch_does_not_invalidate_watch_trust() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let runtime = temp.path().join("runtime");
            let mut watcher = super::FailClosedWatcher::new(
                vec![temp.path().to_path_buf()],
                vec![runtime.clone()],
            )?;
            watcher.drain_batch_delay = std::time::Duration::from_millis(25);
            std::fs::create_dir(runtime)?;
            let drain = watcher.drain()?;
            assert_eq!(drain.events, 0);
            assert!(
                !drain.overflow,
                "a complete excluded batch discarded trusted coverage merely because its worker was delayed"
            );
            Ok(())
        }

        #[test]
        fn failed_rescan_is_retried_before_dependency_events_are_trusted() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let mut watcher =
                super::FailClosedWatcher::new(vec![temp.path().to_path_buf()], vec![])?;
            let child = temp.path().join("new-dependency");
            std::fs::create_dir(&child)?;
            std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o0))?;
            let failed = watcher.drain();
            std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o700))?;
            assert!(failed.is_err(), "unreadable new subtree was accepted");
            watcher.drain()?;
            std::fs::write(child.join("source"), "changed")?;
            assert!(
                watcher.drain()?.paths.contains(&child.join("source")),
                "failed rescan permanently lost subtree coverage"
            );
            Ok(())
        }

        #[test]
        fn missing_external_root_cannot_silently_restore_watch_trust() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let external = temp.path().join("external");
            std::fs::create_dir(&external)?;
            let mut watcher = super::FailClosedWatcher::new(vec![external.clone()], vec![])?;
            std::fs::remove_dir(&external)?;
            assert!(
                watcher.drain().is_err(),
                "missing dependency root retained watch trust"
            );
            std::fs::create_dir(&external)?;
            watcher.drain()?;
            std::fs::write(external.join("source"), "changed")?;
            assert!(watcher.drain()?.paths.contains(&external.join("source")));
            Ok(())
        }

        #[test]
        fn replaced_directories_remain_observable() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let child = temp.path().join("child");
            std::fs::create_dir(&child)?;
            let mut watcher =
                super::FailClosedWatcher::new(vec![temp.path().to_path_buf()], vec![])?;
            std::fs::remove_dir(&child)?;
            std::fs::create_dir(&child)?;
            watcher.drain()?;
            std::fs::write(child.join("dependency"), b"changed")?;
            let drain = watcher.drain()?;
            assert!(
                drain.paths.contains(&child.join("dependency")),
                "replacement directory lost dependency events"
            );
            Ok(())
        }

        #[test]
        fn removed_historical_external_root_does_not_prevent_generation_reuse() -> Result<()> {
            let temp = tempfile::tempdir()?;
            let repo_root = temp.path().join("repo");
            std::fs::create_dir(&repo_root)?;
            gix::init(&repo_root)?;
            std::fs::create_dir(repo_root.join(".span"))?;
            std::fs::write(repo_root.join("source"), "content")?;
            let status = std::process::Command::new("git")
                .current_dir(&repo_root)
                .args([
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "--allow-empty",
                    "-m",
                    "seed",
                ])
                .output()?;
            assert!(status.status.success());
            let repo = gix::open(&repo_root)?;
            let (generation, _) = super::Generation::build(&repo, ".span")?;
            let external = temp.path().join("old-external");
            std::fs::create_dir(&external)?;
            let watcher = super::FailClosedWatcher::new(
                vec![repo_root.clone(), external.clone()],
                vec![
                    repo_root.join(".git/span"),
                    repo_root.join(".git/index.lock"),
                ],
            )?;
            let state = std::sync::Arc::new(std::sync::Mutex::new(super::ServiceState {
                repo_path: repo_root.clone(),
                span_root: ".span".into(),
                base_watch_roots: vec![repo_root],
                watcher,
                generation: std::sync::Arc::new(generation),
                epoch: 0,
                dirty: false,
            }));
            std::fs::remove_dir(external)?;
            super::query_state(&state, &["source".into()])?;
            let (_, counters) = super::query_state(&state, &["source".into()])?;
            assert_eq!(
                counters.generation_hits, 1,
                "historical missing root permanently disabled generation reuse"
            );
            Ok(())
        }

        #[test]
        fn excluded_runtime_activity_preserves_a_reusable_generation() -> Result<()> {
            let temp = tempfile::tempdir()?;
            gix::init(temp.path())?;
            std::fs::create_dir(temp.path().join(".span"))?;
            std::fs::write(temp.path().join("file.txt"), "source")?;
            let runtime = temp.path().join(".runtime");
            std::fs::create_dir_all(&runtime)?;
            let mut watcher = super::FailClosedWatcher::new(
                vec![temp.path().to_path_buf()],
                vec![runtime.clone()],
            )?;
            let status = std::process::Command::new("git")
                .current_dir(temp.path())
                .args([
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "--allow-empty",
                    "-m",
                    "seed",
                ])
                .output()?;
            assert!(status.status.success());
            let repo = gix::open(temp.path())?;
            let (generation, _) = super::Generation::build(&repo, ".span")?;
            watcher.drain()?;
            let state = std::sync::Arc::new(std::sync::Mutex::new(super::ServiceState {
                repo_path: temp.path().to_path_buf(),
                span_root: ".span".into(),
                base_watch_roots: vec![temp.path().to_path_buf()],
                watcher,
                generation: std::sync::Arc::new(generation),
                epoch: 0,
                dirty: false,
            }));
            std::fs::remove_dir(&runtime)?;
            std::fs::create_dir(&runtime)?;
            let (_, counters) = super::query_state(&state, &["file.txt".into()])?;
            assert_eq!(
                counters.generation_hits, 1,
                "runtime churn discarded a reusable generation"
            );
            assert_eq!(counters.corpus_loads, 0);
            Ok(())
        }

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
