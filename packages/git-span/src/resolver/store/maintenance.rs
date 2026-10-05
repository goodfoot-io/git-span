//! Shared admitted-invocation maintenance policy. A new store starts due;
//! only successful reconciliation and reclamation clear durable pending work.

use super::{CacheStore, StoreResult, error::map_sqlite, lock::LockGuard};
use rusqlite::TransactionBehavior;

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
        self.conn
            .query_row(
                "SELECT admitted_count, due FROM maintenance_schedule WHERE id = 1",
                [],
                |row| {
                    Ok(MaintenanceState {
                        admitted_count: row.get(0)?,
                        due: row.get(1)?,
                    })
                },
            )
            .map_err(map_sqlite)
    }

    /// Acquire nonblocking ownership, then persist an admission in a short
    /// transaction. Pending due state survives errors and owner death.
    pub(crate) fn admit_maintenance(&mut self) -> StoreResult<MaintenanceDecision> {
        let Some(guard) = super::lock::try_acquire_maintenance(&self.dir)? else {
            return Ok(MaintenanceDecision::ActiveOwner);
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        tx.execute("UPDATE maintenance_schedule SET admitted_count = CASE WHEN due = 1 THEN admitted_count ELSE min(admitted_count + 1, ?1) END, due = CASE WHEN due = 1 OR admitted_count + 1 >= ?1 THEN 1 ELSE 0 END WHERE id = 1", [MAINTENANCE_ADMISSION_INTERVAL]).map_err(map_sqlite)?;
        let state = tx
            .query_row(
                "SELECT admitted_count, due FROM maintenance_schedule WHERE id = 1",
                [],
                |row| {
                    Ok(MaintenanceState {
                        admitted_count: row.get(0)?,
                        due: row.get(1)?,
                    })
                },
            )
            .map_err(map_sqlite)?;
        tx.commit().map_err(map_sqlite)?;
        if state.due {
            Ok(MaintenanceDecision::Due { state, guard })
        } else {
            Ok(MaintenanceDecision::Deferred(state))
        }
    }

    /// Clear due and reset admissions only after the caller completed fresh
    /// reconciliation and reclamation successfully. Consumes owner protection.
    pub(crate) fn complete_maintenance(&mut self, _guard: LockGuard) -> StoreResult<()> {
        self.conn
            .execute(
                "UPDATE maintenance_schedule SET admitted_count = 0, due = 0 WHERE id = 1",
                [],
            )
            .map_err(map_sqlite)?;
        Ok(())
    }

    /// Recheck non-live eligibility inside the deletion transaction, without
    /// the reuse-buffer recheck: lets tests drive the production deletion
    /// transaction under a caller-chosen victim order.
    #[cfg(test)]
    pub(super) fn gc_delete_non_live(&mut self, key_hex: &str) -> StoreResult<DeletionStats> {
        self.delete_non_live(key_hex, false)
    }

    /// Recheck the reuse-buffer count and candidate liveness under the same
    /// writer transaction so sibling protection cannot over-shrink the buffer.
    pub(super) fn gc_delete_above_buffer(&mut self, key_hex: &str) -> StoreResult<DeletionStats> {
        self.delete_non_live(key_hex, true)
    }

    fn delete_non_live(
        &mut self,
        key_hex: &str,
        require_excess: bool,
    ) -> StoreResult<DeletionStats> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        if require_excess {
            let count: u64 = tx
                .query_row(
                    "SELECT count(*) FROM generation WHERE live = 0",
                    [],
                    |row| row.get(0),
                )
                .map_err(map_sqlite)?;
            if count <= super::STORE_REUSE_BUFFER_GENERATIONS {
                return Ok(DeletionStats::default());
            }
        }
        let deleted = tx
            .execute(
                "DELETE FROM generation WHERE key_digest = ?1 AND live = 0",
                [key_hex],
            )
            .map_err(map_sqlite)?;
        let mut stats = DeletionStats::default();
        if deleted != 0 {
            stats.generations_removed = deleted as u64;
            stats.rows_removed = tx
                .execute(
                    "DELETE FROM generation_row WHERE key_digest = ?1",
                    [key_hex],
                )
                .map_err(map_sqlite)? as u64;
            tx.execute(
                "DELETE FROM span_path_index WHERE key_digest = ?1",
                [key_hex],
            )
            .map_err(map_sqlite)?;
        }
        tx.commit().map_err(map_sqlite)?;
        Ok(stats)
    }
}
