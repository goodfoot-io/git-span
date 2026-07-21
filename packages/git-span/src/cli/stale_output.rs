//! `git span stale` output rendering — §10.4.
//!
//! Slice 8 of the layered-stale rewrite (see
//! `docs/stale-layers-plan.md` §"Renderers"). Renderers consume
//! `Finding` end-to-end via a thin adapter that maps the engine's
//! `AnchorResolved` into the plan's "Key types" shape.

use crate::cli::stale_fix::FixResult;
use crate::cli::{CliError, NextStep, StaleArgs, StaleFormat};
use crate::resolver::{
    SourceLayers, WholeResult, span_is_reportable_in_stale_discovery,
    resolve_named_spans, resolve_named_spans_retaining_source_layers,
    resolve_named_spans_with_source_layers, sort_spans_by_anchor_path, stale_spans,
    stale_spans_retaining_source_layers, stale_spans_with_trace,
};
use std::collections::HashMap;
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorStatus, DriftLocus, DriftSource, EngineOptions, Finding,
    LayerSet, SpanResolved, UnavailableReason,
};
use crate::validation::validate_span_name_shape;
use anyhow::Result;
use serde_json::{Value, json};
use std::collections::HashSet;

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn write_perf_trace_csv(
    file: std::fs::File,
    path: &std::path::Path,
    rows: &[crate::perf::TraceRow],
) -> Result<()> {
    use std::io::Write as _;
    let mut w = std::io::BufWriter::new(file);
    let write_err = |e: std::io::Error| -> anyhow::Error {
        CliError {
            subcommand: "stale",
            summary: format!("failed to write perf trace to '{}'", path.display()),
            what_happened: e.to_string(),
            next_steps: vec![NextStep::Prose("Check that the path is writable.".into())],
        }
        .into()
    };
    w.write_all(b"span,anchor_id,anchor_sha,path,wall_us,fast_path,status\n")
        .map_err(&write_err)?;
    for r in rows {
        let mut line = String::new();
        line.push_str(&csv_escape(&r.span));
        line.push(',');
        line.push_str(&csv_escape(&r.anchor_id));
        line.push(',');
        line.push_str(&csv_escape(&r.anchor_sha));
        line.push(',');
        line.push_str(&csv_escape(&r.path));
        line.push(',');
        line.push_str(&r.wall_us.to_string());
        line.push(',');
        line.push_str(if r.fast_path { "true" } else { "false" });
        line.push(',');
        line.push_str(r.status);
        line.push('\n');
        w.write_all(line.as_bytes()).map_err(&write_err)?;
    }
    w.flush().map_err(write_err)
}

fn open_perf_trace_file(path: &std::path::Path) -> Result<std::fs::File> {
    std::fs::File::create(path).map_err(|e| {
        CliError {
            subcommand: "stale",
            summary: format!("failed to write perf trace to '{}'", path.display()),
            what_happened: e.to_string(),
            next_steps: vec![NextStep::Prose("Check that the path is writable.".into())],
        }
        .into()
    })
}

