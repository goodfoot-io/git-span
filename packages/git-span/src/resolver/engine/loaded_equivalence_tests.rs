//! Loaded snapshots retain serial semantics across resolver options and layers.
use super::*;

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
fn loaded_parallel_matches_serial_for_changed_moved_copied_and_filtered_anchors() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path();
    git(path, &["init", "-q", "--initial-branch=main"]);
    std::fs::write(path.join(".gitattributes"), "*.txt text eol=lf\n").unwrap();
    let mut anchors = Vec::new();
    for index in 0..8 {
        let name = format!("file-{index}.txt");
        let bytes = format!("unique-{index}\nbeta-{index}\ngamma-{index}\n");
        std::fs::write(path.join(&name), &bytes).unwrap();
        let extent = AnchorExtent::LineRange { start: 1, end: 2 };
        let hash = git_span_core::cheap_fingerprint_with_extent(bytes.as_bytes(), &extent);
        anchors.push(crate::types::Anchor {
            path: name,
            extent,
            stored_hash: format!("rk64:{}", git_span_core::rk64_to_hex(hash)),
        });
    }
    git(path, &["add", "."]);
    git(
        path,
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
    std::fs::write(path.join("file-0.txt"), "changed\nbeta-0\ngamma-0\n").unwrap();
    std::fs::write(
        path.join("file-1.txt"),
        "prefix\nunique-1\nbeta-1\ngamma-1\n",
    )
    .unwrap();
    git(path, &["mv", "file-2.txt", "renamed.txt"]);
    std::fs::rename(path.join("file-3.txt"), path.join("copied.txt")).unwrap();
    std::fs::remove_file(path.join("file-4.txt")).unwrap();
    std::fs::write(path.join("file-6.txt"), "unique-6\r\nbeta-6\r\ngamma-6\r\n").unwrap();
    let spans: Vec<_> = (0..4)
        .map(|index| {
            let name = format!("loaded-{index}");
            let config = crate::types::SpanConfig {
                follow_moves: true,
                ..Default::default()
            };
            (
                name.clone(),
                Span {
                    name,
                    why: format!("snapshot-{index}"),
                    config,
                    resolved: Vec::new(),
                    anchors: (0..16)
                        .map(|ordinal| {
                            (
                                format!("id-{ordinal}"),
                                anchors[ordinal % anchors.len()].clone(),
                            )
                        })
                        .collect(),
                },
            )
        })
        .chain(std::iter::once((
            "empty".into(),
            Span {
                name: "empty".into(),
                why: "preserve".into(),
                config: Default::default(),
                resolved: Vec::new(),
                anchors: Vec::new(),
            },
        )))
        .collect();
    let repo_sync = gix::open(path).unwrap().into_sync();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap();
    for mut options in [EngineOptions::full(), EngineOptions::committed_only()] {
        options.fuzzy_threshold = 0.73;
        options.needs_all_layers = false;
        let serial_repo = repo_sync.to_thread_local();
        let mut state = EngineState::new_with_fuzzy_threshold(
            &serial_repo,
            options.layers,
            options.needs_all_layers,
            options.fuzzy_threshold,
        )
        .unwrap();
        let serial: Result<Vec<_>> = spans
            .iter()
            .map(|(_, span)| resolve_loaded_span_with_state(&serial_repo, &mut state, span.clone()))
            .collect();
        assert!(!state.finish(&serial_repo));
        let parallel =
            pool.install(|| resolve_loaded_spans(&repo_sync.to_thread_local(), &spans, options));
        assert_eq!(
            serde_json::to_value(serial.unwrap()).unwrap(),
            serde_json::to_value(parallel.unwrap()).unwrap()
        );
    }
}
