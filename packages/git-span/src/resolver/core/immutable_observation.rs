//! Repository-bound derived observations. A lookup proves current dependency
//! bytes afresh; persisted data never establishes object availability by itself.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub(crate) const MAX_ENTRY_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_ENTRIES: usize = 4096;
pub(crate) const MAX_DATABASE_BYTES: usize = 32 * 1024 * 1024;
const PAYLOAD_VERSION: u32 = 2;

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
    TreeMap(#[serde(deserialize_with = "unique_paths")] BTreeMap<String, String>),
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

/// Persisted form of a [`Witness`]: its raw byte length and BLAKE3 digest.
/// Lookup proves current bytes against this seal, so persisted entries stay
/// small enough that the working set fits the database budget.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SealedWitness {
    oid: String,
    tree: bool,
    len: usize,
    digest: [u8; 32],
}

impl SealedWitness {
    fn seal(w: &Witness) -> Self {
        Self {
            oid: w.oid.clone(),
            tree: w.tree,
            len: w.bytes.len(),
            digest: *blake3::hash(&w.bytes).as_bytes(),
        }
    }
}

/// The fields [`ImmutableMemo::shape_valid`] inspects, shared by admission
/// witnesses and their persisted seals.
struct WitnessShape<'a> {
    oid: &'a str,
    tree: bool,
    len: usize,
}

impl<'a> From<&'a Witness> for WitnessShape<'a> {
    fn from(w: &'a Witness) -> Self {
        Self {
            oid: &w.oid,
            tree: w.tree,
            len: w.bytes.len(),
        }
    }
}

impl<'a> From<&'a SealedWitness> for WitnessShape<'a> {
    fn from(w: &'a SealedWitness) -> Self {
        Self {
            oid: &w.oid,
            tree: w.tree,
            len: w.len,
        }
    }
}

/// A validated admission awaiting [`ImmutableMemo::flush`].
struct PendingRow {
    key: String,
    tag: u32,
    count: u64,
    payload: Vec<u8>,
    digest: [u8; 32],
    cost: usize,
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
    policy: [u8; 32],
    pending: Vec<PendingRow>,
}

impl Drop for ImmutableMemo<'_> {
    fn drop(&mut self) {
        let _ = self.flush();
    }
}

impl<'repo> ImmutableMemo<'repo> {
    /// Disabled caching and storage errors return no memo.
    pub(crate) fn open(repo: &'repo gix::Repository) -> Option<Self> {
        if std::env::var("GIT_SPAN_CACHE").as_deref() == Ok("0") {
            return None;
        }
        let limits = Limits {
            entry_bytes: MAX_ENTRY_BYTES,
            entries: MAX_ENTRIES,
            database_bytes: MAX_DATABASE_BYTES,
        };
        Self::open_with_limits(repo, limits)
    }

