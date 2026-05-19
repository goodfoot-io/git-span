//! `cache_v2` validation suite: schema round-trip, baseline/overlay
//! load↔store, key-based invalidation, and warm-clean vs warm-dirty
//! behavior at the storage layer.

use super::baseline::{LoadedBaseline, load_baseline, store_baseline};
use super::keys::{CommittedKey, OverlayKeyInputs, availability_hash};
use super::moved::{MovedLocation, MovedScanKey, load_scan, store_scan};
use super::overlay::{DirtyOverlay, apply_overlay, load_overlay, store_overlay};
use super::schema::{CacheDb, KEY_SALT, hex32, open_cache_at};
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, MeshResolved,
};
use std::path::PathBuf;

fn tmp_db() -> (tempfile::TempDir, CacheDb) {
    let td = tempfile::tempdir().expect("tempdir");
    let db = open_cache_at(&td.path().join("mesh").join("stale-cache.db"))
        .expect("open cache_v2");
    (td, db)
}

fn ck() -> CommittedKey {
    CommittedKey {
        source_tree_key: "src-tree-1".into(),
        mesh_tree_key: "mesh-tree-1".into(),
        mesh_root: ".mesh".into(),
        filter_config_hash: [3; 32],
        key_salt: KEY_SALT,
    }
}

fn anchor(id: &str, status: AnchorStatus) -> AnchorResolved {
    AnchorResolved {
        anchor_id: id.into(),
        anchor_sha: String::new(),
        anchored: AnchorLocation {
            path: PathBuf::from("src/a.rs"),
            extent: AnchorExtent::LineRange { start: 1, end: 10 },
            blob: None,
        },
        current: None,
        status,
        source: None,
        layer_sources: Vec::new(),
        acknowledged_by: None,
        locus: None,
    }
}

fn mesh(name: &str, anchors: Vec<AnchorResolved>) -> MeshResolved {
    MeshResolved {
        name: name.into(),
        message: format!("why {name}"),
        anchors,
        pending: Vec::new(),
        follow_moves: false,
    }
}

#[test]
fn baseline_round_trip_stores_only_non_fresh_rows() {
    let (_td, db) = tmp_db();
    let key = ck();
    let av = hex32(&availability_hash(true, false, false));
    let meshes = vec![
        mesh("alpha", vec![anchor("a1", AnchorStatus::Changed)]),
        mesh("beta", vec![anchor("b1", AnchorStatus::Fresh)]),
    ];
    store_baseline(&db, &key, &av, &meshes).expect("store");
    let loaded = load_baseline(&db, &key, &av).expect("load").expect("hit");
    // Only the mesh with a non-Fresh anchor is materialized.
    assert_eq!(loaded.meshes.len(), 1);
    assert_eq!(loaded.meshes[0].name, "alpha");
    assert_eq!(loaded.meshes[0].anchors[0].status, AnchorStatus::Changed);
    assert_eq!(loaded.counts.anchors_changed, 1);
    assert_eq!(loaded.counts.anchors_fresh, 1);
    assert_eq!(loaded.non_fresh_count, 1);
}

#[test]
fn all_fresh_baseline_is_a_hit_not_a_rebuild() {
    let (_td, db) = tmp_db();
    let key = ck();
    let av = hex32(&availability_hash(true, false, false));
    let meshes = vec![mesh("alpha", vec![anchor("a1", AnchorStatus::Fresh)])];
    store_baseline(&db, &key, &av, &meshes).expect("store");
    let loaded = load_baseline(&db, &key, &av)
        .expect("load")
        .expect("complete manifest ⇒ hit even with zero finding rows");
    assert!(loaded.meshes.is_empty());
    assert_eq!(loaded.non_fresh_count, 0);
}

#[test]
fn baseline_misses_on_each_invalidation_trigger() {
    let (_td, db) = tmp_db();
    let key = ck();
    let av = hex32(&availability_hash(true, false, false));
    store_baseline(
        &db,
        &key,
        &av,
        &[mesh("m", vec![anchor("x", AnchorStatus::Changed)])],
    )
    .expect("store");

    // mesh_tree_key change.
    let mut k = ck();
    k.mesh_tree_key = "other-mesh-tree".into();
    assert!(load_baseline(&db, &k, &av).unwrap().is_none());
    // source_tree_key change.
    let mut k = ck();
    k.source_tree_key = "other-src".into();
    assert!(load_baseline(&db, &k, &av).unwrap().is_none());
    // mesh_root change.
    let mut k = ck();
    k.mesh_root = "meshes".into();
    assert!(load_baseline(&db, &k, &av).unwrap().is_none());
    // filter config change.
    let mut k = ck();
    k.filter_config_hash = [9; 32];
    assert!(load_baseline(&db, &k, &av).unwrap().is_none());
    // key salt change.
    let mut k = ck();
    k.key_salt = KEY_SALT + 1;
    assert!(load_baseline(&db, &k, &av).unwrap().is_none());
    // availability change.
    let av2 = hex32(&availability_hash(false, false, false));
    assert!(load_baseline(&db, &key, &av2).unwrap().is_none());

    // The original key still hits.
    assert!(load_baseline(&db, &key, &av).unwrap().is_some());
}

