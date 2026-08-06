//! CLI: `git span history <span>` — the v2 output contract.
//!
//! Two formats: git-log-style text (the default) and `schema_version: 2` JSON
//! carrying the identical raw patch strings. Both are newest-first, and every
//! observable change is a unified diff in git's dialect — declaration edits as
//! real blob diffs (`span_diff`), anchor changes as pseudo-diffs between
//! extracted snapshots.
//!
//! # Projection inventory
//!
//! An oracle can miss a defect two ways that no state enumeration and no
//! skip-condition inventory will show. It can be *handed* the right data and
//! throw the discriminating part away (its **projection**), or it can be
//! pointed at the wrong data and never receive the case at all (its
//! **aperture**). Both are recorded here, one line each, with the assertion
//! that covers what is dropped or a sentence on why dropping it is safe.
//!
//! | Oracle | Projection — what the shape discards | Aperture — what it is never handed |
//! |---|---|---|
//! | [`block_form`] | Everything but the form: addresses, hashes, hunk bodies. The sweeps re-read all three off the raw `diff` beside it. Reads only the header region (before `\n--- `), so a hunk body quoting a marker phrase cannot be mistaken for one | One block's patch string; it cannot see sibling blocks or the entry around them |
//! | [`timeline_form`] | Same, and resolves `Rebound` from the structured `rebound` field rather than the patch text — `rebound anchor` is a phrase this repository's own tracked source contains | One anchor object |
//! | [`newest_commit_forms`] | `path`. `[Rebound, Modified]` cannot distinguish one address rendering both facts from two addresses rendering one each — use [`newest_commit_blocks`] where that is the point | Only `commits[0]`; older entries and the `current` block are outside it |
//! | [`newest_commit_blocks`] | Hashes, hunks, `unavailable`, `rebound`'s payload — asserted directly off the JSON in the tests that care | Only `commits[0]` |
//! | [`declared_pairs`] | The why-prose and every non-`rk64:` line of the declaration | One `.span` file at one rev; it says nothing about content at any address — [`read_address`] is the oracle for that |
//! | [`current_forms`] | `path` and payloads, exactly as `newest_commit_forms` does | The `current` array only; timeline entries are outside it |
//! | [`payload_fields`] | `path` and `diff` — deliberately. `path` is the join key every object differs in trivially, so including it would make any two objects "distinct" for free; `diff` is the patch string whose parsing `--format json` exists to spare consumers, and a discriminator recoverable only from a marker line inside it is not a contract | Two keys of one anchor object. It is the *narrowest* view a consumer might take, which is the point: distinguishability that survives this projection survives any wider one |
//! | [`every_current_state`] | — | Current-block states only. `Rebound` is timeline-only and `Proposed` current-block-only, so this set structurally cannot reach every form |
//! | [`every_timeline_state`] | — | Timeline states only, and only each fixture's *newest* entry is form-checked |
//! | The null-hash distinguishability matrix | Everything [`payload_fields`] drops | The three null-hash states reachable in `current[]`, enumerated by **route** (four objects — past-EOF contributes both of its). Enumerating by state was the trap: past-EOF has two routes that used to render differently, so a state-keyed matrix passes on whichever route the implementer fixtured first. The fourth null-hash state, the `/dev/null` side of a genuine create, cannot reach `current[]` at all — an uncommitted addition renders `anchors: []` — so it is outside this aperture and covered by the timeline sweeps |

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

mod format_surface;
mod timeline;
mod topology;
mod reanchors;
mod invariants;
mod documented_contract;
mod current_block;
mod rendering_diffs;
mod dates;
mod past_eof;
mod filters;
mod pipe;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Run `git span history` and return stdout as text, asserting exit 0.
fn history_text(repo: &TestRepo, span: &str) -> Result<String> {
    let out = repo.run_span(["history", span])?;
    anyhow::ensure!(
        out.status.success(),
        "history failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}


/// Run `git span history --format=json` and parse stdout.
fn history_json(repo: &TestRepo, span: &str) -> Result<Value> {
    let out = repo.run_span(["history", span, "--format=json"])?;
    anyhow::ensure!(
        out.status.success(),
        "history --format=json failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(serde_json::from_slice(&out.stdout)?)
}


/// Find the commit object whose `summary` contains `needle`.
fn commit_with<'a>(json: &'a Value, needle: &str) -> &'a Value {
    json["commits"]
        .as_array()
        .expect("commits must be an array")
        .iter()
        .find(|c| c["summary"].as_str().unwrap_or("").contains(needle))
        .unwrap_or_else(|| panic!("no commit whose summary contains {needle:?} in {json:#}"))
}


/// Index of the commit whose `summary` contains `needle`.
fn commit_index(json: &Value, needle: &str) -> usize {
    json["commits"]
        .as_array()
        .expect("commits must be an array")
        .iter()
        .position(|c| c["summary"].as_str().unwrap_or("").contains(needle))
        .unwrap_or_else(|| panic!("no commit whose summary contains {needle:?} in {json:#}"))
}


/// The text block of `out` that renders the diff whose `diff --git` header
/// contains `needle`, up to the next blank-line-separated block.
fn diff_block<'a>(out: &'a str, needle: &str) -> &'a str {
    let start = out
        .match_indices("diff --git ")
        .find(|(i, _)| {
            let line_end = out[*i..].find('\n').map(|n| i + n).unwrap_or(out.len());
            out[*i..line_end].contains(needle)
        })
        .map(|(i, _)| i)
        .unwrap_or_else(|| panic!("no `diff --git` header containing {needle:?} in:\n{out}"));
    let rest = &out[start..];
    match rest.find("\n\n") {
        Some(end) => &rest[..end + 1],
        None => rest,
    }
}


/// Seed the swap scenario: two anchors whose contents exchange addresses in
/// one commit, with the declaration left untouched. Both anchors end up
/// relocated, each onto the address the other declared.
fn swap_repo() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    let span = "swap";

    repo.write_file(
        "src.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nBBB-1\nBBB-2\nBBB-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L5-L7"])?;
    repo.span_stdout(["why", span, "tracks both blocks"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Exchange the two blocks. Pairing by exact address first would hand each
    // anchor the wrong partner and fabricate two total rewrites for what are
    // two pure moves.
    repo.write_file(
        "src.txt",
        "BBB-1\nBBB-2\nBBB-3\nmiddle\nAAA-1\nAAA-2\nAAA-3\n",
    )?;
    repo.commit_all("swap the two blocks")?;
    Ok(repo)
}


/// Seed the main timeline scenario for span `m`:
///
/// * `C0` — three source files.
/// * `C1` — create the span with `file1.txt#L1-L5` and `file2.txt#L1-L3`.
/// * `C2` — edit `file2.txt`'s anchored lines **without touching the
///   declaration** (the walk-expansion case: today's declaration-only walk
///   would fold this change into the next span commit).
/// * `C3` — a why-prose edit alone (declaration diff, no anchor change).
/// * `C4` — edit `file1.txt` *outside* every declared range: the commit
///   qualifies for the walk but changes nothing observable, so it is dropped.
/// * `C5` — remove the `file2.txt` anchor and add a whole-file `file3.txt`
///   anchor.
///
/// The working tree is left with `file3.txt` edited (uncommitted drift) and a
/// declaration that matches HEAD.
fn seed_history_scenario() -> Result<(TestRepo, &'static str)> {
    let repo = TestRepo::new()?;
    let span = "m";

    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file("file2.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n")?;
    repo.write_file("file3.txt", "first\nsecond\nthird\nfourth\nfifth\n")?;
    repo.commit_all("C0: initial files")?;

    // C1: create the span.
    repo.span_stdout(["add", span, "file1.txt#L1-L5"])?;
    repo.span_stdout(["add", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "First why: tracks the two source files."])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span"])?;

    // C2: anchored content changes with the declaration untouched.
    repo.write_file("file2.txt", "ALPHA\nBETA\ngamma\ndelta\nepsilon\n")?;
    repo.commit_all("C2: edit file2 content only")?;

    // C3: why prose only. The C2 edit changed anchored content, so the
    // post-write reconcile check (plan `reconciliation-output.md`) reports
    // the stale anchor: the why write lands locally but exits 1 — local
    // success never implies span-wide reconciliation.
    let out = repo.run_span(["why", span, "Second why: prose alone changed."])?;
    let why_stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(1),
        "stale anchored content must make the why write exit 1; stdout=\n{why_stdout}"
    );
    assert!(
        why_stdout.contains(&format!("Set why on span `{span}`.")),
        "the why write still succeeded locally; stdout=\n{why_stdout}"
    );
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C3: edit why prose only"])?;

    // C4: an anchored file changes outside every declared range.
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nLINE9\nline10\n",
    )?;
    repo.commit_all("C4: touch file1 outside the anchored range")?;

    // C5: drop one anchor, add a whole-file anchor.
    repo.span_stdout(["remove", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "file3.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git([
        "commit",
        "-m",
        "C5: remove file2 anchor, add file3 whole-file",
    ])?;

    // Uncommitted source drift so the `current` section appears.
    repo.write_file(
        "file3.txt",
        "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
    )?;

    Ok((repo, span))
}


