//! A running integration suite must exclude sibling cargo tasks from the
//! shared target root. Cargo serializes build against build, but a test that
//! has already started can spawn `git-span` while another worktree relinks it.

#[cfg(unix)]
mod unix {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command};
    use std::thread;
    use std::time::{Duration, Instant};

    fn package_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn wait_for(path: &Path, child: &mut Child, description: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !path.exists() {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {description}: {}",
                path.display()
            );
            assert!(
                child.try_wait().expect("poll child").is_none(),
                "child exited before {description}"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn integration_test_excludes_sibling_cargo_task_until_run_finishes() {
        let tmp = tempfile::tempdir().expect("private target-lock fixture");
        let target_root = tmp.path().join("target");
        let fake_bin = tmp.path().join("bin");
        let test_started = tmp.path().join("test-started");
        let release_test = tmp.path().join("release-test");
        let sibling_entered = tmp.path().join("sibling-entered");
        fs::create_dir_all(&fake_bin).expect("create fake bin directory");

        let fake_cargo = fake_bin.join("cargo");
        fs::write(
            &fake_cargo,
            "#!/usr/bin/env bash\nset -euo pipefail\ntouch \"$TEST_STARTED\"\nwhile [ ! -e \"$RELEASE_TEST\" ]; do sleep 0.02; done\n",
        )
        .expect("write fake cargo");
        let mut permissions = fs::metadata(&fake_cargo).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&fake_cargo, permissions).expect("make fake cargo executable");

        let inherited_path = std::env::var_os("PATH").expect("PATH must be set");
        let mut path = fake_bin.into_os_string();
        path.push(":");
        path.push(inherited_path);

        let mut test_run = Command::new("yarn")
            .arg("test")
            .current_dir(package_root())
            .env("PATH", path)
            .env("GIT_SPAN_CARGO_TARGET_ROOT", &target_root)
            .env("GIT_SPAN_FINGERPRINT_TRIPWIRE", "0")
            .env("TEST_STARTED", &test_started)
            .env("RELEASE_TEST", &release_test)
            .spawn()
            .expect("spawn package test command");
        wait_for(&test_started, &mut test_run, "fake cargo to start");

        let lock_script = package_root().join("scripts/with-target-lock.sh");
        let sibling_command = format!("touch '{}'", sibling_entered.display());
        let mut sibling = Command::new("bash")
            .arg(lock_script)
            .arg("shared")
            .arg("bash")
            .arg("-c")
            .arg(sibling_command)
            .env("GIT_SPAN_CARGO_TARGET_ROOT", &target_root)
            .env("GIT_SPAN_FINGERPRINT_TRIPWIRE", "0")
            .spawn()
            .expect("spawn sibling cargo-task surrogate");

        thread::sleep(Duration::from_millis(300));
        let sibling_overlapped_test = sibling_entered.exists();
        fs::write(&release_test, b"").expect("release fake cargo");

        assert!(test_run.wait().expect("wait for test command").success());
        assert!(sibling.wait().expect("wait for sibling task").success());
        assert!(
            !sibling_overlapped_test,
            "a sibling shared cargo task entered the target root while the integration suite was still running; a relink can therefore remove git-span between test spawns"
        );
    }
}
