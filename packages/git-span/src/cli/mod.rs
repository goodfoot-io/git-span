//! CLI top-level — parses args and dispatches to library functions.
//!
//! Design choices:
//!
//! * **`anyhow::Result<i32>` at the CLI boundary.** CLI handlers return
//!   `anyhow::Result<i32>` so exit codes are first-class (§10.4
//!   distinguishes `0`, `1`, `2` for `git span stale`). Library errors
//!   (`crate::Error`) convert via `?`; `anyhow` keeps the dispatch
//!   layer from having to enumerate variants.
//!
//! * **`git span <name>` vs `git span <subcommand>`.** Clap cannot
//!   disambiguate a positional-name from a subcommand without help.
//!   We handle this in [`crate::main`] by checking the first argument
//!   against [`crate::validation::RESERVED_SPAN_NAMES`] (the spec's
//!   reserved list, §10.2) before parsing. A reserved token is treated
//!   as a subcommand; anything else is a span name passed to the
//!   `Show` handler.

pub mod commit;
pub mod doctor;
pub mod drift_label;
pub mod error;
pub mod format;
pub mod history;
pub mod interior_anchor;
pub mod merge_driver;
pub mod show;
pub mod stale_cluster;
pub mod stale_fix;
pub mod stale_output;
pub mod tree;

pub use drift_label::format_drift_label;

pub use error::{CliError, NextStep, from_lib_error, render_error};

use clap::{Parser, Subcommand, ValueEnum};

/// Top-level `git-span` command.
#[derive(Debug, Parser)]
#[command(
    name = "git-span",
    about = "Track implicit semantic dependencies in a git repo.",
    version,
    after_help = "A span holds the anchors — line-anchor or whole-file, in code or prose — coupled by nothing a schema, type, test, or build/generator step enforces, and carries a `why`: one complete present-tense sentence defining the subsystem those anchors form together, specific enough that a reader who just edited one anchor can tell whether their change lands inside it. The why is evergreen and inherited across routine re-anchors; invariants, caveats, ownership, and review triggers belong in comments at the anchor sites, commit messages, CODEOWNERS, and PR descriptions.\n\nBare invocations:\n  git span <name>          show one span (anchors, why, config)"
)]
pub struct Cli {
    /// Emit performance timings for major git-span operation groups to stderr.
    ///
    /// Can also be enabled with `GIT_SPAN_PERF=1`.
    #[arg(long, global = true)]
    pub perf: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// Every subcommand the CLI accepts. Mirrors §10.2.
#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Show the named span — its anchors, why, and config. Equivalent
    /// to the bare `git span <name>` positional form.
    #[command(name = "show")]
    Show(ShowArgs),

    /// List files and anchors currently tracked by a span.
    List(ListArgs),

    /// Report anchors whose content has drifted from their anchored state.
    ///
    /// With `--fix`, also re-anchors `Moved` anchors unconditionally and
    /// whitespace-equivalent `Changed` anchors in place, and resolves
    /// `.span/` merge conflicts structurally. A `Changed` anchor whose
    /// content differs beyond whitespace is left drifting so the coupling
    /// resurfaces for human confirmation — the operator reviews the
    /// rewritten spans with `git diff` and stages only what they agree with.
    /// Conflict resolution splits Git textual conflict markers into
    /// ours/theirs, enforces a clean-source precondition (all referenced
    /// source files must be conflict-free), and calls the structural merge
    /// kernel.
    ///
    /// Fail-closed cases:
    ///   - A referenced source file itself contains conflict markers.
    ///   - The `--why` text diverged between ours and theirs with no
    ///     merge base (textual marker split — no base available).
    ///
    /// Fully resolved conflicts are written clean and re-anchored in the
    /// worktree; spans with residual divergence (same anchor, different
    /// range/hash with no clean source) or a divergent `--why` write the
    /// resolved anchors cleanly with minimal residue markers and are not
    /// re-staged.
    Stale(StaleArgs),

