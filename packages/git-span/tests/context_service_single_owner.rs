//! Regression coverage for context-service lifetime ownership.

#![cfg(target_os = "linux")]

#[path = "support/context_service_ownership.rs"]
mod context_service_ownership;

#[test]
fn a_second_service_cannot_replace_a_live_owners_socket() -> anyhow::Result<()> {
    context_service_ownership::assert_single_owner()
}
