//! Same-process controls through real resolver entry points and emitted rows.
use super::*;
use std::process::Command;

fn git(path: &std::path::Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn fixture() -> (tempfile::TempDir, gix::Repository) {
    // SAFETY: every caller runs this before its test spawns any thread, and
    // nextest runs each test in its own process, so no other thread can read or
    // write the environment concurrently.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
        std::env::remove_var("GIT_SPAN_CACHE");
    }
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "--initial-branch=main"]);
    git(dir.path(), &["config", "user.name", "Test"]);
    git(dir.path(), &["config", "user.email", "test@example.com"]);
    git(dir.path(), &["config", "commit.gpgsign", "false"]);
    let bytes = b"alpha\nbeta\ngamma\n";
    std::fs::write(dir.path().join("source.txt"), bytes).unwrap();
    std::fs::create_dir(dir.path().join(".span")).unwrap();
    let hash = git_span_core::cheap_fingerprint_with_extent(
        bytes,
        &AnchorExtent::LineRange { start: 1, end: 2 },
    );
    let file = crate::span_file::SpanFile {
        anchors: vec![crate::span_file::AnchorRecord {
            path: "source.txt".into(),
            start_line: 1,
            end_line: 2,
            algorithm: git_span_core::RK64_ALGORITHM.into(),
            content_hash: git_span_core::rk64_to_hex(hash).into(),
        }],
        why: "lifecycle fixture".into(),
        config: Default::default(),
        resolved: Vec::new(),
    };
    std::fs::write(dir.path().join(".span/sample"), file.serialize()).unwrap();
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-qm", "fixture"]);
    let repo = gix::open(dir.path()).unwrap();
    crate::perf::init(true);
    crate::perf::take_immutable_emissions();
    (dir, repo)
}

fn emitted() -> [u64; 6] {
    let rows = crate::perf::take_immutable_emissions();
    let labels = crate::perf::immutable_counters().map(|(label, _)| label);
    assert_eq!(
        rows.len(),
        6,
        "one complete emission per invocation: {rows:?}"
    );
    for (row, label) in rows.iter().zip(labels) {
        assert_eq!(row.0, label);
    }
    std::array::from_fn(|index| rows[index].1)
}

#[test]
fn immutable_perf_repeated_same_process_trace_and_error_invocations_reset_and_emit() {
    let (dir, repo) = fixture();
    let options = EngineOptions::full();
    assert!(drift_spans(&repo, ".span", options).unwrap().is_empty());
    assert!(emitted()[3] > 0);
    let oid = git(dir.path(), &["rev-parse", "HEAD:.span/sample"]);
    let path = dir
        .path()
        .join(".git/objects")
        .join(&oid[..2])
        .join(&oid[2..]);
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert!(matches!(
        crate::resolver::core::capture::capture_state_token(&repo, ".span", options),
        Err(Error::Git(_))
    ));
    // A real store/capture attempt must retain rejection work through fallback.
    assert!(drift_spans(&repo, ".span", options).unwrap().is_empty());
    let failed_capture = emitted();
    assert!(failed_capture[3] > 0 && failed_capture[4] > 0);
    std::fs::write(path, bytes).unwrap();
    assert!(drift_spans(&repo, ".span", options).unwrap().is_empty());
    let restored = emitted();
    assert!(restored[0] > 0);
    assert_eq!(restored[4], 0, "previous invocation rejection leaked");
    let (_, trace) = drift_spans_with_trace(&repo, ".span", options).unwrap();
    assert_eq!(trace.len(), 1);
    assert_eq!(
        emitted(),
        [0; 6],
        "trace has no memo work and must reset old hits"
    );
    assert!(matches!(
        resolve_span(&repo, ".span", "missing", options),
        Err(Error::SpanNotFound(_))
    ));
    assert_eq!(emitted(), [0; 6], "error return must emit exactly once");
    // SAFETY: nextest runs each test in its own process; the preceding engine
    // call has returned, so its rayon section has joined and the only other
    // threads are idle pool workers that never touch the environment.
    unsafe {
        std::env::set_var("GIT_SPAN_CACHE", "0");
    }
    assert!(drift_spans(&repo, ".span", options).unwrap().is_empty());
    assert_eq!(
        emitted(),
        [0; 6],
        "disabled invocation must reset earlier memo work"
    );
    crate::perf::init(false);
}

#[test]
fn immutable_perf_retained_and_named_fix_pass_entrypoints_emit_independently() {
    let (_dir, repo) = fixture();
    let options = EngineOptions::full();
    let names = vec!["sample".to_owned()];
    drift_spans_retaining_source_layers(&repo, ".span", options).unwrap();
    assert!(emitted()[3] > 0);
    resolve_named_spans(&repo, ".span", &names, options).unwrap();
    assert_eq!(emitted(), [0; 6]);
    let (_, layers) =
        resolve_named_spans_retaining_source_layers(&repo, ".span", &names, options).unwrap();
    assert_eq!(emitted(), [0; 6]);
    resolve_named_spans_with_source_layers(&repo, ".span", &names, options, layers).unwrap();
    assert_eq!(emitted(), [0; 6]);
    crate::perf::init(false);
}