/// Promote a tracked directory containing a line-range anchor to a submodule.
/// The submodule may preserve the recorded bytes (the resolver's
/// `ResolvedPendingCommit` case) or replace them (the terminal `Submodule`
/// case).
fn directory_promoted_to_submodule(equal_bytes: bool) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    let recorded = "l1\nl2\nl3\n";

    std::fs::create_dir_all(repo.path().join("lib"))?;
    repo.write_file("lib/f.txt", recorded)?;
    repo.commit_all("initial directory")?;
    repo.span_stdout(["add", "sp", "lib/f.txt#L1-L3"])?;
    repo.span_stdout(["why", "sp", "tracks the promoted directory"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "add anchor"])?;

    let inner = tempfile::tempdir()?;
    let inner_path = inner.keep();
    std::process::Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(&inner_path)
        .output()?;
    std::fs::write(
        inner_path.join("f.txt"),
        if equal_bytes {
            recorded
        } else {
            "FOREIGN1\nFOREIGN2\nFOREIGN3\n"
        },
    )?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args(["-c", "user.email=t@e", "-c", "user.name=T", "add", "-A"])
        .output()?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args([
            "-c",
            "user.email=t@e",
            "-c",
            "user.name=T",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "inner",
        ])
        .output()?;

    repo.run_git(["rm", "-r", "lib"])?;
    repo.run_git([
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        &inner_path.to_string_lossy(),
        "lib",
    ])?;
    repo.commit_all("promote directory to submodule")?;
    Ok(repo)
}


/// Every `rk64` token the declaration records, read from the worktree file and
/// from HEAD's copy of it.
fn recorded_tokens(repo: &TestRepo, span: &str) -> Result<Vec<String>> {
    let rel = format!(".span/{span}");
    let worktree = std::fs::read_to_string(repo.path().join(&rel)).unwrap_or_default();
    let head = repo
        .git_stdout(["show", &format!("HEAD:{rel}")])
        .unwrap_or_default();
    Ok([worktree, head]
        .iter()
        .flat_map(|text| {
            text.lines()
                .filter_map(|line| line.split_once("rk64:"))
                .map(|(_, rest)| {
                    rest.split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .collect())
}


/// The old-side hash of every `index rk64:<old>..rk64:<new>` line in `diff`.
fn old_index_hashes(diff: &str) -> Vec<&str> {
    diff.lines()
        .filter_map(|line| line.strip_prefix("index rk64:"))
        .filter_map(|rest| rest.split_once(".."))
        .map(|(old, _)| old)
        .collect()
}


/// The same drift as [`drifted_repo`], but *committed* and never re-anchored.
/// `git status` is clean; `git span drift` still reports the anchor, sourced at
/// `HEAD`. This is the state the `current` block used to describe as an
/// uncommitted working-tree edit.
fn committed_drift_repo(span: &str) -> Result<TestRepo> {
    let repo = drifted_repo(span)?;
    repo.commit_all("commit the drift without re-anchoring")?;
    Ok(repo)
}


/// The drift staged and not committed: the index holds bytes the declaration
/// does not record, and `HEAD` is clean. The third of `drift`'s three layers,
/// and the one no `current` fixture reached before.
fn staged_drift_repo(span: &str) -> Result<TestRepo> {
    let repo = drifted_repo(span)?;
    repo.run_git(["add", "f.txt"])?;
    Ok(repo)
}


/// Drift at two layers at once: committed without re-anchoring, then edited
/// again in the working tree. `git span drift` names both, and this is the
/// fixture that decides `sources` must be a list — a scalar has to pick one of
/// these two and drop the other.
fn composed_drift_repo(span: &str) -> Result<TestRepo> {
    let repo = committed_drift_repo(span)?;
    // The second edit must land *inside* the declared range: the committed
    // state already carries `BETA`, so re-editing that line would leave
    // `f.txt#L1-L3` byte-identical to `HEAD` and the fixture would quietly
    // reduce to the single-layer case it exists to rule out.
    repo.write_file("f.txt", "h1\nH2-AGAIN\nalpha\nBETA\ngamma\n")?;
    Ok(repo)
}


/// One line-range and one whole-file anchor, with independent edits at all
/// three resolver layers. The sequence deliberately reaches HEAD first, then
/// stages a second edit, then leaves a third in the worktree so the fixture can
/// expose ordering instead of merely proving that each source is present.
fn extent_dependent_source_order_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("range.txt", "one\ntwo\nthree\n")?;
    repo.write_file("whole.txt", "alpha\nbeta\n")?;
    repo.commit_all("initial content")?;
    repo.span_stdout(["add", span, "range.txt#L1-L3", "whole.txt"])?;
    repo.span_stdout(["why", span, "exposes resolver layer ordering"])?;
    repo.commit_all("declare both extents")?;

    repo.write_file("range.txt", "one\nHEAD-RANGE\nthree\n")?;
    repo.write_file("whole.txt", "alpha\nHEAD-WHOLE\n")?;
    repo.commit_all("commit source drift without re-anchoring")?;

    repo.write_file("range.txt", "one\nINDEX-RANGE\nthree\n")?;
    repo.write_file("whole.txt", "alpha\nINDEX-WHOLE\n")?;
    repo.run_git(["add", "range.txt", "whole.txt"])?;

    repo.write_file("range.txt", "one\nWORKTREE-RANGE\nthree\n")?;
    repo.write_file("whole.txt", "alpha\nWORKTREE-WHOLE\n")?;
    Ok(repo)
}


/// Move a declaration to different, already-committed content without
/// committing source content or the declaration edit. The resulting HEAD
/// observation is therefore proof of a comparison against HEAD, not proof of
/// a new content commit.
fn worktree_only_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "old one\nold two\nold three\nseparator\nnew one\nnew two\nnew three\n",
    )?;
    repo.commit_all("initial content")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks one duplicated block"])?;
    repo.commit_all("declare the first block")?;

    let declaration_path = repo.path().join(".span").join(span);
    let declaration = std::fs::read_to_string(&declaration_path)?;
    std::fs::write(
        declaration_path,
        declaration.replace("f.txt#L1-L3", "f.txt#L5-L7"),
    )?;
    Ok(repo)
}

// ---------------------------------------------------------------------------
// Topology: which commits are walked, and what each one is diffed against
// ---------------------------------------------------------------------------

/// A diamond over one anchored range: `side` edits line 2, `main` edits line 5,
/// and a `--no-ff` merge takes both. The merge's *first* parent is `main`.
///
/// The corpus had no merge fixture at all before this one, which is how two
/// separate defects lived here undisturbed: the walk skipped merges outright,
/// and every entry was diffed against the previous *rendered* entry rather than
/// against its own first parent. Neither is visible in a linear history, where
/// the walk's predecessor and the first parent are the same commit.
fn merge_diamond_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L5"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file("f.txt", "l1\nSIDE2\nl3\nl4\nl5\n")?;
    repo.commit_all("side edits line 2")?;
    repo.run_git(["checkout", "-"])?;
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nMAIN5\n")?;
    repo.commit_all("main edits line 5")?;
    repo.run_git(["merge", "--no-ff", "side", "-m", "merge side"])?;
    Ok(repo)
}


