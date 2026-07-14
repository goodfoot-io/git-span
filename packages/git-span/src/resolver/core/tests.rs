//! Card main-157 Phase 1 bootstrap checks for `resolver/core`.
//!
//! Bootstrap Phase 2: every check below is `#[ignore]`d against the
//! Bootstrap Phase 1 stubs in `token.rs` / `resolution.rs` / `project.rs`.
//! Bootstrap Phase 3 unskips them in the plan's specified order: (1)
//! canonical key sensitivity, (2) projection round-trip, (3) duplicate
//! ordinal identity, (4) `.gitignore` dirty mismatch reproduced correctly
//! at the projection level, (5) same-tree/commit guard, (6) filter
//! dependency eligibility.

use super::project::{project_committed, project_effective};
use super::resolution::{
    AnchorCore, DefinitionOrdinal, DriftLocusCore, ExtentCore, LayerObservationCore, LocationCore,
    ResolutionCore, SpanCore,
};
use super::token::{
    AvailabilityProof, FilterDependency, LayerSetToken, PathAvailability, PathState,
    PathStateEntry, SpanBlobIdentity, StateToken,
};
use crate::cli::drift_label::format_drift_label;
use crate::resolver::engine::{capture_resolution_core, resolve_named_spans};
use crate::types::{
    AnchorStatus, CopyDetection, DriftSource, EngineOptions, LayerSet,
};

// ── Shared fixtures ──────────────────────────────────────────────────────

fn sample_filter() -> FilterDependency {
    FilterDependency {
        driver: "lfs".to_string(),
        command: "git-lfs filter-process".to_string(),
        executable_digest: Some([9u8; 32]),
        env_digest: Some([8u8; 32]),
    }
}

fn sample_path_entry() -> PathStateEntry {
    PathStateEntry {
        path: "src/tracked.rs".to_string(),
        state: PathState::Tracked {
            blob: "1".repeat(40),
        },
    }
}

/// A fully-populated, internally-consistent `StateToken` used as the base
/// for per-field mutation checks and the eligibility checks.
fn sample_token() -> StateToken {
    StateToken {
        semantic_epoch: 1,
        layers: LayerSetToken {
            worktree: true,
            index: true,
            staged_span: true,
        },
        ignore_unavailable: false,
        needs_all_layers: true,
        fuzzy_threshold_bps: 9_500,
        since: None,
        head: "0".repeat(40),
        source_tree: "1".repeat(40),
        span_root: ".span".to_string(),
        span_subtree: "2".repeat(40),
        span_blobs: vec![SpanBlobIdentity {
            path: ".span/demo".to_string(),
            blob: "3".repeat(40),
        }],
        rename_budget: 1_000,
        copy_detection: CopyDetection::SameCommit,
        replace_refs: vec![format!("{}:{}", "4".repeat(40), "5".repeat(40))],
        filters: vec![sample_filter()],
        attributes_digest: [1u8; 32],
        normalization_digest: [2u8; 32],
        index_identity: PathState::Tracked {
            blob: "6".repeat(40),
        },
        staged_state: vec![sample_path_entry()],
        worktree_state: vec![sample_path_entry()],
        availability: AvailabilityProof {
            lfs_installed: true,
            sparse_active: false,
            promisor_active: false,
            paths: vec![PathAvailability {
                path: "src/big.bin".to_string(),
                available: true,
            }],
        },
    }
}

fn assert_field_changes_digest(base: &StateToken, mutate: impl Fn(&mut StateToken), what: &str) {
    let mut mutated = base.clone();
    mutate(&mut mutated);
    assert_ne!(
        base.canonical_key_digest(),
        mutated.canonical_key_digest(),
        "{what} must change the canonical key digest"
    );
}

// ── Category 1: canonical key sensitivity ────────────────────────────────

