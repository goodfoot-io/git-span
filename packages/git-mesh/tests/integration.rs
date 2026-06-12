// Sole integration-test crate root.
// Cargo auto-discovers this file and compiles it as a single test binary.
// All 51 test cases live under `cases/` (a subdirectory Cargo does not scan
// for test crates), and shared support fixtures live under `support/`.
mod cases;
mod support;
