//! Declaration diffs speak real git: hunk/index-line shape invariants.

use super::*;


#[test]
fn declaration_diffs_match_real_git_for_add_modify_and_delete() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "d";

    repo.write_file("src.txt", "alpha\nbeta\ngamma\n")?;
    let c0 = repo.commit_all("C0: initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L2"])?;
    repo.span_stdout(["why", span, "first why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create the declaration"])?;
    let c1 = repo.head_sha()?;
    repo.span_stdout(["why", span, "second why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C2: edit the declaration"])?;
    let c2 = repo.head_sha()?;
    repo.run_git(["rm", ".span/d"])?;
    repo.run_git(["commit", "-m", "C3: delete the declaration"])?;
    let c3 = repo.head_sha()?;

    let json = history_json(&repo, span)?;
    for (needle, from, to) in [
        ("C1: create the declaration", &c0, &c1),
        ("C2: edit the declaration", &c1, &c2),
        ("C3: delete the declaration", &c2, &c3),
    ] {
        let ours = commit_with(&json, needle)["span_diff"]
            .as_str()
            .unwrap_or_else(|| panic!("no span_diff on {needle}"));
        let theirs = git_diff(&repo, from, to, ".span/d")?;
        assert_eq!(
            normalize_index_lines(ours),
            theirs,
            "our declaration patch must be byte-identical to git's own for {needle}"
        );
    }

    // And spot-check the dialect markers the differential test enforces.
    let created = commit_with(&json, "C1: create the declaration")["span_diff"]
        .as_str()
        .expect("span_diff");
    assert!(
        created
            .starts_with("diff --git a/.span/d b/.span/d\nnew file mode 100644\nindex 0000000.."),
        "a creation is an add, with the real path on both sides; got:\n{created}"
    );
    assert!(
        !created.contains("a/dev/null") && !created.contains("100644\n--- "),
        "git never prefixes /dev/null with a/, nor puts a mode suffix on an \
         add's index line; got:\n{created}"
    );
    Ok(())
}


#[test]
fn equal_index_hashes_never_sit_above_hunks() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    for block in diff_blocks(&out) {
        let Some(index_line) = block.lines().find(|l| l.starts_with("index ")) else {
            continue;
        };
        let hashes = index_line.trim_start_matches("index ");
        let hashes = hashes.split(' ').next().unwrap_or(hashes);
        let Some((old, new)) = hashes.split_once("..") else {
            continue;
        };
        if old == new {
            assert!(
                !block.contains("@@"),
                "`index {old}..{new}` claims the two sides are identical, so \
                 the block cannot carry hunks:\n{block}"
            );
        }
    }
    Ok(())
}


#[test]
fn hunk_headers_agree_with_their_bodies() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    let mut header: Option<(u32, u32, String)> = None;
    let (mut old_seen, mut new_seen) = (0u32, 0u32);
    let check = |h: &Option<(u32, u32, String)>, old_seen: u32, new_seen: u32| {
        if let Some((old_len, new_len, line)) = h {
            assert_eq!(
                (*old_len, *new_len),
                (old_seen, new_seen),
                "hunk header `{line}` must count its own body lines"
            );
        }
    };
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("@@ -") {
            check(&header, old_seen, new_seen);
            let (old_part, rest) = rest.split_once(" +").expect("malformed hunk header");
            let new_part = rest.split(" @@").next().expect("malformed hunk header");
            let len = |spec: &str| -> u32 {
                spec.split_once(',')
                    .map(|(_, l)| l.parse().unwrap_or(1))
                    .unwrap_or(1)
            };
            header = Some((len(old_part), len(new_part), line.to_string()));
            old_seen = 0;
            new_seen = 0;
        } else if header.is_some() {
            match line.chars().next() {
                Some(' ') => {
                    old_seen += 1;
                    new_seen += 1;
                }
                Some('-') if !line.starts_with("--- ") => old_seen += 1,
                Some('+') if !line.starts_with("+++ ") => new_seen += 1,
                Some('\\') => {}
                _ => {
                    check(&header, old_seen, new_seen);
                    header = None;
                }
            }
        }
    }
    check(&header, old_seen, new_seen);
    Ok(())
}
