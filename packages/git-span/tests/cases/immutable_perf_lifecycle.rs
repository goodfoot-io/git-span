//! Composed CLI checks for the immutable observation counter lifecycle.
use crate::support::TestRepo;
use anyhow::Result;
use std::process::Output;

fn fixture() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    std::fs::copy(
        env!("CARGO_BIN_EXE_git-span"),
        repo.path().join(".git/immutable-perf-cli"),
    )?;
    repo.write_file("source.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("source")?;
    assert!(
        run(&repo, ["add", "sample", "source.txt#L1-L2"])?
            .status
            .success()
    );
    repo.commit_all("declaration")?;
    Ok(repo)
}

fn run(repo: &TestRepo, args: impl IntoIterator<Item = &'static str>) -> Result<Output> {
    run_cache(repo, args, "1")
}

fn run_cache(
    repo: &TestRepo,
    args: impl IntoIterator<Item = &'static str>,
    cache: &str,
) -> Result<Output> {
    let mut cmd = std::process::Command::new(repo.path().join(".git/immutable-perf-cli"));
    crate::support::strip_inherited_span_env(&mut cmd);
    Ok(cmd
        .current_dir(repo.path())
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_SPAN_CACHE", cache)
        .args(args)
        .output()?)
}

fn counters(out: &Output, runs: usize) -> Vec<[u64; 6]> {
    let stderr = String::from_utf8_lossy(&out.stderr);
    let labels = [
        "declaration-hits",
        "tree-map-hits",
        "blob-digest-hits",
        "misses",
        "rejections",
        "reused-source-bytes",
    ];
    let values: Vec<Vec<u64>> = labels
        .iter()
        .map(|label| {
            let prefix = format!("git-span perf: immutable.{label} ");
            stderr
                .lines()
                .filter_map(|line| line.strip_prefix(&prefix))
                .map(|value| value.parse().unwrap())
                .collect()
        })
        .collect();
    for (label, values) in labels.iter().zip(&values) {
        assert_eq!(
            values.len(),
            runs,
            "expected {runs} emissions for {label}: {stderr}"
        );
    }
    (0..runs)
        .map(|run| std::array::from_fn(|label| values[label][run]))
        .collect()
}

#[test]
fn immutable_perf_clean_cold_and_warm_cli_emits_each_counter_once() -> Result<()> {
    let repo = fixture()?;
    let cold = run(&repo, ["--perf", "drift"])?;
    assert_eq!(cold.status.code(), Some(0));
    assert!(counters(&cold, 1)[0][3] > 0);
    let warm = run(&repo, ["--perf", "drift"])?;
    assert_eq!(warm.status.code(), Some(0));
    assert!(counters(&warm, 1)[0][0] > 0);
    assert_eq!(cold.stdout, warm.stdout);
    let disabled = run_cache(&repo, ["--perf", "drift"], "0")?;
    assert_eq!(disabled.status.code(), Some(0));
    assert_eq!(cold.stdout, disabled.stdout);
    assert_eq!(counters(&disabled, 1)[0], [0; 6]);
    counters(&run(&repo, ["drift"])?, 0);
    Ok(())
}