pub fn run_stale(repo: &gix::Repository, args: StaleArgs, span_root: &str) -> Result<i32> {
    // Reset the `--fix` phase counters once per invocation. The pre- and
    // post-fix resolve passes both feed these process-global counters, so they
    // are reset here (not inside the resolver, which resets per resolve session)
    // and read back in the `fix.*` emit block at the end of `run_stale`.
    crate::perf::reset_fix_counters();

    // `--fix` is only meaningful with the Human renderer (post-rewrite
    // view); machine formats stream drifted findings only.
    if args.fix && !matches!(args.format, StaleFormat::Human) {
        return Err(CliError {
            subcommand: "stale",
            summary: "`--fix` is only supported with `--format human`.".into(),
            what_happened: "Non-human formats stream drifted findings only and have no \
                            post-rewrite view."
                .into(),
            next_steps: vec![NextStep::Bash("git span stale --fix".into())],
        }
        .into());
    }
    // Always scan the full working-tree view (HEAD + Index + Worktree).
    let layers = LayerSet::full();
    let show_src_column = true;
    // Only the human renderer needs per-layer detail; machine formats
    // can short-circuit once HEAD says "stale".
    let needs_all_layers = matches!(args.format, StaleFormat::Human);
    let options = EngineOptions {
        layers,
        ignore_unavailable: false,
        since: None,
        needs_all_layers,
        fuzzy_threshold: 0.95,
    };

    // --perf-trace conflicts with positional paths (requires a full scan).
    if args.perf_trace.is_some() && !args.paths.is_empty() {
        return Err(CliError {
            subcommand: "stale",
            summary: "--perf-trace requires a full scan; remove positional paths".into(),
            what_happened: "--perf-trace captures per-anchor timing across all spans and cannot \
                            be combined with a subset selection via positional paths."
                .into(),
            next_steps: vec![NextStep::Bash("git span stale --perf-trace <path>".into())],
        }
        .into());
    }

    // For a scoped query (positional args), the "0 stale" summary reports the
    // spans/anchors actually in scope, not the full committed corpus. Captured
    // just before clean spans are filtered out of the resolved set.
    let mut scoped_totals: Option<(usize, usize)> = None;

    // When positional args are present, this holds the resolved span names
    // (after path→span resolution) so that downstream scoping — conflict
    // detection, interior-anchor filtering — can test membership without
    // re-running resolution or comparing args literally against span names.
    // None means "no scope restriction" (bare `git span stale`).
    let mut scoped_span_names: Option<HashSet<String>> = None;

    // Cold-path source-layer state retained by the pre-fix resolve so the
    // post-fix re-resolve (`--fix`) can skip a second `read-worktree-layer`.
    // `None` on a warm cache_v2 hit (no `EngineState` to retain) or when not
    // running `--fix`.
    let mut pre_fix_source_layers: Option<SourceLayers> = None;

    // Whole-result cache: on a warm-clean hit the cache returns the full
    // backfilled anchor set + anchor totals, allowing run_stale to skip its
    // per-invocation phases (count-totals, detect-conflicts, backfill).
    let mut whole_result: Option<WholeResult> = None;

    // Single PRE-mutation corpus parse: load the `.span/` corpus (loaded
    // spans + conflicted names) once and thread it through every consumer
    // that observes the *pre-fix* `.span/` state — the scoped path-index
    // build, scoped anchor totals, count-totals, conflict detection, the
    // `--fix` interior-anchor pre-scan, and the `--fix` `fix_input` supplement.
    // All read the same worktree-effective source, so reloading per-site was
    // pure fuse I/O overhead. `load_all_spans_in` already returns the
    // conflicted set alongside the loaded spans, so the dedicated
    // `conflicted_span_names_in` discovery scan is subsumed here too.
    //
    // This corpus is loaded lazily by `pre_fix_corpus` below and reused; it
    // must NEVER be reused after `apply_fix` mutates `.span/` — the post-fix
    // backfill and interior scan load their own fresh corpus (see the post-fix
    // region). On the plain (non-`--fix`) path no mutation occurs, so the same
    // pre-fix corpus also serves the backfill and interior-scan sites.
    let mut pre_fix_corpus: Option<crate::span::read::LoadedSpans> = None;

    // PRE-fix resolve timer: only the `--fix` path attributes this pass, so the
    // start instant is taken (under perf) only when `args.fix`. The elapsed is
    // recorded into `fix.pre-resolve-us` just after the resolve block.
    let pre_resolve_start =
        (args.fix && crate::perf::enabled()).then(std::time::Instant::now);

    let mut spans = if args.paths.is_empty() {
        // No positional args: scan every span. Pending-only spans are NOT
        // included — workspace scans answer "what's stale?" only.
        let _perf = crate::perf::span("stale.resolve-all-spans");
        if let Some(trace_path) = &args.perf_trace {
            // Open the file before running the resolver so a bad path fails
            // in milliseconds rather than after a full scan.
            let trace_file = open_perf_trace_file(trace_path)?;
            let (resolved, trace_rows) = stale_spans_with_trace(repo, span_root, options)?;
            write_perf_trace_csv(trace_file, trace_path, &trace_rows)?;
            resolved
        } else if args.fix {
            // Retain source layers for the post-fix re-resolve. `--fix` is
            // incompatible with `--perf-trace` discovery above.
            let (resolved, layers, wr) =
                stale_spans_retaining_source_layers(repo, span_root, options)?;
            pre_fix_source_layers = layers;
            whole_result = wr;
            resolved
        } else {
            let (resolved, _, wr) =
                stale_spans_retaining_source_layers(repo, span_root, options)?;
            whole_result = wr;
            resolved
        }
    } else {
        // Resolve each positional arg through span-name → path-index dispatch.
        let _perf = crate::perf::span("stale.resolve-args");
        let mut span_names: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut missing_files: Vec<String> = Vec::new();

        let reader = crate::span_file_reader::SpanFileReader::new(repo, span_root.to_string());

        // Load the corpus once and build the path index from it. The previous
        // code called `SpanPathIndex::load_in` here (which loads and discards
        // the corpus internally), then reloaded for scoped anchor totals and
        // again for count-totals — three parses of the same worktree-effective
        // source. Now: one load, many consumers.
        //
        // The corpus is stored in `pre_fix_corpus` so the scoped-anchor-totals,
        // count-totals, conflict-detection, and `--fix` interior/fix_input
        // sites below all reuse it instead of reloading.
        let corpus = crate::span::read::load_all_spans_in(repo, span_root)?;
        let path_index =
            crate::span::read::SpanPathIndex::from_loaded_spans(&corpus.0)?;
        pre_fix_corpus = Some(corpus);

        for arg in &args.paths {
            let mut found = false;

            // Step 1: try span name first when arg matches span-name shape.
            if validate_span_name_shape(arg).is_ok() {
                let is_committed = reader.read_effective(arg)?.is_some();
                if is_committed {
                    if seen.insert(arg.clone()) {
                        span_names.push(arg.clone());
                    }
                    found = true;
                } else {
                    // Not a committed span; check for staging-only span before
                    // falling through to path-index lookup. Matches the original
                    // single-span path's SpanNotFound → staging check.
                }
            }

            // Step 2: fall back to path index (glob-aware). Resolved against
            // the pre-built `path_index` so this stays O(spans + args)
            // instead of reloading the corpus per arg.
            if !found {
                let names = if crate::span::read::is_glob_pattern(arg) {
                    path_index.matching_names_glob(arg, None).unwrap_or_default()
                } else {
                    path_index.matching_names(arg, None)
                };
                for name in names {
                    if seen.insert(name.clone()) {
                        span_names.push(name);
                    }
                    found = true;
                }
            }

            // Step 3: arg matched neither a span nor any path-index entry. If
            // it names an existing file in the worktree, silently skip — no
            // span tracks it, so there is nothing for stale to scan and that
            // is not an error. If the file doesn't exist, surface it.
            if !found {
                let exists = repo
                    .workdir()
                    .map(|w| w.join(arg).exists())
                    .unwrap_or(false);
                if !exists {
                    missing_files.push(arg.clone());
                }
            }
        }

        // Step 4: any arg that named a non-existent file → CliError.
        if !missing_files.is_empty() {
            let all = missing_files.join("`, `");
            let summary = if missing_files.len() == 1 {
                format!("`{all}` is not tracked.")
            } else {
                format!("`{all}` are not tracked.")
            };
            return Err(CliError {
                subcommand: "stale",
                summary,
                what_happened: format!(
                    "The following files were requested but do not exist in the working tree: `{all}`. \
                     Git-span resolves positional arguments as span names, file paths, or globs."
                ),
                next_steps: vec![
                    NextStep::Prose("Check the file paths for typos.".into()),
                    NextStep::Bash("git span list".into()),
                ],
            }
            .into());
        }

        // Step 5: resolve candidate span names through one shared EngineState.
        let resolved = {
            let _perf = crate::perf::span("stale.resolve-named-spans");
            if args.fix {
                // Retain source layers for the post-fix re-resolve. The
                // named-scope pre-fix pass always builds an `EngineState`
                // (no cache_v2), so it always yields `SourceLayers`.
                let (resolved, layers) = resolve_named_spans_retaining_source_layers(
                    repo, span_root, &span_names, options,
                )?;
                pre_fix_source_layers = Some(layers);
                resolved
            } else {
                resolve_named_spans(repo, span_root, &span_names, options)?
            }
        };
        let mut spans: Vec<SpanResolved> = Vec::with_capacity(resolved.len());
        for (_name, result) in resolved {
            match result {
                Ok(span) => spans.push(span),
                Err(crate::Error::SpanNotFound(_)) => {}
                Err(e) => return Err(e.into()),
            }
        }

        // Every scoped query is a drift report: clean spans are filtered
        // out across all formats, whether they were resolved by path/glob or
        // named explicitly. A scope merely selects which spans to check — if
        // none of a span's anchors drifted, it is clean and must not surface,
        // in Human or in JSON/porcelain (where
        // `render_json` names `spans.first()`). A clean scope prints the
        // "0 stale" summary instead (see the no-drift block below).
        // Conflict-injected spans are added after this block and carry a
        // `MergeConflict` anchor, so they are unaffected.
        // `m.anchors` may hold only the stale subset (the cache_v2 resolver
        // persists non-Fresh rows only), so derive the true anchor total from
        // the span-file records. For scoped queries (positional args), the
        // cache path is not used, so load totals fresh.
        // `pre_fix_corpus` was loaded above (at the path-index build site) and
        // is still live here; reuse it rather than reloading the corpus a
        // second time for this scoped query.
        let scoped_anchor_totals: std::collections::HashMap<String, usize> =
            pre_fix_corpus
                .as_ref()
                .expect("pre_fix_corpus must be set before scoped_anchor_totals")
                .0
                .iter()
                .map(|(n, m)| (n.clone(), m.anchors.len()))
                .collect();
        scoped_totals = Some((
            spans.len(),
            spans
                .iter()
                .map(|m| scoped_anchor_totals.get(&m.name).copied().unwrap_or(m.anchors.len()))
                .sum(),
        ));
        // Capture the resolved span-name set for downstream scoping (conflict
        // detection, interior-anchor filtering). Built from `span_names` which
        // already contains the result of path→span resolution, so a path-form
        // arg like `src/lib.rs` contributes the span(es) that anchor it.
        scoped_span_names = Some(span_names.iter().cloned().collect());
        spans.retain(|m| {
            m.anchors.iter().any(|a| a.status != AnchorStatus::Fresh)
        });

        spans
    };

    // Record the PRE-fix resolve wall-clock (see `pre_resolve_start`). The
    // post-fix re-resolve is attributed separately inside the `--fix` block.
    if let Some(start) = pre_resolve_start {
        crate::perf::record_fix_pre_resolve_ns(start.elapsed().as_nanos() as u64);
    }

    // ── Count totals (moved after resolution so whole_result can short-circuit) ──
    //
    // Whole-result warm-clean short-circuit: when the cache returns a
    // whole result, skip count-totals (load_all_spans_in), conflict
    // detection, interior-anchor scan, and backfill — the cached data
    // carries the already-computed results.
    let use_whole_result = whole_result.is_some();

    let (total_committed_span_count, total_committed_anchor_count, span_anchor_totals): (
        usize,
        usize,
        std::collections::HashMap<String, usize>,
    ) = if let Some(ref wr) = whole_result {
        let totals: std::collections::HashMap<String, usize> = wr
            .span_anchor_totals
            .iter()
            .cloned()
            .collect();
        let span_count = totals.len();
        let anchor_count: usize = totals.values().sum();
        crate::perf::counter("cache-path.whole-result-hit", 1);
        (span_count, anchor_count, totals)
    } else {
        let _perf = crate::perf::span("stale.count-totals");
        // On the scoped path `pre_fix_corpus` was already loaded; on the
        // non-scoped path load it once here. Either way it stays live so the
        // conflict-detection (and, on the plain path, the backfill /
        // interior-scan) sites below reuse it instead of reloading.
        if pre_fix_corpus.is_none() {
            pre_fix_corpus = Some(crate::span::read::load_all_spans_in(repo, span_root)?);
        }
        let pairs = &pre_fix_corpus
            .as_ref()
            .expect("pre_fix_corpus set immediately above")
            .0;
        let span_count = pairs.len();
        let anchor_count = pairs.iter().map(|(_, m)| m.anchors.len()).sum();
        let totals = pairs
            .iter()
            .map(|(n, m)| (n.clone(), m.anchors.len()))
            .collect();
        (span_count, anchor_count, totals)
    };

    // Fail-closed Conflict reporting: a span whose file (or anchored
    // source) is in a Git conflict state cannot be read reliably. Such
    // spans are skipped by the normal resolution batch; surface each
    // one here as a `Conflict` finding so it renders and forces a
    // non-zero exit (an unreliable read must never report "clean").
    // Skipped on whole-result hit — a clean tree has no conflicts.
    if !use_whole_result {
        let _perf = crate::perf::span("stale.detect-conflicts");
        // The conflicted-span set is byte-identical to a dedicated
        // `conflicted_span_names_in` scan: `load_all_spans_in` discovers the
        // same `list_span_names()` set, sorts it, and reassembles the
        // conflicted names in that sorted order (parallel and serial paths
        // both preserve it) — the exact contract `conflicted_span_names_in`
        // upholds. Reuse the conflicted list captured by the single pre-fix
        // corpus load instead of re-discovering + re-reading every span.
        let conflicted: Vec<String> = pre_fix_corpus
            .as_ref()
            .expect("pre_fix_corpus set before detect-conflicts when !use_whole_result")
            .1
            .clone();
        // When positional args were given, only report conflicts for the
        // requested scope (a named span or a path/glob that resolves to
        // one); a full scan reports every conflicted span.
        let in_scope = |name: &str| -> bool {
            match &scoped_span_names {
                None => true,
                Some(names) => names.contains(name),
            }
        };
        let span_root_owned = span_root.to_string();
        for name in conflicted {
            if !in_scope(&name) {
                continue;
            }
            if spans.iter().any(|m| m.name == name) {
                continue;
            }
            let span_file_path = std::path::PathBuf::from(format!("{span_root_owned}/{name}"));
            spans.push(SpanResolved {
                name: name.clone(),
                why: String::new(),
                anchors: vec![crate::types::AnchorResolved {
                    anchor_id: name.clone(),
                    anchor_sha: String::new(),
                    anchored: AnchorLocation {
                        path: span_file_path.clone(),
                        extent: AnchorExtent::WholeFile,
                        blob: None,
                    },
                    current: None,
                    status: AnchorStatus::MergeConflict,
                    content_equivalent: false,
                    source: None,
                    layer_sources: vec![],
                    locus: None,
                    fuzzy_successors: vec![],
                }],
                follow_moves: false,
            });
        }
    }

    // Sort all collected spans (including staging-only spans with empty
    // anchors) by anchor path for deterministic output regardless of whether
    // they came from a full scan, positional args, or staging-only discovery.
    sort_spans_by_anchor_path(&mut spans);

    // `--fix`: re-anchor drifted Moved records (unconditional) and
    // whitespace-equivalent Changed records in the span worktree files, then
    // re-resolve so the rendered post-fix view reflects the new statuses.
    // The set of anchor ids actually rewritten drives the "auto-updated" tag
    // and the exit-code subtraction.
    let fix_result: Option<FixResult> = if args.fix {
        let _perf = crate::perf::span("stale.apply-fix");
        // Ensure the single PRE-fix corpus is loaded for the `--fix` consumers
        // (interior pre-scan + `fix_input` supplement). It is already `Some` on
        // the `!use_whole_result` path (count-totals loaded it), but on a warm
        // whole-result hit count-totals short-circuited without loading, so
        // load it here. Still pre-`apply_fix`, so the state is correct.
        if pre_fix_corpus.is_none() {
            pre_fix_corpus = Some(crate::span::read::load_all_spans_in(repo, span_root)?);
        }
        // Fail-closed interior-anchor gate, evaluated on the PRE-fix corpus
        // (before `apply_fix` mutates span files — the fix can excise the
        // interior anchor line, which would hide it from a post-fix scan). The
        // scoped post-fix splice and cold-path source-layer reuse are only
        // sound when no anchor path is under `span_root`. `SpanFile::parse`
        // deliberately accepts interior anchors (so poisoned spans stay
        // loadable for repair), so a span file can also be an anchor target.
        // With an interior anchor present in the pre-fix corpus:
        //   - a non-rewritten span whose interior anchor targets a rewritten
        //     span file is never re-resolved by the splice, so its drift status
        //     renders stale; and
        //   - a rewritten span re-resolved via reused `worktree_diffs` resolves
        //     its interior anchor against stale (pre-fix) span-file content.
        // In that case fall back to the baseline full re-resolve (a freshly
        // built `EngineState`, no source-layer reuse, no scoped splice), which
        // is byte-identical to the pre-optimization output. Interior anchors
        // are a loud, rare error condition, so the perf hit is irrelevant.
        let has_interior_anchor = {
            let _perf = crate::perf::span("stale.scan-interior-anchors");
            // Reuse the single pre-fix corpus load (still pre-`apply_fix`, so
            // the interior-anchor classification reflects the pre-fix span
            // files exactly as a fresh load would). `pre_fix_corpus` was
            // ensured `Some` at the top of this `--fix` block.
            crate::cli::interior_anchor::scope_has_interior_anchor_in(
                span_root,
                &pre_fix_corpus
                    .as_ref()
                    .expect("pre_fix_corpus set before --fix interior pre-scan")
                    .0,
                scoped_span_names.as_ref(),
            )
        };
        // `apply_fix`'s range coalescing is workspace-total: it collapses
        // contiguous/overlapping fresh ranges on a path regardless of
        // drift. A scan's resolved `spans` omits fully-Fresh spans (the
        // resolver drops them), so feed apply_fix a complete set —
        // supplement the dropped spans as all-Fresh `SpanResolved`
        // synthesized from their span-file record. This affects apply_fix
        // input only; the rendered view comes from the re-resolve below.
        let fix_input: Vec<SpanResolved> = if args.paths.is_empty() {
            let mut full = spans.clone();
            let known: HashSet<String> = full.iter().map(|m| m.name.clone()).collect();
            // Reuse the single pre-fix corpus load. This is the LAST pre-fix
            // consumer (the next thing to touch `.span/` is `apply_fix`, which
            // mutates it), so `take` it: the post-fix backfill / interior scan
            // must NOT reuse pre-fix state and load their own fresh corpus.
            let corpus = pre_fix_corpus
                .take()
                .expect("pre_fix_corpus set before --fix fix_input supplement")
                .0;
            for (name, span) in corpus {
                if known.contains(&name) {
                    continue;
                }
                let anchors = span
                    .anchors
                    .iter()
                    .map(|(anchor_id, a)| fresh_anchor_resolved(anchor_id, a))
                    .collect();
                full.push(SpanResolved {
                    name,
                    why: span.why,
                    anchors,
                    follow_moves: span.config.follow_moves,
                });
            }
            full
        } else {
            // A named scope already carries each span's full anchor set.
            spans.clone()
        };
        // Source-layer reuse on the warm cache path. The pre-fix resolve only
        // retains `SourceLayers` on the cold (`stale_spans_inner`) path; on a
        // warm cache_v2 hit (the common case) `pre_fix_source_layers` is None,
        // so the post-fix splice would rebuild the worktree/index `git status`
        // source scan from scratch. Build it ONCE here — before `apply_fix`
        // mutates `.span/`, so the scan reflects the pre-fix worktree exactly
        // as the cold-path reuse does — and thread it into the post-fix
        // re-resolve. Skipped when an interior anchor is present (the baseline
        // full re-resolve below must not reuse layers — see the gate above) and
        // when the pre-fix already retained layers (cold path; reuse those).
        //
        // Byte-identical: `from_source_layers` reconstructs the same
        // `EngineState` fields a fresh `EngineState::new` would, and the
        // pre-`apply_fix` worktree status is correct for every post-fix anchor
        // (no anchor path is under `span_root`, gated above) — the same
        // soundness argument the cold-path reuse already relies on.
        if pre_fix_source_layers.is_none() && !has_interior_anchor {
            let _perf = crate::perf::span("stale.fix-build-source-layers");
            pre_fix_source_layers = Some(crate::resolver::build_source_layers(repo, options)?);
        }
        let apply_start = crate::perf::enabled().then(std::time::Instant::now);
        let fr = super::stale_fix::apply_fix(repo, &fix_input, span_root, options.fuzzy_threshold)?;
        if let Some(start) = apply_start {
            crate::perf::record_fix_apply_ns(start.elapsed().as_nanos() as u64);
        }
        let post_resolve_start = crate::perf::enabled().then(std::time::Instant::now);
        if has_interior_anchor {
            // Baseline path: full re-resolve with no splice / no source-layer
            // reuse. Drop the retained source layers (their subprocess handles
            // are released here).
            drop(pre_fix_source_layers.take());
            if args.paths.is_empty() {
                spans = stale_spans(repo, span_root, options)?;
            } else {
                let names: Vec<String> = spans.iter().map(|m| m.name.clone()).collect();
                let resolved = resolve_named_spans(repo, span_root, &names, options)?;
                let mut new_spans: Vec<SpanResolved> = Vec::with_capacity(resolved.len());
                for (_n, result) in resolved {
                    if let Ok(span) = result {
                        new_spans.push(span);
                    }
                }
                spans = new_spans;
            }
        } else if args.paths.is_empty() {
            // Re-resolve only the spans that apply_fix actually rewrote, then
            // splice the results back into the pre-fix set. This avoids a
            // whole-corpus re-resolve for spans the fix never touched.
            spans = splice_bare_scan_post_fix(
                repo,
                span_root,
                options,
                spans,
                &fr.rewritten_span_names,
                pre_fix_source_layers.take(),
            )?;
        } else {
            spans = splice_named_scope_post_fix(
                repo,
                span_root,
                options,
                spans,
                &fr.rewritten_span_names,
                pre_fix_source_layers.take(),
            )?;
        }
        sort_spans_by_anchor_path(&mut spans);
        if let Some(start) = post_resolve_start {
            crate::perf::record_fix_post_resolve_ns(start.elapsed().as_nanos() as u64);
        }
        crate::perf::record_fix_spans_rewritten_count(fr.rewritten_span_names.len() as u64);
        Some(fr)
    } else {
        None
    };
    let followed_ids: HashSet<String> = fix_result.as_ref().map_or(HashSet::new(), |fr| fr.rewritten_anchor_ids.clone());

    // POST-region corpus: the corpus state observed by the backfill and the
    // interior-anchor scan below. On the plain (non-`--fix`) path no mutation
    // happened since the pre-fix load, so reuse `pre_fix_corpus` (still live;
    // it is only `take`n inside the `--fix` bare-scan branch). On the `--fix`
    // path `apply_fix` rewrote `.span/`, so the pre-fix corpus is stale — load
    // a single FRESH post-fix corpus and share it between both consumers.
    // `None` on a whole-result hit (both consumers are skipped) or when the
    // scoped path leaves `pre_fix_corpus` consumed.
    let post_region_corpus: Option<crate::span::read::LoadedSpans> = if use_whole_result {
        None
    } else if args.fix {
        Some(crate::span::read::load_all_spans_in(repo, span_root)?)
    } else {
        // Plain path: same `.span/` state as the pre-fix load. `pre_fix_corpus`
        // is `Some` here (only the `--fix` bare-scan branch takes it).
        pre_fix_corpus.take()
    };

    // Human format, workspace scan: each surfaced span lists its *complete*
    // anchor set in stored order — drifted anchors keep their resolved
    // finding, fresh siblings render as bare bullets. On the cache_v2 warm
    // path the resolver persists only the non-Fresh finding rows, so
    // `m.anchors` may hold just the drifted subset; reconstruct the full
    // set from the span-file record, synthesizing Fresh `AnchorResolved`
    // for anchor ids absent from the resolved subset. Resolved anchors
    // absent from the file record (e.g. injected `MergeConflict` anchors,
    // whose unreadable span is skipped by `load_all_spans_in`) are
    // preserved as-is. Fully-Fresh spans are not re-added: a scan is a
    // drift report. This is Human-only; other formats stream drifted
    // findings.
    // Skipped on whole-result hit — the cached spans already include all
    // anchors (Fresh + non-Fresh) backfilled in stored order.
    if matches!(args.format, StaleFormat::Human)
        && args.paths.is_empty()
        && !use_whole_result
    {
        let _perf = crate::perf::span("stale.backfill-fresh-anchors");
        // Drift-report contract: a scan shows a span iff it has a non-Fresh
        // anchor. The all-layers discovery path (`needs_all_layers`,
        // Human-only) can return spans that re-resolve fully Fresh — the
        // machine renderers never show them because they
        // emit drift findings only. Enforce the same predicate here so a
        // backfilled fresh span cannot leak into the human scan.
        spans.retain(|m| {
            m.anchors
                .iter()
                .any(|a| a.status != AnchorStatus::Fresh)
        });
        // Reuse the shared post-region corpus (fresh post-`apply_fix` on the
        // `--fix` path; the unchanged pre-fix corpus on the plain path) instead
        // of a dedicated reload. Borrow it so the interior scan below can reuse
        // the same load.
        let file_records: std::collections::HashMap<&str, &crate::types::Span> =
            post_region_corpus
                .as_ref()
                .expect("post_region_corpus set before backfill when !use_whole_result")
                .0
                .iter()
                .map(|(n, m)| (n.as_str(), m))
                .collect();
        for m in spans.iter_mut() {
            let Some(record) = file_records.get(m.name.as_str()) else {
                continue;
            };
            // Rebuild in stored order: each file-record anchor keeps its
            // resolved finding when present, else gets a synthesized Fresh
            // row.
            let mut rebuilt: Vec<crate::types::AnchorResolved> =
                Vec::with_capacity(record.anchors.len());
            for (anchor_id, a) in &record.anchors {
                match m.anchors.iter().find(|r| &r.anchor_id == anchor_id) {
                    Some(existing) => rebuilt.push(existing.clone()),
                    None => rebuilt.push(fresh_anchor_resolved(anchor_id, a)),
                }
            }
            // Preserve resolved anchors not present in the file record.
            for r in &m.anchors {
                if !record.anchors.iter().any(|(id, _)| id == &r.anchor_id) {
                    rebuilt.push(r.clone());
                }
            }
            m.anchors = rebuilt;
        }
        // Re-sort: backfilled fresh anchors can change a span's
        // anchor-path sort key.
        sort_spans_by_anchor_path(&mut spans);
    }

    // Adapter: engine output (`SpanResolved`) → renderer input
    // (`Finding`). The adapter is a pure data shape transform; semantics
    // live in the engine.
    //
    // Per-layer expansion: each non-Fresh anchor emits one `Finding` per
    // drifting layer in `layer_sources` (shallow-to-deep: I → W → H).
    // Terminal statuses (Deleted, Conflict, Submodule,
    // ContentUnavailable) have an empty `layer_sources` and emit exactly
    // one row with `source=None`. MOVED also emits one row.
    let findings: Vec<Finding> = {
        let _perf = crate::perf::span("stale.build-findings");
        spans
            .iter()
            .flat_map(|m| {
                m.anchors
                    .iter()
                    .filter(|r| r.status != AnchorStatus::Fresh)
                    .flat_map(|r| {
                        if r.layer_sources.is_empty() {
                            // Terminal status or MOVED with no tracked layer:
                            // emit one row with the stored source.
                            vec![Finding {
                                span: m.name.clone(),
                                anchor_id: r.anchor_id.clone(),
                                status: r.status.clone(),
                                source: r.source,
                                anchored: r.anchored.clone(),
                                current: r.current.clone(),
                                locus: r.locus.clone(),
                                fuzzy_successors: r.fuzzy_successors.clone(),
                            }]
                        } else {
                            // Emit one Finding per drifting layer.
                            r.layer_sources
                                .iter()
                                .map(|&src| Finding {
                                    span: m.name.clone(),
                                    anchor_id: r.anchor_id.clone(),
                                    status: r.status.clone(),
                                    source: Some(src),
                                    anchored: r.anchored.clone(),
                                    current: r.current.clone(),
                                    locus: if src == DriftSource::Head {
                                        r.locus.clone()
                                    } else {
                                        None
                                    },
                                    fuzzy_successors: r.fuzzy_successors.clone(),
                                })
                                .collect()
                        }
                    })
            })
            .collect()
    };

    // Exit-code computation: findings that are `ContentUnavailable` under
    // `--ignore-unavailable` do not drive exit code. Followed Moved
    // findings are also subtracted: we just rewrote them so they are
    // logically Fresh for this invocation's exit code.
    let stale_findings: usize = findings
        .iter()
        .filter(|f| {
            if matches!(f.status, AnchorStatus::ResolvedPendingCommit) {
                return false;
            }
            if followed_ids.contains(&f.anchor_id) {
                return false;
            }
            true
        })
        .count();
    // Interior-anchor surfacing (CARD AC4: surfaced at stale/validate time).
    // Scanned per-span so one poisoned span never blanks the others; emitted
    // as a loud, actionable report to stderr (keeping stdout's machine
    // formats clean) and counted into the exit code so the violation cannot
    // report "clean". For a scoped query, only surface spans in scope.
    // Interior-anchor surfacing: skipped on whole-result hit because the
    // CommittedKey gating guarantees span files haven't changed since the
    // cache was stored (fail-closed: any span-file change would change
    // span_tree_key → miss). The cached result has no violations (they
    // were checked at store time).
    let interior_violations: Vec<crate::cli::interior_anchor::InteriorAnchorViolation> =
        if use_whole_result {
            Vec::new()
        } else {
            let _perf = crate::perf::span("stale.scan-interior-anchors");
            // Reuse the shared post-region corpus (same load the backfill used)
            // instead of a dedicated reload — it observes the correct state
            // (post-`apply_fix` on `--fix`, unchanged pre-fix on the plain
            // path).
            let all = crate::cli::interior_anchor::scan_interior_anchors_in(
                span_root,
                &post_region_corpus
                    .as_ref()
                    .expect("post_region_corpus set before interior scan when !use_whole_result")
                    .0,
            );
            match &scoped_span_names {
                None => all,
                Some(names) => all
                    .into_iter()
                    .filter(|v| names.contains(&v.span_name))
                    .collect(),
            }
        };
    if !interior_violations.is_empty() {
        eprintln!();
        eprintln!(
            "# span stale: {} interior-anchor violation(s)",
            interior_violations.len()
        );
        for v in &interior_violations {
            eprintln!();
            eprintln!("{}", v.report_block(span_root));
        }
        eprintln!();
    }

    let stale_count = stale_findings;

    // `--cluster`: connected components over the run's stale spans, by
    // shared anchored file. Gated strictly on `args.cluster && stale_count >
    // 0` (no clusters possible with zero stale spans). `full_anchor_paths`
    // is sourced from a dedicated `cluster_corpus` load — never from
    // `pre_fix_corpus`/`post_region_corpus`, which are `None` on every warm
    // cache_v2 hit — so `--cluster` output is identical on a cold run and a
    // warm cache hit against an unchanged repo. See "Clustering design" in
    // `plans/bounded-rename-chain.md`.
    let clusters: Vec<crate::cli::stale_cluster::StaleCluster> = if args.cluster && stale_count > 0
    {
        let _perf = crate::perf::span("stale.cluster-corpus-load");
        let (cluster_corpus, _conflicted) =
            crate::span::read::load_all_spans_in(repo, span_root)?;
        let stale_span_names: std::collections::BTreeSet<String> = findings
            .iter()
            .filter(|f| {
                if matches!(f.status, AnchorStatus::ResolvedPendingCommit) {
                    return false;
                }
                if followed_ids.contains(&f.anchor_id) {
                    return false;
                }
                true
            })
            .map(|f| f.span.clone())
            .collect();
        let full_anchor_paths: HashMap<String, std::collections::BTreeSet<String>> =
            cluster_corpus
                .into_iter()
                .map(|(name, span)| {
                    let paths: std::collections::BTreeSet<String> =
                        span.anchors.into_iter().map(|(_, a)| a.path).collect();
                    (name, paths)
                })
                .collect();
        crate::cli::stale_cluster::cluster_stale_spans(&stale_span_names, &full_anchor_paths)
    } else {
        Vec::new()
    };

    match args.format {
        StaleFormat::Human => {
            let _perf = crate::perf::span("stale.render-human");
            let printed = render_human(
                repo,
                &spans,
                &findings,
                &followed_ids,
                HumanRenderOptions {
                    oneline: false,
                    stat: false,
                    patch: false,
                    named_lookup: !args.paths.is_empty(),
                },
                &span_anchor_totals,
                &clusters,
            )?;

            // No-drift message: zero drift prints a summary count line. A
            // full scan reports the whole committed corpus; a scoped query
            // (positional args) reports only the spans/anchors in scope, so
            // a clean named-span or path lookup gets explicit "checked, all
            // clean" feedback rather than empty output. The line fires
            // regardless of whether any span block printed.
            if stale_count == 0 {
                let (span_count, total_anchors) = match scoped_totals {
                    Some(scope) => scope,
                    None => (total_committed_span_count, total_committed_anchor_count),
                };
                let span_word = if span_count == 1 { "span" } else { "spans" };
                let anchor_word = if total_anchors == 1 {
                    "anchor"
                } else {
                    "anchors"
                };
                if printed {
                    println!();
                }
                println!(
                    "0 stale across {} {} ({} {} checked)",
                    span_count, span_word, total_anchors, anchor_word,
                );
            }

            // Reconciled summary line: always printed after --fix, regardless
            // of whether drift remains or all counts are zero.
            if args.fix && let Some(ref fr) = fix_result {
                let updated = fr.anchors_updated;
                let removed = fr.anchors_removed;
                let total = updated + removed;
                let spans = fr.spans_touched;
                println!(
                    "Reconciled {} {}, {} {} ({} updated, {} removed).",
                    spans,
                    if spans == 1 { "span" } else { "spans" },
                    total,
                    if total == 1 { "anchor" } else { "anchors" },
                    updated,
                    removed,
                );
            }
        }
        StaleFormat::Porcelain => {
            let _perf = crate::perf::span("stale.render-porcelain");
            render_porcelain(&findings, show_src_column, &clusters);
        }
        StaleFormat::Json => {
            let _perf = crate::perf::span("stale.render-json");
            render_json(&spans, &findings, &followed_ids, &clusters)?;
        }
    }

    // An interior-anchor violation is a fail-closed integrity problem: it
    // drives a non-zero exit even when no anchor drifted, and `--no-exit-code`
    // (which suppresses drift exit codes) does not mask it.
    let exit = if !interior_violations.is_empty() {
        1
    } else if stale_count == 0 || args.no_exit_code {
        0
    } else {
        1
    };
    {
        let _perf = crate::perf::span("stale.write-stdout");
        use std::io::Write;
        let _ = std::io::stdout().flush();
    }

    // `--fix` phase attribution (GIT_SPAN_PERF). Emitted only for the `--fix`
    // path and only when perf is enabled, alongside the resolver `session.*`
    // counters already printed by each resolve pass. Splits the `--fix`-specific
    // delta across the pre-fix resolve, `apply_fix`, and the post-fix re-resolve.
    if args.fix && crate::perf::enabled() {
        crate::perf::counter("fix.pre-resolve-us", crate::perf::fix_pre_resolve_us());
        crate::perf::counter("fix.apply-us", crate::perf::fix_apply_us());
        crate::perf::counter("fix.post-resolve-us", crate::perf::fix_post_resolve_us());
        crate::perf::counter("fix.rewritable-anchors", crate::perf::fix_rewritable_anchors());
        crate::perf::counter("fix.hash-calls", crate::perf::fix_hash_calls());
        crate::perf::counter("fix.spans-rewritten", crate::perf::fix_spans_rewritten());
    }

    Ok(exit)
}

