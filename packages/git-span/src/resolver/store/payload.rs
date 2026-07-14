//! Verified payload envelope for the SQLite store (card main-157 Phase 2).
//!
//! Every persisted value embeds — and every read re-verifies — five
//! independent facts about itself: its entry kind, its payload/schema
//! version, the canonical key digest it was sealed under, its cardinality
//! (row count for a generation, ordinal for a row), and a BLAKE3 digest over
//! all of the above plus the payload bytes. This directly implements
//! `notes/correctness-contract.md` "Payload Integrity": versioned bincode
//! alone cannot detect a plausible bit flip that still decodes, so a decoded
//! value is trusted only after all five facts match what the reader expects.
//!
//! The digest is computed by [`envelope_digest`] over length-prefixed fields
//! so no field boundary can be forged by shifting bytes between fields, and a
//! truncated payload (any byte-prefix) changes both the embedded length and
//! the trailing bytes, so every truncation is caught (see the truncation
//! loop in `tests.rs`).

use blake3::Hasher;

/// Entry-kind discriminants embedded in every row. A row read under the wrong
/// expected kind is rejected, closing the `cache_v2` defect where a summary,
/// finding, and whole-result row shared enough key shape to be confused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub(crate) enum EntryKind {
    /// A complete committed generation (the authoritative summary envelope).
    Generation = 1,
    /// One immutable normalized reuse row belonging to a generation.
    GenerationRow = 2,
}

impl EntryKind {
    pub(crate) fn as_u32(self) -> u32 {
        self as u32
    }
}

/// Domain-separation tag folded into every generation-summary digest.
pub(crate) const DOMAIN_GENERATION: &[u8] = b"gm.store.generation\0";
/// Domain-separation tag folded into every generation-row digest.
pub(crate) const DOMAIN_ROW: &[u8] = b"gm.store.row\0";

/// The specific integrity fact that failed verification. Surfaced as a
/// structured rejection reason (never a silent trust) per
/// `notes/correctness-contract.md` "Fail-Closed Meaning".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IntegrityReason {
    /// Stored `entry_kind` column does not match the expected kind.
    Kind,
    /// Stored `payload_version` does not match the reader's version.
    Version,
    /// Stored envelope was sealed under a different canonical key than the
    /// one it is now filed/looked-up under (a relocated row).
    Key,
    /// Stored cardinality (generation `row_count`, or a row `ordinal`) does
    /// not match what the reader observed.
    Count,
    /// Recomputed BLAKE3 digest does not match the stored digest (a bit flip,
    /// a truncation, or any tampered column folded into the digest).
    Digest,
    /// A generation references N rows but a different number are present.
    MissingRow,
}

/// Length-prefix `bytes` so concatenated fields cannot collide.
fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

/// Canonical BLAKE3 digest of one payload envelope. Every field that a reader
/// cross-checks (`kind`, `version`, `key`, `cardinality`) is folded in, so
/// tampering any stored column — not only the payload — produces a digest
/// mismatch even if the reader's explicit column check were somehow bypassed.
pub(crate) fn envelope_digest(
    domain: &[u8],
    kind: u32,
    version: u32,
    key: &[u8; 32],
    cardinality: u64,
    payload: &[u8],
) -> [u8; 32] {
    let mut h = Hasher::new();
    h.update(domain);
    h.update(&kind.to_le_bytes());
    h.update(&version.to_le_bytes());
    h.update(key);
    h.update(&cardinality.to_le_bytes());
    write_prefixed(&mut h, payload);
    *h.finalize().as_bytes()
}

/// Verify one stored envelope against the reader's expectations, returning the
/// first fact that fails. `stored_digest` is the digest column read back from
/// SQLite; the remaining arguments are the values the reader expects (from the
/// query key and the reader's own version constant) paired with the values
/// read from their columns.
#[allow(clippy::too_many_arguments)]
pub(crate) fn verify_envelope(
    domain: &[u8],
    expected_kind: u32,
    stored_kind: u32,
    expected_version: u32,
    stored_version: u32,
    expected_key: &[u8; 32],
    stored_key: &[u8; 32],
    expected_cardinality: u64,
    stored_cardinality: u64,
    payload: &[u8],
    stored_digest: &[u8],
) -> Result<(), IntegrityReason> {
    if stored_kind != expected_kind {
        return Err(IntegrityReason::Kind);
    }
    if stored_version != expected_version {
        return Err(IntegrityReason::Version);
    }
    if stored_key != expected_key {
        return Err(IntegrityReason::Key);
    }
    if stored_cardinality != expected_cardinality {
        return Err(IntegrityReason::Count);
    }
    // Recompute over the values actually read back from columns/payload; a
    // digest sealed under any different field will not match.
    let recomputed = envelope_digest(
        domain,
        stored_kind,
        stored_version,
        stored_key,
        stored_cardinality,
        payload,
    );
    if stored_digest != recomputed {
        return Err(IntegrityReason::Digest);
    }
    Ok(())
}
