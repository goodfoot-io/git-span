//! Behavior tests for live [`StateToken`](super::super::token::StateToken)
//! capture and pre-publish revalidation (card main-157 Phase 3, sub-scope 3B).
//!
//! Phase 1's `token::tests` already prove the token's *type* (canonical-key
//! sensitivity, projection round-trips). These tests prove the new *behavior*:
//! capturing from a real repo is deterministic, and revalidation detects a
//! mutation of every mutable component (index, worktree, HEAD) between capture
//! and re-read, plus the typed `Unreadable` state for a path that cannot be
//! read.

use super::*;
use crate::resolver::core::token::PathState;
use crate::types::EngineOptions;
use std::path::Path;
use std::process::Command;

const SPAN_ROOT: &str = ".span";

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Write a valid `.span/<name>` file anchoring `anchors` (`(path, start, end)`,
/// `(_, 0, 0)` = whole file). The content hash is computed faithfully but is
/// irrelevant to capture (capture never resolves).
fn write_span(workdir: &Path, name: &str, anchors: &[(&str, u32, u32)], why: &str) {
    let mut records = Vec::new();
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).expect("read anchored file");
        let hashed: Vec<u8> = if *start == 0 && *end == 0 {
            bytes.clone()
        } else {
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            let lo = (*start as usize).saturating_sub(1);
            let hi = (*end as usize).min(lines.len());
            let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
            slice.join("\n").into_bytes()
        };
        records.push(crate::span_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: "rk64".into(),
            content_hash: format!("sha256:{}", crate::types::sha256_hex(&hashed)),
        });
    }
    let sf = crate::span_file::SpanFile {
        anchors: records,
        why: why.to_string(),
    };
    let span_dir = workdir.join(SPAN_ROOT);
    std::fs::create_dir_all(&span_dir).expect("mkdir .span");
    std::fs::write(span_dir.join(name), sf.serialize()).expect("write span");
}

/// A committed repo with one source file and one span anchoring it.
fn repo_with_span() -> (tempfile::TempDir, gix::Repository) {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path();
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), "l1\nl2\nl3\nl4\nl5\n").expect("write src");
    write_span(dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "init"]);
    let repo = gix::open(dir).expect("gix open");
    (td, repo)
}

fn reopen(td: &tempfile::TempDir) -> gix::Repository {
    gix::open(td.path()).expect("gix reopen")
}

// (a) Capturing twice with no intervening mutation is byte-identical.
#[test]
fn capture_twice_no_mutation_is_identical() {
    let (_td, repo) = repo_with_span();
    let opts = EngineOptions::full();
    let t1 = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture 1");
    let t2 = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture 2");
    assert_eq!(t1, t2, "identical state must produce identical token");
    assert_eq!(
        t1.canonical_key_digest(),
        t2.canonical_key_digest(),
        "identical token must produce identical canonical key digest"
    );
    // Sanity: the token is populated from real data, not defaulted.
    assert_eq!(t1.semantic_epoch, SEMANTIC_EPOCH);
    assert_eq!(t1.span_root, SPAN_ROOT);
    assert_eq!(t1.span_blobs.len(), 1, "one committed span file");
    assert_eq!(t1.span_blobs[0].path, ".span/alpha");
    assert!(
        t1.worktree_state.iter().any(|e| e.path == "src/a.txt"),
        "anchored source path is a relevant worktree path"
    );
    // The captured token is self-consistent and, with no filters configured
    // and every path readable, revalidates as unchanged against itself.
    assert_eq!(
        revalidate(&repo, SPAN_ROOT, opts, &t1).expect("revalidate"),
        Revalidation::Unchanged
    );
}

// (b) Mutating the index between capture and revalidate is detected.
#[test]
fn index_mutation_is_detected() {
    let (td, repo) = repo_with_span();
    let opts = EngineOptions::full();
    let t = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture");

    // Stage an unrelated new file: rewrites `.git/index`'s trailer without
    // touching any relevant path, so `index_identity` (not `staged_state`) is
    // what must catch it.
    std::fs::write(td.path().join("unrelated.txt"), b"hello").expect("write");
    git(td.path(), &["add", "unrelated.txt"]);

    let repo2 = reopen(&td);
    assert_eq!(
        revalidate(&repo2, SPAN_ROOT, opts, &t).expect("revalidate"),
        Revalidation::Changed {
            field: "index_identity"
        }
    );
}