// ---------------------------------------------------------------------------
// Post-fix scoped splice helpers.
// ---------------------------------------------------------------------------

/// Re-resolve only the spans that `apply_fix` rewrote and splice the results
/// back into the pre-fix set, for the **bare-scan** arm (`git span stale --fix`
/// with no positional paths).
///
/// Bare-scan semantics: drop any rewritten span that resolves fully Fresh
/// (mirrors `stale_spans` which filters via `span_is_reportable_in_stale_discovery`).
fn splice_bare_scan_post_fix(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    pre_fix_spans: Vec<SpanResolved>,
    rewritten_names: &HashSet<String>,
    source_layers: Option<SourceLayers>,
) -> Result<Vec<SpanResolved>> {
    if rewritten_names.is_empty() {
        return Ok(pre_fix_spans);
    }

    let names: Vec<String> = rewritten_names.iter().cloned().collect();
    // Cold path (`Some`): reuse the pre-fix source layers so the post-fix
    // resolve skips a second `read-worktree-layer`. Warm path (`None`): build
    // a fresh `EngineState` (one `read-worktree-layer`, already optimal).
    let post_fix = match source_layers {
        Some(layers) => {
            resolve_named_spans_with_source_layers(repo, span_root, &names, options, layers)?
        }
        None => resolve_named_spans(repo, span_root, &names, options)?,
    };

    // Build a map of Ok results from the post-fix resolve.
    let mut updated: HashMap<String, SpanResolved> = post_fix
        .into_iter()
        .filter_map(|(name, r)| r.ok().map(|m| (name, m)))
        .collect();

    // Bare-scan: keep only reportable spans (drop fully-Fresh).
    let mut result: Vec<SpanResolved> = pre_fix_spans
        .into_iter()
        .filter_map(|m| {
            if rewritten_names.contains(&m.name) {
                updated
                    .remove(&m.name)
                    .filter(span_is_reportable_in_stale_discovery)
            } else {
                Some(m)
            }
        })
        .collect();

    // Rewritten spans absent from pre_fix_spans (coalesce-only on a
    // synthesized all-Fresh fix_input entry): add if now reportable.
    for (_, resolved) in updated {
        if span_is_reportable_in_stale_discovery(&resolved) {
            result.push(resolved);
        }
    }

    sort_spans_by_anchor_path(&mut result);
    Ok(result)
}