/// A side branch whose newer timestamp must not let it leak into the timeline:
/// an `-s ours` merge discards its file edit, leaving HEAD on the mainline's
/// bytes.  This is deliberately dated so the former time-ordered DAG walk
/// chose the side commit before the mainline commit.
fn ours_merge_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.commit_all("declare")?;
    repo.run_git(["checkout", "-b", "discarded-side"])?;
    repo.write_file("f.txt", "one\nSIDE\nthree\n")?;
    repo.run_git(["add", "f.txt"])?;
    repo.run_git_with_env(
        ["commit", "-m", "discarded side edit"],
        &[
            ("GIT_AUTHOR_DATE", "2026-06-30T12:00:00+00:00"),
            ("GIT_COMMITTER_DATE", "2026-06-30T12:00:00+00:00"),
        ],
    )?;
    repo.run_git(["checkout", "main"])?;
    repo.write_file("f.txt", "one\nMAIN\nthree\n")?;
    repo.run_git(["add", "f.txt"])?;
    repo.run_git_with_env(
        ["commit", "-m", "mainline edit"],
        &[
            ("GIT_AUTHOR_DATE", "2026-01-02T12:00:00+00:00"),
            ("GIT_COMMITTER_DATE", "2026-01-02T12:00:00+00:00"),
        ],
    )?;
    repo.run_git([
        "merge",
        "-s",
        "ours",
        "--no-ff",
        "discarded-side",
        "-m",
        "ours merge",
    ])?;
    repo.write_commit_graph()?;
    Ok(repo)
}


/// Every signed line in every rendered anchor block, checked against git.
///
/// A `-` line must exist in the anchored file at the commit's **first parent**
/// and a `+` line must exist in it at the commit itself. This is the whole
/// correctness claim for the pairing, stated without reference to how the
/// pairing is implemented, so a renderer that reaches the same output by a
/// different route still has to answer to git for every line it signs.
fn assert_no_fabricated_lines(repo: &TestRepo, span: &str) -> Result<()> {
    let json = history_json(repo, span)?;
    let mut signed = 0usize;
    for entry in json["commits"].as_array().expect("commits array") {
        let hash = entry["hash"].as_str().expect("commit hash");
        let parents = repo.git_stdout(["rev-list", "--parents", "-n", "1", hash])?;
        let first_parent = parents.split_whitespace().nth(1).map(str::to_string);
        for anchor in entry["anchors"].as_array().expect("anchors array") {
            let Some(diff) = anchor["diff"].as_str() else {
                continue;
            };
            let path = anchor["path"]
                .as_str()
                .expect("anchor path")
                .rsplit_once("#L")
                .map(|(p, _)| p.to_string())
                .unwrap_or_else(|| anchor["path"].as_str().expect("anchor path").to_string());
            let at = |rev: &Option<String>| -> Vec<String> {
                let Some(rev) = rev else {
                    return Vec::new();
                };
                repo.run_git(["show", &format!("{rev}:{path}")])
                    .ok()
                    .filter(|out| out.status.success())
                    .map(|out| {
                        String::from_utf8_lossy(&out.stdout)
                            .lines()
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let old = at(&first_parent);
            let new = at(&Some(hash.to_string()));
            for line in diff.lines() {
                if line.starts_with("---") || line.starts_with("+++") {
                    continue;
                }
                if let Some(body) = line.strip_prefix('-') {
                    signed += 1;
                    assert!(
                        old.iter().any(|l| l == body),
                        "{span}: {hash} signs `-{body}` at {path}, which is in no \
                         line of that file at its first parent:\n{diff}"
                    );
                } else if let Some(body) = line.strip_prefix('+') {
                    signed += 1;
                    assert!(
                        new.iter().any(|l| l == body),
                        "{span}: {hash} signs `+{body}` at {path}, which is in no \
                         line of that file at the commit itself:\n{diff}"
                    );
                }
            }
        }
    }
    assert!(
        signed > 0,
        "{span}: nothing was signed, so nothing was checked"
    );
    Ok(())
}


fn assert_topology_rejected_without_effects(
    repo: &TestRepo,
    span: &str,
    env: &[(&str, &str)],
    expected_guidance: &[&str],
) -> Result<()> {
    let declaration = repo.path().join(format!(".span/{span}"));
    let before = std::fs::read(&declaration)?;
    for (name, args) in [
        ("history", vec!["history", span, "--format=json"]),
        ("drift", vec!["drift", "--format=json"]),
        ("drift --fix", vec!["drift", "--fix"]),
    ] {
        let out = repo.run_span_with_envs(args, env)?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success()
                && out.stdout.is_empty()
                && stderr.contains("replacement topology is unsupported")
                && expected_guidance.iter().all(|text| stderr.contains(text)),
            "{name} must reject changed reachable commit semantics before output: stdout={} stderr={}",
            String::from_utf8_lossy(&out.stdout),
            stderr
        );
    }
    assert_eq!(
        std::fs::read(&declaration)?,
        before,
        "drift --fix must not mutate declarations after topology rejection"
    );
    Ok(())
}


/// Commit `alpha/beta/gamma` anchored at `f.txt#L1-L3`, then prepend two
/// lines in the worktree and edit `beta` — the ordinary drift state, with the
/// declaration untouched. `drift` calls it "changed in the working tree" and
/// proposes nothing.
fn drifted_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.write_file("f.txt", "h1\nh2\nalpha\nBETA\ngamma\n")?;
    Ok(repo)
}


/// A declaration added but never committed, whose anchored lines are then
/// edited: the recorded token describes bytes that no commit ever carried, so
/// no snapshot this command can reach hashes to it.
fn never_recorded_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    // The declaration stays in the worktree, and the anchored content moves on
    // without it.
    repo.write_file("f.txt", "alpha\nZZZ\nCCC\n")?;
    Ok(repo)
}


/// Rewrite the worktree declaration, leaving the recorded tokens alone. This
/// is how a user (or `git span drift --fix`) re-anchors: the address moves,
/// the token stays, and HEAD's copy still names the old address.
fn rewrite_declaration(repo: &TestRepo, span: &str, from: &str, to: &str) -> Result<()> {
    let decl = repo.path().join(format!(".span/{span}"));
    let text = std::fs::read_to_string(&decl)?;
    assert!(text.contains(from), "declaration has no {from}:\n{text}");
    std::fs::write(&decl, text.replace(from, to))?;
    Ok(())
}


/// Two anchors whose *declared addresses* are exchanged in the worktree — each
/// token is now declared where the other's content lives — with both blocks
/// also edited, so the resolver can no longer find either recorded block and
/// the only place those bytes survive is the last recorded state.
fn declaration_swap_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nBBB-1\nBBB-2\nBBB-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "f.txt#L5-L7"])?;
    repo.span_stdout(["why", span, "tracks both blocks"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L9-L11")?;
    rewrite_declaration(&repo, span, "f.txt#L5-L7", "f.txt#L1-L3")?;
    rewrite_declaration(&repo, span, "f.txt#L9-L11", "f.txt#L5-L7")?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-EDITED\nAAA-3\nmiddle\nBBB-1\nBBB-EDITED\nBBB-3\n",
    )?;
    Ok(repo)
}


/// Re-anchor onto an address the declaration never used, then edit inside the
/// new range while the recorded block sits untouched elsewhere — the one shape
/// where a declaration re-anchor and a resolver relocation both apply.
fn reanchor_over_relocation_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "alpha\nbeta\ngamma\nfour\nfive\nsix\nseven\neight\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the greek block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L6-L8")?;
    repo.write_file(
        "f.txt",
        "alpha\nbeta\ngamma\nfour\nfive\nsix\nEDITED\neight\n",
    )?;
    Ok(repo)
}


/// Two anchors in *different files* whose declared addresses are exchanged in
/// the worktree declaration, content untouched. The resolver cannot follow a
/// token across files, so both anchors come out `changed` and the recorded
/// bytes survive only in the snapshots the render itself prints. Reachable
/// without hand-editing: resolving a `.span` conflict after a merge or rebase
/// leaves exactly this state.
fn cross_file_swap_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "AAA-1\nAAA-2\nAAA-3\n")?;
    repo.write_file("g.txt", "BBB-1\nBBB-2\nBBB-3\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "g.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks both files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "tmp.txt#L1-L1")?;
    rewrite_declaration(&repo, span, "g.txt#L1-L3", "f.txt#L1-L3")?;
    rewrite_declaration(&repo, span, "tmp.txt#L1-L1", "g.txt#L1-L3")?;
    Ok(repo)
}


/// The minimal false-unrecoverable reproduction: re-anchor by editing the
/// declaration, then replace the recorded block's content in the worktree. The
/// token's bytes are gone from the worktree but still sit in HEAD at an
/// address this anchor never pairs with.
fn abandoned_block_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\nmid\nAAA\nBBB\nCCC\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "the block matters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L5-L7")?;
    repo.write_file("f.txt", "XXX\nYYY\nZZZ\nmid\nAAA\nBBB\nCCC\n")?;
    Ok(repo)
}


