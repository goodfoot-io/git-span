//! CLI: add, rm, message, commit, config.

mod support;

use anyhow::Result;
use support::TestRepo;

/// Read the content of a mesh file from the worktree `.mesh/` directory.
///
/// Returns empty string if the file does not exist.
fn mesh_file_content(repo: &TestRepo, mesh: &str) -> String {
    let path = repo.path().join(".mesh").join(mesh);
    if path.exists() {
        std::fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    }
}

/// Concatenate every file in `.git/mesh/staging/` (ops, sidecars, msg)
/// for assertion purposes — replaces the deleted `git mesh status`
/// view used by these tests to check what was staged.
#[allow(dead_code)]
fn staging_dump(repo: &TestRepo, mesh: &str) -> String {
    let dir = repo.path().join(".git").join("mesh").join("staging");
    let mut out = String::new();
    if !dir.exists() {
        return out;
    }
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .map(|i| i.flatten().collect())
        .unwrap_or_default();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let fname = entry.file_name().to_string_lossy().into_owned();
        // Match `<mesh>` ops file, `<mesh>.<N>` sidecars, `<mesh>.why`,
        // and the metadata sidecars `<mesh>.<N>.meta`.
        if (fname == mesh || fname.starts_with(&format!("{mesh}.")))
            && let Ok(s) = std::fs::read_to_string(entry.path())
        {
            out.push_str(&s);
            out.push('\n');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// add tests (file-backed)
// ---------------------------------------------------------------------------

#[test]
fn cli_add_writes_mesh_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("file1.txt"), "content={content}");
    assert!(content.contains("sha256:"), "content={content}");
    // The content should include a line anchor address.
    assert!(
        content.contains("#L1-L5") || content.contains("L1-L5"),
        "content={content}"
    );
    Ok(())
}

#[test]
fn cli_add_accepts_at_anchor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let head = repo.head_sha()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "--at", &head])?;
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("file1.txt"), "content={content}");
    assert!(content.contains("sha256:"), "content={content}");
    Ok(())
}

#[test]
fn cli_add_rejects_bad_address() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "oops-no-fragment"])?;
    assert!(!out.status.success());
    // No mesh file should have been created.
    let content = mesh_file_content(&repo, "m");
    assert!(content.is_empty(), "content={content}");
    Ok(())
}

#[test]
fn cli_add_rejects_missing_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "no/such.txt#L1-L2"])?;
    assert!(!out.status.success());
    Ok(())
}

#[test]
fn cli_add_rejects_end_past_eof() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "file1.txt#L1-L99"])?;
    assert!(!out.status.success());
    Ok(())
}

#[test]
fn cli_add_is_atomic_when_any_range_is_invalid() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "file1.txt#L1-L5", "file2.txt#L99-L100"])?;
    assert!(!out.status.success());
    let content = mesh_file_content(&repo, "m");
    assert!(!content.contains("file1.txt"), "content={content}");
    Ok(())
}

#[test]
fn cli_add_is_atomic_when_any_path_is_missing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "file1.txt#L1-L5", "no/such.txt#L1-L2"])?;
    assert!(!out.status.success());
    let content = mesh_file_content(&repo, "m");
    assert!(!content.contains("file1.txt"), "content={content}");
    Ok(())
}

#[test]
fn cli_add_coalesces_duplicate_ranges_within_args() -> Result<()> {
    // Slice 3: silent coalesce — last occurrence wins, exit 0.
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["add", "m", "file1.txt#L1-L2", "file1.txt#L1-L2"])?;
    assert!(
        out.status.success(),
        "expected success; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let content = mesh_file_content(&repo, "m");
    let occurrences = content.matches("file1.txt#L1-L2").count();
    assert_eq!(occurrences, 1, "expected one anchor line; content={content}");
    Ok(())
}

#[test]
fn cli_add_accepts_paths_with_spaces_alongside_other_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.commit_file(
        "dir with spaces/file 3.txt",
        "line1\nline2\nline3\n",
        "add spaced file",
    )?;
    repo.mesh_stdout([
        "add",
        "spaced",
        "dir with spaces/file 3.txt#L1-L2",
        "file1.txt#L1-L3",
    ])?;
    let content = mesh_file_content(&repo, "spaced");
    assert!(
        content.contains("dir with spaces/file 3.txt#L1-L2"),
        "content={content}"
    );
    assert!(content.contains("file1.txt#L1-L3"), "content={content}");
    Ok(())
}

// ---------------------------------------------------------------------------
// remove tests (file-backed)
// ---------------------------------------------------------------------------

