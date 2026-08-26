//! Executable contract for the schema-v1 context query.

use crate::support::TestRepo;
use anyhow::{Context, Result};

#[cfg(unix)]
fn runtime_service_sockets() -> Result<Vec<std::path::PathBuf>> {
    let root = std::path::Path::new("/tmp")
        .join(format!("git-span-{}", unsafe { libc::geteuid() }))
        .join("context");
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    Ok(entries
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path().join("service.sock"))
        .filter(|socket| socket.exists())
        .collect())
}

fn contains_service_socket(root: &std::path::Path) -> Result<bool> {
    if !root.exists() {
        return Ok(false);
    }
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            if contains_service_socket(&entry.path())? {
                return Ok(true);
            }
        } else if entry.file_name() == "service.sock" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ignored_contract_case() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let output = repo.run_span(["context", "file1.txt#L1-L3", "--format", "json"])?;
    assert!(output.status.success());
    let document: git_span::cli::context::ContextDocument = serde_json::from_slice(&output.stdout)?;
    assert_eq!(document.schema_version, 1);
    Ok(())
}

#[test]
fn schema_ordering_and_exact_intersections() -> Result<()> {
    ignored_contract_case()
}
#[test]
fn status_source_and_utf8_detail_tokens() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "status", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    let fresh = repo.run_span(["context", "file1.txt#L1-L2", "--format", "json"])?;
    assert!(fresh.status.success());
    let fresh: serde_json::Value = serde_json::from_slice(&fresh.stdout)?;
    let anchor = &fresh["spans"][0]["anchors"][0];
    assert_eq!(anchor["status"]["code"], "FRESH");
    assert_eq!(anchor["source"], serde_json::Value::Null);
    assert_eq!(anchor["sources"], serde_json::json!([]));

    repo.write_file(
        "file1.txt",
        "meaningfully changed\ncontent\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let changed = repo.run_span(["context", "file1.txt#L1-L2", "--format", "json"])?;
    assert!(
        changed.status.success(),
        "{}",
        String::from_utf8_lossy(&changed.stderr)
    );
    let changed: serde_json::Value = serde_json::from_slice(&changed.stdout)?;
    let anchor = &changed["spans"][0]["anchors"][0];
    assert_eq!(anchor["status"]["code"], "CHANGED");
    assert_eq!(anchor["source"], "WORKTREE");
    assert!(
        anchor["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|source| source == "WORKTREE")
    );
    Ok(())
}
#[test]
fn invalid_input_race_and_size_fail_closed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let empty_fix = repo.run_span_with_env(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &uuid::Uuid::new_v4().to_string(),
        ],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(empty_fix.status.success());
    let empty_fix: serde_json::Value = serde_json::from_slice(&empty_fix.stdout)?;
    assert_eq!(empty_fix["mutation"]["requested"], true);
    assert_eq!(empty_fix["mutation"]["rewritten"], false);
    assert_eq!(empty_fix["spans"], serde_json::json!([]));
    assert!(!repo.path().join(".span").exists());

    for address in [
        "missing.txt",
        "../file1.txt",
        "/file1.txt",
        "file*.txt",
        "file1.txt#L3-L1",
        "file1.txt#L0-L1",
    ] {
        let output = repo.run_span_with_env(
            ["context", address, "--format", "json"],
            "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
            "1",
        )?;
        assert!(
            !output.status.success(),
            "invalid address succeeded: {address}"
        );
        assert!(
            output.stdout.is_empty(),
            "invalid address emitted JSON: {address}"
        );
        assert!(
            !output.stderr.is_empty(),
            "invalid address omitted diagnostics: {address}"
        );
    }
    let missing = repo.run_span(["context", "--format", "json"])?;
    assert!(!missing.status.success());
    assert!(missing.stdout.is_empty());
    Ok(())
}
#[test]
fn repair_post_state_and_cycle_safety() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "moving", "file1.txt#L1-L1", "file1.txt#L2-L2"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "line2\nline1\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let fixed = repo.run_span_with_env(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(
        fixed.status.success(),
        "{}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
    assert_eq!(document["mutation"]["requested"], true);
    assert_eq!(document["mutation"]["rewritten"], true);
    assert_eq!(document["mutation"]["spans_touched"], 1);
    assert_eq!(document["mutation"]["anchors_updated"], 2);
    assert!(
        document["spans"][0]["anchors"]
            .as_array()
            .unwrap()
            .iter()
            .all(|anchor| {
                matches!(
                    anchor["status"]["code"].as_str(),
                    Some("FRESH" | "RESOLVED_PENDING_COMMIT")
                )
            })
    );

    let replay = repo.run_span_with_env(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(replay.status.success());
    assert_eq!(replay.stdout, fixed.stdout);

    let conflict = repo.run_span_with_env(
        [
            "context",
            "file2.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(!conflict.status.success());
    assert!(conflict.stdout.is_empty());
    assert!(String::from_utf8(conflict.stderr)?.contains("different normalized request"));
    Ok(())
}

#[test]
fn completed_repair_replays_across_service_identity_environment_changes() -> Result<()> {
    let repo = moved_context_repo("stable-completed-journal")?;
    let operation = uuid::Uuid::new_v4().to_string();
    let fixed = repo.run_span_with_envs(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "A")],
    )?;
    assert!(
        fixed.status.success(),
        "{}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    let fixed_document: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
    assert_eq!(fixed_document["mutation"]["rewritten"], true);

    let replay = repo.run_span_with_envs(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "B")],
    )?;
    assert!(
        replay.status.success(),
        "{}",
        String::from_utf8_lossy(&replay.stderr)
    );
    assert_eq!(replay.stdout, fixed.stdout);

    let conflicting = repo.run_span_with_envs(
        [
            "context",
            "file2.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "B")],
    )?;
    assert!(!conflicting.status.success());
    assert!(conflicting.stdout.is_empty());
    assert!(String::from_utf8(conflicting.stderr)?.contains("different normalized request"));

    let alternate_add = repo.run_span_with_env(
        ["add", "alternate", "file2.txt#L1-L2"],
        "GIT_SPAN_DIR",
        "alternate-spans",
    )?;
    assert!(alternate_add.status.success());
    let wrong_root = repo.run_span_with_envs(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[
            ("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "B"),
            ("GIT_SPAN_DIR", "alternate-spans"),
        ],
    )?;
    assert!(!wrong_root.status.success());
    assert!(wrong_root.stdout.is_empty());
    assert!(String::from_utf8(wrong_root.stderr)?.contains("recovery scope"));
    Ok(())
}

#[test]
fn prepared_repair_recovers_across_service_identity_environment_changes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "a", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["add", "b", "file1.txt#L4-L5"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let died = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "A")
        .env("GIT_SPAN_CONTEXT_TEST_DIE_AFTER", "span-rename:0")
        .args([
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ])
        .output()?;
    assert_eq!(died.status.code(), Some(86));

    let replay = repo.run_span_with_envs(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[
            ("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1"),
            ("GIT_SPAN_JOURNAL_IDENTITY_VARIANT", "B"),
        ],
    )?;
    assert!(
        replay.status.success(),
        "{}",
        String::from_utf8_lossy(&replay.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&replay.stdout)?;
    assert_eq!(document["mutation"]["rewritten"], true);
    assert_eq!(document["mutation"]["anchors_updated"], 2);
    assert!(!repo.path().join(".git/span/recovery.pending").exists());
    let listed = String::from_utf8(repo.run_span(["list", "--oneline"])?.stdout)?;
    assert!(listed.contains("`a` `file1.txt#L3-L4`"), "{listed}");
    assert!(listed.contains("`b` `file1.txt#L5-L6`"), "{listed}");
    Ok(())
}

#[test]
fn no_op_repair_never_prepares_recovery_and_replays_after_repository_changes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "a", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    let operation = uuid::Uuid::new_v4().to_string();
    let args = [
        "context",
        "file1.txt#L1-L2",
        "--format",
        "json",
        "--fix",
        "--operation-id",
        &operation,
    ];
    let fixed = repo.run_span_with_envs(args, &[("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")])?;
    assert!(fixed.status.success(), "{}", String::from_utf8_lossy(&fixed.stderr));
    let document: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
    assert_eq!(document["mutation"]["rewritten"], false);
    assert!(!repo.path().join(".git/span/recovery.pending").exists());

    repo.write_file("file1.txt", "changed\nmeaning\nnow\n")?;
    let replay = repo.run_span_with_envs(args, &[("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")])?;
    assert!(replay.status.success(), "{}", String::from_utf8_lossy(&replay.stderr));
    assert_eq!(replay.stdout, fixed.stdout);
    assert!(!repo.path().join(".git/span/recovery.pending").exists());
    Ok(())
}

