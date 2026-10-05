//! Changed-path Bloom filter reader for commit-graph BIDX/BDAT chunks.
//!
//! gix-commitgraph v0.35.0 does NOT parse Bloom filter chunks, so this module
//! reads them directly via `gix-chunk` from the mmap'd commit-graph file.
//!
//! # Format reference
//!
//! Git 2.39 commit-graph with `--changed-paths`:
//!
//! **BDAT header** (12 bytes = 3 x u32 BE):
//!   0..3: hash_version         (1 = SHA-1-based MurmurHash3)
//!   4..7: num_hashes           (7 hash functions)
//!   8..11: bits_per_entry      (10 bits per path entry)
//!
//! **BIDX** (`num_commits` x u32 BE):
//!   BIDX[i] = end offset of commit i's filter in the BDAT data area
//!   (data area = BDAT[12..]).  Start = 0 if i == 0 else BIDX[i-1].
//!   Filter length = end - start.
//!
//! **Hash** (MurmurHash3 32-bit, two seeds):
//!   hash0 = murmur3(0x293ae76f, path)
//!   hash1 = murmur3(0x7e646e2c, path)
//!   For i in 0..num_hashes: h = hash0 + i * hash1   (wrapping u32)
//!   Bit position: h % (filter_len * 8)
//!
//! No per-commit type byte; the filter data begins directly at the offset.

use gix::ObjectId;

/// A reader for the changed-path Bloom filter (BIDX/BDAT chunks) of a
/// single commit-graph file. Also provides OID-to-position lookup using
/// the OID fan (OIDF) and OID lookup (OIDL) chunks, avoiding the need
/// to open a separate `gix_commitgraph::File`.
///
/// [`open`](Self::open) validates every chunk this reader touches against
/// the sizes the header claims (`num_commits` BIDX entries, a full 256-entry
/// OIDF table, `num_commits` OIDL ids, the 12-byte BDAT header), so a
/// truncated or corrupt file is refused there and the caller walks without
/// Bloom acceleration. Per-commit filter offsets cannot be validated without
/// reading every BIDX entry, so the queries bound-check them and answer
/// conservatively (`maybe_contains` → `true`, `commit_position` → `None`):
/// corruption can only cost speed, never skip a commit that changed a path.
pub(crate) struct CommitGraphBloom {
    data: memmap2::Mmap,
    bidx_start: usize,
    bdat_start: usize,
    /// End (exclusive) of the BDAT chunk; filter slices never read past it.
    bdat_end: usize,
    num_hashes: u32,
    num_commits: u32,
    /// Offset of the OID fan-out table (OIDF chunk).
    oidf_offset: usize,
    /// Offset of the OID lookup table (OIDL chunk).
    oidl_offset: usize,
    /// Hash length in bytes (20 for SHA-1, 32 for SHA-256).
    hash_len: usize,
}

/// A commit's lexicographical position within one [`CommitGraphBloom`]'s
/// file, obtainable only from [`CommitGraphBloom::commit_position`], which
/// guarantees it is below that file's `num_commits`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CommitPos(u32);

/// Big-endian `u32` at `offset` in `bytes`, or `None` when fewer than four
/// bytes remain there.
fn be_u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let word = bytes.get(offset..)?.first_chunk::<4>()?;
    Some(u32::from_be_bytes(*word))
}

impl CommitGraphBloom {
    /// Open the commit-graph file for `repo`, mmap it, parse chunks, and
    /// locate the BIDX/BDAT Bloom filter chunks.
    ///
    /// Returns `Err` with a descriptive message if the commit-graph is
    /// missing or lacks the required chunks.
    pub(crate) fn open(repo: &gix::Repository) -> Result<Self, String> {
        // Validate that a commit-graph exists via gix's own API.
        let _graph = repo.commit_graph().map_err(|_| {
            "Commit graph not found. Run: git commit-graph write --reachable --changed-paths"
                .to_string()
        })?;

        // Build path to the commit-graph file.
        let info_dir = repo.objects.store_ref().path().join("info");
        let path = info_dir.join("commit-graph");

        let (data, path) = if path.exists() {
            (mmap_file(&path)?, path)
        } else {
            // Try the chain directory (objects/info/commit-graphs/).
            let chain_dir = info_dir.join("commit-graphs");
            let chain_file = chain_dir.join("commit-graph-chain");
            if chain_file.exists() {
                let chain = std::fs::read_to_string(&chain_file).map_err(|e| {
                    format!(
                        "Cannot read commit-graph chain at {}: {e}",
                        chain_file.display()
                    )
                })?;
                let hash = chain.lines().next().ok_or_else(|| {
                    format!("Empty commit-graph chain file at {}", chain_file.display())
                })?;
                let path = chain_dir.join(format!("graph-{hash}.graph"));
                (mmap_file(&path)?, path)
            } else {
                return Err(format!(
                    "Commit graph not found at {}. Run: git commit-graph write --reachable --changed-paths",
                    info_dir.display()
                ));
            }
        };

        Self::from_mmap(data, &path)
    }

