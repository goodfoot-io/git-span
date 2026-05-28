//! Composite cache-key derivation for `cache_v2`.
//!
//! The file-backed layout replaces the old `catalog_tree_oid` with a
//! `mesh_tree_key`: the tree object id of the configured mesh root at
//! `HEAD`, or a sentinel empty-tree key when the mesh root does not
//! exist at `HEAD`. Every committed-finding key is the tuple
//! `(source_tree_key, mesh_tree_key, mesh_root, filter_config_hash,
//! key_salt)`; the baseline manifest additionally carries
//! `availability_hash`. The dirty overlay key is a single digest over
//! the committed key plus every exact staged/worktree content identity.
//!
//! Correctness comes from key-based invalidation: any change to mesh
//! root, `mesh_tree_key`, `source_tree_key`, `key_salt`,
//! `filter_config_hash`, index checksum, availability inputs, or dirty
//! content identities yields a different key, hence a miss and rebuild.

use super::schema::{KEY_SALT, hex32, write_prefixed};
use blake3::Hasher;
use std::collections::BTreeSet;

/// Hex of the empty git tree object id (`4b825dc...`). Used as
/// `mesh_tree_key` when the mesh root is absent at `HEAD` so "no mesh
/// files committed" is a distinct, cacheable key rather than a miss
/// sentinel.
pub(crate) const EMPTY_TREE_HEX: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Tuple identifying a committed resolution: everything that determines
/// the HEAD-only stale answer for the whole mesh set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CommittedKey {
    pub(crate) source_tree_key: String,
    pub(crate) mesh_tree_key: String,
    pub(crate) mesh_root: String,
    pub(crate) filter_config_hash: [u8; 32],
    pub(crate) key_salt: i64,
}

impl CommittedKey {
    pub(crate) fn filter_hex(&self) -> String {
        hex32(&self.filter_config_hash)
    }

    /// 32-byte digest of the committed key, used as the stable prefix
    /// of every dirty overlay key.
    fn digest(&self) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.cache_v2.committed-key\0");
        h.update(&self.key_salt.to_le_bytes());
        write_prefixed(&mut h, self.source_tree_key.as_bytes());
        write_prefixed(&mut h, self.mesh_tree_key.as_bytes());
        write_prefixed(&mut h, self.mesh_root.as_bytes());
        h.update(&self.filter_config_hash);
        *h.finalize().as_bytes()
    }
}

/// `availability_hash` for the committed baseline manifest: the
/// sparse/LFS/promisor availability inputs. Cached `ContentUnavailable`
/// results are invalidated when availability changes even though the
/// committed key is otherwise stable.
pub(crate) fn availability_hash(
    lfs_installed: bool,
    sparse_active: bool,
    promisor_active: bool,
) -> [u8; 32] {
    let mut h = Hasher::new();
    h.update(b"gm.cache_v2.availability\0");
    h.update(&KEY_SALT.to_le_bytes());
    h.update(&[
        u8::from(lfs_installed),
        u8::from(sparse_active),
        u8::from(promisor_active),
    ]);
    *h.finalize().as_bytes()
}

/// Stable per-anchor identity within a mesh tree: mesh file path plus
/// the anchor's address. Deterministic across runs so committed and
/// dirty finding rows for the same anchor share a key.
pub(crate) fn anchor_key(mesh_file_path: &str, source_path: &str, start: u32, end: u32) -> String {
    let mut h = Hasher::new();
    h.update(b"gm.cache_v2.anchor-key\0");
    write_prefixed(&mut h, mesh_file_path.as_bytes());
    write_prefixed(&mut h, source_path.as_bytes());
    h.update(&start.to_le_bytes());
    h.update(&end.to_le_bytes());
    hex32(h.finalize().as_bytes())
}

/// All inputs to the dirty overlay key. The runtime constructs this
/// from the engine's layer status; tests construct it directly.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct OverlayKeyInputs {
    /// Digest of the committed key this overlay layers onto.
    pub(crate) committed_digest: [u8; 32],
    /// `.git/index` fingerprint (clean ⇒ all-zero, dirty ⇒ trailer-derived).
    pub(crate) index_checksum: [u8; 32],
    /// Exact staged + worktree mesh-file content identities.
    pub(crate) dirty_mesh_fingerprint: [u8; 32],
    /// Exact dirty source-file content identities.
    pub(crate) dirty_source_fingerprint: [u8; 32],
    /// Read mode + layer identity + tombstone state.
    pub(crate) layer_fingerprint: [u8; 32],
}

impl OverlayKeyInputs {
    pub(crate) fn new(committed: &CommittedKey) -> Self {
        Self {
            committed_digest: committed.digest(),
            ..Self::default()
        }
    }

    /// Final 32-byte overlay key. Stored as a SQLite `BLOB PRIMARY KEY`.
    pub(crate) fn key(&self) -> [u8; 32] {
        let mut h = Hasher::new();
        h.update(b"gm.cache_v2.overlay\0");
        h.update(&KEY_SALT.to_le_bytes());
        h.update(&self.committed_digest);
        h.update(&self.index_checksum);
        h.update(&self.dirty_mesh_fingerprint);
        h.update(&self.dirty_source_fingerprint);
        h.update(&self.layer_fingerprint);
        *h.finalize().as_bytes()
    }
}