#[test]
fn cli_rm_removes_from_mesh_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    let content_before = mesh_file_content(&repo, "m");
    assert!(
        content_before.contains("file1.txt"),
        "before={content_before}"
    );

    repo.mesh_stdout(["remove", "m", "file1.txt#L1-L5"])?;
    let content_after = mesh_file_content(&repo, "m");
    assert!(
        !content_after.contains("file1.txt#L1-L5"),
        "after={content_after}"
    );
    Ok(())
}

#[test]
fn cli_rm_of_range_not_in_mesh_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // First add and verify a mesh file exists.
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    let out = repo.run_mesh(["remove", "m", "file1.txt#L7-L9"])?;
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("is not an anchor on"), "stderr={stderr}");
    Ok(())
}

// ---------------------------------------------------------------------------
// why tests (file-backed)
// ---------------------------------------------------------------------------

#[test]
fn cli_message_inline() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["why", "m", "-m", "Hello"])?;
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("Hello"), "content={content}");
    Ok(())
}

#[test]
fn cli_message_from_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("msg.txt", "Subject\n\nBody\n")?;
    repo.mesh_stdout(["why", "m", "-F", "msg.txt"])?;
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("Subject"), "content={content}");
    assert!(content.contains("Body"), "content={content}");
    Ok(())
}

#[test]
fn cli_why_reader_prints_current_text() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["why", "m", "-m", "my mesh description"])?;
    let out = repo.mesh_stdout(["why", "m"])?;
    assert!(out.contains("my mesh description"), "stdout={out}");
    Ok(())
}

#[test]
fn cli_why_reader_no_why_recorded() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Write a mesh file with no why.
    std::fs::create_dir_all(repo.path().join(".mesh"))?;
    std::fs::write(repo.path().join(".mesh").join("m"), "file1.txt sha256:abc\n")?;
    let out = repo.mesh_stdout(["why", "m"])?;
    assert!(
        out.contains("has no why recorded"),
        "stdout={out}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// commit tests (ref-backed, may fail in Phase 3)
// ---------------------------------------------------------------------------

#[test]
fn cli_commit_accepts_paths_with_spaces() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.commit_file(
        "dir with spaces/file 3.txt",
        "line1\nline2\nline3\n",
        "add spaced file",
    )?;
    repo.mesh_stdout(["add", "spaced", "dir with spaces/file 3.txt#L1-L2"])?;
    repo.mesh_stdout(["why", "spaced", "-m", "Initial"])?;
    repo.mesh_stdout(["commit", "spaced"])?;
    let out = repo.mesh_stdout(["show", "spaced", "--oneline"])?;
    assert!(
        out.contains("dir with spaces/file 3.txt#L1-L2"),
        "show={out}"
    );
    Ok(())
}

#[test]
fn cli_commit_writes_ref() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "Initial"])?;
    repo.mesh_stdout(["commit", "m"])?;
    assert!(git_mesh::list_mesh_names(&repo.gix_repo()?)?.contains(&"m".to_string()));
    Ok(())
}

#[test]
fn cli_commit_empty_is_error() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["commit", "empty"])?;
    assert!(!out.status.success());
    Ok(())
}

#[test]
fn cli_commit_reserved_name_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // `stale` is on the reserved list — clap may treat it as a subcommand.
    let out = repo.run_mesh(["add", "stale", "file1.txt#L1-L5"])?;
    assert!(!out.status.success());
    Ok(())
}

// ---------------------------------------------------------------------------
// config tests (ref-backed, may fail in Phase 3)
// ---------------------------------------------------------------------------

#[test]
fn cli_config_read_lists_defaults() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    assert!(out.contains("copy-detection"));
    assert!(out.contains("ignore-whitespace"));
    Ok(())
}

#[test]
fn cli_config_stage_override_shows_starred_line() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    repo.mesh_stdout(["config", "m", "copy-detection", "off"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    assert!(out.contains("staged change to `off`"));
    Ok(())
}

#[test]
fn cli_config_unknown_key_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.run_mesh(["config", "m", "no-such-key"])?;
    assert!(!out.status.success());
    Ok(())
}

#[test]
fn cli_config_unset_stages_default() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    // Stage a non-default, then --unset resets to default.
    repo.mesh_stdout(["config", "m", "ignore-whitespace", "true"])?;
    repo.mesh_stdout(["config", "m", "--unset", "ignore-whitespace"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    // Final resolved staged value is `false` (default); the committed
    // value is also `false`, so the displayed line is the un-starred
    // default.
    assert!(out.contains("`ignore-whitespace` is `false`."));
    Ok(())
}

// ---------------------------------------------------------------------------
// follow-moves config key tests (ref-backed, may fail in Phase 3)
// ---------------------------------------------------------------------------

#[test]
fn cli_config_read_lists_follow_moves() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    assert!(out.contains("follow-moves"), "stdout={out}");
    Ok(())
}