    /// Parse and bounds-validate an already-mapped commit-graph file. Every
    /// structural defect — a file shorter than its header, a chunk smaller
    /// than the entry counts require — is an `Err`, never a panic, so the
    /// caller's no-Bloom fallback takes over.
    fn from_mmap(data: memmap2::Mmap, path: &std::path::Path) -> Result<Self, String> {
        // ----- 8-byte file header -----
        // bytes 0-3: signature "CGPH"
        // byte 4:   version (must be 1)
        // byte 5:   hash version
        // byte 6:   chunk count
        // byte 7:   base graph count (unused here)
        let Some(header) = data.first_chunk::<8>() else {
            return Err(format!(
                "Commit-graph at {} is {} bytes, shorter than its 8-byte header",
                path.display(),
                data.len()
            ));
        };
        if header[..4] != *b"CGPH" {
            return Err(format!(
                "Invalid commit-graph signature at {}",
                path.display()
            ));
        }
        let file_hash_version = header[5]; // 1 = SHA-1, 2 = SHA-256
        let chunk_count = header[6];

        // ----- Hash length from file header -----
        let hash_len: usize = match file_hash_version {
            1 => 20, // SHA-1
            2 => 32, // SHA-256
            v => {
                return Err(format!(
                    "Unsupported commit-graph hash version {v} at {}",
                    path.display()
                ));
            }
        };

        // ----- Chunk index (at offset 8) -----
        // `from_bytes` rejects any chunk range extending past the file.
        let chunks = gix_chunk::file::Index::from_bytes(&data, 8, u32::from(chunk_count))
            .map_err(|e| format!("Failed to parse commit-graph chunk index: {e}"))?;

        // ----- Look up BIDX and BDAT -----
        let bidx_range = chunks.usize_offset_by_id(*b"BIDX").map_err(|_| {
            "Commit graph missing BIDX chunk. Run: git commit-graph write --reachable --changed-paths".to_string()
        })?;
        let bdat_range = chunks.usize_offset_by_id(*b"BDAT").map_err(|_| {
            "Commit graph missing BDAT chunk. Run: git commit-graph write --reachable --changed-paths".to_string()
        })?;
        let too_small = |chunk: &str| format!("{chunk} chunk too small at {}", path.display());

        // ----- BDAT global header (12 bytes = 3 x u32 BE) -----
        let bdat = data
            .get(bdat_range.clone())
            .ok_or_else(|| too_small("BDAT"))?;
        let (Some(hdr_hash_version), Some(num_hashes), Some(_bits_per_entry)) =
            (be_u32_at(bdat, 0), be_u32_at(bdat, 4), be_u32_at(bdat, 8))
        else {
            return Err(too_small("BDAT"));
        };
        if hdr_hash_version != 1 {
            return Err(format!(
                "Unsupported Bloom filter hash version {hdr_hash_version} at {}",
                path.display()
            ));
        }

        // ----- OID fan table (OIDF) for position lookup -----
        // 256 BE u32 entries; the last is the file's commit count.
        let oidf_range = chunks
            .usize_offset_by_id(*b"OIDF")
            .map_err(|_| "Commit graph missing OIDF chunk".to_string())?;
        let oidf = data
            .get(oidf_range.clone())
            .ok_or_else(|| too_small("OIDF"))?;
        let Some(num_commits) = be_u32_at(oidf, 255 * 4) else {
            return Err(too_small("OIDF"));
        };
        let commits = num_commits as usize;

        // ----- OID lookup table (OIDL) for position lookup -----
        let oidl_range = chunks
            .usize_offset_by_id(*b"OIDL")
            .map_err(|_| "Commit graph missing OIDL chunk".to_string())?;
        if commits
            .checked_mul(hash_len)
            .is_none_or(|need| oidl_range.len() < need)
        {
            return Err(too_small("OIDL"));
        }

        // ----- BIDX: one BE u32 end offset per commit -----
        if commits
            .checked_mul(4)
            .is_none_or(|need| bidx_range.len() < need)
        {
            return Err(too_small("BIDX"));
        }

        Ok(Self {
            data,
            bidx_start: bidx_range.start,
            bdat_start: bdat_range.start,
            bdat_end: bdat_range.end,
            num_hashes,
            num_commits,
            oidf_offset: oidf_range.start,
            oidl_offset: oidl_range.start,
            hash_len,
        })
    }

