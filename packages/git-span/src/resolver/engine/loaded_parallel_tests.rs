//! Deterministic worker overlap through the loaded-snapshot entry point.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, LazyLock, Mutex};
use std::thread::ThreadId;
use std::time::Duration;

static ENABLED: AtomicBool = AtomicBool::new(false);
static WORKERS: LazyLock<(Mutex<HashSet<ThreadId>>, Condvar)> =
    LazyLock::new(|| (Mutex::new(HashSet::new()), Condvar::new()));

pub(super) fn observe_worker() {
    if !ENABLED.load(Ordering::Acquire) {
        return;
    }
    let (workers, changed) = &*WORKERS;
    let mut workers = workers.lock().unwrap();
    let first_call = workers.insert(std::thread::current().id());
    changed.notify_all();
    if first_call && workers.len() == 1 {
        let (guard, _) = changed
            .wait_timeout_while(workers, Duration::from_millis(500), |workers| {
                workers.len() < 2
            })
            .unwrap();
        workers = guard;
    }
    drop(workers);
}

fn git(path: &std::path::Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn loaded_snapshot_anchors_overlap_across_workers() {
    let temp = tempfile::tempdir().unwrap();
    git(temp.path(), &["init", "-q", "--initial-branch=main"]);
    let bytes = b"alpha\nbeta\ngamma\n";
    std::fs::write(temp.path().join("source.txt"), bytes).unwrap();
    git(temp.path(), &["add", "source.txt"]);
    git(
        temp.path(),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "seed",
        ],
    );
    let extent = AnchorExtent::LineRange { start: 1, end: 2 };
    let hash = git_span_core::cheap_fingerprint_with_extent(bytes, &extent);
    let anchor = crate::types::Anchor {
        path: "source.txt".into(),
        extent,
        stored_hash: format!("rk64:{}", git_span_core::rk64_to_hex(hash)),
    };
    // No span file exists on disk. The supplied snapshot is authoritative.
    let spans: Vec<_> = (0..4)
        .map(|index| {
            let name = format!("snapshot-{index}");
            (
                name.clone(),
                Span {
                    name,
                    why: "caller snapshot".into(),
                    resolved: Vec::new(),
                    config: Default::default(),
                    anchors: (0..16)
                        .map(|ordinal| (format!("anchor-{ordinal}"), anchor.clone()))
                        .collect(),
                },
            )
        })
        .collect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap();
    let repo = gix::open(temp.path()).unwrap().into_sync();
    WORKERS.0.lock().unwrap().clear();
    ENABLED.store(true, Ordering::Release);
    let result = pool
        .install(|| resolve_loaded_spans(&repo.to_thread_local(), &spans, EngineOptions::full()));
    ENABLED.store(false, Ordering::Release);
    let resolved = result.unwrap();
    assert_eq!(resolved.len(), 4);
    assert!(resolved.iter().all(|span| span.anchors.len() == 16));
    assert!(
        WORKERS.0.lock().unwrap().len() >= 2,
        "loaded snapshot resolved every anchor serially on one worker"
    );
}
