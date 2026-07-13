//! Span read/write operations. See §6.
//!
//! Split by concern:
//! - [`commit`] — staging resolution + span commit pipeline (§6.1, §6.2).
//! - [`read`]   — read-only views (§6.5, §6.6, §10.4).
//! - [`structural`] — delete, mv, restore, revert (§6.8).

pub mod read;
pub mod structural;

pub use read::{list_span_names, read_span, read_span_at, show_span, show_span_at};
pub use structural::{delete_span, rename_span};