    /// Query whether the commit at lexicographical `commit_pos` might have
    /// changed `path`.
    ///
    /// The Bloom filter has a ~1% false-positive rate. Returns `false` only
    /// when the path is **definitely NOT** changed in this commit. A BIDX
    /// entry pointing outside the BDAT chunk (a corrupt file) answers `true`:
    /// the filter cannot rule the path out.
    pub(crate) fn maybe_contains(&self, commit_pos: CommitPos, path: &[u8]) -> bool {
        let commit_pos = commit_pos.0 as usize;
        // `open` validated `num_commits` BIDX entries and `commit_pos` is
        // below `num_commits`, so these reads are in bounds; a `None` would
        // still answer conservatively rather than panic.
        let bidx_off = self.bidx_start + commit_pos * 4;
        // End offset from BIDX for this commit.
        let Some(end) = be_u32_at(&self.data, bidx_off) else {
            return true;
        };
        // Start offset is previous BIDX entry (or 0 for first commit).
        let start = if commit_pos == 0 {
            0
        } else {
            let Some(start) = be_u32_at(&self.data, bidx_off - 4) else {
                return true;
            };
            start
        };
        let (start, end) = (start as usize, end as usize);

        if start >= end {
            return false; // No filter data for this commit.
        }

        // Filter data begins after the 12-byte BDAT header, at offset `start`.
        let Some(filter_data) = self
            .data
            .get(self.bdat_start + 12..self.bdat_end)
            .and_then(|area| area.get(start..end))
        else {
            return true;
        };
        let mod_bits = filter_data.len() * 8;

        // MurmurHash3-based hashing (matches Git's fill_bloom_key).
        let hash0 = murmur3_32_seeded(path, 0x293ae76f);
        let hash1 = murmur3_32_seeded(path, 0x7e646e2c);

        for i in 0..self.num_hashes {
            let h = hash0.wrapping_add(i.wrapping_mul(hash1));
            let bit_pos = (h as usize) % mod_bits;
            let byte_idx = bit_pos / 8;
            let bit_idx = bit_pos % 8;

            if (filter_data[byte_idx] & (1 << bit_idx)) == 0 {
                return false;
            }
        }

        true
    }

