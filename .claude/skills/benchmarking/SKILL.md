---
name: benchmarking
description: Runs the git-span and agent-hooks performance benchmark suites and attributes the results. Use when the user says "benchmark this", "run the benchmarks", "measure the performance impact", "is this change faster", or asks whether an optimization actually helped.
---

<instructions>

## 1. Pick the Surfaces the Change Can Reach

Four independent suites cover this repo. Run only the ones the change can affect; a suite that cannot see the change contributes noise, not evidence.

| Surface | Command | Covers |
|---------|---------|--------|
| Criterion | `yarn workspace git-span bench` | Rust resolver, drift, corpus sweeps |
| Context acceptance | `yarn workspace git-span bench:context` | Release-binary context output |
| Static attribution | `yarn workspace agent-hooks bench:static` | Command parser, pre/post static-plan bundles |
| Hook path | `yarn workspace agent-hooks bench:hooks` | Advisor, apply-patch, session sweeps, failure hooks |

The agent-hooks suites write their JSON report to **stdout** — redirect it to a file. Both suites bundle the hooks from current source at run time, so a source edit is picked up without a manual rebuild.

## 2. Prepare the Machine

Do all of this before the first sample; each step invalidates results if skipped.

- **Set `GIT_SPAN_FINGERPRINT_TRIPWIRE=0`** for every benchmark invocation.
- **Build the release binary and assert its version** matches `packages/git-span/Cargo.toml`, then install it where `git span` resolves. Suites spawn the *installed* binary, not the one you just built.
- **Confirm nothing else is building.** Cargo compiles, a parallel `yarn validate`, or another agent's test run will dominate the measurement. This is the single largest source of false regressions.
- **Never run benchmarks concurrently with each other.** Run suites strictly serially.

**A stale installed binary silently corrupts both benchmarks and tests.** If a suite passed before you installed a fresh build and fails after, suspect that the old binary was masking a real defect — investigate the defect rather than reverting the install.

## 3. Measure with a Same-Session A/B

Comparing against numbers captured earlier — a previous round, a stored baseline — compares machine states, not code. Produce both arms back to back in one sitting:

1. `git stash push -u` the change (include untracked test files).
2. Rebuild any emitted artifacts the suite spawns, then run the suites into a `base-*` file.
3. `git stash pop`, rebuild again, run the suites into an `opt-*` file.
4. Compare `p50Ms` per named cell.

Rebuild in **both** arms. Skipping the baseline rebuild measures the new bundles against themselves.

## 4. Attribute Every Delta to a Mechanism

**A number is not a result until you can name the code path that produced it.** Before reporting any delta, confirm the cell's fixture actually exercises the changed code — read the cell definition in the benchmark source and check its scale, candidate count, and which branch it takes.

- **The cell cannot reach the changed code**: the delta is noise. Say so plainly and move on.
- **Cells split by fixture size or branch, one direction each**: that is the real shape of the change — report both directions.
- **A large regression appears across unrelated cells**: suspect contention. Re-run the affected cells alone on a quiet machine before believing it.

Apply the measured noise floor for this harness: up to **45%** on sub-0.1 ms cells and **18%** on low-single-digit-ms cells that spawn processes. Movement inside the floor is not a finding. For Criterion, trust the **confidence-interval width**, not the point estimate — a wide interval means the run was contended and must be repeated.

The most reliable way to dismiss an apparent regression is to prove the executed path is unchanged (an early return, an untaken branch), not to argue from magnitude.

## 5. Gate on Correctness Separately

Run the repo's full validation as a **correctness gate only** — never as the timing signal; its wall clock reflects machine load, not the change.

- **Any failure or warning**: blocking, including ones the change did not cause.
- **A test times out only under the full parallel suite**: raise that test's timeout to the repo's real-binary convention rather than weakening the assertion.
- **Emitted hook bundles differ after a rebuild**: regenerate and stage them; a checked-in bundle gate will otherwise fail the run.
- **A package-local gate passes but the workspace gate fails**: package-local runs do not cover sibling crates that share the changed code.

## 6. Distrust Tests That Pass Too Easily

The touch and hook pipelines **fail open** — a spawn that throws yields no output rather than an error. A fixture that never puts the workspace binary on the test's `PATH`, or that writes content identical to what is already there, produces green assertions comparing empty to empty.

Before trusting a new benchmark-adjacent test, force it to fail once by breaking the thing it claims to check. If it still passes, the fixture is inert.

## 7. Report

For each surface, give the cell name, both arms' `p50`, and the percentage delta. State which deltas are attributed to a mechanism and which fall inside the noise floor, and name the mechanism for every win claimed. Report regressions with the same prominence as improvements.

</instructions>
