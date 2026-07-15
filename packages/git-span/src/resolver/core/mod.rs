//! Layer-neutral resolution core and invocation-state snapshot contract
//! (card main-157 Phase 1: "Freeze Semantic And Snapshot Contracts").
//!
//! This module is pure types and deterministic projections — no storage, no
//! execution-path wiring. It exists so every later phase (the SQLite store,
//! exact/incremental/dirty execution paths, GC) is built on a single
//! layer-neutral result (`ResolutionCore`) and a single complete state
//! snapshot (`StateToken`), instead of the two overlapping, incomplete keys
//! `resolver/cache` and `resolver/cache_v2` use today. See
//! `plans/initial.md` Phase 1, `notes/architecture-and-complexity.md`
//! "Semantic Model", and `notes/correctness-contract.md` for the specific
//! defects this contract makes structurally impossible:
//!
//! - `resolver/cache_v2` resolves the same span set twice — once with
//!   `LayerSet::committed_only()` for the committed baseline
//!   (`build_committed_spans`), once with the caller's full layers for the
//!   effective/whole result (`build_clean_whole_result`) — merely because
//!   `current.blob` and the drift label differ by active layer.
//!   [`resolution::ResolutionCore`] captures one layer-neutral result;
//!   [`project::project_committed`] and [`project::project_effective`]
//!   deterministically select/relabel it into either view.
//! - `resolver/cache_v2`'s keys omit rename budget, copy detection, filter
//!   dependencies, and complete availability state (see
//!   `notes/correctness-contract.md` "Incomplete Semantic Keys").
//!   [`token::StateToken`] captures every output-affecting input explicitly,
//!   so an incomplete key is a compile-time impossibility for code built on
//!   top of it.
//! - Duplicate anchor addresses are valid parser input but current row
//!   primary keys collapse them (`notes/correctness-contract.md`
//!   "Completeness, Identity, And Order"). [`resolution::DefinitionOrdinal`]
//!   is explicit `(span identity, source ordinal, canonical definition
//!   digest)` identity, never an address-keyed map.

pub(crate) mod capture;
pub(crate) mod exe_digest;
pub(crate) mod exe_digest_store;
pub(crate) mod project;
pub(crate) mod resolution;
pub(crate) mod token;

#[cfg(test)]
mod tests;