    /// Look up the file-level (lexicographical) position of `oid` within
    /// this commit-graph file.
    ///
    /// Returns `Some(pos)` suitable for passing to `maybe_contains`. Returns
    /// `None` when the OID is not found in this commit-graph file, or when a
    /// corrupt fan-out entry points past the file's commit count (the caller
    /// then treats the commit as unfiltered).
    pub(crate) fn commit_position(&self, oid: &ObjectId) -> Option<CommitPos> {
        let bytes = oid.as_bytes();
        let first_byte = usize::from(*bytes.first()?);
        let fan_base = self.oidf_offset;

        // Fan-out table gives the index range for this prefix byte.
        let lo = if first_byte == 0 {
            0u32
        } else {
            be_u32_at(&self.data, fan_base + (first_byte - 1) * 4)?
        };
        let hi = be_u32_at(&self.data, fan_base + first_byte * 4)?;

        if lo >= hi || hi > self.num_commits {
            return None;
        }

        // Binary search within OIDL chunk range [lo, hi). The OIDL chunk
        // is a sorted array of hash_len-byte OIDs.
        let oidl_base = self.oidl_offset;
        let mut l = lo;
        let mut r = hi;
        while l < r {
            let mid = l + (r - l) / 2;
            let mid_off = oidl_base + (mid as usize) * self.hash_len;
            if mid_off + self.hash_len > self.data.len() {
                return None;
            }
            let mid_oid = &self.data[mid_off..mid_off + self.hash_len];
            match bytes.cmp(mid_oid) {
                std::cmp::Ordering::Less => r = mid,
                std::cmp::Ordering::Greater => l = mid + 1,
                std::cmp::Ordering::Equal => return Some(CommitPos(mid)),
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// MurmurHash3 32-bit — matches Git's `murmur3_seeded` in bloom.c
// ---------------------------------------------------------------------------

fn murmur3_32_seeded(data: &[u8], seed: u32) -> u32 {
    let c1: u32 = 0xcc9e2d51;
    let c2: u32 = 0x1b873593;
    let r1: u32 = 15;
    let r2: u32 = 13;
    let m: u32 = 5;
    let n: u32 = 0xe6546b64;

    let len = data.len();
    let (blocks, tail) = data.as_chunks::<4>();
    let mut h = seed;

    for block in blocks {
        // Read as little-endian u32.
        let k1 = u32::from_le_bytes(*block);

        let k1 = (k1.wrapping_mul(c1)).rotate_left(r1).wrapping_mul(c2);
        h ^= k1;
        h = h.rotate_left(r2).wrapping_mul(m).wrapping_add(n);
    }

    // Tail bytes (1-3 remaining after full 4-byte blocks).
    // NOTE: this uses intentional fallthrough to match Git's switch stmt.
    let remaining = tail.len();
    if remaining > 0 {
        let mut k1 = 0u32;
        // Fallthrough: remaining=3 also processes bytes 2 and 1; remaining=2 also processes byte 1.
        if remaining >= 3 {
            k1 ^= (tail[2] as u32) << 16;
        }
        if remaining >= 2 {
            k1 ^= (tail[1] as u32) << 8;
        }
        k1 ^= tail[0] as u32;
        let k1 = k1.wrapping_mul(c1).rotate_left(r1).wrapping_mul(c2);
        h ^= k1;
    }

    // Finalization mix.
    h ^= len as u32;
    h ^= h >> 16;
    h = h.wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;

    h
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn mmap_file(path: &std::path::Path) -> Result<memmap2::Mmap, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open commit-graph at {}: {e}", path.display()))?;
    // SAFETY: a mapping is sound only while no one truncates or rewrites the
    // mapped inode in place; truncation turns reads of the `&[u8]` this
    // exposes into SIGBUS. This process never writes the file (it is opened
    // read-only and mapped copy-on-write read-only). Git never writes a live
    // commit-graph in place either: `objects/info/commit-graph` is replaced by
    // writing `commit-graph.lock` and renaming it over the old name, and the
    // split-chain `commit-graphs/graph-<hash>.graph` files are content-
    // addressed, written once via rename, and only ever unlinked by
    // expiry. Rename and unlink leave this already-mapped inode intact, so a
    // concurrent `git gc` / `git commit-graph write` / `git maintenance`
    // cannot invalidate the mapping. Only a non-Git tool editing the file in
    // place could; Git itself and gix (which this process already uses to
    // open the same file in `CommitGraphBloom::open` and in rev-walks) mmap
    // commit-graph files under the same assumption, so reading this one into
    // memory would not remove the exposure — it would only copy files that
    // reach tens of MiB or more on large histories.
    unsafe {
        memmap2::MmapOptions::new()
            .map_copy_read_only(&file)
            .map_err(|e| format!("Cannot mmap commit-graph at {}: {e}", path.display()))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Create a temporary git repository with many files, generate a
    /// commit-graph with Bloom filters, and return the opened `Repository`
    /// plus the `TempDir` guard.
    fn repo_with_bloom_filter() -> (gix::Repository, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("create temp dir");
        let repo_path = dir.path();

        Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(repo_path)
            .status()
            .expect("git init");
        Command::new("git")
            .args(["config", "user.name", "test"])
            .current_dir(repo_path)
            .status()
            .expect("git config user.name");
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(repo_path)
            .status()
            .expect("git config user.email");
        Command::new("git")
            .args(["config", "core.commitGraph", "true"])
            .current_dir(repo_path)
            .status()
            .expect("git config core.commitGraph");

        // Create 20 files to make the Bloom filter non-trivial.
        for i in 0u32..20 {
            let name = format!("file{i}.txt");
            std::fs::write(repo_path.join(&name), format!("content {i}")).expect("write file");
            Command::new("git")
                .args(["add", &name])
                .current_dir(repo_path)
                .status()
                .expect("git add");
        }
        Command::new("git")
            .args(["commit", "-m", "initial commit with many files"])
            .current_dir(repo_path)
            .status()
            .expect("git commit");

        let status = Command::new("git")
            .args(["commit-graph", "write", "--reachable", "--changed-paths"])
            .current_dir(repo_path)
            .status()
            .expect("git commit-graph write");
        assert!(
            status.success(),
            "git commit-graph write failed: {status:?}"
        );

        let repo = gix::open(repo_path).expect("gix open");
        (repo, dir)
    }

    #[test]
    fn open_bloom_filter() {
        let (repo, _dir) = repo_with_bloom_filter();
        let bloom = CommitGraphBloom::open(&repo).expect("open bloom filter");
        assert!(bloom.num_commits >= 1, "expected at least 1 commit");
    }

    #[test]
    fn query_known_path() {
        let (repo, _dir) = repo_with_bloom_filter();
        let bloom = CommitGraphBloom::open(&repo).expect("open bloom filter");

        // The initial commit changed file0.txt through file19.txt, so the
        // Bloom filter for commit 0 MUST return true for any of those paths.
        assert!(
            bloom.maybe_contains(CommitPos(0), b"file0.txt"),
            "file0.txt was added in commit 0, must match"
        );
        assert!(
            bloom.maybe_contains(CommitPos(0), b"file19.txt"),
            "file19.txt was added in commit 0, must match"
        );
    }

    #[test]
    fn query_returns_bool_without_panicking() {
        let (repo, _dir) = repo_with_bloom_filter();
        let bloom = CommitGraphBloom::open(&repo).expect("open bloom filter");

        // Calling maybe_contains with a nonsense path must not panic.
        let _ = bloom.maybe_contains(CommitPos(0), b"xyznonexistent12345");
        // (no assertion beyond "didn't panic")
    }

    #[test]
    fn missing_commit_graph_fails_closed() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let repo_path = dir.path();

        Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(repo_path)
            .status()
            .expect("git init");
        Command::new("git")
            .args(["config", "user.name", "test"])
            .current_dir(repo_path)
            .status()
            .expect("config user.name");
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(repo_path)
            .status()
            .expect("config user.email");
        std::fs::write(repo_path.join("f.txt"), "content").expect("write file");
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(repo_path)
            .status()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(repo_path)
            .status()
            .expect("git commit");

        // Intentionally do NOT write a commit-graph.

        let repo = gix::open(repo_path).expect("gix open");
        let result = CommitGraphBloom::open(&repo);
        match result {
            Err(err_msg) => {
                assert!(
                    err_msg.contains("commit graph") || err_msg.contains("commit-graph"),
                    "error should mention commit-graph: {err_msg}"
                );
            }
            Ok(_) => panic!("should fail when commit-graph is missing"),
        }
    }

    /// Write `bytes` to a fresh file, mmap it, and parse it with
    /// `from_mmap` — the post-mmap half of `open`, reachable here without
    /// gix's own commit-graph validation running first.
    fn parse_bytes(bytes: &[u8]) -> Result<CommitGraphBloom, String> {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().join("commit-graph");
        std::fs::write(&path, bytes).expect("write commit-graph copy");
        let data = mmap_file(&path)?;
        CommitGraphBloom::from_mmap(data, &path)
    }

    /// A commit-graph header plus chunk table for the given `(id, len)`
    /// chunks, followed by `len` zero bytes per chunk; `patch` then edits the
    /// chunk bodies (keyed by chunk id) in place.
    fn synthetic_graph(
        chunks: &[([u8; 4], usize)],
        patch: impl Fn(&[u8; 4], &mut [u8]),
    ) -> Vec<u8> {
        let mut out = b"CGPH".to_vec();
        out.extend([1, 1, chunks.len() as u8, 0]);
        let mut offset = (8 + (chunks.len() + 1) * 12) as u64;
        for (id, len) in chunks {
            out.extend(id);
            out.extend(offset.to_be_bytes());
            offset += *len as u64;
        }
        out.extend([0u8; 4]);
        out.extend(offset.to_be_bytes());
        for (id, len) in chunks {
            let mut body = vec![0u8; *len];
            patch(id, &mut body);
            out.extend(body);
        }
        out
    }

    /// A commit-graph shorter than its header, or cut off mid-chunk, must be
    /// refused with an `Err` (so the walk falls back to running without
    /// Bloom acceleration) rather than panicking on an out-of-bounds slice.
    #[test]
    fn truncated_commit_graph_fails_closed() {
        let (repo, _dir) = repo_with_bloom_filter();
        let graph_path = repo
            .objects
            .store_ref()
            .path()
            .join("info")
            .join("commit-graph");
        let full = std::fs::read(&graph_path).expect("read commit-graph");
        assert!(
            parse_bytes(&full).is_ok(),
            "the untruncated file must parse"
        );

        for len in [0, 1, 3, 4, 7, 8, 12, full.len() / 2] {
            let result = parse_bytes(&full[..len]);
            assert!(
                result.is_err(),
                "a commit-graph truncated to {len} of {} bytes must be refused",
                full.len()
            );
        }
    }

    /// Chunks the chunk table accepts but that are smaller than the header's
    /// counts require are refused at `open`, so no later query can read past
    /// them.
    #[test]
    fn undersized_chunks_fail_closed() {
        let bdat_header = |id: &[u8; 4], body: &mut [u8]| {
            if id == b"BDAT" && body.len() >= 4 {
                body[..4].copy_from_slice(&1u32.to_be_bytes());
            }
        };
        let err = |bytes: Vec<u8>| match parse_bytes(&bytes) {
            Err(e) => e,
            Ok(_) => panic!("undersized chunk must be refused"),
        };

        // BDAT shorter than its 12-byte header.
        let e = err(synthetic_graph(
            &[
                (*b"OIDF", 1024),
                (*b"OIDL", 1),
                (*b"BIDX", 1),
                (*b"BDAT", 4),
            ],
            bdat_header,
        ));
        assert!(e.contains("BDAT chunk too small"), "{e}");

        // OIDF shorter than its 256-entry fan-out table.
        let e = err(synthetic_graph(
            &[(*b"OIDF", 4), (*b"OIDL", 1), (*b"BIDX", 1), (*b"BDAT", 12)],
            bdat_header,
        ));
        assert!(e.contains("OIDF chunk too small"), "{e}");

        // Fan-out claims 5 commits: OIDL and BIDX must hold 5 entries each.
        let five_commits = |id: &[u8; 4], body: &mut [u8]| {
            bdat_header(id, body);
            if id == b"OIDF" {
                body[255 * 4..].copy_from_slice(&5u32.to_be_bytes());
            }
        };
        let e = err(synthetic_graph(
            &[
                (*b"OIDF", 1024),
                (*b"OIDL", 20),
                (*b"BIDX", 20),
                (*b"BDAT", 12),
            ],
            five_commits,
        ));
        assert!(e.contains("OIDL chunk too small"), "{e}");
        let e = err(synthetic_graph(
            &[
                (*b"OIDF", 1024),
                (*b"OIDL", 100),
                (*b"BIDX", 16),
                (*b"BDAT", 12),
            ],
            five_commits,
        ));
        assert!(e.contains("BIDX chunk too small"), "{e}");

        // Correctly sized chunks parse.
        assert!(
            parse_bytes(&synthetic_graph(
                &[
                    (*b"OIDF", 1024),
                    (*b"OIDL", 100),
                    (*b"BIDX", 20),
                    (*b"BDAT", 12)
                ],
                five_commits,
            ))
            .is_ok()
        );
    }

    /// A BIDX entry pointing past the BDAT chunk cannot rule a path out:
    /// `maybe_contains` answers `true` instead of panicking.
    #[test]
    fn out_of_range_bidx_entry_answers_maybe() {
        let bytes = synthetic_graph(
            &[
                (*b"OIDF", 1024),
                (*b"OIDL", 20),
                (*b"BIDX", 4),
                (*b"BDAT", 12),
            ],
            |id, body| match id {
                b"BDAT" => body[..4].copy_from_slice(&1u32.to_be_bytes()),
                b"OIDF" => body[255 * 4..].copy_from_slice(&1u32.to_be_bytes()),
                // Commit 0's filter "ends" 4 KiB into a 0-byte data area.
                b"BIDX" => body.copy_from_slice(&4096u32.to_be_bytes()),
                _ => {}
            },
        );
        let bloom = parse_bytes(&bytes).expect("structurally valid graph parses");
        assert!(bloom.maybe_contains(CommitPos(0), b"any/path"));
    }
}
