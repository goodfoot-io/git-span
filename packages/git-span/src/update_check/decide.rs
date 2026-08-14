//! Cadence decisions for the update check.
//!
//! Both cadences are "at most once per 24 hours" boundaries on unix-seconds
//! stamps: a check spawns when `last_checked_at` is absent or at least 24h
//! old, and a reminder prints when `last_reminded_at` is absent or at least
//! 24h old AND something is behind the latest release. The stored `cli`
//! finding *is* the latest release — the child records the fetched release
//! version — and it is the staleness baseline for everything: the running
//! CLI is behind when it is below it, and a plugin cache is behind when its
//! newest cached copy is below it. Fetch-failure cadence falls out of the
//! same rule: a failed fetch still stamps `last_checked_at` (with empty
//! findings), so an offline machine pays one failed attempt per day, not
//! one per invocation.

use std::collections::BTreeMap;

use semver::Version;

use crate::update_check::store::UpdateCheckState;

/// Seconds in a day — the cadence boundary for both decisions.
pub const DAY: i64 = 24 * 60 * 60;

/// What a reminder should name: the behind tools keyed by tool (`cli` |
/// `claude` | `codex`). The value is the version the user is *on* — the
/// running CLI version for `cli`, the cached copy for the plugins — so the
/// renderer can name both sides of the gap.
#[derive(Debug, PartialEq, Eq)]
pub struct Reminder {
    pub findings: BTreeMap<String, Version>,
}

/// Whether the foreground should spawn the detached check child at `now`.
/// `None` state (no store row yet) counts as due: the first interactive run
/// spawns.
pub fn should_spawn_check(state: Option<&UpdateCheckState>, now: i64) -> bool {
    match state {
        None => true,
        Some(state) => now - state.last_checked_at >= DAY,
    }
}

/// Whether the foreground should print a reminder at `now`: the
/// `last_reminded_at` cadence has elapsed and something is behind the latest
/// release. The stored `cli` finding *is* the latest release (the child
/// records the fetched release version), so it is the baseline: the running
/// CLI (`current`) is behind when it is below it, and the `claude`/`codex`
/// cached copies are behind when they are below it. A missing `cli` row
/// means no baseline and therefore no reminder (fail-closed). Rows for
/// unknown tools are ignored — naming a third tool behind is a new
/// implementation, never an accident.
pub fn should_remind(
    state: Option<&UpdateCheckState>,
    current: &Version,
    now: i64,
) -> Option<Reminder> {
    let state = state?;
    if now - state.last_reminded_at < DAY {
        return None;
    }
    let latest = state.findings.get("cli")?;
    let mut findings = BTreeMap::new();
    if current < latest {
        findings.insert("cli".to_string(), current.clone());
    }
    for tool in ["claude", "codex"] {
        if let Some(observed) = state.findings.get(tool)
            && observed < latest
        {
            findings.insert(tool.to_string(), observed.clone());
        }
    }
    if findings.is_empty() {
        None
    } else {
        Some(Reminder { findings })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update_check::store::UpdateCheckState;

    /// Seconds in a day — the cadence constant both decisions use.
    const DAY: i64 = 24 * 60 * 60;

    fn state(checked: i64, reminded: i64, findings: &[(&str, &str)]) -> UpdateCheckState {
        UpdateCheckState {
            last_checked_at: checked,
            last_reminded_at: reminded,
            findings: findings
                .iter()
                .map(|(tool, version)| (tool.to_string(), Version::parse(version).unwrap()))
                .collect(),
        }
    }

    #[test]
    fn no_state_spawns_first_run() {
        assert!(should_spawn_check(None, 1_000_000_000));
    }

    #[test]
    fn fresh_state_does_not_spawn() {
        let now = 1_000_000_000;
        assert!(!should_spawn_check(Some(&state(now, 0, &[])), now));
    }

    #[test]
    fn exactly_24h_old_spawns() {
        let now = 1_000_000_000;
        assert!(should_spawn_check(Some(&state(now - DAY, 0, &[])), now));
    }

    #[test]
    fn under_24h_does_not_spawn() {
        let now = 1_000_000_000;
        assert!(!should_spawn_check(Some(&state(now - DAY + 1, 0, &[])), now));
    }

    #[test]
    fn no_state_does_not_remind() {
        let current = Version::new(1, 1, 5);
        assert_eq!(should_remind(None, &current, 1_000_000_000), None);
    }

    #[test]
    fn fresh_reminder_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now, now, &[("cli", "1.1.4")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn exactly_24h_since_reminder_reminds_with_behind_findings() {
        let now = 1_000_000_000;
        // The stored cli finding IS the latest release (1.1.5); the running
        // CLI is 1.1.4 — behind, so the reminder names what the user is on.
        let current = Version::new(1, 1, 4);
        let s = state(now, now - DAY, &[("cli", "1.1.5")]);
        let reminder = should_remind(Some(&s), &current, now)
            .expect("a behind finding with an elapsed cadence must remind");
        assert_eq!(
            reminder.findings,
            BTreeMap::from([("cli".to_string(), Version::new(1, 1, 4))])
        );
    }

    #[test]
    fn current_version_does_not_remind() {
        // Running version == latest release: current, never a reminder.
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now - DAY, now - DAY, &[("cli", "1.1.5")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn ahead_version_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        // The dev tree is ahead of the latest release (1.1.4); being ahead
        // is the expected state, never a reminder.
        let s = state(now - DAY, now - DAY, &[("cli", "1.1.4")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn latest_release_ahead_reminds() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        // A stored cli finding above the running version means the latest
        // release is newer than the installed CLI — the note must fire.
        let s = state(now - DAY, now - DAY, &[("cli", "9.9.9")]);
        let reminder = should_remind(Some(&s), &current, now)
            .expect("a newer latest release must remind");
        assert_eq!(
            reminder.findings,
            BTreeMap::from([("cli".to_string(), Version::new(1, 1, 5))])
        );
    }

    #[test]
    fn plugin_below_latest_release_reminds() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 4);
        let s = state(
            now - DAY,
            now - DAY,
            &[("cli", "1.1.4"), ("claude", "1.0.145"), ("codex", "1.1.4")],
        );
        let reminder = should_remind(Some(&s), &current, now)
            .expect("a cached plugin below the latest release must remind");
        assert_eq!(
            reminder.findings,
            BTreeMap::from([("claude".to_string(), Version::new(1, 0, 145))])
        );
    }

    #[test]
    fn plugin_at_or_above_latest_release_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 4);
        let s = state(
            now - DAY,
            now - DAY,
            &[("cli", "1.1.4"), ("claude", "1.1.4")],
        );
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn missing_cli_baseline_does_not_remind() {
        // Without the stored latest release there is no staleness baseline
        // for anything — fail closed.
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now - DAY, now - DAY, &[("claude", "1.0.145")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn unknown_tool_rows_do_not_remind() {
        // decide whitelists the tools it understands; a third tool's row is
        // a new implementation and must never fire the note on its own.
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 4);
        let s = state(now - DAY, now - DAY, &[("cli", "1.1.4"), ("foo", "0.0.1")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn empty_findings_do_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now - DAY, now - DAY, &[]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    fn fetch_failure_cadence_is_one_attempt_per_day() {
        // A failed fetch stamps last_checked_at with no findings: no spawn
        // today, no reminder today, and the boundary case spawns tomorrow.
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now, now - DAY, &[]);
        assert!(!should_spawn_check(Some(&s), now));
        assert_eq!(should_remind(Some(&s), &current, now), None);
        assert!(should_spawn_check(Some(&state(now - DAY, 0, &[])), now));
    }
}