/// The single `current` anchor entry whose `path` is `address`.
fn anchor_at<'a>(anchors: &'a [Value], address: &str) -> &'a Value {
    let mut found = anchors.iter().filter(|a| a["path"] == address);
    let first = found
        .next()
        .unwrap_or_else(|| panic!("no current anchor at {address} in {anchors:#?}"));
    assert!(
        found.next().is_none(),
        "more than one current anchor at {address} in {anchors:#?}"
    );
    first
}


/// Two anchors in different files holding *identical* content, so one `rk64`
/// token binds both addresses — then drift one of them. `rk64` is a
/// content-only fingerprint, so a token→snapshot lookup that ignores the
/// asking anchor's own address can hand back the sibling's snapshot.
fn twin_token_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("x.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("y.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "x.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "y.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "two copies of one block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    repo.write_file("x.txt", "alpha\nBETA\ngamma\n")?;
    Ok(repo)
}


/// The five shapes a rendered anchor block can take, as a reader of the patch
/// would classify it — from the header lines alone, never from the code that
/// produced them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BlockForm {
    /// `deleted anchor` — the address left the declaration.
    Deleted,
    /// `new anchor` — the address entered it.
    Created,
    /// `rename from`/`rename to`. `similarity` is `None` when the block
    /// carries no `similarity index` line — a shape the classifier must be
    /// able to *represent*, because a classifier that cannot represent the
    /// absent case cannot test for it, and the alternative (parsing to some
    /// default) would fabricate inside the oracle the very number the
    /// renderer was fixed to stop fabricating.
    Renamed { similarity: Option<u8> },
    /// `proposed anchor <address>` — the resolver's move instruction.
    Proposed,
    /// `rebound anchor` — the address kept its content but changed which
    /// recorded token the declaration binds to it.
    Rebound,
    /// No status line: same address, changed content.
    Modified,
}


fn block_form(diff: &str) -> BlockForm {
    let head = diff.split("\n--- ").next().unwrap_or(diff);
    if head.contains("\nrebound anchor\n") {
        BlockForm::Rebound
    } else if head.contains("\ndeleted anchor\n") {
        BlockForm::Deleted
    } else if head.contains("\nnew anchor\n") {
        BlockForm::Created
    } else if head.contains("\nrename from ") {
        let similarity = head.lines().find_map(|l| {
            let value = l.strip_prefix("similarity index ")?.strip_suffix('%');
            Some(
                value
                    .and_then(|n| n.parse().ok())
                    .unwrap_or_else(|| panic!("an unreadable similarity index:\n{diff}")),
            )
        });
        BlockForm::Renamed { similarity }
    } else if head.contains("\nproposed anchor ") {
        BlockForm::Proposed
    } else {
        BlockForm::Modified
    }
}


/// The `(address, token)` pairs `.span/<span>` declares, read from the
/// worktree file (`rev` = `None`) or from a committed copy — an oracle for
/// "does this declaration still bind this token here" that shares nothing with
/// the renderer. The pair, not the address alone: a swap leaves every address
/// declared while moving every token.
fn declared_pairs(repo: &TestRepo, span: &str, rev: Option<&str>) -> Result<Vec<(String, String)>> {
    let text = match rev {
        Some(rev) => repo.git_stdout(["show", &format!("{rev}:.span/{span}")])?,
        None => std::fs::read_to_string(repo.path().join(format!(".span/{span}")))?,
    };
    Ok(text
        .lines()
        .filter_map(|l| l.split_once(' '))
        .filter(|(_, token)| token.starts_with("rk64:"))
        .map(|(addr, token)| (addr.to_string(), token.trim().to_string()))
        .collect())
}


/// Every block rendered for one address. One address carries more than one
/// block whenever two independent facts are true of it at once — a rebinding
/// and a content edit in the same commit — which is why this exists beside
/// [`anchor_at`], whose single-block assertion is the right one everywhere
/// else.
fn anchors_at<'a>(anchors: &'a [Value], address: &str) -> Vec<&'a Value> {
    anchors.iter().filter(|a| a["path"] == address).collect()
}


/// The new-side `rk64:` token an anchor block's `index` line names.
fn new_token(diff: &str) -> String {
    diff.lines()
        .find_map(|l| l.strip_prefix("index "))
        .and_then(|rest| rest.split_once(".."))
        .map(|(_, new)| new.trim().to_string())
        .unwrap_or_else(|| panic!("no index line in:\n{diff}"))
}


/// The token `.span/<span>` records for `address` at `rev`.
fn declared_token(repo: &TestRepo, span: &str, rev: Option<&str>, address: &str) -> Result<String> {
    Ok(declared_pairs(repo, span, rev)?
        .into_iter()
        .find(|(addr, _)| addr == address)
        .unwrap_or_else(|| panic!("{address} is not declared at {rev:?}"))
        .1)
}


/// The old-side `rk64:` token an anchor block's `index` line names.
fn old_token(diff: &str) -> String {
    diff.lines()
        .find_map(|l| l.strip_prefix("index "))
        .and_then(|rest| rest.split_once(".."))
        .map(|(old, _)| old.to_string())
        .unwrap_or_else(|| panic!("no index line in:\n{diff}"))
}


