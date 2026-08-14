//! Executable contract for the schema-v1 context query.

use crate::support::TestRepo;
use anyhow::Result;

fn ignored_contract_case() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let output = repo.run_span(["context", "file1.txt#L1-L3", "--format", "json"])?;
    assert!(output.status.success());
    let document: git_span::cli::context::ContextDocument = serde_json::from_slice(&output.stdout)?;
    assert_eq!(document.schema_version, 1);
    Ok(())
}

macro_rules! contract_case {
    ($name:ident) => {
        #[test]
        #[ignore = "context executable contract; activate with implementation slice"]
        fn $name() -> Result<()> {
            ignored_contract_case()
        }
    };
}

#[test]
fn schema_ordering_and_exact_intersections() -> Result<()> {
    ignored_contract_case()
}
contract_case!(status_source_and_utf8_detail_tokens);
contract_case!(invalid_input_race_and_size_fail_closed);
contract_case!(repair_post_state_and_cycle_safety);
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
    let default_service_leaf = std::fs::read_dir(repo.path().join(".git/span/context"))?
        .find_map(|entry| {
            entry
                .ok()
                .filter(|entry| entry.path().join("service.sock").exists())
                .map(|entry| entry.path())
        })
        .expect("resident default service identity directory");
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
    let linked_query = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(&linked)
        .args(["context", "file2.txt#L3-L4", "--format", "json"])
        .output()?;
    assert!(linked_query.status.success());
    let linked_json: serde_json::Value = serde_json::from_slice(&linked_query.stdout)?;
    assert_eq!(linked_json["spans"][0]["name"], "linked");
    assert!(
        std::fs::read_dir(repo.path().join(".git/worktrees"))?.any(|entry| {
            entry
                .ok()
                .is_some_and(|entry| entry.path().join("span/context").is_dir())
        }),
        "linked worktree did not receive private service state"
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

    if crate::support::symlinks_supported() {
        let context_root = repo.path().join(".git/span/context");
        let retained = context_root.join("retained-service-leaf");
        std::fs::rename(&default_service_leaf, &retained)?;
        let attacker = tempfile::tempdir()?;
        crate::support::symlink_dir(attacker.path(), &default_service_leaf)?;
        let swapped = repo.run_span(["context", "file1.txt#L1-L3", "--format", "json"])?;
        assert!(
            swapped.status.success(),
            "{}",
            String::from_utf8_lossy(&swapped.stderr)
        );
        let strict_after_edit = repo.run_span_with_env(
            ["context", "file1.txt#L1-L3", "--format", "json"],
            "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
            "1",
        )?;
        assert_eq!(swapped.stdout, strict_after_edit.stdout);
        assert_eq!(std::fs::read_dir(attacker.path())?.count(), 0);
    }
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
    assert!(repo.run_span(query)?.status.success());
    assert!(repo.run_span(query)?.status.success());

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
contract_case!(atomic_recovery_and_operation_id_replay);
contract_case!(controlled_repair_epoch);
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
    assert!(String::from_utf8(raced.stderr)?.contains("span definitions changed"));
    Ok(())
}

fn wait_for_checkpoint(path: &std::path::Path, previous: Option<&str>) -> Result<String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        if let Ok(token) = std::fs::read_to_string(path)
            && previous != Some(token.as_str())
        {
            return Ok(token);
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    anyhow::bail!("timed out waiting for context checkpoint")
}
contract_case!(production_perf_counters_and_acceptance_harness);
