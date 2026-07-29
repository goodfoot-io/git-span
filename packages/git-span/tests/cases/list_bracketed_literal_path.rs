//! Reproduction: a literal, existing file path containing glob
//! metacharacters (e.g. `app/[slug]/page.tsx`) must resolve as a path, not
//! poison a batch `git span list --porcelain <paths...>` query.
//!
//! `resolve_targets_from_index` dispatches such an argument to the glob arm
//! (`is_glob_pattern` is true because of the `[`), which is the only
//! resolution branch with no `file_exists_in_workdir` fallback. With no span
//! anchored at that path the argument lands in `missing_args` and the whole
//! command errors with exit 1 and empty stdout — including for the other,
//! well-formed, span-covered arguments passed in the same batch.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// A batch containing a bracketed literal existing path plus a span-covered
/// path must succeed and report the covered path's span on stdout.
#[test]
fn bracketed_literal_path_does_not_poison_batch() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // A span-covered path.
    repo.write_file("src/covered.ts", "l1\nl2\nl3\nl4\nl5\n")?;
    // A literal existing file whose name contains glob metacharacters and
    // which no span covers.
    repo.write_file("app/[slug]/page.tsx", "export default 1;\n")?;
    repo.commit_all("seed sources")?;

    repo.span_stdout(["add", "covered-span", "src/covered.ts#L1-L5"])?;
    repo.span_stdout(["why", "covered-span", "seed"])?;
    repo.commit_all("span: covered-span")?;

    let out = repo.run_span([
        "list",
        "--porcelain",
        "app/[slug]/page.tsx",
        "src/covered.ts",
    ])?;

    let stdout = String::from_utf8(out.stdout)?;
    let stderr = String::from_utf8(out.stderr)?;

    assert!(
        out.status.success(),
        "batch query must not fail because of a bracketed literal path\n\
         exit: {:?}\nstdout: {stdout}\nstderr: {stderr}",
        out.status.code()
    );

    assert!(
        stdout
            .lines()
            .any(|l| l == "covered-span\tsrc/covered.ts\t1-5"),
        "covered path's span must still be reported\nstdout: {stdout}\nstderr: {stderr}"
    );

    Ok(())
}
