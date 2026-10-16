//! `list`, `listen`, and `wait`: three views over the same matching implementation.

use std::collections::BTreeSet;
use std::io::{self, Write};
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

use clap::Args;

use crate::error::{Error, Result};
use crate::observe::{self, Filters, Kind, Observation};
use crate::duration;

#[derive(Args)]
pub struct ListArgs {
    #[command(flatten)]
    filters: Filters,
    /// One JSON object per line
    #[arg(long, conflicts_with = "names_only")]
    json: bool,
    /// One ordinary name per line
    #[arg(long = "names-only")]
    names_only: bool,
}

#[derive(Args)]
pub struct ListenArgs {
    #[command(flatten)]
    filters: Filters,
    /// First emit current matches (labeled 'existing')
    #[arg(long)]
    existing: bool,
    /// Exit after the first match is emitted or its callback succeeds
    #[arg(long)]
    once: bool,
    /// Observation interval
    #[arg(long = "poll-interval", value_name = "d", default_value = "1s", value_parser = duration::parse)]
    poll_interval: Duration,
    /// Command invoked once per match with the JSON line on stdin
    #[arg(last = true, value_name = "command")]
    command: Vec<String>,
}

#[derive(Args)]
pub struct WaitArgs {
    #[command(flatten)]
    filters: Filters,
    /// Wait until no names satisfy the filters
    #[arg(long)]
    absent: bool,
    /// Stop after this duration (exit 3)
    #[arg(long, value_name = "d", value_parser = duration::parse)]
    timeout: Option<Duration>,
}

fn write_stdout(text: &str) -> Result<()> {
    let mut out = io::stdout().lock();
    out.write_all(text.as_bytes())?;
    out.flush()?;
    Ok(())
}

pub fn list(args: &ListArgs) -> Result<()> {
    let rows = args.filters.select(observe::scan()?);
    let mut text = String::new();
    if args.json {
        for o in &rows {
            text.push_str(&o.to_json(None));
            text.push('\n');
        }
    } else if args.names_only {
        for o in &rows {
            text.push_str(&o.name);
            text.push('\n');
        }
    } else {
        text = observe::print_table(&rows);
    }
    write_stdout(&text)
}

fn deliver(command: &[String], line: &str) -> Result<()> {
    let Some((program, rest)) = command.split_first() else {
        return write_stdout(&format!("{line}\n"));
    };
    let mut child = Command::new(program)
        .args(rest)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|err| Error(format!("cannot run '{program}': {err}")))?;
    if let Some(mut stdin) = child.stdin.take() {
        match stdin.write_all(format!("{line}\n").as_bytes()) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::BrokenPipe => {}
            Err(err) => return Err(err.into()),
        }
    }
    let status = child.wait()?;
    if !status.success() {
        bail!("callback '{program}' failed ({status})");
    }
    Ok(())
}

pub fn listen(args: &ListenArgs) -> Result<()> {
    let all = observe::scan()?;
    let mut seen: BTreeSet<(Kind, String)> = all.iter().map(|o| (o.kind, o.name.clone())).collect();
    if args.existing {
        for o in args.filters.select(all) {
            deliver(&args.command, &o.to_json(Some("existing")))?;
            if args.once {
                return Ok(());
            }
        }
    }
    loop {
        std::thread::sleep(args.poll_interval);
        let all = observe::scan()?;
        let current: BTreeSet<(Kind, String)> = all.iter().map(|o| (o.kind, o.name.clone())).collect();
        let created: Vec<Observation> = all
            .into_iter()
            .filter(|o| !seen.contains(&(o.kind, o.name.clone())) && args.filters.matches(o))
            .collect();
        seen = current;
        for o in created {
            deliver(&args.command, &o.to_json(Some("created")))?;
            if args.once {
                return Ok(());
            }
        }
    }
}

pub fn wait(args: &WaitArgs) -> Result<ExitCode> {
    let start = Instant::now();
    loop {
        let matches = args.filters.select(observe::scan()?);
        if args.absent {
            if matches.is_empty() {
                return Ok(ExitCode::SUCCESS);
            }
        } else if let Some(first) = matches.first() {
            write_stdout(&format!("{}\n", first.to_json(None)))?;
            return Ok(ExitCode::SUCCESS);
        }
        let step = Duration::from_secs(1);
        let pause = match args.timeout {
            Some(limit) => {
                let elapsed = start.elapsed();
                if elapsed >= limit {
                    eprintln!("git-mora: timed out waiting");
                    return Ok(ExitCode::from(3));
                }
                step.min(limit - elapsed)
            }
            None => step,
        };
        std::thread::sleep(pause);
    }
}

pub fn requires_filter(args: &WaitArgs) -> bool {
    !args.filters.is_empty()
}