/// Re-resolve only the spans that `apply_fix` rewrote and splice the results
/// back into the pre-fix set, for the **named-scope** arm (`git span stale
/// <name> --fix` with positional paths).
///
/// Named-scope semantics: keep ALL spans including fully-Fresh (rendered as
/// bare bullets). A rewritten span that re-resolves as `Err` is dropped,
/// mirroring the current arm's `if let Ok(span) = result` pattern.
fn splice_named_scope_post_fix(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    pre_fix_spans: Vec<SpanResolved>,
    rewritten_names: &HashSet<String>,
    source_layers: Option<SourceLayers>,
) -> Result<Vec<SpanResolved>> {
    if rewritten_names.is_empty() {
        // No span was rewritten, so the pre-fix resolved set already reflects
        // the post-fix state — return it without a second resolve.
        //
        // Intentional, authorized single-emit stderr: when a resolve-time
        // warning fired during the pre-fix pass AND `apply_fix` rewrote
        // nothing, skipping the second resolve here means that warning prints
        // once, not twice. The pre-optimization code re-resolved the whole
        // named scope unconditionally and so emitted the warning a second
        // time. Single emission is the correct, intended behavior (per user
        // decision) — this early return must NOT be "fixed" by reintroducing
        // the redundant resolve.
        return Ok(pre_fix_spans);
    }

    let names: Vec<String> = rewritten_names.iter().cloned().collect();
    // Cold path (`Some`): reuse the pre-fix source layers so the post-fix
    // resolve skips a second `read-worktree-layer`. Warm path (`None`): build
    // a fresh `EngineState`.
    let post_fix = match source_layers {
        Some(layers) => {
            resolve_named_spans_with_source_layers(repo, span_root, &names, options, layers)?
        }
        None => resolve_named_spans(repo, span_root, &names, options)?,
    };

    // Build a map of Ok results from the post-fix resolve.
    // Err results are absent from this map → dropped on the filter_map below,
    // mirroring the current arm's `if let Ok(span) = result { push }`.
    let mut updated: HashMap<String, SpanResolved> = post_fix
        .into_iter()
        .filter_map(|(name, r)| r.ok().map(|m| (name, m)))
        .collect();

    // Named-scope: keep ALL spans including fully-Fresh (rendered as bare
    // bullets). A rewritten span absent from `updated` (Err path) is dropped.
    let mut result: Vec<SpanResolved> = pre_fix_spans
        .into_iter()
        .filter_map(|m| {
            if rewritten_names.contains(&m.name) {
                updated.remove(&m.name) // None = Err path → dropped
            } else {
                Some(m)
            }
        })
        .collect();

    // Rewritten spans not in pre_fix_spans: add unconditionally (named-scope
    // shows all named spans). In practice this should not occur because the
    // named scope only includes spans explicitly requested.
    for (_, resolved) in updated {
        result.push(resolved);
    }

    sort_spans_by_anchor_path(&mut result);
    Ok(result)
}

