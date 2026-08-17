//! Integration test: an ordinary add / re-add / rename / remove / delete
//! lifecycle on a hierarchical span leaves `.span/` containing only span
//! content and the three authority-managed control files.
//!
//! Per-span lock files (`.<name>.lock`, `.span-lock-<hash>`,
//! `.<leaf>.context.lock`) were deleted in favor of the single
//! repository-wide recovery-domain lock under `<git_dir>/span/` — no
//! mutating command creates a dotfile in `.span/` anymore besides the three
//! control files the span-root authority writes unconditionally.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Control files the span-root authority owns and writes unconditionally
/// (see `span::structural`). Every other dotfile in `.span/` is either a
/// legacy lock artifact or a stray temp file — neither should ever survive
/// an ordinary command sequence.
const ALLOWED_DOTFILES: &[&str] = &[".gitattributes", ".gitignore", ".hookignore"];

/// Recursively collect every file under `root` whose basename starts with
/// `.` and is not one of [`ALLOWED_DOTFILES`].
fn stray_dotfiles(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                stack.push(path);
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') && !ALLOWED_DOTFILES.contains(&name.as_ref()) {
                found.push(path);
            }
        }
    }
    Ok(found)
}

#[test]
fn span_root_stays_clean_across_add_rename_remove_delete() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Create a hierarchical span and commit it.
    let add = repo.run_span(["add", "team/member", "file1.txt"])?;
    assert!(
        add.status.success(),
        "add must succeed;\nstderr:\n{}",
        String::from_utf8_lossy(&add.stderr)
    );
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "add team/member span"])?;

    // Add again — the idempotent re-add path, on the same identity. This
    // writes back byte-identical content, so there is nothing new to
    // commit; the worktree file itself is what the next step renames.
    let readd = repo.run_span(["add", "team/member", "file1.txt"])?;
    assert!(
        readd.status.success(),
        "re-add must succeed;\nstderr:\n{}",
        String::from_utf8_lossy(&readd.stderr)
    );

    // Rename the span declaration file directly, the way an operator
    // restructuring `.span/` by hand would.
    repo.run_git(["mv", ".span/team/member", ".span/team/renamed"])?;
    repo.run_git(["commit", "-m", "rename team/member to team/renamed"])?;

    // Remove the anchor from the renamed span, then delete it outright.
    let remove = repo.run_span(["remove", "team/renamed", "file1.txt"])?;
    assert!(
        remove.status.success(),
        "remove must succeed;\nstderr:\n{}",
        String::from_utf8_lossy(&remove.stderr)
    );
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "remove team/renamed anchor"])?;

    let delete = repo.run_span(["delete", "team/renamed"])?;
    assert!(
        delete.status.success(),
        "delete must succeed;\nstderr:\n{}",
        String::from_utf8_lossy(&delete.stderr)
    );

    let span_root = repo.path().join(".span");
    let stray = stray_dotfiles(&span_root)?;
    assert!(
        stray.is_empty(),
        "`.span/` must contain no dotfile besides {ALLOWED_DOTFILES:?} after \
         an add/re-add/rename/remove/delete lifecycle; found: {stray:?}"
    );

    Ok(())
}
