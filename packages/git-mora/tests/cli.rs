use std::process::Command;

#[test]
fn git_dispatches_hello_world_outside_a_repository() {
    let binary = std::path::Path::new(env!("CARGO_BIN_EXE_git-mora"));
    let mut paths = vec![binary.parent().expect("binary directory").to_path_buf()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").expect("PATH"),
    ));
    let output = Command::new("git")
        .args(["mora", "hello-world"])
        .current_dir(std::env::temp_dir())
        .env("PATH", std::env::join_paths(paths).expect("valid PATH"))
        .output()
        .expect("run git mora");
    assert!(output.status.success(), "{output:?}");
    assert_eq!(output.stdout, b"Hello world\n");
    assert!(output.stderr.is_empty());
}

#[test]
fn rejects_missing_unknown_and_extra_arguments() {
    for args in [vec![], vec!["unknown"], vec!["hello-world", "extra"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_git-mora"))
            .args(args)
            .output()
            .expect("run git-mora");
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
}

#[test]
fn reports_package_version() {
    let output = Command::new(env!("CARGO_BIN_EXE_git-mora"))
        .arg("--version")
        .output()
        .expect("run git-mora --version");
    assert!(output.status.success());
    assert_eq!(
        output.stdout,
        format!("git-mora {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
    );
}