// (c) Mutating a relevant tracked worktree path is detected.
#[test]
fn worktree_mutation_is_detected() {
    let (td, repo) = repo_with_span();
    let opts = EngineOptions::full();
    let t = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture");

    // Edit the anchored source file in the worktree only (no staging): HEAD,
    // the index, and the span tree are all unchanged.
    std::fs::write(td.path().join("src/a.txt"), "l1\nCHANGED\nl3\nl4\nl5\n").expect("write");

    let repo2 = reopen(&td);
    assert_eq!(
        revalidate(&repo2, SPAN_ROOT, opts, &t).expect("revalidate"),
        Revalidation::Changed {
            field: "worktree_state"
        }
    );
}

// (d) Mutating HEAD is detected even though HEAD is excluded from the canonical
// digest (it is a derivation hint, not part of the exact key).
#[test]
fn head_mutation_is_detected_but_digest_is_stable() {
    let (td, repo) = repo_with_span();
    let opts = EngineOptions::full();
    let t = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture");

    // An empty commit moves HEAD without changing any tree (source, span
    // subtree, span blobs all stay identical).
    git(td.path(), &["commit", "--allow-empty", "-m", "empty"]);

    let repo2 = reopen(&td);
    assert_eq!(
        revalidate(&repo2, SPAN_ROOT, opts, &t).expect("revalidate"),
        Revalidation::Changed { field: "head" },
        "a HEAD move must be detected by revalidation"
    );

    let t2 = capture_state_token(&repo2, SPAN_ROOT, opts).expect("recapture");
    assert_ne!(t.head, t2.head, "HEAD actually moved");
    assert_eq!(
        t.canonical_key_digest(),
        t2.canonical_key_digest(),
        "HEAD is excluded from the canonical digest, so the exact key is stable"
    );
}

// (e) An unreadable relevant path is captured as the typed `Unreadable` state,
// never a wall-clock or other non-deterministic fallback.
#[test]
fn unreadable_path_is_typed_not_wall_clock() {
    let (td, _repo) = repo_with_span();
    let opts = EngineOptions::full();

    // Replace the anchored source file with a directory: reading it as file
    // content fails deterministically (regardless of uid, unlike chmod 000).
    let p = td.path().join("src/a.txt");
    std::fs::remove_file(&p).expect("rm file");
    std::fs::create_dir(&p).expect("mkdir at path");

    let repo = reopen(&td);
    let t = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture");

    let entry = t
        .worktree_state
        .iter()
        .find(|e| e.path == "src/a.txt")
        .expect("anchored path present in worktree state");
    assert_eq!(
        entry.state,
        PathState::Unreadable,
        "an unreadable path must be typed Unreadable, not Absent or a digest"
    );

    // Fail-closed: an Unreadable worktree identity makes the candidate
    // ineligible for persistence.
    assert!(
        !t.persistence_eligible(),
        "Unreadable worktree state must block persistence"
    );

    // Determinism: a second capture of the same unreadable state is identical
    // (no wall-clock seeding).
    let t2 = capture_state_token(&repo, SPAN_ROOT, opts).expect("recapture");
    assert_eq!(t, t2, "unreadable capture must be deterministic");
}

// ---------------------------------------------------------------------------
// Filter dependency identity (executable + environment proof)
// ---------------------------------------------------------------------------

/// Write `body` to `path` and mark it executable (Unix). A minimal `sh` script
/// is a real, resolvable, readable executable file — exactly what filter
/// resolution must digest.
fn write_executable(path: &Path, body: &str) {
    std::fs::write(path, body).expect("write executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .expect("stat executable")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).expect("chmod executable");
    }
}

fn filter_dep<'a>(t: &'a StateToken, driver: &str) -> &'a super::super::token::FilterDependency {
    t.filters
        .iter()
        .find(|f| f.driver == driver)
        .unwrap_or_else(|| panic!("filter `{driver}` present in captured token"))
}

