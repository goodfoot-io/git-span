use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

const BIN: &str = env!("CARGO_BIN_EXE_git-mora");

struct Repo {
    root: PathBuf,
    dir: PathBuf,
}

impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn base(program: &str, dir: &Path) -> Command {
    let mut cmd = Command::new(program);
    let bin_dir = Path::new(BIN).parent().expect("binary directory");
    let mut paths = vec![bin_dir.to_path_buf()];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").expect("PATH")));
    cmd.current_dir(dir)
        .env("PATH", std::env::join_paths(paths).expect("valid PATH"))
        .env("GIT_CONFIG_GLOBAL", dir.join("no-such-global-config"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE");
    cmd
}

fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).trim_end().to_owned()
}

fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).trim_end().to_owned()
}

impl Repo {
    fn new() -> Repo {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "git-mora-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let dir = root.join("repo");
        fs::create_dir_all(&dir).expect("create repo dir");
        let repo = Repo { root, dir };
        repo.git(&["init", "-q", "-b", "main"]);
        repo.commit("initial");
        repo
    }

    fn git(&self, args: &[&str]) -> String {
        let o = base("git", &self.dir).args(args).output().expect("run git");
        assert!(o.status.success(), "git {args:?}: {}", err(&o));
        out(&o)
    }

    fn commit(&self, message: &str) -> String {
        self.git(&["commit", "-q", "--allow-empty", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    fn mora_in(&self, dir: &Path, args: &[&str]) -> Output {
        base(BIN, dir).args(args).output().expect("run git-mora")
    }

    fn mora(&self, args: &[&str]) -> Output {
        self.mora_in(&self.dir, args)
    }

    fn ok(&self, args: &[&str]) -> String {
        let o = self.mora(args);
        assert!(o.status.success(), "mora {args:?}: {}", err(&o));
        out(&o)
    }

    fn fails(&self, args: &[&str]) -> String {
        let o = self.mora(args);
        assert_eq!(o.status.code(), Some(1), "mora {args:?}: {o:?}");
        err(&o)
    }

    fn agent(&self) -> String {
        let name = self.ok(&["branch", "--agent-id", "alice"]);
        self.git(&["switch", "-q", &name]);
        name
    }

    fn install_hooks(&self) {
        let hooks = self.dir.join(".git/hooks");
        for (hook, line) in [
            ("post-commit", "exec git mora hook post-commit \"$@\""),
            ("post-rewrite", "exec git mora hook post-rewrite \"$@\""),
            ("post-merge", "exec git mora hook post-merge \"$@\""),
        ] {
            let path = hooks.join(hook);
            fs::write(&path, format!("#!/bin/sh\n{line}\n")).expect("write hook");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
            }
        }
    }
}

#[test]
fn git_dispatches_to_git_mora_outside_a_repository() {
    let dir = std::env::temp_dir();
    let output = base("git", &dir).args(["mora", "--version"]).output().expect("run git mora");
    assert!(output.status.success(), "{output:?}");
    assert_eq!(out(&output), format!("git-mora {}", env!("CARGO_PKG_VERSION")));
}

#[test]
fn rejects_missing_unknown_and_extra_arguments() {
    for args in [vec![], vec!["unknown"], vec!["hello-world"], vec!["tag", "pending", "extra"]] {
        let output = Command::new(BIN).args(&args).output().expect("run git-mora");
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
}

#[test]
fn reports_package_version() {
    let output = Command::new(BIN).arg("--version").output().expect("run");
    assert!(output.status.success());
    assert_eq!(
        output.stdout,
        format!("git-mora {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
    );
}

#[test]
fn branch_creates_without_switching_and_validates_target() {
    let repo = Repo::new();
    let name = repo.ok(&["branch", "--agent-id", "alice"]);
    let parts: Vec<&str> = name.split('/').collect();
    assert_eq!(&parts[..3], ["agent", "alice", "main"]);
    assert_eq!(parts[3].len(), 32);
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
    assert_eq!(repo.git(&["rev-parse", &name]), repo.git(&["rev-parse", "HEAD"]));

    let first = repo.commit("second");
    let second = repo.ok(&["branch", "--agent-id", "bob", "--target", "release", "HEAD~1"]);
    assert!(second.starts_with("agent/bob/release/"));
    assert_ne!(repo.git(&["rev-parse", &second]), first);

    repo.git(&["switch", "-q", "-c", "feature/x"]);
    assert!(repo.fails(&["branch", "--agent-id", "a"]).contains("--target"));
    repo.git(&["switch", "-q", "--detach", "HEAD"]);
    assert!(repo.fails(&["branch", "--agent-id", "a"]).contains("detached"));
    repo.fails(&["branch", "--agent-id", "a/b", "--target", "main"]);
    repo.fails(&["branch", "--agent-id", "a", "--target", "main", "no-such-rev"]);
}

#[test]
fn tag_transitions_follow_the_table() {
    let repo = Repo::new();
    let branch = repo.agent();
    let attempt = branch.rsplit('/').next().expect("attempt").to_owned();
    let tag = |s: &str| format!("{s}/main/{attempt}");

    repo.fails(&["tag", "merge"]);
    repo.fails(&["tag", "discard"]);

    fs::write(repo.dir.join("dirty"), "x").expect("write");
    assert!(repo.fails(&["tag", "pending"]).contains("clean"));
    fs::remove_file(repo.dir.join("dirty")).expect("rm");

    assert_eq!(repo.ok(&["tag", "pending"]), tag("pending"));
    assert_eq!(repo.ok(&["tag", "pending"]), tag("pending"));
    repo.fails_with_code(&["tag", "merge", "extra"], 2);

    assert_eq!(repo.ok(&["tag", "merge"]), tag("merge"));
    assert_eq!(repo.ok(&["tag", "merge"]), tag("merge"));
    assert_eq!(repo.git(&["tag", "-l"]), tag("merge"));
    repo.fails(&["tag", "pending"]);

    assert_eq!(repo.ok(&["tag", "discard"]), tag("discard"));
    assert_eq!(repo.ok(&["tag", "discard"]), tag("discard"));
    repo.fails(&["tag", "merge"]);
    repo.fails(&["tag", "pending"]);
    assert_eq!(repo.git(&["tag", "-l"]), tag("discard"));
}

#[test]
fn tag_refuses_moved_head_contradictions_and_annotated_tags() {
    let repo = Repo::new();
    let branch = repo.agent();
    let attempt = branch.rsplit('/').next().expect("attempt").to_owned();
    repo.ok(&["tag", "pending"]);
    repo.commit("more");
    assert!(repo.fails(&["tag", "merge"]).contains("new attempt"));

    repo.git(&["tag", &format!("discard/main/{attempt}"), "HEAD"]);
    assert!(repo.fails(&["tag", "merge"]).contains("contradictory"));
    repo.git(&["tag", "-d", &format!("discard/main/{attempt}")]);
    repo.git(&["tag", "-d", &format!("pending/main/{attempt}")]);

    repo.git(&["tag", "-a", "-m", "x", &format!("pending/main/{attempt}"), "HEAD"]);
    assert!(repo.fails(&["tag", "merge"]).contains("lightweight"));

    repo.git(&["switch", "-q", "main"]);
    assert!(repo.fails(&["tag", "pending"]).contains("agent"));
}

#[test]
fn tag_refuses_unfinished_operations() {
    let repo = Repo::new();
    repo.agent();
    let git_dir = repo.git(&["rev-parse", "--absolute-git-dir"]);
    fs::write(Path::new(&git_dir).join("MERGE_HEAD"), repo.git(&["rev-parse", "HEAD"])).expect("write");
    assert!(repo.fails(&["tag", "pending"]).contains("in progress"));
}

#[test]
fn list_filters_formats_and_associations() {
    let repo = Repo::new();
    let branch = repo.agent();
    let attempt = branch.rsplit('/').next().expect("attempt").to_owned();
    repo.ok(&["tag", "pending"]);
    repo.git(&["tag", "ordinary"]);
    repo.git(&["tag", "-a", "-m", "n", "annotated", "HEAD"]);

    let names = repo.ok(&["list", "--tag", "pending/*", "--names-only"]);
    assert_eq!(names, format!("pending/main/{attempt}"));
    let names = repo.ok(&["list", "--tag", "*", "--names-only"]);
    assert_eq!(names.lines().count(), 3);
    assert_eq!(repo.ok(&["list", "--branch", "agent/alice/*", "--names-only"]), branch);

    let json = repo.ok(&["list", "--tag", "pending/*", "--agent-id", "alice", "--json"]);
    assert!(json.contains("\"agent_id\":\"alice\""), "{json}");
    assert!(json.contains(&format!("\"agent_branch\":\"{branch}\"")), "{json}");
    assert!(!json.contains("\"event\""));
    assert!(json.contains("\"topics\":[]"));

    assert_eq!(repo.ok(&["list", "--tag", "*", "--agent-id", "nobody", "--names-only"]), "");
    let ordinary = repo.ok(&["list", "--tag", "ordinary", "--json"]);
    assert!(ordinary.contains("\"agent_id\":null") && ordinary.contains("\"target\":null"));
    let annotated = repo.ok(&["list", "--tag", "annotated", "--json"]);
    assert!(annotated.contains("\"commit\":\"") && !annotated.contains("\"commit\":null"));

    let table = repo.ok(&["list", "--tag", "pending/*"]);
    assert!(table.starts_with("KIND"));
    assert!(table.contains(&attempt));
    repo.fails_with_code(&["list", "--json", "--names-only"], 2);
}

impl Repo {
    fn fails_with_code(&self, args: &[&str], code: i32) {
        let o = self.mora(args);
        assert_eq!(o.status.code(), Some(code), "{o:?}");
    }
}

#[test]
fn topics_are_sorted_unions_with_filters() {
    let repo = Repo::new();
    let first = repo.git(&["rev-parse", "HEAD"]);
    let second = repo.commit("two");
    repo.ok(&["topic", "create", "418"]);
    repo.ok(&["topic", "create", "418"]);
    repo.ok(&["topic", "add", "418", "HEAD", "HEAD~1"]);
    repo.ok(&["topic", "add", "418", "HEAD"]);
    repo.ok(&["topic", "add", "alpha", "HEAD"]);
    assert_eq!(repo.ok(&["topic", "list"]), "418\nalpha");
    assert_eq!(repo.ok(&["topic", "of", "HEAD"]), "418\nalpha");
    assert_eq!(repo.ok(&["topic", "of", "HEAD~1"]), "418");
    let mut expected = [first.clone(), second.clone()];
    expected.sort();
    assert_eq!(repo.ok(&["topic", "show", "418", "--oids"]), expected.join("\n"));
    assert_eq!(repo.ok(&["topic", "show", "418", "--missing"]), "");
    assert!(repo.ok(&["topic", "show", "418"]).contains("two"));
    let blob = repo.git(&["cat-file", "blob", "refs/topics/418"]);
    assert_eq!(blob, expected.join("\n"));

    repo.fails(&["topic", "show", "nope"]);
    repo.fails(&["topic", "add", "bad/topic", "HEAD"]);
    repo.fails(&["topic", "add", "x", "HEAD", "missing-rev"]);
    assert!(repo.ok(&["topic", "list"]).lines().all(|t| t != "x"));

    let json = repo.ok(&["list", "--branch", "main", "--topic", "alpha", "--json"]);
    assert!(json.contains("\"topics\":[\"418\",\"alpha\"]"), "{json}");
    assert_eq!(repo.ok(&["list", "--branch", "main", "--topic", "zzz", "--names-only"]), "");
}

#[test]
fn topic_show_reports_missing_objects_and_corruption() {
    let repo = Repo::new();
    let ghost = "1".repeat(40);
    let blob = {
        let mut cmd = base("git", &repo.dir);
        cmd.args(["hash-object", "-w", "--stdin"]).stdin(Stdio::piped()).stdout(Stdio::piped());
        let mut child = cmd.spawn().expect("spawn");
        use std::io::Write;
        child.stdin.take().expect("stdin").write_all(format!("{ghost}\n").as_bytes()).expect("write");
        out(&child.wait_with_output().expect("wait"))
    };
    repo.git(&["update-ref", "refs/topics/ghost", &blob]);
    assert_eq!(repo.ok(&["topic", "show", "ghost", "--missing", "--oids"]), ghost);
    assert!(repo.ok(&["topic", "show", "ghost"]).contains("missing"));
    repo.ok(&["topic", "add", "ghost", "HEAD"]);
    assert!(repo.ok(&["topic", "show", "ghost", "--oids"]).contains(&ghost));

    repo.git(&["update-ref", "refs/topics/bad", "HEAD"]);
    repo.fails(&["topic", "show", "bad"]);
    repo.fails(&["list"]);
}

#[test]
fn context_requires_worktree_config_and_is_bound_to_the_branch() {
    let repo = Repo::new();
    assert!(repo.fails(&["topic", "context", "set", "418"]).contains("worktreeConfig"));
    assert_eq!(repo.ok(&["topic", "context", "show"]), "topics: (none)\nsource: none");

    repo.git(&["config", "extensions.worktreeConfig", "true"]);
    repo.git(&["config", "--worktree", "user.keep", "yes"]);
    repo.ok(&["topic", "context", "set", "customer-login", "418"]);
    assert_eq!(repo.git(&["config", "--worktree", "user.keep"]), "yes");
    let shown = repo.ok(&["topic", "context", "show"]);
    assert!(shown.contains("topics: 418 customer-login") && shown.contains("bound to main"), "{shown}");
    assert!(!base("git", &repo.dir).args(["config", "--local", "--get", "mora.topics"]).output().expect("git").status.success());

    repo.git(&["switch", "-q", "-c", "other"]);
    let shown = repo.ok(&["topic", "context", "show"]);
    assert!(shown.contains("topics: (none)") && shown.contains("ignored"), "{shown}");

    repo.git(&["switch", "-q", "main"]);
    repo.ok(&["topic", "context", "clear"]);
    assert!(repo.ok(&["topic", "context", "show"]).starts_with("topics: \n"));
    repo.git(&["switch", "-q", "--detach", "HEAD"]);
    repo.fails(&["topic", "context", "set", "x"]);
}

#[test]
fn exec_scopes_context_and_hooks_annotate_commits() {
    let repo = Repo::new();
    repo.install_hooks();
    repo.ok(&["topic", "exec", "--topic", "418", "--", "git", "commit", "-q", "--allow-empty", "-m", "a"]);
    assert_eq!(repo.ok(&["topic", "of", "HEAD"]), "418");

    repo.commit("untopiced");
    assert_eq!(repo.ok(&["topic", "of", "HEAD"]), "");

    let o = repo.mora(&["topic", "exec", "--no-topics", "--", "sh", "-c", "exit 7"]);
    assert_eq!(o.status.code(), Some(7));
    let shown = repo.ok(&["topic", "exec", "--topic", "a", "--topic", "b", "--", "git", "mora", "topic", "context", "show"]);
    assert!(shown.contains("topics: a b") && shown.contains("source: command"), "{shown}");
    repo.fails_with_code(&["topic", "exec", "--topic", "a", "--no-topics", "--", "true"], 2);
}

#[test]
fn rewrite_hook_preserves_originals_and_unions_squashes() {
    let repo = Repo::new();
    repo.install_hooks();
    repo.ok(&["topic", "exec", "--topic", "one", "--", "git", "commit", "-q", "--allow-empty", "-m", "a"]);
    let a = repo.git(&["rev-parse", "HEAD"]);
    repo.ok(&["topic", "exec", "--topic", "two", "--", "git", "commit", "-q", "--allow-empty", "-m", "b"]);
    let b = repo.git(&["rev-parse", "HEAD"]);

    repo.git(&["reset", "-q", "--soft", "HEAD~2"]);
    repo.git(&["commit", "-q", "--allow-empty", "-m", "squashed"]);
    let squashed = repo.git(&["rev-parse", "HEAD"]);
    // plain reset+commit is not a rewrite; amend is:
    repo.ok(&["topic", "exec", "--topic", "three", "--", "git", "commit", "-q", "--amend", "--allow-empty", "-m", "amended"]);
    let amended = repo.git(&["rev-parse", "HEAD"]);
    assert_ne!(squashed, amended);
    assert_eq!(repo.ok(&["topic", "of", &amended]), "three");
    assert_eq!(repo.ok(&["topic", "of", &squashed]), "");
    assert_eq!(repo.ok(&["topic", "of", &a]), "one");
    assert_eq!(repo.ok(&["topic", "of", &b]), "two");

    // many-to-one via post-rewrite input
    let mut child = base(BIN, &repo.dir)
        .args(["hook", "post-rewrite", "rebase"])
        .stdin(Stdio::piped())
        .spawn()
        .expect("spawn");
    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().expect("stdin");
        writeln!(stdin, "{a} {amended}").expect("write");
        writeln!(stdin, "{b} {amended}").expect("write");
    }
    assert!(child.wait().expect("wait").success());
    assert_eq!(repo.ok(&["topic", "of", &amended]), "one\nthree\ntwo");
}

#[test]
fn merge_hook_annotates_new_merges_but_not_fast_forwards() {
    let repo = Repo::new();
    repo.install_hooks();
    repo.git(&["switch", "-q", "-c", "side"]);
    repo.ok(&["topic", "exec", "--topic", "side-topic", "--", "git", "commit", "-q", "--allow-empty", "-m", "side"]);
    repo.git(&["switch", "-q", "main"]);
    repo.commit("main work");

    repo.ok(&["topic", "exec", "--topic", "ctx", "--", "git", "merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    let merge = repo.git(&["rev-parse", "HEAD"]);
    assert_eq!(repo.ok(&["topic", "of", &merge]), "ctx\nside-topic");

    // Fast-forward to an existing merge commit must not acquire context.
    repo.git(&["tag", "merged", "HEAD"]);
    repo.git(&["switch", "-q", "-c", "ff", "HEAD~1"]);
    repo.ok(&["topic", "add", "later", "HEAD"]);
    let o = {
        let mut cmd = base(BIN, &repo.dir);
        cmd.args(["topic", "exec", "--topic", "wrong", "--", "git", "merge", "-q", "--ff-only", "merged"]);
        cmd.output().expect("run")
    };
    assert!(o.status.success(), "{o:?}");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), merge);
    assert_eq!(repo.ok(&["topic", "of", &merge]), "ctx\nside-topic");
}

#[test]
fn wait_matches_absences_and_times_out() {
    let repo = Repo::new();
    repo.fails_with_code(&["wait"], 2);
    repo.git(&["tag", "pending/main/abc"]);
    let json = repo.ok(&["wait", "--tag", "pending/main/abc", "--timeout", "5s"]);
    assert!(json.contains("\"name\":\"pending/main/abc\"") && !json.contains("event"));
    repo.fails_with_code(&["wait", "--tag", "merge/*", "--timeout", "200ms"], 3);
    repo.fails_with_code(&["wait", "--tag", "pending/*", "--absent", "--timeout", "200ms"], 3);
    repo.git(&["tag", "-d", "pending/main/abc"]);
    assert_eq!(repo.ok(&["wait", "--tag", "pending/*", "--absent", "--timeout", "5s"]), "");
    repo.fails_with_code(&["wait", "--tag", "x", "--timeout", "0s"], 2);
}

#[test]
fn listen_reports_existing_then_created_and_ignores_moves() {
    let repo = Repo::new();
    repo.git(&["tag", "pending/main/old"]);
    let existing = repo.ok(&["listen", "--tag", "pending/*", "--existing", "--once"]);
    assert!(existing.contains("\"event\":\"existing\"") && existing.contains("pending/main/old"));

    let child = base(BIN, &repo.dir)
        .args(["listen", "--tag", "pending/*", "--once", "--poll-interval", "100ms"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    std::thread::sleep(std::time::Duration::from_millis(400));
    repo.commit("move target");
    repo.git(&["tag", "-f", "pending/main/old", "HEAD"]);
    repo.git(&["tag", "pending/main/new"]);
    let output = child.wait_with_output().expect("wait");
    let stdout = out(&output);
    assert!(output.status.success(), "{output:?}");
    assert!(stdout.contains("\"event\":\"created\"") && stdout.contains("pending/main/new"), "{stdout}");
    assert!(!stdout.contains("pending/main/old"));
}

#[test]
fn listen_callback_gets_json_on_stdin_and_failure_stops() {
    let repo = Repo::new();
    repo.git(&["tag", "t1"]);
    let sink = repo.root.join("sink");
    let script = format!("cat > '{}'", sink.display());
    repo.ok(&["listen", "--tag", "t*", "--existing", "--once", "--", "sh", "-c", &script]);
    let received = fs::read_to_string(&sink).expect("sink");
    assert!(received.contains("\"name\":\"t1\"") && received.ends_with('\n'));
    let o = repo.mora(&["listen", "--tag", "t*", "--existing", "--", "false"]);
    assert_eq!(o.status.code(), Some(1));
}
