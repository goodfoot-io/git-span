//! Phase F.2: cross-session whole-vs-ranged canonical sweep.
//!
//! When session A produces a ranged Edit canonical for `foo.rs#L10-L20`
//! and session B produces a whole-file Read sentinel for `foo.rs`, the
//! sweep must drop the whole-file canonical so only the narrow one
//! survives. The whole-file participant's `canonical_id_of` lookup
//! should also disappear (its canonical was dropped).

use git_mesh::advice::suggest::SuggestConfig;
use git_mesh::advice::suggest::canonical::{build_canonical_ranges, part_key};
use git_mesh::advice::suggest::participants::{
    ExtentSource, Participant, ParticipantKind, WHOLE_FILE_END, WHOLE_FILE_START,
};

fn ranged_edit(path: &str, start: u32, end: u32, op_index: usize) -> Participant {
    Participant {
        path: path.to_string(),
        start,
        end,
        op_index,
        kind: ParticipantKind::Edit,
        m_start: start,
        m_end: end,
        anchored: true,
        locator_distance: None,
        locator_forward: None,
        extent_source: ExtentSource::Edit,
    }
}

fn whole_read(path: &str, op_index: usize) -> Participant {
    Participant {
        path: path.to_string(),
        start: WHOLE_FILE_START,
        end: WHOLE_FILE_END,
        op_index,
        kind: ParticipantKind::Read,
        m_start: WHOLE_FILE_START,
        m_end: WHOLE_FILE_END,
        anchored: false,
        locator_distance: None,
        locator_forward: None,
        extent_source: ExtentSource::Whole,
    }
}

#[test]
fn whole_canonical_dropped_when_ranged_sibling_exists_cross_session() {
    let session_a = ranged_edit("foo.rs", 10, 20, 0);
    let session_b = whole_read("foo.rs", 1);
    let parts = vec![session_a.clone(), session_b.clone()];

    let canonical = build_canonical_ranges(&parts, &SuggestConfig::default());

    let foo_canonicals: Vec<_> = canonical
        .ranges
        .iter()
        .filter(|r| r.path == "foo.rs")
        .collect();
    assert_eq!(
        foo_canonicals.len(),
        1,
        "expected the Whole canonical to be swept; got {:?}",
        canonical.ranges
    );
    let r = foo_canonicals[0];
    assert_eq!(r.start, 10);
    assert_eq!(r.end, 20);
    assert_eq!(r.source, ExtentSource::Edit);

    // The ranged participant's lookup still resolves; the whole-file
    // participant's lookup is gone (its canonical was dropped).
    assert!(canonical.canonical_id_of.contains_key(&part_key(&session_a)));
    assert!(!canonical.canonical_id_of.contains_key(&part_key(&session_b)));

    // Surviving id is dense (single canonical → id 0).
    assert_eq!(canonical.canonical_id_of[&part_key(&session_a)], 0);
}

#[test]
fn whole_only_path_keeps_its_canonical() {
    // bar.rs only ever appears as a whole-file read — its canonical must
    // survive the sweep.
    let parts = vec![
        ranged_edit("foo.rs", 10, 20, 0),
        whole_read("foo.rs", 1),
        whole_read("bar.rs", 2),
    ];
    let canonical = build_canonical_ranges(&parts, &SuggestConfig::default());

    let bar: Vec<_> = canonical.ranges.iter().filter(|r| r.path == "bar.rs").collect();
    assert_eq!(bar.len(), 1);
    assert_eq!(bar[0].source, ExtentSource::Whole);

    // canonical_id_of indices are dense within 0..ranges.len().
    for (_k, &id) in &canonical.canonical_id_of {
        assert!(id < canonical.ranges.len());
    }
}