// ---------------------------------------------------------------------------
// Shared formatting helpers.
// ---------------------------------------------------------------------------

/// Lowercase prose description for use in the unified block-shape suffix.
///
/// Returns strings like:
/// - "changed"
/// - "changed in HEAD"
/// - "moved to new/path#L1-L10"
/// - "deleted in HEAD (path no longer exists)"
fn describe_finding_lower(f: &Finding) -> String {
    let src_phrase = |src: Option<DriftSource>| -> &'static str {
        match src {
            Some(DriftSource::Head) => "in HEAD",
            Some(DriftSource::Index) => "in the index",
            Some(DriftSource::Worktree) => "in the working tree",
            None => "",
        }
    };

    let base = match &f.status {
        AnchorStatus::Changed => super::drift_label::format_drift_label(
            &f.status,
            f.source,
            f.locus.as_ref(),
            f.current.is_some(),
        ),
        AnchorStatus::ResolvedPendingCommit => "resolved, pending commit".to_string(),
        AnchorStatus::Moved => {
            // Relocation provenance is the move itself, not a per-layer
            // edit; omit the layer phrase so a committed `git mv` is not
            // mislabeled "in the working tree".
            if let Some(cur) = &f.current {
                let dest = render_path_extent_plain(&cur.path, cur.extent);
                // If this was a fuzzy match, append the confidence.
                if let Some(best) = f.fuzzy_successors.first() {
                    let pct = (best.confidence * 100.0).round() as u32;
                    format!("moved to {dest} ({pct}% match)")
                } else {
                    format!("moved to {dest}")
                }
            } else {
                "moved".to_string()
            }
        }
        AnchorStatus::Deleted => {
            let label = super::drift_label::format_drift_label(
                &f.status,
                f.source,
                f.locus.as_ref(),
                f.current.is_some(),
            );
            match &f.locus {
                Some(DriftLocus::RenamedAt(_, path)) => {
                    format!("{label} — needs re-anchor to {path}")
                }
                _ => format!("{label} — needs code-fix-first or span deletion"),
            }
        }
        AnchorStatus::MergeConflict => {
            let src = src_phrase(f.source);
            if src.is_empty() {
                "conflict".to_string()
            } else {
                format!("conflict {src}")
            }
        }
        AnchorStatus::Submodule => {
            let src = src_phrase(f.source);
            if src.is_empty() {
                "submodule".to_string()
            } else {
                format!("submodule {src}")
            }
        }
        AnchorStatus::ContentUnavailable(reason) => {
            let src = src_phrase(f.source);
            let detail = match reason {
                UnavailableReason::LfsNotFetched => "LFS not fetched",
                UnavailableReason::LfsNotInstalled => "LFS not installed",
                UnavailableReason::PromisorMissing => "promisor missing",
                UnavailableReason::SparseExcluded => "sparse excluded",
                UnavailableReason::FilterFailed { .. } => "filter failed",
                UnavailableReason::IoError { .. } => "I/O error",
            };
            if src.is_empty() {
                format!("content unavailable ({detail})")
            } else {
                format!("content unavailable {src} ({detail})")
            }
        }
        AnchorStatus::Fresh => unreachable!("Fresh anchors have no description"),
    };

    // When fuzzy successors exist but the status was NOT reclassified as
    // MOVED (candidates below auto-fix threshold), surface the best match
    // so the operator sees there are candidates to review.
    if f.status != AnchorStatus::Moved
        && let Some(best) = f.fuzzy_successors.first()
    {
        let pct = (best.confidence * 100.0).round() as u32;
        let path_extent = AnchorLocation {
            path: std::path::PathBuf::from(&best.path),
            extent: AnchorExtent::LineRange {
                start: best.start,
                end: best.end,
            },
            blob: None,
        };
        let dest = render_path_extent_plain(&path_extent.path, path_extent.extent);
        format!("{base} — possible match: {dest} ({pct}% similar)")
    } else {
        base
    }
}