    /// Add anchors to a span, writing the span file under the span root.
    /// Stage and commit the change with `git add .span && git commit`.
    Add(AddArgs),

    /// Remove anchors from a span, editing the span file under the span
    /// root. Stage and commit the change with `git add .span && git commit`.
    Remove(RemoveArgs),

    /// Read or stage the span's why — one complete present-tense
    /// sentence defining the subsystem the anchors form together.
    ///
    /// Write a definition, not an instruction: name the thing in
    /// role words rather than file names and say what it does
    /// across the anchors, as a sentence with a subject and a verb
    /// — never a label followed by a colon (e.g. "Checkout request
    /// flow that carries a charge attempt from the browser to the
    /// Stripe-backed server."). Make it specific enough that a
    /// reader who just edited one anchor can tell whether their
    /// change lands inside what it names. Leave invariants,
    /// caveats, ownership, and review triggers to comments at the
    /// anchor sites, commit messages, CODEOWNERS, and PR
    /// descriptions. The why is evergreen and inherited across
    /// routine re-anchors; only write a new one when the subsystem
    /// itself changes.
    ///
    /// Bare `git span why <name>` prints the current why; a
    /// positional argument writes a new why into the span file;
    /// piped stdin also writes. Commit with `git add .span &&
    /// git commit`.
    Why(WhyArgs),

    /// Delete a span.
    Delete(DeleteArgs),

    /// Audit the local span setup.
    Doctor(DoctorArgs),

    /// Trace blast radius: render a clique-grouped impact tree rooted at
    /// the files matched by the given paths/globs.
    ///
    /// Starting from the matched anchor paths, the tree expands outward
    /// through span co-occurrence to the files each could affect. Files
    /// that all anchor the same span — and are therefore mutually
    /// connected — collapse onto a single comma-separated line and expand
    /// once as a unit, so a cluster that moves together reads as one line.
    ///
    /// Roots are file paths and globs only, resolved repo-relative with
    /// the same `globset` matching and exact-path lookup as `list`/`stale`
    /// (no CWD-relative joining). Unlike `list`/`stale`, `tree` does NOT
    /// accept `#L<start>-L<end>` line-range addresses or bare span names.
    /// At least one argument is required, and a pattern matching no
    /// anchored file is an error. `-d`/`--depth` bounds the expansion
    /// (default 3; `--depth 0` prints roots only). `--format human` (the
    /// default) prints the nested markdown list; `--format json` emits the
    /// same structure as nested `{ "members": [...], "children": [...] }`
    /// nodes for tooling.
    ///
    /// Multiple roots are supported and encouraged: pass every file
    /// whose blast radius you're tracing in one call — e.g. `git span
    /// tree fileA fileB fileC --depth 2` — rather than invoking `tree`
    /// once per file and merging the outputs by hand. All roots are
    /// unioned before clique grouping, so files that share a span
    /// collapse onto one clique line exactly as they would from a
    /// single-root call, while roots with no span in common still
    /// surface as separate top-level trees in the same listing.
    Tree(TreeArgs),

    /// Resolve `.span/` merge conflicts structurally when invoked by git
    /// as a merge driver. Receives three clean blob temp files and the
    /// marker length from git. Resolves only what is structurally
    /// derivable without trusting the worktree (which may be mid-merge);
    /// defers same-anchor range/hash divergence by writing minimal
    /// conflict markers and exiting non-zero so `git span stale --fix`
    /// can finish authoritatively.
    ///
    /// Register in `.gitattributes`:
    /// ```gitattributes
    /// .span/** merge=span
    /// ```
    ///
    /// Register in `.git/config`:
    /// ```ini
    /// [merge "span"]
    ///     name = git-span structural span merge
    ///     driver = git span merge-driver %O %A %B %L
    /// ```
    #[command(name = "merge-driver")]
    MergeDriver(MergeDriverArgs),

