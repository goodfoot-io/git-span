//! Cross-platform test-helper binary used by integration tests in place of
//! shell scripts (which are not portable to Windows). Behavior is selected
//! by the `HELPER_MODE` env var. Dependency-free (std only).
//!
//! Modes:
//! - `editor-replace`: overwrite argv[1] with `HELPER_CONTENT`.
//! - `editor-append`: append a newline + `HELPER_CONTENT` to argv[1].
//! - `editor-capture`: copy argv[1] to `<argv[1]>.seen`, then overwrite
//!   argv[1] with `HELPER_CONTENT`.
//! - `exec`: spawn `HELPER_TARGET` with this process's argv[1..], inherit
//!   stdio, and exit with the child's exit code.
//!
//! One mode is selected by **argv** rather than by `HELPER_MODE`:
//! `filter-process <transform>` speaks git's long-running
//! `filter.<name>.process` protocol on stdin/stdout. It is invoked by git
//! (and by the resolver) through `sh -c`, which inherits no test-controlled
//! environment, so the selector has to travel in the command string.

use std::io::{BufWriter, Read, Write};
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let mode = std::env::var("HELPER_MODE").unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.first().map(String::as_str) == Some("filter-process") {
        let transform = args.get(1).cloned().unwrap_or_default();
        return filter_process(&transform);
    }

    match mode.as_str() {
        "editor-replace" => {
            let target = &args[0];
            let content = std::env::var("HELPER_CONTENT").unwrap_or_default();
            std::fs::write(target, content).expect("editor-replace write");
            ExitCode::SUCCESS
        }
        "editor-append" => {
            let target = &args[0];
            let content = std::env::var("HELPER_CONTENT").unwrap_or_default();
            let mut existing = std::fs::read_to_string(target).unwrap_or_default();
            existing.push('\n');
            existing.push_str(&content);
            std::fs::write(target, existing).expect("editor-append write");
            ExitCode::SUCCESS
        }
        "editor-capture" => {
            let target = &args[0];
            let content = std::env::var("HELPER_CONTENT").unwrap_or_default();
            std::fs::copy(target, format!("{target}.seen")).expect("editor-capture copy");
            std::fs::write(target, content).expect("editor-capture write");
            ExitCode::SUCCESS
        }
        "exec" => {
            let prog = std::env::var("HELPER_TARGET").expect("HELPER_TARGET must be set");
            let status = Command::new(prog)
                .args(&args)
                .status()
                .expect("exec spawn target");
            ExitCode::from(status.code().unwrap_or(1) as u8)
        }
        other => {
            eprintln!("git-span-test-helper: unknown HELPER_MODE: {other:?}");
            ExitCode::from(2)
        }
    }
}

/// The three-line body every `pointer` transform emits, in git-lfs's own
/// pointer shape. Three lines is load-bearing: it is *shorter* than the
/// five-line fixture files, so a `#L4-L5` anchor is in range on the file the
/// user sees and past the end of the bytes git records.
const POINTER: &[u8] =
    b"version https://git-lfs.github.com/spec/v1\noid sha256:0000000000000000\nsize 15\n";

/// A working `filter.<name>.process` driver — one that exits 0, completes the
/// handshake, and *produces content*. That is the discriminator the states
/// around it turn on: a driver that produces no content at all is a failed
/// filter, while this one succeeds and merely returns something other than
/// what is on disk, which is what every content-transforming filter in the
/// wild (git-lfs, git-crypt, nbstripout) does.
///
/// `transform`:
/// - `pointer`  — replace the whole body with [`POINTER`].
/// - `identity` — return the input unchanged.
fn filter_process(transform: &str) -> ExitCode {
    let stdin = std::io::stdin();
    let mut r = stdin.lock();
    let stdout = std::io::stdout();
    let mut w = BufWriter::new(stdout.lock());

    // Handshake: consume the client's welcome, answer, consume its
    // capability list, answer with ours.
    if drain(&mut r).is_none() {
        return ExitCode::SUCCESS;
    }
    if pkt_write(&mut w, b"git-filter-server\n").is_err()
        || pkt_write(&mut w, b"version=2\n").is_err()
        || flush(&mut w).is_err()
    {
        return ExitCode::from(1);
    }
    if drain(&mut r).is_none() {
        return ExitCode::SUCCESS;
    }
    if pkt_write(&mut w, b"capability=clean\n").is_err()
        || pkt_write(&mut w, b"capability=smudge\n").is_err()
        || flush(&mut w).is_err()
    {
        return ExitCode::from(1);
    }

    loop {
        // Command headers, then the payload, each terminated by a flush.
        let Some(headers) = drain(&mut r) else {
            return ExitCode::SUCCESS;
        };
        if headers.is_empty() {
            return ExitCode::SUCCESS;
        }
        let Some(payload) = drain(&mut r) else {
            return ExitCode::SUCCESS;
        };
        let input: Vec<u8> = payload.concat();
        let output: Vec<u8> = match transform {
            "pointer" => POINTER.to_vec(),
            _ => input,
        };
        let wrote = pkt_write(&mut w, b"status=success\n")
            .and_then(|()| flush(&mut w))
            .and_then(|()| {
                for chunk in output.chunks(65516) {
                    pkt_write(&mut w, chunk)?;
                }
                Ok(())
            })
            .and_then(|()| flush(&mut w))
            .and_then(|()| pkt_write(&mut w, b"status=success\n"))
            .and_then(|()| flush(&mut w));
        if wrote.is_err() {
            return ExitCode::from(1);
        }
    }
}

/// Read pkt-lines until the next flush packet. `None` on EOF mid-frame.
fn drain(r: &mut impl Read) -> Option<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    loop {
        let mut hdr = [0u8; 4];
        if r.read_exact(&mut hdr).is_err() {
            return None;
        }
        let len = u32::from_str_radix(std::str::from_utf8(&hdr).ok()?, 16).ok()?;
        if len == 0 {
            return Some(out);
        }
        let mut body = vec![0u8; (len as usize).checked_sub(4)?];
        if r.read_exact(&mut body).is_err() {
            return None;
        }
        out.push(body);
    }
}

fn pkt_write(w: &mut impl Write, bytes: &[u8]) -> std::io::Result<()> {
    write!(w, "{:04x}", bytes.len() + 4)?;
    w.write_all(bytes)
}

fn flush(w: &mut impl Write) -> std::io::Result<()> {
    w.write_all(b"0000")?;
    w.flush()
}