fn status_str(s: &AnchorStatus) -> &'static str {
    match s {
        AnchorStatus::Fresh => "FRESH",
        AnchorStatus::ResolvedPendingCommit => "RESOLVED_PENDING_COMMIT",
        AnchorStatus::Moved => "MOVED",
        AnchorStatus::Changed => "CHANGED",
        AnchorStatus::Deleted => "DELETED",
        AnchorStatus::MergeConflict => "CONFLICT",
        AnchorStatus::Submodule => "SUBMODULE",
        AnchorStatus::ContentUnavailable(reason) => match reason {
            UnavailableReason::LfsNotFetched => "LFS_NOT_FETCHED",
            UnavailableReason::LfsNotInstalled => "LFS_NOT_INSTALLED",
            UnavailableReason::PromisorMissing => "PROMISOR_MISSING",
            UnavailableReason::SparseExcluded => "SPARSE_EXCLUDED",
            UnavailableReason::FilterFailed { .. } => "FILTER_FAILED",
            UnavailableReason::IoError { .. } => "IO_ERROR",
        },
    }
}

fn source_marker(src: Option<DriftSource>) -> &'static str {
    match src {
        Some(DriftSource::Head) => "H",
        Some(DriftSource::Index) => "I",
        Some(DriftSource::Worktree) => "W",
        None => "-",
    }
}