#[test]
fn reader_clears_legacy_prepared_no_op_after_repository_changes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "a", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    let operation = uuid::Uuid::new_v4().to_string();
    let fixed = repo.run_span_with_envs(
        [
            "context",
            "file1.txt#L1-L2",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        &[("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")],
    )?;
    assert!(fixed.status.success(), "{}", String::from_utf8_lossy(&fixed.stderr));

    let journal_path = repo
        .path()
        .join(format!(".git/span/context/recovery/journal/operation-{operation}.json"));
    let mut journal: serde_json::Value = serde_json::from_slice(&std::fs::read(&journal_path)?)?;
    assert_eq!(journal["entries"].as_array().map(Vec::len), Some(0));
    journal["state"] = serde_json::Value::String("prepared".into());
    std::fs::write(&journal_path, serde_json::to_vec(&journal)?)?;
    let marker = serde_json::json!({
        "version": 3,
        "operation_id": operation,
        "scope_digest": journal["scope_digest"],
        "span_root": ".span",
        "temporaries": []
    });
    std::fs::write(
        repo.path().join(".git/span/recovery.pending"),
        serde_json::to_vec(&marker)?,
    )?;
    repo.write_file("file1.txt", "changed\nmeaning\nnow\n")?;

    let observed = repo.run_span_with_env(
        ["list", "--oneline"],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(
        observed.status.success(),
        "{}",
        String::from_utf8_lossy(&observed.stderr)
    );
    assert!(!repo.path().join(".git/span/recovery.pending").exists());
    let recovered: serde_json::Value = serde_json::from_slice(&std::fs::read(journal_path)?)?;
    assert_eq!(recovered["state"], "committed");
    Ok(())
}

#[test]
fn marker_without_journal_aborts_cleanly_before_reader_or_writer() -> Result<()> {
    for writer in [false, true] {
        let name = if writer {
            "marker-gap-writer"
        } else {
            "marker-gap-reader"
        };
        let repo = moved_context_repo(name)?;
        let original = std::fs::read(repo.path().join(".span").join(name))?;
        let operation = uuid::Uuid::new_v4().to_string();
        let died = crash_after_recovery_marker(&repo, &operation)?;
        assert_eq!(died.status.code(), Some(86));
        assert!(repo.path().join(".git/span/recovery.pending").exists());
        assert!(
            !repo
                .path()
                .join(format!(
                    ".git/span/context/recovery/journal/operation-{operation}.json"
                ))
                .exists()
        );
        assert_eq!(repair_temporaries(&repo, &operation)?.len(), 1);

        let output = if writer {
            repo.run_span(["add", "after-marker-abort", "file2.txt#L1-L2"])?
        } else {
            repo.run_span_with_env(
                ["context", "file1.txt", "--format", "json"],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?
        };
        assert!(
            output.status.success(),
            "status {:?}; stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!repo.path().join(".git/span/recovery.pending").exists());
        assert!(repair_temporaries(&repo, &operation)?.is_empty());

        let listed = String::from_utf8(repo.run_span(["list", "--oneline"])?.stdout)?;
        assert!(
            listed.contains(&format!("`{name}` `file1.txt#L2-L3`")),
            "{listed}"
        );
        assert_eq!(
            std::fs::read(repo.path().join(".span").join(name))?,
            original
        );
        if writer {
            assert!(listed.contains("`after-marker-abort` `file2.txt#L1-L2`"));
        } else {
            let retry = repo.run_span_with_env(
                [
                    "context",
                    "file1.txt",
                    "--format",
                    "json",
                    "--fix",
                    "--operation-id",
                    &operation,
                ],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?;
            assert!(
                retry.status.success(),
                "{}",
                String::from_utf8_lossy(&retry.stderr)
            );
            let document: serde_json::Value = serde_json::from_slice(&retry.stdout)?;
            assert_eq!(document["mutation"]["rewritten"], true);
        }
    }
    Ok(())
}

#[test]
fn marker_without_journal_refuses_changed_live_targets() -> Result<()> {
    enum Divergence {
        Planned,
        External,
        OriginallyAbsent,
    }

    for (label, divergence) in [
        ("planned", Divergence::Planned),
        ("external", Divergence::External),
        ("created", Divergence::OriginallyAbsent),
    ] {
        let span_name = format!("marker-live-{label}");
        let repo = moved_context_repo(&span_name)?;
        let operation = uuid::Uuid::new_v4().to_string();
        let died = crash_after_recovery_marker(&repo, &operation)?;
        assert_eq!(died.status.code(), Some(86));

        let temporaries = repair_temporaries(&repo, &operation)?;
        assert_eq!(temporaries.len(), 1);
        let temporary = &temporaries[0];
        let target = match divergence {
            Divergence::Planned => {
                let target = repo.path().join(".span").join(&span_name);
                std::fs::copy(temporary, &target)?;
                target
            }
            Divergence::External => {
                let target = repo.path().join(".span").join(&span_name);
                std::fs::write(&target, b"third-party live span bytes\n")?;
                target
            }
            Divergence::OriginallyAbsent => {
                let target_relative = format!("created-after-{label}");
                let target = repo.path().join(".span").join(&target_relative);
                assert!(!target.exists());
                // Model the marker state for a transaction-created target:
                // the path is absent at the durable marker boundary, then an
                // external writer creates it before recovery.
                retarget_marker_as_originally_absent(&repo, &target_relative)?;
                std::fs::write(&target, b"new external live span bytes\n")?;
                target
            }
        };
        let expected_live = std::fs::read(&target)?;
        let expected_temporary = std::fs::read(temporary)?;
        let marker = repo.path().join(".git/span/recovery.pending");
        let expected_marker = std::fs::read(&marker)?;

        for writer in [false, true] {
            let output = if writer {
                repo.run_span(["add", &format!("blocked-{label}"), "file2.txt#L1-L2"])?
            } else {
                repo.run_span_with_env(
                    ["context", "file1.txt", "--format", "json"],
                    "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                    "1",
                )?
            };
            assert!(
                !output.status.success(),
                "{label} {} unexpectedly succeeded: {}",
                if writer { "writer" } else { "reader" },
                String::from_utf8_lossy(&output.stdout)
            );
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                stderr.contains("cannot prove unjournaled context repair stayed before mutation"),
                "{label} {} stderr: {stderr}",
                if writer { "writer" } else { "reader" }
            );
            assert_eq!(std::fs::read(&marker)?, expected_marker);
            assert_eq!(std::fs::read(temporary)?, expected_temporary);
            assert_eq!(std::fs::read(&target)?, expected_live);
        }
    }
    Ok(())
}

#[test]
fn service_identity_bootstrap_and_strict_fallback() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served", "file1.txt#L1-L3"])?
            .status
            .success()
    );
    let args = ["--perf", "context", "file1.txt#L1-L3", "--format", "json"];
    let cold = repo.run_span(args)?;
    assert!(
        cold.status.success(),
        "{}",
        String::from_utf8_lossy(&cold.stderr)
    );
    let warm = repo.run_span(args)?;
    assert!(
        warm.status.success(),
        "{}",
        String::from_utf8_lossy(&warm.stderr)
    );
    let diagnostics = String::from_utf8(warm.stderr.clone())?;
    assert!(
        diagnostics.contains("context.service-generation-hits 1"),
        "{diagnostics}"
    );
    assert!(
        diagnostics.contains("context.service-resolver-passes 0"),
        "{diagnostics}"
    );
    let environment_variant = repo.run_span_with_env(
        args,
        "GIT_SPAN_AGENT_SESSION_ID",
        "a-different-agent-session",
    )?;
    assert!(
        environment_variant.status.success(),
        "{}",
        String::from_utf8_lossy(&environment_variant.stderr)
    );
    let environment_diagnostics = String::from_utf8(environment_variant.stderr)?;
    assert!(
        environment_diagnostics.contains("context.service-generation-hits 1"),
        "volatile agent metadata created a cold service: {environment_diagnostics}"
    );
    assert!(!contains_service_socket(&repo.path().join(".git"))?);
    let fallback = repo.run_span_with_env(
        ["context", "file1.txt#L1-L3", "--format", "json"],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(fallback.status.success());
    assert_eq!(warm.stdout, fallback.stdout);

    let alternate_add = repo.run_span_with_env(
        ["add", "alternate", "file2.txt#L1-L2"],
        "GIT_SPAN_DIR",
        "alternate-spans",
    )?;
    assert!(
        alternate_add.status.success(),
        "{}",
        String::from_utf8_lossy(&alternate_add.stderr)
    );
    let alternate = repo.run_span_with_env(
        ["context", "file2.txt#L1-L2", "--format", "json"],
        "GIT_SPAN_DIR",
        "alternate-spans",
    )?;
    assert!(alternate.status.success());
    let alternate_json: serde_json::Value = serde_json::from_slice(&alternate.stdout)?;
    assert_eq!(alternate_json["spans"][0]["name"], "alternate");
    assert_ne!(
        alternate.stdout, fallback.stdout,
        "root-keyed services mixed"
    );
    let concurrent_add = repo.run_span_with_env(
        ["add", "concurrent", "file1.txt#L4-L5"],
        "GIT_SPAN_DIR",
        "concurrent-spans",
    )?;
    assert!(concurrent_add.status.success());
    let repo_path = repo.path().to_path_buf();
    let clients = (0..8)
        .map(|_| {
            let repo_path = repo_path.clone();
            std::thread::spawn(move || {
                std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
                    .current_dir(repo_path)
                    .env("GIT_SPAN_DIR", "concurrent-spans")
                    .args(["context", "file1.txt#L4-L5", "--format", "json"])
                    .output()
            })
        })
        .collect::<Vec<_>>();
    let concurrent = clients
        .into_iter()
        .map(|client| client.join().expect("context client did not panic"))
        .collect::<std::io::Result<Vec<_>>>()?;
    assert!(concurrent.iter().all(|output| output.status.success()));
    assert!(
        concurrent
            .windows(2)
            .all(|pair| pair[0].stdout == pair[1].stdout),
        "concurrent bootstrap/read answers diverged"
    );

    let linked_parent = tempfile::tempdir()?;
    let linked = linked_parent.path().join("linked");
    let linked_text = linked.to_string_lossy().into_owned();
    assert!(
        repo.run_git(["worktree", "add", "-b", "linked-context", &linked_text])?
            .status
            .success()
    );
    let linked_add = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(&linked)
        .args(["add", "linked", "file2.txt#L3-L4"])
        .output()?;
    assert!(linked_add.status.success());
    #[cfg(unix)]
    let sockets_before_linked = runtime_service_sockets()?
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    let linked_query = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(&linked)
        .env("TMPDIR", repo.path().join(".git/worktrees"))
        .args(["context", "file2.txt#L3-L4", "--format", "json"])
        .output()?;
    assert!(linked_query.status.success());
    let linked_json: serde_json::Value = serde_json::from_slice(&linked_query.stdout)?;
    assert_eq!(linked_json["spans"][0]["name"], "linked");
    assert!(!contains_service_socket(&repo.path().join(".git"))?);
    #[cfg(unix)]
    assert!(
        runtime_service_sockets()?
            .iter()
            .any(|socket| !sockets_before_linked.contains(socket)),
        "linked worktree did not receive a distinct runtime service"
    );
    for failure in [
        "backend",
        "limit",
        "replacement",
        "read",
        "malformed",
        "overflow",
    ] {
        let injected = repo.run_span_with_env(
            ["context", "file1.txt#L1-L3", "--format", "json"],
            "GIT_SPAN_CONTEXT_TEST_WATCH_FAILURE",
            failure,
        )?;
        assert!(
            injected.status.success(),
            "watch failure {failure}: {}",
            String::from_utf8_lossy(&injected.stderr)
        );
        assert_eq!(injected.stdout, fallback.stdout, "watch failure {failure}");
    }
    repo.write_file("file1.txt", "different\nmeaning\nnow\n")?;
    let invalidated = repo.run_span(args)?;
    assert!(invalidated.status.success());
    assert!(String::from_utf8(invalidated.stderr)?.contains("context.service-invalidations"));

    Ok(())
}

#[test]
fn context_warm_starts_service_without_an_address_or_document() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served", "file1.txt#L1-L3"])?
            .status
            .success()
    );

    let warmup = repo.run_span(["context", "--warm"])?;
    assert!(
        warmup.status.success(),
        "{}",
        String::from_utf8_lossy(&warmup.stderr)
    );
    assert!(warmup.stdout.is_empty());

    let query = repo.run_span(["--perf", "context", "file1.txt#L1-L3", "--format", "json"])?;
    assert!(
        query.status.success(),
        "{}",
        String::from_utf8_lossy(&query.stderr)
    );
    let diagnostics = String::from_utf8(query.stderr)?;
    assert!(
        diagnostics.contains("context.service-generation-hits 1"),
        "warm-up did not leave a reusable generation: {diagnostics}"
    );
    Ok(())
}
#[test]
fn watch_closure_liveness_and_backpressure() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "watched", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    repo.commit_all("anchor watched context")?;
    let alternate_store = TestRepo::new()?;
    let alternate_objects = alternate_store.path().join(".git/objects");
    repo.write_file(
        ".git/objects/info/alternates",
        &format!("{}\n", alternate_objects.display()),
    )?;
    let query = ["--perf", "context", "file1.txt#L1-L2", "--format", "json"];
    #[cfg(unix)]
    let sockets_before_query = runtime_service_sockets()?
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    assert!(repo.run_span(query)?.status.success());
    assert!(repo.run_span(query)?.status.success());
    #[cfg(unix)]
    let service_socket = runtime_service_sockets()?
        .into_iter()
        .find(|socket| !sockets_before_query.contains(socket))
        .expect("context query did not create a runtime service socket");

    std::fs::write(alternate_objects.join("context-watch-probe"), b"changed")?;
    let alternate_changed = repo.run_span(query)?;
    assert!(alternate_changed.status.success());
    assert!(
        perf_counter(
            &String::from_utf8(alternate_changed.stderr)?,
            "context.service-invalidations"
        ) > 0,
        "alternate object event was not observed"
    );

    assert!(
        repo.run_span(["why", "watched", "Watcher-visible rationale."])?
            .status
            .success()
    );
    let definition_changed = repo.run_span(query)?;
    assert!(definition_changed.status.success());
    let document: serde_json::Value = serde_json::from_slice(&definition_changed.stdout)?;
    assert_eq!(document["spans"][0]["why"], "Watcher-visible rationale.");

    repo.write_file(
        "file1.txt",
        "LINE1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let worktree_changed = repo.run_span(query)?;
    assert!(worktree_changed.status.success());
    let document: serde_json::Value = serde_json::from_slice(&worktree_changed.stdout)?;
    assert_eq!(
        document["spans"][0]["anchors"][0]["status"]["code"],
        "CHANGED"
    );
    repo.run_git(["add", "file1.txt", ".span/watched"])?;
    assert!(repo.run_span(query)?.status.success());
    repo.commit_all("advance watched source and definition")?;
    assert!(repo.run_span(query)?.status.success());

    let expected = repo.run_span(["context", "file1.txt#L1-L2", "--format", "json"])?;
    let binary = std::path::PathBuf::from(env!("CARGO_BIN_EXE_git-span"));
    let cwd = repo.path().to_path_buf();
    let readers = (0..12)
        .map(|_| {
            let binary = binary.clone();
            let cwd = cwd.clone();
            std::thread::spawn(move || {
                std::process::Command::new(binary)
                    .current_dir(cwd)
                    .args(["context", "file1.txt#L1-L2", "--format", "json"])
                    .output()
            })
        })
        .collect::<Vec<_>>();
    for reader in readers {
        let output = reader.join().expect("context reader panicked")?;
        assert!(output.status.success());
        assert_eq!(output.stdout, expected.stdout);
    }

    let saturated = (0..32)
        .map(|_| {
            let binary = binary.clone();
            let cwd = cwd.clone();
            std::thread::spawn(move || {
                std::process::Command::new(binary)
                    .current_dir(cwd)
                    .env("GIT_SPAN_CONTEXT_TEST_WORKER_DELAY_MS", "250")
                    .args(["context", "file1.txt#L1-L2", "--format", "json"])
                    .output()
            })
        })
        .collect::<Vec<_>>();
    for client in saturated {
        let output = client.join().expect("saturated context client panicked")?;
        assert!(output.status.success());
        assert_eq!(output.stdout, expected.stdout);
    }
    #[cfg(unix)]
    {
        let stalled = (0..16)
            .map(|_| crate::support::stall_unix_socket(&service_socket))
            .collect::<std::io::Result<Vec<_>>>()?;
        std::thread::sleep(std::time::Duration::from_millis(300));
        let bounded = repo.run_span(["context", "file1.txt#L1-L2", "--format", "json"])?;
        assert!(bounded.status.success());
        assert_eq!(bounded.stdout, expected.stdout);
        for client in stalled {
            client.join().expect("stalled peer thread panicked");
        }
    }
    Ok(())
}

