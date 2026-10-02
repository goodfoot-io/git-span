//! Repository-bound derived observations. A lookup proves current dependency
//! bytes afresh; persisted data never establishes object availability by itself.

// Contract-only bootstrap: removed when consumers are integrated.
#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub(crate) const MAX_ENTRY_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_ENTRIES: usize = 4096;
pub(crate) const MAX_DATABASE_BYTES: usize = 32 * 1024 * 1024;
const PAYLOAD_VERSION: u32 = 1;

/// Name-independent successful declaration facts; the consumer attaches its
/// current name. Named parser failures are never memoized.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct DeclarationSummary {
    pub(crate) anchor_paths: Vec<String>,
    pub(crate) copy_detection: crate::types::CopyDetection,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) enum ObservationKind {
    Declaration,
    TreeMap,
    BlobDigest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) enum Observation {
    Declaration(DeclarationSummary),
    TreeMap(BTreeMap<String, String>),
    BlobDigest([u8; 32]),
}

/// Exact raw bytes with the expected object kind. Tree maps include every
/// traversed subtree, including empty ones, and the root.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct Witness {
    pub(crate) oid: String,
    pub(crate) tree: bool,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub(crate) entry_bytes: usize,
    pub(crate) entries: usize,
    pub(crate) database_bytes: usize,
}

pub(crate) struct ImmutableMemo<'repo> {
    repo: &'repo gix::Repository,
    conn: rusqlite::Connection,
    limits: Limits,
}

impl<'repo> ImmutableMemo<'repo> {
    /// Disabled caching and storage errors return no memo.
    pub(crate) fn open(_repo: &'repo gix::Repository) -> Option<Self> {
        todo!("immutable memo contract")
    }

    /// Verify the bounded envelope and every currently readable, correctly
    /// typed dependency. A rejection is a miss, so the caller reconstructs
    /// authoritatively and retains its normal object-error handling.
    pub(crate) fn lookup(&self, _oid: &str, _kind: ObservationKind) -> Option<Observation> {
        todo!("immutable memo contract")
    }

    /// Admission is best-effort and transactional. Oversized/invalid entries
    /// are skipped; the database and row count remain independently bounded.
    pub(crate) fn admit(&mut self, _oid: &str, _value: &Observation, _witnesses: &[Witness]) {
        todo!("immutable memo contract")
    }
}

/// Independent storage view for a single capture/guard/revalidation boundary.
/// Construction copies the live configured replacement policy into a NEW Store,
/// never a clone sharing mapped packs. Direct reads never synthesize empty trees.
pub(crate) struct CurrentReader {
    objects: gix::OdbHandle,
    policy: [u8; 32],
    hash: gix::hash::Kind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HeadObservation {
    pub(crate) commit: gix::ObjectId,
    pub(crate) tree: gix::ObjectId,
}

impl CurrentReader {
    pub(crate) fn new(_repo: &gix::Repository) -> crate::Result<Self> {
        todo!("independent current reader contract")
    }

    /// Requires an actual object of the requested kind under the copied policy.
    pub(crate) fn read(
        &self,
        _oid: gix::ObjectId,
        _kind: gix::object::Kind,
    ) -> crate::Result<Vec<u8>> {
        todo!("independent current reader contract")
    }

    /// Resolve current HEAD/ref identity, then peel/decode through direct bytes.
    /// Only an unborn HEAD returns None; unavailable referenced objects error.
    pub(crate) fn head(&self, _repo: &gix::Repository) -> crate::Result<Option<HeadObservation>> {
        todo!("independent current reader contract")
    }

    /// Each ancestor is decoded through current bytes, including when absent.
    pub(crate) fn tree_entry(
        &self,
        _root: gix::ObjectId,
        _path: &str,
    ) -> crate::Result<Option<(gix::objs::tree::EntryMode, gix::ObjectId)>> {
        todo!("independent current reader contract")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, Stdio};