/// Every semantic `StateToken` field must distinguish the canonical key.
#[test]
fn canonical_key_digest_sensitive_to_every_semantic_field() {
    let base = sample_token();
    assert_field_changes_digest(&base, |t| t.semantic_epoch += 1, "semantic_epoch");
    assert_field_changes_digest(
        &base,
        |t| t.layers.worktree = !t.layers.worktree,
        "layers.worktree",
    );
    assert_field_changes_digest(&base, |t| t.layers.index = !t.layers.index, "layers.index");
    assert_field_changes_digest(
        &base,
        |t| t.layers.staged_span = !t.layers.staged_span,
        "layers.staged_span",
    );
    assert_field_changes_digest(
        &base,
        |t| t.ignore_unavailable = !t.ignore_unavailable,
        "ignore_unavailable",
    );
    assert_field_changes_digest(
        &base,
        |t| t.needs_all_layers = !t.needs_all_layers,
        "needs_all_layers",
    );
    assert_field_changes_digest(
        &base,
        |t| t.fuzzy_threshold_bps += 1,
        "fuzzy_threshold_bps",
    );
    assert_field_changes_digest(&base, |t| t.since = Some("f".repeat(40)), "since");
    assert_field_changes_digest(&base, |t| t.source_tree = "c".repeat(40), "source_tree");
    assert_field_changes_digest(&base, |t| t.span_root = "spans".to_string(), "span_root");
    assert_field_changes_digest(&base, |t| t.span_subtree = "d".repeat(40), "span_subtree");
    assert_field_changes_digest(
        &base,
        |t| {
            t.span_blobs.push(SpanBlobIdentity {
                path: "x".to_string(),
                blob: "e".repeat(40),
            })
        },
        "span_blobs",
    );
    assert_field_changes_digest(&base, |t| t.rename_budget += 1, "rename_budget");
    assert_field_changes_digest(
        &base,
        |t| t.copy_detection = CopyDetection::Off,
        "copy_detection",
    );
    assert_field_changes_digest(
        &base,
        |t| t.replace_refs.push("x:y".to_string()),
        "replace_refs",
    );
    assert_field_changes_digest(&base, |t| t.filters.push(sample_filter()), "filters");
    assert_field_changes_digest(
        &base,
        |t| t.attributes_digest[0] ^= 0xFF,
        "attributes_digest",
    );
    assert_field_changes_digest(
        &base,
        |t| t.normalization_digest[0] ^= 0xFF,
        "normalization_digest",
    );
    assert_field_changes_digest(
        &base,
        |t| t.index_identity = PathState::Conflict,
        "index_identity",
    );
    assert_field_changes_digest(
        &base,
        |t| t.staged_state.push(sample_path_entry()),
        "staged_state",
    );
    assert_field_changes_digest(
        &base,
        |t| t.worktree_state.push(sample_path_entry()),
        "worktree_state",
    );
    assert_field_changes_digest(
        &base,
        |t| t.availability.lfs_installed = !t.availability.lfs_installed,
        "availability.lfs_installed",
    );
    assert_field_changes_digest(
        &base,
        |t| t.availability.sparse_active = !t.availability.sparse_active,
        "availability.sparse_active",
    );
    assert_field_changes_digest(
        &base,
        |t| t.availability.promisor_active = !t.availability.promisor_active,
        "availability.promisor_active",
    );
    assert_field_changes_digest(
        &base,
        |t| {
            t.availability.paths.push(PathAvailability {
                path: "x".to_string(),
                available: false,
            })
        },
        "availability.paths",
    );
}

/// `head` is a derivation hint only: changing it alone must NOT change the
/// canonical key digest while output remains content-only.
#[test]
fn head_change_does_not_change_canonical_key_digest() {
    let base = sample_token();
    let mut mutated = base.clone();
    mutated.head = "f".repeat(40);
    assert_eq!(
        base.canonical_key_digest(),
        mutated.canonical_key_digest(),
        "HEAD is a derivation hint only and must not affect the canonical key"
    );
}

// ── Category 2: projection round-trip (real single-pass capture) ─────────

