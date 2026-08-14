//! `git-span` CLI entrypoint.

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser};
use git_span::cli::{self, Cli, CliError, Commands, NextStep, ShowArgs};
use git_span::validation::{RETIRED_SPAN_NAMES, is_reserved_span_name};

fn main() {
    // Slice 6a: restore the default Unix SIGPIPE handler so a broken
    // downstream pipe (`git span ... | head`) becomes a clean exit
    // rather than a Rust panic on `println!`.
    #[cfg(unix)]
    // SAFETY: `signal` with `SIG_DFL` is async-signal-safe and is the
    // canonical recipe for restoring the default disposition that Rust
    // overrides on startup. Called once before any I/O.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }

    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            // Clap usage errors (bad flag, missing arg) keep clap's
            // own exit-2 contract (and its formatted message, plus
            // exit 0 for `--help` / `--version`). Everything else is
            // an operational failure → exit 1, matching the convention
            // used by `git`, `cargo`, and POSIX tooling.
            match error.downcast::<clap::Error>() {
                Ok(clap_err) => clap_err.exit(),
                Err(error) => {
                    // If this is a CliError, render it in the structured
                    // prose shape. Otherwise fall back to anyhow's alternate
                    // display.
                    if let Some(cli_err) = error.downcast_ref::<git_span::cli::CliError>() {
                        eprintln!("{}", git_span::cli::render_error(cli_err));
                    } else {
                        eprintln!("error: {error:#}");
                    }
                    std::process::exit(1);
                }
            }
        }
    }
}

fn run() -> Result<i32> {
    let args: Vec<String> = std::env::args().collect();

    // §10.2: `git span` with no arg lists every span; `git span <name>`
    // is a positional show. Clap can't distinguish a bare-name positional
    // from a subcommand, so we pre-classify before invoking the parser.
    // A reserved or retired token is a subcommand; anything else is a span
    // name and routes to `Commands::Show`.
    //
    // Repo discovery happens after parsing so `--help` and any other
    // clap-handled flag works outside a git repo.
    if args.len() == 1 {
        Cli::command().print_help()?;
        println!();
        return Ok(0);
    }
    // Skip leading `--perf` so a bare `git span <name>` still routes to
    // `show` even when prefixed by `--perf`.
    let mut idx = 1usize;
    while idx < args.len() {
        let tok = args[idx].as_str();
        if tok == "--perf" {
            idx += 1;
        } else {
            break;
        }
    }

    let first_non_opt = args.get(idx);

    // A retired subcommand answers with its replacement rather than running.
    // This must come before the bare-name classification below: a retired
    // token is reserved, so it would otherwise be spliced into `show` and
    // reported as a missing *span*, sending the user to `git span list` —
    // which enumerates spans and can never mention the new subcommand. The
    // refusal is unconditional and ignores the rest of the argv, so
    // `git span stale --format porcelain` gets the rename too rather than a
    // clap usage error about flags on a command that no longer exists.
    //
    // The refusal must also reach `git span help stale`: clap's `help`
    // subcommand resolves its argument as a subcommand name, so a retired
    // token hides one position further right — without the peek below it
    // reaches clap as an "unrecognized subcommand" (exit 2) and never
    // names the replacement.
    let retirement_probe = if first_non_opt.map(String::as_str) == Some("help") {
        args.get(idx + 1)
    } else {
        first_non_opt
    };

    if let Some((retired, replacement)) = RETIRED_SPAN_NAMES
        .iter()
        .find(|(retired, _)| Some(*retired) == retirement_probe.map(String::as_str))
    {
        return Err(CliError {
            subcommand: retired,
            summary: format!("this subcommand was retired; use `git span {replacement}`."),
            what_happened: format!(
                "`git span {retired}` no longer exists and has no alias — it was renamed to \
                 `git span {replacement}`. `{retired}` is still reserved, so it is not being \
                 read as a span name either."
            ),
            next_steps: vec![NextStep::Bash(format!("git span {replacement}"))],
        }
        .into());
    }

    // `is_reserved_span_name` — not the bare reserved list — so this
    // classification and `validate_span_name` can never disagree about which
    // tokens are span names. A retired token is unreachable here (the refusal
    // above returns first), but the two rules staying in lockstep is what
    // stopped `stale` from being routed to `show` in the first place.
    let is_bare_name = first_non_opt.is_some_and(|first| {
        !first.starts_with('-')
            && first != "__context-service"
            && !is_reserved_span_name(first)
            && !matches!(first.as_str(), "help" | "--help" | "-h")
    });

    if is_bare_name {
        // Bare `git span [global-opts] <name> [--flags...]` — splice an
        // explicit `show` subcommand in front of the name so clap parses
        // the tail as ShowArgs while preserving the leading global opts.
        let first = first_non_opt.expect("is_bare_name implies Some").clone();
        let mut show_argv: Vec<String> = Vec::with_capacity(args.len() + 1);
        show_argv.push(args[0].clone());
        show_argv.extend(args[1..idx].iter().cloned());
        show_argv.push("show".to_string());
        show_argv.extend(args[idx..].iter().cloned());
        let cli = Cli::try_parse_from(show_argv)?;
        git_span::perf::init(cli.perf);
        let cmd = cli.command.unwrap_or_else(|| {
            Commands::Show(ShowArgs {
                name: first.clone(),
            })
        });
        let repo = discover_repo()?;
        return cli::dispatch(&repo, cmd, None);
    }

    // Parse first so `--help` short-circuits before we touch the
    // filesystem for repo discovery.
    let cli = Cli::parse();
    git_span::perf::init(cli.perf);

    let repo = discover_repo()?;
    match cli.command {
        Some(cmd) => cli::dispatch(&repo, cmd, None),
        None => {
            Cli::command().print_help()?;
            println!();
            Ok(0)
        }
    }
}

