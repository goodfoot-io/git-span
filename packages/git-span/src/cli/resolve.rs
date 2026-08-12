//! `git span resolve <name>` — settle every residue entry in a
//! conflict-markered span file under one explicitly chosen side.
//!
//! `resolve` is the one command whose supported input is a file carrying Git
//! textual conflict markers. It reads that file as it stands, picks one side
//! — `--rehash` (worktree truth, the default), `--ours`, or `--theirs` — for
//! every residue entry at once, and either writes a clean span through the
//! ordinary [`SpanFile::serialize`] path or leaves the file byte-identical
//! and names the entry that stopped it.
//!
//! Three contracts distinguish it from `drift --fix`:
//!
//! * **All-or-nothing per span.** Any unsettleable residue aborts before the
//!   single write, so a failed `resolve` is always safe to retry with a
//!   different side.
//! * **Never stages.** `resolve` issues zero `git` subprocess calls; the
//!   operator reviews with `git diff` and stages what they agree with.
//! * **Narrow input claim.** Only the residue shape
//!   [`crate::cli::drift_fix::format_residue_markers`] produces is claimed —
//!   at most one conflict block, no `[config]` header inside it. Anything
//!   else is refused before the marker split is trusted for anything.
//!
//! Anchors and why always come from the live worktree text, so progress an
//! operator already made by hand is read as agreed content rather than
//! reverted.

use crate::cli::commit::{span_file_path, write_worktree_span};
use crate::cli::drift_fix::{read_clean_source_files, split_conflict_markers};
use crate::cli::{CliError, NextStep, ResolveArgs, ResolveFormat};
use crate::span_file::{AnchorRecord, SpanFile};
use anyhow::Result;
use git_span_core::UnresolvedAnchor;
use git_span_core::{
    RK64_ALGORITHM, SpanConfig, has_conflict_markers, merge_span_files, resolve_config,
    resolve_why_text,
};
use std::collections::{BTreeSet, HashMap, HashSet};

/// `resolve`-family JSON document version. Its own family: the document is
/// identified by the top-level `command: "resolve"` key plus this number.
pub const RESOLVE_JSON_SCHEMA_VERSION: u32 = 1;

/// The `[config]`-loss ceiling line (step 11). Printed whenever `resolve`
/// writes a span whose final config is the default and no second evidence
/// source was available to recover a dropped `[config]` from.
const CONFIG_LOSS_LINE: &str = "config: no `[config]` section found in the input; written with \
     default settings (copy_detection=same-commit, ignore_whitespace=false, follow_moves=false). \
     No unmerged index stages were available to recover it from; if the span had non-default \
     settings before this conflict, restore them manually with a follow-up edit if needed.";

/// The `why`-loss ceiling line (step 11), symmetric to [`CONFIG_LOSS_LINE`].
const WHY_LOSS_LINE: &str = "why: no why paragraph found in the input for an anchor-only conflict \
     block; written empty. No unmerged index stages were available to recover it from; if the \
     span had why prose before this conflict, restore it manually if needed.";

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/// Which side of the conflict decides every residue entry.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Side {
    /// Re-read each conflicted anchor's source from the worktree and hash it.
    Rehash,
    Ours,
    Theirs,
}

impl Side {
    /// The three sides in the order `--dry-run` reports them.
    const ALL: [Side; 3] = [Side::Rehash, Side::Ours, Side::Theirs];

    fn flag(self) -> &'static str {
        match self {
            Side::Rehash => "--rehash",
            Side::Ours => "--ours",
            Side::Theirs => "--theirs",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Side::Rehash => "rehash",
            Side::Ours => "ours",
            Side::Theirs => "theirs",
        }
    }
}

// ---------------------------------------------------------------------------
// Settlement result shapes
// ---------------------------------------------------------------------------

/// One settled entry in the report: an anchor address and what happened to it.
#[derive(Debug, Clone, serde::Serialize)]
struct ReportEntry {
    address: String,
    outcome: String,
}

/// A successful per-side settlement: the span that would be (or was) written
/// plus everything the report needs.
#[derive(Debug)]
struct Settlement {
    merged: SpanFile,
    entries: Vec<ReportEntry>,
    why_label: String,
    config_label: String,
    warnings: Vec<String>,
    /// True when the merge needed no side arbitration at all (no residue).
    structural_only: bool,
}

