//! GitHub Releases API parsing for the update check.
//!
//! Contract (pinned by the committed live fixture
//! `tests/fixtures/update-check-releases.json`): tags are
//! `git-span-v{version}`, list order is GitHub's (newest first by creation
//! time, not semver), and `draft`/`prerelease` entries must be filtered —
//! "latest release" is the *first entry passing the filter*, not the semver
//! max. Any parse failure yields no finding (fail-closed).

use semver::Version;

/// Strip the `git-span-v` prefix from a release tag. `None` when the tag
/// does not carry the prefix.
fn strip_tag_prefix(tag: &str) -> Option<&str> {
    let _ = tag;
    todo!("Phase 3: strip the git-span-v prefix")
}

/// The latest release version in a Releases API payload: the first entry
/// that is neither a draft nor a prerelease, with the tag prefix stripped
/// and parsed as semver. Malformed payload, an empty list, or an unparseable
/// tag → `None` (no finding).
pub fn latest_release_from_payload(json: &str) -> Option<Version> {
    let _ = strip_tag_prefix(json);
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed live GitHub Releases API payload (captured
    /// 2026-08-14). The dev tree (1.1.5) is ahead of every release in it;
    /// the newest by creation time is `git-span-v1.1.4`.
    const FIXTURE: &str = include_str!("../../tests/fixtures/update-check-releases.json");

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn fixture_latest_is_first_passing_entry() {
        assert_eq!(
            latest_release_from_payload(FIXTURE),
            Some(Version::new(1, 1, 4)),
            "the newest release by creation time, not the semver max"
        );
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn first_passing_entry_wins_over_semver_max() {
        // GitHub lists newest-first by creation time; a checker must take
        // the first entry passing the filter, even when a later entry has
        // a higher semver.
        let payload = r#"[
            { "tag_name": "git-span-v1.0.141", "draft": false, "prerelease": false },
            { "tag_name": "git-span-v1.1.4", "draft": false, "prerelease": false }
        ]"#;
        assert_eq!(
            latest_release_from_payload(payload),
            Some(Version::new(1, 0, 141))
        );
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn draft_and_prerelease_head_entries_are_skipped() {
        let payload = r#"[
            { "tag_name": "git-span-v9.9.9", "draft": true, "prerelease": false },
            { "tag_name": "git-span-v9.9.8", "draft": false, "prerelease": true },
            { "tag_name": "git-span-v1.1.4", "draft": false, "prerelease": false }
        ]"#;
        assert_eq!(
            latest_release_from_payload(payload),
            Some(Version::new(1, 1, 4))
        );
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn synthetic_newer_tag_is_detected() {
        let payload = r#"[
            { "tag_name": "git-span-v9.9.9", "draft": false, "prerelease": false }
        ]"#;
        assert_eq!(
            latest_release_from_payload(payload),
            Some(Version::new(9, 9, 9))
        );
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn malformed_json_yields_none() {
        assert_eq!(latest_release_from_payload("not json at all"), None);
        assert_eq!(latest_release_from_payload("[]"), None);
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn tag_without_prefix_yields_none() {
        let payload = r#"[
            { "tag_name": "v1.1.4", "draft": false, "prerelease": false }
        ]"#;
        assert_eq!(latest_release_from_payload(payload), None);
    }

    #[test]
    #[ignore = "Phase 3: releases parsing not implemented"]
    fn strip_tag_prefix_contract() {
        assert_eq!(strip_tag_prefix("git-span-v1.1.4"), Some("1.1.4"));
        assert_eq!(strip_tag_prefix("git-span-v9.9.9"), Some("9.9.9"));
        assert_eq!(strip_tag_prefix("v1.1.4"), None);
        assert_eq!(strip_tag_prefix("git-span-1.1.4"), None);
    }
}
