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
    use super::{
        ensure_span_dir, GITATTRIBUTES_CONTENTS, HOOKIGNORE_CONTENTS,
        MANUAL_RUN_CONTENTS, SPAN_GITIGNORE_CONTENTS,
    };

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
            content, GITATTRIBUTES_CONTENTS,
            ".span/.gitattributes content must match the canonical form"
        );

        // Second call: idempotent — no error, content unchanged.
        ensure_span_dir(workdir, span_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&ga_path).expect("read .gitattributes again");
        assert_eq!(
            content2, GITATTRIBUTES_CONTENTS,
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

    /// `ensure_span_dir` must create `.span/.manual-run` with exact
    /// canonical content and must be idempotent.
    #[test]
    fn ensure_span_dir_writes_canonical_manual_run() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let span_root = ".span";

        ensure_span_dir(workdir, span_root).expect("first call");

        let mr_path = workdir.join(span_root).join(".manual-run");
        assert!(mr_path.exists(), ".span/.manual-run must exist after first call");

        let content = std::fs::read_to_string(&mr_path).expect("read .manual-run");
        assert_eq!(
            content, MANUAL_RUN_CONTENTS,
            ".span/.manual-run content must match the canonical form"
        );

        ensure_span_dir(workdir, span_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&mr_path).expect("read .manual-run again");
        assert_eq!(
            content2, MANUAL_RUN_CONTENTS,
            "content must be unchanged after idempotent second call"
        );
    }

    /// `ensure_span_dir` must create `.span/.hookignore` with exact
    /// canonical content on first call, and the second call must be a
    /// no-op (existence guard) even when content differs.
    #[test]
    fn ensure_span_dir_writes_canonical_hookignore() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let span_root = ".span";

        ensure_span_dir(workdir, span_root).expect("first call");

        let hi_path = workdir.join(span_root).join(".hookignore");
        assert!(hi_path.exists(), ".span/.hookignore must exist after first call");

        let content = std::fs::read_to_string(&hi_path).expect("read .hookignore");
        assert_eq!(
            content, HOOKIGNORE_CONTENTS,
            ".span/.hookignore content must match the canonical form"
        );

        ensure_span_dir(workdir, span_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&hi_path).expect("read .hookignore again");
        assert_eq!(
            content2, HOOKIGNORE_CONTENTS,
            "content must be unchanged after idempotent second call"
        );
    }

    /// `.hookignore` with user-added content must NOT be overwritten by a
    /// subsequent call to `ensure_span_dir`.
    #[test]
    fn ensure_span_dir_hookignore_preserves_user_rules() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let span_root = ".span";

        // Pre-populate .hookignore with user content that differs from
        // the canonical form.
        let span_dir = workdir.join(span_root);
        std::fs::create_dir_all(&span_dir).expect("create .span");
        let user_content = "# my custom rule\npath/to/foo  my-prefix\n";
        std::fs::write(span_dir.join(".hookignore"), user_content)
            .expect("write user .hookignore");

        ensure_span_dir(workdir, span_root).expect("call after user content");

        let hi_path = workdir.join(span_root).join(".hookignore");
        let content = std::fs::read_to_string(&hi_path).expect("read .hookignore");
        assert_eq!(
            content, user_content,
            ".hookignore must preserve user-added rules"
        );
    }
}

const DEFAULT_SPAN_ROOT: &str = ".span";

/// Canonical contents of `.span/.gitattributes` -- forces LF line endings
/// for all span files, keeping anchors portable across platforms.
const GITATTRIBUTES_CONTENTS: &str = "\
# Force LF line endings for all span files. gitattributes inherits
# to every descendant, so a single rule here covers the entire span
# tree and keeps anchors portable across platforms.
* text eol=lf
";

/// Canonical contents of `.span/.gitignore` -- ignores the dispatcher's
/// generated log files and manual-run dispatch scripts (see
/// `packages/agent-hooks/src/dispatcher.ts`), none of which are meant to be
/// committed alongside the spans they live next to.
const SPAN_GITIGNORE_CONTENTS: &str = "\
# Ignore dispatcher-generated runtime artifacts. The reconciler's
# agent-hooks dispatcher writes log files and manual-run dispatch
# scripts alongside spans; none of these are meant to be committed.
*.log
manual-hook-dispatch-*.sh
";

/// Canonical contents of `.span/.manual-run` -- a presence-only marker
/// that suspends automatic reconciler agent spawning.
const MANUAL_RUN_CONTENTS: &str = "\
# When this file exists, the agent-hooks dispatcher suspends automatic
# reconciler agent spawning. Instead of launching the agent directly,
# the dispatcher writes a runnable shell script and leaves the claim
# directory in place for a human to invoke later.
#
# This file is a presence-only marker: its content is never inspected.
# Delete it to resume automatic agent dispatch.
#
# Created automatically on the first `git span add` or `git span why`
# in this repository.
";

/// Canonical contents of `.span/.hookignore` -- path-scoped span
/// suppression rules for the agent hooks.
const HOOKIGNORE_CONTENTS: &str = "\
# Path-scoped span suppression for the agent hooks.
#
# Grammar (a deliberate subset of gitignore):
#   <path-pattern>  <prefix>[,<prefix>...]
#
# - path-pattern: glob matched against an anchor's repo-relative path.
#   * and ? stay within a segment; ** spans segments; trailing /
#   restricts to directories.
# - prefixes: comma-separated span slug prefixes to suppress for
#   matching paths. A slug carries a prefix when it equals the prefix
#   or begins with \"<prefix>/\".
#
# Full specification: plugins/git-span/skills/git-span/sections/hookignore.md
#
# This file is inert when it contains no active rules (all comment and
# blank lines). Add rules below.
";

/// Ensure the span root directory exists and contains the four `.span/`
/// control files with their canonical content. Idempotent:
///
/// * `.gitattributes`, `.gitignore`, `.manual-run` -- each is (re)written
///   only when missing or when content differs from its canonical form.
/// * `.hookignore` -- written only when missing (existence-only guard),
///   preserving any user-added rules.
pub(crate) fn ensure_span_dir(workdir: &Path, span_root: &str) -> Result<()> {
    let span_dir = workdir.join(span_root);
    std::fs::create_dir_all(&span_dir)?;

    let ga_path = span_dir.join(".gitattributes");
    let ga_current = std::fs::read_to_string(&ga_path).unwrap_or_default();
    if ga_current != GITATTRIBUTES_CONTENTS {
        std::fs::write(&ga_path, GITATTRIBUTES_CONTENTS)?;
    }

    let gi_path = span_dir.join(".gitignore");
    let gi_current = std::fs::read_to_string(&gi_path).unwrap_or_default();
    if gi_current != SPAN_GITIGNORE_CONTENTS {
        std::fs::write(&gi_path, SPAN_GITIGNORE_CONTENTS)?;
    }

    let mr_path = span_dir.join(".manual-run");
    let mr_current = std::fs::read_to_string(&mr_path).unwrap_or_default();
    if mr_current != MANUAL_RUN_CONTENTS {
        std::fs::write(&mr_path, MANUAL_RUN_CONTENTS)?;
    }

    let hi_path = span_dir.join(".hookignore");
    if !hi_path.exists() {
        std::fs::write(&hi_path, HOOKIGNORE_CONTENTS)?;
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