/// The outcome of evaluating one side. Non-propagating by construction so
/// `--dry-run` can complete all three evaluations regardless of any failing.
#[derive(Debug)]
enum SideOutcome {
    Resolved(Box<Settlement>),
    Failed(Vec<String>),
}

// ---------------------------------------------------------------------------
// JSON documents
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
struct ResolveDocument {
    schema_version: u32,
    command: &'static str,
    span: String,
    side: &'static str,
    dry_run: bool,
    written: bool,
    entries: Vec<ReportEntry>,
    why: String,
    config: String,
    warnings: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
struct SideDocument {
    side: &'static str,
    outcome: &'static str,
    entries: Vec<ReportEntry>,
    failures: Vec<String>,
    why: Option<String>,
    config: Option<String>,
    warnings: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
struct ResolveDryRunDocument {
    schema_version: u32,
    command: &'static str,
    span: String,
    dry_run: bool,
    written: bool,
    sides: Vec<SideDocument>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git span resolve <name>`. See the module docs for the contract.
pub fn run_resolve(repo: &gix::Repository, args: ResolveArgs, span_root: &str) -> Result<i32> {
    let name = args.name.clone();

    // Step 1: read the worktree span file.
    let path = span_file_path(repo, span_root, &name)?;
    if !path.exists() {
        return Err(CliError {
            subcommand: "resolve",
            summary: format!("no span named `{name}`."),
            what_happened: format!("`{span_root}/{name}` does not exist."),
            next_steps: vec![NextStep::Bash("git span list".into())],
        }
        .into());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` could not be read."),
        what_happened: format!("Reading `{}` failed: {e}", path.display()),
        next_steps: vec![NextStep::Prose(format!(
            "`{span_root}/{name}` is not a readable span file. A hierarchical span whose \
             directory shadows this name occupies the same path — list what is there and \
             resolve the leaf span by its full name."
        ))],
    })?;

    // Step 2: no-op check (worktree-text question, exit 0 per the
    // add-refresh precedent).
    if !has_conflict_markers(&raw) {
        println!("`{name}` has no conflict markers; nothing to resolve");
        return Ok(0);
    }

    // Step 3: driver-shape refusal, unconditional. Returns the marker-length
    // canonicalized text the split is verified against.
    let shaped = verify_driver_shape(&raw, &name)?;

    // Step 4: split and parse. `base` stays `None`: anchors and why come
    // solely from the worktree text.
    let (ours_text, theirs_text) = split_conflict_markers(&shaped).ok_or_else(|| {
        anyhow::anyhow!("internal error: span `{name}` reported as conflicted but no markers found")
    })?;
    let ours = SpanFile::parse(&ours_text).map_err(|e| parse_error(&name, "ours", e))?;
    let theirs = SpanFile::parse(&theirs_text).map_err(|e| parse_error(&name, "theirs", e))?;

    // Step 4b: algorithm sanity gate.
    check_algorithms(&ours, &theirs, &name)?;

    if args.dry_run {
        return run_dry_run(repo, &name, &ours, &theirs, args.format);
    }

    let side = if args.ours {
        Side::Ours
    } else if args.theirs {
        Side::Theirs
    } else {
        Side::Rehash
    };

    // Steps 5–8: compute source evidence, run the pre-kernel checks, merge,
    // and settle why/config.
    match evaluate_side(repo, side, &ours, &theirs) {
        SideOutcome::Failed(reasons) => Err(failure_error(&name, side, &reasons).into()),
        SideOutcome::Resolved(settlement) => {
            let mut settlement = *settlement;
            // Steps 9 + 10: canonical sort, then the single write. Nothing
            // below this point can fail in a way that leaves a partial file.
            write_worktree_span(repo, span_root, &name, &mut settlement.merged)?;
            // Step 11: report.
            match args.format {
                ResolveFormat::Human => print_human(&name, side, &settlement),
                ResolveFormat::Json => print_json(&name, side, &settlement)?,
            }
            Ok(0)
        }
    }
}

