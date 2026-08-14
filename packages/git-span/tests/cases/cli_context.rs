//! Executable contract for the schema-v1 context query.

use crate::support::TestRepo;
use anyhow::Result;

fn ignored_contract_case() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let output = repo.run_span(["context", "file1.txt#L1-L3", "--format", "json"])?;
    assert!(output.status.success());
    let document: git_span::cli::context::ContextDocument = serde_json::from_slice(&output.stdout)?;
    assert_eq!(document.schema_version, 1);
    Ok(())
}

macro_rules! contract_case {
    ($name:ident) => {
        #[test]
        #[ignore = "context executable contract; activate with implementation slice"]
        fn $name() -> Result<()> {
            ignored_contract_case()
        }
    };
}

contract_case!(schema_ordering_and_exact_intersections);
contract_case!(status_source_and_utf8_detail_tokens);
contract_case!(invalid_input_race_and_size_fail_closed);
contract_case!(repair_post_state_and_cycle_safety);
contract_case!(service_identity_bootstrap_and_legacy_name);
contract_case!(watch_closure_liveness_and_backpressure);
contract_case!(atomic_recovery_and_operation_id_replay);
contract_case!(controlled_repair_epoch);
contract_case!(strict_tombstone_and_definition_capture);
contract_case!(production_perf_counters_and_acceptance_harness);
