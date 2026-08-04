//! Topology: which commits are walked, replacement/graft rejection, `--limit` scoping, not-found handling.

use super::*;


/// A merge that *unions* the declaration: both branches added an anchor, and
/// the merge keeps both.
///
/// The declaration is the one file whose merge result is neither side's, so the
/// merge entry is where a renderer pairing on the walk's predecessor invents an
/// anchor deletion — the entry above it saw only one branch's anchors, so the
/// other branch's look like they left. `git span drift` disagrees on the spot:
/// it reports the merged declaration clean at HEAD, so the timeline would be
/// announcing a deletion the resolver can see never happened.
#[test]
fn a_merge_that_unions_the_declaration_asserts_no_anchor_deletion() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nl5\nl6\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", "un", "f.txt#L1-L1"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    // The declaration is merged by git-span's own driver — the union rule is
    // the driver's, not git's, and without it this fixture would only prove
    // that a text merge conflicts.
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
    repo.run_git([
        "config",
        "merge.span.name",
        "git-span structural span merge",
    ])?;
    repo.run_git([
        "config",
        "merge.span.driver",
        &format!(
            "{} merge-driver %O %A %B %L",
            env!("CARGO_BIN_EXE_git-span")
        ),
    ])?;
    repo.commit_all("register the span merge driver")?;

    repo.run_git(["checkout", "-b", "side"])?;
    repo.span_stdout(["add", "un", "f.txt#L4-L5"])?;
    repo.commit_all("side adds an anchor")?;
    repo.run_git(["checkout", "-"])?;
    repo.span_stdout(["add", "un", "f.txt#L2-L3"])?;
    repo.commit_all("main adds an anchor")?;

    // The span merge driver resolves the declaration to the union of both
    // sides; that union is the fixture's whole point, so it is asserted rather
    // than assumed.
    repo.run_git(["merge", "--no-ff", "side", "-m", "merge side"])?;
    let listed = repo.span_stdout(["list", "un", "--oneline"])?;
    for addr in ["f.txt#L1-L1", "f.txt#L2-L3", "f.txt#L4-L5"] {
        assert!(
            listed.contains(addr),
            "fixture assumption: the merged declaration keeps {addr}; got:\n{listed}"
        );
    }
    let drift = repo.run_span(["drift"])?;
    assert!(
        drift.status.success(),
        "fixture assumption: the merged declaration is clean at HEAD; got:\n{}",
        String::from_utf8_lossy(&drift.stdout)
    );

    let json = history_json(&repo, "un")?;
    let merge = json["commits"]
        .as_array()
        .expect("commits array")
        .iter()
        .find(|e| e["summary"] == "merge side")
        .expect("the merge commit is missing from the timeline");
    // The anchor the merge genuinely brought onto the mainline is the side
    // branch's, and it arrives as a first-add — one object, carrying `content`.
    // The two anchors already on the first parent are untouched by the merge
    // and so produce nothing, which is the assertion: the entry is exactly as
    // long as the work the merge did.
    let anchors = merge["anchors"].as_array().expect("anchors array");
    assert_eq!(
        anchors.len(),
        1,
        "the merge added one anchor and removed none; got:\n{merge:#}"
    );
    assert_eq!(anchors[0]["path"], "f.txt#L4-L5");
    assert_eq!(anchors[0]["content"], "l4\nl5\n");

    // Nothing anywhere in this history is a deletion — no commit removed an
    // anchor — so the marker must not appear on either surface.
    let text = history_text(&repo, "un")?;
    assert!(
        !text.contains("deleted anchor"),
        "no commit in this history removed an anchor; a deletion is invented by \
         the pairing, and `git span drift` calls the merged declaration clean:\n{text}"
    );
    assert!(
        text.contains("new anchor") && text.contains("f.txt#L4-L5"),
        "the merge's own contribution still has to be rendered:\n{text}"
    );
    Ok(())
}