/// `--dry-run`: report what EACH of the three sides would produce. Side flags
/// are ignored; nothing is written; every side completes regardless of
/// another side's failure.
fn run_dry_run(
    repo: &gix::Repository,
    name: &str,
    ours: &SpanFile,
    theirs: &SpanFile,
    format: ResolveFormat,
) -> Result<i32> {
    let outcomes: Vec<(Side, SideOutcome)> = Side::ALL
        .iter()
        .map(|&side| (side, evaluate_side(repo, side, ours, theirs)))
        .collect();

    match format {
        ResolveFormat::Human => {
            println!("dry run for `{name}` — nothing written; all three sides evaluated");
            for (side, outcome) in &outcomes {
                match outcome {
                    SideOutcome::Resolved(settlement) => {
                        println!("{}: would resolve", side.flag());
                        for line in settlement_lines(settlement) {
                            println!("  {line}");
                        }
                    }
                    SideOutcome::Failed(reasons) => {
                        println!("{}: would fail", side.flag());
                        for reason in reasons {
                            println!("  {reason}");
                        }
                    }
                }
            }
        }
        ResolveFormat::Json => {
            let doc = ResolveDryRunDocument {
                schema_version: RESOLVE_JSON_SCHEMA_VERSION,
                command: "resolve",
                span: name.to_string(),
                dry_run: true,
                written: false,
                sides: outcomes
                    .iter()
                    .map(|(side, outcome)| match outcome {
                        SideOutcome::Resolved(s) => SideDocument {
                            side: side.name(),
                            outcome: "resolved",
                            entries: s.entries.clone(),
                            failures: Vec::new(),
                            why: Some(s.why_label.clone()),
                            config: Some(s.config_label.clone()),
                            warnings: s.warnings.clone(),
                        },
                        SideOutcome::Failed(reasons) => SideDocument {
                            side: side.name(),
                            outcome: "failed",
                            entries: Vec::new(),
                            failures: reasons.clone(),
                            why: None,
                            config: None,
                            warnings: Vec::new(),
                        },
                    })
                    .collect(),
            };
            println!("{}", serde_json::to_string_pretty(&doc)?);
        }
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// Step 3: driver-shape refusal
// ---------------------------------------------------------------------------

/// Length of a leading run of `c`, when the run is at least 7 characters
/// long (the shortest conflict marker git ever writes).
fn marker_run_len(line: &str, c: char) -> Option<usize> {
    let len = line.chars().take_while(|ch| *ch == c).count();
    if len >= 7 { Some(len) } else { None }
}

/// Refuse input shapes `split_conflict_markers`'s driver-format heuristic
/// (single-block assumption, no embedded `[config]`) is not verified against,
/// and return the text with conflict markers canonicalized to length 7.
///
/// Git writes markers at the configured conflict-marker size (`%L`, which
/// [`crate::cli::merge_driver`] honors), while the shared split recognizes a
/// `=======` separator only at exactly seven characters. Canonicalizing the
/// three marker forms here — and only inside a block, so a Markdown setext
/// underline in why prose is untouched — keeps a `%L=9` residue file readable
/// without changing the shared splitter every other caller depends on.
fn verify_driver_shape(raw: &str, name: &str) -> std::result::Result<String, CliError> {
    let refusal = |reason: String| CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` is not in the shape `resolve` can settle."),
        what_happened: format!(
            "{reason} This is not the shape `git span merge-driver` or `git span drift --fix` \
             produce, and `resolve`'s marker-splitting is not verified safe for it. The span \
             file was not modified."
        ),
        next_steps: vec![
            NextStep::Prose(
                "If this came from Git's default text merge (the span merge driver not \
                 registered in `.gitattributes`), run the structural fix first:"
                    .into(),
            ),
            NextStep::Bash("git span drift --fix".into()),
            NextStep::Prose("Otherwise resolve this span file by hand.".into()),
        ],
    };

    let mut out = String::new();
    let mut blocks = 0usize;
    let mut open_len: Option<usize> = None;

    for line in raw.lines() {
        if let Some(len) = marker_run_len(line, '<') {
            blocks += 1;
            open_len = Some(len);
            out.push_str("<<<<<<<");
            out.push_str(&line[len..]);
            out.push('\n');
            continue;
        }
        if let Some(len) = open_len {
            if let Some(close_len) = marker_run_len(line, '>') {
                open_len = None;
                out.push_str(">>>>>>>");
                out.push_str(&line[close_len..]);
                out.push('\n');
                continue;
            }
            if let Some(base_len) = marker_run_len(line, '|') {
                out.push_str("|||||||");
                out.push_str(&line[base_len..]);
                out.push('\n');
                continue;
            }
            if let Some(sep_len) = marker_run_len(line, '=')
                && sep_len == len
                && line[sep_len..]
                    .chars()
                    .next()
                    .is_none_or(char::is_whitespace)
            {
                out.push_str("=======");
                out.push_str(&line[sep_len..]);
                out.push('\n');
                continue;
            }
            if line.trim() == "[config]" {
                return Err(refusal(format!(
                    "Span `{name}` has a `[config]` header inside a conflict block."
                )));
            }
        }
        out.push_str(line);
        out.push('\n');
    }

    if blocks > 1 {
        return Err(refusal(format!(
            "Span `{name}` has {blocks} conflict blocks; `resolve` claims at most one."
        )));
    }

    Ok(out)
}

/// Wrap a side's parse failure. Names which side failed and the underlying
/// parse error — residue has not been enumerated yet, so no anchor can be
/// named. The file is untouched either way.
fn parse_error(name: &str, side: &str, err: impl std::fmt::Display) -> CliError {
    CliError {
        subcommand: "resolve",
        summary: format!("span `{name}` could not be parsed after splitting its conflict."),
        what_happened: format!(
            "The `{side}` side of the conflict in `{name}` failed to parse: {err}. The span file \
             was not modified."
        ),
        next_steps: vec![NextStep::Prose(
            "Correct the malformed side in the span file by hand, then retry.".into(),
        )],
    }
}

// ---------------------------------------------------------------------------
// Step 4b: algorithm sanity gate
// ---------------------------------------------------------------------------

/// Refuse any anchor whose algorithm token is not `rk64`.
///
/// `split_conflict_markers` infers the anchor/why boundary from line shape, so
/// a why-prose line whose last token is `word:word` (`docs at
/// https://example.com`) parses as a fabricated anchor. `rk64` is the only
/// algorithm any writer in this codebase produces, so a mismatch is the
/// discriminating signal that the split invented a record. This is a
/// `resolve`-local restriction, not a format rule — a second legitimate
/// algorithm will need to widen it.
fn check_algorithms(ours: &SpanFile, theirs: &SpanFile, name: &str) -> std::result::Result<(), CliError> {
    for anchor in ours.anchors.iter().chain(theirs.anchors.iter()) {
        if anchor.algorithm != RK64_ALGORITHM {
            return Err(CliError {
                subcommand: "resolve",
                summary: format!("span `{name}` carries an anchor `resolve` cannot trust."),
                what_happened: format!(
                    "The line `{anchor}` declares algorithm `{}`, but `rk64` is the only \
                     algorithm git-span writes. Splitting this file's conflict markers most \
                     likely fabricated that anchor out of why prose, so `resolve` refuses \
                     rather than write a hash it invented. The span file was not modified.",
                    anchor.algorithm
                ),
                next_steps: vec![NextStep::Prose(format!(
                    "Check the conflict block in this span file: a why line whose last token \
                     looks like `<word>:<word>` is read as an anchor. Move or reword it, then \
                     retry `git span resolve {name}`."
                ))],
            });
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Steps 5–8: per-side settlement
// ---------------------------------------------------------------------------

/// Canonical `<path>` / `<path>#L<start>-L<end>` address text.
fn address(path: &str, start_line: u32, end_line: u32) -> String {
    if start_line == 0 && end_line == 0 {
        path.to_string()
    } else {
        format!("{path}#L{start_line}-L{end_line}")
    }
}

fn anchor_key(anchor: &AnchorRecord) -> (&str, u32, u32) {
    (anchor.path.as_str(), anchor.start_line, anchor.end_line)
}

/// Evaluate one side end-to-end without propagating any failure: every
/// failure becomes this side's own reported outcome. `--dry-run` needs this
/// (three independent evaluations must all complete); the single-side path
/// turns a `Failed` into the all-or-nothing `CliError`.
fn evaluate_side(
    repo: &gix::Repository,
    side: Side,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> SideOutcome {
    // Step 5: source evidence. `--ours`/`--theirs` never read a source at
    // all — routing around an unreadable source is the entire point of them.
    let source_files: Vec<(String, Vec<u8>)> = if side == Side::Rehash {
        match read_clean_source_files(repo, ours, theirs) {
            Ok(files) => files,
            Err(e) => return SideOutcome::Failed(vec![e.to_string()]),
        }
    } else {
        Vec::new()
    };

    // Steps 6 + 6b: pre-kernel checks that keep the kernel from producing a
    // hash `resolve` cannot vouch for.
    let mut failures: Vec<String> = Vec::new();
    if side == Side::Rehash {
        failures.extend(orphan_readability_failures(ours, theirs, &source_files));
        failures.extend(rehash_validity_failures(ours, theirs, &source_files));
    }

    let ours_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        ours.anchors.iter().map(|a| (anchor_key(a), a)).collect();
    let theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        theirs.anchors.iter().map(|a| (anchor_key(a), a)).collect();

    // Step 7: kernel merge.
    let result = merge_span_files(None, ours, theirs, &source_files);
    let anchor_residue: Vec<&UnresolvedAnchor> = result
        .unresolved
        .iter()
        .filter(|u| !u.path.is_empty())
        .collect();

    // Step 8: why/config, computed independently of the kernel's collapsed
    // synthetic marker so each divergence is reported for what it is.
    let (why, why_diverged) = resolve_why_text(None, ours, theirs);
    let (config, config_diverged) = resolve_config(None, ours, theirs);

    let mut merged = result.merged.clone();

    match side {
        Side::Rehash => {
            for u in &anchor_residue {
                failures.push(format!(
                    "{}: divergent hash with no clean source to re-hash from (ours {}:{}, \
                     theirs {}:{})",
                    address(&u.path, u.start_line, u.end_line),
                    u.ours.algorithm,
                    u.ours.content_hash,
                    u.theirs.algorithm,
                    u.theirs.content_hash
                ));
            }
            if why_diverged {
                failures.push(
                    "`--why` text diverged between ours and theirs, and the worktree has \
                     nothing to say about prose"
                        .to_string(),
                );
            }
            if config_diverged {
                failures.push("`[config]` diverged between ours and theirs".to_string());
            }
            if !failures.is_empty() {
                return SideOutcome::Failed(failures);
            }
        }
        Side::Ours | Side::Theirs => {
            // Every anchor-residue entry carries both records, so this side
            // always resolves. Orphans are untouched: they arrive through the
            // kernel's union branch, never through `unresolved`.
            for u in &anchor_residue {
                merged.anchors.push(if side == Side::Ours {
                    u.ours.clone()
                } else {
                    u.theirs.clone()
                });
            }
        }
    }

    // The side override fires only on real divergence: an uncontested value
    // three-way resolution already settled is never overwritten.
    let chosen_why = if why_diverged {
        match side {
            Side::Ours => ours.why.clone(),
            Side::Theirs => theirs.why.clone(),
            Side::Rehash => why.clone(),
        }
    } else {
        why.clone()
    };
    let chosen_config = if config_diverged {
        match side {
            Side::Ours => ours.config,
            Side::Theirs => theirs.config,
            Side::Rehash => config,
        }
    } else {
        config
    };
    merged.why = chosen_why;
    merged.config = chosen_config;

    // Step 9: canonical order — step 7's manually pushed entries are not
    // necessarily sorted.
    merged.anchors.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.start_line.cmp(&b.start_line))
            .then(a.end_line.cmp(&b.end_line))
    });

    let entries = build_entries(side, &merged, &ours_map, &theirs_map);
    let why_label = field_label(side, why_diverged, &ours.why, &theirs.why, &merged.why);
    let config_label = field_label_config(side, config_diverged, ours, theirs, &merged);

    let mut warnings = Vec::new();
    if merged.config == SpanConfig::default() {
        warnings.push(CONFIG_LOSS_LINE.to_string());
    }
    if merged.why.trim().is_empty() {
        warnings.push(WHY_LOSS_LINE.to_string());
    }

    SideOutcome::Resolved(Box::new(Settlement {
        merged,
        entries,
        why_label,
        config_label,
        warnings,
        structural_only: result.unresolved.is_empty(),
    }))
}

/// Step 6: an orphan anchor (key present on exactly one side) whose source is
/// absent from the readable set would be silently cloned with its stale hash
/// by the kernel. Under `--rehash` that is a hash `resolve` cannot vouch for,
/// so it joins the all-or-nothing failure list instead.
fn orphan_readability_failures(
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> Vec<String> {
    let readable: HashSet<&str> = source_files.iter().map(|(p, _)| p.as_str()).collect();
    let ours_keys: HashSet<(&str, u32, u32)> = ours.anchors.iter().map(anchor_key).collect();
    let theirs_keys: HashSet<(&str, u32, u32)> = theirs.anchors.iter().map(anchor_key).collect();

    let mut failures = Vec::new();
    for (side_name, own, other_keys) in [
        ("ours", &ours.anchors, &theirs_keys),
        ("theirs", &theirs.anchors, &ours_keys),
    ] {
        for anchor in own {
            if !other_keys.contains(&anchor_key(anchor)) && !readable.contains(anchor.path.as_str())
            {
                failures.push(format!(
                    "{}: orphan anchor referenced only by {side_name}; source unreadable, \
                     cannot verify under --rehash",
                    address(&anchor.path, anchor.start_line, anchor.end_line)
                ));
            }
        }
    }
    failures.sort();
    failures
}

/// Step 6's sibling: a source that reads cleanly but no longer covers the
/// range an anchor declares. `cheap_fingerprint_with_extent` maps a past-EOF
/// range to `0` and silently clamps a partial overrun, and `drift` would then
/// confirm the result clean — so the anchor never reaches the kernel.
fn rehash_validity_failures(
    ours: &SpanFile,
    theirs: &SpanFile,
    source_files: &[(String, Vec<u8>)],
) -> Vec<String> {
    let ours_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        ours.anchors.iter().map(|a| (anchor_key(a), a)).collect();
    let theirs_map: HashMap<(&str, u32, u32), &AnchorRecord> =
        theirs.anchors.iter().map(|a| (anchor_key(a), a)).collect();

    let mut failures = Vec::new();
    let keys: BTreeSet<(&str, u32, u32)> = ours_map.keys().chain(theirs_map.keys()).copied().collect();
    for key in keys {
        let (path, start_line, end_line) = key;
        // Whole-file anchors declare no range to overrun.
        if start_line == 0 && end_line == 0 {
            continue;
        }
        // An anchor identical on both sides is cloned, never re-hashed.
        if let (Some(o), Some(t)) = (ours_map.get(&key), theirs_map.get(&key))
            && o.algorithm == t.algorithm
            && o.content_hash == t.content_hash
        {
            continue;
        }
        // An absent source is step 6's business, not this check's.
        let Some((_, bytes)) = source_files.iter().find(|(p, _)| p == path) else {
            continue;
        };
        let line_count = String::from_utf8_lossy(bytes).lines().count() as u32;
        if start_line == 0 || end_line > line_count {
            failures.push(format!(
                "{}: source has only {line_count} lines, cannot verify this anchor's range \
                 under --rehash",
                address(path, start_line, end_line)
            ));
        }
    }
    failures
}

/// Step 11's per-anchor lines.
fn build_entries(
    side: Side,
    merged: &SpanFile,
    ours_map: &HashMap<(&str, u32, u32), &AnchorRecord>,
    theirs_map: &HashMap<(&str, u32, u32), &AnchorRecord>,
) -> Vec<ReportEntry> {
    merged
        .anchors
        .iter()
        .map(|a| {
            let key = anchor_key(a);
            let outcome = match (ours_map.get(&key), theirs_map.get(&key)) {
                (Some(o), Some(t)) => {
                    if o.algorithm == t.algorithm && o.content_hash == t.content_hash {
                        "unchanged".to_string()
                    } else {
                        match side {
                            Side::Rehash => {
                                if a.content_hash == o.content_hash {
                                    "re-hashed from the worktree (matches ours)".to_string()
                                } else if a.content_hash == t.content_hash {
                                    "re-hashed from the worktree (matches theirs)".to_string()
                                } else {
                                    "re-hashed from the worktree (differs from both sides)"
                                        .to_string()
                                }
                            }
                            _ => format!("kept {}", side.name()),
                        }
                    }
                }
                (Some(_), None) => "kept — only present in ours, not itself residue".to_string(),
                (None, Some(_)) => "kept — only present in theirs, not itself residue".to_string(),
                (None, None) => "resolved".to_string(),
            };
            ReportEntry {
                address: address(&a.path, a.start_line, a.end_line),
                outcome,
            }
        })
        .collect()
}

/// The three-state `why` label: an explicit side choice that fired, a
/// three-way answer taken without operator input, or trivial agreement.
fn field_label(side: Side, diverged: bool, ours: &str, theirs: &str, merged: &str) -> String {
    if diverged && side != Side::Rehash {
        format!("kept {}", side.name())
    } else if ours != theirs {
        let which = if merged == ours { "ours" } else { "theirs" };
        format!("resolved automatically (matches {which})")
    } else {
        "unchanged".to_string()
    }
}

/// [`field_label`] for `[config]`, which compares by value rather than text.
fn field_label_config(
    side: Side,
    diverged: bool,
    ours: &SpanFile,
    theirs: &SpanFile,
    merged: &SpanFile,
) -> String {
    if diverged && side != Side::Rehash {
        format!("kept {}", side.name())
    } else if ours.config != theirs.config {
        let which = if merged.config == ours.config {
            "ours"
        } else {
            "theirs"
        };
        format!("resolved automatically (matches {which})")
    } else {
        "unchanged".to_string()
    }
}

// ---------------------------------------------------------------------------
// Step 7's failure branch and step 11's report
// ---------------------------------------------------------------------------

/// The all-or-nothing failure: nothing was written, so retrying with another
/// side is always safe — and the remediation says which ones.
fn failure_error(name: &str, side: Side, reasons: &[String]) -> CliError {
    let listed = reasons
        .iter()
        .map(|r| format!("- {r}"))
        .collect::<Vec<_>>()
        .join("\n");
    CliError {
        subcommand: "resolve",
        summary: format!(
            "span `{name}` has residue `{}` cannot settle.",
            side.flag()
        ),
        what_happened: format!(
            "Nothing was written — the span file is byte-identical to what it was before this \
             run. These entries stopped it:\n\n{listed}"
        ),
        next_steps: vec![
            NextStep::Prose(
                "Take a side explicitly. Both leave every other anchor exactly as the merge \
                 produced it:"
                    .into(),
            ),
            NextStep::Bash(format!(
                "git span resolve {name} --ours\ngit span resolve {name} --theirs"
            )),
            NextStep::Prose(format!(
                "Or compare all three outcomes first with `git span resolve {name} --dry-run`."
            )),
        ],
    }
}

/// The report body shared by the human write report and the dry-run fan-out.
fn settlement_lines(settlement: &Settlement) -> Vec<String> {
    let mut lines: Vec<String> = settlement
        .entries
        .iter()
        .map(|e| format!("{}: {}", e.address, e.outcome))
        .collect();
    if settlement.structural_only {
        lines.push(
            "resolved structurally — no residue required the requested side".to_string(),
        );
    }
    lines.push(format!("why: {}", settlement.why_label));
    lines.push(format!("config: {}", settlement.config_label));
    lines.extend(settlement.warnings.iter().cloned());
    lines
}

fn print_human(name: &str, side: Side, settlement: &Settlement) {
    println!("resolved `{name}` with {}", side.flag());
    for line in settlement_lines(settlement) {
        println!("  {line}");
    }
    println!(
        "  `{name}` was written to the worktree and not staged; review it with `git diff`."
    );
}

fn print_json(name: &str, side: Side, settlement: &Settlement) -> Result<()> {
    let doc = ResolveDocument {
        schema_version: RESOLVE_JSON_SCHEMA_VERSION,
        command: "resolve",
        span: name.to_string(),
        side: side.name(),
        dry_run: false,
        written: true,
        entries: settlement.entries.clone(),
        why: settlement.why_label.clone(),
        config: settlement.config_label.clone(),
        warnings: settlement.warnings.clone(),
    };
    println!("{}", serde_json::to_string_pretty(&doc)?);
    Ok(())
}

// ---------------------------------------------------------------------------
// Function-level settlement tests (CLI-unreachable shapes)
// ---------------------------------------------------------------------------

/// Settle two hand-built `SpanFile`s under one side, exposed for tests that
/// exercise shapes the CLI layer cannot construct — a `[config]` divergence
/// most of all, which the driver-shape refusal makes textually unreachable.
///
/// Returns `Ok((merged, why_label, config_label))` or `Err(failure reasons)`.
#[doc(hidden)]
pub fn settle_for_test(
    repo: &gix::Repository,
    side_name: &str,
    ours: &SpanFile,
    theirs: &SpanFile,
) -> std::result::Result<(SpanFile, String, String), Vec<String>> {
    let side = match side_name {
        "ours" => Side::Ours,
        "theirs" => Side::Theirs,
        _ => Side::Rehash,
    };
    match evaluate_side(repo, side, ours, theirs) {
        SideOutcome::Resolved(s) => Ok((s.merged.clone(), s.why_label.clone(), s.config_label.clone())),
        SideOutcome::Failed(reasons) => Err(reasons),
    }
}