// A filter whose clean/smudge commands resolve to a concrete executable file
// gains a complete dependency identity, making the token persistence-eligible
// (no environment-stripping workaround required).
#[test]
fn resolvable_filter_executable_has_complete_identity() {
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("myfilter.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    git(
        td.path(),
        &[
            "config",
            "filter.myfilter.clean",
            &format!("{} clean -- %f", exe.display()),
        ],
    );
    git(
        td.path(),
        &[
            "config",
            "filter.myfilter.smudge",
            &format!("{} smudge -- %f", exe.display()),
        ],
    );

    let repo = reopen(&td);
    let t = capture_state_token(&repo, SPAN_ROOT, EngineOptions::full()).expect("capture");
    let dep = filter_dep(&t, "myfilter");
    assert!(
        dep.executable_digest.is_some(),
        "a resolvable executable must be digested"
    );
    assert!(dep.env_digest.is_some(), "env digest is always computable");
    assert!(
        dep.has_complete_identity(),
        "both halves proven => complete identity"
    );
    assert!(
        t.persistence_eligible(),
        "resolvable filters plus readable state must be persistence-eligible"
    );
}

// A filter command naming a nonexistent program has no provable executable
// identity, so it fails closed: incomplete identity and an ineligible token.
#[test]
fn unresolvable_filter_command_is_ineligible() {
    let (td, _repo) = repo_with_span();
    git(
        td.path(),
        &[
            "config",
            "filter.broken.clean",
            "git-span-no-such-program-xyz123 %f",
        ],
    );

    let repo = reopen(&td);
    let t = capture_state_token(&repo, SPAN_ROOT, EngineOptions::full()).expect("capture");
    let dep = filter_dep(&t, "broken");
    assert!(
        dep.executable_digest.is_none(),
        "an unresolvable program must not be digested"
    );
    assert!(
        !dep.has_complete_identity(),
        "missing executable digest => incomplete identity"
    );
    assert!(
        !t.persistence_eligible(),
        "one unresolvable filter must make the whole token ineligible (fail closed)"
    );
}

// Two captures of the same filter configuration produce byte-identical
// executable and environment digests (determinism).
#[test]
fn identical_filter_config_produces_identical_digests() {
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("det.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    git(
        td.path(),
        &[
            "config",
            "filter.det.clean",
            &format!("{} %f", exe.display()),
        ],
    );

    let repo = reopen(&td);
    let opts = EngineOptions::full();
    let t1 = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture 1");
    let t2 = capture_state_token(&repo, SPAN_ROOT, opts).expect("capture 2");
    let d1 = filter_dep(&t1, "det");
    let d2 = filter_dep(&t2, "det");
    assert_eq!(
        d1.executable_digest, d2.executable_digest,
        "identical executable => identical digest"
    );
    assert_eq!(
        d1.env_digest, d2.env_digest,
        "identical environment => identical digest"
    );
    assert_eq!(
        t1.canonical_key_digest(),
        t2.canonical_key_digest(),
        "identical filter config must not perturb the canonical key"
    );
}

// Changing the executable's content at the same path changes its digest — a
// filter binary swap is a real identity change, not a coincidental match.
#[test]
fn changed_filter_executable_changes_digest() {
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("chg.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    git(
        td.path(),
        &[
            "config",
            "filter.chg.clean",
            &format!("{} %f", exe.display()),
        ],
    );

    let opts = EngineOptions::full();
    let repo = reopen(&td);
    let before = filter_dep(
        &capture_state_token(&repo, SPAN_ROOT, opts).expect("capture before"),
        "chg",
    )
    .executable_digest;

    // Replace the executable's bytes at the same resolved path.
    write_executable(&exe, "#!/bin/sh\nsed s/a/b/\n");
    let repo = reopen(&td);
    let after = filter_dep(
        &capture_state_token(&repo, SPAN_ROOT, opts).expect("capture after"),
        "chg",
    )
    .executable_digest;

    assert!(before.is_some() && after.is_some(), "both resolvable");
    assert_ne!(
        before, after,
        "different executable content must produce a different digest"
    );
}