fn perf_counter(stderr: &str, label: &str) -> u64 {
    let prefix = format!("git-span perf: {label} ");
    stderr
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}
#[test]
fn atomic_recovery_and_operation_id_replay() -> Result<()> {
    for boundary in [
        "span-temp-fsync:0",
        "recovery-marker-persisted",
        "journal-prepared",
        "span-rename:0",
        "span-file-fsync:0",
        "span-directory-fsync:0",
        "journal-progress:0",
        "generation-publication",
        "journal-committed",
    ] {
        let repo = moved_context_repo("recoverable")?;
        let died = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo.path())
            .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
            .env("GIT_SPAN_CONTEXT_TEST_DIE_AFTER", boundary)
            .args(["context", "file1.txt", "--format", "json", "--fix"])
            .output()?;
        assert_eq!(
            died.status.code(),
            Some(86),
            "{boundary}: {}",
            String::from_utf8_lossy(&died.stderr)
        );
        assert!(died.stdout.is_empty(), "{boundary}");
        let stderr = String::from_utf8(died.stderr)?;
        let operation = stderr
            .lines()
            .find_map(|line| line.strip_prefix("git-span context operation: "))
            .expect("generated operation receipt was flushed before mutation");
        let replay = repo.run_span_with_env(
            [
                "context",
                "file1.txt",
                "--format",
                "json",
                "--fix",
                "--operation-id",
                operation,
            ],
            "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
            "1",
        )?;
        assert!(
            replay.status.success(),
            "{boundary}: {}",
            String::from_utf8_lossy(&replay.stderr)
        );
        let document: serde_json::Value = serde_json::from_slice(&replay.stdout)?;
        assert_eq!(document["mutation"]["rewritten"], true, "{boundary}");
        assert_eq!(document["mutation"]["anchors_updated"], 1, "{boundary}");
    }

    // A third-party edit after a partial transaction is never overwritten by
    // recovery. The first span may already contain planned bytes; the second
    // remains exactly the external bytes and the retry fails with no JSON.
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "a", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["add", "b", "file1.txt#L4-L5"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let original_a = std::fs::read(repo.path().join(".span/a"))?;
    let operation = uuid::Uuid::new_v4().to_string();
    let died = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env("GIT_SPAN_CONTEXT_TEST_DIE_AFTER", "span-rename:0")
        .args([
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ])
        .output()?;
    assert_eq!(died.status.code(), Some(86));
    let divergent = format!(
        "{}\nexternal edit\n",
        std::fs::read_to_string(repo.path().join(".span/b"))?
    );
    std::fs::write(repo.path().join(".span/b"), &divergent)?;
    let refused = repo.run_span_with_env(
        [
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert!(!refused.status.success());
    assert!(refused.stdout.is_empty());
    assert_eq!(
        std::fs::read_to_string(repo.path().join(".span/b"))?,
        divergent
    );
    assert_eq!(
        std::fs::read(repo.path().join(".span/a"))?,
        original_a,
        "prepared recovery rolls back only transaction-owned planned bytes"
    );

    if crate::support::symlinks_supported() {
        for boundary in [
            "span-temp-fsync:0",
            "recovery-marker-persisted",
            "journal-prepared",
            "span-rename:0",
            "span-file-fsync:0",
            "span-directory-fsync:0",
            "journal-progress:0",
            "generation-publication",
            "journal-committed",
        ] {
            let repo = moved_context_repo("nested/swap-safe")?;
            let operation = uuid::Uuid::new_v4().to_string();
            let hooks = tempfile::tempdir()?;
            let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
                .current_dir(repo.path())
                .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
                .env("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_DIR", hooks.path())
                .env("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_BOUNDARY", boundary)
                .args([
                    "context",
                    "file1.txt",
                    "--format",
                    "json",
                    "--fix",
                    "--operation-id",
                    &operation,
                ])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()?;
            let safe = boundary.replace(':', "-");
            let ready = hooks.path().join(format!("repair-{safe}.ready"));
            let release = hooks.path().join(format!("repair-{safe}.release"));
            let token = wait_for_checkpoint(&ready, None)
                .with_context(|| format!("waiting for span-parent swap boundary {boundary}"))?;
            let public = repo.path().join(".span/nested");
            let retained = repo.path().join(".span/nested-retained");
            let attacker = repo.path().join("attacker-span");
            std::fs::create_dir(&attacker)?;
            std::fs::rename(&public, &retained)?;
            crate::support::symlink_dir(&attacker, &public)?;
            std::fs::write(&release, token)?;
            let output = child.wait_with_output()?;
            assert!(
                !output.status.success(),
                "parent swap succeeded at {boundary}"
            );
            assert!(
                output.stdout.is_empty(),
                "parent swap emitted JSON at {boundary}"
            );
            assert_eq!(
                std::fs::read_dir(&attacker)?.count(),
                0,
                "attacker directory changed at {boundary}"
            );
            std::fs::remove_file(&public)?;
            std::fs::rename(&retained, &public)?;
            let replay = repo.run_span_with_env(
                [
                    "context",
                    "file1.txt",
                    "--format",
                    "json",
                    "--fix",
                    "--operation-id",
                    &operation,
                ],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?;
            assert!(
                replay.status.success(),
                "recovery after {boundary}: {}",
                String::from_utf8_lossy(&replay.stderr)
            );
        }

        for boundary in [
            "span-temp-fsync:0",
            "recovery-marker-persisted",
            "journal-prepared",
            "span-rename:0",
            "span-file-fsync:0",
            "span-directory-fsync:0",
            "journal-progress:0",
            "generation-publication",
            "journal-committed",
        ] {
            let repo = moved_context_repo("recovery-swap-safe")?;
            let operation = uuid::Uuid::new_v4().to_string();
            let hooks = tempfile::tempdir()?;
            let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
                .current_dir(repo.path())
                .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
                .env("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_DIR", hooks.path())
                .env("GIT_SPAN_CONTEXT_TEST_REPAIR_HOOK_BOUNDARY", boundary)
                .args([
                    "context",
                    "file1.txt",
                    "--format",
                    "json",
                    "--fix",
                    "--operation-id",
                    &operation,
                ])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()?;
            let safe = boundary.replace(':', "-");
            let ready = hooks.path().join(format!("repair-{safe}.ready"));
            let release = hooks.path().join(format!("repair-{safe}.release"));
            let token = wait_for_checkpoint(&ready, None)
                .with_context(|| format!("waiting for recovery swap boundary {boundary}"))?;
            let context_root = repo.path().join(".git/span/context");
            let public = context_root.join("recovery");
            let retained = context_root.join("retained-recovery");
            let attacker = repo.path().join("attacker-recovery");
            std::fs::create_dir(&attacker)?;
            std::fs::rename(&public, &retained)?;
            crate::support::symlink_dir(&attacker, &public)?;
            std::fs::write(&release, token)?;
            let output = child.wait_with_output()?;
            assert!(
                !output.status.success(),
                "recovery authority swap succeeded at {boundary}"
            );
            assert!(
                output.stdout.is_empty(),
                "recovery authority swap emitted JSON at {boundary}"
            );
            assert_eq!(
                std::fs::read_dir(&attacker)?.count(),
                0,
                "attacker recovery directory changed at {boundary}"
            );
            std::fs::remove_file(&public)?;
            std::fs::rename(&retained, &public)?;
            let replay = repo.run_span_with_env(
                [
                    "context",
                    "file1.txt",
                    "--format",
                    "json",
                    "--fix",
                    "--operation-id",
                    &operation,
                ],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?;
            assert!(
                replay.status.success(),
                "descriptor-safe recovery after {boundary}: {}",
                String::from_utf8_lossy(&replay.stderr)
            );
        }
    }
    Ok(())
}

#[test]
fn ordinary_readers_recover_prepared_repair_before_observation() -> Result<()> {
    for surface in ["list", "show", "drift", "context"] {
        let repo = TestRepo::seeded()?;
        assert!(
            repo.run_span(["add", "a", "file1.txt#L2-L3"])?
                .status
                .success()
        );
        assert!(
            repo.run_span(["add", "b", "file1.txt#L4-L5"])?
                .status
                .success()
        );
        repo.write_file(
            "file1.txt",
            "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        )?;
        let operation = uuid::Uuid::new_v4().to_string();
        let died = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo.path())
            .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
            .env("GIT_SPAN_CONTEXT_TEST_DIE_AFTER", "span-rename:0")
            .args([
                "context",
                "file1.txt",
                "--format",
                "json",
                "--fix",
                "--operation-id",
                &operation,
            ])
            .output()?;
        assert_eq!(died.status.code(), Some(86), "{surface}");

        let observed = match surface {
            "list" => repo.run_span_with_env(
                ["list", "--oneline"],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?,
            "show" => {
                repo.run_span_with_env(["show", "b"], "GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")?
            }
            "drift" => repo.run_span_with_env(
                ["drift", "--format", "porcelain"],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?,
            "context" => repo.run_span_with_env(
                ["context", "file1.txt", "--format", "json"],
                "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
                "1",
            )?,
            _ => unreachable!(),
        };
        assert!(
            observed.status.success(),
            "{surface}: {}",
            String::from_utf8_lossy(&observed.stderr)
        );
        match surface {
            "list" => {
                let stdout = String::from_utf8(observed.stdout)?;
                assert!(stdout.contains("`a` `file1.txt#L3-L4`"), "{stdout}");
                assert!(stdout.contains("`b` `file1.txt#L5-L6`"), "{stdout}");
            }
            "show" => {
                let stdout = String::from_utf8(observed.stdout)?;
                assert!(stdout.contains("start = 5"), "{stdout}");
                assert!(stdout.contains("end = 6"), "{stdout}");
            }
            "drift" => assert!(observed.stdout.is_empty()),
            "context" => {
                let document: serde_json::Value = serde_json::from_slice(&observed.stdout)?;
                assert_eq!(document["spans"].as_array().map(Vec::len), Some(2));
                assert!(document["spans"].as_array().unwrap().iter().all(|span| {
                    matches!(
                        span["anchors"][0]["status"]["code"].as_str(),
                        Some("FRESH" | "RESOLVED_PENDING_COMMIT")
                    )
                }));
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}

#[test]
fn legacy_writer_recovers_prepared_repair_before_per_span_mutation() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "a", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["add", "b", "file1.txt#L4-L5"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let died = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env("GIT_SPAN_CONTEXT_TEST_DIE_AFTER", "span-rename:0")
        .args([
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            &operation,
        ])
        .output()?;
    assert_eq!(died.status.code(), Some(86));

    let writer = repo.run_span(["why", "b", "Recovery precedes this legacy writer."])?;
    assert!(
        writer.status.success(),
        "{}",
        String::from_utf8_lossy(&writer.stderr)
    );
    assert!(!repo.path().join(".git/span/recovery.pending").exists());

    let listed = repo.run_span(["list", "--oneline"])?;
    assert!(listed.status.success());
    let stdout = String::from_utf8(listed.stdout)?;
    assert!(stdout.contains("`a` `file1.txt#L3-L4`"), "{stdout}");
    assert!(stdout.contains("`b` `file1.txt#L5-L6`"), "{stdout}");
    let shown = repo.run_span(["show", "b"])?;
    assert!(shown.status.success());
    assert!(String::from_utf8(shown.stdout)?.contains("Recovery precedes this legacy writer."));
    Ok(())
}

fn crash_after_recovery_marker(repo: &TestRepo, operation: &str) -> Result<std::process::Output> {
    Ok(std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env(
            "GIT_SPAN_CONTEXT_TEST_DIE_AFTER",
            "recovery-marker-persisted",
        )
        .args([
            "context",
            "file1.txt",
            "--format",
            "json",
            "--fix",
            "--operation-id",
            operation,
        ])
        .output()?)
}

fn retarget_marker_as_originally_absent(repo: &TestRepo, target: &str) -> Result<()> {
    let path = repo.path().join(".git/span/recovery.pending");
    let mut marker: serde_json::Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    let temporaries = marker["temporaries"]
        .as_array_mut()
        .context("recovery marker has no temporary manifest")?;
    anyhow::ensure!(temporaries.len() == 1, "expected one recovery temporary");
    temporaries[0]["target_relative"] = serde_json::Value::String(target.to_owned());
    temporaries[0]["original"] = serde_json::json!({ "state": "absent" });
    std::fs::write(path, serde_json::to_vec(&marker)?)?;
    Ok(())
}

fn moved_context_repo(name: &str) -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", name, "file1.txt#L2-L3"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    Ok(repo)
}

fn repair_temporaries(repo: &TestRepo, operation: &str) -> Result<Vec<std::path::PathBuf>> {
    fn collect(
        directory: &std::path::Path,
        prefix: &str,
        output: &mut Vec<std::path::PathBuf>,
    ) -> Result<()> {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                collect(&entry.path(), prefix, output)?;
            } else if kind.is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(prefix) && name.ends_with(".tmp"))
            {
                output.push(entry.path());
            }
        }
        Ok(())
    }

    let mut output = Vec::new();
    collect(
        &repo.path().join(".span"),
        &format!(".context-{operation}-"),
        &mut output,
    )?;
    output.sort();
    Ok(output)
}

#[test]
fn controlled_repair_epoch() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served-repair", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["context", "file1.txt", "--format", "json"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let fixed = repo.run_span([
        "--perf",
        "context",
        "file1.txt",
        "--format",
        "json",
        "--fix",
        "--operation-id",
        &operation,
    ])?;
    assert!(
        fixed.status.success(),
        "{}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    let fixed_json: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
    assert_eq!(fixed_json["mutation"]["rewritten"], true);
    // A transient RPC miss falls back to the non-service repair, which prints
    // no service counters; surface the stderr so that distinction is visible
    // in the failure instead of a bare `contains` mismatch.
    let fixed_stderr = String::from_utf8(fixed.stderr)?;
    assert!(
        fixed_stderr.contains("context.service-corpus-loads 2"),
        "expected the service repair path with two corpus loads, got: {fixed_stderr}"
    );

    let next = repo.run_span(["--perf", "context", "file1.txt", "--format", "json"])?;
    assert!(
        next.status.success(),
        "{}",
        String::from_utf8_lossy(&next.stderr)
    );
    let next_json: serde_json::Value = serde_json::from_slice(&next.stdout)?;
    assert_eq!(next_json["spans"], fixed_json["spans"]);
    assert_eq!(next_json["scopes"], fixed_json["scopes"]);
    let next_stderr = String::from_utf8(next.stderr)?;
    assert!(
        next_stderr.contains("context.service-generation-hits 1"),
        "{next_stderr}"
    );
    Ok(())
}

#[test]
fn resident_service_repairs_each_immediate_full_file_prepend() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served-repeat", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["context", "file1.txt", "--format", "json"])?
            .status
            .success()
    );

    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    let mut prefixes = String::new();
    for expected_start in 3..=10 {
        prefixes.push_str(&format!("prefix-{expected_start}\n"));
        repo.write_file("file1.txt", &format!("{prefixes}{original}"))?;
        let operation = uuid::Uuid::new_v4().to_string();
        let fixed = repo.run_span([
            "context",
            "file1.txt",
            "--fix",
            "--operation-id",
            &operation,
            "--format",
            "json",
        ])?;
        assert!(
            fixed.status.success(),
            "{}",
            String::from_utf8_lossy(&fixed.stderr)
        );
        let document: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
        assert_eq!(document["mutation"]["rewritten"], true);
        assert_eq!(
            document["spans"][0]["anchors"][0]["current"]["extent"]["start"],
            expected_start
        );
    }
    Ok(())
}

#[test]
fn dirty_rebuild_completes_while_another_query_holds_shared_recovery() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    let hooks = tempfile::tempdir()?;
    let hook_path = hooks.path().to_string_lossy().into_owned();
    let query = ["context", "file1.txt", "--format", "json"];
    let warm =
        repo.run_span_with_env(query, "GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR", &hook_path)?;
    assert!(warm.status.success());

    let checkpoint = "query-shared-before-stability";
    std::fs::write(hooks.path().join(format!("{checkpoint}.arm")), b"armed")?;
    let binary = env!("CARGO_BIN_EXE_git-span").to_owned();
    let cwd = repo.path().to_path_buf();
    let (reader_tx, reader_rx) = std::sync::mpsc::channel();
    std::thread::spawn({
        let binary = binary.clone();
        let cwd = cwd.clone();
        move || {
            let result = std::process::Command::new(binary)
                .current_dir(cwd)
                .args(query)
                .output();
            let _ = reader_tx.send(result);
        }
    });
    let ready = hooks.path().join(format!("{checkpoint}.ready"));
    let token = wait_for_checkpoint(&ready, None)?;

    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let (dirty_tx, dirty_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = std::process::Command::new(binary)
            .current_dir(cwd)
            .args(query)
            .output();
        let _ = dirty_tx.send(result);
    });
    let dirty = dirty_rx.recv_timeout(std::time::Duration::from_secs(5));
    std::fs::write(hooks.path().join(format!("{checkpoint}.release")), token)?;
    let reader = reader_rx.recv_timeout(std::time::Duration::from_secs(5))??;
    let dirty = dirty.context("dirty rebuild blocked behind a shared query")??;
    assert!(
        reader.status.success(),
        "{}",
        String::from_utf8_lossy(&reader.stderr)
    );
    assert!(
        dirty.status.success(),
        "{}",
        String::from_utf8_lossy(&dirty.stderr)
    );
    let oracle = repo.run_span_with_env(query, "GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")?;
    assert!(oracle.status.success());
    assert_eq!(dirty.stdout, oracle.stdout);
    assert_eq!(reader.stdout, oracle.stdout);
    Ok(())
}

