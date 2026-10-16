use std::fs;
use std::path::{Path, PathBuf};

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read {dir:?}: {e}"))
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

fn assert_in_sync(generated: &Path, committed: &Path) {
    assert_eq!(names(generated), names(committed), "page set differs; run `yarn build:man`");
    for name in names(generated) {
        assert_eq!(
            fs::read_to_string(generated.join(&name)).expect("generated"),
            fs::read_to_string(committed.join(&name)).expect("committed"),
            "{name} is stale; run `yarn build:man`"
        );
    }
}

#[test]
fn committed_man_and_html_pages_match_the_cli_definition() {
    let tmp: PathBuf = std::env::temp_dir().join(format!("git-mora-man-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    git_mora::write_man_pages(&tmp.join("man")).expect("man pages");
    git_mora::write_html_pages(&tmp.join("doc")).expect("html pages");
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_in_sync(&tmp.join("man"), &root.join("man"));
    assert_in_sync(&tmp.join("doc"), &root.join("doc"));
    fs::remove_dir_all(&tmp).expect("cleanup");
    assert!(root.join("man/git-mora.1").exists() && root.join("man/git-mora-tag-pending.1").exists());
}