    /// Show a chronological timeline of a span file's git history: each commit
    /// where the span changed, rendered oldest→newest, with the content of any
    /// anchor that was added, modified, or removed, and an optional `current`
    /// entry describing how the working tree has drifted from HEAD.
    ///
    /// Outputs XML by default; use `--format json` for JSON.
    History(HistoryArgs),
}

/// `git span <name>` / `git span show <name>`.
#[derive(Debug, clap::Args)]
pub struct ShowArgs {
    /// Span name. Required (the bare `git span` form with no name is
    /// handled by the `Commands::None` branch in `main`, which lists
    /// every span).
    pub name: String,
}

#[derive(Debug, clap::Args)]
pub struct ListArgs {
    /// File paths, `<path>#L<start>-L<end>` ranges, or bare span names to list.
    /// Omit to list all spans.
    pub targets: Vec<String>,

    /// Emit one tab-separated row per anchor instead of human blocks.
    #[arg(long)]
    pub porcelain: bool,

    /// Skip the first N spans (after filtering, before --limit).
    #[arg(long, value_name = "N", default_value_t = 0)]
    pub offset: usize,

    /// Cap output at N spans (after filtering and --offset).
    #[arg(long, value_name = "N")]
    pub limit: Option<usize>,

    /// One line per anchor: `<span-name>` `<canonical-address>`.
    #[arg(long)]
    pub oneline: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum StaleFormat {
    Human,
    Porcelain,
    Json,
}

#[derive(Debug, Clone, clap::Args)]
pub struct StaleArgs {
    /// File paths, globs, or span names to report staleness for.
    /// Omit to scan all spans.
    pub paths: Vec<String>,

    #[arg(long, value_enum, default_value_t = StaleFormat::Human)]
    pub format: StaleFormat,

    /// Exit 0 even when drift is found (report-only mode).
    #[arg(long)]
    pub no_exit_code: bool,

    /// Write a CSV of per-anchor wall-clock traces to PATH.
    /// Requires a full scan (no positional paths). Columns:
    /// span,anchor_id,anchor_sha,path,wall_us,fast_path,status.
    /// See packages/git-span/docs/profiling.md for schema and examples.
    #[arg(long, value_name = "PATH")]
    pub perf_trace: Option<std::path::PathBuf>,

    /// Re-anchor `Moved` anchors unconditionally and whitespace-equivalent
    /// `Changed` anchors in place by rewriting the span worktree files. A
    /// `Changed` anchor whose content differs beyond whitespace is left
    /// drifting — the stored hash gates on content-equivalence so that
    /// meaning-altering edits keep surfacing until the operator confirms
    /// them. Each surfacing anchor is re-hashed against the deepest drifting
    /// layer (Worktree > Index > HEAD). Also resolves `.span/` merge
    /// conflicts structurally: splits conflict markers into ours/theirs,
    /// enforces a clean-source precondition (all referenced source files
    /// must be conflict-free), and calls the structural merge kernel. Fully
    /// resolved spans are written clean; spans with residual unresolvable
    /// anchors or divergent `--why` text (no merge base) write resolved
    /// anchors cleanly with minimal residue markers and are not re-staged.
    /// No commit is produced. Only supported with `--format human`.
    #[arg(long)]
    pub fix: bool,

    /// Group this run's stale spans into connected-component clusters by
    /// shared anchored file, so each cluster can be dispatched
    /// independently. Rendered as an additional section/field in every
    /// `--format`.
    #[arg(long)]
    pub cluster: bool,
}

#[derive(Debug, clap::Args)]
pub struct AddArgs {
    /// Span name to stage into.
    pub name: String,

