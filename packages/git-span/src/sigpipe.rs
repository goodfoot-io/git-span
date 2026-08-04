//! Scoped suppression of the default `SIGPIPE` disposition.
//!
//! `main` restores `SIG_DFL` for `SIGPIPE` so that `git span history | head`
//! dies the way `git log | head` does — silently, killed by the signal,
//! instead of panicking inside `println!`. That disposition is process-wide,
//! and it applies to *every* pipe the process writes to, not just stdout.
//!
//! One of those pipes is a filter driver's stdin. A driver named in
//! `filter.<name>.process` (or `.clean`/`.smudge`) that is configured but not
//! installed is spawned through `sh`, which prints `not found` and exits 127
//! immediately. Whether the handshake bytes reach the pipe before that exit is
//! a scheduling race: win it and the write lands, lose it and the write raises
//! `SIGPIPE` and kills git-span with signal 13 — no diagnostic, no exit code,
//! no `unavailable` reason, in a state the resolver already knows how to
//! describe as `filter failed`. Under load the race is lost often enough to be
//! a recurring flake and, for a user whose git-crypt is simply not installed,
//! an intermittently silent death.
//!
//! [`SigpipeIgnored`] narrows the default disposition to the window where it
//! is wanted. Inside the guard `SIGPIPE` is ignored, so a write to a dead
//! child returns `EPIPE` as an ordinary `io::Error` that the filter layer
//! already routes to `FilterSpawnError` / `CustomFilterOutcome::FilterFailed`.
//! The guard is reference-counted: nested and concurrent filter I/O share one
//! window, and the *previous* disposition — whatever it was — is restored only
//! when the last guard drops. Restoring what was there rather than asserting
//! `SIG_DFL` matters because the library runs outside `main` too: under `cargo
//! test` the disposition is Rust's own `SIG_IGN`, and a guard that "restored"
//! `SIG_DFL` would leave the test harness able to die on a broken pipe it used
//! to survive.

/// RAII guard that ignores `SIGPIPE` for as long as it is alive.
///
/// Construct one around any write to a subprocess pipe whose peer may already
/// be gone. Dropping it restores `SIG_DFL` once no guard remains.
pub(crate) struct SigpipeIgnored {
    _private: (),
}

#[cfg(unix)]
mod imp {
    use std::sync::Mutex;

    /// Guard depth plus the disposition displaced by the outermost guard.
    /// One mutex rather than two atomics: the depth transition and the
    /// `signal` call that accompanies it have to be one step, or a second
    /// thread entering while the first is between them installs `SIG_IGN`
    /// twice and records `SIG_IGN` as the thing to restore.
    static STATE: Mutex<(usize, libc::sighandler_t)> = Mutex::new((0, libc::SIG_DFL));

    pub(super) fn enter() {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if state.0 == 0 {
            // SAFETY: `signal` with `SIG_IGN` is async-signal-safe and is the
            // disposition Rust itself installs at startup; we are restoring
            // it for the duration of the window, not inventing one.
            state.1 = unsafe { libc::signal(libc::SIGPIPE, libc::SIG_IGN) };
        }
        state.0 += 1;
    }

    pub(super) fn leave() {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        state.0 -= 1;
        if state.0 == 0 {
            let previous = state.1;
            // SAFETY: same contract as above, reinstating exactly the handler
            // `enter` displaced.
            unsafe {
                libc::signal(libc::SIGPIPE, previous);
            }
        }
    }
}

impl SigpipeIgnored {
    /// Enter the ignore window.
    pub(crate) fn new() -> Self {
        #[cfg(unix)]
        imp::enter();
        Self { _private: () }
    }
}

impl Drop for SigpipeIgnored {
    fn drop(&mut self) {
        #[cfg(unix)]
        imp::leave();
    }
}