fn discover_repo() -> Result<gix::Repository> {
    let _perf = git_span::perf::span("git.discover");
    // Canonicalise "." to an absolute path so that `gix::discover` returns
    // a repository with absolute workdir/git_dir paths.  When a repo is
    // opened with relative paths (workdir = Some(".")), gix reference and
    // object lookups that the resolver performs can fail to resolve paths
    // correctly.
    let cwd = std::fs::canonicalize(".").context("canonicalize cwd")?;
    let mut repo = gix::discover(cwd).context("not inside a git repository")?;
    // `core.useReplaceRefs=false` means Git runs on raw objects, but gix
    // 0.84 reads that key through an inverted default (`is_disabled =
    // value.unwrap_or(true)` in `replacement_objects_refs_prefix`): unset
    // loads no replacements, while an explicit `false` *loads* them —
    // exactly the raw-vs-effective divergence
    // `reject_replacement_topology` exists to refuse. Promote a cleanly
    // parsed `false` to GIT_NO_REPLACE_OBJECTS before re-opening: gix's
    // env mapping then loads no replacements under any namespace, the
    // topology gate's env-var clause disables itself for the same reason,
    // and spawned `git` subprocesses inherit semantics the repository's
    // config already declares. An unparseable value is left alone so the
    // gate can fail closed on it.
    if matches!(
        repo.config_snapshot().try_boolean("core.useReplaceRefs"),
        Some(Ok(false))
    ) {
        // SAFETY: `discover_repo` runs before dispatch spawns any worker
        // threads, so mutating the process environment cannot race a
        // concurrent `getenv`.
        unsafe {
            std::env::set_var("GIT_NO_REPLACE_OBJECTS", "1");
        }
        repo = gix::open_opts(repo.path(), gix::open::Options::default())
            .context("reopen repository with replacement objects disabled")?;
    }
    // Enable gix's object cache so repeated `find_object`/tree-peel calls
    // during the resolver hot path reuse decoded objects. No-op if a cache
    // is already set; pure performance, no behavior change.
    repo.object_cache_size_if_unset(16 * 1024 * 1024);
    Ok(repo)
}