    #[arg(
        required = true,
        trailing_var_arg = false,
        allow_hyphen_values = false,
        help = "One or more anchors to stage (<path> for whole-file, or <path>#L<start>-L<end> for line-anchor)",
        long_help = "One or more anchors to stage. Each is either:\n  <path>                       whole-file anchor\n  <path>#L<start>-L<end>       line-anchor anchor (1-indexed, inclusive)\n\nExample: git span add api-contract src/api.ts#L1-L3 tests/api.test.ts"
    )]
    pub anchors: Vec<String>,

    /// Hash every anchor in this invocation against the file content at
    /// `<commit-ish>` (an ordinary git commit-ish). Default is HEAD.
    #[arg(long, value_name = "COMMIT-ISH")]
    pub at: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct RemoveArgs {
    /// Span to stage the removal into.
    pub name: String,

    /// Anchor(s) to remove, as `<path>` or `<path>#L<start>-L<end>`
    /// (must match an existing anchor on the span).
    #[arg(required = true)]
    pub anchors: Vec<String>,
}

#[derive(Debug, clap::Args)]
pub struct WhyArgs {
    /// Span whose why text to read or stage. The why defines the
    /// subsystem the anchors form together.
    pub name: String,

    /// Why text to write into the span. One complete present-tense
    /// sentence defining the subsystem the anchors form together —
    /// no rules, warnings, or review steps; evergreen and inherited
    /// across routine re-anchors. Omit to read from stdin (when
    /// piped) or print the current why (when stdin is a terminal).
    pub why_text: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct DeleteArgs {
    /// Span to delete (removes its file under the span root).
    pub name: String,
}

#[derive(Debug, clap::Args)]
pub struct DoctorArgs {
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum TreeFormat {
    Human,
    Json,
}

#[derive(Debug, clap::Args)]
pub struct TreeArgs {
    /// File paths or globs to use as tree roots (repo-relative, required).
    #[arg(required = true, num_args = 1..)]
    pub globs: Vec<String>,

    /// Maximum expansion depth (0 = roots only).
    #[arg(short = 'd', long, default_value_t = 3)]
    pub depth: usize,

    /// Output format.
    #[arg(long, value_enum, default_value_t = TreeFormat::Human)]
    pub format: TreeFormat,
}

/// Arguments for `git span merge-driver`, matching git's merge driver
/// protocol (%O %A %B %L).
#[derive(Debug, clap::Args)]
pub struct MergeDriverArgs {
    /// Base version (%O from git) — the merge-base span temp file path.
    pub base: String,

    /// Ours version (%A from git) — this is also the output file path.
    pub ours: String,

    /// Theirs version (%B from git).
    pub theirs: String,

    /// Conflict marker length (%L from git).
    pub marker_len: u32,
}

/// Output format for `git span history`.
#[derive(Debug, Copy, Clone, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum HistoryFormat {
    Xml,
    Json,
}

/// Arguments for `git span history <span>`.
#[derive(Debug, clap::Args)]
pub struct HistoryArgs {
    /// Span name whose git history to walk.
    pub span: String,

    /// Output format (xml or json).
    #[arg(long, value_enum, default_value_t = HistoryFormat::Xml)]
    pub format: HistoryFormat,