/// A merge that moved the mainline at a seed path is a commit like any other,
/// and the timeline says so.
///
/// It used to be skipped by an explicit `--no-merges` clause. The resolver never
/// agreed: `git span drift` attributes drift to a merge without hesitation, so a
/// span whose content arrived through one had a `drift` finding pointing at a
/// commit `history` refused to print. The qualifying test that follows the skip
/// compares each seed path's blob against `parent_ids.first()`, which is exactly
/// the mainline question, so removing the clause needed no replacement gate.
#[test]
fn a_merge_that_moved_the_mainline_at_a_seed_path_is_rendered() -> Result<()> {
    let repo = merge_diamond_repo("mg")?;
    let json = history_json(&repo, "mg")?;
    let merge = json["commits"]
        .as_array()
        .expect("commits array")
        .iter()
        .find(|e| e["summary"] == "merge side")
        .expect("the merge commit is missing from the timeline");
    // Merged-in content is what the merge contributed over its first parent, so
    // that is what the entry shows — and nothing else.
    let diff = merge["anchors"][0]["diff"].as_str().expect("merge diff");
    assert!(
        diff.contains("\n-l2\n") && diff.contains("\n+SIDE2\n"),
        "the merge's first-parent contribution is the side branch's edit:\n{diff}"
    );
    assert!(
        !diff.contains("MAIN5\n") || !diff.contains("\n-MAIN5"),
        "`MAIN5` came from the first parent and is unchanged by the merge:\n{diff}"
    );
    Ok(())
}