#[test]
fn cli_config_follow_moves_read_single_key() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.mesh_stdout(["config", "m", "follow-moves"])?;
    assert!(out.contains("`follow-moves` is `false` on `m`."), "stdout={out}");
    Ok(())
}

#[test]
fn cli_config_follow_moves_set_and_stage() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    repo.mesh_stdout(["config", "m", "follow-moves", "true"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    assert!(out.contains("staged change to `true`"), "stdout={out}");
    Ok(())
}

#[test]
fn cli_config_follow_moves_invalid_value_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.run_mesh(["config", "m", "follow-moves", "yes"])?;
    assert!(!out.status.success(), "invalid value must error");
    Ok(())
}

#[test]
fn cli_config_follow_moves_unset_stages_default() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    repo.mesh_stdout(["config", "m", "follow-moves", "true"])?;
    repo.mesh_stdout(["config", "m", "--unset", "follow-moves"])?;
    let out = repo.mesh_stdout(["config", "m"])?;
    // Final resolved value is `false` (default); no star.
    assert!(out.contains("`follow-moves` is `false`."), "stdout={out}");
    Ok(())
}

#[test]
fn cli_config_unset_unknown_key_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.mesh_stdout(["commit", "m"])?;
    let out = repo.run_mesh(["config", "m", "--unset", "nope"])?;
    assert!(!out.status.success());
    Ok(())
}

// ---------------------------------------------------------------------------
// Editor-based why tests (file-backed)
// ---------------------------------------------------------------------------

/// Build a POSIX-shell editor script that replaces the EDITMSG file
/// with `content`. Returns the path to the script.
fn make_editor_script(repo: &TestRepo, content: &str) -> Result<std::path::PathBuf> {
    let p = repo.path().join("fake-editor.sh");
    let body = format!("#!/bin/sh\ncat >\"$1\" <<'__MESH_EOF__'\n{content}\n__MESH_EOF__\n");
    std::fs::write(&p, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&p)?.permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&p, perm)?;
    }
    Ok(p)
}

fn run_mesh_with_editor(
    repo: &TestRepo,
    editor: &std::path::Path,
    args: &[&str],
) -> Result<std::process::Output> {
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
    cmd.current_dir(repo.path());
    cmd.env("EDITOR", editor);
    cmd.env_remove("VISUAL");
    cmd.env_remove("GIT_EDITOR");
    for a in args {
        cmd.arg(a);
    }
    Ok(cmd.output()?)
}

#[test]
fn cli_message_edit_blank_template_new_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let editor = make_editor_script(&repo, "Hello from editor")?;
    let out = run_mesh_with_editor(&repo, &editor, &["why", "m", "--edit"])?;
    assert!(
        out.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("Hello from editor"), "content={content}");
    Ok(())
}

#[test]
fn cli_message_edit_prepopulated_from_existing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["why", "m", "-m", "Pre-existing text"])?;
    // Editor appends a suffix to whatever the template was.
    let editor_path = repo.path().join("fake-editor.sh");
    let body = "#!/bin/sh\nprintf '%s\\n-edited' \"$(cat \"$1\")\" >\"$1\"\n";
    std::fs::write(&editor_path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&editor_path)?.permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&editor_path, perm)?;
    }
    let out = run_mesh_with_editor(&repo, &editor_path, &["why", "m", "--edit"])?;
    assert!(out.status.success());
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("Pre-existing text"), "content={content}");
    assert!(content.contains("-edited"), "content={content}");
    Ok(())
}

#[test]
fn cli_message_edit_inherits_from_parent_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "Parent commit message"])?;
    // Write a mesh file with the why directly (since commit is now dead code).
    // The editor test should see whatever `.mesh/m` contains as the template.
    let content_after = mesh_file_content(&repo, "m");
    assert!(content_after.contains("Parent commit message"));

    // No staged .why exists; editor should see the existing mesh file's why.
    let editor_path = repo.path().join("fake-editor.sh");
    let body = "#!/bin/sh\ncp \"$1\" \"$1.seen\"\ncat >\"$1\" <<'__EOF__'\nNew body\n__EOF__\n";
    std::fs::write(&editor_path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&editor_path)?.permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&editor_path, perm)?;
    }
    let out = run_mesh_with_editor(&repo, &editor_path, &["why", "m", "--edit"])?;
    assert!(out.status.success());
    // Collect the snapshot of what the editor saw.
    let seen_path = repo
        .path()
        .join(".mesh")
        .join("m.EDITMSG.seen");
    let seen = std::fs::read_to_string(&seen_path)?;
    assert!(
        seen.contains("Parent commit message"),
        "editor template was: {seen}"
    );
    Ok(())
}

