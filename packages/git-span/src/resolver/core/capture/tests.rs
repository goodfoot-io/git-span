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
    use git_span_core::{RK64_ALGORITHM, cheap_fingerprint_with_extent, rk64_to_hex};

    let mut records = Vec::new();
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).expect("read anchored file");
        let extent = if *start == 0 && *end == 0 {
            crate::types::AnchorExtent::WholeFile
        } else {
            crate::types::AnchorExtent::LineRange { start: *start, end: *end }
        };
        let fp = cheap_fingerprint_with_extent(&bytes, &extent);
        records.push(crate::span_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: RK64_ALGORITHM.to_string(),
            content_hash: rk64_to_hex(fp),
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

/// Isolate captures from any globally-installed filter (e.g. `git lfs install`'s
/// `filter.lfs.*`) so a configured filter's identity is exactly the one under
/// test. Mirrors `resolver::incremental::tests::init_repo`.
fn isolate_global_git_config() {
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
    }
}

/// Configure `filter.<driver>.clean` to `<cmd>` on the repo at `dir`.
fn set_filter_clean(dir: &Path, driver: &str, cmd: &str) {
    git(dir, &["config", &format!("filter.{driver}.clean"), cmd]);
}

// An ambient variable no LFS command references — the finding's `PWD`,
// terminal, or session-identity class — must not move the LFS driver's env
// digest or the canonical key. The LFS driver is the ONE class for which the
// narrow (referenced-only) digest is sound: its dedicated `git-lfs
// filter-process` spawn is a fixed-argument, content-addressed transform, not a
// `getenv`-reading `sh -c` command. This is the direction the whole-`vars_os()`
// digest broke — a working-directory or terminal change minted a fresh key at
// the same clean HEAD, defeating warm-hit and cross-worktree reuse on every
// git-lfs-configured machine.
#[test]
fn unrelated_env_variation_does_not_change_key_with_lfs() {
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("git-lfs.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    // The known LFS driver, whose command references no environment variable.
    set_filter_clean(td.path(), "lfs", &format!("{} %f", exe.display()));

    let opts = EngineOptions::full();

    unsafe {
        std::env::set_var("PWD", "/tmp/worktree-a");
        std::env::set_var("GIT_SPAN_UNRELATED_ENV", "one");
    }
    let t1 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 1");

    // Vary only variables the LFS driver does not reference.
    unsafe {
        std::env::set_var("PWD", "/opt/somewhere-else");
        std::env::set_var("GIT_SPAN_UNRELATED_ENV", "two");
    }
    let t2 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 2");

    assert_eq!(
        filter_dep(&t1, "lfs").env_digest,
        filter_dep(&t2, "lfs").env_digest,
        "an unreferenced env var must not move the LFS driver's env digest"
    );
    assert_eq!(
        t1.canonical_key_digest(),
        t2.canonical_key_digest(),
        "unrelated env variation must not change the canonical key for LFS (warm hit holds)"
    );
    unsafe {
        std::env::remove_var("GIT_SPAN_UNRELATED_ENV");
    }
}

// The finding's core fail-open case, now closed: an `envsubst`-style CUSTOM
// filter whose command line references NO variable at all, yet whose content
// transform depends on ambient variables (`envsubst` reads `$VAR` from the
// environment and substitutes it into the file body). Under the prior narrowing,
// its env digest was the empty set regardless of which variables actually drove
// the substitution, so changing one produced the same key — a stale exact hit.
// A non-LFS driver now keys the whole environment, so that change invalidates.
#[test]
fn envsubst_style_custom_filter_invalidates_on_unreferenced_env_change() {
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("envsubst.sh");
    write_executable(&exe, "#!/bin/sh\nenvsubst\n");
    // No `$VAR` anywhere on the command line: a naive command-line scan sees an
    // empty dependency set, yet the transform reads the environment internally.
    set_filter_clean(td.path(), "tmpl", &format!("{} %f", exe.display()));

    let opts = EngineOptions::full();

    unsafe {
        std::env::set_var("GIT_SPAN_TEMPLATE_VALUE", "first");
    }
    let t1 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 1");

    // Change a variable the command line never mentions but the filter reads.
    unsafe {
        std::env::set_var("GIT_SPAN_TEMPLATE_VALUE", "second");
    }
    let t2 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 2");

    assert_ne!(
        filter_dep(&t1, "tmpl").env_digest,
        filter_dep(&t2, "tmpl").env_digest,
        "a custom filter that reads env internally must key on it (whole-env digest)"
    );
    assert_ne!(
        t1.canonical_key_digest(),
        t2.canonical_key_digest(),
        "changing an internally-read env var must invalidate the key (no stale exact hit)"
    );
    unsafe {
        std::env::remove_var("GIT_SPAN_TEMPLATE_VALUE");
    }
}

// A custom `sh -c` driver's env dependency cannot be statically proven complete
// (its child may `getenv` any variable), so it is keyed on the WHOLE process
// environment, fail-closed. BOTH a variable it references on its command line
// AND one it does not must move the env digest and the canonical key — the
// codebase cannot tell "genuinely no internal env reads" from "just no
// command-line reference", so it treats every non-LFS driver uniformly rather
// than risk a false hit. (Contrast `unrelated_env_variation_does_not_change_key_with_lfs`,
// where the narrow digest is sound because the LFS spawn is dedicated and known.)
#[test]
fn custom_filter_env_variation_changes_key_whole_env() {
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("keyed.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    // A custom driver that happens to reference one variable on its command line.
    set_filter_clean(
        td.path(),
        "keyed",
        &format!("{} --key=$GIT_SPAN_FILTER_KEY %f", exe.display()),
    );

    let opts = EngineOptions::full();

    unsafe {
        std::env::set_var("GIT_SPAN_FILTER_KEY", "alpha");
        std::env::set_var("GIT_SPAN_UNREFERENCED", "one");
    }
    let t1 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 1");

    // Changing the command-line-referenced variable moves the key.
    unsafe {
        std::env::set_var("GIT_SPAN_FILTER_KEY", "beta");
    }
    let t2 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 2");
    assert_ne!(
        filter_dep(&t1, "keyed").env_digest,
        filter_dep(&t2, "keyed").env_digest,
        "a referenced env var's value change must move the custom filter env digest"
    );
    assert_ne!(
        t1.canonical_key_digest(),
        t2.canonical_key_digest(),
        "a referenced filter dependency must change the canonical key (no false hit)"
    );

    // And, unlike the LFS driver, a variable the command does NOT reference also
    // moves the key: the whole-environment digest is fail-closed for a driver
    // whose internal `getenv` reads cannot be proven.
    unsafe {
        std::env::set_var("GIT_SPAN_UNREFERENCED", "two");
    }
    let t3 = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture 3");
    assert_ne!(
        t2.canonical_key_digest(),
        t3.canonical_key_digest(),
        "a custom filter keys the whole environment: even an unreferenced var change must move the key (fail closed)"
    );
    unsafe {
        std::env::remove_var("GIT_SPAN_FILTER_KEY");
        std::env::remove_var("GIT_SPAN_UNREFERENCED");
    }
}

// End-to-end cross-worktree reuse with the LFS filter configured: two linked
// worktrees at the identical clean HEAD, captured under DIFFERENT ambient
// environments (as two separate CLI invocations from different directories
// would be), must produce the same canonical key — an immediate exact hit.
// The whole-`vars_os()` digest made this structurally impossible whenever
// git-lfs was configured; the LFS driver's narrow (empty) env digest plus
// content-based identity restores it. This is the Phase 6 win the fail-closed
// custom-filter treatment must NOT regress — LFS keeps the narrow digest
// because its dedicated `git-lfs filter-process` spawn is content-addressed.
#[test]
fn cross_worktree_exact_hit_with_lfs_filter() {
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("git-lfs.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    // Repo-local config lives in `.git/config`, shared by every linked worktree.
    set_filter_clean(td.path(), "lfs", &format!("{} %f", exe.display()));

    // Link a second worktree at the same commit.
    let linked = tempfile::tempdir().expect("linked worktree tempdir");
    let linked_path = linked.path().join("wt");
    // `--detach`: `main` is already checked out in the primary worktree, and a
    // detached checkout at the same commit gives the identical source tree (HEAD
    // is excluded from the canonical key anyway).
    git(
        td.path(),
        &[
            "worktree",
            "add",
            "--detach",
            linked_path.to_str().expect("utf8 path"),
            "main",
        ],
    );

    let opts = EngineOptions::full();

    // Prime the first worktree warm under one environment.
    unsafe {
        std::env::set_var("PWD", td.path().to_str().expect("utf8 path"));
        std::env::set_var("TERM_SESSION_ID", "session-a");
    }
    let primary = capture_state_token(&reopen(&td), SPAN_ROOT, opts).expect("capture primary");

    // The sibling worktree runs under a different working directory / session,
    // exactly as a second CLI invocation would.
    unsafe {
        std::env::set_var("PWD", linked_path.to_str().expect("utf8 path"));
        std::env::set_var("TERM_SESSION_ID", "session-b");
    }
    let sibling = capture_state_token(
        &gix::open(&linked_path).expect("gix open linked worktree"),
        SPAN_ROOT,
        opts,
    )
    .expect("capture sibling");

    assert_eq!(
        primary.canonical_key_digest(),
        sibling.canonical_key_digest(),
        "sibling worktree at identical clean HEAD with a filter configured must be an exact hit"
    );
    unsafe {
        std::env::remove_var("TERM_SESSION_ID");
    }
}

// -- Round 2: persistent exe-digest memo wiring ---------------------------
//
// These tests exercise `capture_state_token_with_memo`'s call into
// `ExeDigestMemo` directly (a fake, in-memory implementation standing in for
// `CacheStore`), rather than going through SQLite — `store::tests` covers the
// SQLite-backed `exe_digest_lookup`/`exe_digest_upsert` round trip and
// stat-mismatch behavior at that layer. What matters here is that
// `capture.rs` actually *trusts* a memo hit instead of re-hashing (proven by
// planting a deliberately wrong digest and observing it come back), and
// re-hashes (and overwrites the memo) the moment any stat field changes.

use crate::resolver::core::exe_digest::{ExeDigestMemo, ExeStatIdentity};
use std::collections::HashMap;

/// In-memory stand-in for `CacheStore`'s `ExeDigestMemo` impl: same
/// exact-stat-match trust rule, plus call counters so a test can assert
/// whether a lookup was served from the memo or fell through to a fresh
/// hash-and-upsert.
#[derive(Default)]
struct FakeExeMemo {
    rows: HashMap<std::path::PathBuf, (ExeStatIdentity, [u8; 32])>,
    lookups: usize,
    hits: usize,
    upserts: usize,
}

impl ExeDigestMemo for FakeExeMemo {
    fn lookup(&mut self, path: &Path, stat: &ExeStatIdentity) -> Option<[u8; 32]> {
        self.lookups += 1;
        let (stored_stat, digest) = self.rows.get(path)?;
        if stored_stat == stat {
            self.hits += 1;
            Some(*digest)
        } else {
            None
        }
    }

    fn upsert(&mut self, path: &Path, stat: &ExeStatIdentity, digest: [u8; 32]) {
        self.upserts += 1;
        self.rows.insert(path.to_path_buf(), (*stat, digest));
    }
}

/// Replicate `filter_executable_digest`'s wrapping formula for a filter
/// configured with exactly one command key (`clean`): the
/// `FilterDependency::executable_digest` field is not the resolved
/// executable's raw content digest — it is
/// `BLAKE3("gm.core.filter-exe\0" || len-prefixed(cmd_key) || content_digest)`.
/// A test that primes a fake memo with a sentinel "content digest" must wrap
/// the sentinel through this same formula to predict the resulting
/// `FilterDependency` field, exactly as production code does.
fn expected_single_command_digest(cmd_key: &str, content_digest: [u8; 32]) -> [u8; 32] {
    let mut h = Hasher::new();
    h.update(b"gm.core.filter-exe\0");
    write_prefixed(&mut h, cmd_key.as_bytes());
    h.update(&content_digest);
    *h.finalize().as_bytes()
}

// A cold capture (empty memo) hashes the executable directly and records the
// result; a second capture with the executable's stat unchanged must reuse
// the memoized digest rather than re-hashing — proven decisively by planting
// a wrong sentinel "content digest" into the memo's row and observing the
// captured `FilterDependency::executable_digest` come back wrapping the
// *sentinel*, not a fresh hash of the executable's real bytes.
#[test]
fn exe_digest_memo_is_reused_when_stat_is_unchanged() {
    // Isolate from any ambient global `filter.lfs.*` (e.g. a machine with
    // `git lfs install` run) — otherwise its driver contributes an extra
    // memo lookup/upsert alongside the one under test here.
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("memo.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    git(
        td.path(),
        &[
            "config",
            "filter.memo.clean",
            &format!("{} %f", exe.display()),
        ],
    );

    let opts = EngineOptions::full();
    let mut memo = FakeExeMemo::default();

    let repo = reopen(&td);
    let t1 = capture_state_token_with_memo(&repo, SPAN_ROOT, opts, Some(&mut memo))
        .expect("capture with empty memo");
    let real_digest = filter_dep(&t1, "memo")
        .executable_digest
        .expect("resolvable executable is digested");
    assert_eq!(memo.lookups, 1, "one command key configured => one lookup");
    assert_eq!(memo.hits, 0, "memo starts empty => no hit on first capture");
    assert_eq!(memo.upserts, 1, "a fresh digest must be memoized");
    let real_content_digest = *blake3::Hasher::new()
        .update(&std::fs::read(&exe).expect("read executable"))
        .finalize()
        .as_bytes();
    assert_eq!(
        real_digest,
        expected_single_command_digest("clean", real_content_digest),
        "sanity: the captured field wraps the executable's real content digest"
    );

    // Corrupt the memoized row in place (same stat, wrong "content digest") so
    // a second capture can only reproduce this exact wrapped value by
    // trusting the memo instead of re-hashing the executable's real bytes.
    let sentinel = [0xEEu8; 32];
    let stored = memo
        .rows
        .get_mut(&exe)
        .expect("row memoized after first capture");
    stored.1 = sentinel;

    let repo = reopen(&td);
    let t2 = capture_state_token_with_memo(&repo, SPAN_ROOT, opts, Some(&mut memo))
        .expect("capture with primed memo");
    assert_eq!(
        filter_dep(&t2, "memo").executable_digest,
        Some(expected_single_command_digest("clean", sentinel)),
        "unchanged stat identity must serve the memoized (sentinel) digest without re-hashing"
    );
    assert_eq!(memo.lookups, 2, "second capture also looks up the memo once");
    assert_eq!(
        memo.hits, 1,
        "second capture's lookup must match the unchanged stat"
    );
    assert_eq!(memo.upserts, 1, "a served memo hit must not re-upsert");
}

// Once the executable's mtime changes (content unchanged), its stat identity
// no longer matches the memoized row, so capture must re-hash — proven by
// priming the memo with a wrong sentinel digest under the *old* stat and
// observing the real content digest (not the sentinel) after the mtime bump.
#[test]
fn exe_digest_memo_recomputes_when_mtime_changes() {
    isolate_global_git_config();
    let (td, _repo) = repo_with_span();
    let exe_dir = tempfile::tempdir().expect("exe tempdir");
    let exe = exe_dir.path().join("touched.sh");
    write_executable(&exe, "#!/bin/sh\ncat\n");
    git(
        td.path(),
        &[
            "config",
            "filter.touched.clean",
            &format!("{} %f", exe.display()),
        ],
    );

    let opts = EngineOptions::full();
    let mut memo = FakeExeMemo::default();

    let repo = reopen(&td);
    let t1 = capture_state_token_with_memo(&repo, SPAN_ROOT, opts, Some(&mut memo))
        .expect("capture with empty memo");
    let real_digest = filter_dep(&t1, "touched")
        .executable_digest
        .expect("resolvable executable is digested");
    assert_eq!(memo.upserts, 1);

    // Prime a wrong sentinel under the row's *current* (pre-touch) stat, so a
    // stale-stat reuse would surface as the sentinel, not the real digest.
    let sentinel = [0x11u8; 32];
    memo.rows.get_mut(&exe).expect("row present").1 = sentinel;

    // Bump mtime without touching content: same bytes, different stat identity.
    let future = std::time::SystemTime::now() + std::time::Duration::from_secs(120);
    std::fs::File::open(&exe)
        .expect("open executable")
        .set_modified(future)
        .expect("set mtime");

    let repo = reopen(&td);
    let t2 = capture_state_token_with_memo(&repo, SPAN_ROOT, opts, Some(&mut memo))
        .expect("capture after mtime bump");
    assert_eq!(
        filter_dep(&t2, "touched").executable_digest,
        Some(real_digest),
        "a changed stat identity must be re-hashed, not served from the stale memo row"
    );
    assert_eq!(
        memo.lookups, 2,
        "both captures perform exactly one memo lookup for the single command key"
    );
    assert_eq!(
        memo.hits, 0,
        "neither lookup counts as a hit: the first finds no row at all, and the \
         second finds a row but rejects it on stat mismatch — the important \
         signal is the digest recomputation asserted above"
    );
    assert_eq!(
        memo.upserts, 2,
        "the recomputed digest must overwrite the stale row"
    );
}