    fn open_with_limits(repo: &'repo gix::Repository, limits: Limits) -> Option<Self> {
        let dir = crate::git::common_dir(repo).join("span");
        std::fs::create_dir_all(&dir).ok()?;
        let conn = rusqlite::Connection::open(dir.join("immutable.db")).ok()?;
        conn.busy_timeout(std::time::Duration::from_millis(1000))
            .ok()?;
        conn.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL;
            CREATE TABLE IF NOT EXISTS memo (
                key TEXT PRIMARY KEY, kind INTEGER NOT NULL, version INTEGER NOT NULL,
                epoch INTEGER NOT NULL, cardinality INTEGER NOT NULL,
                payload BLOB NOT NULL, digest BLOB NOT NULL);",
        )
        .ok()?;
        let policy = CurrentReader::new(repo).ok()?.policy;
        let mut memo = Self {
            repo,
            conn,
            limits,
            policy,
            pending: Vec::new(),
        };
        // Old/injected oversized files are reclaimed through SQLite, never
        // unlinked out from under another process's connection.
        if memo.database_size()? > limits.database_bytes {
            memo.conn.execute_batch("DELETE FROM memo; VACUUM;").ok()?;
        }
        memo.bound_pages()?;
        // Read-only probe first: an open that needs no trim takes no write lock.
        let rows: usize = memo
            .conn
            .query_row("SELECT count(*) FROM memo", [], |r| r.get(0))
            .ok()?;
        if rows > limits.entries {
            let tx = memo.conn.transaction().ok()?;
            tx.execute("DELETE FROM memo WHERE rowid NOT IN (SELECT rowid FROM memo ORDER BY rowid DESC LIMIT ?1)", [limits.entries]).ok()?;
            tx.commit().ok()?;
        }
        Some(memo)
    }

    fn database_size(&self) -> Option<usize> {
        let pages: usize = self
            .conn
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .ok()?;
        let size: usize = self
            .conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .ok()?;
        pages.checked_mul(size)
    }

    fn bound_pages(&self) -> Option<()> {
        let size: usize = self
            .conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .ok()?;
        let pages = self.limits.database_bytes.checked_div(size)?;
        if pages == 0 || self.database_size()? > self.limits.database_bytes {
            return None;
        }
        let actual: usize = self
            .conn
            .query_row(&format!("PRAGMA max_page_count={pages}"), [], |r| r.get(0))
            .ok()?;
        (actual <= pages).then_some(())
    }

    fn key(&self, oid: &str, kind: ObservationKind) -> Option<String> {
        let id = gix::ObjectId::from_hex(oid.as_bytes()).ok()?;
        if id.kind() != self.repo.object_hash() || id.to_string() != oid {
            return None;
        }
        Some(format!(
            "{:?}:{oid}:{}:{PAYLOAD_VERSION}:{}:{}",
            id.kind(),
            kind.tag(),
            super::capture::SEMANTIC_EPOCH,
            blake3::Hash::from_bytes(self.policy)
        ))
    }

    /// [`Self::lookup_in`] through a fresh independent reader.
    #[cfg(test)]
    pub(crate) fn lookup(&self, oid: &str, kind: ObservationKind) -> Option<Observation> {
        self.lookup_in(&CurrentReader::new(self.repo).ok()?, oid, kind)
    }

    /// Each lookup rereads every witnessed object through the caller's
    /// boundary reader. A failed availability/kind/byte check is a miss, never
    /// a proof of absence; a reader under another replacement policy never
    /// reuses this memo's entries. Unflushed admissions are consulted first
    /// and verified identically.
    pub(crate) fn lookup_in(
        &self,
        reader: &CurrentReader,
        oid: &str,
        kind: ObservationKind,
    ) -> Option<Observation> {
        crate::perf::record_immutable_miss();
        if reader.policy != self.policy {
            return None;
        }
        let key = self.key(oid, kind)?;
        let pending = self.pending.iter().rev().find(|p| p.key == key).map(|p| {
            (
                p.tag,
                PAYLOAD_VERSION,
                super::capture::SEMANTIC_EPOCH,
                p.count,
                p.payload.clone(),
                p.digest.to_vec(),
            )
        });
        let row = pending.map(Ok).unwrap_or_else(|| {
            self.conn.query_row(
                "SELECT kind, version, epoch, cardinality, payload, digest FROM memo
             WHERE key=?1 AND length(payload)<=?2 AND length(digest)=32",
                rusqlite::params![key, self.limits.entry_bytes],
                |r| {
                    Ok((
                        r.get::<_, u32>(0)?,
                        r.get::<_, u32>(1)?,
                        r.get::<_, u32>(2)?,
                        r.get::<_, u64>(3)?,
                        r.get::<_, Vec<u8>>(4)?,
                        r.get::<_, Vec<u8>>(5)?,
                    ))
                },
            )
        });
        let (tag, version, epoch, count, bytes, digest) = match row {
            Ok(row) => row,
            Err(_) => return None,
        };
        let decoded = (|| {
            if tag != kind.tag()
                || version != PAYLOAD_VERSION
                || epoch != super::capture::SEMANTIC_EPOCH
            {
                return None;
            }
            let sealed = envelope_digest(&key, tag, version, epoch, count, &bytes);
            if sealed.as_slice() != digest {
                return None;
            }
            let payload: Payload = serde_json::from_slice(&bytes).ok()?;
            if payload.value.kind() != kind
                || payload.value.cardinality() != count
                || !self.shape_valid(
                    oid,
                    &payload.value,
                    &payload
                        .witnesses
                        .iter()
                        .map(WitnessShape::from)
                        .collect::<Vec<_>>(),
                )
            {
                return None;
            }
            if !payload.witnesses.iter().all(|w| sealed_current(reader, w)) {
                return None;
            }
            Some(payload)
        })();
        match decoded {
            Some(payload) => {
                crate::perf::record_immutable_hit(
                    kind.tag(),
                    payload.witnesses.iter().map(|w| w.len as u64).sum(),
                );
                Some(payload.value)
            }
            None => {
                crate::perf::record_immutable_rejection();
                None
            }
        }
    }

    fn shape_valid(&self, oid: &str, value: &Observation, witnesses: &[WitnessShape<'_>]) -> bool {
        if witnesses.is_empty()
            || witnesses.len() > MAX_ENTRIES
            || value.cardinality() > MAX_ENTRIES as u64
        {
            return false;
        }
        let mut seen = std::collections::BTreeSet::new();
        for w in witnesses {
            if w.len > self.limits.entry_bytes
                || self.key(w.oid, value.kind()).is_none()
                || !seen.insert(w.oid)
            {
                return false;
            }
        }
        let Some(root) = witnesses.iter().find(|w| w.oid == oid) else {
            return false;
        };
        match value {
            Observation::Declaration(s) => {
                !root.tree && witnesses.len() == 1 && s.anchor_paths.iter().all(|p| valid_path(p))
            }
            Observation::BlobDigest(_) => !root.tree && witnesses.len() == 1,
            Observation::TreeMap(map) => {
                root.tree
                    && witnesses.iter().all(|w| w.tree)
                    && map.iter().all(|(p, o)| {
                        valid_path(p) && self.key(o, ObservationKind::BlobDigest).is_some()
                    })
            }
        }
    }

    /// Validate derivation/closure once, before sealing the persisted envelope.
    /// Reuse verifies its seal and fresh byte witnesses without redecoding trees.
    #[cfg(test)]
    pub(crate) fn admit(&mut self, oid: &str, value: &Observation, witnesses: &[Witness]) {
        if let Ok(reader) = CurrentReader::new(self.repo) {
            self.admit_in(&reader, oid, value, witnesses);
        }
    }

    /// Admission proves every witness against the caller's boundary reader.
    pub(crate) fn admit_in(
        &mut self,
        reader: &CurrentReader,
        oid: &str,
        value: &Observation,
        witnesses: &[Witness],
    ) {
        let _ = self.admit_inner(reader, oid, value, witnesses);
    }

    fn admit_inner(
        &mut self,
        reader: &CurrentReader,
        oid: &str,
        value: &Observation,
        witnesses: &[Witness],
    ) -> Option<()> {
        if reader.policy != self.policy {
            return None;
        }
        let key = self.key(oid, value.kind())?;
        let raw_size = witnesses
            .iter()
            .try_fold(0usize, |sum, w| sum.checked_add(w.bytes.len()))?;
        if raw_size > self.limits.entry_bytes
            || !self.shape_valid(
                oid,
                value,
                &witnesses.iter().map(WitnessShape::from).collect::<Vec<_>>(),
            )
            || !witnesses.iter().all(|w| witness_current(reader, w))
        {
            return None;
        }
        let root = witnesses.iter().find(|w| w.oid == oid)?;
        match value {
            Observation::BlobDigest(digest) if blake3::hash(&root.bytes).as_bytes() != digest => {
                return None;
            }
            Observation::Declaration(summary) => {
                let text = std::str::from_utf8(&root.bytes).ok()?;
                let file = crate::span_file::SpanFile::parse(text).ok()?;
                if summary.anchor_paths
                    != file
                        .anchors
                        .iter()
                        .map(|a| a.path.to_string())
                        .collect::<Vec<_>>()
                    || summary.copy_detection != file.config.copy_detection
                {
                    return None;
                }
            }
            Observation::TreeMap(map)
                if tree_map_from_witnesses(self.repo, oid, witnesses)? != *map =>
            {
                return None;
            }
            _ => {}
        }
        // Serialize through a capped writer: JSON serialization cannot itself
        // allocate an entry larger than the admission limit.
        #[derive(Serialize)]
        struct BorrowedPayload<'a> {
            value: &'a Observation,
            witnesses: &'a [SealedWitness],
        }
        let sealed: Vec<SealedWitness> = witnesses.iter().map(SealedWitness::seal).collect();
        let mut writer = BoundedWriter {
            bytes: Vec::new(),
            limit: self.limits.entry_bytes,
        };
        serde_json::to_writer(
            &mut writer,
            &BorrowedPayload {
                value,
                witnesses: &sealed,
            },
        )
        .ok()?;
        let bytes = writer.bytes;
        let count = value.cardinality();
        let digest = envelope_digest(
            &key,
            value.kind().tag(),
            PAYLOAD_VERSION,
            super::capture::SEMANTIC_EPOCH,
            count,
            &bytes,
        );
        let page_size = self.page_size()?;
        let payload_budget = self.limits.database_bytes.checked_sub(4 * page_size)?;
        // Reserve schema/pointer-map pages and conservatively round each row
        // plus index overhead to pages. SQLite's own page ceiling remains
        // the final authority when fragmentation or layout uses more space.
        let raw_cost = bytes.len().checked_add(key.len())?.checked_add(128)?;
        let entry_cost = raw_cost
            .div_ceil(page_size)
            .checked_add(1)?
            .checked_mul(page_size)?;
        if entry_cost > payload_budget {
            return None;
        }
        self.pending.retain(|p| p.key != key);
        self.pending.push(PendingRow {
            key,
            tag: value.kind().tag(),
            count,
            payload: bytes,
            digest,
            cost: entry_cost,
        });
        // Bound buffered memory to one full table's worth of admissions.
        if self.pending.len() >= self.limits.entries {
            self.flush()?;
        }
        Some(())
    }

    fn page_size(&self) -> Option<usize> {
        self.conn
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .ok()
    }

    /// Persist buffered admissions in one write transaction. Replacing a row
    /// moves it to the newest admission position; count and page budgets are
    /// enforced inside the transaction by evicting the oldest rows. Runs on
    /// drop; a failure discards the buffer (fail closed on the cache only).
    pub(crate) fn flush(&mut self) -> Option<()> {
        if self.pending.is_empty() {
            return Some(());
        }
        let rows = std::mem::take(&mut self.pending);
        self.bound_pages()?;
        let page_size = self.page_size()?;
        let payload_budget = self.limits.database_bytes.checked_sub(4 * page_size)?;
        const COST: &str = "((length(payload)+length(key)+128+?1-1)/?1+1)*?1";
        let tx = self.conn.transaction().ok()?;
        let mut occupied: usize = tx
            .query_row(
                &format!("SELECT coalesce(sum({COST}),0) FROM memo"),
                [page_size],
                |r| r.get(0),
            )
            .ok()?;
        let mut count: usize = tx
            .query_row("SELECT count(*) FROM memo", [], |r| r.get(0))
            .ok()?;
        for row in rows {
            let existing: Option<usize> = tx
                .query_row(
                    &format!("SELECT {COST} FROM memo WHERE key=?2"),
                    rusqlite::params![page_size, row.key],
                    |r| r.get(0),
                )
                .ok();
            if let Some(cost) = existing {
                tx.execute("DELETE FROM memo WHERE key=?1", [&row.key])
                    .ok()?;
                occupied = occupied.saturating_sub(cost);
                count = count.saturating_sub(1);
            }
            while occupied.checked_add(row.cost)? > payload_budget || count >= self.limits.entries {
                let (rowid, cost): (i64, usize) = tx
                    .query_row(
                        &format!("SELECT rowid, {COST} FROM memo ORDER BY rowid LIMIT 1"),
                        [page_size],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .ok()?;
                tx.execute("DELETE FROM memo WHERE rowid=?1", [rowid])
                    .ok()?;
                occupied = occupied.saturating_sub(cost);
                count = count.saturating_sub(1);
            }
            tx.execute("INSERT INTO memo(key,kind,version,epoch,cardinality,payload,digest) VALUES(?1,?2,?3,?4,?5,?6,?7)", rusqlite::params![row.key,row.tag,PAYLOAD_VERSION,super::capture::SEMANTIC_EPOCH,row.count,row.payload,row.digest.as_slice()]).ok()?;
            occupied = occupied.checked_add(row.cost)?;
            count += 1;
        }
        tx.commit().ok()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    value: Observation,
    witnesses: Vec<SealedWitness>,
}

impl ObservationKind {
    fn tag(self) -> u32 {
        match self {
            Self::Declaration => 1,
            Self::TreeMap => 2,
            Self::BlobDigest => 3,
        }
    }
}

impl Observation {
    fn kind(&self) -> ObservationKind {
        match self {
            Self::Declaration(_) => ObservationKind::Declaration,
            Self::TreeMap(_) => ObservationKind::TreeMap,
            Self::BlobDigest(_) => ObservationKind::BlobDigest,
        }
    }
    fn cardinality(&self) -> u64 {
        match self {
            Self::Declaration(s) => s.anchor_paths.len() as u64,
            Self::TreeMap(m) => m.len() as u64,
            Self::BlobDigest(_) => 1,
        }
    }
}

fn envelope_digest(
    key: &str,
    kind: u32,
    version: u32,
    epoch: u32,
    count: u64,
    payload: &[u8],
) -> [u8; 32] {
    let mut h = blake3::Hasher::new();
    h.update(b"git-span:immutable-observation\0");
    h.update(&epoch.to_le_bytes());
    h.update(&kind.to_le_bytes());
    h.update(&version.to_le_bytes());
    h.update(&count.to_le_bytes());
    h.update(&(key.len() as u64).to_le_bytes());
    h.update(key.as_bytes());
    h.update(payload);
    *h.finalize().as_bytes()
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\0')
        && !path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
}

fn sealed_current(reader: &CurrentReader, w: &SealedWitness) -> bool {
    let Ok(oid) = gix::ObjectId::from_hex(w.oid.as_bytes()) else {
        return false;
    };
    let kind = if w.tree {
        gix::object::Kind::Tree
    } else {
        gix::object::Kind::Blob
    };
    reader
        .read(oid, kind)
        .is_ok_and(|bytes| bytes.len() == w.len && blake3::hash(&bytes).as_bytes() == &w.digest)
}

fn witness_current(reader: &CurrentReader, w: &Witness) -> bool {
    let Ok(oid) = gix::ObjectId::from_hex(w.oid.as_bytes()) else {
        return false;
    };
    let kind = if w.tree {
        gix::object::Kind::Tree
    } else {
        gix::object::Kind::Blob
    };
    reader.read(oid, kind).is_ok_and(|bytes| bytes == w.bytes)
}

/// Derive the map from the supplied closure without trusting its completeness.
/// Used only at admission; lookup validates the sealed closure with raw bytes.
fn tree_map_from_witnesses(
    repo: &gix::Repository,
    root: &str,
    witnesses: &[Witness],
) -> Option<BTreeMap<String, String>> {
    let by_oid: BTreeMap<&str, &Witness> = witnesses.iter().map(|w| (w.oid.as_str(), w)).collect();
    let mut pending = vec![(String::new(), root.to_string())];
    let mut visited = std::collections::BTreeSet::new();
    let mut map = BTreeMap::new();
    let mut paths = 0usize;
    while let Some((prefix, oid)) = pending.pop() {
        paths += 1;
        if paths > MAX_ENTRIES {
            return None;
        }
        let witness = by_oid.get(oid.as_str())?;
        visited.insert(oid.clone());
        for entry in gix::objs::TreeRefIter::from_bytes(&witness.bytes, repo.object_hash()) {
            let entry = entry.ok()?;
            let path = format!("{prefix}{}", entry.filename);
            if !valid_path(&path) {
                return None;
            }
            if entry.mode.is_tree() {
                pending.push((format!("{path}/"), entry.oid.to_string()));
            } else if entry.mode.is_blob() && map.insert(path, entry.oid.to_string()).is_some() {
                return None;
            }
        }
        if pending.len() + map.len() > MAX_ENTRIES {
            return None;
        }
    }
    (visited.len() == witnesses.len()).then_some(map)
}

fn unique_paths<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> Result<BTreeMap<String, String>, D::Error> {
    struct Unique;
    impl<'de> serde::de::Visitor<'de> for Unique {
        type Value = BTreeMap<String, String>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("unique path identities")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut access: A,
        ) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = access.next_entry::<String, String>()? {
                if result.len() >= MAX_ENTRIES || result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "duplicate/excessive immutable map keys",
                    ));
                }
            }
            Ok(result)
        }
    }
    decoder.deserialize_map(Unique)
}

struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
}
impl std::io::Write for BoundedWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other("immutable memo entry limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
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
    pub(crate) fn new(repo: &gix::Repository) -> crate::Result<Self> {
        let store = gix::odb::Store::try_from(repo.objects.store_ref())
            .map_err(|e| crate::Error::Git(format!("current object store: {e}")))?;
        let mut h = blake3::Hasher::new();
        h.update(b"git-span:immutable-policy\0");
        h.update(&[u8::from(repo.objects.ignore_replacements)]);
        for (original, replacement) in store.replacements() {
            h.update(original.as_bytes());
            h.update(replacement.as_bytes());
        }
        let policy = *h.finalize().as_bytes();
        let mut handle = std::sync::Arc::new(store).to_handle_arc();
        handle.ignore_replacements = repo.objects.ignore_replacements;
        let mut cache = gix::odb::Cache::from(handle);
        cache.unset_object_cache();
        cache.unset_pack_cache();
        let objects =
            gix::odb::memory::Proxy::new(cache, repo.object_hash()).with_write_passthrough();
        Ok(Self {
            objects,
            policy,
            hash: repo.object_hash(),
        })
    }

    fn read_any(&self, oid: gix::ObjectId) -> crate::Result<(gix::object::Kind, Vec<u8>)> {
        use gix::prelude::FindExt;
        if oid.kind() != self.hash {
            return Err(crate::Error::Git(
                "current object hash kind mismatch".into(),
            ));
        }
        let mut bytes = Vec::new();
        let kind = self
            .objects
            .find(&oid, &mut bytes)
            .map_err(|e| crate::Error::Git(format!("find current object `{oid}`: {e}")))?
            .kind;
        Ok((kind, bytes))
    }

    /// Direct ODB lookup requires physical storage, including the empty tree.
    pub(crate) fn read(
        &self,
        oid: gix::ObjectId,
        expected: gix::object::Kind,
    ) -> crate::Result<Vec<u8>> {
        let (kind, bytes) = self.read_any(oid)?;
        if kind != expected {
            return Err(crate::Error::Git(format!(
                "object `{oid}` is a {kind}, not a {expected}"
            )));
        }
        Ok(bytes)
    }

    pub(crate) fn head(&self, repo: &gix::Repository) -> crate::Result<Option<HeadObservation>> {
        let head = repo
            .head()
            .map_err(|e| crate::Error::Git(format!("HEAD: {e}")))?;
        if head.is_unborn() {
            return Ok(None);
        }
        let mut oid = repo
            .head_id()
            .map_err(|e| crate::Error::Git(format!("HEAD id: {e}")))?
            .detach();
        let mut seen = std::collections::HashSet::new();
        loop {
            if !seen.insert(oid) || seen.len() > 32 {
                return Err(crate::Error::Git(
                    "HEAD tag peeling cycle or depth limit".into(),
                ));
            }
            let (kind, bytes) = self.read_any(oid)?;
            match kind {
                gix::object::Kind::Commit => {
                    let commit = gix::objs::CommitRef::from_bytes(&bytes, self.hash)
                        .map_err(|e| crate::Error::Git(format!("HEAD commit decode: {e}")))?;
                    return Ok(Some(HeadObservation {
                        commit: oid,
                        tree: commit.tree(),
                    }));
                }
                gix::object::Kind::Tag => {
                    let tag = gix::objs::TagRef::from_bytes(&bytes, self.hash)
                        .map_err(|e| crate::Error::Git(format!("HEAD tag decode: {e}")))?;
                    oid = tag.target();
                }
                _ => {
                    return Err(crate::Error::Git(format!(
                        "HEAD `{oid}` is a {kind}, not a commit"
                    )));
                }
            }
        }
    }

    pub(crate) fn tree_entry(
        &self,
        root: gix::ObjectId,
        path: &str,
    ) -> crate::Result<Option<(gix::objs::tree::EntryMode, gix::ObjectId)>> {
        let mut tree = root;
        let mut segments = path.split('/').peekable();
        while let Some(segment) = segments.next() {
            let bytes = self.read(tree, gix::object::Kind::Tree)?;
            let mut found = None;
            for entry in gix::objs::TreeRefIter::from_bytes(&bytes, self.hash) {
                let entry =
                    entry.map_err(|e| crate::Error::Git(format!("current tree decode: {e}")))?;
                if entry.filename == segment.as_bytes() {
                    found = Some((entry.mode, entry.oid.to_owned()));
                    break;
                }
            }
            let Some((mode, oid)) = found else {
                return Ok(None);
            };
            if segments.peek().is_none() {
                return Ok(Some((mode, oid)));
            }
            if !mode.is_tree() {
                return Ok(None);
            }
            tree = oid;
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, Stdio};

    fn fixture() -> (tempfile::TempDir, gix::Repository) {
        // SAFETY: every caller runs this before its test spawns any thread, and
        // nextest runs each test in its own process, so no other thread can read or
        // write the environment concurrently.
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

    fn replace_loose(repo: &gix::Repository, source: &str, target: &str) {
        let original = loose_path(repo, target);
        let replacement = original.with_extension("replacement");
        std::fs::copy(loose_path(repo, source), &replacement).unwrap();
        std::fs::rename(replacement, original).unwrap();
    }

    #[test]
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
    fn immutable_missing_and_changed_blob_witnesses_reject() {
        let (_dir, mut repo) = fixture();
        repo.object_cache_size_if_unset(1024 * 1024);
        let (oid, value, witnesses) = blob(&repo, b"original");
        let native = gix::ObjectId::from_hex(oid.as_bytes()).unwrap();
        repo.find_object(native).unwrap();
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.admit(&oid, &value, &witnesses);
        let other = object(&repo, "blob", b"changed!");
        replace_loose(&repo, &other, &oid);
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&oid, ObservationKind::BlobDigest),
            None
        );
        std::fs::remove_file(loose_path(&repo, &oid)).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&oid, ObservationKind::BlobDigest),
            None
        );
    }

    #[test]
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
            memo.flush().unwrap();
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
    fn immutable_tree_requires_complete_current_descendant_witnesses() {
        let (_dir, mut repo) = fixture();
        repo.object_cache_size_if_unset(1024 * 1024);
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
        repo.find_object(gix::ObjectId::from_hex(root.as_bytes()).unwrap())
            .unwrap();
        repo.find_object(gix::ObjectId::from_hex(child.as_bytes()).unwrap())
            .unwrap();
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.admit(&root, &value, std::slice::from_ref(&root_witness));
        assert_eq!(memo.lookup(&root, ObservationKind::TreeMap), None);
        memo.admit(&root, &value, &[root_witness, child_witness]);
        assert_eq!(memo.lookup(&root, ObservationKind::TreeMap), Some(value));
        std::fs::remove_file(loose_path(&repo, &child)).unwrap();
        assert_eq!(
            ImmutableMemo::open(&repo)
                .unwrap()
                .lookup(&root, ObservationKind::TreeMap),
            None
        );
    }

    #[test]
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
            memo.flush().unwrap();
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
    fn immutable_disabled_and_storage_failure_bypass() {
        let (_dir, repo) = fixture();
        // SAFETY: nextest runs each test in its own process, and this test never
        // spawns a thread, so nothing reads or writes the environment concurrently.
        unsafe {
            std::env::set_var("GIT_SPAN_CACHE", "0");
        }
        assert!(ImmutableMemo::open(&repo).is_none());
        // SAFETY: nextest runs each test in its own process, and this test never
        // spawns a thread, so nothing reads or writes the environment concurrently.
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
    fn current_reader_detects_valid_loose_replacement_with_native_cache_warm() {
        let (_dir, repo, oid) = committed_fixture();
        assert_eq!(repo.find_object(oid).unwrap().data, b"before");
        let other = object(&repo, "blob", b"after");
        replace_loose(&repo, &other, &oid.to_string());
        assert_eq!(
            CurrentReader::new(&repo)
                .unwrap()
                .read(oid, gix::object::Kind::Blob)
                .unwrap(),
            b"after"
        );
    }

    #[test]
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
        replace_loose(&repo, &replacement, &head_oid.to_string());
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
    fn current_reader_replacement_policy_is_copied_and_identified() {
        let (dir, repo, oid) = committed_fixture();
        let replacement = object(&repo, "blob", b"replacement");
        git(dir.path(), &["replace", &oid.to_string(), &replacement]);
        // gix 0.84's inverted config default loads this table for false;
        // the reader preserves the actual configured ODB table exactly.
        git(dir.path(), &["config", "core.useReplaceRefs", "false"]);
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
    #[test]
    fn immutable_packed_mutations_reject_after_native_and_memo_warm() {
        for corrupt in [false, true] {
            let (dir, _repo, oid) = committed_fixture();
            git(dir.path(), &["repack", "-adq"]);
            let mut repo = gix::open(dir.path()).unwrap();
            repo.object_cache_size_if_unset(1024 * 1024);
            let bytes = repo.find_object(oid).unwrap().data.clone();
            let value = Observation::BlobDigest(*blake3::hash(&bytes).as_bytes());
            let mut memo = ImmutableMemo::open(&repo).unwrap();
            memo.admit(
                &oid.to_string(),
                &value,
                &[Witness {
                    oid: oid.to_string(),
                    tree: false,
                    bytes,
                }],
            );
            assert_eq!(
                memo.lookup(&oid.to_string(), ObservationKind::BlobDigest),
                Some(value)
            );
            for entry in
                std::fs::read_dir(crate::git::common_dir(&repo).join("objects/pack")).unwrap()
            {
                let path = entry.unwrap().path();
                if corrupt {
                    if path.extension().is_some_and(|e| e == "pack") {
                        let mut bytes = std::fs::read(&path).unwrap();
                        bytes[..4].copy_from_slice(b"BAD!");
                        let replacement = path.with_extension("replacement");
                        std::fs::write(&replacement, bytes).unwrap();
                        std::fs::rename(replacement, path).unwrap();
                    }
                } else {
                    std::fs::remove_file(path).unwrap();
                }
            }
            assert_eq!(
                memo.lookup(&oid.to_string(), ObservationKind::BlobDigest),
                None
            );
            assert!(
                CurrentReader::new(&repo)
                    .unwrap()
                    .read(oid, gix::object::Kind::Blob)
                    .is_err()
            );
        }
    }

    #[test]
    fn immutable_replacement_policies_never_share_entries() {
        let (dir, repo, oid) = committed_fixture();
        let replacement = object(&repo, "blob", b"replacement");
        git(dir.path(), &["replace", &oid.to_string(), &replacement]);
        git(dir.path(), &["config", "core.useReplaceRefs", "false"]);
        let enabled = gix::open(dir.path()).unwrap();
        let mut disabled = enabled.clone();
        disabled.objects.ignore_replacements = true;
        let reader = CurrentReader::new(&enabled).unwrap();
        let bytes = reader.read(oid, gix::object::Kind::Blob).unwrap();
        let value = Observation::BlobDigest(*blake3::hash(&bytes).as_bytes());
        let mut memo = ImmutableMemo::open(&enabled).unwrap();
        memo.admit(
            &oid.to_string(),
            &value,
            &[Witness {
                oid: oid.to_string(),
                tree: false,
                bytes,
            }],
        );
        assert_eq!(
            memo.lookup(&oid.to_string(), ObservationKind::BlobDigest),
            Some(value.clone())
        );
        assert_eq!(
            ImmutableMemo::open(&disabled)
                .unwrap()
                .lookup(&oid.to_string(), ObservationKind::BlobDigest),
            None
        );
        assert_eq!(
            memo.lookup(&oid.to_string(), ObservationKind::BlobDigest),
            Some(value)
        );
    }

    #[test]
    fn immutable_metadata_and_witness_shape_reject_before_reuse() {
        let (_dir, repo) = fixture();
        let (oid, value, witnesses) = blob(&repo, b"original");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        let key = memo.key(&oid, ObservationKind::BlobDigest).unwrap();
        for mutation in [
            "bad-oid",
            "duplicate-witness",
            "wrong-length",
            "wrong-digest",
            "raw-bytes",
            "truncated",
        ] {
            memo.admit(&oid, &value, &witnesses);
            memo.flush().unwrap();
            let raw: Vec<u8> = memo
                .conn
                .query_row("SELECT payload FROM memo WHERE key=?1", [&key], |r| {
                    r.get(0)
                })
                .unwrap();
            let mut json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
            match mutation {
                "bad-oid" => json["witnesses"][0]["oid"] = "not-an-oid".into(),
                "duplicate-witness" => {
                    let item = json["witnesses"][0].clone();
                    json["witnesses"].as_array_mut().unwrap().push(item);
                }
                "wrong-length" => json["witnesses"][0]["len"] = 9.into(),
                "wrong-digest" => json["witnesses"][0]["digest"] = serde_json::json!(vec![0u8; 32]),
                "raw-bytes" => json["witnesses"][0]["bytes"] = serde_json::json!([1, 2, 3]),
                _ => {}
            }
            let mut raw = serde_json::to_vec(&json).unwrap();
            if mutation == "truncated" {
                raw.pop();
            }
            let digest = envelope_digest(
                &key,
                ObservationKind::BlobDigest.tag(),
                PAYLOAD_VERSION,
                super::super::capture::SEMANTIC_EPOCH,
                1,
                &raw,
            );
            memo.conn
                .execute(
                    "UPDATE memo SET payload=?1,digest=?2 WHERE key=?3",
                    rusqlite::params![raw, digest.as_slice(), key],
                )
                .unwrap();
            assert_eq!(
                memo.lookup(&oid, ObservationKind::BlobDigest),
                None,
                "{mutation}"
            );
        }
        assert!(
            serde_json::from_str::<Observation>(
                "{\"TreeMap\":{\"path\":\"oid\",\"path\":\"other\"}}"
            )
            .is_err()
        );
    }

    #[test]
    fn immutable_database_budget_evicts_and_reclaims_oversized_startup() {
        let (_dir, repo) = fixture();
        let limits = Limits {
            entry_bytes: 32 * 1024,
            entries: 20,
            database_bytes: 32 * 1024,
        };
        let mut memo = ImmutableMemo::open_with_limits(&repo, limits).unwrap();
        let mut first = None;
        let mut last = None;
        for byte in 1..=8 {
            let (oid, value, witnesses) = blob(&repo, &vec![byte; 3000]);
            if first.is_none() {
                first = Some(oid.clone());
            }
            memo.admit(&oid, &value, &witnesses);
            memo.flush().unwrap();
            last = Some((oid, value));
            assert!(memo.database_size().unwrap() <= limits.database_bytes);
        }
        assert_eq!(
            memo.lookup(&first.unwrap(), ObservationKind::BlobDigest),
            None
        );
        let (oid, value) = last.unwrap();
        assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), Some(value));
        drop(memo);
        // An old or injected file larger than the budget is reclaimed at open.
        rusqlite::Connection::open(crate::git::common_dir(&repo).join("span/immutable.db"))
            .unwrap()
            .execute(
                "INSERT INTO memo(key,kind,version,epoch,cardinality,payload,digest) VALUES('injected',0,0,0,0,zeroblob(65536),zeroblob(32))",
                [],
            )
            .unwrap();
        let smaller = ImmutableMemo::open_with_limits(&repo, limits).unwrap();
        assert!(smaller.database_size().unwrap() <= limits.database_bytes);
        assert_eq!(smaller.lookup(&oid, ObservationKind::BlobDigest), None);
    }

    #[test]
    fn immutable_working_set_larger_than_budget_in_raw_bytes_still_fits() {
        let (_dir, repo) = fixture();
        let limits = Limits {
            entry_bytes: MAX_ENTRY_BYTES,
            entries: 64,
            database_bytes: 1024 * 1024,
        };
        let mut memo = ImmutableMemo::open_with_limits(&repo, limits).unwrap();
        let mut admitted = Vec::new();
        for byte in 1..=32u8 {
            let (oid, value, witnesses) = blob(&repo, &vec![byte; 64 * 1024]);
            memo.admit(&oid, &value, &witnesses);
            admitted.push((oid, value));
        }
        drop(memo);
        let memo = ImmutableMemo::open_with_limits(&repo, limits).unwrap();
        for (oid, value) in admitted {
            assert_eq!(
                memo.lookup(&oid, ObservationKind::BlobDigest),
                Some(value),
                "2 MiB of witnessed source must not evict itself from a 1 MiB memo"
            );
        }
    }

    #[test]
    fn immutable_admissions_persist_in_one_flush() {
        let (_dir, repo) = fixture();
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        let rows = |repo: &gix::Repository| -> usize {
            rusqlite::Connection::open(crate::git::common_dir(repo).join("span/immutable.db"))
                .unwrap()
                .query_row("SELECT count(*) FROM memo", [], |r| r.get(0))
                .unwrap()
        };
        for source in [b"first".as_slice(), b"second", b"third"] {
            let (oid, value, witnesses) = blob(&repo, source);
            memo.admit(&oid, &value, &witnesses);
            assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), Some(value));
        }
        assert_eq!(rows(&repo), 0, "admission must not write per entry");
        drop(memo);
        assert_eq!(rows(&repo), 3);
    }

    #[test]
    fn immutable_reuse_counters_reset_and_measure_source_bytes() {
        let (_dir, repo) = fixture();
        let (oid, value, witnesses) = blob(&repo, b"original");
        let mut memo = ImmutableMemo::open(&repo).unwrap();
        memo.admit(&oid, &value, &witnesses);
        crate::perf::init(true);
        crate::perf::reset_subroutine_counters();
        assert_eq!(memo.lookup(&oid, ObservationKind::BlobDigest), Some(value));
        let counters = crate::perf::immutable_counters();
        assert_eq!(counters[2].1, 1);
        assert_eq!(counters[3].1, 0);
        assert_eq!(counters[5].1, 8);
        crate::perf::reset_subroutine_counters();
        assert!(
            crate::perf::immutable_counters()
                .iter()
                .all(|(_, count)| *count == 0)
        );
        crate::perf::init(false);
    }
}
