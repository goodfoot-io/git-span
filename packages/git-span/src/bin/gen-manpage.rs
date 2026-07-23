//! Generator for `git-span.1`.
//!
//! Writes a roff manpage to the path given as `argv[1]`, defaulting to
//! `$CARGO_MANIFEST_DIR/man/git-span.1` when no argument is supplied.
//!
//! Run via `cargo run --bin gen-manpage -- [<output-path>]`.

use std::io::Write as _;
use std::path::PathBuf;

use clap::CommandFactory as _;
use git_span::cli::Cli;

fn main() -> anyhow::Result<()> {
    let out_path: PathBuf = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let manifest_dir =
                std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(manifest_dir).join("man").join("git-span.1")
        });

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let cmd = Cli::command();
    let man = clap_mangen::Man::new(cmd);

    let mut buf: Vec<u8> = Vec::new();

    // Render standard sections from clap_mangen.
    man.render_title(&mut buf)?;
    man.render_name_section(&mut buf)?;
    man.render_synopsis_section(&mut buf)?;

    // Hand-authored DESCRIPTION — replaces the one-line clap `about` string and
    // adds the full span contract. The `after_help` block (EXTRA section) is
    // intentionally omitted here; it belongs in `--help` output, not the manpage.
    write!(buf, "{}", DESCRIPTION_SECTION)?;

    man.render_options_section(&mut buf)?;
    man.render_subcommands_section(&mut buf)?;
    man.render_version_section(&mut buf)?;

    // Hand-authored EXAMPLES section.
    write!(buf, "{}", EXAMPLES_SECTION)?;

    // SEE ALSO section.
    write!(buf, "{}", SEE_ALSO_SECTION)?;

    std::fs::write(&out_path, &buf)?;
    Ok(())
}

/// Hand-authored DESCRIPTION section.
///
/// Defines the span contract — what a span is, the why's role, and re-anchoring
/// on drift.
const DESCRIPTION_SECTION: &str = r#".SH DESCRIPTION
.B git span
tracks implicit semantic dependencies in a Git repository: couplings between
line ranges (or whole files), in code or prose, that no schema, type, or test
enforces.
Each
.B span
anchors the participating anchors and carries a durable
.I why
\[em] one present-tense sentence that defines the subsystem the anchored set
forms together and stays true across a rewrite of either side.
.PP
The standing question at commit time: did this change create or rely on a
coupling that is not visible from the lines themselves?
.PP
.B Writing the why.
Write one complete sentence, in the present tense, that defines the subsystem
the anchors form together: name the thing, then say what it does across the
anchors.
Give it a subject and a verb \[em] never a label followed by a colon \[em] and
name the thing in role\-words (\(lqthe doc,\(rq \(lqthe parser,\(rq
\(lqthe runbook,\(rq \(lqthe migration\(rq) rather than repeating filenames.
A why is read when a hook surfaces it mid\-task, so make it specific enough
that a reader who just edited one anchor can tell from the sentence alone
whether their change lands inside the thing it names.
Do not restate the span name or embed incidental implementation details, and
keep invariants, caveats, ownership, and review triggers out of the why \[em]
those belong in comments at the anchor sites, in commit messages, CODEOWNERS,
and PR descriptions.
.PP
.B Re\-anchoring on drift.
When
.B git span stale
reports drift, review the change at each anchor.
Because a why only defines, it is inherited across routine re-anchors: if the
subsystem still holds, re-anchor with
.B git span add
and commit, leaving the why alone.
Rewrite it with
.B git span why
only when the subsystem itself has changed.
.PP
Each span is an ordinary tracked file under the span root (default
.IR .span ,
overridable with
.BR \-\-span\-dir ,
the
.I GIT_SPAN_DIR
environment variable, or
.IR "git config git-span.dir" ).
Spans are versioned, fetched, and pushed exactly like any other
tracked file \[em] stage and commit edits with
.B git add .span && git commit
\&.
.PP
Bare invocations:
.RS 4
.TP
.B git span
List every span in the repository.
.TP
.BI git\ span\  <name>
Show one span (anchors, why, config).
.RE
"#;

/// Hand-authored EXAMPLES section.
const EXAMPLES_SECTION: &str = r#".SH EXAMPLES
Anchor a new span alongside a code change:
.PP
.RS 4
.nf
git span add billing/charge-request-contract \e
    docs/api/charge.md#L40-L88 api/charge.ts#L30-L76
git span why billing/charge-request-contract \e
    "The charge request body shape is stated by the doc \e
and honored by the parser that reads it."
git add .span
git commit -m "Wire checkout to charge API"
.fi
.RE
.PP
Document an existing relationship anchored at HEAD:
.PP
.RS 4
.nf
git span add auth/token-contract --at HEAD \e
    packages/auth/token.ts#L88-L104 \e
    packages/auth/crypto.ts#L12-L40
git span why auth/token-contract \e
    "Session token verification checks signatures with the \e
algorithm and key encoding the crypto helper defines."
git add .span && git commit -m "Document token/crypto coupling"
.fi
.RE
.PP
Check for drift and inspect a span:
.PP
.RS 4
.nf
git span stale
git span billing/charge-request-contract
git span show billing/charge-request-contract
.fi
.RE
"#;

/// SEE ALSO section.
const SEE_ALSO_SECTION: &str = r#".SH SEE ALSO
.BR git (1),
.BR gitcli (7)
"#;