#[test]
fn cli_message_edit_empty_buffer_aborts() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Editor produces only comment lines — stripped => empty => abort.
    let editor = make_editor_script(&repo, "# only a comment\n# another")?;
    let out = run_mesh_with_editor(&repo, &editor, &["why", "m", "--edit"])?;
    assert!(!out.status.success(), "abort should fail");
    let content = mesh_file_content(&repo, "m");
    assert!(!content.contains("# only a comment"), "content={content}");
    Ok(())
}

#[test]
fn cli_why_edit_flag_triggers_editor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let editor = make_editor_script(&repo, "edit flow worked")?;
    let out = run_mesh_with_editor(&repo, &editor, &["why", "m", "--edit"])?;
    assert!(
        out.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let content = mesh_file_content(&repo, "m");
    assert!(content.contains("edit flow worked"), "content={content}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Staging-based tests (may fail in Phase 3 — dead code)
// ---------------------------------------------------------------------------

#[test]
fn cli_rm_of_staged_add_succeeds() -> Result<()> {
    // Removing a anchor that was directly added to the mesh file should work.
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    let out = repo.run_mesh(["remove", "m", "file1.txt#L1-L5"])?;
    assert!(
        out.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let content = mesh_file_content(&repo, "m");
    assert!(!content.contains("file1.txt#L1-L5"), "content={content}");
    Ok(())
}

#[test]
fn cli_commit_no_name_commits_all_staged() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "a", "file1.txt#L1-L2"])?;
    repo.mesh_stdout(["why", "a", "-m", "mesh a"])?;
    repo.mesh_stdout(["add", "b", "file2.txt#L1-L2"])?;
    repo.mesh_stdout(["why", "b", "-m", "mesh b"])?;
    let stdout = repo.mesh_stdout(["commit"])?;
    assert!(
        stdout.contains("Committed 2 of 2 staged meshes."),
        "stdout={stdout}"
    );
    assert!(stdout.contains("`a`"), "stdout={stdout}");
    assert!(stdout.contains("`b`"), "stdout={stdout}");
    let names = git_mesh::list_mesh_names(&repo.gix_repo()?)?;
    assert!(names.contains(&"a".to_string()));
    assert!(names.contains(&"b".to_string()));
    Ok(())
}

#[test]
fn cli_commit_no_name_picks_up_why_only_staging() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L2"])?;
    repo.mesh_stdout(["why", "m", "-m", "v1 why"])?;
    repo.mesh_stdout(["commit", "m"])?;
    // Stage only a new why on the already-committed mesh.
    repo.mesh_stdout(["why", "m", "-m", "v2 why"])?;
    let stdout = repo.mesh_stdout(["commit"])?;
    assert!(
        stdout.contains("Committed 1 of 1 staged meshes."),
        "expected commit success; stdout={stdout}"
    );
    assert!(
        stdout.contains("`m`"),
        "expected mesh m in output; stdout={stdout}"
    );
    let current = repo.mesh_stdout(["why", "m"])?;
    assert!(current.contains("v2 why"), "current={current}");
    Ok(())
}

#[test]
fn cli_commit_no_name_nothing_staged_exits_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["commit"])?;
    assert!(
        out.status.success(),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("Nothing is staged."), "stdout={stdout}");
    Ok(())
}

#[test]
fn cli_why_reader_prints_current_and_historical_text() -> Result<()> {
    // In Phase 3, the file-backed reader shows the effective (worktree) why.
    // Historical reads via --at are supported from tree entries.
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["why", "h", "-m", "v1 why"])?;
    repo.mesh_stdout(["add", "h", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["commit", "h"])?;
    repo.mesh_stdout(["why", "h", "-m", "v2 why"])?;
    repo.mesh_stdout(["commit", "h"])?;

    // Current should show v2 why from the file-backed reader.
    let current = repo.mesh_stdout(["why", "h"])?;
    assert!(current.contains("v2 why"), "current={current}");
    Ok(())
}

#[test]
fn cli_commit_first_mesh_without_why_errors_with_guidance() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "fresh", "file1.txt#L1-L5"])?;
    let out = repo.run_mesh(["commit", "fresh"])?;
    assert!(!out.status.success(), "expected non-zero exit");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("git mesh why fresh -m"),
        "expected guidance pointing at writer form; stderr={stderr}"
    );
    Ok(())
}