/// `n` files with distinct three-line blocks, all anchored, then one commit
/// that rotates the addresses among the recorded tokens. Every anchor is
/// broken by that commit and not one byte of content changed — the state a
/// content-keyed pairing cannot see, since a permutation of declarations
/// preserves both the address set and the content at every address.
fn rebinding_repo(span: &str, n: usize) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    for i in 0..n {
        let tag = (b'A' + i as u8) as char;
        repo.write_file(
            &format!("f{i}.txt"),
            &format!("{tag}-1\n{tag}-2\n{tag}-3\n"),
        )?;
    }
    repo.commit_all("initial")?;
    for i in 0..n {
        repo.span_stdout(["add", span, &format!("f{i}.txt#L1-L3")])?;
    }
    repo.span_stdout(["why", span, "one block per file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rotate_address_column(&repo, span, n)?;
    repo.commit_all("rebind every anchor to its neighbour's block")?;
    Ok(repo)
}


/// Rotate a declaration's address column, leaving the token column alone:
/// every token now names a block it does not describe, while every address and
/// every byte in the repository stays exactly where it was.
fn rotate_address_column(repo: &TestRepo, span: &str, n: usize) -> Result<()> {
    let decl = repo.path().join(format!(".span/{span}"));
    let text = std::fs::read_to_string(&decl)?;
    let lines: Vec<&str> = text.lines().collect();
    let addresses: Vec<&str> = lines
        .iter()
        .filter_map(|l| l.split_once(' '))
        .filter(|(_, token)| token.starts_with("rk64:"))
        .map(|(addr, _)| addr)
        .collect();
    let mut rotated = String::new();
    let mut seen = 0;
    for line in &lines {
        match line.split_once(' ') {
            Some((_, token)) if token.starts_with("rk64:") => {
                rotated.push_str(&format!("{} {token}\n", addresses[(seen + 1) % n]));
                seen += 1;
            }
            _ => {
                rotated.push_str(line);
                rotated.push('\n');
            }
        }
    }
    // A rewrite that matched nothing produces a fixture that proves the
    // absence of a defect it never created.
    assert_ne!(
        rotated, text,
        "the declaration rewrite matched nothing:\n{text}"
    );
    std::fs::write(&decl, rotated)?;
    assert!(
        !repo.git_stdout(["status", "--porcelain"])?.is_empty(),
        "the declaration rewrite left the worktree clean"
    );
    Ok(())
}


/// A rebinding and a content edit landing in the *same* commit at the same
/// address — the composed state, and the one every other rebinding fixture
/// misses by pairing its rebinding with untouched content.
///
/// `f0.txt`'s block is rewritten in the rotation commit, so that address
/// carries both facts at once: its declaration now records a token describing
/// some other file's block, and its own bytes changed. A render that shows
/// only the content hunk describes an ordinary edit, and the repair an
/// ordinary edit invites is a re-hash — which here would permanently bind the
/// why-prose to content it was never written about.
fn rebound_and_edited_repo(span: &str, n: usize) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    for i in 0..n {
        let tag = (b'A' + i as u8) as char;
        repo.write_file(
            &format!("f{i}.txt"),
            &format!("{tag}-1\n{tag}-2\n{tag}-3\n"),
        )?;
    }
    repo.commit_all("initial")?;
    for i in 0..n {
        repo.span_stdout(["add", span, &format!("f{i}.txt#L1-L3")])?;
    }
    repo.span_stdout(["why", span, "one block per file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rotate_address_column(&repo, span, n)?;
    repo.write_file("f0.txt", "A-1\nA-EDITED\nA-3\n")?;
    assert!(
        !repo
            .git_stdout(["diff", "--name-only", "--", "f0.txt"])?
            .is_empty(),
        "the content edit matched nothing, so no address carries both facts"
    );
    repo.commit_all("rebind every anchor and edit one of the blocks")?;
    Ok(repo)
}


/// Every anchor block form the `current` section renders, in order.
fn current_forms(repo: &TestRepo, span: &str) -> Result<Vec<BlockForm>> {
    let json = history_json(repo, span)?;
    Ok(json["current"]["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("no current anchors in {json:#}"))
        .iter()
        .map(|a| block_form(a["diff"].as_str().expect("diff string")))
        .collect())
}


/// The block form of one timeline anchor object. An anchor that carries
/// `content` instead of `diff` is a first-add, which is the timeline's
/// spelling of `new anchor`.
fn timeline_form(anchor: &Value) -> BlockForm {
    // The structured discriminator, not a scan of the patch text. `rebound
    // anchor` is a phrase that appears in this repository's own tracked
    // source, so a consumer — or an oracle — that recognises the form by
    // string-matching the patch body has a live false-positive class.
    if anchor.get("rebound").is_some() {
        return BlockForm::Rebound;
    }
    match anchor["diff"].as_str() {
        Some(diff) => block_form(diff),
        None => BlockForm::Created,
    }
}


/// Every anchor block form the newest timeline entry renders, in order.
///
/// **Projection:** discards `path`. A `Vec<BlockForm>` cannot tell one address
/// rendering two facts from two addresses rendering one each — use
/// [`newest_commit_blocks`] wherever that distinction is the point.
fn newest_commit_forms(repo: &TestRepo, span: &str) -> Result<Vec<BlockForm>> {
    Ok(newest_commit_blocks(repo, span)?
        .into_iter()
        .map(|(_, form)| form)
        .collect())
}


/// Every anchor block the newest timeline entry renders, as `(path, form)`.
///
/// Block identity in the timeline array is the *pair*, not `path` alone: one
/// address renders two objects whenever two independent facts are true of it
/// at once — a rebinding and a content edit in the same commit. A reader that
/// keeps only the forms can assert that both facts appear somewhere in the
/// entry; only this one can assert that they appear at the same address.
fn newest_commit_blocks(repo: &TestRepo, span: &str) -> Result<Vec<(String, BlockForm)>> {
    let json = history_json(repo, span)?;
    Ok(json["commits"][0]["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("no anchors on the newest commit in {json:#}"))
        .iter()
        .map(|a| {
            (
                a["path"].as_str().expect("path string").to_string(),
                timeline_form(a),
            )
        })
        .collect())
}


/// One entry of [`every_timeline_state`]: the state's label, the repository
/// standing in that state, the declared address to read, and the block forms
/// the newest commit entry must render for it.
type TimelineState = (&'static str, TestRepo, &'static str, Vec<BlockForm>);

/// One repository per shape a *timeline* anchor block can take, with the block
/// forms its newest commit entry must render.
///
/// The two render paths do not share a state space, which is why this exists
/// beside [`every_current_state`] instead of extending it. `Proposed` is
/// current-block-only — the resolver's move instruction is about the working
/// tree, and there is nothing to propose about a commit that already happened.
/// `Rebound` is timeline-only — a rebinding is a transition between two
/// committed declaration states. Enumerating one path's states and calling it
/// the enumeration is exactly how `Rebound` came to be hand-entered into the
/// oracle map after the fact.
///
/// The expected forms are written out per fixture rather than derived, so a
/// change in what a state renders shows up here as a diff rather than as a
/// sweep that quietly checks a different thing.
fn every_timeline_state() -> Result<Vec<TimelineState>> {
    let committed_drift = {
        let repo = drifted_repo("tdrift")?;
        repo.commit_all("edit the anchored block")?;
        repo
    };
    let committed_reanchor = {
        let repo = drifted_repo("tre")?;
        rewrite_declaration(&repo, "tre", "f.txt#L1-L3", "f.txt#L3-L5")?;
        repo.commit_all("re-anchor onto the drifted block")?;
        repo
    };
    let first_declaration = {
        let repo = TestRepo::new()?;
        repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tnew", "f.txt#L1-L3"])?;
        repo.span_stdout(["why", "tnew", "three greek letters"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        repo
    };
    // An anchor abandoned for an unrelated block in another file: nothing
    // pairs, so the commit renders two independent events rather than one
    // rename asserting an edit between texts that share nothing.
    let unrelated_move = {
        let repo = TestRepo::new()?;
        repo.write_file("f.txt", "AAA-1\nAAA-2\nAAA-3\n")?;
        repo.write_file("g.txt", "BBB-1\nBBB-2\nBBB-3\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tmv", "f.txt#L1-L3"])?;
        repo.span_stdout(["why", "tmv", "the first block"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        rewrite_declaration(&repo, "tmv", "f.txt#L1-L3", "g.txt#L1-L3")?;
        repo.commit_all("abandon the block for an unrelated one")?;
        repo
    };
    // The anchored file is deleted while the declaration still names it: the
    // new side has no bytes at all, which is the timeline's only producer of
    // `unavailable`. Without it that key would need an exemption in the field
    // sweep's reverse direction, and an exemption is how a key stops being
    // checked.
    let vanished_file = {
        let repo = drifted_repo("tgone")?;
        std::fs::remove_file(repo.path().join("f.txt"))?;
        repo.commit_all("delete the anchored file")?;
        repo
    };
    // The commit path's own past-EOF verdict, enumerated so the reference
    // implementation the worktree path was conformed to is itself under the
    // sweeps rather than being trusted because it was correct once.
    let truncated = {
        let repo = truncated_past_eof_repo("ttrunc")?;
        repo.commit_all("truncate below the declared range")?;
        repo
    };
    // Both states carry the null hash and an empty body, so the commit that
    // moves between them is invisible to every content comparison there is.
    let past_eof_then_deleted = {
        let repo = truncated_past_eof_repo("tboth")?;
        repo.commit_all("truncate below the declared range")?;
        repo.run_git(["rm", "f.txt"])?;
        repo.run_git(["commit", "-m", "delete the file outright"])?;
        repo
    };
    // The timeline's producer of `unavailable: "binary"`. Without it that
    // *value* has no producer on this array, and the field sweep only compares
    // key names — which is how a documented value shipped with no producer
    // anywhere in the tree.
    let binarized = {
        let repo = TestRepo::new()?;
        repo.write_file("f.bin", "alpha\nbeta\ngamma\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tbin", "f.bin"])?;
        repo.span_stdout(["why", "tbin", "the pinned file"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        repo.write_file_bytes("f.bin", b"BIN\x00\xff\xfe-two\n")?;
        repo.commit_all("replace the text with bytes")?;
        repo
    };
    Ok(vec![
        (
            "first declaration",
            first_declaration,
            "tnew",
            vec![BlockForm::Created],
        ),
        (
            "anchored file deleted",
            vanished_file,
            "tgone",
            vec![BlockForm::Modified],
        ),
        (
            "declared range truncated past its end",
            truncated,
            "ttrunc",
            vec![BlockForm::Modified],
        ),
        (
            "past-EOF range then the file deleted",
            past_eof_then_deleted,
            "tboth",
            vec![BlockForm::Modified],
        ),
        (
            "anchored text replaced by bytes",
            binarized,
            "tbin",
            vec![BlockForm::Modified],
        ),
        (
            "committed drift",
            committed_drift,
            "tdrift",
            vec![BlockForm::Modified],
        ),
        (
            "committed re-anchor at the floor",
            committed_reanchor,
            "tre",
            vec![BlockForm::Renamed {
                similarity: Some(66),
            }],
        ),
        (
            "committed abandonment for an unrelated block",
            unrelated_move,
            "tmv",
            vec![BlockForm::Deleted, BlockForm::Created],
        ),
        (
            "committed rebinding",
            rebinding_repo("tro", 3)?,
            "tro",
            vec![BlockForm::Rebound; 3],
        ),
        (
            "committed rebinding with an edit",
            rebound_and_edited_repo("trbe", 3)?,
            "trbe",
            vec![
                BlockForm::Rebound,
                BlockForm::Rebound,
                BlockForm::Rebound,
                BlockForm::Modified,
            ],
        ),
    ])
}


/// One repository per shape a `current` anchor can take, labelled. Every
/// property asserted over the current block is asserted over this whole set,
/// so a state that only one fixture reaches cannot drift unobserved.
fn every_current_state() -> Result<Vec<(&'static str, TestRepo, &'static str)>> {
    Ok(vec![
        ("resolver relocation", swap_repo()?, "swap"),
        ("declaration swap", declaration_swap_repo("dswap")?, "dswap"),
        (
            "re-anchor over relocation",
            reanchor_over_relocation_repo("both")?,
            "both",
        ),
        ("in-place drift", drifted_repo("ch")?, "ch"),
        // The layer axis. `current` covers every layer `drift` reports, so a
        // set whose every fixture drifts in the working tree certifies the
        // `sources` vocabulary against one third of it — which is how the
        // block came to describe a committed edit as an uncommitted one.
        (
            "committed drift, never re-anchored",
            committed_drift_repo("cd")?,
            "cd",
        ),
        ("staged drift", staged_drift_repo("sd")?, "sd"),
        (
            "drift at two layers at once",
            composed_drift_repo("cx")?,
            "cx",
        ),
        ("cross-file swap", cross_file_swap_repo("xswap")?, "xswap"),
        ("abandoned block", abandoned_block_repo("re2")?, "re2"),
        ("never recorded", never_recorded_repo("ff")?, "ff"),
        ("twin tokens", twin_token_repo("twin")?, "twin"),
        (
            "drifted re-anchor",
            {
                let repo = drifted_repo("re")?;
                rewrite_declaration(&repo, "re", "f.txt#L1-L3", "f.txt#L3-L5")?;
                repo
            },
            "re",
        ),
        (
            "re-anchor with unrecoverable recorded token",
            unrecoverable_reanchor_repo("ur")?,
            "ur",
        ),
        ("binary re-anchor", binary_reanchor_repo("bin")?, "bin"),
        // The three states that render with a null hash, one fixture each.
        // Two of the three used to be indistinguishable from a third state in
        // every field a consumer can read, which is why they are enumerated
        // here rather than living only in the test that compares them.
        (
            "re-anchor past end of file",
            reanchored_past_eof_repo("pe2")?,
            "pe2",
        ),
        (
            "truncated below the declared range",
            truncated_past_eof_repo("tp2")?,
            "tp2",
        ),
        (
            "anchored file absent",
            vanished_worktree_file_repo("na2")?,
            "na2",
        ),
        (
            "empty recorded extent",
            empty_extent_reanchor_repo("nz2")?,
            "nz2",
        ),
        // The `.gitattributes` axis. Not one fixture but four: the states a
        // filter puts an anchor into are keyed on whether the driver produces
        // content, not on whether one is configured, so a set with a single
        // filter fixture certifies whichever state its author happened to
        // build. All three filter states appear, and the working driver
        // appears twice — in range and past the end of what it produces.
        (
            "filter named but never configured",
            unconfigured_filter_repo("uf2")?,
            "uf2",
        ),
        (
            "filter configured with a missing process driver",
            missing_driver_filter_repo("md2")?,
            "md2",
        ),
        (
            "filter configured with a missing clean driver",
            missing_clean_driver_filter_repo("mc2")?,
            "mc2",
        ),
        (
            "working filter transforms the content",
            working_filter_repo("wf2")?,
            "wf2",
        ),
        (
            "working filter shortens past the declared range",
            working_filter_past_eof_repo("wp2")?,
            "wp2",
        ),
    ])
}


/// A re-anchor whose recorded bytes cannot be read anywhere — the product of
/// two states already enumerated above ("never recorded" and "drifted
/// re-anchor"), and the one where a similarity number has nothing to measure.
///
/// The declaration is committed in the same commit that drifts the block it
/// names, so no state the walk renders ever hashes to the recorded token; then
/// the worktree moves the declared address, making the current state a
/// re-anchor. Both sides of the comparison a rename would assert are therefore
/// unavailable on the recorded side — and `text()` answers `""` for an
/// unavailable body, which is how a confident `similarity index 0%` came to
/// sit directly above the line saying the side could not be read.
fn unrecoverable_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nCCC-1\nCCC-2\nCCC-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "the first block"])?;
    // The declaration and the drift land together, so the recorded token names
    // bytes that no rendered state in this walk ever held.
    repo.write_file(
        "f.txt",
        "ZZZ-1\nZZZ-2\nZZZ-3\nmiddle\nCCC-1\nCCC-2\nCCC-3\n",
    )?;
    repo.commit_all("declare and drift in one commit")?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L5-L7")?;
    assert!(
        !repo.git_stdout(["status", "--porcelain"])?.is_empty(),
        "the declaration rewrite left the worktree clean"
    );
    Ok(repo)
}


/// A whole-file pin on a non-UTF-8 file, committed, then re-anchored in the
/// worktree to a *different* non-UTF-8 file. The recorded token is the binary
/// fingerprint of `a.bin`, and the same render's declare entry prints that
/// token as first-add content — so nothing about this state is lost, and no
/// side of it may be decoded as prose.
fn binary_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file_bytes("a.bin", b"BINA\x00\xff\xfe-one\n")?;
    repo.write_file_bytes("b.bin", b"BINB\x00\xfe\xff-two\n")?;
    repo.commit_all("binaries")?;
    repo.span_stdout(["add", span, "a.bin"])?;
    repo.span_stdout(["why", span, "the binary block"])?;
    repo.commit_all("declare the binary pin")?;
    rewrite_declaration(&repo, span, "a.bin", "b.bin")?;
    Ok(repo)
}


/// The span-diff body of `render` for `.span/<span>`: everything from the
/// first hunk header to the end of that block, which is the part git itself
/// can be asked to produce independently.
fn span_diff_body<'a>(render: &'a str, span: &str) -> &'a str {
    let block = diff_block(render, &format!("a/.span/{span} "));
    let at = block
        .find("@@ ")
        .unwrap_or_else(|| panic!("no hunk header in:\n{block}"));
    &block[at..]
}


/// git's own rendering of the same blob pair, with the header lines dropped.
fn git_diff_body(repo: &TestRepo, span: &str) -> Result<String> {
    let out = repo.git_stdout([
        "-c",
        "core.pager=cat",
        "diff",
        "--no-color",
        "--unified=3",
        "HEAD~1",
        "HEAD",
        "--",
        &format!(".span/{span}"),
    ])?;
    let at = out
        .find("@@ ")
        .unwrap_or_else(|| panic!("no hunk header in git's own diff:\n{out}"));
    Ok(format!("{}\n", &out[at..]))
}


/// The live bytes at `address` (`path#Lstart-Lend` or a bare path), read from
/// the worktree — an oracle for `content` that shares no code with the
/// renderer. `None` when the file or the range is absent.
fn read_address(repo: &TestRepo, address: &str) -> Option<String> {
    let (path, range) = match address.split_once("#L") {
        Some((p, r)) => (p, Some(r)),
        None => (address, None),
    };
    let text = std::fs::read_to_string(repo.path().join(path)).ok()?;
    let Some(range) = range else {
        return Some(text);
    };
    let (start, end) = range.split_once("-L")?;
    let (start, end): (usize, usize) = (start.parse().ok()?, end.parse().ok()?);
    let mut out = text
        .lines()
        .skip(start - 1)
        .take(end + 1 - start)
        .collect::<Vec<_>>()
        .join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// Declaration diffs speak real git
// ---------------------------------------------------------------------------

/// `git diff <from> <to> -- <path>`, with index hashes normalized to 7 hex so
/// abbreviation-length differences do not defeat the comparison.
fn git_diff(repo: &TestRepo, from: &str, to: &str, path: &str) -> Result<String> {
    let raw = repo.git_stdout(["diff", "--no-color", from, to, "--", path])?;
    Ok(normalize_index_lines(&raw))
}


fn normalize_index_lines(patch: &str) -> String {
    patch
        .lines()
        .map(|line| match line.strip_prefix("index ") {
            Some(rest) => {
                let (hashes, suffix) = match rest.split_once(' ') {
                    Some((h, s)) => (h, format!(" {s}")),
                    None => (rest, String::new()),
                };
                match hashes.split_once("..") {
                    Some((a, b)) => format!(
                        "index {}..{}{suffix}",
                        &a[..a.len().min(7)],
                        &b[..b.len().min(7)]
                    ),
                    None => line.to_string(),
                }
            }
            None => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

// ---------------------------------------------------------------------------
// Invariants that hold across the whole scenario
// ---------------------------------------------------------------------------

/// Every rendered `diff --git` block in `patch`, split on the header line.
fn diff_blocks(patch: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    for line in patch.lines() {
        if line.starts_with("diff --git ") {
            blocks.push(String::new());
        }
        if let Some(current) = blocks.last_mut() {
            current.push_str(line);
            current.push('\n');
        }
    }
    blocks
}


fn commit_span_declaration_with_raw_author_offset(
    repo: &TestRepo,
    span: &str,
    offset: &str,
    summary: &str,
) -> Result<String> {
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "records the raw author offset"])?;
    repo.run_git(["add", ".span"])?;
    commit_staged_with_raw_author_offset(repo, offset, summary)
}


/// Commit whatever is staged through raw plumbing so the author line carries
/// `offset` verbatim — including spellings `git commit` itself would reject.
fn commit_staged_with_raw_author_offset(
    repo: &TestRepo,
    offset: &str,
    summary: &str,
) -> Result<String> {
    let tree = repo.git_stdout(["write-tree"])?;
    let parent = repo.head_sha()?;
    let raw = format!(
        "tree {tree}\nparent {parent}\nauthor Test User <test@example.com> 0 {offset}\ncommitter Test User <test@example.com> 0 +0000\n\n{summary}\n"
    );
    repo.write_file("raw-commit", &raw)?;
    let oid = repo.git_stdout([
        "hash-object",
        "--literally",
        "-t",
        "commit",
        "-w",
        "raw-commit",
    ])?;
    repo.run_git(["update-ref", "refs/heads/main", &oid, &parent])?;
    std::fs::remove_file(repo.path().join("raw-commit"))?;
    repo.run_git(["reset", "--mixed", "HEAD"])?;
    Ok(oid)
}


/// Seed a span on `f.txt#L1-L3`, then commit a change to `f.txt` through raw
/// plumbing with an out-of-range author offset. `edit` decides whether that
/// hostile commit touches the anchored range (renders an entry) or only
/// appends below it (walked, but renders nothing).
fn hostile_author_repo(span: &str, edit: &str) -> Result<(TestRepo, String)> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare span"])?;
    repo.write_file("f.txt", edit)?;
    repo.run_git(["add", "f.txt"])?;
    let hostile =
        commit_staged_with_raw_author_offset(&repo, "+214748364799", "hostile author line")?;
    Ok((repo, hostile))
}

// ---------------------------------------------------------------------------
// Past end of file: one policy across both read paths
// ---------------------------------------------------------------------------

/// An anchored file truncated *below* its declared range, with the file itself
/// still on disk — the declared L3-L5 now runs off the end of a one-line file.
///
/// This is one of the two routes to a past-EOF live read, and the one where the
/// resolver reports the anchor deleted and binds no live location at all: the
/// reason has to be recovered from the declared address, because "the resolver
/// found nothing" and "there is no such file" are different facts and only the
/// second is `absent`.
fn truncated_past_eof_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nalpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L3-L5"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.write_file("f.txt", "one\n")?;
    Ok(repo)
}


/// The other route: a hand-edited re-anchor onto a range the file does not
/// have. `git span add` fails closed on such a range; editing `.span` by hand —
/// the ordinary way a reconcile loop leaves a declaration — does not, and here
/// the resolver *does* bind a location, so the past-EOF classification has to
/// happen inside the read rather than around it.
fn reanchored_past_eof_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L8-L10")?;
    Ok(repo)
}


/// The anchored file deleted in the working tree, declaration untouched — the
/// state whose name `absent` actually is.
fn vanished_worktree_file_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    std::fs::remove_file(repo.path().join("f.txt"))?;
    Ok(repo)
}


/// A *whole-file* anchor whose file is emptied in the working tree — the state
/// the range boundary must not swallow.
fn emptied_whole_file_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt"])?;
    repo.span_stdout(["why", span, "the whole file, however long it is"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.write_file("f.txt", "")?;
    Ok(repo)
}


/// A re-anchor onto a genuinely empty file — the *honest* twin of the past-EOF
/// render, and the reason the dishonest one was plausible.
///
/// `git span add` on an empty file records `rk64:0000000000000000`, so this
/// anchor's content, its recorded token, and both sides of its `index` line are
/// all legitimately null. Everything the fabricated past-EOF block used to
/// print, this block prints truthfully.
fn empty_extent_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("e.txt", "")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    rewrite_declaration(&repo, span, "f.txt#L1-L3", "e.txt")?;
    Ok(repo)
}


/// The declared range's live state, as the two structured fields a consumer
/// reads: `(content, unavailable)`. `path` and `diff` are deliberately excluded
/// — `path` is the join key every object differs in trivially, and `diff` is
/// the patch string whose parsing `--format json` exists to spare consumers.
fn payload_fields(anchor: &Value) -> (Option<&str>, Option<&str>) {
    (
        anchor
            .get("content")
            .map(|c| c.as_str().expect("content string")),
        anchor
            .get("unavailable")
            .map(|u| u.as_str().expect("unavailable string")),
    )
}


/// A file anchored at `L{start}-L{end}` and then truncated to exactly `depth`
/// lines, the declaration committed first so the truncation reads as drift.
///
/// The original file is exactly `end` lines long, so the declared range runs to
/// its last line and every `depth < end` is a real change to the anchored
/// extent. This is [`truncated_past_eof_repo`] with its two fixed constants —
/// the declared start and the truncation depth — lifted into parameters, which
/// is the whole point: the shipped fixture truncated to one depth, one line
/// inside the correct zone, and the boundary sat at a single untested point.
fn truncated_to_depth_repo(span: &str, start: u32, end: u32, depth: u32) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    let full: String = (1..=end).map(|i| format!("line{i}\n")).collect();
    repo.write_file("f.txt", &full)?;
    repo.commit_all("initial")?;
    let address = format!("f.txt#L{start}-L{end}");
    repo.span_stdout(["add", span, address.as_str()])?;
    repo.span_stdout(["why", span, "a declared range with a floor under it"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    let truncated: String = (1..=depth).map(|i| format!("line{i}\n")).collect();
    repo.write_file("f.txt", &truncated)?;
    Ok(repo)
}


/// The declared address as `current[]` and `commits[]` key it.
fn sole_anchor_in<'a>(container: &'a Value, address: &str, whose: &str) -> &'a Value {
    container["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("{whose}: no anchors array in {container:#}"))
        .iter()
        .find(|a| a["path"] == address)
        .unwrap_or_else(|| {
            panic!("{whose}: no object at {address}; the fixture stopped reaching this state:\n{container:#}")
        })
}


/// `git span drift`'s verdict for one anchor, as the resolver computed it.
fn drift_status(repo: &TestRepo, span: &str) -> Result<String> {
    // Drift exits 1 by design, so the status is read off stdout rather than
    // gated on success.
    let out = repo.run_span(["drift", span, "--format", "json"])?;
    let json: Value = serde_json::from_slice(&out.stdout)?;
    let findings = json["findings"].as_array().expect("findings array");
    anyhow::ensure!(findings.len() == 1, "expected one finding; got: {json:#}");
    Ok(findings[0]["status"]["code"]
        .as_str()
        .expect("status code string")
        .to_string())
}

// ---------------------------------------------------------------------------
// The `.gitattributes` axis.
//
// Until this section existed no fixture in the suite carried a
// `.gitattributes` file at all, so every state a filter puts an anchor into
// was outside every oracle's aperture. Two distinct defects lived there,
// sharing only the trigger surface:
//
//   * a filter that produces **no** content made the live read fail, and the
//     failure was reported as `absent` — "no such file at this commit" about a
//     file with five readable lines — under a full deletion hunk for lines
//     `git diff` said were untouched;
//   * a filter that **succeeds** made the live read split in two: the header's
//     hash came from the filtered bytes and `content` from the raw ones, so
//     the two halves of one object described different files.
//
// The discriminator between them is *not* whether a filter is configured. It
// is whether the driver produces content. States A and B below produce none
// and are one fact; state C produces different content and is the other.
// ---------------------------------------------------------------------------

/// Whether `.gitattributes` assigns a content filter to an anchor address's
/// path, asked of git rather than inferred from the file — `git check-attr`
/// reads attributes only and never spawns the driver, so it answers even in
/// the fixtures where every other git command fails.
fn path_is_filtered(repo: &TestRepo, address: &str) -> Result<bool> {
    let path = address.split_once("#L").map_or(address, |(p, _)| p);
    let out = repo.git_stdout(["check-attr", "filter", "--", path])?;
    Ok(!out.ends_with("unspecified"))
}


/// A `filter.<name>.process` command line for the test-helper driver, quoted
/// for the `sh -c` the resolver spawns it through.
fn filter_process_command(transform: &str) -> String {
    format!(
        "'{}' filter-process {transform}",
        env!("CARGO_BIN_EXE_git-span-test-helper")
    )
}


/// A five-line file, an anchor declared and committed over it, and *then* a
/// `.gitattributes` naming a filter for it. The order is the point: the anchor
/// is recorded against the real bytes, and the file is never touched again, so
/// `git show HEAD~1:f.txt | cmp - f.txt` is silent and any deletion the render
/// asserts is the render's own invention.
///
/// `process` configures `filter.<name>.process` *after* the commit, so git
/// itself never ran the driver over the blob it recorded — the committed
/// content is the user's five lines whatever the driver would say.
fn filter_attribute_repo(
    span: &str,
    address: &str,
    filter: &str,
    process: Option<&str>,
) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("the file, unfiltered")?;
    repo.span_stdout(["add", span, address])?;
    repo.span_stdout(["why", span, "anchored before any filter existed"])?;
    repo.write_file(".gitattributes", &format!("*.txt filter={filter}\n"))?;
    repo.commit_all("name a filter for the file")?;
    if let Some(transform) = process {
        repo.run_git([
            "config",
            &format!("filter.{filter}.process"),
            &filter_process_command(transform),
        ])?;
    }
    drop_stat_cache(&repo, "f.txt")?;
    Ok(repo)
}


/// Discard the index's cached stat for `path` without changing a byte of it,
/// by replacing the file with a copy of itself. The new inode and ctime cannot
/// match what the index recorded, so git has to read the file to decide whether
/// it changed — and reading a file with a `filter` attribute is the only
/// circumstance under which git consults the driver at all.
///
/// Without this the fixtures assert a fact about the clock. Git trusts an index
/// entry whose cached stat matches the file and whose mtime is older than the
/// index's own, and on this filesystem that comparison lands on whole seconds:
/// build the whole fixture inside one tick and every entry is racily clean and
/// re-read; let the suite's load push construction across a tick boundary and
/// none of them are, so git answers "clean" from cache having never opened the
/// file. Both answers are true about git. Only one of them is about the filter.
///
/// The content is untouched, so `git show HEAD:f.txt | cmp - f.txt` stays
/// silent and every claim these fixtures make about the anchored lines being
/// on disk still holds. git-span is unaffected either way: it filters through
/// the resolver, which reads the worktree directly and never consults the
/// index's stat cache.
fn drop_stat_cache(repo: &TestRepo, path: &str) -> Result<()> {
    let file = repo.path().join(path);
    let copy = repo.path().join(format!("{path}.stat-copy"));
    std::fs::copy(&file, &copy)?;
    std::fs::rename(&copy, &file)?;
    Ok(())
}


/// **State A** — `.gitattributes` names a filter and nothing configures it.
/// The state of any clone whose filter the user has not installed.
fn unconfigured_filter_repo(span: &str) -> Result<TestRepo> {
    filter_attribute_repo(span, "f.txt#L4-L5", "missingtool", None)
}


/// **State B** — the filter *is* configured and its driver cannot run: the
/// shape of a tool that was installed when the config was written and is not
/// installed now. Configured-versus-unconfigured is therefore not a safe
/// discriminator, and a fix keyed on it would pass this one.
///
/// `filter.<name>.process` is the key the resolver reads, and pointing it at a
/// missing binary is a state **git itself refuses**: `git status` exits 128
/// with `fatal: the remote end hung up unexpectedly`. That is the comparison
/// worth keeping — one of the two commands declines to describe the state at
/// all, and the other used to describe it as a deletion.
///
/// Git only refuses when it actually reads the file, which is why
/// [`filter_attribute_repo`] drops the index's cached stat: with the stat
/// trusted, git answers "clean" from cache without ever spawning the driver,
/// and the refusal this fixture exists to demonstrate does not happen.
fn missing_driver_filter_repo(span: &str) -> Result<TestRepo> {
    let repo = filter_attribute_repo(span, "f.txt#L4-L5", "gitcrypt", None)?;
    repo.run_git([
        "config",
        "filter.gitcrypt.process",
        "/nonexistent/git-crypt-filter --process",
    ])?;
    Ok(repo)
}


/// **State B as the tools in the wild actually spell it** — git-crypt and
/// nbstripout configure `filter.<name>.clean` and `.smudge`, not `.process`.
/// The resolver reads only `.process`, so a clone missing one of *those*
/// drivers reaches the same read failure state A does while leaving `git
/// status` clean and exiting 0.
///
/// It is enumerated separately from state A because the two are different
/// repository configurations that a fix could plausibly treat differently, and
/// because the evaluation that filed this defect built its "configured" variant
/// this way — so this fixture is the one that pins the claim that configuration
/// is not the discriminator.
fn missing_clean_driver_filter_repo(span: &str) -> Result<TestRepo> {
    let repo = filter_attribute_repo(span, "f.txt#L4-L5", "gitcrypt", None)?;
    repo.run_git([
        "config",
        "filter.gitcrypt.clean",
        "/nonexistent/git-crypt clean",
    ])?;
    repo.run_git([
        "config",
        "filter.gitcrypt.smudge",
        "/nonexistent/git-crypt smudge",
    ])?;
    Ok(repo)
}


/// **State C, in range** — the driver runs, exits 0, and returns a three-line
/// pointer instead of the file. Content is available; it is simply not the
/// content on disk. Nothing failed, so no `unavailable` reason has a producer
/// here — which is exactly why a fourth `unavailable` value cannot repair this
/// state.
fn working_filter_repo(span: &str) -> Result<TestRepo> {
    filter_attribute_repo(span, "f.txt#L1-L2", "ptr", Some("pointer"))
}


/// **State C, past the end** — the same working driver, with the anchor
/// declared over lines the *filtered* content does not reach. `git span add`
/// refuses this state on the declaration side (`end=5 exceeds file line count
/// (3)`); the render path must not be more permissive than the path that
/// declares it.
fn working_filter_past_eof_repo(span: &str) -> Result<TestRepo> {
    filter_attribute_repo(span, "f.txt#L4-L5", "ptr", Some("pointer"))
}


/// The `rk64:` token `git span add` records for `text`, obtained by declaring
/// it in a throwaway repository.
///
/// This is the only hash oracle outside `history`'s own hashing code, and it
/// is the one that matters: it answers "what token would a re-anchor write
/// here", which is precisely what the `index` line claims to name. Fingerprints
/// canonicalize to `lines[start..=end].join("\n")`, so a body lifted out of its
/// file hashes at line 1 exactly as it did at its real first line.
fn token_recorded_for(text: &str) -> Result<String> {
    let repo = TestRepo::new()?;
    repo.write_file("probe.txt", text)?;
    repo.commit_all("probe")?;
    let address = format!("probe.txt#L1-L{}", text.lines().count());
    repo.span_stdout(["add", "probe", &address])?;
    declared_token(&repo, "probe", None, &address)
}


/// Reconstruct a block's new side from its hunks — context and added lines, in
/// order. The `content` field carries the same bytes for the block forms that
/// have one; this covers the forms that put them in a body instead.
fn new_side_body(diff: &str) -> String {
    let mut out = String::new();
    for line in diff.lines().skip_while(|l| !l.starts_with("@@ ")) {
        let kept = match line.chars().next() {
            Some(' ') | Some('+') if !line.starts_with("+++") => &line[1..],
            _ => continue,
        };
        out.push_str(kept);
        out.push('\n');
    }
    out
}

// ---------------------------------------------------------------------------
// A broken downstream pipe (`git span history … | head`)
// ---------------------------------------------------------------------------

/// A history whose rendered output comfortably exceeds a pipe's 64KiB
/// capacity: every commit rewrites the whole anchored range, so each timeline
/// entry carries hundreds of `-`/`+` lines.
fn oversized_history_repo(span: &str) -> Result<TestRepo> {
    let body = |rev: usize| -> String {
        (0..250)
            .map(|i| format!("revision {rev:02} line {i:03} {}\n", "x".repeat(40)))
            .collect()
    };
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", &body(0))?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L250"])?;
    repo.span_stdout(["why", span, "bulk content, sized past a pipe buffer"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    for rev in 1..=8 {
        repo.commit_file("f.txt", &body(rev), &format!("rewrite {rev}"))?;
    }
    Ok(repo)
}