#[test]
fn overlay_round_trip_and_merge_replaces_affected_mesh() {
    let (_td, db) = tmp_db();
    let key = ck();
    let av = hex32(&availability_hash(true, false, false));

    let baseline_meshes = vec![
        mesh("alpha", vec![anchor("a1", AnchorStatus::Changed)]),
        mesh("beta", vec![anchor("b1", AnchorStatus::Changed)]),
    ];
    store_baseline(&db, &key, &av, &baseline_meshes).expect("store");
    let loaded = load_baseline(&db, &key, &av).unwrap().unwrap();

    // Overlay re-resolves `alpha` to Deleted; `beta` is untouched.
    let mut inputs = OverlayKeyInputs::new(&key);
    inputs.dirty_source_fingerprint = [1; 32];
    let overlay = DirtyOverlay {
        affected_meshes: vec!["alpha".into()],
        meshes: vec![mesh("alpha", vec![anchor("a1", AnchorStatus::Deleted)])],
    };
    store_overlay(&db, &inputs, &overlay).expect("store overlay");

    let reloaded = load_overlay(&db, &inputs)
        .expect("load overlay")
        .expect("overlay hit");
    let merged = apply_overlay(&loaded.meshes, &reloaded);
    let alpha = merged.iter().find(|m| m.name == "alpha").unwrap();
    assert_eq!(alpha.anchors[0].status, AnchorStatus::Deleted);
    let beta = merged.iter().find(|m| m.name == "beta").unwrap();
    assert_eq!(beta.anchors[0].status, AnchorStatus::Changed);
}

#[test]
fn overlay_misses_on_dirty_identity_change() {
    let (_td, db) = tmp_db();
    let key = ck();
    let mut inputs = OverlayKeyInputs::new(&key);
    inputs.dirty_source_fingerprint = [1; 32];
    store_overlay(
        &db,
        &inputs,
        &DirtyOverlay {
            affected_meshes: vec!["m".into()],
            meshes: vec![mesh("m", vec![anchor("x", AnchorStatus::Changed)])],
        },
    )
    .expect("store");
    assert!(load_overlay(&db, &inputs).unwrap().is_some());

    let mut changed = OverlayKeyInputs::new(&key);
    changed.dirty_source_fingerprint = [2; 32];
    assert!(
        load_overlay(&db, &changed).unwrap().is_none(),
        "different dirty content identity ⇒ overlay miss"
    );
}

#[test]
fn overlay_affected_but_now_fresh_mesh_is_dropped() {
    let (_td, db) = tmp_db();
    let key = ck();
    let av = hex32(&availability_hash(true, false, false));
    store_baseline(
        &db,
        &key,
        &av,
        &[mesh("m", vec![anchor("x", AnchorStatus::Changed)])],
    )
    .unwrap();
    let loaded = load_baseline(&db, &key, &av).unwrap().unwrap();

    let mut inputs = OverlayKeyInputs::new(&key);
    inputs.dirty_source_fingerprint = [7; 32];
    // Affected but no reportable form ⇒ the anchor went back to Fresh.
    let overlay = DirtyOverlay {
        affected_meshes: vec!["m".into()],
        meshes: Vec::new(),
    };
    store_overlay(&db, &inputs, &overlay).unwrap();
    let reloaded = load_overlay(&db, &inputs).unwrap().unwrap();
    let merged = apply_overlay(&loaded.meshes, &reloaded);
    assert!(
        merged.iter().all(|m| m.name != "m"),
        "an affected mesh with no overlay finding is dropped from output"
    );
}

#[test]
fn moved_scan_negative_result_is_a_hit() {
    let (_td, db) = tmp_db();
    let key = MovedScanKey {
        source_tree_key: "src1".into(),
        filter_config_hash_hex: "ff".into(),
        hash_algorithm: "sha256".into(),
        content_hash: "deadbeef".into(),
        extent_kind: "line-range".into(),
        line_count: 10,
    };
    assert!(load_scan(&db, &key).unwrap().is_none(), "no manifest ⇒ miss");
    store_scan(&db, &key, &[]).unwrap();
    let hit = load_scan(&db, &key)
        .unwrap()
        .expect("complete manifest with zero rows is a hit");
    assert!(hit.is_empty());
}

#[test]
fn moved_scan_round_trip_and_key_isolation() {
    let (_td, db) = tmp_db();
    let key = MovedScanKey {
        source_tree_key: "src1".into(),
        filter_config_hash_hex: "ab".into(),
        hash_algorithm: "sha256".into(),
        content_hash: "cafe".into(),
        extent_kind: "line-range".into(),
        line_count: 5,
    };
    let locs = vec![MovedLocation {
        source_path: "src/moved.rs".into(),
        start_line: 20,
        end_line: 24,
    }];
    store_scan(&db, &key, &locs).unwrap();
    assert_eq!(load_scan(&db, &key).unwrap().unwrap(), locs);

    let mut other = key.clone();
    other.content_hash = "feed".into();
    assert!(
        load_scan(&db, &other).unwrap().is_none(),
        "different content hash ⇒ independent scan key"
    );
}

#[test]
fn default_loaded_baseline_is_empty() {
    let b = LoadedBaseline::default();
    assert!(b.meshes.is_empty());
    assert_eq!(b.non_fresh_count, 0);
}
