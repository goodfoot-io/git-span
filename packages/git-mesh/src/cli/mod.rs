//! CLI top-level — parses args and dispatches to library functions.
//!
//! Design choices:
//!
//! * **`anyhow::Result<i32>` at the CLI boundary.** CLI handlers return
//!   `anyhow::Result<i32>` so exit codes are first-class (§10.4
//!   distinguishes `0`, `1`, `2` for `git mesh stale`). Library errors
//!   (`crate::Error`) convert via `?`; `anyhow` keeps the dispatch
//!   layer from having to enumerate variants.
//!
//! * **`git mesh <name>` vs `git mesh <subcommand>`.** Clap cannot
//!   disambiguate a positional-name from a subcommand without help.
//!   We handle this in [`crate::main`] by checking the first argument
//!   against [`crate::validation::RESERVED_MESH_NAMES`] (the spec's
//!   reserved list, §10.2) before parsing. A reserved token is treated
//!   as a subcommand; anything else is a mesh name passed to the
//!   `Show` handler.

pub mod advice;
pub mod commit;
pub mod doctor;
pub mod drift_label;
pub mod error;
pub mod format;
pub mod show;
pub mod stale_output;

pub use drift_label::format_drift_label;

pub use error::{CliError, NextStep, from_lib_error, render_error};

use clap::{Parser, Subcommand, ValueEnum};

/// Top-level `git-mesh` command.
#[derive(Debug, Parser)]
#[command(
    name = "git-mesh",
    about = "Track implicit semantic dependencies in a git repo.",
    version,
    after_help = "A mesh holds the anchors — line-anchor or whole-file, in code or prose — that participate in a coupling no schema, type, or test enforces, and carries a `why` that defines the subsystem those anchors collectively form. The why is evergreen and inherited across routine re-anchors; invariants, caveats, ownership, and review triggers belong in source comments, commit messages, CODEOWNERS, and PR descriptions.\n\nBare invocations:\n  git mesh <name>          show one mesh (anchors, why, config)"
)]
pub struct Cli {
    /// Emit performance timings for major git-mesh operation groups to stderr.
    ///
    /// Can also be enabled with `GIT_MESH_PERF=1`.
    #[arg(long, global = true)]
    pub perf: bool,

    /// Mesh root directory (default: .mesh). Overrides GIT_MESH_DIR and git config git-mesh.dir.
    #[arg(long, global = true)]
    pub mesh_dir: Option<String>,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// Every subcommand the CLI accepts. Mirrors §10.2.
#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Show the named mesh — its anchors, why, and config. Equivalent
    /// to the bare `git mesh <name>` positional form.
    #[command(name = "show")]
    Show(ShowArgs),

    /// List files and anchors currently tracked by a mesh.
    List(ListArgs),

    /// Report anchors whose content has drifted from their anchored state.
    Stale(StaleArgs),

    /// Add anchors to a mesh, writing the mesh file under the mesh root.
    /// Stage and commit the change with `git add .mesh && git commit`.
    Add(AddArgs),

    /// Remove anchors from a mesh, editing the mesh file under the mesh
    /// root. Stage and commit the change with `git add .mesh && git commit`.
    Remove(RemoveArgs),

    /// Read or stage the mesh's why — a one-sentence definition of
    /// the subsystem, flow, or concern the anchors collectively form.
    ///
    /// Write the why as a definition: name the subsystem and say
    /// plainly what it does across the anchors (e.g. "Checkout
    /// request flow that carries a charge attempt from the browser
    /// to the Stripe-backed server."). Leave invariants, caveats,
    /// ownership, and review triggers to source comments, commit
    /// messages, CODEOWNERS, and PR descriptions. The why is
    /// inherited across routine re-anchors; only write a new one
    /// when the subsystem itself changes.
    ///
    /// Bare `git mesh why <name>` prints the current why; the writer
    /// flags `-m`/`-F`/`--edit` write a new one into the mesh file
    /// (commit it with `git add .mesh && git commit`).
    Why(WhyArgs),

    /// Delete a mesh.
    Delete(DeleteArgs),

    /// Rename a mesh.
    Move(MoveArgs),

    /// Audit the local mesh setup.
    Doctor(DoctorArgs),

    /// Append events and flush session-scoped advice.
    Advice(advice::AdviceArgs),
}

/// `git mesh <name>` / `git mesh show <name>`.
#[derive(Debug, clap::Args)]
pub struct ShowArgs {
    /// Mesh name. Required (the bare `git mesh` form with no name is
    /// handled by the `Commands::None` branch in `main`, which lists
    /// every mesh).
    pub name: String,

    /// One line per anchor, no commit header.
    #[arg(long)]
    pub oneline: bool,

