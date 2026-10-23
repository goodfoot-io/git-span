//! The top-level help is a compact inventory; detailed help retains the contract.
use anyhow::Result;
use clap::CommandFactory;
use git_span::cli::Cli;
use std::collections::BTreeSet;

use crate::support::TestRepo;

fn help(args: &[&str]) -> String {
    let outside = tempfile::tempdir().expect("outside repository");
    let output = assert_cmd::Command::cargo_bin("git-span")
        .expect("binary")
        .current_dir(outside.path())
        .env("NO_COLOR", "1")
        .env("COLUMNS", "100")
        .args(args)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    String::from_utf8(output).expect("UTF-8 help")
}

#[test]
fn short_help_groups_cover_public_metadata_with_compact_copy() {
    let rendered = help(&["-h"]);
    assert!(rendered.split_whitespace().count() <= 400, "{rendered}");
    assert_eq!(help(&[]), rendered);
    let expected = [
        ("Inspect spans:", vec!["show", "list", "context"]),
        (
            "Check and maintain spans:",
            vec!["drift", "replace", "add", "why"],
        ),
        ("Commit notes:", vec!["notes"]),
        (
            "History and diagnostics:",
            vec!["history", "preflight", "doctor", "tree"],
        ),
        (
            "Administration:",
            vec![
                "remove",
                "delete",
                "config",
                "resolve",
                "merge-driver",
                "help",
            ],
        ),
    ];
    let mut groups = Vec::<(&str, Vec<&str>)>::new();
    for line in rendered.lines() {
        if expected.iter().any(|(heading, _)| *heading == line) {
            groups.push((line, vec![]));
        } else if line == "Options:" {
            break;
        } else if line.starts_with("  ") && !line.trim().is_empty() {
            let mut words = line.split_whitespace();
            groups
                .last_mut()
                .expect("row follows heading")
                .1
                .push(words.next().unwrap());
            if groups.len() >= 4 {
                assert!(words.count() <= 10, "{line}");
            }
        }
    }
    assert_eq!(groups, expected);
    let rows: Vec<_> = groups
        .iter()
        .flat_map(|(_, names)| names.iter().copied())
        .collect();
    let mut command = Cli::command();
    command.build();
    let public: BTreeSet<_> = command
        .get_subcommands()
        .filter(|sub| !sub.is_hide_set())
        .map(|sub| sub.get_name())
        .collect();
    assert_eq!(rows.iter().copied().collect::<BTreeSet<_>>(), public);
    assert_eq!(rows.len(), public.len(), "no duplicate commands");
    for hidden in command.get_subcommands().filter(|sub| sub.is_hide_set()) {
        assert!(!rendered.contains(hidden.get_name()));
    }
    assert!(rendered.contains("git span list --porcelain"));
    assert!(rendered.contains("git span notes list --format json"));
}

#[test]
fn detailed_help_preserves_semantics_and_help_dispatch() {
    let history = help(&["history", "--help"]);
    for detail in ["50%", "Worktree", "Index", "scoped: true", "partial record"] {
        assert!(history.contains(detail), "missing {detail}: {history}");
    }
    let replace = help(&["replace", "--help"]);
    for detail in [
        "atomic transaction",
        "nothing changes",
        "never falls back",
        "unchanged address",
        "exit 1",
        "drift_free",
    ] {
        assert!(replace.contains(detail), "missing {detail}: {replace}");
    }
    assert_eq!(help(&["help", "replace"]), replace);
    assert!(help(&["--help"]).contains("decision-relevant context"));
    assert!(help(&["show", "-h"]).contains("Show a span's anchors"));
}

#[test]
fn porcelain_selects_actual_names_with_spaced_paths_and_multiple_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("a spaced path.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("spaced source")?;
    repo.span_stdout(["add", "alpha", "a spaced path.txt#L1-L2", "file1.txt#L1-L2"])?;
    repo.span_stdout(["add", "beta", "file2.txt#L1-L2"])?;
    let records = repo.span_stdout(["list", "--porcelain"])?;
    assert_eq!(records.lines().count(), 3);
    assert!(records.contains("\ta spaced path.txt\t"));
    let names: BTreeSet<_> = records
        .lines()
        .map(|line| line.split('\t').next().unwrap())
        .collect();
    assert_eq!(names, BTreeSet::from(["alpha", "beta"]));
    for name in names {
        let shown = repo.span_stdout(["show", name])?;
        assert!(shown.contains(name));
    }
    Ok(())
}