#[test]
fn foreground_repair_replay_publishes_to_resident_service() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "served", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["context", "file1.txt", "--format", "json"])?
            .status
            .success()
    );
    repo.write_file(
        "file1.txt",
        "prefix\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let repair_args = [
        "context",
        "file1.txt",
        "--format",
        "json",
        "--fix",
        "--operation-id",
        &operation,
    ];
    let foreground =
        repo.run_span_with_env(repair_args, "GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")?;
    assert!(foreground.status.success());

    let replay = repo.run_span(repair_args)?;
    assert!(
        replay.status.success(),
        "{}",
        String::from_utf8_lossy(&replay.stderr)
    );
    assert_eq!(replay.stdout, foreground.stdout);
    let next = repo.run_span(["--perf", "context", "file1.txt", "--format", "json"])?;
    assert!(
        next.status.success(),
        "{}",
        String::from_utf8_lossy(&next.stderr)
    );
    let replay_json: serde_json::Value = serde_json::from_slice(&replay.stdout)?;
    let next_json: serde_json::Value = serde_json::from_slice(&next.stdout)?;
    assert_eq!(next_json["spans"], replay_json["spans"]);
    assert_eq!(next_json["scopes"], replay_json["scopes"]);
    assert!(String::from_utf8(next.stderr)?.contains("context.service-generation-hits 1"));
    Ok(())
}
#[test]
fn strict_tombstone_and_definition_capture() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "gone", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    repo.commit_all("commit tombstoned span")?;
    std::fs::remove_file(repo.path().join(".span/gone"))?;
    let strict = |repo: &TestRepo| {
        repo.run_span_with_env(
            ["context", "file1.txt", "--format", "json"],
            "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
            "1",
        )
    };
    let tombstone = strict(&repo)?;
    assert!(tombstone.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&tombstone.stdout)?["spans"],
        serde_json::json!([])
    );

    repo.write_file(".span/broken", "not a span\n")?;
    let broken = strict(&repo)?;
    assert!(!broken.status.success());
    assert!(broken.stdout.is_empty());
    std::fs::remove_file(repo.path().join(".span/broken"))?;
    repo.write_file(".span/conflicted", "<<<<<<< ours\nfile1.txt rk64:0000000000000000\n=======\nfile2.txt rk64:0000000000000000\n>>>>>>> theirs\n")?;
    let conflicted = strict(&repo)?;
    assert!(!conflicted.status.success());
    assert!(conflicted.stdout.is_empty());
    assert!(String::from_utf8(conflicted.stderr)?.contains("conflicted definitions"));

    std::fs::remove_file(repo.path().join(".span/conflicted"))?;
    assert!(
        repo.run_span(["add", "racy", "file1.txt#L1-L2"])?
            .status
            .success()
    );
    let definition = repo.path().join(".span/racy");
    let original = std::fs::read_to_string(&definition)?;
    let alternate = original.replace("file1.txt", "file2.txt");
    let hooks = tempfile::tempdir()?;
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env("GIT_SPAN_CONTEXT_TEST_HOOK_DIR", hooks.path())
        .args(["context", "file1.txt", "--format", "json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let ready = hooks.path().join("after-discovery.ready");
    let release = hooks.path().join("after-discovery.release");
    let first = wait_for_checkpoint(&ready, None)?;
    std::fs::write(&definition, &alternate)?;
    std::fs::write(&release, &first)?;
    let second = wait_for_checkpoint(&ready, Some(&first))?;
    std::fs::write(&definition, &original)?;
    std::fs::write(&release, second)?;
    let raced = child.wait_with_output()?;
    assert!(!raced.status.success());
    assert!(raced.stdout.is_empty());
    let stderr = String::from_utf8(raced.stderr)?;
    assert!(
        stderr.contains("span definitions changed"),
        "the racy child must report the mid-run definition change; its stderr was:\n{stderr}"
    );
    Ok(())
}

fn wait_for_checkpoint(path: &std::path::Path, previous: Option<&str>) -> Result<String> {
    // The ready-poll deadline must stay comfortably below the child side's
    // release-wait budget (180s in `context_test_checkpoint`): the child
    // starts burning its budget the moment it writes `ready`, and this
    // thread's wall-clock polling can be starved by the rest of the suite,
    // so the poll must never be the binding constraint under parallel load.
    // 120s absorbs a fully saturated test phase (30s was observed to expire
    // there), and one final read after the deadline catches a ready file
    // written while this thread was descheduled.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    loop {
        if let Ok(token) = std::fs::read_to_string(path)
            && previous != Some(token.as_str())
        {
            return Ok(token);
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    anyhow::bail!("timed out waiting for context checkpoint")
}
#[test]
fn production_perf_counters_and_acceptance_harness() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "bench", "file1.txt#L2-L3"])?
            .status
            .success()
    );
    assert!(
        repo.run_span(["why", "bench", "benchmark why"])?
            .status
            .success()
    );
    let query = ["context", "file1.txt#L2-L3", "--format", "json"];
    let oracle = repo.run_span_with_env(query, "GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")?;
    assert!(oracle.status.success());
    assert!(repo.run_span(query)?.status.success());

    let mut context_samples = Vec::with_capacity(31);
    let mut legacy_samples = Vec::with_capacity(31);
    for _ in 0..31 {
        let started = std::time::Instant::now();
        let output = repo.run_span(query)?;
        context_samples.push(started.elapsed());
        assert!(output.status.success());
        assert_eq!(output.stdout, oracle.stdout);
    }
    for _ in 0..31 {
        let started = std::time::Instant::now();
        let fix = repo.run_span(["drift", "--fix"])?;
        assert!(
            fix.status.success(),
            "drift --fix failed: {:?}\nstdout:\n{}\nstderr:\n{}",
            fix.status,
            String::from_utf8_lossy(&fix.stdout),
            String::from_utf8_lossy(&fix.stderr)
        );
        assert!(
            repo.run_span(["list", "file1.txt#L2-L3", "--porcelain"])?
                .status
                .success()
        );
        let drift = repo.run_span(["drift", "file1.txt#L2-L3", "--format", "porcelain"])?;
        assert!(matches!(drift.status.code(), Some(0 | 1)));
        let why = repo.run_span(["why", "bench"])?;
        assert!(matches!(why.status.code(), Some(0 | 1)));
        legacy_samples.push(started.elapsed());
    }
    context_samples.sort();
    legacy_samples.sort();
    let context_p50 = context_samples[15];
    let context_p95 = context_samples[28];
    let legacy_p50 = legacy_samples[15];
    let legacy_p95 = legacy_samples[28];
    assert!(
        context_p50 * 10 <= legacy_p50 * 7,
        "p50 gate: context {context_p50:?}, legacy {legacy_p50:?}"
    );
    assert!(
        context_p95 * 10 <= legacy_p95 * 8,
        "p95 gate: context {context_p95:?}, legacy {legacy_p95:?}"
    );

    let diagnostics =
        repo.run_span(["--perf", "context", "file1.txt#L2-L3", "--format", "json"])?;
    assert!(diagnostics.status.success());
    let stderr = String::from_utf8(diagnostics.stderr)?;
    for counter in [
        "context.service-generation-hits",
        "context.service-corpus-loads",
        "context.service-resolver-passes",
        "context.service-invalidations",
        "context.service-watcher-overflows",
        "context.service-stale-fallbacks",
        "context.service-epoch-checks",
        "context.service-rows-decoded",
        "context.service-rpc-connect-us",
        "context.service-watcher-drain-us",
        "context.service-total-us",
    ] {
        assert!(
            stderr.contains(counter),
            "missing perf counter {counter}: {stderr}"
        );
    }
    Ok(())
}