/// Human-facing `(path, extent)` render. Whole-file pins read
/// `hero.png  (whole)`; line ranges read `src/foo.rs#L1-L10`.
fn render_path_extent_human(path: &std::path::Path, extent: AnchorExtent) -> String {
    match extent {
        AnchorExtent::WholeFile => format!("{}  (whole)", path.display()),
        AnchorExtent::LineRange { start, end } => {
            format!("{}#L{}-L{}", path.display(), start, end)
        }
    }
}

/// Plain `(path, extent)` render for the bullet listing — whole-file
/// pins drop the `(whole)` decoration since the bare path already
/// communicates "this entire file" in context.
fn render_path_extent_plain(path: &std::path::Path, extent: AnchorExtent) -> String {
    match extent {
        AnchorExtent::WholeFile => format!("{}", path.display()),
        AnchorExtent::LineRange { start, end } => {
            format!("{}#L{}-L{}", path.display(), start, end)
        }
    }
}

// ---------------------------------------------------------------------------
// Human renderer.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
struct HumanRenderOptions {
    oneline: bool,
    stat: bool,
    patch: bool,
    named_lookup: bool,
}

/// Synthesize a `Fresh` `AnchorResolved` straight from a span-file anchor
/// record. Used to reconstruct anchors the resolver omitted: fully-Fresh
/// spans fed to `apply_fix`, and fresh sibling anchors of a stale span on
/// the cache_v2 warm path (which persists only the non-Fresh subset).
fn fresh_anchor_resolved(anchor_id: &str, a: &crate::types::Anchor) -> crate::types::AnchorResolved {
    crate::types::AnchorResolved {
        anchor_id: anchor_id.to_string(),
        anchor_sha: a.anchor_sha.clone(),
        anchored: AnchorLocation {
            path: std::path::PathBuf::from(&a.path),
            extent: a.extent,
            blob: None,
        },
        current: None,
        status: AnchorStatus::Fresh,
        content_equivalent: false,
        source: None,
        layer_sources: Vec::new(),
        locus: None,
        fuzzy_successors: vec![],
    }
}

fn render_human(
    repo: &gix::Repository,
    spans: &[SpanResolved],
    findings: &[Finding],
    followed_ids: &HashSet<String>,
    options: HumanRenderOptions,
    span_anchor_totals: &std::collections::HashMap<String, usize>,
    clusters: &[crate::cli::stale_cluster::StaleCluster],
) -> Result<bool> {
    // named_lookup: true when positional args were given (named lookup mode).
    // For workspace scan: suppress clean spans.
    // For named lookup: always render block.
    let _is_named_lookup = options.named_lookup;

    let mut printed_any_span = false;
    for m in spans.iter() {
        // Build per-span collapsed findings (one row per anchor, deepest layer).
        let span_findings_owned: Vec<Finding> = m
            .anchors
            .iter()
            .flat_map(|r| {
                if r.status == AnchorStatus::Fresh {
                    vec![Finding {
                        span: m.name.clone(),
                        anchor_id: r.anchor_id.clone(),
                        status: AnchorStatus::Fresh,
                        source: None,
                        anchored: r.anchored.clone(),
                        current: r.current.clone(),
                        locus: None,
                        fuzzy_successors: vec![],
                    }]
                } else {
                    // Collapse per-layer expansions to a single row per
                    // anchor, picking the deepest drifting source
                    // (Worktree > Index > HEAD).
                    let deepest = findings
                        .iter()
                        .filter(|f| f.span == m.name && f.anchor_id == r.anchor_id)
                        .max_by_key(|f| match f.source {
                            Some(DriftSource::Worktree) => 3,
                            Some(DriftSource::Index) => 2,
                            Some(DriftSource::Head) => 1,
                            None => 0,
                        })
                        .cloned();
                    deepest.into_iter().collect()
                }
            })
            .collect();
        let span_findings: Vec<&Finding> = span_findings_owned.iter().collect();

        let span_stale = span_findings
            .iter()
            .filter(|f| f.status != AnchorStatus::Fresh)
            .count();

        // All spans are printed regardless of drift state — Fresh anchors
        // render as bare bullets so a scan with no drift still shows what
        // is tracked. Named-lookup behavior is unchanged.
        let _ = span_stale;

        if printed_any_span {
            println!();
            println!("---");
            println!();
        }
        printed_any_span = true;

        if options.oneline {
            for f in &span_findings {
                println!(
                    "{:<8}  {}",
                    status_str(&f.status),
                    render_path_extent_human(&f.anchored.path, f.anchored.extent),
                );
            }
            continue;
        }

        if options.stat {
            // Only anchors that are actually stale belong in `--stat`
            // output. Listing fresh `+0 -0` rows (or saying "All anchors
            // … are stale" when only some are) misleads triage.
            let stale_findings: Vec<&Finding> = span_findings
                .iter()
                .copied()
                .filter(|f| f.status != AnchorStatus::Fresh)
                .collect();
            // The span's *full* anchor total comes from the span-file
            // read, not from `span_findings`: on the cache_v2 path
            // `m.anchors` holds only the stale subset, so
            // `span_findings.len()` would equal `span_stale` and the
            // heading would falsely read "All anchors … are stale" even
            // when Fresh sibling anchors exist. Fall back to the
            // resolved count only when the span is absent from the map
            // (e.g. a staging-only span with no committed anchors).
            let span_total = span_anchor_totals
                .get(m.name.as_str())
                .copied()
                .unwrap_or(span_findings.len());
            if span_stale > 0 && span_stale == span_total {
                println!("All anchors in {} are stale:", m.name);
            } else if span_stale > 0 {
                println!(
                    "{} of {} anchors in {} are stale:",
                    span_stale, span_total, m.name
                );
            }
            for f in &stale_findings {
                let path_extent = render_path_extent_human(&f.anchored.path, f.anchored.extent);
                if f.status == AnchorStatus::Moved {
                    // A pure relocation has no content delta — the stored
                    // bytes are intact at a new path. A `+x -0` here is
                    // the verbatim re-insertion at the destination, which
                    // misrepresents a `Moved` as a rewrite. Show `moved`
                    // instead, consistent with the `Moved` semantics.
                    println!("  {path_extent} | moved");
                } else {
                    let (insertions, deletions) = diff_counts(repo, f);
                    println!("  {path_extent} | +{insertions} -{deletions}");
                }
            }
            continue;
        }

        // --- DEFAULT UNIFIED BLOCK OUTPUT ---
        // Shape: ## <span-name>
        //        - <plain-path-extent>[ — <status>][ — auto-updated]
        //        (blank line)
        //        <why text>

        println!("## {}", m.name);

        if m.anchors.is_empty() {
            println!("*Span has no anchors*");
        } else {
            // Committed anchors in stored order.
            for f in &span_findings {
                let addr = render_path_extent_plain(&f.anchored.path, f.anchored.extent);
                if f.status == AnchorStatus::Fresh {
                    println!("- {addr}");
                } else {
                    let is_followed = followed_ids.contains(&f.anchor_id);
                    let desc = describe_finding_lower(f);
                    let auto_tag = if is_followed { " — auto-updated" } else { "" };
                    println!("- {addr} — {desc}{auto_tag}");
                    if options.patch {
                        let diff = render_patch(repo, f);
                        if !diff.trim().is_empty() {
                            println!("{diff}");
                        }
                    }
                }
            }

        }

        // Why text: print verbatim after a blank line if non-empty.
        let why = m.why.trim_end_matches('\n');
        if !why.is_empty() {
            println!();
            println!("{why}");
        }
    }

    if !clusters.is_empty() {
        if printed_any_span {
            println!();
        }
        println!("Clusters:");
        for c in clusters {
            let members = c.spans.join(", ");
            if c.shared_files.is_empty() {
                println!("- {members} (independent)");
            } else {
                println!("- {members} (shared: {})", c.shared_files.join(", "));
            }
        }
    }

    Ok(printed_any_span)
}

fn diff_counts(repo: &gix::Repository, finding: &Finding) -> (usize, usize) {
    let (old, new) = finding_text_pair(repo, finding);
    let diff = similar::TextDiff::from_lines(&old, &new);
    let mut insertions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Delete => deletions += 1,
            similar::ChangeTag::Insert => insertions += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (insertions, deletions)
}

fn render_patch(repo: &gix::Repository, finding: &Finding) -> String {
    let (old, new) = finding_text_pair(repo, finding);
    let old_header = format!(
        "{} (anchored)",
        render_path_extent_human(&finding.anchored.path, finding.anchored.extent)
    );
    let new_header = finding
        .current
        .as_ref()
        .map(|c| render_path_extent_human(&c.path, c.extent))
        .unwrap_or_else(|| "(missing)".to_string());
    similar::TextDiff::from_lines(&old, &new)
        .unified_diff()
        .header(&old_header, &new_header)
        .to_string()
}

