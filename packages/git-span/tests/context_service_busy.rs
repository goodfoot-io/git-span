//! Busy readers must not remain queued after their caller falls back.
#![cfg(target_os = "linux")]
#[path = "support/context_service_busy.rs"]
mod support;
#[test]
fn busy_query_returns_fallback_without_waiting_for_capture() -> anyhow::Result<()> {
    support::assert_busy_query_returns_fallback()
}
