use std::fs;
use std::io::Read;
use std::path::PathBuf;

fn hash_file(path: &std::path::Path, hash: &mut u64) {
    println!("cargo:rerun-if-changed={}", path.display());
    let mut file = fs::File::open(path).expect("open build-identity input");
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = file.read(&mut buffer).expect("read build-identity input");
        if count == 0 {
            break;
        }
        for byte in &buffer[..count] {
            *hash ^= u64::from(*byte);
            *hash = hash.wrapping_mul(0x100000001b3);
        }
    }
}

fn hash_tree(path: &std::path::Path, hash: &mut u64) {
    let mut entries = fs::read_dir(path)
        .expect("read build-identity directory")
        .collect::<Result<Vec<_>, _>>()
        .expect("enumerate build-identity directory");
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            hash_tree(&path, hash);
        } else {
            hash_file(&path, hash);
        }
    }
}

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let package_json_path = manifest_dir.join("package.json");
    println!("cargo:rerun-if-changed={}", package_json_path.display());

    let package_json = fs::read_to_string(&package_json_path).expect("read package.json");
    let parsed: serde_json::Value =
        serde_json::from_str(&package_json).expect("parse package.json");
    let version = parsed
        .get("version")
        .and_then(serde_json::Value::as_str)
        .expect("package.json version");

    println!("cargo:rustc-env=GIT_SPAN_VERSION={version}");

    // A protocol peer must never reuse a resident generation produced by a
    // different binary. Hash every compiled source plus the package manifest;
    // Cargo reruns this script whenever one of those inputs changes.
    let mut build_id = 0xcbf29ce484222325_u64;
    hash_tree(&manifest_dir.join("src"), &mut build_id);
    hash_file(&manifest_dir.join("Cargo.toml"), &mut build_id);
    println!("cargo:rustc-env=GIT_SPAN_BUILD_ID={build_id:016x}");
}