    fn fixture() -> (tempfile::TempDir, gix::Repository) {
        unsafe {
            std::env::remove_var("GIT_SPAN_CACHE");
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(
            Command::new("git")
                .args(["init", "-q"])
                .arg(dir.path())
                .status()
                .unwrap()
                .success()
        );
        let repo = gix::open(dir.path()).unwrap();
        (dir, repo)
    }

    fn object(repo: &gix::Repository, kind: &str, bytes: &[u8]) -> String {
        let mut child = Command::new("git")
            .current_dir(repo.path())
            .args(["hash-object", "-w", "-t", kind, "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(bytes).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }

    fn blob(repo: &gix::Repository, bytes: &[u8]) -> (String, Observation, Vec<Witness>) {
        let oid = object(repo, "blob", bytes);
        (
            oid.clone(),
            Observation::BlobDigest(*blake3::hash(bytes).as_bytes()),
            vec![Witness {
                oid,
                tree: false,
                bytes: bytes.to_vec(),
            }],
        )
    }

    fn loose_path(repo: &gix::Repository, oid: &str) -> std::path::PathBuf {
        crate::git::common_dir(repo)
            .join("objects")
            .join(&oid[..2])
            .join(&oid[2..])
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_blob_reuse_persists_across_repository_reopen() {
        let (dir, repo) = fixture();
        let (oid, value, witnesses) = blob(&repo, b"source\n");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), None);
        memo.admit(&oid, &value, &witnesses);
        assert_eq!(
            memo.lookup(&oid, ObservationKind::BlobDigest),
            Some(value.clone())
        );
        drop(memo);
        let repo = gix::open(dir.path()).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&oid, ObservationKind::BlobDigest),
            Some(value)
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_missing_and_changed_blob_witnesses_reject() {
        let (dir, repo) = fixture();
        let (oid, value, witnesses) = blob(&repo, b"original");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.admit(&oid, &value, &witnesses);
        let other = object(&repo, "blob", b"changed!");
        std::fs::copy(loose_path(&repo, &other), loose_path(&repo, &oid)).unwrap();
        drop(memo);
        let repo = gix::open(dir.path()).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&oid, ObservationKind::BlobDigest),
            None
        );
        std::fs::remove_file(loose_path(&repo, &oid)).unwrap();
        let repo = gix::open(dir.path()).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&oid, ObservationKind::BlobDigest),
            None
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_wrong_kind_and_invalid_summary_reject() {
        let (_dir, repo) = fixture();
        let (oid, value, mut witnesses) = blob(&repo, b"original");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        witnesses[0].tree = true;
        memo.admit(&oid, &value, &witnesses);
        assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), None);
        witnesses[0].tree = false;
        memo.admit(&oid, &value, &witnesses);
        assert_eq!(memo.lookup(&oid, ObservationKind::TreeMap), None);
        let summary = Observation::Declaration(DeclarationSummary {
            anchor_paths: vec!["../escape".into()],
            copy_detection: crate::types::CopyDetection::Off,
        });
        memo.admit(&oid, &summary, &witnesses);
        assert_eq!(memo.lookup(&oid, ObservationKind::Declaration), None);
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_corrupt_envelope_and_oversized_payload_reject() {
        let (_dir, repo) = fixture();
        let (oid, value, witnesses) = blob(&repo, b"original");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        for mutation in [
            "version = 999",
            "epoch = 999",
            "kind = 999",
            "cardinality = 999",
            "digest = zeroblob(32)",
            "payload = x'00'",
            "payload = zeroblob(1048577)",
            "key = 'wrong'",
        ] {
            memo.admit(&oid, &value, &witnesses);
            memo.conn
                .execute(&format!("UPDATE memo SET {mutation}"), [])
                .unwrap();
            assert_eq!(
                memo.lookup(&oid, ObservationKind::BlobDigest),
                None,
                "{mutation}"
            );
        }
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_tree_requires_complete_current_descendant_witnesses() {
        let (dir, repo) = fixture();
        let child = object(&repo, "tree", b"");
        let mut bytes = b"40000 sub\0".to_vec();
        bytes.extend_from_slice(
            gix::ObjectId::from_hex(child.as_bytes())
                .unwrap()
                .as_bytes(),
        );
        let root = object(&repo, "tree", &bytes);
        let root_witness = Witness {
            oid: root.clone(),
            tree: true,
            bytes,
        };
        let child_witness = Witness {
            oid: child.clone(),
            tree: true,
            bytes: vec![],
        };
        let value = Observation::TreeMap(BTreeMap::new());
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.admit(&root, &value, std::slice::from_ref(&root_witness));
        assert_eq!(memo.lookup(&root, ObservationKind::TreeMap), None);
        memo.admit(&root, &value, &[root_witness, child_witness]);
        assert_eq!(memo.lookup(&root, ObservationKind::TreeMap), Some(value));
        std::fs::remove_file(loose_path(&repo, &child)).unwrap();
        drop(memo);
        let repo = gix::open(dir.path()).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&root, ObservationKind::TreeMap),
            None
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_tiny_limits_bound_count_and_database() {
        let (_dir, repo) = fixture();
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.limits = Limits {
            entry_bytes: 1024,
            entries: 2,
            database_bytes: 64 * 1024,
        };
        for source in [b"first".as_slice(), b"second", b"third"] {
            let (oid, value, witnesses) = blob(&repo, source);
            memo.admit(&oid, &value, &witnesses);
        }
        let count: usize = memo
            .conn
            .query_row("SELECT count(*) FROM memo", [], |row| row.get(0))
            .unwrap();
        assert!(count <= 2);
        let pages: usize = memo
            .conn
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .unwrap();
        let page_size: usize = memo
            .conn
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .unwrap();
        assert!(pages * page_size <= memo.limits.database_bytes);
        let (oid, value, witnesses) = blob(&repo, &vec![1; 2048]);
        memo.admit(&oid, &value, &witnesses);
        assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), None);
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn immutable_disabled_and_storage_failure_bypass() {
        let (_dir, repo) = fixture();
        unsafe {
            std::env::set_var("GIT_SPAN_CACHE", "0");
        }
        assert!(ImmutableMemo::open(&repo).is_none());
        unsafe {
            std::env::remove_var("GIT_SPAN_CACHE");
        }
        let location = crate::git::common_dir(&repo).join("span");
        std::fs::write(&location, b"blocking file").unwrap();
        assert!(ImmutableMemo::open(&repo).is_none());
        assert!(Path::new(&location).is_file());
    }
    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn committed_fixture() -> (tempfile::TempDir, gix::Repository, gix::ObjectId) {
        let (dir, _repo) = fixture();
        git(dir.path(), &["config", "user.name", "Test"]);
        git(dir.path(), &["config", "user.email", "test@example.com"]);
        git(dir.path(), &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.path().join("source"), b"before").unwrap();
        git(dir.path(), &["add", "source"]);
        git(dir.path(), &["commit", "-qm", "fixture"]);
        let mut repo = gix::open(dir.path()).unwrap();
        repo.object_cache_size_if_unset(1024 * 1024);
        let oid = repo
            .head_tree()
            .unwrap()
            .lookup_entry_by_path("source")
            .unwrap()
            .unwrap()
            .object_id();
        (dir, repo, oid)
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_detects_loose_removal_with_native_cache_warm() {
        let (_dir, repo, oid) = committed_fixture();
        assert_eq!(repo.find_object(oid).unwrap().data, b"before");
        std::fs::remove_file(loose_path(&repo, &oid.to_string())).unwrap();
        assert!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(oid, gix::object::Kind::Blob)
                .is_err()
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_detects_valid_loose_replacement_with_native_cache_warm() {
        let (_dir, repo, oid) = committed_fixture();
        assert_eq!(repo.find_object(oid).unwrap().data, b"before");
        let other = object(&repo, "blob", b"after");
        std::fs::copy(
            loose_path(&repo, &other),
            loose_path(&repo, &oid.to_string()),
        )
        .unwrap();
        assert_eq!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(oid, gix::object::Kind::Blob)
                .unwrap(),
            b"after"
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_detects_packed_removal_with_native_cache_warm() {
        let (dir, _repo, oid) = committed_fixture();
        git(dir.path(), &["repack", "-adq"]);
        let mut repo = gix::open(dir.path()).unwrap();
        repo.object_cache_size_if_unset(1024 * 1024);
        assert_eq!(repo.find_object(oid).unwrap().data, b"before");
        for entry in std::fs::read_dir(crate::git::common_dir(&repo).join("objects/pack")).unwrap()
        {
            std::fs::remove_file(entry.unwrap().path()).unwrap();
        }
        assert!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(oid, gix::object::Kind::Blob)
                .is_err()
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_detects_atomic_pack_replacement_with_native_cache_warm() {
        let (dir, _repo, oid) = committed_fixture();
        git(dir.path(), &["repack", "-adq"]);
        let mut repo = gix::open(dir.path()).unwrap();
        repo.object_cache_size_if_unset(1024 * 1024);
        assert_eq!(repo.find_object(oid).unwrap().data, b"before");
        let pack = std::fs::read_dir(crate::git::common_dir(&repo).join("objects/pack"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| p.extension().is_some_and(|e| e == "pack"))
            .unwrap();
        let mut bytes = std::fs::read(&pack).unwrap();
        bytes[..4].copy_from_slice(b"BAD!");
        let replacement = pack.with_extension("replacement");
        std::fs::write(&replacement, bytes).unwrap();
        std::fs::rename(replacement, pack).unwrap();
        assert!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(oid, gix::object::Kind::Blob)
                .is_err()
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_requires_physical_empty_tree_and_correct_kind() {
        let (_dir, repo) = fixture();
        let empty = gix::ObjectId::empty_tree(repo.object_hash());
        assert_eq!(repo.find_object(empty).unwrap().data, b"");
        let reader = CurrentReader::new(&repo).unwrap();
        assert!(reader.read(empty, gix::object::Kind::Tree).is_err());
        let oid = object(&repo, "tree", b"");
        assert!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(
                    gix::ObjectId::from_hex(oid.as_bytes()).unwrap(),
                    gix::object::Kind::Tree
                )
                .unwrap()
                .is_empty()
        );
        assert!(reader.read(empty, gix::object::Kind::Blob).is_err());
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_head_commit_and_missing_ancestor_are_current() {
        let (_dir, repo, _oid) = committed_fixture();
        let head = repo.head_commit().unwrap();
        let head_oid = head.id;
        let tree_oid = head.tree_id().unwrap().detach();
        let empty = object(&repo, "tree", b"");
        let replacement_commit = format!(
            "tree {empty}\nauthor Test <test@example.com> 0 +0000\ncommitter Test <test@example.com> 0 +0000\n\nreplacement\n"
        );
        let replacement = object(&repo, "commit", replacement_commit.as_bytes());
        std::fs::copy(
            loose_path(&repo, &replacement),
            loose_path(&repo, &head_oid.to_string()),
        )
        .unwrap();
        let observed = CurrentReader::new(&repo)
            .unwrap()
            .head(&repo)
            .unwrap()
            .unwrap();
        assert_eq!(observed.tree.to_string(), empty);
        assert_ne!(observed.tree, tree_oid);
        assert_eq!(
            repo.find_object(tree_oid).unwrap().kind,
            gix::object::Kind::Tree
        );
        std::fs::remove_file(loose_path(&repo, &tree_oid.to_string())).unwrap();
        assert!(
            CurrentReader::new(&repo)
                .unwrap()
                .tree_entry(tree_oid, ".span/missing")
                .is_err()
        );
    }

    #[test]
    #[ignore = "contract bootstrap"]
    fn current_reader_replacement_policy_is_copied_and_identified() {
        let (dir, repo, oid) = committed_fixture();
        let replacement = object(&repo, "blob", b"replacement");
        git(dir.path(), &["replace", &oid.to_string(), &replacement]);
        let enabled = gix::open(dir.path()).unwrap();
        let mut disabled = enabled.clone();
        disabled.objects.ignore_replacements = true;
        let reader = CurrentReader::new(&enabled).unwrap();
        let other = CurrentReader::new(&disabled).unwrap();
        assert_ne!(reader.policy, other.policy);
        assert_eq!(
            reader.read(oid, gix::object::Kind::Blob).unwrap(),
            b"replacement"
        );
        assert_eq!(other.read(oid, gix::object::Kind::Blob).unwrap(), b"before");
    }
}