/// Fingerprint of the `.git/index` for overlay-key purposes.
///
/// * Clean index ⇒ all-zero digest (two clean invocations match).
/// * Dirty with a readable trailer ⇒ digest of the trailer.
/// * Dirty with no readable trailer ⇒ digest seeded with wall-clock
///   seconds so two unknown-trailer states never collide.
pub(crate) fn index_checksum_bytes(trailer: Option<[u8; 20]>, index_dirty: bool) -> [u8; 32] {
    let mut h = Hasher::new();
    h.update(b"gm.cache_v2.index-checksum\0");
    match (index_dirty, trailer) {
        (false, _) => {
            h.update(&[0u8]);
        }
        (true, Some(t)) => {
            h.update(&[1u8]);
            h.update(&t);
        }
        (true, None) => {
            h.update(&[2u8]);
            h.update(&super::schema::now_secs().to_le_bytes());
        }
    }
    *h.finalize().as_bytes()
}

/// Digest of a sorted `(path -> content-identity)` set. `identities`
/// are blob ids when available, or digests of normalized worktree
/// bytes for worktree-only content; the caller decides. The digest is
/// stable under set reordering.
pub(crate) fn content_identity_fingerprint<'a, I>(domain: &[u8], items: I) -> [u8; 32]
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    let mut set: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (path, id) in items {
        set.insert((path, id));
    }
    let mut h = Hasher::new();
    h.update(domain);
    h.update(&KEY_SALT.to_le_bytes());
    for (path, id) in set {
        write_prefixed(&mut h, path.as_bytes());
        write_prefixed(&mut h, id.as_bytes());
    }
    *h.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ck() -> CommittedKey {
        CommittedKey {
            source_tree_key: "src1".into(),
            mesh_tree_key: "mt1".into(),
            mesh_root: ".mesh".into(),
            filter_config_hash: [7; 32],
            key_salt: KEY_SALT,
        }
    }

    #[test]
    fn committed_digest_sensitive_to_each_field() {
        let base = ck().digest();
        let mut a = ck();
        a.source_tree_key = "src2".into();
        assert_ne!(base, a.digest(), "source tree change");
        let mut b = ck();
        b.mesh_tree_key = "mt2".into();
        assert_ne!(base, b.digest(), "mesh tree change");
        let mut c = ck();
        c.mesh_root = "meshes".into();
        assert_ne!(base, c.digest(), "mesh root change");
        let mut d = ck();
        d.filter_config_hash = [9; 32];
        assert_ne!(base, d.digest(), "filter config change");
    }

    #[test]
    fn overlay_key_sensitive_to_each_field() {
        let mut inp = OverlayKeyInputs::new(&ck());
        let base = inp.key();
        inp.index_checksum = [1; 32];
        assert_ne!(base, inp.key(), "index checksum");
        let mut inp2 = OverlayKeyInputs::new(&ck());
        inp2.dirty_mesh_fingerprint = [2; 32];
        assert_ne!(base, inp2.key(), "dirty mesh");
        let mut inp3 = OverlayKeyInputs::new(&ck());
        inp3.dirty_source_fingerprint = [3; 32];
        assert_ne!(base, inp3.key(), "dirty source");
        let mut inp4 = OverlayKeyInputs::new(&ck());
        inp4.layer_fingerprint = [4; 32];
        assert_ne!(base, inp4.key(), "layer identity");
    }

    #[test]
    fn anchor_key_is_deterministic_and_distinct() {
        let a = anchor_key(".mesh/m", "src/a.rs", 1, 10);
        let b = anchor_key(".mesh/m", "src/a.rs", 1, 10);
        assert_eq!(a, b, "same inputs ⇒ same key");
        assert_ne!(a, anchor_key(".mesh/m", "src/a.rs", 1, 11), "range change");
        assert_ne!(a, anchor_key(".mesh/m", "src/b.rs", 1, 10), "path change");
        assert_ne!(a, anchor_key(".mesh/n", "src/a.rs", 1, 10), "mesh change");
    }

    #[test]
    fn content_identity_fingerprint_is_order_independent() {
        let a = content_identity_fingerprint(b"d\0", [("a", "1"), ("b", "2")]);
        let b = content_identity_fingerprint(b"d\0", [("b", "2"), ("a", "1")]);
        assert_eq!(a, b);
        let c = content_identity_fingerprint(b"d\0", [("a", "9"), ("b", "2")]);
        assert_ne!(a, c, "identity change must change fingerprint");
    }

    #[test]
    fn availability_hash_sensitive() {
        let base = availability_hash(true, false, false);
        assert_ne!(base, availability_hash(false, false, false));
        assert_ne!(base, availability_hash(true, true, false));
        assert_ne!(base, availability_hash(true, false, true));
    }
}
