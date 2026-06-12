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
fn devcontainer_has_no_rustc_wrapper() {
    let path = workspace_root()
        .join(".devcontainer")
        .join("devcontainer.json");
    let body = std::fs::read_to_string(&path).unwrap();
    let json: serde_json::Value =
        serde_json::from_str(&body).expect("devcontainer.json must be valid JSON");
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
