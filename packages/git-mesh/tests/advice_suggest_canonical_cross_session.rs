//! Phase F.2: cross-session whole-vs-ranged canonical sweep.
//!
//! When session A produces a ranged Edit canonical for `foo.rs#L10-L20`
//! and session B produces a whole-file Read sentinel for `foo.rs`, the
//! sweep must drop the whole-file canonical so only the narrow one
//! survives. The whole-file participant's `canonical_id_of` lookup
//! should also disappear (its canonical was dropped).

use git_mesh::advice::suggest::canonical::{build_canonical_ranges, part_key};
use git_mesh::advice::suggest::participants::{
    ExtentSource, Participant, ParticipantKind, WHOLE_FILE_END, WHOLE_FILE_START,
};
use git_mesh::advice::suggest::{
    Op, OpKind, SessionParticipants, SuggestConfig, build_pair_evidence,
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

    // The ranged participant's lookup resolves; the whole-file
    // participant's lookup is REMAPPED to the surviving narrower
    // canonical (preserves cross-session co-occurrence evidence).
    let ranged_cid = canonical.canonical_id_of[&part_key(&session_a)];
    let whole_cid = canonical.canonical_id_of[&part_key(&session_b)];
    assert_eq!(ranged_cid, 0);
    assert_eq!(
        whole_cid, ranged_cid,
        "dropped Whole part_key must remap to the surviving narrower canonical for foo.rs"
    );
}

#[test]
fn cross_session_whole_vs_ranged_preserves_pair_evidence() {
    // Session A: whole-file Read of foo.rs + Read of bar.rs (a pair).
    // Session B: ranged Edit of foo.rs.
    //
    // After the sweep, foo.rs has only the ranged canonical surviving.
    // The whole-file Read part_key from session A must remap to that
    // surviving canonical so the (foo.rs, bar.rs) pair is recorded.
    let a_foo_whole = whole_read("foo.rs", 0);
    let a_bar = Participant {
        path: "bar.rs".to_string(),
        start: 1,
        end: 30,
        op_index: 1,
        kind: ParticipantKind::Read,
        m_start: 1,
        m_end: 30,
        anchored: false,
        locator_distance: None,
        locator_forward: None,
        extent_source: ExtentSource::Read,
    };
    let b_foo_ranged = ranged_edit("foo.rs", 10, 20, 0);

    let all_parts = vec![a_foo_whole.clone(), a_bar.clone(), b_foo_ranged.clone()];
    let canonical = build_canonical_ranges(&all_parts, &SuggestConfig::default());

    // Build matching ops for each session.
    let session_a_ops = vec![
        Op {
            path: "foo.rs".to_string(),
            start_line: None,
            end_line: None,
            ts_ms: 0,
            op_index: 0,
            kind: OpKind::Read,
            ranged: false,
            count: 1,
            inferred_start: None,
            inferred_end: None,
            locator_distance: None,
            locator_forward: None,
        },
        Op {
            path: "bar.rs".to_string(),
            start_line: Some(1),
            end_line: Some(30),
            ts_ms: 1,
            op_index: 1,
            kind: OpKind::Read,
            ranged: true,
            count: 1,
            inferred_start: None,
            inferred_end: None,
            locator_distance: None,
            locator_forward: None,
        },
    ];
    let session_b_ops = vec![Op {
        path: "foo.rs".to_string(),
        start_line: Some(10),
        end_line: Some(20),
        ts_ms: 0,
        op_index: 0,
        kind: OpKind::Edit,
        ranged: true,
        count: 1,
        inferred_start: Some(10),
        inferred_end: Some(20),
        locator_distance: None,
        locator_forward: None,
    }];

    let sessions = vec![
        SessionParticipants {
            sid: "A".to_string(),
            ops: session_a_ops,
            parts: vec![a_foo_whole.clone(), a_bar.clone()],
        },
        SessionParticipants {
            sid: "B".to_string(),
            ops: session_b_ops,
            parts: vec![b_foo_ranged.clone()],
        },
    ];

    let pairs = build_pair_evidence(&sessions, &canonical, &SuggestConfig::default());

    // The (foo.rs, bar.rs) pair must be recorded — sweeping the Whole
    // canonical must NOT silently drop session A's evidence.
    let foo_cid = canonical.canonical_id_of[&part_key(&a_foo_whole)];
    let bar_cid = canonical.canonical_id_of[&part_key(&a_bar)];
    let key = if foo_cid < bar_cid {
        (foo_cid, bar_cid)
    } else {
        (bar_cid, foo_cid)
    };
    assert!(
        pairs.contains_key(&key),
        "(foo.rs, bar.rs) pair evidence must survive the cross-session whole-vs-ranged sweep; pairs={:?}",
        pairs.keys().collect::<Vec<_>>()
    );
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
