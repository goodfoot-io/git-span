//! `git-span` CLI entrypoint.

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser};
use git_span::cli::{self, Cli, Commands, ShowArgs};
use git_span::validation::RESERVED_SPAN_NAMES;

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
    // A token on the §10.2 reserved list is a subcommand; anything else
    // is a span name and routes to `Commands::Show`.
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
    let is_bare_name = first_non_opt.is_some_and(|first| {
        !first.starts_with('-')
            && !RESERVED_SPAN_NAMES.contains(&first.as_str())
            && !matches!(first.as_str(), "show" | "help" | "--help" | "-h")
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
    // Enable gix's object cache so repeated `find_object`/tree-peel calls
    // during the resolver hot path reuse decoded objects. No-op if a cache
    // is already set; pure performance, no behavior change.
    repo.object_cache_size_if_unset(16 * 1024 * 1024);
    Ok(repo)
}
