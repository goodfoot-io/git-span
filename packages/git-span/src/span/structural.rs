//! Structural span operations — file-backed (§6.8).
//!
//! `delete` and `rename` operate by removing or moving the span file in
//! the worktree span root. There is no catalog, no staging, and no ref
//! transaction — the change is an ordinary worktree edit committed with
//! `git`.

use crate::span_file_reader::SpanFileReader;
use crate::validation::validate_span_name;
use crate::{Error, Result};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::{ensure_span_dir, SPAN_GITIGNORE_CONTENTS};

    /// `ensure_span_dir` must create `.span/.gitattributes` with exact
    /// canonical content and must be idempotent.
    #[test]
    fn ensure_span_dir_writes_canonical_gitattributes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let span_root = ".span";

        // First call: directory and file must be created.
        ensure_span_dir(workdir, span_root).expect("first call");

        let ga_path = workdir.join(span_root).join(".gitattributes");
        assert!(ga_path.exists(), ".span/.gitattributes must exist after first call");

        let content = std::fs::read_to_string(&ga_path).expect("read .gitattributes");
        assert_eq!(
            content, "* text eol=lf\n",
            ".span/.gitattributes content must be exactly `* text eol=lf\\n`"
        );

        // Second call: idempotent — no error, content unchanged.
        ensure_span_dir(workdir, span_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&ga_path).expect("read .gitattributes again");
        assert_eq!(
            content2, "* text eol=lf\n",
            "content must be unchanged after idempotent second call"
        );
    }

    /// `ensure_span_dir` must create `.span/.gitignore` with exact canonical
    /// content and must be idempotent.
    #[test]
    fn ensure_span_dir_writes_canonical_gitignore() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let span_root = ".span";

        ensure_span_dir(workdir, span_root).expect("first call");

        let gi_path = workdir.join(span_root).join(".gitignore");
        assert!(gi_path.exists(), ".span/.gitignore must exist after first call");

        let content = std::fs::read_to_string(&gi_path).expect("read .gitignore");
        assert_eq!(
            content, SPAN_GITIGNORE_CONTENTS,
            ".span/.gitignore content must match the canonical form"
        );

        ensure_span_dir(workdir, span_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&gi_path).expect("read .gitignore again");
        assert_eq!(
            content2, SPAN_GITIGNORE_CONTENTS,
            "content must be unchanged after idempotent second call"
        );
    }
}

const DEFAULT_SPAN_ROOT: &str = ".span";

/// Canonical contents of `.span/.gitignore` -- ignores the dispatcher's
/// generated log files and manual-run dispatch scripts (see
/// `packages/agent-hooks/src/dispatcher.ts`), none of which are meant to be
/// committed alongside the spans they live next to.
const SPAN_GITIGNORE_CONTENTS: &str = "*.log\nmanual-hook-dispatch-*.sh\n";

/// Ensure the span root directory exists and contains a `.gitattributes`
/// that pins LF for all span files, and a `.gitignore` that excludes the
/// dispatcher's generated artifacts. Idempotent: each file is (re)written
/// only when missing or when content differs from its canonical form.
pub(crate) fn ensure_span_dir(workdir: &Path, span_root: &str) -> Result<()> {
    let span_dir = workdir.join(span_root);
    std::fs::create_dir_all(&span_dir)?;

    let ga_path = span_dir.join(".gitattributes");
    let ga_canonical = "* text eol=lf\n";
    let ga_current = std::fs::read_to_string(&ga_path).unwrap_or_default();
    if ga_current != ga_canonical {
        std::fs::write(&ga_path, ga_canonical)?;
    }

    let gi_path = span_dir.join(".gitignore");
    let gi_current = std::fs::read_to_string(&gi_path).unwrap_or_default();
    if gi_current != SPAN_GITIGNORE_CONTENTS {
        std::fs::write(&gi_path, SPAN_GITIGNORE_CONTENTS)?;
    }

    Ok(())
}

fn span_file_path(repo: &gix::Repository, span_root: &str, name: &str) -> Result<PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::Git("bare repository is not supported".into()))?;
    Ok(workdir.join(span_root).join(name))
}

/// Delete a span by removing its worktree file under the span root.
pub fn delete_span(repo: &gix::Repository, name: &str) -> Result<()> {
    delete_span_in(repo, name, DEFAULT_SPAN_ROOT)
}

pub fn delete_span_in(repo: &gix::Repository, name: &str, span_root: &str) -> Result<()> {
    validate_span_name(name)?;
    let reader = SpanFileReader::new(repo, span_root.to_string());
    if reader.read_effective(name)?.is_none() {
        return Err(Error::SpanNotFound(name.into()));
    }
    let path = span_file_path(repo, span_root, name)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| Error::Git(format!("remove span file `{}`: {e}", path.display())))?;
    }
    Ok(())
}

/// Rename a span by moving its worktree file under the span root.
pub fn rename_span(repo: &gix::Repository, old: &str, new: &str) -> Result<()> {
    rename_span_in(repo, old, new, DEFAULT_SPAN_ROOT)
}

pub fn rename_span_in(repo: &gix::Repository, old: &str, new: &str, span_root: &str) -> Result<()> {
    validate_span_name(new)?;
    validate_span_name(old)?;

    let reader = SpanFileReader::new(repo, span_root.to_string());
    let Some(file) = reader.read_effective(old)? else {
        return Err(Error::SpanNotFound(old.into()));
    };
    if reader.read_effective(new)?.is_some() {
        return Err(Error::SpanAlreadyExists(new.into()));
    }

    let old_path = span_file_path(repo, span_root, old)?;
    let new_path = span_file_path(repo, span_root, new)?;

    // File→directory transition: when `new` has `old` as a strict path
    // prefix (`old` followed by `/`), the old regular file lies on the
    // new path's ancestor chain and obstructs `create_dir_all`.  Remove
    // it first; the effective content is already captured in `file`.
    let new_under_old = new
        .strip_prefix(old)
        .is_some_and(|rest| rest.starts_with('/'));
    if new_under_old && old_path.exists() {
        std::fs::remove_file(&old_path)
            .map_err(|e| Error::Git(format!("remove `{}`: {e}", old_path.display())))?;
    }

    if let Some(parent) = new_path.parent() {
        let workdir = repo
            .workdir()
            .ok_or_else(|| Error::Git("bare repository is not supported".into()))?;
        ensure_span_dir(workdir, span_root)?;
        std::fs::create_dir_all(parent)
            .map_err(|e| Error::Git(format!("create `{}`: {e}", parent.display())))?;
    }
    // Write the new file from the effective content (covers the case
    // where the old version lived only in HEAD/index, not on disk).
    std::fs::write(&new_path, file.serialize())
        .map_err(|e| Error::Git(format!("write `{}`: {e}", new_path.display())))?;
    if !new_under_old && old_path.exists() {
        std::fs::remove_file(&old_path)
            .map_err(|e| Error::Git(format!("remove `{}`: {e}", old_path.display())))?;
    }
    Ok(())
}