    /// Cap the walk at N commits (newest N are inspected).
    #[arg(short = 'n', long)]
    pub limit: Option<usize>,
}

/// Parse a `<path>#L<start>-L<end>` anchor address.
///
/// Utility lives here (rather than `validation.rs`) because it's a CLI
/// concern — the library side takes already-split `(path, start, end)`
/// arguments.
///
/// Uses tail-anchored `#L` matching (last occurrence) so filenames
/// containing `#L` (e.g. `notes/issue#L42.md`) are not misparsed.
/// This grammar agrees with [`BatchFilter::parse`].
pub fn parse_range_address(text: &str) -> anyhow::Result<(String, u32, u32)> {
    let hash_pos = text.rfind("#L").ok_or_else(|| {
        anyhow::anyhow!("invalid anchor `{text}`; expected <path>#L<start>-L<end>")
    })?;
    let path = &text[..hash_pos];
    let fragment = &text[hash_pos + 2..];
    let (start, end) = fragment.split_once("-L").ok_or_else(|| {
        anyhow::anyhow!("invalid anchor `{text}`; expected <path>#L<start>-L<end>")
    })?;
    anyhow::ensure!(!path.is_empty(), "anchor path cannot be empty");
    let start: u32 = start.parse()?;
    let end: u32 = end.parse()?;
    anyhow::ensure!(start >= 1, "anchor start must be at least 1");
    anyhow::ensure!(end >= start, "anchor end must be at least start");
    Ok((path.to_string(), start, end))
}

/// Dispatch a parsed [`Commands`] to its handler. Called from `main`.
///
/// `span_dir` is the optional `--span-dir` CLI value, passed through to
/// handlers that need to resolve the span root directory.
pub fn dispatch(
    repo: &gix::Repository,
    command: Commands,
    span_dir: Option<&str>,
) -> anyhow::Result<i32> {
    // Resolve the span root once, here, through the single precedence
    // chain (`--span-dir` > `GIT_SPAN_DIR` > `git config git-span.dir`
    // > `.span`). Every handler — read, write, management, advice,
    // doctor — and the resolver engine + cache key derivation operate
    // on this resolved root, so writer and all readers agree.
    let env_dir = std::env::var("GIT_SPAN_DIR").ok();
    let span_root = crate::span_root::resolve_span_root(repo, span_dir, env_dir.as_deref())
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let span_root = span_root.as_str();
    match command {
        Commands::Show(args) => {
            let _perf = crate::perf::span("command.show");
            show::run_show(repo, args, span_root)
        }
        Commands::List(args) => {
            let _perf = crate::perf::span("command.list");
            show::run_list(repo, args, span_root)
        }
        Commands::Stale(args) => {
            let _perf = crate::perf::span("command.stale");
            stale_output::run_stale(repo, args, span_root)
        }
        Commands::Add(args) => {
            let _perf = crate::perf::span("command.add");
            commit::run_add(repo, args, span_root)
        }
        Commands::Remove(args) => {
            let _perf = crate::perf::span("command.remove");
            commit::run_remove(repo, args, span_root)
        }
        Commands::Why(args) => {
            let _perf = crate::perf::span("command.why");
            commit::run_why(repo, args, span_root)
        }
        Commands::Delete(args) => {
            let _perf = crate::perf::span("command.delete");
            doctor::run_delete(repo, args, span_root)
        }
        Commands::Doctor(args) => {
            let _perf = crate::perf::span("command.doctor");
            doctor::run_doctor(repo, args, span_root)
        }
        Commands::Tree(args) => {
            let _perf = crate::perf::span("command.tree");
            tree::run_tree(repo, args, span_root)
        }
        Commands::MergeDriver(args) => {
            let _perf = crate::perf::span("command.merge-driver");
            merge_driver::run_merge_driver(args)
        }
        Commands::History(args) => {
            let _perf = crate::perf::span("command.history");
            history::run_history(repo, args, span_root)
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_address_tail_anchored_hash_l() {
        // A filename like `notes/issue#L42.md` contains `#L` as part of its
        // name, not as a line-range delimiter. When #L appears in both the
        // filename and as a real line-range delimiter, the tail-anchored
        // parse must use the LAST #L.
        //
        // notes/issue#L42.md#L10-L20 → path=notes/issue#L42.md, start=10, end=20
        //
        // The current implementation uses `split_once("#L")` which splits on
        // the FIRST occurrence, misparsing:
        //   path=notes/issue  fragment=42.md#L10-L20
        // The tail `42.md#L10` is not a valid u32 → error.
        let result = parse_range_address("notes/issue#L42.md#L10-L20");
        assert!(
            result.is_ok(),
            "BUG: parse_range_address should accept tail-anchored #L10-L20 \
             even when #L appears earlier in the filename"
        );
        let (path, start, end) = result.unwrap();
        assert_eq!(path, "notes/issue#L42.md");
        assert_eq!(start, 10);
        assert_eq!(end, 20);
    }
}
