//! `git mesh rewrite` handler — reads old→new SHA pairs from stdin and
//! advances mesh anchors via CAS (the post-rewrite hook protocol).

use crate::cli::format;
use crate::cli::RewriteArgs;
use crate::mesh::rewrite::{rewrite_meshes, AnchorRewriteOutcome, RewriteOutcome};
use anyhow::Result;
use std::collections::HashMap;
use std::io::Read as _;

pub fn run_rewrite(repo: &gix::Repository, args: RewriteArgs) -> Result<i32> {
    // Read all of stdin.
    let mut stdin_text = String::new();
    std::io::stdin()
        .read_to_string(&mut stdin_text)
        .map_err(|e| anyhow::anyhow!("failed to read stdin: {e}"))?;

    // Parse the old→new map.
    let map = match parse_map(&stdin_text) {
        Ok(m) => m,
        Err(e) => {
            return Err(anyhow::Error::from(crate::cli::CliError {
                subcommand: "rewrite",
                summary: "malformed input on stdin.".into(),
                what_happened: format!(
                    "The post-rewrite hook contract is `<old_sha> <new_sha>` per line. {e}"
                ),
                next_steps: vec![crate::cli::NextStep::Prose(
                    "If you are invoking `git mesh rewrite` manually, format each line as \
                         two 40-character SHAs separated by a single space."
                        .into(),
                )],
            }));
        }
    };

    if map.is_empty() {
        return Ok(0);
    }

    let outcomes = rewrite_meshes(repo, &map)?;

    // Render output.
    let use_json = matches!(args.format, crate::cli::RewriteFormat::Json);
    let mut hard_error = false;

    if use_json {
        for outcome in &outcomes {
            if outcome.advanced > 0 || outcome.is_hard_error() {
                render_json_one(outcome)?;
            }
            if outcome.is_hard_error() {
                hard_error = true;
            }
        }
    } else {
        render_human(&outcomes);
        for outcome in &outcomes {
            if outcome.is_hard_error() {
                hard_error = true;
            }
        }
    }

    if hard_error {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn parse_map(text: &str) -> Result<HashMap<String, String>, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut tokens = line.split_ascii_whitespace();
        let old_sha = tokens
            .next()
            .ok_or_else(|| format!("malformed line: {line:?}"))?;
        let new_sha = tokens
            .next()
            .ok_or_else(|| format!("malformed line: {line:?}"))?;

        if !is_valid_hex40(old_sha) {
            return Err(format!("malformed sha: {old_sha:?}"));
        }
        if !is_valid_hex40(new_sha) {
            return Err(format!("malformed sha: {new_sha:?}"));
        }

        // Drop old == new pairs silently.
        if old_sha == new_sha {
            continue;
        }

        // Duplicate old_sha is an error.
        if map.contains_key(old_sha) {
            return Err(format!("duplicate old_sha: {old_sha}"));
        }

        map.insert(old_sha.to_string(), new_sha.to_string());
    }
    Ok(map)
}

fn is_valid_hex40(s: &str) -> bool {
    s.len() == 40
        && s.chars()
            .all(|c| c.is_ascii_digit() || matches!(c, 'a'..='f'))
}

