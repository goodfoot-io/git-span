//! Shared admitted-invocation maintenance policy. A new store starts due;
//! only successful reconciliation and reclamation clear durable pending work.

// Contract bootstrap: these surfaces are wired in the implementation phase.
#![allow(dead_code)]

use super::{CacheStore, StoreResult, lock::LockGuard};

/// Maximum admitted entries between successful full maintenance passes.
pub(crate) const MAINTENANCE_ADMISSION_INTERVAL: u32 = 16;

/// Durable scheduling state, shared by connections and retained on reopen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MaintenanceState {
    pub(crate) admitted_count: u32,
    pub(crate) due: bool,
}

/// An opportunity is admitted only after acquiring the dedicated owner lock.
pub(crate) enum MaintenanceDecision {
    /// Another caller owns maintenance; no durable counter change occurred.
    ActiveOwner,
    /// Admitted, but below the interval. No discovery is authorized.
    Deferred(MaintenanceState),
    /// Due was persisted before discovery; keep this owner until completion.
    Due {
        state: MaintenanceState,
        guard: LockGuard,
    },
}

/// Actual transactional deletions, including a zero outcome for a protected
/// or already absent generation. Child rows survive a protected generation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct DeletionStats {
    pub(crate) generations_removed: u64,
    pub(crate) rows_removed: u64,
}

impl CacheStore {
    /// Read the durable scheduler without admitting an opportunity.
    pub(crate) fn maintenance_state(&self) -> StoreResult<MaintenanceState> {
        todo!("read maintenance state")
    }

    /// Acquire nonblocking ownership, then persist an admission in a short
    /// transaction. Pending due state survives errors and owner death.
    pub(crate) fn admit_maintenance(&mut self) -> StoreResult<MaintenanceDecision> {
        todo!("admit shared maintenance opportunity")
    }

    /// Clear due and reset admissions only after the caller completed fresh
    /// reconciliation and reclamation successfully. Consumes owner protection.
    pub(crate) fn complete_maintenance(&mut self, _guard: LockGuard) -> StoreResult<()> {
        todo!("complete successful maintenance")
    }

    /// Recheck non-live eligibility inside the deletion transaction. Generic
    /// policy GC retains its existing deletion contract.
    pub(super) fn gc_delete_non_live(&mut self, _key_hex: &str) -> StoreResult<DeletionStats> {
        todo!("conditionally delete non-live generation")
    }
}
