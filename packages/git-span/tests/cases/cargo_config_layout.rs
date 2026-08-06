//! Structural invariants for the cargo configuration layout.
//!
//! A workspace-root `.cargo/config.toml` is picked up by every root-CWD cargo
//! invocation (notably `Swatinem/rust-cache@v2`'s `cargo metadata`), and Cargo
//! cannot find a `Cargo.toml` from the repo root. Both failures are eliminated by
//! keeping cargo configuration package-local and keeping compiler wrappers out of
//! version-controlled config — they belong in the environment.
use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

#[test]
fn no_cargo_config_at_workspace_root() {
    let path = workspace_root().join(".cargo").join("config.toml");
    assert!(
        !path.exists(),
        "{} must not exist: Cargo config at the workspace root is picked up by root-CWD cargo invocations (e.g. CI cache actions) and can inject an unwanted rustc-wrapper",
        path.display()
    );
}

#[test]
fn package_local_cargo_config_has_no_rustc_wrapper() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(".cargo")
        .join("config.toml");
    assert!(path.exists(), "{} must exist", path.display());
    let body = std::fs::read_to_string(&path).unwrap();
    let has_wrapper_key = body
        .lines()
        .map(|l| l.split('#').next().unwrap_or("").trim())
        .any(|l| l.starts_with("rustc-wrapper"));
    assert!(
        !has_wrapper_key,
        "package-local cargo config must not pin rustc-wrapper; compilers wrappers belong in the environment, not in version-controlled config."
    );
}

#[test]
fn cargo_config_linker_values_are_worktree_invariant_bare_names() {
    // Cargo 1.97 hashes the *resolved* [target.*].linker value into every unit
    // fingerprint. A relative-path linker resolves to a per-worktree absolute
    // path (dirty: ConfigSettingsChanged from sibling worktrees → full-graph
    // recompiles against the warm shared root — main-218/main-220); a bare
    // name is hashed as the literal string, identical from every worktree, and
    // is looked up on PATH at spawn time. Both packages must pin a bare name
    // in both Linux GNU target sections.
    let root = workspace_root();
    for pkg in ["git-span", "git-span-core"] {
        let path = root.join("packages").join(pkg).join(".cargo/config.toml");
        let body = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let linker_values: Vec<&str> = body
            .lines()
            .filter_map(|l| {
                let l = l.split('#').next().unwrap_or("").trim();
                l.strip_prefix("linker = ")
                    .map(|v| v.trim().trim_matches('"'))
            })
            .collect();
        assert_eq!(
            linker_values.len(),
            2,
            "{} must pin the linker in both target sections \
             (x86_64-unknown-linux-gnu and aarch64-unknown-linux-gnu); found: {:?}",
            path.display(),
            linker_values
        );
        for v in &linker_values {
            assert!(
                !v.contains('/'),
                "{}: linker {v:?} is a relative path — cargo resolves it to a \
                 per-worktree absolute path and hashes that into every unit \
                 fingerprint, forcing full-graph recompiles from sibling \
                 worktrees (main-220). Use a bare name (\"cc.mold-wrapper\") \
                 resolved via PATH.",
                path.display()
            );
        }
    }
}

#[test]
fn devcontainer_has_no_rustc_wrapper() {
    let path = workspace_root()
        .join(".devcontainer")
        .join("devcontainer.json");
    let body = std::fs::read_to_string(&path).unwrap();
    // devcontainer.json is JSONC (the Dev Container spec allows `//`
    // line comments); strip full-line comments before handing it to
    // `serde_json`, which only accepts strict JSON.
    let stripped: String = body
        .lines()
        .map(|l| {
            if l.trim_start().starts_with("//") {
                ""
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let json: serde_json::Value =
        serde_json::from_str(&stripped).expect("devcontainer.json must be valid JSONC");
    let wrapper = json
        .get("remoteEnv")
        .and_then(|e| e.get("RUSTC_WRAPPER"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        wrapper.is_empty(),
        "{} must not set RUSTC_WRAPPER in remoteEnv — the project does not use a compiler cache wrapper",
        path.display()
    );
}