#[test]
fn immutable_perf_missing_declaration_fallback_keeps_capture_counters() -> Result<()> {
    let repo = fixture()?;
    assert!(run(&repo, ["drift"])?.status.success());
    let oid = repo.git_stdout(["rev-parse", "HEAD:.span/sample"])?;
    std::fs::remove_file(
        repo.path()
            .join(".git/objects")
            .join(&oid[..2])
            .join(&oid[2..]),
    )?;
    let out = run(&repo, ["--perf", "drift"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("capture-token: git: find current object"),
        "expected typed capture bypass: {stderr}"
    );
    assert_eq!(out.status.code(), Some(0));
    let disabled = run_cache(&repo, ["--perf", "drift"], "0")?;
    assert_eq!(out.stdout, disabled.stdout);
    assert_eq!(out.status.code(), disabled.status.code());
    assert_eq!(counters(&disabled, 1)[0], [0; 6]);
    let values = counters(&out, 1)[0];
    assert!(
        values[3] > 0 && values[4] > 0,
        "capture evidence erased: {values:?}: {stderr}"
    );
    Ok(())
}

#[test]
fn immutable_perf_dirty_staged_and_disabled_cli_preserve_exits() -> Result<()> {
    let repo = fixture()?;
    assert!(run(&repo, ["drift"])?.status.success());
    for staged in [false, true] {
        repo.write_file("source.txt", "changed\nbeta\ngamma\n")?;
        if staged {
            repo.run_git(["add", "source.txt"])?;
        }
        let out = run(&repo, ["--perf", "drift"])?;
        assert_eq!(out.status.code(), Some(1));
        assert!(counters(&out, 1)[0][0] > 0);
        let warm = run(&repo, ["--perf", "drift"])?;
        assert_eq!(warm.status.code(), Some(1));
        assert_eq!(out.stdout, warm.stdout);
        assert!(counters(&warm, 1)[0][0] > 0);
        let disabled = run_cache(&repo, ["--perf", "drift"], "0")?;
        assert_eq!(disabled.status.code(), Some(1));
        assert_eq!(out.stdout, disabled.stdout);
        assert_eq!(counters(&disabled, 1)[0], [0; 6]);
    }
    Ok(())
}

#[test]
fn immutable_perf_incremental_cli_emits_and_preserves_clean_report() -> Result<()> {
    let repo = fixture()?;
    assert!(run(&repo, ["drift"])?.status.success());
    repo.write_file("unrelated.txt", "unrelated\n")?;
    repo.commit_all("unrelated head change")?;
    let out = run(&repo, ["--perf", "drift"])?;
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&out.stderr).contains("cache-path.hit-class: incremental"));
    assert!(counters(&out, 1)[0][0] > 0);
    let disabled = run_cache(&repo, ["--perf", "drift"], "0")?;
    assert_eq!(out.stdout, disabled.stdout);
    assert_eq!(counters(&disabled, 1)[0], [0; 6]);
    Ok(())
}

#[test]
fn immutable_perf_corrupt_memo_cli_recovers_clean_with_rejections() -> Result<()> {
    let repo = fixture()?;
    assert!(run(&repo, ["drift"])?.status.success());
    let db = rusqlite::Connection::open(repo.path().join(".git/span/immutable.db"))?;
    assert!(db.execute("UPDATE memo SET digest=zeroblob(32)", [])? > 0);
    drop(db);
    let out = run(&repo, ["--perf", "drift"])?;
    assert_eq!(out.status.code(), Some(0));
    let values = counters(&out, 1)[0];
    assert!(values[3] > 0 && values[4] > 0);
    let disabled = run_cache(&repo, ["--perf", "drift"], "0")?;
    assert_eq!(out.stdout, disabled.stdout);
    assert_eq!(counters(&disabled, 1)[0], [0; 6]);
    Ok(())
}

#[test]
fn immutable_perf_fix_cli_emits_separate_passes_and_trace_cli_emits_once() -> Result<()> {
    for named in [false, true] {
        let repo = fixture()?;
        repo.run_git(["mv", "source.txt", "moved.txt"])?;
        repo.commit_all("rename source")?;
        let args = if named {
            vec!["--perf", "drift", "sample", "--fix"]
        } else {
            vec!["--perf", "drift", "--fix"]
        };
        let out = run(&repo, args)?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let values = counters(&out, 2);
        assert_eq!(
            values[1], [0; 6],
            "post-fix pass must reset pre-fix counters"
        );
    }
    let repo = fixture()?;
    assert!(run(&repo, ["drift"])?.status.success());
    let traced = run(&repo, ["--perf", "drift", "--perf-trace", "trace.csv"])?;
    assert_eq!(traced.status.code(), Some(0));
    assert_eq!(counters(&traced, 1)[0], [0; 6]);
    assert!(
        std::fs::read_to_string(repo.path().join("trace.csv"))?
            .lines()
            .count()
            > 1
    );
    Ok(())
}