#[test]
fn history_follows_first_parent_and_ours_merges_leave_no_side_branch_residue() -> Result<()> {
    let repo = ours_merge_repo("ours")?;
    let json = history_json(&repo, "ours")?;
    let summaries: Vec<_> = json["commits"]
        .as_array()
        .expect("commits array")
        .iter()
        .map(|entry| entry["summary"].as_str().expect("summary"))
        .collect();
    assert!(
        summaries.contains(&"mainline edit"),
        "the first-parent edit that supplies HEAD must be present: {json:#}"
    );
    assert!(
        !summaries.contains(&"discarded side edit") && !summaries.contains(&"ours merge"),
        "a side-only commit and an -s ours merge with no first-parent change must not render: {json:#}"
    );
    let main = commit_with(&json, "mainline edit");
    assert!(
        main["anchors"][0]["diff"]
            .as_str()
            .expect("mainline diff")
            .contains("+MAIN"),
        "the visible entry must describe the bytes at HEAD: {main:#}"
    );
    // `drift`'s human renderer deliberately describes the classification and
    // address, not the anchored bytes. Prove the bytes from Git, then use the
    // machine contract to prove drift attributed that exact committed layer.
    // This makes the fixture reject both ways the discarded side can leak:
    // choosing `SIDE` for HEAD, or reporting the right status for the wrong
    // layer.
    assert_eq!(
        repo.git_stdout(["show", "HEAD:f.txt"])?,
        "one\nMAIN\nthree",
        "the ours merge must preserve the first-parent/mainline blob at HEAD"
    );
    let drift = repo.run_span(["drift", "ours", "--format=json"])?;
    assert!(
        drift.status.code() == Some(1),
        "the declaration predates the mainline edit, so drift must report that HEAD drift: stdout={} stderr={}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );
    let drift_json: Value = serde_json::from_slice(&drift.stdout)?;
    assert!(
        drift_json["findings"]
            .as_array()
            .is_some_and(|findings| findings.len() == 1)
            && drift_json["findings"][0]["status"]["code"] == "CHANGED"
            && drift_json["findings"][0]["source"] == "HEAD",
        "drift must resolve the mainline blob as committed HEAD drift, never the discarded side: {drift_json:#}"
    );
    assert_no_fabricated_lines(&repo, "ours")
}


#[test]
fn history_and_drift_reject_git_replacement_topology_before_output() -> Result<()> {
    let repo = committed_drift_repo("replace")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    repo.run_git(["replace", &head, &parent])?;

    let effective = repo.git_stdout(["rev-list", "--parents", "-n", "1", "HEAD"])?;
    let raw = repo.git_stdout([
        "--no-replace-objects",
        "rev-list",
        "--parents",
        "-n",
        "1",
        "HEAD",
    ])?;
    assert_ne!(
        effective, raw,
        "fixture precondition: Git replacement refs must change the effective parent graph"
    );

    let history = repo.run_span(["history", "replace", "--format=json"])?;
    let drift = repo.run_span(["drift", "--format=json"])?;
    for (name, out) in [("history", history), ("drift", drift)] {
        assert!(
            !out.status.success() && out.stdout.is_empty(),
            "{name} must fail closed without rendering raw-topology output; stdout={} stderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("replacement topology is unsupported"),
            "{name} must explain the shared topology boundary: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("refs/replace/")
                && String::from_utf8_lossy(&out.stderr).contains("GIT_NO_REPLACE_OBJECTS=1")
                && String::from_utf8_lossy(&out.stderr).contains("core.useReplaceRefs=false"),
            "{name} must identify the default ref and all three valid recovery routes: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(())
}


#[test]
fn replacement_controls_and_head_reachability_define_the_shared_boundary() -> Result<()> {
    let repo = committed_drift_repo("replace-controls")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    repo.run_git(["replace", &head, &parent])?;

    // Git's own off-switch must disable the boundary as well as replacement
    // processing. History succeeds, while drift retains its ordinary drift
    // exit status and emits findings rather than a topology error.
    let history = repo.run_span_with_env(
        ["history", "replace-controls", "--format=json"],
        "GIT_NO_REPLACE_OBJECTS",
        "1",
    )?;
    assert!(
        history.status.success() && !history.stdout.is_empty(),
        "disabled replacements must leave history available: stdout={} stderr={}",
        String::from_utf8_lossy(&history.stdout),
        String::from_utf8_lossy(&history.stderr)
    );
    let drift =
        repo.run_span_with_env(["drift", "--format=json"], "GIT_NO_REPLACE_OBJECTS", "1")?;
    assert!(
        drift.status.code() == Some(1)
            && !drift.stdout.is_empty()
            && !String::from_utf8_lossy(&drift.stderr).contains("replacement topology"),
        "disabled replacements must preserve drift's normal finding: stdout={} stderr={}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );

    repo.run_git(["replace", "-d", &head])?;
    let dangling =
        repo.git_stdout(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "dangling"])?;
    repo.run_git(["replace", &dangling, &parent])?;
    let history = repo.run_span(["history", "replace-controls", "--format=json"])?;
    assert!(
        history.status.success(),
        "a replacement outside HEAD ancestry cannot block history: {}",
        String::from_utf8_lossy(&history.stderr)
    );
    let drift = repo.run_span(["drift", "--format=json"])?;
    assert!(
        drift.status.code() == Some(1)
            && !String::from_utf8_lossy(&drift.stderr).contains("replacement topology"),
        "a replacement outside HEAD ancestry cannot block drift: stdout={} stderr={}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );
    Ok(())
}


#[test]
fn custom_replacement_namespace_rejects_history_and_drift_before_effects() -> Result<()> {
    let repo = committed_drift_repo("custom-replace")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    let configured_namespace = "refs/custom-replace";
    let normalized_namespace = "refs/custom-replace/";
    let replacement_ref = format!("{normalized_namespace}{head}");
    repo.run_git(["update-ref", &replacement_ref, &parent])?;

    let effective = repo.run_git_with_env(
        ["rev-list", "--parents", "-n", "1", "HEAD"],
        &[("GIT_REPLACE_REF_BASE", configured_namespace)],
    )?;
    let raw = repo.run_git_with_env(
        [
            "--no-replace-objects",
            "rev-list",
            "--parents",
            "-n",
            "1",
            "HEAD",
        ],
        &[("GIT_REPLACE_REF_BASE", configured_namespace)],
    )?;
    assert_ne!(
        effective.stdout, raw.stdout,
        "fixture must activate the custom namespace"
    );

    let declaration = repo.path().join(".span/custom-replace");
    let before = std::fs::read(&declaration)?;
    for (name, args) in [
        (
            "history",
            vec!["history", "custom-replace", "--format=json"],
        ),
        ("drift", vec!["drift", "--format=json"]),
        ("drift --fix", vec!["drift", "--fix"]),
    ] {
        let out =
            repo.run_span_with_envs(args, &[("GIT_REPLACE_REF_BASE", configured_namespace)])?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success()
                && out.stdout.is_empty()
                && stderr.contains("replacement topology is unsupported")
                && stderr.contains(&replacement_ref)
                && stderr.contains("GIT_NO_REPLACE_OBJECTS=1")
                && stderr.contains("core.useReplaceRefs=false")
                && stderr.contains("remove that ref"),
            "{name} must reject active custom replacement topology before output: stdout={} stderr={}",
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


#[test]
fn empty_replacement_base_cannot_bypass_the_shared_boundary() -> Result<()> {
    let repo = committed_drift_repo("empty-replace-base")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    let replacement_ref = format!("refs/empty-base-replacements/{head}");
    repo.run_git(["update-ref", &replacement_ref, &parent])?;

    let env = [("GIT_REPLACE_REF_BASE", "")];
    let effective = repo.run_git_with_env(["rev-list", "--parents", "-n", "1", "HEAD"], &env)?;
    let raw = repo.run_git_with_env(
        [
            "--no-replace-objects",
            "rev-list",
            "--parents",
            "-n",
            "1",
            "HEAD",
        ],
        &env,
    )?;
    assert_ne!(
        effective.stdout, raw.stdout,
        "fixture must prove Git activates an object-id ref under an empty replacement base"
    );

    assert_topology_rejected_without_effects(
        &repo,
        "empty-replace-base",
        &env,
        &[
            &replacement_ref,
            "GIT_NO_REPLACE_OBJECTS=1",
            "core.useReplaceRefs=false",
            "remove that ref",
        ],
    )?;
    Ok(())
}


#[test]
fn same_parent_tree_replacements_are_rejected_in_default_and_custom_namespaces() -> Result<()> {
    for (label, namespace) in [
        ("default-same-parent", None),
        ("custom-same-parent", Some("refs/tree-replacements/")),
    ] {
        let repo = committed_drift_repo(label)?;
        let head = repo.head_sha()?;
        let parent = repo.git_stdout(["rev-parse", "HEAD^1"])?;
        let original = std::fs::read_to_string(repo.path().join("f.txt"))?;
        repo.write_file("f.txt", "replacement tree\nwith different bytes\n")?;
        repo.run_git(["add", "f.txt"])?;
        let tree = repo.git_stdout(["write-tree"])?;
        repo.run_git(["reset", "HEAD", "--", "f.txt"])?;
        repo.write_file("f.txt", &original)?;
        let replacement = repo.git_stdout([
            "commit-tree",
            &tree,
            "-p",
            &parent,
            "-m",
            "same-parent replacement",
        ])?;
        let refname = format!("{}{head}", namespace.unwrap_or("refs/replace/"));
        repo.run_git(["update-ref", &refname, &replacement])?;
        repo.run_git(["pack-refs", "--all", "--prune"])?;

        let env = namespace
            .map(|base| vec![("GIT_REPLACE_REF_BASE", base)])
            .unwrap_or_default();
        let effective_parents =
            repo.run_git_with_env(["rev-list", "--parents", "-n", "1", "HEAD"], &env)?;
        let raw_parents = repo.run_git_with_env(
            [
                "--no-replace-objects",
                "rev-list",
                "--parents",
                "-n",
                "1",
                "HEAD",
            ],
            &env,
        )?;
        assert_eq!(
            effective_parents.stdout, raw_parents.stdout,
            "fixture must preserve the replaced commit's parent IDs"
        );
        let effective_tree = repo.run_git_with_env(["show", "-s", "--format=%T", "HEAD"], &env)?;
        let raw_tree = repo.run_git_with_env(
            ["--no-replace-objects", "show", "-s", "--format=%T", "HEAD"],
            &env,
        )?;
        assert_ne!(
            effective_tree.stdout, raw_tree.stdout,
            "fixture must change the replaced commit's tree"
        );
        let replacement_ref = format!("{}{head}", namespace.unwrap_or("refs/replace/"));
        assert_topology_rejected_without_effects(
            &repo,
            label,
            &env,
            &[
                &replacement_ref,
                "GIT_NO_REPLACE_OBJECTS=1",
                "core.useReplaceRefs=false",
                "remove that ref",
            ],
        )?;
    }
    Ok(())
}


#[test]
fn grafts_only_block_when_their_changed_commit_is_reachable() -> Result<()> {
    let repo = committed_drift_repo("graft-reachability")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD^1"])?;
    let dangling = repo.git_stdout([
        "commit-tree",
        "HEAD^{tree}",
        "-p",
        "HEAD",
        "-m",
        "dangling graft target",
    ])?;
    let grafts = repo.path().join(".git/info/grafts");
    std::fs::write(&grafts, format!("{dangling} {parent}\n"))?;

    let history = repo.run_span(["history", "graft-reachability", "--format=json"])?;
    assert!(
        history.status.success() && !history.stdout.is_empty(),
        "an unreachable graft must not block history: stdout={} stderr={}",
        String::from_utf8_lossy(&history.stdout),
        String::from_utf8_lossy(&history.stderr)
    );
    let drift = repo.run_span(["drift", "--format=json"])?;
    assert!(
        drift.status.code() == Some(1)
            && !drift.stdout.is_empty()
            && !String::from_utf8_lossy(&drift.stderr).contains("replacement topology"),
        "an unreachable graft must preserve drift's ordinary result: stdout={} stderr={}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );

    std::fs::write(&grafts, format!("{head}\n"))?;
    assert_topology_rejected_without_effects(
        &repo,
        "graft-reachability",
        &[],
        &["info/grafts", &head, "remove that entry"],
    )?;
    Ok(())
}


#[test]
fn non_utf8_graft_metadata_cannot_hide_valid_entries_or_fail_open() -> Result<()> {
    let repo = committed_drift_repo("graft-non-utf8")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD^1"])?;
    let grafts = repo.path().join(".git/info/grafts");

    for malformed_first in [false, true] {
        let valid_root_graft = format!("{head}\n");
        let mut contents = Vec::new();
        if malformed_first {
            contents.extend_from_slice(&[0xff, b'\n']);
        }
        contents.extend_from_slice(valid_root_graft.as_bytes());
        if !malformed_first {
            contents.extend_from_slice(&[0xff, b'\n']);
        }
        std::fs::write(&grafts, contents)?;

        let effective = repo.run_git_with_env(
            ["rev-list", "--parents", "-n", "1", "HEAD"],
            &[("GIT_NO_REPLACE_OBJECTS", "1")],
        )?;
        assert!(
            effective.status.success() && String::from_utf8_lossy(&effective.stdout).trim() == head,
            "fixture must prove Git applies the valid root graft despite adjacent non-UTF-8 data, and that GIT_NO_REPLACE_OBJECTS does not disable it: stdout={} stderr={}",
            String::from_utf8_lossy(&effective.stdout),
            String::from_utf8_lossy(&effective.stderr)
        );
        assert_topology_rejected_without_effects(
            &repo,
            "graft-non-utf8",
            &[("GIT_NO_REPLACE_OBJECTS", "1")],
            &["info/grafts", &head, "remove that entry"],
        )?;
    }

    let dangling = repo.git_stdout([
        "commit-tree",
        "HEAD^{tree}",
        "-p",
        "HEAD",
        "-m",
        "unreachable graft target",
    ])?;
    let mut inconclusive = format!("{dangling} {parent}\n").into_bytes();
    inconclusive.extend_from_slice(&[0xff, b'\n']);
    std::fs::write(&grafts, inconclusive)?;
    assert_topology_rejected_without_effects(
        &repo,
        "graft-non-utf8",
        &[],
        &["info/grafts", "line 2", "repair or remove"],
    )?;
    Ok(())
}


#[test]
fn config_disabled_replacements_define_the_same_boundary_as_the_env_var() -> Result<()> {
    let repo = committed_drift_repo("replace-config-off")?;
    let head = repo.head_sha()?;
    let parent = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    repo.run_git(["replace", &head, &parent])?;

    // Git's persistent off-switch must disable the boundary exactly like
    // GIT_NO_REPLACE_OBJECTS. History succeeds, while drift retains its
    // ordinary drift exit status and emits findings rather than a topology
    // error.
    repo.run_git(["config", "core.useReplaceRefs", "false"])?;
    let history = repo.run_span(["history", "replace-config-off", "--format=json"])?;
    assert!(
        history.status.success() && !history.stdout.is_empty(),
        "config-disabled replacements must leave history available: stdout={} stderr={}",
        String::from_utf8_lossy(&history.stdout),
        String::from_utf8_lossy(&history.stderr)
    );
    let drift = repo.run_span(["drift", "--format=json"])?;
    assert!(
        drift.status.code() == Some(1)
            && !drift.stdout.is_empty()
            && !String::from_utf8_lossy(&drift.stderr).contains("replacement topology"),
        "config-disabled replacements must preserve drift's normal finding: stdout={} stderr={}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );

    // An explicit `true` restores the default boundary, proving the gate
    // reads the configured value rather than the key's mere presence.
    repo.run_git(["config", "core.useReplaceRefs", "true"])?;
    let replacement_ref = format!("refs/replace/{head}");
    assert_topology_rejected_without_effects(
        &repo,
        "replace-config-off",
        &[],
        &[
            &replacement_ref,
            "GIT_NO_REPLACE_OBJECTS=1",
            "core.useReplaceRefs=false",
            "remove that ref",
        ],
    )?;
    Ok(())
}


#[test]
fn config_disabled_replacements_leave_grafts_active() -> Result<()> {
    let repo = committed_drift_repo("graft-config-off")?;
    let head = repo.head_sha()?;
    // Grafts are independent of both replacement off-switches: with
    // replacement processing disabled by config, a reachable graft entry
    // still rejects, mirroring the env-var independence proven above.
    repo.run_git(["config", "core.useReplaceRefs", "false"])?;
    std::fs::write(
        repo.path().join(".git/info/grafts"),
        format!("{head}\n"),
    )?;
    assert_topology_rejected_without_effects(
        &repo,
        "graft-config-off",
        &[],
        &["info/grafts", &head, "remove that entry"],
    )?;
    Ok(())
}


#[test]
fn a_non_boolean_use_replace_refs_fails_closed() -> Result<()> {
    let repo = committed_drift_repo("replace-config-invalid")?;
    // Git itself refuses to run on a malformed boolean here; conflating it
    // with the default `true` (or with `false`) would silently pick a side
    // of the boundary. No replacement ref is needed: the gate must refuse
    // before probing the namespace at all.
    repo.run_git(["config", "core.useReplaceRefs", "maybe"])?;
    for (name, args) in [
        (
            "history",
            vec!["history", "replace-config-invalid", "--format=json"],
        ),
        ("drift", vec!["drift", "--format=json"]),
    ] {
        let out = repo.run_span(args)?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success()
                && out.stdout.is_empty()
                && stderr.contains("core.useReplaceRefs")
                && stderr.contains("is set to a value that is not a boolean"),
            "{name} must fail closed on an unparseable core.useReplaceRefs: stdout={} stderr={}",
            String::from_utf8_lossy(&out.stdout),
            stderr
        );
    }
    Ok(())
}


/// A first-parent timeline does not surface commits that happened only on a
/// merged side branch; their contribution is represented by the merge itself.
#[test]
fn a_side_branch_tip_is_not_a_timeline_entry() -> Result<()> {
    let repo = merge_diamond_repo("mg")?;
    let json = history_json(&repo, "mg")?;
    assert!(
        json["commits"]
            .as_array()
            .expect("commits array")
            .iter()
            .all(|entry| entry["summary"] != "side edits line 2"),
        "history follows HEAD's first-parent chain, so it cannot render a side-only commit: {json:#}"
    );
    let main = commit_with(&json, "main edits line 5")["anchors"][0]["diff"]
        .as_str()
        .expect("mainline diff");
    assert!(
        main.contains("\n-l5\n") && main.contains("\n+MAIN5\n"),
        "the main branch's own edit:\n{main}"
    );
    assert_no_fabricated_lines(&repo, "mg")
}


/// The commit *after* a merge is the acceptance case for the two halves
/// together, and it is the one neither half fixes alone.
///
/// Its first parent is the merge. Skip the merge and the entry has no baseline
/// but the pre-merge tip, so it inherits the whole merged-in side as its own
/// work; render the merge but keep pairing on the walk's predecessor and the
/// same fabrication arrives by the other route. Only removing the skip *and*
/// pairing on the first parent leaves this entry carrying nothing but the one
/// line it actually changed.
#[test]
fn the_first_commit_after_a_merge_carries_only_its_own_edit() -> Result<()> {
    let repo = merge_diamond_repo("mg")?;
    repo.write_file("f.txt", "l1\nSIDE2\nl3\nPOST4\nMAIN5\n")?;
    repo.commit_all("post-merge edit")?;

    let json = history_json(&repo, "mg")?;
    let post = json["commits"]
        .as_array()
        .expect("commits array")
        .iter()
        .find(|e| e["summary"] == "post-merge edit")
        .expect("the post-merge entry is missing")["anchors"][0]["diff"]
        .as_str()
        .expect("diff string")
        .to_string();
    assert!(
        post.contains("\n-l4\n") && post.contains("\n+POST4\n"),
        "the post-merge commit's own edit:\n{post}"
    );
    assert!(
        !post.contains("\n-l2\n") && !post.contains("\n+SIDE2\n"),
        "`SIDE2` arrived in the merge, one commit earlier; this entry claiming \
         it is the fabrication the merge skip produced:\n{post}"
    );
    assert_no_fabricated_lines(&repo, "mg")
}


/// The walk is ordered by commit *time*, and commit time is not topology.
///
/// Here the older branch tip is the one merged second, so the walk prints the
/// two siblings adjacent to each other with the commit they both descend from
/// sorted between them and their shared parent nowhere near either. A pairing
/// keyed on print order gets the baseline wrong for both. This is the face that
/// forged dates are needed to reach, and it is why the fix is stated as "the
/// state at the commit's first parent" rather than "the entry above".
#[test]
fn a_tip_older_than_its_sibling_still_pairs_on_topology_not_print_order() -> Result<()> {
    let repo = TestRepo::new()?;
    let at = |day: u32| format!("2026-01-{day:02}T12:00:00-05:00");
    let commit_at = |msg: &str, day: u32| -> Result<()> {
        repo.run_git(["add", "-A"])?;
        let out = repo.run_git_with_env(
            ["commit", "-m", msg],
            &[
                ("GIT_AUTHOR_DATE", at(day).as_str()),
                ("GIT_COMMITTER_DATE", at(day).as_str()),
            ],
        )?;
        assert!(out.status.success(), "commit {msg:?} failed");
        Ok(())
    };
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    commit_at("initial", 1)?;
    repo.span_stdout(["add", "dm", "f.txt#L1-L5"])?;
    commit_at("declare", 3)?;
    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file("f.txt", "l1\nSIDE2\nl3\nl4\nl5\n")?;
    commit_at("side edits line 2", 5)?;
    repo.run_git(["checkout", "-"])?;
    repo.write_file("f.txt", "l1\nl2\nl3\nl4\nMAIN5\n")?;
    commit_at("main edits line 5", 4)?;
    let merged = repo.run_git_with_env(
        ["merge", "--no-ff", "side", "-m", "merge side"],
        &[
            ("GIT_AUTHOR_DATE", at(6).as_str()),
            ("GIT_COMMITTER_DATE", at(6).as_str()),
        ],
    )?;
    assert!(merged.status.success(), "the merge itself must succeed");

    // Fixture assumption, read off git: the walk order really does put the two
    // siblings next to each other, which is the condition under test.
    let order = repo.git_stdout(["log", "--all", "--date-order", "--format=%s"])?;
    let order: Vec<&str> = order.lines().collect();
    assert_eq!(
        &order[..3],
        &["merge side", "side edits line 2", "main edits line 5"],
        "fixture assumption: the sibling tips sort adjacent, newest sibling first"
    );

    assert_no_fabricated_lines(&repo, "dm")
}

// ---------------------------------------------------------------------------
// `--limit` scoping
// ---------------------------------------------------------------------------

#[test]
fn limit_scopes_the_window_seeds_the_baseline_and_warns() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;

    let out = repo.run_span(["history", span, "--limit", "1", "--format=json"])?;
    assert!(
        out.status.success(),
        "scoped history is an explicit user request and must exit 0; stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("scoped") && stderr.contains("partial"),
        "a scoped window must be signalled on stderr; got:\n{stderr}"
    );

    let json: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(json["scoped"], Value::Bool(true), "expected scoped: true");
    let commits = json["commits"].as_array().expect("commits array");
    assert_eq!(commits.len(), 1, "`--limit 1` shows one commit: {json:#}");
    assert!(
        commits[0]["summary"]
            .as_str()
            .unwrap_or("")
            .contains("C5: remove file2"),
        "the single shown commit must be the newest; got: {}",
        commits[0]
    );

    // The baseline is seeded from real prior state, so file1's unchanged
    // pre-window anchor is neither re-emitted nor relabelled as a first-add.
    // (It still appears as a context line inside the declaration's own diff —
    // that is the declaration's real bytes, not a fabricated anchor entry.)
    let anchors = commits[0]["anchors"].as_array().expect("anchors array");
    assert!(
        anchors.iter().all(|a| a["path"] != "file1.txt#L1-L5"),
        "a pre-existing unchanged anchor must not resurface in a scoped window; got: {anchors:#?}"
    );
    assert!(
        anchors
            .iter()
            .any(|a| a["path"] == "file3.txt" && a["content"].is_string()),
        "file3 is genuinely first-added at C5 and keeps its content snapshot; got: {anchors:#?}"
    );

    // The unscoped run carries no marker.
    let full = history_json(&repo, span)?;
    assert!(
        full.get("scoped").is_none(),
        "an unscoped run must not carry the flag; got: {full:#}"
    );
    Ok(())
}


#[test]
fn limit_counts_rendered_entries_not_walked_commits() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "narrow";

    std::fs::create_dir_all(repo.path().join("src"))?;
    repo.write_file("src/a.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("C0: initial")?;
    repo.span_stdout(["add", span, "src/a.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span"])?;

    // Three commits that touch the anchored file *past* the declared range.
    // They qualify for the walk and change nothing observable — a walk-side
    // cap would spend the whole window on them and print nothing at all.
    for n in 1..=3 {
        let mut body = String::from("alpha\nbeta\ngamma\n");
        for k in 1..=n {
            body.push_str(&format!("tail-{k}\n"));
        }
        repo.write_file("src/a.txt", &body)?;
        repo.commit_all(&format!("C{}: append past the anchored range", n + 1))?;
    }

    let unlimited = history_json(&repo, span)?;
    assert_eq!(
        unlimited["commits"]
            .as_array()
            .expect("commits array")
            .len(),
        1,
        "only the declaring commit changed anything observable; got: {unlimited:#}"
    );

    for n in ["1", "3"] {
        let out = repo.run_span(["history", span, "--limit", n])?;
        assert!(out.status.success(), "`--limit {n}` must exit 0");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            text.contains("C1: create span"),
            "`--limit {n}` must yield the one entry that exists, not an empty \
             window of no-op commits; got:\n{text}"
        );
    }

    // Nothing was dropped, so nothing is scoped.
    assert!(unlimited.get("scoped").is_none(), "got: {unlimited:#}");
    let limited: Value = serde_json::from_slice(
        &repo
            .run_span(["history", span, "--limit", "1", "--format=json"])?
            .stdout,
    )?;
    assert!(
        limited.get("scoped").is_none(),
        "a window that drops nothing is not scoped; got: {limited:#}"
    );

    // `--limit 0` is an explicitly empty — and explicitly partial — document.
    let zero = repo.run_span(["history", span, "--limit", "0", "--format=json"])?;
    assert!(zero.status.success());
    let zero_json: Value = serde_json::from_slice(&zero.stdout)?;
    assert_eq!(zero_json["scoped"], Value::Bool(true));
    assert_eq!(
        zero_json["commits"]
            .as_array()
            .expect("commits array")
            .len(),
        0
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Not-found handling
// ---------------------------------------------------------------------------

#[test]
fn a_namespace_name_errors_instead_of_panicking() -> Result<()> {
    let repo = TestRepo::new()?;

    repo.write_file("src.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", "ns/one", "src.txt#L1-L2"])?;
    repo.span_stdout(["why", "ns/one", "tracks the head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span under a namespace"])?;

    for name in ["ns", "ns/", ""] {
        let out = repo.run_span(["history", name])?;
        let code = out.status.code();
        assert_eq!(
            code,
            Some(1),
            "`git span history {name:?}` must fail closed with a CliError, not \
             panic; stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !stderr.contains("panicked"),
            "no panic for {name:?}; got:\n{stderr}"
        );
    }

    // The namespace case is worth naming explicitly.
    let out = repo.run_span(["history", "ns"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("namespace") && stderr.contains("ns/one"),
        "a namespace miss should name the spans underneath it; got:\n{stderr}"
    );
    Ok(())
}