fn run_git(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn init_repo() -> tempfile::TempDir {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path();
    run_git(dir, &["init", "--initial-branch=main"]);
    run_git(dir, &["config", "user.email", "t@t"]);
    run_git(dir, &["config", "user.name", "t"]);
    run_git(dir, &["config", "commit.gpgsign", "false"]);
    td
}

fn commit_file(dir: &std::path::Path, path: &str, content: &str, msg: &str) {
    let abs = dir.join(path);
    if let Some(p) = abs.parent() {
        std::fs::create_dir_all(p).expect("create parent");
    }
    std::fs::write(&abs, content).expect("write file");
    run_git(dir, &["add", "."]);
    run_git(dir, &["commit", "-m", msg]);
}

/// Crate-internal analog of `tests/support::create_and_commit_span` (that
/// helper is only reachable from integration tests, which depend on this
/// crate as an external `git_span` path).
fn commit_span(dir: &std::path::Path, name: &str, anchors: &[(&str, u32, u32)], why: &str) {
    let span_dir = dir.join(".span");
    std::fs::create_dir_all(&span_dir).expect("create .span dir");
    let mut records = Vec::with_capacity(anchors.len());
    for (path, start, end) in anchors {
        let bytes = std::fs::read(dir.join(path)).unwrap_or_else(|_| panic!("read {path}"));
        // Pin the anchor with the SAME rk64 fingerprint the resolver computes,
        // so a matching HEAD reads `Fresh` (the previous `sha256:` content hash
        // labelled `rk64` never matched, forcing every anchor to drift at HEAD).
        let extent = if *start == 0 && *end == 0 {
            git_span_core::AnchorExtent::WholeFile
        } else {
            git_span_core::AnchorExtent::LineRange {
                start: *start,
                end: *end,
            }
        };
        let content_hash = git_span_core::rk64_to_hex(
            git_span_core::cheap_fingerprint_with_extent(&bytes, &extent),
        );
        records.push(crate::span_file::AnchorRecord {
            path: (*path).to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: git_span_core::RK64_ALGORITHM.to_string(),
            content_hash,
        });
    }
    let mf = crate::span_file::SpanFile {
        anchors: records,
        why: why.to_string(),
    };
    std::fs::write(span_dir.join(name), mf.serialize()).expect("write span file");
    run_git(dir, &["add", &format!(".span/{name}")]);
    run_git(dir, &["commit", "-m", &format!("span: {name}")]);
}

/// Round-trips a `ResolutionCore` built by ONE real single-pass capture
/// (`capture_resolution_core`) through `project_committed` /
/// `project_effective` and diffs both against direct current-resolver output
/// on a real (if small) repo, covering a clean HEAD with a worktree-only
/// dirty anchor. This replaces Phase 1's two-pass `anchor_core_from_dual`
/// reconstruction with genuine per-layer capture. Real multi-thousand-anchor
/// corpora are not reusable fixtures in this crate (only workspace clones in
/// benches/integration tests, and a synthetic generator behind the
/// `bench-corpus` feature) — this exercises the same mechanism at unit scale,
/// which is what a `src/`-level unit test can reach.
#[test]
fn projection_round_trip_matches_direct_resolution_clean_and_worktree_dirty() -> crate::Result<()>
{
    let td = init_repo();
    let dir = td.path();
    commit_file(dir, "src/a.rs", "one\ntwo\nthree\n", "init a");
    commit_span(dir, "demo", &[("src/a.rs", 1, 2)], "why demo");

    // Dirty the worktree ONLY (no staged changes): HEAD still matches the
    // anchor (committed view stays Fresh) while the worktree drifts.
    std::fs::write(dir.join("src/a.rs"), "ONE\ntwo\nthree\n").expect("dirty worktree");

    let repo = gix::open(dir).expect("gix open");
    let names = vec!["demo".to_string()];

    // Ground truth: two direct resolutions of the SAME on-disk state.
    let committed_span = resolve_named_spans(&repo, ".span", &names, EngineOptions::committed_only())?
        [0]
    .1
    .as_ref()
    .expect("committed resolution succeeds")
    .clone();
    let effective_span = resolve_named_spans(&repo, ".span", &names, EngineOptions::full())?[0]
        .1
        .as_ref()
        .expect("effective resolution succeeds")
        .clone();

    // One single-pass capture drives both projections.
    let core = capture_resolution_core(&repo, ".span", &names)?;

    assert_eq!(
        project_committed(&core),
        vec![committed_span],
        "committed projection must be byte-identical to direct committed-only resolution"
    );
    assert_eq!(
        project_effective(&core, LayerSet::full()),
        vec![effective_span],
        "effective projection must be byte-identical to direct full-layer resolution"
    );
    Ok(())
}

/// The case `anchor_core_from_dual` structurally could not express: an anchor
/// whose index AND worktree both drift, independently, from HEAD and from each
/// other (staged one edit to the anchored range, then made a different
/// unstaged edit). One single-pass capture must record real, independent
/// per-layer observations for BOTH layers, and both projections must be
/// byte-identical to direct resolution — including the two-entry
/// `layer_sources` whose order (`Worktree`, then `Index`) only manifests when
/// both layers drift at once.
#[test]
fn projection_round_trip_matches_direct_resolution_simultaneous_index_and_worktree_drift(
) -> crate::Result<()> {
    let td = init_repo();
    let dir = td.path();
    commit_file(dir, "src/a.rs", "l1\nl2\nl3\nl4\nl5\n", "init a");
    commit_span(dir, "demo", &[("src/a.rs", 2, 4)], "why demo");

    // Stage an edit inside the anchored range: the index now differs from HEAD.
    std::fs::write(dir.join("src/a.rs"), "l1\nl2\nINDEX\nl4\nl5\n").expect("stage edit");
    run_git(dir, &["add", "src/a.rs"]);
    // Then edit the worktree differently: the worktree now differs from the
    // index too, so Index and Worktree drift simultaneously and independently.
    std::fs::write(dir.join("src/a.rs"), "l1\nl2\nWORKTREE\nl4\nl5\n").expect("worktree edit");

    let repo = gix::open(dir).expect("gix open");
    let names = vec!["demo".to_string()];

    let committed_span = resolve_named_spans(&repo, ".span", &names, EngineOptions::committed_only())?
        [0]
    .1
    .as_ref()
    .expect("committed resolution succeeds")
    .clone();
    let effective_span = resolve_named_spans(&repo, ".span", &names, EngineOptions::full())?[0]
        .1
        .as_ref()
        .expect("effective resolution succeeds")
        .clone();

    let core = capture_resolution_core(&repo, ".span", &names)?;

    // Both layers captured independent drift — the exact property the
    // two-pass reconstruction could not represent.
    let (_, anchor_core) = &core.spans[0].anchors[0];
    assert!(
        anchor_core.index.shows_drift(),
        "index layer must record independent drift"
    );
    assert!(
        anchor_core.worktree.shows_drift(),
        "worktree layer must record independent drift"
    );

    let projected_effective = project_effective(&core, LayerSet::full());
    // Direct resolution attributes both layers; the capture must reproduce the
    // full two-entry attribution, not collapse it to a single source.
    assert_eq!(
        projected_effective[0].anchors[0].layer_sources,
        vec![DriftSource::Worktree, DriftSource::Index],
        "both drifting layers must be attributed, in resolver order (Worktree, Index)"
    );
    assert_eq!(
        project_committed(&core),
        vec![committed_span],
        "committed projection must be byte-identical to direct committed-only resolution"
    );
    assert_eq!(
        projected_effective,
        vec![effective_span],
        "effective projection must be byte-identical to direct full-layer resolution"
    );
    Ok(())
}

// ── Category 3: duplicate-definition ordinal identity ────────────────────

fn fresh_observation(anchored: &LocationCore) -> LayerObservationCore {
    LayerObservationCore {
        status: AnchorStatus::Fresh,
        current: Some(anchored.clone()),
        content_equivalent: false,
        fuzzy_successors: Vec::new(),
    }
}

/// Duplicate anchor addresses are valid parser input
/// (`notes/correctness-contract.md` "Completeness, Identity, And Order")
/// and must never collapse to one row. Two anchor records pinning the
/// identical `(path, extent)` share an `anchor_id` (the address); only
/// `DefinitionOrdinal.source_ordinal` (paired with the distinguishing
/// `definition_digest`) tells them apart.
#[test]
fn duplicate_definition_ordinal_identity_preserved_through_construction_serialization_and_merge()
{
    let anchored = LocationCore {
        path: "src/a.rs".to_string(),
        extent: ExtentCore::WholeFile,
        blob: Some("1".repeat(40)),
    };
    let anchor_a = AnchorCore {
        anchor_id: "demo:src/a.rs:L0-L0".to_string(),
        anchor_sha: "a".repeat(40),
        anchored: anchored.clone(),
        head: fresh_observation(&anchored),
        index: fresh_observation(&anchored),
        worktree: fresh_observation(&anchored),
        full: fresh_observation(&anchored),
        locus: None,
    };
    let mut anchor_b = anchor_a.clone();
    anchor_b.anchor_sha = "b".repeat(40); // distinct anchor record, same address

    let digest_a = DefinitionOrdinal::digest_definition(
        &anchor_a.anchor_id,
        &anchor_a.anchor_sha,
        "src/a.rs",
        ExtentCore::WholeFile,
    );
    let digest_b = DefinitionOrdinal::digest_definition(
        &anchor_b.anchor_id,
        &anchor_b.anchor_sha,
        "src/a.rs",
        ExtentCore::WholeFile,
    );
    assert_ne!(
        digest_a, digest_b,
        "distinct anchor_sha must yield distinct definition digests despite the shared address"
    );

    let ord_a = DefinitionOrdinal {
        span_identity: "demo".to_string(),
        source_ordinal: 0,
        definition_digest: digest_a,
    };
    let ord_b = DefinitionOrdinal {
        span_identity: "demo".to_string(),
        source_ordinal: 1,
        definition_digest: digest_b,
    };

    let core = ResolutionCore {
        spans: vec![SpanCore {
            name: "demo".to_string(),
            message: "why".to_string(),
            follow_moves: false,
            anchors: vec![(ord_a.clone(), anchor_a.clone()), (ord_b.clone(), anchor_b.clone())],
        }],
    };
    assert_eq!(
        core.spans[0].anchors.len(),
        2,
        "duplicate addresses must not collapse to one row at construction"
    );

    let bytes = bincode::serialize(&core).expect("serialize ResolutionCore");
    let round_tripped: ResolutionCore =
        bincode::deserialize(&bytes).expect("deserialize ResolutionCore");
    assert_eq!(
        round_tripped, core,
        "ordinal identity must survive a serialize/deserialize round trip"
    );

    let other = ResolutionCore {
        spans: vec![SpanCore {
            name: "other".to_string(),
            message: "why-other".to_string(),
            follow_moves: false,
            anchors: Vec::new(),
        }],
    };
    let merged = core.clone().merge(other);
    assert_eq!(merged.spans.len(), 2, "merge must add the unrelated span");
    let demo_span = merged
        .spans
        .iter()
        .find(|s| s.name == "demo")
        .expect("demo span survives merge");
    assert_eq!(
        demo_span.anchors.len(),
        2,
        "merge must not collapse duplicate-address ordinals"
    );
    assert_eq!(demo_span.anchors[0].0, ord_a);
    assert_eq!(demo_span.anchors[1].0, ord_b);
}

// ── Category 4: `.gitignore` dirty mismatch, reproduced correctly ────────

/// Reproduces, at the projection level, the divergence documented in
/// `tests/cases/gitignore_dirty_cache_divergence.rs`: an anchor with real
/// committed (HEAD) drift that is ALSO touched by a worktree edit must
/// render "changed in the working tree" under the effective projection,
/// not the committed-only view's HEAD-sourced label. This is the NEW
/// projection producing the CORRECT output (distinct from the `#[ignore]`d
/// integration regression test, which documents the OLD `cache_v2`
/// baseline path's bug of collapsing `source` to Head regardless of active
/// layers).
#[test]
fn effective_projection_preserves_working_tree_qualifier_for_committed_drift() {
    let anchored = LocationCore {
        path: "src/a.rs".to_string(),
        extent: ExtentCore::WholeFile,
        blob: Some("a".repeat(40)),
    };
    let head_current = LocationCore {
        path: "src/a.rs".to_string(),
        extent: ExtentCore::WholeFile,
        blob: Some("b".repeat(40)),
    };
    let worktree_current = LocationCore {
        path: "src/a.rs".to_string(),
        extent: ExtentCore::WholeFile,
        blob: None,
    };

    let head = LayerObservationCore {
        status: AnchorStatus::Changed,
        current: Some(head_current),
        content_equivalent: false,
        fuzzy_successors: Vec::new(),
    };
    let worktree = LayerObservationCore {
        status: AnchorStatus::Changed,
        current: Some(worktree_current),
        content_equivalent: false,
        fuzzy_successors: Vec::new(),
    };
    let index = fresh_observation(&anchored);

    let anchor = AnchorCore {
        anchor_id: "demo:src/a.rs:L0-L0".to_string(),
        anchor_sha: "c".repeat(40),
        anchored,
        head,
        index,
        // The effective (deepest-layer) observation IS the worktree view here,
        // since the worktree is where this anchor drifts.
        full: worktree.clone(),
        worktree,
        locus: Some(DriftLocusCore::ChangedAt("d".repeat(40))),
    };
    let ordinal = DefinitionOrdinal {
        span_identity: "demo".to_string(),
        source_ordinal: 0,
        definition_digest: [0u8; 32],
    };
    let core = ResolutionCore {
        spans: vec![SpanCore {
            name: "demo".to_string(),
            message: "why".to_string(),
            follow_moves: false,
            anchors: vec![(ordinal, anchor)],
        }],
    };

    let committed = project_committed(&core);
    let effective = project_effective(&core, LayerSet::full());

    let committed_anchor = &committed[0].anchors[0];
    let effective_anchor = &effective[0].anchors[0];

    assert_eq!(
        committed_anchor.source,
        Some(DriftSource::Head),
        "committed projection must be Head-sourced only"
    );
    assert_eq!(
        effective_anchor.source,
        Some(DriftSource::Worktree),
        "effective projection must select the worktree observation"
    );

    let committed_label = format_drift_label(
        &committed_anchor.status,
        committed_anchor.source,
        committed_anchor.locus.as_ref(),
        committed_anchor.current.is_some(),
    );
    let effective_label = format_drift_label(
        &effective_anchor.status,
        effective_anchor.source,
        effective_anchor.locus.as_ref(),
        effective_anchor.current.is_some(),
    );

    assert!(
        effective_label.contains("in the working tree"),
        "effective projection must render the working-tree qualifier: {effective_label}"
    );
    assert!(
        !committed_label.contains("in the working tree"),
        "committed projection must not claim worktree drift it never observed: {committed_label}"
    );
}

// ── Category 5: same-tree/different-commit history guard ────────────────

/// GUARD: today's output is content/tree-based, not commit-based (see
/// `notes/investigation-question-log.md` Step 6, "Must HEAD commit be part
/// of every exact result key?"). This test asserts that invariant
/// explicitly so a future change that makes output depend on commit
/// identity (e.g. exposing history/locus text beyond the Head-sourced
/// `locus` field) FAILS LOUDLY here instead of silently producing a wrong
/// cache hit. When that day comes: promote commit identity into
/// `StateToken::canonical_key_digest` and update this test to assert
/// inequality instead of equality.
#[test]
fn same_tree_different_commit_history_is_output_stable() {
    let base = sample_token();
    let mut different_commit = base.clone();
    different_commit.head = "9".repeat(40);
    assert_eq!(
        base.canonical_key_digest(),
        different_commit.canonical_key_digest(),
        "same source tree, different HEAD commit must produce the same canonical key \
         while output remains content-only -- if this now fails, a field started \
         depending on commit identity and must be promoted into the exact key"
    );
}

// ── Category 6: filter dependency eligibility ─────────────────────────────

/// Persistence eligibility must be false unless a complete filter
/// dependency identity (both executable and env digests) is present, and
/// must also be false on any typed `Unreadable` path state — never a
/// wall-clock-seeded stand-in for an unproven identity.
#[test]
fn filter_dependency_persistence_eligibility_requires_complete_identity() {
    let token = sample_token();
    assert!(
        token.persistence_eligible(),
        "sample token with complete filter identities must be eligible"
    );

    let mut missing_exe = sample_token();
    missing_exe.filters[0].executable_digest = None;
    assert!(
        !missing_exe.persistence_eligible(),
        "missing executable digest must make persistence ineligible"
    );

    let mut missing_env = sample_token();
    missing_env.filters[0].env_digest = None;
    assert!(
        !missing_env.persistence_eligible(),
        "missing env digest must make persistence ineligible"
    );

    let mut unreadable_index = sample_token();
    unreadable_index.index_identity = PathState::Unreadable;
    assert!(
        !unreadable_index.persistence_eligible(),
        "unreadable index identity must make persistence ineligible"
    );

    let mut unreadable_staged = sample_token();
    unreadable_staged.staged_state.push(PathStateEntry {
        path: "x".to_string(),
        state: PathState::Unreadable,
    });
    assert!(
        !unreadable_staged.persistence_eligible(),
        "unreadable staged path state must make persistence ineligible"
    );

    let mut unreadable_worktree = sample_token();
    unreadable_worktree.worktree_state.push(PathStateEntry {
        path: "y".to_string(),
        state: PathState::Unreadable,
    });
    assert!(
        !unreadable_worktree.persistence_eligible(),
        "unreadable worktree path state must make persistence ineligible"
    );
}