    /// Show the mesh as it existed in the git tree at a past commit-ish.
    #[arg(long, value_name = "COMMIT-ISH")]
    pub at: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct ListArgs {
    /// File paths, `<path>#L<start>-L<end>` ranges, or bare mesh names to list.
    /// Omit to list all meshes.
    pub targets: Vec<String>,

    /// Emit one tab-separated row per anchor instead of human blocks.
    #[arg(long)]
    pub porcelain: bool,

    /// Read newline-delimited path filters from stdin.
    #[arg(
        long,
        requires = "porcelain",
        conflicts_with_all = ["targets", "search", "offset", "limit"]
    )]
    pub batch: bool,

    /// Filter meshes whose name, why, or anchor addresses match a regex
    /// (case-insensitive by default; use `(?-i)` to re-enable case sensitivity).
    #[arg(long, value_name = "REGEX")]
    pub search: Option<String>,

    /// Skip the first N meshes (after filtering, before --limit).
    #[arg(long, value_name = "N", default_value_t = 0)]
    pub offset: usize,

    /// Cap output at N meshes (after filtering and --offset).
    #[arg(long, value_name = "N")]
    pub limit: Option<usize>,

    /// One line per anchor: `<mesh-name>` `<canonical-address>`.
    #[arg(long)]
    pub oneline: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum StaleFormat {
    Human,
    Porcelain,
    Json,
    Junit,
    GithubActions,
}

#[derive(Debug, Clone, clap::Args)]
pub struct StaleArgs {
    /// File paths, globs, or mesh names to report staleness for.
    /// Omit to scan all meshes.
    pub paths: Vec<String>,

    #[arg(long, value_enum, default_value_t = StaleFormat::Human)]
    pub format: StaleFormat,

    /// Exit 0 even when drift is found (report-only mode).
    #[arg(long)]
    pub no_exit_code: bool,

    /// Read mode: resolve against the HEAD layer only (ignore index and
    /// working tree). Mutually exclusive with `--staged`/`--worktree`
    /// and the `--no-*` layer toggles.
    #[arg(
        long,
        conflicts_with_all = ["staged", "worktree", "no_worktree", "no_index"]
    )]
    pub head: bool,

    /// Read mode: resolve against the staged view (index overlaid on
    /// HEAD); ignore working-tree changes. Mutually exclusive with
    /// `--head`/`--worktree` and the `--no-*` layer toggles.
    #[arg(
        long,
        conflicts_with_all = ["head", "worktree", "no_worktree", "no_index"]
    )]
    pub staged: bool,

    /// Read mode: resolve against the full working-tree view (worktree
    /// overlaid on index overlaid on HEAD) — the default effective view,
    /// named explicitly. Mutually exclusive with `--head`/`--staged`
    /// and the `--no-*` layer toggles.
    #[arg(
        long,
        conflicts_with_all = ["head", "staged", "no_worktree", "no_index"]
    )]
    pub worktree: bool,

    /// Skip the working-tree layer; scan only HEAD (and the index unless `--no-index`).
    #[arg(long)]
    pub no_worktree: bool,

    /// Skip the index layer.
    #[arg(long)]
    pub no_index: bool,

    /// Accepted for compatibility; no effect in the tracked-file model
    /// (mesh edits live in the worktree, not a separate staging area).
    #[arg(long)]
    pub no_staged_mesh: bool,

    /// Report unreadable content as informational instead of failing.
    #[arg(long)]
    pub ignore_unavailable: bool,

    /// One line per finding: `<STATUS> <path>#L<start>-L<end>`.
    #[arg(long, conflicts_with_all = ["stat", "patch"])]
    pub oneline: bool,

    /// Per-anchor summary with line counts added/removed relative to the anchor.
    #[arg(long, conflicts_with_all = ["oneline", "patch"])]
    pub stat: bool,

    /// Show the diff between the anchored content and the current content.
    #[arg(long, conflicts_with_all = ["oneline", "stat"])]
    pub patch: bool,

    /// Only anchors recorded at or after this commit.
    #[arg(long, value_name = "COMMIT-ISH")]
    pub since: Option<String>,

    /// Write a CSV of per-anchor wall-clock traces to PATH.
    /// Requires a full scan (no positional paths). Columns:
    /// mesh,anchor_id,anchor_sha,path,wall_us,fast_path,status.
    /// See packages/git-mesh/docs/profiling.md for schema and examples.
    #[arg(long, value_name = "PATH")]
    pub perf_trace: Option<std::path::PathBuf>,
}

#[derive(Debug, clap::Args)]
pub struct AddArgs {
    /// Mesh name to stage into.
    pub name: String,

    // Annotated `trailing_var_arg = false` + `allow_hyphen_values = false`
    // so a trailing `--at <commit-ish>` is parsed as the named flag,
    // not greedily consumed into `anchors`.
    #[arg(
        required = true,
        trailing_var_arg = false,
        allow_hyphen_values = false,
        help = "One or more anchors to stage (<path> for whole-file, or <path>#L<start>-L<end> for line-anchor)",
        long_help = "One or more anchors to stage. Each is either:\n  <path>                       whole-file anchor\n  <path>#L<start>-L<end>       line-anchor anchor (1-indexed, inclusive)\n\nExample: git mesh add api-contract src/api.ts#L1-L3 tests/api.test.ts"
    )]
    pub anchors: Vec<String>,

    /// Hash every anchor in this invocation against the file content at
    /// `<commit-ish>` (an ordinary git commit-ish). Default is HEAD.
    #[arg(long, value_name = "COMMIT-ISH")]
    pub at: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct RemoveArgs {
    /// Mesh to stage the removal into.
    pub name: String,

    /// Anchor(s) to remove, as `<path>` or `<path>#L<start>-L<end>`
    /// (must match an existing anchor on the mesh).
    #[arg(required = true)]
    pub anchors: Vec<String>,
}