fn render_human(outcomes: &[RewriteOutcome]) {
    // Compute totals for the summary line.
    let total_anchors: usize = outcomes.iter().map(|o| o.anchors.len()).sum();
    let total_meshes = outcomes.len();

    println!("# git mesh rewrite");
    println!();
    println!(
        "Processed {total_anchors} old/new SHA pairs across {total_meshes} {}.{}",
        if total_meshes == 1 { "mesh" } else { "meshes" },
        format::IDEMPOTENT_TAG,
    );

    for outcome in outcomes {
        if outcome.is_hard_error() {
            println!(
                "- `{}` — error: {}",
                outcome.name,
                outcome.hard_error.as_deref().unwrap_or("unknown")
            );
            continue;
        }

        if outcome.advanced == 0
            && outcome.skipped_blob_changed == 0
            && outcome.skipped_path_missing == 0
        {
            continue;
        }

        let total = outcome.anchors.len() as u32;

        if outcome.advanced == total {
            // All anchors advanced — show SHA transition from first anchor.
            let first = outcome
                .anchors
                .iter()
                .find(|a| matches!(a.outcome, AnchorRewriteOutcome::Advanced));
            if let Some(record) = first {
                let old_short = &record.old_sha[..12.min(record.old_sha.len())];
                let new_short = record
                    .new_sha
                    .as_deref()
                    .map(|s| s[..12.min(s.len())].to_string())
                    .unwrap_or_default();
                println!(
                    "- `{}` — advanced {}/{} anchors: `{}` → `{}`.",
                    outcome.name, outcome.advanced, total, old_short, new_short,
                );
            } else {
                println!(
                    "- `{}` — advanced {}/{} anchors.",
                    outcome.name, outcome.advanced, total,
                );
            }
        } else {
            // Mixed: some advanced, some skipped.
            let first = outcome
                .anchors
                .iter()
                .find(|a| matches!(a.outcome, AnchorRewriteOutcome::Advanced));
            if let Some(record) = first {
                let old_short = &record.old_sha[..12.min(record.old_sha.len())];
                let new_short = record
                    .new_sha
                    .as_deref()
                    .map(|s| s[..12.min(s.len())].to_string())
                    .unwrap_or_default();
                let skip_reasons: Vec<&str> = {
                    let mut r = Vec::new();
                    if outcome.skipped_blob_changed > 0 {
                        r.push("the file no longer contains the anchored blob");
                    }
                    if outcome.skipped_path_missing > 0 {
                        r.push("the path is missing");
                    }
                    r
                };
                let skip_note = if skip_reasons.is_empty() {
                    format!(
                        "{} anchor{} skipped",
                        outcome.skipped_blob_changed + outcome.skipped_path_missing,
                        if outcome.skipped_blob_changed + outcome.skipped_path_missing == 1 {
                            ""
                        } else {
                            "s"
                        },
                    )
                } else {
                    format!(
                        "{} anchor{} skipped because {}",
                        outcome.skipped_blob_changed + outcome.skipped_path_missing,
                        if outcome.skipped_blob_changed + outcome.skipped_path_missing == 1 {
                            ""
                        } else {
                            "s"
                        },
                        skip_reasons.join(" and "),
                    )
                };
                println!(
                    "- `{}` — advanced {}/{} anchors: `{}` → `{}`. {}.",
                    outcome.name, outcome.advanced, total, old_short, new_short, skip_note,
                );
            } else {
                // No advances, only skips.
                println!("- `{}` — advanced 0/{} anchors.", outcome.name, total,);
            }
        }
    }

    // Skipped anchors section.
    let has_skipped = outcomes
        .iter()
        .any(|o| o.skipped_blob_changed > 0 || o.skipped_path_missing > 0);
    if has_skipped {
        println!();
        println!("## Skipped anchors");
        for outcome in outcomes {
            for a in &outcome.anchors {
                let reason = match &a.outcome {
                    AnchorRewriteOutcome::SkippedBlobChanged => "blob changed",
                    AnchorRewriteOutcome::SkippedPathMissing => "path missing",
                    _ => continue,
                };
                let old_short = &a.old_sha[..12.min(a.old_sha.len())];
                let new_short = a
                    .new_sha
                    .as_deref()
                    .map(|s| s[..12.min(s.len())].to_string())
                    .unwrap_or_default();
                // The spec shows anchor address with line range, but the
                // AnchorRewriteRecord only carries the file path, not the
                // extent. Show the file path as-is.
                println!(
                    "- `{}` `{}` (`{}` → `{}`) — {reason}.",
                    outcome.name, a.path, old_short, new_short,
                );
            }
        }
    }

    println!();
    println!("Run `git mesh stale` to confirm all meshes are fresh after the rewrite.");
}

fn render_json_one(outcome: &RewriteOutcome) -> Result<()> {
    let anchors: Vec<serde_json::Value> = outcome
        .anchors
        .iter()
        .map(|a| {
            serde_json::json!({
                "anchor_id": a.anchor_id,
                "outcome": match &a.outcome {
                    AnchorRewriteOutcome::Advanced => "advanced",
                    AnchorRewriteOutcome::SkippedBlobChanged => "skipped_blob_changed",
                    AnchorRewriteOutcome::SkippedPathMissing => "skipped_path_missing",
                    AnchorRewriteOutcome::ConflictExhausted => "conflict_exhausted",
                    AnchorRewriteOutcome::NoMatch => "no_match",
                },
                "old_sha": a.old_sha,
                "new_sha": a.new_sha,
                "path": a.path,
            })
        })
        .collect();

    let obj = serde_json::json!({
        "schema": "rewrite-v1",
        "mesh": outcome.name,
        "advanced": outcome.advanced,
        "skipped_blob_changed": outcome.skipped_blob_changed,
        "skipped_path_missing": outcome.skipped_path_missing,
        "errors": outcome.errors,
        "hard_error": outcome.hard_error,
        "anchors": anchors,
    });
    println!("{}", serde_json::to_string(&obj)?);
    Ok(())
}
