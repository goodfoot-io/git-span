//! `git span config` — read or set a span's trailing `[config]` block.
//!
//! The command owns no emission path of its own: reads render the
//! effective [`SpanConfig`] and writes go through the same
//! parse/serialize round-trip every other mutating command uses, so the
//! block's canonical shape (trailing position, three explicit keys,
//! default elision) is owned by `git-span-core` alone.

use anyhow::Result;
use gix::Repository;

use super::ConfigArgs;

pub fn run_config(_repo: &Repository, _args: ConfigArgs, _span_root: &str) -> Result<i32> {
    todo!("config read/write paths land with their unskipped checks")
}