#[derive(Debug, clap::Args)]
#[command(group(
    clap::ArgGroup::new("source")
        .args(["m", "file", "edit"])
        .required(false)
        .multiple(false)
))]
pub struct WhyArgs {
    /// Mesh whose why text to read (no writer flag) or stage
    /// (`-m` / `-F` / `--edit`). The why defines the subsystem the
    /// anchors collectively form.
    pub name: String,

    /// Inline why text (`-m "..."`). Writer flag. One sentence
    /// defining the subsystem the anchors form; evergreen and
    /// inherited across routine re-anchors.
    #[arg(short = 'm', value_name = "MSG")]
    pub m: Option<String>,

    /// Read why text from a file (`-F <file>`). Writer flag.
    #[arg(short = 'F', value_name = "FILE")]
    pub file: Option<String>,

    /// Open `$EDITOR` on a pre-populated template. Writer flag.
    #[arg(long, conflicts_with = "at")]
    pub edit: bool,

    /// Reader-only: print the why text as it existed in the mesh file
    /// at an ordinary git commit-ish (e.g. HEAD~3, a branch, a tag, a
    /// commit SHA). Mutually exclusive with `-m`/`-F`/`--edit`.
    #[arg(long, value_name = "COMMIT-ISH", conflicts_with_all = ["m", "file", "edit"])]
    pub at: Option<String>,
}

#[derive(Debug, clap::Args)]
pub struct DeleteArgs {
    /// Mesh to delete (removes its file under the mesh root).
    pub name: String,
}

#[derive(Debug, clap::Args)]
pub struct MoveArgs {
    /// Existing mesh name.
    pub old: String,

    /// New mesh name (must not already exist).
    pub new: String,
}

#[derive(Debug, clap::Args)]
pub struct DoctorArgs {
    /// Promote INFO and WARN findings to a non-zero exit.
    #[arg(long)]
    pub strict: bool,
}

/// Parse a `<path>#L<start>-L<end>` anchor address.
///
/// Utility lives here (rather than `validation.rs`) because it's a CLI
/// concern — the library side takes already-split `(path, start, end)`
/// arguments.
pub fn parse_range_address(text: &str) -> anyhow::Result<(String, u32, u32)> {
    let (path, fragment) = text.split_once("#L").ok_or_else(|| {
        anyhow::anyhow!("invalid anchor `{text}`; expected <path>#L<start>-L<end>")
    })?;
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
/// `mesh_dir` is the optional `--mesh-dir` CLI value, passed through to
/// handlers that need to resolve the mesh root directory.
pub fn dispatch(
    repo: &gix::Repository,
    command: Commands,
    mesh_dir: Option<&str>,
) -> anyhow::Result<i32> {
    // Resolve the mesh root once, here, through the single precedence
    // chain (`--mesh-dir` > `GIT_MESH_DIR` > `git config git-mesh.dir`
    // > `.mesh`). Every handler — read, write, management, advice,
    // doctor — and the resolver engine + cache key derivation operate
    // on this resolved root, so writer and all readers agree.
    let env_dir = std::env::var("GIT_MESH_DIR").ok();
    let mesh_root = crate::mesh_root::resolve_mesh_root(repo, mesh_dir, env_dir.as_deref())
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let mesh_root = mesh_root.as_str();
    match command {
        Commands::Show(args) => {
            let _perf = crate::perf::span("command.show");
            show::run_show(repo, args, mesh_root)
        }
        Commands::List(args) => {
            let _perf = crate::perf::span("command.list");
            show::run_list(repo, args, mesh_root)
        }
        Commands::Stale(args) => {
            let _perf = crate::perf::span("command.stale");
            stale_output::run_stale(repo, args, mesh_root)
        }
        Commands::Add(args) => {
            let _perf = crate::perf::span("command.add");
            commit::run_add(repo, args, mesh_root)
        }
        Commands::Remove(args) => {
            let _perf = crate::perf::span("command.remove");
            commit::run_remove(repo, args, mesh_root)
        }
        Commands::Why(args) => {
            let _perf = crate::perf::span("command.why");
            commit::run_why(repo, args, mesh_root)
        }
        Commands::Delete(args) => {
            let _perf = crate::perf::span("command.delete");
            doctor::run_delete(repo, args, mesh_root)
        }
        Commands::Move(args) => {
            let _perf = crate::perf::span("command.move");
            doctor::run_move(repo, args, mesh_root)
        }
        Commands::Doctor(args) => {
            let _perf = crate::perf::span("command.doctor");
            doctor::run_doctor(repo, args, mesh_root)
        }
        Commands::Advice(args) => {
            let _perf = crate::perf::span("command.advice");
            advice::run_advice(repo, args, mesh_root)
        }
    }
}
