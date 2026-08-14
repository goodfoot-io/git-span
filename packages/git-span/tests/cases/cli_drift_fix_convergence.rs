//! CLI: `git span drift --fix` when distinct anchors converge on one identity.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Reproduction for main-234: two anchors resolved from distinct committed
/// ranges can both relocate to one new range. The fix must leave one record
/// at that identity and tell the operator that the anchors converged.
#[test]
fn fix_collapses_two_head_moved_anchors_that_converge() -> Result<()> {
    let repo = TestRepo::new()?;
    let initial = "before\nalpha\nbeta\ngamma\nbetween-1\nbetween-2\nalpha\nbeta\ngamma\nafter\n";
    repo.write_file("source.txt", initial)?;
    repo.commit_all("initial source")?;

    repo.span_stdout([
        "add",
        "m",
        "source.txt#L2-L4",
        "source.txt#L7-L9",
    ])?;
    repo.span_stdout(["why", "m", "two references to the repeated block"])?;
    repo.commit_all("record both source ranges")?;

    // Remove both original occurrences and retain one copy at a third range.
    // Both recorded hashes therefore resolve to the only remaining exact
    // match, and the committed edit makes both relocations surface at HEAD.
    let converged = "new-1\nnew-2\nnew-3\nalpha\nbeta\ngamma\nafter\n";
    repo.write_file("source.txt", converged)?;
    repo.commit_all("converge repeated blocks")?;

    let drift = repo.run_span(["drift", "m", "--no-exit-code"])?;
    let drift_stdout = String::from_utf8_lossy(&drift.stdout);
    assert_eq!(
        drift_stdout.matches("moved to source.txt#L4-L6").count(),
        2,
        "both source anchors must resolve to the same destination; stdout=\n{drift_stdout}"
    );

    let fixed = repo.run_span(["drift", "m", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&fixed.stdout);
    let span = read_span(&repo, "m")?;
    assert_eq!(
        span.lines()
            .filter(|line| line.starts_with("source.txt#L4-L6 rk64:"))
            .count(),
        1,
        "a convergence must write one record for the destination identity; span=\n{span}"
    );
    assert!(
        stdout.contains("converged") && stdout.contains("source.txt#L4-L6"),
        "the fix output must name the convergence and its destination; stdout=\n{stdout}"
    );
    Ok(())
}
