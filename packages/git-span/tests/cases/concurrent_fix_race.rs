//! `git span add` racing `git span drift --fix` on the same span (card
//! main-231, §3c).
//!
//! `add`/`remove`/`replace`/`why` have always taken the advisory per-span
//! lock around their read-modify-write. `apply_fix` never did, and the
//! duplicate-identity sweep makes that gap load-bearing: the sweep is a
//! whole-file structural read-modify-write, so a concurrent `add` can read
//! the pre-collapse file and write it back, silently undoing a collapse the
//! operator was just told succeeded — or losing its own anchor to the
//! `--fix` write.
//!
//! The fixture is order-independent by construction. `add` touches only the
//! identity it was handed (`file2.txt#L1-L5`) and the sweep touches only the
//! duplicate (`file1.txt#L1-L5`), so whichever runs first, the serialized
//! outcome is the same two records. Anything else means one whole write was
//! lost.

use crate::support;

use anyhow::Result;
use support::TestRepo;

const SENTINEL: &str = "rk64:ffffffffffffffff";

#[test]
fn concurrent_add_and_fix_lose_neither_write() -> Result<()> {
    // Several attempts: the race window is short, and a single unlucky
    // interleaving would let an unlocked `apply_fix` pass by coincidence.
    for attempt in 0..5 {
        let repo = TestRepo::seeded()?;
        let span_name = format!("race/fix{attempt}");
        let span_path = repo.path().join(".span").join(&span_name);
        std::fs::create_dir_all(span_path.parent().unwrap())?;
        std::fs::write(
            &span_path,
            "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
             file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
             \n\
             why: a duplicate identity waiting for the sweep.\n",
        )?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;

        let adder_path = repo.path().to_path_buf();
        let adder_span = span_name.clone();
        let adder = std::thread::spawn(move || -> Result<std::process::Output> {
            let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
            cmd.current_dir(&adder_path);
            cmd.args(["add", &adder_span, "file2.txt#L1-L5"]);
            Ok(cmd.output()?)
        });

        let fixer_path = repo.path().to_path_buf();
        let fixer = std::thread::spawn(move || -> Result<std::process::Output> {
            let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
            cmd.current_dir(&fixer_path);
            cmd.args(["drift", "--fix"]);
            Ok(cmd.output()?)
        });

        let add_out = adder.join().unwrap()?;
        let fix_out = fixer.join().unwrap()?;
        // `add`'s exit code reflects the span's post-write health, and this
        // span is deliberately unhealthy (a duplicate identity, then a
        // collapse sentinel), so a non-zero code is expected. What must not
        // happen is a crash: the lock is contended, not broken.
        anyhow::ensure!(
            add_out.status.code().is_some_and(|c| c <= 2),
            "add crashed on attempt {attempt}: {:?}\n{}",
            add_out.status,
            String::from_utf8_lossy(&add_out.stderr)
        );

        let text = std::fs::read_to_string(&span_path)?;
        let anchors: Vec<&str> = text
            .lines()
            .filter(|l| !l.is_empty() && !l.starts_with("why:") && !l.starts_with('['))
            .collect();

        assert_eq!(
            anchors.len(),
            2,
            "attempt {attempt}: the collapse and the add must both survive — \
             one record per identity, neither write lost.\nspan:\n{text}\n\
             fix stdout:\n{}",
            String::from_utf8_lossy(&fix_out.stdout)
        );
        assert!(
            text.contains(&format!("file1.txt#L1-L5 {SENTINEL}")),
            "attempt {attempt}: the sweep's collapse must not be undone by \
             the concurrent add:\n{text}"
        );
        assert!(
            text.contains("file2.txt#L1-L5"),
            "attempt {attempt}: the concurrent add's anchor must not be lost \
             to the sweep's write:\n{text}"
        );
    }
    Ok(())
}