fn finding_text_pair(repo: &gix::Repository, finding: &Finding) -> (String, String) {
    let old = read_location_text(repo, &finding.anchored);
    let new = finding
        .current
        .as_ref()
        .map(|current| read_location_text(repo, current))
        .unwrap_or_default();
    (old, new)
}

/// Extract the live text content for a resolved anchor location, slicing to its
/// extent. Shared with `git span history`'s `current` section so the two
/// commands render identical drifted-anchor content (including a relocated
/// block for a `Moved` anchor, whose `current` location carries the new
/// path/range).
pub(crate) fn read_location_text(repo: &gix::Repository, location: &AnchorLocation) -> String {
    let bytes = if let Some(blob) = location.blob {
        read_blob_bytes(repo, blob).unwrap_or_default()
    } else {
        let Some(workdir) = repo.workdir() else {
            return String::new();
        };
        std::fs::read(workdir.join(&location.path)).unwrap_or_default()
    };
    let text = String::from_utf8_lossy(&bytes);
    match location.extent {
        AnchorExtent::WholeFile => text.into_owned(),
        AnchorExtent::LineRange { start, end } => slice_lines(&text, start, end),
    }
}

fn read_blob_bytes(repo: &gix::Repository, oid: gix::ObjectId) -> Option<Vec<u8>> {
    repo.find_object(oid)
        .ok()
        .map(|object| object.into_blob().detach().data)
}

fn slice_lines(text: &str, start: u32, end: u32) -> String {
    let start_idx = start.saturating_sub(1) as usize;
    let count = end.saturating_sub(start).saturating_add(1) as usize;
    let mut out = text
        .lines()
        .skip(start_idx)
        .take(count)
        .collect::<Vec<_>>()
        .join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

// ---------------------------------------------------------------------------
// Porcelain renderer.
// ---------------------------------------------------------------------------

fn render_porcelain(
    findings: &[Finding],
    show_src: bool,
    clusters: &[crate::cli::stale_cluster::StaleCluster],
) {
    if findings.is_empty() {
        return;
    }
    println!("# porcelain v2");
    for f in findings {
        // Whole-file pins emit `(whole)\t-` in place of the two line
        // columns, keeping the column count stable for parsers.
        let (start_col, end_col) = match f.anchored.extent {
            AnchorExtent::WholeFile => ("(whole)".to_string(), "-".to_string()),
            AnchorExtent::LineRange { start, end } => (start.to_string(), end.to_string()),
        };
        if show_src {
            let src = source_marker(f.source).to_string();
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                status_str(&f.status),
                src,
                f.span,
                f.anchored.path.display(),
                start_col,
                end_col,
            );
        } else {
            println!(
                "{}\t{}\t{}\t{}\t{}",
                status_str(&f.status),
                f.span,
                f.anchored.path.display(),
                start_col,
                end_col,
            );
        }
        // Renamed-deletion comment line: the rename target the deleted-locus
        // walk recovered, when the anchor's own orphaning commit's rewrite
        // resolved to a path that's live at HEAD.
        if let Some(DriftLocus::RenamedAt(_, path)) = &f.locus {
            println!("# renamed-to {}", csv_escape(path));
        }
        // Fuzzy comment line: confidence of the best fuzzy successor.
        if let Some(best) = f.fuzzy_successors.first() {
            let pct = (best.confidence * 100.0).round() as u32;
            println!("# fuzzy {pct}");
        }
    }
    // Cluster comment lines: one per connected component, after all finding
    // rows. `spans`/`shared_files` are already sorted (see `StaleCluster`).
    for c in clusters {
        println!(
            "# cluster {} shared:{}",
            c.spans.iter().map(|s| csv_escape(s)).collect::<Vec<_>>().join(","),
            c.shared_files.iter().map(|f| csv_escape(f)).collect::<Vec<_>>().join(","),
        );
    }
}

// ---------------------------------------------------------------------------
// JSON renderer (`{ "schema_version": 2, findings }`).
// ---------------------------------------------------------------------------

fn render_json(
    spans: &[SpanResolved],
    findings: &[Finding],
    followed_ids: &HashSet<String>,
    clusters: &[crate::cli::stale_cluster::StaleCluster],
) -> Result<()> {
    if findings.is_empty() {
        return Ok(());
    }
    let v = json!({
        "schema_version": 2,
        "span": spans.first().map(|m| m.name.clone()).unwrap_or_default(),
        "findings": findings.iter().map(|f| finding_json(f, followed_ids)).collect::<Vec<_>>(),
        "clusters": clusters.iter().map(|c| json!({
            "spans": c.spans,
            "shared_files": c.shared_files,
        })).collect::<Vec<_>>(),
    });
    println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
    Ok(())
}

fn location_json(loc: &AnchorLocation) -> Value {
    json!({
        "path": loc.path.display().to_string(),
        "extent": extent_json(loc.extent),
        "blob": loc.blob.map(|o| o.to_string()),
    })
}

fn extent_json(e: AnchorExtent) -> Value {
    match e {
        AnchorExtent::WholeFile => json!({ "kind": "whole" }),
        AnchorExtent::LineRange { start, end } => json!({
            "kind": "lines",
            "start": start,
            "end": end,
        }),
    }
}

fn status_json(s: &AnchorStatus) -> Value {
    match s {
        AnchorStatus::ContentUnavailable(reason) => json!({
            "code": "CONTENT_UNAVAILABLE",
            "reason": status_str(s),
            "detail": match reason {
                UnavailableReason::FilterFailed { filter } => json!({"filter": filter}),
                UnavailableReason::IoError { message } => json!({"message": message}),
                _ => Value::Null,
            }
        }),
        _ => json!({ "code": status_str(s) }),
    }
}

fn finding_json(f: &Finding, followed_ids: &HashSet<String>) -> Value {
    let moved_to = if f.status == AnchorStatus::Moved {
        f.current.as_ref().map(|loc| {
            let mut obj = json!({
                "path": loc.path.display().to_string(),
                "extent": extent_json(loc.extent),
            });
            // Add confidence field for fuzzy matches.
            if let Some(best) = f.fuzzy_successors.first() {
                obj["confidence"] = json!(best.confidence);
            }
            obj
        })
    } else {
        None
    };
    let auto_followed = followed_ids.contains(&f.anchor_id);
    // Surface all fuzzy successors for operator review, regardless of
    // anchor status. Empty when no fuzzy scan ran or no candidates found.
    let fuzzy_successors_json: Vec<Value> = f
        .fuzzy_successors
        .iter()
        .map(|fs| {
            json!({
                "path": fs.path,
                "extent": extent_json(AnchorExtent::LineRange {
                    start: fs.start,
                    end: fs.end,
                }),
                "confidence": fs.confidence,
            })
        })
        .collect();
    json!({
        "span": f.span,
        "status": status_json(&f.status),
        "source": f.source.map(|s| match s {
            DriftSource::Head => "HEAD",
            DriftSource::Index => "INDEX",
            DriftSource::Worktree => "WORKTREE",
        }),
        "anchored": location_json(&f.anchored),
        "current": f.current.as_ref().map(location_json),
        "moved_to": moved_to,
        "fuzzy_successors": fuzzy_successors_json,
        "auto_followed": if auto_followed { Value::Bool(true) } else { Value::Null },
        "locus": match &f.locus {
            Some(DriftLocus::ChangedAt(oid)) => json!({ "changed_in": oid.to_string() }),
            Some(DriftLocus::OrphanedAt(oid)) => json!({ "deleted_in": oid.to_string() }),
            Some(DriftLocus::RenamedAt(oid, path)) => json!({
                "renamed_at": oid.to_string(),
                "renamed_to": path,
            }),
            None => Value::Null,
        },
    })
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_escape_plain_ascii_unchanged() {
        assert_eq!(csv_escape("hello"), "hello");
        assert_eq!(csv_escape(""), "");
        assert_eq!(csv_escape("abc123"), "abc123");
    }

    #[test]
    fn csv_escape_comma_quoted() {
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
    }

    #[test]
    fn csv_escape_double_quote_doubled() {
        assert_eq!(csv_escape("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn csv_escape_lf_quoted() {
        assert_eq!(csv_escape("a\nb"), "\"a\nb\"");
    }

    #[test]
    fn csv_escape_cr_quoted() {
        assert_eq!(csv_escape("a\rb"), "\"a\rb\"");
    }
}
