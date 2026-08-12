//! CLI: `git span drift --fix` — the anchor/why boundary of a conflicted span
//! must be recovered structurally, never inferred from what a line *looks*
//! like.
//!
//! When a conflicted span file carries its blank-line anchor/why separator
//! immediately before a conflict block (the shape both
//! `format_residue_markers` and a plain Git textual merge produce when the
//! anchors agree and the `--why` prose diverges), the split has to decide
//! where the anchor block ends. Deciding that from line shape misclassifies
//! any why line whose last space-separated token contains `<alnum>:<rest>` —
//! a URL, an `algo:hash`-shaped reference, even prose quoting an `rk64:` hash.
//! Such a line is absorbed into the anchor block, parses as a whole-file
//! anchor at a fabricated path, and the operator's prose is silently deleted.
//!
//! Each case below round-trips a conflicted span through `drift --fix` and
//! asserts the observable outcome: the anchor set is exactly the anchors that
//! were written, and the why text survives verbatim.

use crate::support;

use anyhow::Result;
use git_span_core::{cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

/// Original 10-line `file1.txt` content seeded by `TestRepo::seeded`.
const ORIGINAL: &str = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_span_core::AnchorExtent::WholeFile,
    ))
}

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    Ok(std::fs::read_to_string(repo.path().join(".span").join(name))?)
}

/// Drive one member of the class: a span whose single anchor is uncontested
/// and whose why text — identical on both sides, so the merge resolves clean —
/// is `why`. The separator sits outside the conflict block, exactly where a
/// textual merge of two span files with equal anchor blocks puts it.
///
/// Asserts the resolved file is byte-for-byte the canonical serialization of
/// that one anchor plus that why text: no fabricated anchor, no lost prose.
fn assert_why_survives_conflict_resolution(why: &str) -> Result<()> {
    let repo = TestRepo::seeded()?;
    let h1 = line_slice_hash(ORIGINAL, 1, 5);

    let span_content = format!(
        "file1.txt#L1-L5 rk64:{h1}\n\n<<<<<<< ours\n{why}\n=======\n{why}\n>>>>>>> theirs\n"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    let span = read_span(&repo, "m")?;
    let expected = format!("file1.txt#L1-L5 rk64:{h1}\n\n{why}\n");
    assert_eq!(
        span, expected,
        "the anchor set must be exactly the authored anchor and the why text \
         must survive verbatim;\nstdout=\n{stdout}\nstderr=\n{stderr}"
    );
    Ok(())
}

#[test]
fn why_line_ending_in_url_is_not_absorbed_into_anchor_block() -> Result<()> {
    assert_why_survives_conflict_resolution("docs at https://example.com")
}

#[test]
fn why_line_ending_in_algo_hash_token_is_not_absorbed_into_anchor_block() -> Result<()> {
    assert_why_survives_conflict_resolution("couples the parser to lexer:tokenize\nsee rfc:1234")
}

#[test]
fn why_whose_every_line_is_anchor_shaped_keeps_its_separator() -> Result<()> {
    assert_why_survives_conflict_resolution(
        "docs at https://example.com\nsee rfc:1234\nmirrors lexer:tokenize",
    )
}

#[test]
fn why_line_ending_in_literal_rk64_token_is_not_absorbed_into_anchor_block() -> Result<()> {
    assert_why_survives_conflict_resolution(
        "the recorded fingerprint is rk64:deadbeefcafe1234",
    )
}
