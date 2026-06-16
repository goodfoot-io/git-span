//! Slice 8 performance gate: HEAD-only `stale` on a comparable fixture.
//!
//! `EngineOptions::committed_only()` short-circuits the diff-files /
//! diff-index calls and the staging-dir walk. The bench measures
//! `stale_meshes` on a small synthetic fixture seeded once per run
//! (criterion handles the iteration loop). See
//! `docs/stale-layers-plan.md` §"Performance gate" — the >10%
//! regression policy is a CI-gate concern, not enforced here.

use criterion::{Criterion, criterion_group, criterion_main};
use git_mesh::{EngineOptions, stale_meshes};
use std::process::Command;

struct Fixture {
    _dir: tempfile::TempDir,
    repo_path: std::path::PathBuf,
}

fn build_fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path().to_path_buf();
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .current_dir(&p)
            .args(args)
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    git(&["init", "--initial-branch=main"]);
    git(&["config", "user.name", "Bench"]);
    git(&["config", "user.email", "bench@example.com"]);
    git(&["config", "commit.gpgsign", "false"]);
    // 10 small files, each with 20 lines.
    for i in 0..10u32 {
        let body: String = (0..20).map(|n| format!("line{i}_{n}\n")).collect();
        std::fs::write(p.join(format!("file_{i}.txt")), body).expect("write");
    }
    git(&["add", "."]);
    git(&["commit", "-m", "seed"]);

    // Pin a mesh on each file using library API so renamed symbols fail at compile time.
    std::fs::create_dir_all(p.join(".mesh")).expect("create .mesh");
    for i in 0..10u32 {
        let filename = format!("file_{i}.txt");
        let body = std::fs::read(p.join(&filename)).expect("read file");
        // Canonical rk64 anchor over the SAME LineRange extent the anchor
        // declares. `content_hash` is the BARE 16-hex rk64 value; the
        // `algorithm` field supplies the `rk64` token, so the serialized
        // address line `<path>#L1-L5 rk64:<16hex>` is canonical and resolves
        // fresh on this unmutated tree. The prior
        // `format!("sha256:{}", sha256_hex(..))` with `algorithm: "rk64"`
        // produced the malformed `rk64:sha256:<64hex>`, so every anchor
        // resolved `— changed` and the head-only fixture measured an
        // all-changed fiction instead of the fresh corpus it documents.
        let extent = git_mesh_core::AnchorExtent::LineRange { start: 1, end: 5 };
        let fp = git_mesh_core::cheap_fingerprint_with_extent(&body, &extent);
        let hash = git_mesh_core::rk64_to_hex(fp);
        let mf = git_mesh::mesh_file::MeshFile {
            anchors: vec![git_mesh::mesh_file::AnchorRecord {
                path: filename.clone(),
                start_line: 1,
                end_line: 5,
                algorithm: git_mesh_core::RK64_ALGORITHM.into(),
                content_hash: hash,
            }],
            why: "bench".to_string(),
        };
        std::fs::write(p.join(".mesh").join(format!("bench-{i}")), mf.serialize())
            .expect("write mesh file");
    }
    git(&["add", ".mesh"]);
    git(&["commit", "-m", "add meshes"]);

    Fixture {
        _dir: dir,
        repo_path: p,
    }
}

fn bench_head_only(c: &mut Criterion) {
    let f = build_fixture();
    c.bench_function("stale_meshes_head_only", |b| {
        b.iter(|| {
            let repo = gix::open(&f.repo_path).expect("open repo");
            let out = stale_meshes(&repo, ".mesh", EngineOptions::committed_only()).expect("stale");
            std::hint::black_box(out);
        });
    });
}

criterion_group!(benches, bench_head_only);
criterion_main!(benches);
