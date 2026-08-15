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

    let rendered = String::from_utf8(buf)?;
    let mut normalized = rendered
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    normalized.push('\n');

    std::fs::write(&out_path, normalized)?;
    Ok(())
}

/// Hand-authored DESCRIPTION section.
///
/// Defines the span contract — what a span is, the why's role, and re-anchoring
/// on drift.
const DESCRIPTION_SECTION: &str = r#".SH DESCRIPTION
.B git span
tracks implicit semantic dependencies in a Git repository: couplings between
line ranges (or whole files), in code or prose, coupled by nothing a schema,
type, test, or build/generator step enforces.
Each
.B span
anchors the participating anchors and carries a durable
.I why
\[em] compact, decision-relevant context shared by the anchored set.
.PP
The standing question at commit time: did this change create or rely on a
coupling that is not visible from the lines themselves?
.PP
.B Writing the why.
Write one or two complete present\-tense clauses in role words. State the
relationship and any decisive nonlocal authority, invariant, permitted difference,
lifecycle state, evidence gate, or focused conditional verification. Labels such
as \(lqAuthority:\(rq and \(lqRemoval gate:\(rq are optional but must introduce
complete clauses. Include only facts relevant from every anchor. Omit the span
name, incidental implementation detail, generic work orders, and CLI procedure.
.PP
.B Re\-anchoring on drift.
When
.B git span drift
reports drift, review the change at each anchor and decide which side of the
coupling changed deliberately \[em]
.B git span history
shows the commit timeline \[em] then bring the other side back into agreement
before re\-anchoring: a doc anchor that lags a deliberately committed code
change is updated to match.
Re\-anchoring records the current content as the anchored baseline with no
semantic check, so re\-anchoring over a live disagreement conceals it.
When agreement would require a code change, when the doc may be the intended
contract rather than a description, or when no deliberate commit explains
the drift, surface the decision instead of re\-anchoring.
Inherit the why only while it remains true. For a routine re-anchor, use
.B git span add
without changing the why.
Rewrite it with
.B git span why
when the relationship or lifecycle state changes. A satisfied gate authorizes
its transition; revise or retire the why and every superseded anchor. Require scoped
.B git span drift
to report zero drift.
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
Print the command help and exit 0. Run
.B git span list
with no arguments to list every span.
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
git span drift
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
