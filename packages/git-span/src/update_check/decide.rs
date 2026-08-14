//! Cadence decisions for the update check.
//!
//! Both cadences are "at most once per 24 hours" boundaries on unix-seconds
//! stamps: a check spawns when `last_checked_at` is absent or at least 24h
//! old, and a reminder prints when `last_reminded_at` is absent or at least
//! 24h old AND some stored finding is behind the running CLI version.
//! Fetch-failure cadence falls out of the same rule: a failed fetch still
//! stamps `last_checked_at` (with empty findings), so an offline machine
//! pays one failed attempt per day, not one per invocation.

use std::collections::BTreeMap;

use semver::Version;

use crate::update_check::store::UpdateCheckState;

/// What a reminder should name: the tools whose *observed* version is behind
/// `current`, keyed by tool (`cli` | `claude` | `codex`).
#[derive(Debug, PartialEq, Eq)]
pub struct Reminder {
    pub findings: BTreeMap<String, Version>,
}

/// Whether the foreground should spawn the detached check child at `now`.
/// `None` state (no store row yet) counts as due: the first interactive run
/// spawns.
pub fn should_spawn_check(state: Option<&UpdateCheckState>, now: i64) -> bool {
    let _ = (state, now);
    todo!("Phase 3: absent state or last_checked_at at least 24h old")
}

/// Whether the foreground should print a reminder at `now`: the
/// `last_reminded_at` cadence has elapsed and at least one stored finding
/// is behind `current`. The returned [`Reminder`] carries only the behind
/// findings.
pub fn should_remind(
    state: Option<&UpdateCheckState>,
    current: &Version,
    now: i64,
) -> Option<Reminder> {
    let _ = (state, current, now);
    todo!("Phase 3: reminded cadence + behind-only findings")
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
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn no_state_spawns_first_run() {
        assert!(should_spawn_check(None, 1_000_000_000));
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn fresh_state_does_not_spawn() {
        let now = 1_000_000_000;
        assert!(!should_spawn_check(Some(&state(now, 0, &[])), now));
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn exactly_24h_old_spawns() {
        let now = 1_000_000_000;
        assert!(should_spawn_check(Some(&state(now - DAY, 0, &[])), now));
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn under_24h_does_not_spawn() {
        let now = 1_000_000_000;
        assert!(!should_spawn_check(Some(&state(now - DAY + 1, 0, &[])), now));
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn no_state_does_not_remind() {
        let current = Version::new(1, 1, 5);
        assert_eq!(should_remind(None, &current, 1_000_000_000), None);
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn fresh_reminder_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now, now, &[("cli", "1.1.4")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn exactly_24h_since_reminder_reminds_with_behind_findings() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now, now - DAY, &[("cli", "1.1.4")]);
        let reminder = should_remind(Some(&s), &current, now)
            .expect("a behind finding with an elapsed cadence must remind");
        assert_eq!(
            reminder.findings,
            BTreeMap::from([("cli".to_string(), Version::new(1, 1, 4))])
        );
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn current_version_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now - DAY, now - DAY, &[("cli", "1.1.5")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn ahead_version_does_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        // The dev tree is currently ahead of the latest release; being
        // ahead is the expected state, never a reminder.
        let s = state(now - DAY, now - DAY, &[("cli", "9.9.9")]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
    fn empty_findings_do_not_remind() {
        let now = 1_000_000_000;
        let current = Version::new(1, 1, 5);
        let s = state(now - DAY, now - DAY, &[]);
        assert_eq!(should_remind(Some(&s), &current, now), None);
    }

    #[test]
    #[ignore = "Phase 3: cadence logic not implemented"]
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
