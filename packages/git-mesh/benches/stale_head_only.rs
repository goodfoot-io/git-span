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
        // Hash lines 1-5 (indices 0-4): join with \n, no trailing newline.
        let text = String::from_utf8_lossy(&body);
        let lines: Vec<&str> = text.lines().collect();
        let slice = &lines[0..5.min(lines.len())];
        let hashed: Vec<u8> = slice.join("\n").into_bytes();
        let hash = format!("sha256:{}", git_mesh::types::sha256_hex(&hashed));
        let mf = git_mesh::mesh_file::MeshFile {
            anchors: vec![git_mesh::mesh_file::AnchorRecord {
                path: filename.clone(),
                start_line: 1,
                end_line: 5,
                algorithm: "rk64".into(),
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
