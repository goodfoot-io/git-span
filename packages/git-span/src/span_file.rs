//! Span file format: parse/serialize the text-based span file storage.
//!
//! The format and its pure text↔struct transform live in the gix-free
//! `git-span-core` kernel (it is the on-disk contract `.span`/`.wiki`
//! consumers share). This module re-exports the kernel's items on their
//! original `crate::span_file::*` paths so git-span's callers are unchanged.
//! `SpanFile::parse` returns the kernel's `Result`; call sites lift it into
//! this crate's `Error` via the `?` operator / `From`.

pub use git_span_core::span_file::{AnchorRecord, SpanFile, has_conflict_markers, parse_address};
