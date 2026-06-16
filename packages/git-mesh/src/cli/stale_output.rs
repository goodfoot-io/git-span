//! `git mesh stale` output rendering — §10.4.
//!
//! Slice 8 of the layered-stale rewrite (see
//! `docs/stale-layers-plan.md` §"Renderers"). Renderers consume
//! `Finding` / `PendingFinding` end-to-end via a thin adapter that maps
//! the engine's `AnchorResolved` + `MeshResolved.pending` into the
//! plan's "Key types" shape.

use crate::cli::show::BatchFilter;
use crate::cli::{CliError, NextStep, StaleArgs, StaleFormat};
use crate::resolver::{
    SourceLayers, WholeResult, build_pending_findings, mesh_is_reportable_in_stale_discovery,
    resolve_named_meshes, resolve_named_meshes_retaining_source_layers,
    resolve_named_meshes_with_source_layers, sort_meshes_by_anchor_path, stale_meshes,
    stale_meshes_retaining_source_layers, stale_meshes_with_trace,
};
use std::collections::HashMap;
use crate::types::{
    AnchorExtent, AnchorLocation, AnchorStatus, DriftLocus, DriftSource, EngineOptions, Finding,
    LayerSet, MeshResolved, PendingDrift, PendingFinding, StagedAdd, StagedConfig, StagedOpRef,
    StagedRemove, UnavailableReason,
};
use crate::validation::validate_mesh_name_shape;
use anyhow::Result;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::io::{self, BufRead};

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
    w.write_all(b"mesh,anchor_id,anchor_sha,path,wall_us,fast_path,status\n")
        .map_err(&write_err)?;
    for r in rows {
        let mut line = String::new();
        line.push_str(&csv_escape(&r.mesh));
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

/// `git mesh stale --batch --porcelain`: read newline-delimited path filters
/// from stdin (same grammar as `list --batch`) and emit one tab-separated row
/// per `(mesh slug, anchor)` pair for every mesh whose anchors (a) are
/// classified as drifted by the stale engine AND (b) overlap one of the
/// batch filter lines. Format: `<slug>\t<path>\t<start>-<end>` where
/// whole-file anchors emit `0-0`. Honors the same layer-toggle flags
/// (`--head`/`--staged`/`--worktree` and `--no-*`) as the non-batch path.
fn run_stale_batch_porcelain(
    repo: &gix::Repository,
    args: &crate::cli::StaleArgs,
    mesh_root: &str,
) -> Result<i32> {
    // Derive layer set from args, identical to the non-batch path.
    let layers = if args.head {
        LayerSet {
            worktree: false,
            index: false,
            staged_mesh: !args.no_staged_mesh,
        }
    } else if args.staged {
        LayerSet {
            worktree: false,
            index: true,
            staged_mesh: !args.no_staged_mesh,
        }
    } else if args.worktree {
        LayerSet {
            worktree: true,
            index: true,
            staged_mesh: !args.no_staged_mesh,
        }
    } else {
        LayerSet {
            worktree: !args.no_worktree,
            index: !args.no_index,
            staged_mesh: !args.no_staged_mesh,
        }
    };

    let options = EngineOptions {
        layers,
        ignore_unavailable: args.ignore_unavailable,
        since: None,
        needs_all_layers: false,
    };

    // Run the stale engine to get only drifted meshes.
    let stale_resolved = {
        let _perf = crate::perf::span("stale.batch-run-engine");
        stale_meshes(repo, mesh_root, options)?
    };

    // Collect stdin lines and group by path, merging ranges.
    let stdin = io::stdin();
    let mut filters_by_path: std::collections::HashMap<String, Vec<BatchFilter>> =
        std::collections::HashMap::new();
    let mut path_order: Vec<String> = Vec::new();
    for line in stdin.lock().lines() {
        let line = line?;
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        let filter = BatchFilter::parse(line)?;
        let path = filter.path().to_string();
        if !filters_by_path.contains_key(&path) {
            path_order.push(path.clone());
        }
        filters_by_path.entry(path).or_default().push(filter);
    }

    // For each path filter, scan only drifted anchors that overlap the filter.
    for path in &path_order {
        let filters = filters_by_path.get(path).unwrap();
        // Collect individual filter ranges — preserve disjoint ranges
        // instead of collapsing into a hull.
        let (merged_path, ranges) = crate::cli::show::merge_batch_filters(filters);

        for mesh in &stale_resolved {
            for anchor in &mesh.anchors {
                // Only emit anchors that the engine classified as drifted.
                if anchor.status == AnchorStatus::Fresh {
                    continue;
                }
                let anchor_path = anchor.anchored.path.to_string_lossy();
                let matched = match &ranges {
                    None => anchor_path == merged_path,
                    Some(ranges) => {
                        anchor_path == merged_path
                            && ranges.iter().any(|(s, e)| {
                                match anchor.anchored.extent {
                                    AnchorExtent::WholeFile => false,
                                    AnchorExtent::LineRange {
                                        start: a_start,
                                        end: a_end,
                                    } => a_start <= *e && a_end >= *s,
                                }
                            })
                    }
                };
                if !matched {
                    continue;
                }
                let extent_str = match anchor.anchored.extent {
                    AnchorExtent::LineRange { start, end } => format!("{start}-{end}"),
                    AnchorExtent::WholeFile => "0-0".to_string(),
                };
                println!("{}\t{}\t{}", mesh.name, anchor_path, extent_str);
            }
        }
    }

    Ok(0)
}

pub fn run_stale(repo: &gix::Repository, args: StaleArgs, mesh_root: &str) -> Result<i32> {
    // `--batch --porcelain`: read path filters from stdin and emit one row per
    // (mesh slug, anchor) for each matching mesh. Shares the same BatchFilter
    // grammar as `list --batch`.
    if args.batch {
        let _perf = crate::perf::span("stale.batch-porcelain");
        return run_stale_batch_porcelain(repo, &args, mesh_root);
    }

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
            next_steps: vec![NextStep::Bash("git mesh stale --fix".into())],
        }
        .into());
    }
    // Read-mode flags (card "Layered Read Model"): `--head` / `--staged`
    // / `--worktree` select an explicit layer view. They are mutually
    // exclusive (enforced by clap) and supersede the `--no-*` toggles
    // (also clap-enforced). Absent any of them, the default effective
    // view is worktree-over-index-over-HEAD, refined by `--no-*`.
    let layers = if args.head {
        LayerSet {
            worktree: false,
            index: false,
            staged_mesh: !args.no_staged_mesh,
        }
    } else if args.staged {
        LayerSet {
            worktree: false,
            index: true,
            staged_mesh: !args.no_staged_mesh,
        }
    } else if args.worktree {
        LayerSet {
            worktree: true,
            index: true,
            staged_mesh: !args.no_staged_mesh,
        }
    } else {
        LayerSet {
            worktree: !args.no_worktree,
            index: !args.no_index,
            staged_mesh: !args.no_staged_mesh,
        }
    };
    let show_src_column = layers.worktree || layers.index;
    // Slice 5: resolve `--since <commit-ish>` once, fail-closed on
    // unresolvable input (no silent fallback per `<fail-closed>`).
    let since = match args.since.as_deref() {
        Some(s) => {
            let _perf = crate::perf::span("stale.resolve-since");
            Some(
                crate::git::resolve_commit(repo, s)
                    .map(|hex| {
                        use std::str::FromStr;
                        gix::ObjectId::from_str(&hex).expect("resolve_commit returns valid hex")
                    })
                    .map_err(|e| CliError {
                        subcommand: "stale",
                        summary: format!("`--since {s}` could not be resolved."),
                        what_happened: format!("{e}"),
                        next_steps: vec![
                            NextStep::Bash("git rev-parse HEAD".into()),
                            NextStep::Bash("git log --oneline".into()),
                        ],
                    })?,
            )
        }
        None => None,
    };
    // Phase 4: only the renderers that present per-layer detail need
    // every layer evaluated. The `human` renderer always shows per-layer
    // expansion; `--patch` / `--stat` need every drifting layer's
    // content. Otherwise (oneline, porcelain, json, junit, github), HEAD
    // alone is enough to drive the exit code, so the engine may
    // short-circuit Index/Worktree once HEAD says "stale".
    let needs_all_layers = matches!(args.format, StaleFormat::Human) || args.patch || args.stat;
    let options = EngineOptions {
        layers,
        ignore_unavailable: args.ignore_unavailable,
        since,
        needs_all_layers,
    };

    // --perf-trace conflicts with positional paths (requires a full scan).
    if args.perf_trace.is_some() && !args.paths.is_empty() {
        return Err(CliError {
            subcommand: "stale",
            summary: "--perf-trace requires a full scan; remove positional paths".into(),
            what_happened: "--perf-trace captures per-anchor timing across all meshes and cannot \
                            be combined with a subset selection via positional paths."
                .into(),
            next_steps: vec![NextStep::Bash("git mesh stale --perf-trace <path>".into())],
        }
        .into());
    }

    // For a scoped query (positional args), the "0 stale" summary reports the
    // meshes/anchors actually in scope, not the full committed corpus. Captured
    // just before clean meshes are filtered out of the resolved set.
    let mut scoped_totals: Option<(usize, usize)> = None;

    // When positional args are present, this holds the resolved mesh names
    // (after path→mesh resolution) so that downstream scoping — conflict
    // detection, interior-anchor filtering — can test membership without
    // re-running resolution or comparing args literally against mesh names.
    // None means "no scope restriction" (bare `git mesh stale`).
    let mut scoped_mesh_names: Option<HashSet<String>> = None;

    // Cold-path source-layer state retained by the pre-fix resolve so the
    // post-fix re-resolve (`--fix`) can skip a second `read-worktree-layer`.
    // `None` on a warm cache_v2 hit (no `EngineState` to retain) or when not
    // running `--fix`.
    let mut pre_fix_source_layers: Option<SourceLayers> = None;

    // Whole-result cache: on a warm-clean hit the cache returns the full
    // backfilled anchor set + anchor totals, allowing run_stale to skip its
    // per-invocation phases (count-totals, detect-conflicts, backfill).
    let mut whole_result: Option<WholeResult> = None;

    // Single corpus parse for scoped queries: load the mesh corpus once and
    // thread it through the path-index build (L369), the scoped anchor totals
    // (L510), and the count-totals phase (L557). All three read the same
    // worktree-effective source; reloading per-site was pure overhead.
    // `None` on the non-scoped path — those sites reload unconditionally.
    let mut scoped_corpus: Option<Vec<(String, crate::types::Mesh)>> = None;

    // PRE-fix resolve timer: only the `--fix` path attributes this pass, so the
    // start instant is taken (under perf) only when `args.fix`. The elapsed is
    // recorded into `fix.pre-resolve-us` just after the resolve block.
    let pre_resolve_start =
        (args.fix && crate::perf::enabled()).then(std::time::Instant::now);

    let mut meshes = if args.paths.is_empty() {
        // No positional args: scan every mesh. Pending-only meshes are NOT
        // included — workspace scans answer "what's stale?" only.
        let _perf = crate::perf::span("stale.resolve-all-meshes");
        if let Some(trace_path) = &args.perf_trace {
            // Open the file before running the resolver so a bad path fails
            // in milliseconds rather than after a full scan.
            let trace_file = open_perf_trace_file(trace_path)?;
            let (resolved, trace_rows) = stale_meshes_with_trace(repo, mesh_root, options)?;
            write_perf_trace_csv(trace_file, trace_path, &trace_rows)?;
            resolved
        } else if args.fix {
            // Retain source layers for the post-fix re-resolve. `--fix` is
            // incompatible with `--perf-trace` discovery above.
            let (resolved, layers, wr) =
                stale_meshes_retaining_source_layers(repo, mesh_root, options)?;
            pre_fix_source_layers = layers;
            whole_result = wr;
            resolved
        } else {
            let (resolved, _, wr) =
                stale_meshes_retaining_source_layers(repo, mesh_root, options)?;
            whole_result = wr;
            resolved
        }
    } else {
        // Resolve each positional arg through mesh-name → path-index dispatch.
        let _perf = crate::perf::span("stale.resolve-args");
        let mut mesh_names: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut missing_files: Vec<String> = Vec::new();

        let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());

        // Load the corpus once and build the path index from it. The previous
        // code called `MeshPathIndex::load_in` here (which loads and discards
        // the corpus internally), then reloaded at L510 for scoped anchor
        // totals and again at L557 for count-totals — three parses of the
        // same worktree-effective source. Now: one load, three consumers.
        //
        // The corpus is stored in `scoped_corpus` so the count-totals phase
        // below can reuse it instead of reloading.
        let corpus = crate::mesh::read::load_all_meshes_in(repo, mesh_root)?;
        let path_index =
            crate::mesh::read::MeshPathIndex::from_loaded_meshes(&corpus.0)?;
        scoped_corpus = Some(corpus.0);

        for arg in &args.paths {
            let mut found = false;

            // Step 1: try mesh name first when arg matches mesh-name shape.
            if validate_mesh_name_shape(arg).is_ok() {
                let is_committed = reader.read_effective(arg)?.is_some();
                if is_committed {
                    if seen.insert(arg.clone()) {
                        mesh_names.push(arg.clone());
                    }
                    found = true;
                } else {
                    // Not a committed mesh; check for staging-only mesh before
                    // falling through to path-index lookup. Matches the original
                    // single-mesh path's MeshNotFound → staging check.
                    if layers.staged_mesh && !build_pending_findings(repo, arg).is_empty() {
                        if seen.insert(arg.clone()) {
                            mesh_names.push(arg.clone());
                        }
                        found = true;
                    }
                }
            }

            // Step 2: fall back to path index (glob-aware). Resolved against
            // the pre-built `path_index` so this stays O(meshes + args)
            // instead of reloading the corpus per arg.
            if !found {
                let names = if crate::mesh::read::is_glob_pattern(arg) {
                    path_index.matching_names_glob(arg, None).unwrap_or_default()
                } else {
                    path_index.matching_names(arg, None)
                };
                for name in names {
                    if seen.insert(name.clone()) {
                        mesh_names.push(name);
                    }
                    found = true;
                }
            }

            // Step 3: arg matched neither a mesh nor any path-index entry. If
            // it names an existing file in the worktree, silently skip — no
            // mesh tracks it, so there is nothing for stale to scan and that
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
                     Git-mesh resolves positional arguments as mesh names, file paths, or globs."
                ),
                next_steps: vec![
                    NextStep::Prose("Check the file paths for typos.".into()),
                    NextStep::Bash("git mesh list".into()),
                ],
            }
            .into());
        }

        // Step 5: resolve candidate mesh names through one shared EngineState.
        let resolved = {
            let _perf = crate::perf::span("stale.resolve-named-meshes");
            if args.fix {
                // Retain source layers for the post-fix re-resolve. The
                // named-scope pre-fix pass always builds an `EngineState`
                // (no cache_v2), so it always yields `SourceLayers`.
                let (resolved, layers) = resolve_named_meshes_retaining_source_layers(
                    repo, mesh_root, &mesh_names, options,
                )?;
                pre_fix_source_layers = Some(layers);
                resolved
            } else {
                resolve_named_meshes(repo, mesh_root, &mesh_names, options)?
            }
        };
        let mut meshes: Vec<MeshResolved> = Vec::with_capacity(resolved.len());
        for (_name, result) in resolved {
            match result {
                Ok(mesh) => meshes.push(mesh),
                Err(crate::Error::MeshNotFound(_)) => {
                    // Staging-only mesh; step 6 will check for pending entries.
                }
                Err(e) => return Err(e.into()),
            }
        }

        // Step 6: surface staging-only meshes for names that had no committed ref.
        if layers.staged_mesh {
            let _perf = crate::perf::span("stale.resolve-staging-only");
            for name in &mesh_names {
                if meshes.iter().any(|m| m.name == *name) {
                    continue;
                }
                let pending = build_pending_findings(repo, name);
                if !pending.is_empty() {
                    meshes.push(MeshResolved {
                        name: name.clone(),
                        message: String::new(),
                        anchors: Vec::new(),
                        pending,
                        follow_moves: false,
                    });
                }
            }
        }

        // Every scoped query is a drift report: clean meshes are filtered
        // out across all formats, whether they were resolved by path/glob or
        // named explicitly. A scope merely selects which meshes to check — if
        // none of a mesh's anchors drifted and it has no pending entries, it
        // is clean and must not surface, in Human or in JSON/porcelain (where
        // `render_json` names `meshes.first()`). A clean scope prints the
        // "0 stale" summary instead (see the no-drift block below).
        // Conflict-injected meshes are added after this block and carry a
        // `MergeConflict` anchor, so they are unaffected.
        // `m.anchors` may hold only the stale subset (the cache_v2 resolver
        // persists non-Fresh rows only), so derive the true anchor total from
        // the mesh-file records. For scoped queries (positional args), the
        // cache path is not used, so load totals fresh.
        // `scoped_corpus` was loaded above (at the path-index build site) and
        // is still live here; reuse it rather than reloading the corpus a
        // second time for this scoped query.
        let scoped_anchor_totals: std::collections::HashMap<String, usize> =
            scoped_corpus
                .as_ref()
                .expect("scoped_corpus must be set before scoped_anchor_totals")
                .iter()
                .map(|(n, m)| (n.clone(), m.anchors.len()))
                .collect();
        scoped_totals = Some((
            meshes.len(),
            meshes
                .iter()
                .map(|m| scoped_anchor_totals.get(&m.name).copied().unwrap_or(m.anchors.len()))
                .sum(),
        ));
        // Capture the resolved mesh-name set for downstream scoping (conflict
        // detection, interior-anchor filtering). Built from `mesh_names` which
        // already contains the result of path→mesh resolution, so a path-form
        // arg like `src/lib.rs` contributes the mesh(es) that anchor it.
        scoped_mesh_names = Some(mesh_names.iter().cloned().collect());
        meshes.retain(|m| {
            m.anchors.iter().any(|a| a.status != AnchorStatus::Fresh) || !m.pending.is_empty()
        });

        meshes
    };

    // Record the PRE-fix resolve wall-clock (see `pre_resolve_start`). The
    // post-fix re-resolve is attributed separately inside the `--fix` block.
    if let Some(start) = pre_resolve_start {
        crate::perf::record_fix_pre_resolve_ns(start.elapsed().as_nanos() as u64);
    }

    // ── Count totals (moved after resolution so whole_result can short-circuit) ──
    //
    // Whole-result warm-clean short-circuit: when the cache returns a
    // whole result, skip count-totals (load_all_meshes_in), conflict
    // detection, interior-anchor scan, and backfill — the cached data
    // carries the already-computed results.
    let use_whole_result = whole_result.is_some();

    let (total_committed_mesh_count, total_committed_anchor_count, mesh_anchor_totals): (
        usize,
        usize,
        std::collections::HashMap<String, usize>,
    ) = if let Some(ref wr) = whole_result {
        let totals: std::collections::HashMap<String, usize> = wr
            .mesh_anchor_totals
            .iter()
            .cloned()
            .collect();
        let mesh_count = totals.len();
        let anchor_count: usize = totals.values().sum();
        crate::perf::counter("cache_v2.whole-result-hit", 1);
        (mesh_count, anchor_count, totals)
    } else {
        let _perf = crate::perf::span("stale.count-totals");
        // On the scoped path `scoped_corpus` was already loaded; reuse it.
        // On the non-scoped path `scoped_corpus` is None, so load here.
        let pairs = match scoped_corpus.take() {
            Some(c) => c,
            None => crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0,
        };
        let mesh_count = pairs.len();
        let anchor_count = pairs.iter().map(|(_, m)| m.anchors.len()).sum();
        let totals = pairs
            .iter()
            .map(|(n, m)| (n.clone(), m.anchors.len()))
            .collect();
        (mesh_count, anchor_count, totals)
    };

    // Fail-closed Conflict reporting: a mesh whose file (or anchored
    // source) is in a Git conflict state cannot be read reliably. Such
    // meshes are skipped by the normal resolution batch; surface each
    // one here as a `Conflict` finding so it renders and forces a
    // non-zero exit (an unreliable read must never report "clean").
    // Skipped on whole-result hit — a clean tree has no conflicts.
    if !use_whole_result {
        let _perf = crate::perf::span("stale.detect-conflicts");
        let conflicted = crate::mesh::read::conflicted_mesh_names_in(repo, mesh_root)?;
        // When positional args were given, only report conflicts for the
        // requested scope (a named mesh or a path/glob that resolves to
        // one); a full scan reports every conflicted mesh.
        let in_scope = |name: &str| -> bool {
            match &scoped_mesh_names {
                None => true,
                Some(names) => names.contains(name),
            }
        };
        let mesh_root_owned = mesh_root.to_string();
        for name in conflicted {
            if !in_scope(&name) {
                continue;
            }
            if meshes.iter().any(|m| m.name == name) {
                continue;
            }
            let mesh_file_path = std::path::PathBuf::from(format!("{mesh_root_owned}/{name}"));
            meshes.push(MeshResolved {
                name: name.clone(),
                message: String::new(),
                anchors: vec![crate::types::AnchorResolved {
                    anchor_id: name.clone(),
                    anchor_sha: String::new(),
                    anchored: AnchorLocation {
                        path: mesh_file_path.clone(),
                        extent: AnchorExtent::WholeFile,
                        blob: None,
                    },
                    current: None,
                    status: AnchorStatus::MergeConflict,
                    content_equivalent: false,
                    source: None,
                    layer_sources: vec![],
                    acknowledged_by: None,
                    locus: None,
                }],
                pending: Vec::new(),
                follow_moves: false,
            });
        }
    }

    // Sort all collected meshes (including staging-only meshes with empty
    // anchors) by anchor path for deterministic output regardless of whether
    // they came from a full scan, positional args, or staging-only discovery.
    sort_meshes_by_anchor_path(&mut meshes);

    // `--fix`: re-anchor drifted Moved/Changed records in the mesh worktree
    // files, then re-resolve so the rendered post-fix view reflects the new
    // statuses. The set of anchor ids actually rewritten drives the
    // "auto-updated" tag and the exit-code subtraction.
    let followed_ids: HashSet<String> = if args.fix {
        let _perf = crate::perf::span("stale.apply-fix");
        // Fail-closed interior-anchor gate, evaluated on the PRE-fix corpus
        // (before `apply_fix` mutates mesh files — the fix can excise the
        // interior anchor line, which would hide it from a post-fix scan). The
        // scoped post-fix splice and cold-path source-layer reuse are only
        // sound when no anchor path is under `mesh_root`. `MeshFile::parse`
        // deliberately accepts interior anchors (so poisoned meshes stay
        // loadable for repair), so a mesh file can also be an anchor target.
        // With an interior anchor present in the pre-fix corpus:
        //   - a non-rewritten mesh whose interior anchor targets a rewritten
        //     mesh file is never re-resolved by the splice, so its drift status
        //     renders stale; and
        //   - a rewritten mesh re-resolved via reused `worktree_diffs` resolves
        //     its interior anchor against stale (pre-fix) mesh-file content.
        // In that case fall back to the baseline full re-resolve (a freshly
        // built `EngineState`, no source-layer reuse, no scoped splice), which
        // is byte-identical to the pre-optimization output. Interior anchors
        // are a loud, rare error condition, so the perf hit is irrelevant.
        let has_interior_anchor = {
            let _perf = crate::perf::span("stale.scan-interior-anchors");
            crate::cli::interior_anchor::scope_has_interior_anchor(
                repo,
                mesh_root,
                scoped_mesh_names.as_ref(),
            )?
        };
        // `apply_fix`'s range coalescing is workspace-total: it collapses
        // contiguous/overlapping fresh ranges on a path regardless of
        // drift. A scan's resolved `meshes` omits fully-Fresh meshes (the
        // resolver drops them), so feed apply_fix a complete set —
        // supplement the dropped meshes as all-Fresh `MeshResolved`
        // synthesized from their mesh-file record. This affects apply_fix
        // input only; the rendered view comes from the re-resolve below.
        let fix_input: Vec<MeshResolved> = if args.paths.is_empty() {
            let mut full = meshes.clone();
            let known: HashSet<String> = full.iter().map(|m| m.name.clone()).collect();
            for (name, mesh) in crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0 {
                if known.contains(&name) {
                    continue;
                }
                let anchors = mesh
                    .anchors
                    .iter()
                    .map(|(anchor_id, a)| fresh_anchor_resolved(anchor_id, a))
                    .collect();
                full.push(MeshResolved {
                    name,
                    message: mesh.message,
                    anchors,
                    pending: Vec::new(),
                    follow_moves: mesh.config.follow_moves,
                });
            }
            full
        } else {
            // A named scope already carries each mesh's full anchor set.
            meshes.clone()
        };
        // Source-layer reuse on the warm cache path. The pre-fix resolve only
        // retains `SourceLayers` on the cold (`stale_meshes_inner`) path; on a
        // warm cache_v2 hit (the common case) `pre_fix_source_layers` is None,
        // so the post-fix splice would rebuild the worktree/index `git status`
        // source scan from scratch. Build it ONCE here — before `apply_fix`
        // mutates `.mesh/`, so the scan reflects the pre-fix worktree exactly
        // as the cold-path reuse does — and thread it into the post-fix
        // re-resolve. Skipped when an interior anchor is present (the baseline
        // full re-resolve below must not reuse layers — see the gate above) and
        // when the pre-fix already retained layers (cold path; reuse those).
        //
        // Byte-identical: `from_source_layers` reconstructs the same
        // `EngineState` fields a fresh `EngineState::new` would, and the
        // pre-`apply_fix` worktree status is correct for every post-fix anchor
        // (no anchor path is under `mesh_root`, gated above) — the same
        // soundness argument the cold-path reuse already relies on.
        if pre_fix_source_layers.is_none() && !has_interior_anchor {
            let _perf = crate::perf::span("stale.fix-build-source-layers");
            pre_fix_source_layers = Some(crate::resolver::build_source_layers(repo, options)?);
        }
        let apply_start = crate::perf::enabled().then(std::time::Instant::now);
        let fix_result = super::stale_fix::apply_fix(repo, &fix_input, mesh_root)?;
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
                meshes = stale_meshes(repo, mesh_root, options)?;
            } else {
                let names: Vec<String> = meshes.iter().map(|m| m.name.clone()).collect();
                let resolved = resolve_named_meshes(repo, mesh_root, &names, options)?;
                let mut new_meshes: Vec<MeshResolved> = Vec::with_capacity(resolved.len());
                for (_n, result) in resolved {
                    if let Ok(mesh) = result {
                        new_meshes.push(mesh);
                    }
                }
                meshes = new_meshes;
            }
        } else if args.paths.is_empty() {
            // Re-resolve only the meshes that apply_fix actually rewrote, then
            // splice the results back into the pre-fix set. This avoids a
            // whole-corpus re-resolve for meshes the fix never touched.
            meshes = splice_bare_scan_post_fix(
                repo,
                mesh_root,
                options,
                meshes,
                &fix_result.rewritten_mesh_names,
                pre_fix_source_layers.take(),
            )?;
        } else {
            meshes = splice_named_scope_post_fix(
                repo,
                mesh_root,
                options,
                meshes,
                &fix_result.rewritten_mesh_names,
                pre_fix_source_layers.take(),
            )?;
        }
        sort_meshes_by_anchor_path(&mut meshes);
        if let Some(start) = post_resolve_start {
            crate::perf::record_fix_post_resolve_ns(start.elapsed().as_nanos() as u64);
        }
        crate::perf::record_fix_meshes_rewritten_count(fix_result.rewritten_mesh_names.len() as u64);
        fix_result.rewritten_anchor_ids
    } else {
        // File-backed model: no mesh-commit rewrite, so no auto-follow.
        HashSet::new()
    };

    // Human format, workspace scan: each surfaced mesh lists its *complete*
    // anchor set in stored order — drifted anchors keep their resolved
    // finding, fresh siblings render as bare bullets. On the cache_v2 warm
    // path the resolver persists only the non-Fresh finding rows, so
    // `m.anchors` may hold just the drifted subset; reconstruct the full
    // set from the mesh-file record, synthesizing Fresh `AnchorResolved`
    // for anchor ids absent from the resolved subset. Resolved anchors
    // absent from the file record (e.g. injected `MergeConflict` anchors,
    // whose unreadable mesh is skipped by `load_all_meshes_in`) are
    // preserved as-is. Fully-Fresh meshes are not re-added: a scan is a
    // drift report. This is Human-only; other formats stream drifted
    // findings.
    // Skipped on whole-result hit — the cached meshes already include all
    // anchors (Fresh + non-Fresh) backfilled in stored order.
    if matches!(args.format, StaleFormat::Human)
        && args.paths.is_empty()
        && !use_whole_result
    {
        let _perf = crate::perf::span("stale.backfill-fresh-anchors");
        // Drift-report contract: a scan shows a mesh iff it has a non-Fresh
        // anchor or a drifting pending entry. The all-layers discovery path
        // (`needs_all_layers`, Human-only) can return meshes that re-resolve
        // fully Fresh — the machine renderers never show them because they
        // emit drift findings only. Enforce the same predicate here so a
        // backfilled fresh mesh cannot leak into the human scan.
        meshes.retain(|m| {
            m.anchors
                .iter()
                .any(|a| a.status != AnchorStatus::Fresh)
                || !m.pending.is_empty()
        });
        let file_records: std::collections::HashMap<String, crate::types::Mesh> =
            crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0
                .into_iter()
                .collect();
        for m in meshes.iter_mut() {
            let Some(record) = file_records.get(&m.name) else {
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
        // Re-sort: backfilled fresh anchors can change a mesh's
        // anchor-path sort key.
        sort_meshes_by_anchor_path(&mut meshes);
    }

    // Adapter: engine output (`MeshResolved`) → renderer input
    // (`Finding` / `PendingFinding`). The adapter is a pure data shape
    // transform; semantics live in the engine.
    //
    // Per-layer expansion: each non-Fresh anchor emits one `Finding` per
    // drifting layer in `layer_sources` (shallow-to-deep: I → W → H).
    // Terminal statuses (Deleted, Conflict, Submodule,
    // ContentUnavailable) have an empty `layer_sources` and emit exactly
    // one row with `source=None`. MOVED also emits one row.
    let (findings, pending): (Vec<Finding>, Vec<PendingFinding>) = {
        let _perf = crate::perf::span("stale.build-findings");
        let findings: Vec<Finding> = meshes
            .iter()
            .flat_map(|m| {
                m.anchors
                    .iter()
                    .filter(|r| r.status != AnchorStatus::Fresh)
                    .flat_map(|r| {
                        let ack = r.acknowledged_by.clone();
                        if r.layer_sources.is_empty() {
                            // Terminal status or MOVED with no tracked layer:
                            // emit one row with the stored source.
                            vec![Finding {
                                mesh: m.name.clone(),
                                anchor_id: r.anchor_id.clone(),
                                status: r.status.clone(),
                                source: r.source,
                                anchored: r.anchored.clone(),
                                current: r.current.clone(),
                                acknowledged_by: ack,
                                locus: r.locus,
                            }]
                        } else {
                            // Emit one Finding per drifting layer.
                            r.layer_sources
                                .iter()
                                .map(|&src| Finding {
                                    mesh: m.name.clone(),
                                    anchor_id: r.anchor_id.clone(),
                                    status: r.status.clone(),
                                    source: Some(src),
                                    anchored: r.anchored.clone(),
                                    current: r.current.clone(),
                                    acknowledged_by: ack.clone(),
                                    locus: if src == DriftSource::Head {
                                        r.locus
                                    } else {
                                        None
                                    },
                                })
                                .collect()
                        }
                    })
            })
            .collect();
        let pending: Vec<PendingFinding> = meshes
            .iter()
            .flat_map(|m| m.pending.iter().cloned())
            .collect();
        (findings, pending)
    };

    // Plan §B3: an acknowledged finding does not drive exit code; nor
    // does a `ContentUnavailable` finding under `--ignore-unavailable`.
    // Followed Moved findings are also subtracted: we just rewrote them so
    // they are logically Fresh for this invocation's exit code.
    let unacked_findings: usize = findings
        .iter()
        .filter(|f| {
            if f.acknowledged_by.is_some() {
                return false;
            }
            if args.ignore_unavailable && matches!(f.status, AnchorStatus::ContentUnavailable(_)) {
                return false;
            }
            if followed_ids.contains(&f.anchor_id) {
                return false;
            }
            true
        })
        .count();
    // Pending ops with sidecar drift (mismatch or tampered) drive exit code:
    // a tampered or mismatched sidecar is a real integrity problem callers
    // must surface (`<fail-closed>`). Clean pending ops do not.
    let drifting_pending: usize = pending
        .iter()
        .filter(|p| {
            matches!(
                p,
                PendingFinding::Add { drift: Some(_), .. }
                    | PendingFinding::Remove { drift: Some(_), .. }
            )
        })
        .count();
    // Interior-anchor surfacing (CARD AC4: surfaced at stale/validate time).
    // Scanned per-mesh so one poisoned mesh never blanks the others; emitted
    // as a loud, actionable report to stderr (keeping stdout's machine
    // formats clean) and counted into the exit code so the violation cannot
    // report "clean". For a scoped query, only surface meshes in scope.
    // Interior-anchor surfacing: skipped on whole-result hit because the
    // CommittedKey gating guarantees mesh files haven't changed since the
    // cache was stored (fail-closed: any mesh-file change would change
    // mesh_tree_key → miss). The cached result has no violations (they
    // were checked at store time).
    let interior_violations: Vec<crate::cli::interior_anchor::InteriorAnchorViolation> =
        if use_whole_result {
            Vec::new()
        } else {
            let _perf = crate::perf::span("stale.scan-interior-anchors");
            let all = crate::cli::interior_anchor::scan_interior_anchors(repo, mesh_root)?;
            match &scoped_mesh_names {
                None => all,
                Some(names) => all
                    .into_iter()
                    .filter(|v| names.contains(&v.mesh_name))
                    .collect(),
            }
        };
    if !interior_violations.is_empty() {
        eprintln!();
        eprintln!(
            "# mesh stale: {} interior-anchor violation(s)",
            interior_violations.len()
        );
        for v in &interior_violations {
            eprintln!();
            eprintln!("{}", v.report_block(mesh_root));
        }
        eprintln!();
    }

    let stale_count = unacked_findings + drifting_pending;

    match args.format {
        StaleFormat::Human => {
            let _perf = crate::perf::span("stale.render-human");
            let printed = render_human(
                repo,
                &meshes,
                &findings,
                &pending,
                &followed_ids,
                HumanRenderOptions {
                    oneline: args.oneline,
                    stat: args.stat,
                    patch: args.patch,
                    named_lookup: !args.paths.is_empty(),
                },
                &mesh_anchor_totals,
            )?;

            // No-drift message: zero drift prints a summary count line. A
            // full scan reports the whole committed corpus; a scoped query
            // (positional args) reports only the meshes/anchors in scope, so
            // a clean named-mesh or path lookup gets explicit "checked, all
            // clean" feedback rather than empty output. The line fires
            // regardless of whether any mesh block printed.
            if stale_count == 0 {
                let (mesh_count, total_anchors) = match scoped_totals {
                    Some(scope) => scope,
                    None => (total_committed_mesh_count, total_committed_anchor_count),
                };
                let mesh_word = if mesh_count == 1 { "mesh" } else { "meshes" };
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
                    mesh_count, mesh_word, total_anchors, anchor_word,
                );
            }
        }
        StaleFormat::Porcelain => {
            let _perf = crate::perf::span("stale.render-porcelain");
            render_porcelain(&findings, show_src_column);
        }
        StaleFormat::Json => {
            let _perf = crate::perf::span("stale.render-json");
            render_json(&meshes, &findings, &pending, &followed_ids)?;
        }
        StaleFormat::Junit => {
            let _perf = crate::perf::span("stale.render-junit");
            render_junit(&findings);
        }
        StaleFormat::GithubActions => {
            let _perf = crate::perf::span("stale.render-github");
            render_github(&findings);
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

    // `--fix` phase attribution (GIT_MESH_PERF). Emitted only for the `--fix`
    // path and only when perf is enabled, alongside the resolver `session.*`
    // counters already printed by each resolve pass. Splits the `--fix`-specific
    // delta across the pre-fix resolve, `apply_fix`, and the post-fix re-resolve.
    if args.fix && crate::perf::enabled() {
        crate::perf::counter("fix.pre-resolve-us", crate::perf::fix_pre_resolve_us());
        crate::perf::counter("fix.apply-us", crate::perf::fix_apply_us());
        crate::perf::counter("fix.post-resolve-us", crate::perf::fix_post_resolve_us());
        crate::perf::counter("fix.rewritable-anchors", crate::perf::fix_rewritable_anchors());
        crate::perf::counter("fix.hash-calls", crate::perf::fix_hash_calls());
        crate::perf::counter("fix.meshes-rewritten", crate::perf::fix_meshes_rewritten());
    }

    Ok(exit)
}

// ---------------------------------------------------------------------------
// Post-fix scoped splice helpers.
// ---------------------------------------------------------------------------

/// Re-resolve only the meshes that `apply_fix` rewrote and splice the results
/// back into the pre-fix set, for the **bare-scan** arm (`git mesh stale --fix`
/// with no positional paths).
///
/// Bare-scan semantics: drop any rewritten mesh that resolves fully Fresh
/// (mirrors `stale_meshes` which filters via `mesh_is_reportable_in_stale_discovery`).
fn splice_bare_scan_post_fix(
    repo: &gix::Repository,
    mesh_root: &str,
    options: EngineOptions,
    pre_fix_meshes: Vec<MeshResolved>,
    rewritten_names: &HashSet<String>,
    source_layers: Option<SourceLayers>,
) -> Result<Vec<MeshResolved>> {
    if rewritten_names.is_empty() {
        return Ok(pre_fix_meshes);
    }

    let names: Vec<String> = rewritten_names.iter().cloned().collect();
    // Cold path (`Some`): reuse the pre-fix source layers so the post-fix
    // resolve skips a second `read-worktree-layer`. Warm path (`None`): build
    // a fresh `EngineState` (one `read-worktree-layer`, already optimal).
    let post_fix = match source_layers {
        Some(layers) => {
            resolve_named_meshes_with_source_layers(repo, mesh_root, &names, options, layers)?
        }
        None => resolve_named_meshes(repo, mesh_root, &names, options)?,
    };

    // Build a map of Ok results from the post-fix resolve.
    let mut updated: HashMap<String, MeshResolved> = post_fix
        .into_iter()
        .filter_map(|(name, r)| r.ok().map(|m| (name, m)))
        .collect();

    // Bare-scan: keep only reportable meshes (drop fully-Fresh).
    let mut result: Vec<MeshResolved> = pre_fix_meshes
        .into_iter()
        .filter_map(|m| {
            if rewritten_names.contains(&m.name) {
                updated
                    .remove(&m.name)
                    .filter(mesh_is_reportable_in_stale_discovery)
            } else {
                Some(m)
            }
        })
        .collect();

    // Rewritten meshes absent from pre_fix_meshes (coalesce-only on a
    // synthesized all-Fresh fix_input entry): add if now reportable.
    for (_, resolved) in updated {
        if mesh_is_reportable_in_stale_discovery(&resolved) {
            result.push(resolved);
        }
    }

    sort_meshes_by_anchor_path(&mut result);
    Ok(result)
}

/// Re-resolve only the meshes that `apply_fix` rewrote and splice the results
/// back into the pre-fix set, for the **named-scope** arm (`git mesh stale
/// <name> --fix` with positional paths).
///
/// Named-scope semantics: keep ALL meshes including fully-Fresh (rendered as
/// bare bullets). A rewritten mesh that re-resolves as `Err` is dropped,
/// mirroring the current arm's `if let Ok(mesh) = result` pattern.
fn splice_named_scope_post_fix(
    repo: &gix::Repository,
    mesh_root: &str,
    options: EngineOptions,
    pre_fix_meshes: Vec<MeshResolved>,
    rewritten_names: &HashSet<String>,
    source_layers: Option<SourceLayers>,
) -> Result<Vec<MeshResolved>> {
    if rewritten_names.is_empty() {
        // No mesh was rewritten, so the pre-fix resolved set already reflects
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
        return Ok(pre_fix_meshes);
    }

    let names: Vec<String> = rewritten_names.iter().cloned().collect();
    // Cold path (`Some`): reuse the pre-fix source layers so the post-fix
    // resolve skips a second `read-worktree-layer`. Warm path (`None`): build
    // a fresh `EngineState`.
    let post_fix = match source_layers {
        Some(layers) => {
            resolve_named_meshes_with_source_layers(repo, mesh_root, &names, options, layers)?
        }
        None => resolve_named_meshes(repo, mesh_root, &names, options)?,
    };

    // Build a map of Ok results from the post-fix resolve.
    // Err results are absent from this map → dropped on the filter_map below,
    // mirroring the current arm's `if let Ok(mesh) = result { push }`.
    let mut updated: HashMap<String, MeshResolved> = post_fix
        .into_iter()
        .filter_map(|(name, r)| r.ok().map(|m| (name, m)))
        .collect();

    // Named-scope: keep ALL meshes including fully-Fresh (rendered as bare
    // bullets). A rewritten mesh absent from `updated` (Err path) is dropped.
    let mut result: Vec<MeshResolved> = pre_fix_meshes
        .into_iter()
        .filter_map(|m| {
            if rewritten_names.contains(&m.name) {
                updated.remove(&m.name) // None = Err path → dropped
            } else {
                Some(m)
            }
        })
        .collect();

    // Rewritten meshes not in pre_fix_meshes: add unconditionally (named-scope
    // shows all named meshes). In practice this should not occur because the
    // named scope only includes meshes explicitly requested.
    for (_, resolved) in updated {
        result.push(resolved);
    }

    sort_meshes_by_anchor_path(&mut result);
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

    match &f.status {
        AnchorStatus::Changed => super::drift_label::format_drift_label(
            &f.status,
            f.source,
            f.locus.as_ref(),
            f.current.is_some(),
        ),
        AnchorStatus::Moved => {
            // Relocation provenance is the move itself, not a per-layer
            // edit; omit the layer phrase so a committed `git mv` is not
            // mislabeled "in the working tree".
            if let Some(cur) = &f.current {
                let dest = render_path_extent_plain(&cur.path, cur.extent);
                format!("moved to {dest}")
            } else {
                "moved".to_string()
            }
        }
        AnchorStatus::Deleted => super::drift_label::format_drift_label(
            &f.status,
            f.source,
            f.locus.as_ref(),
            f.current.is_some(),
        ),
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
    }
}

fn status_str(s: &AnchorStatus) -> &'static str {
    match s {
        AnchorStatus::Fresh => "FRESH",
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

/// Synthesize a `Fresh` `AnchorResolved` straight from a mesh-file anchor
/// record. Used to reconstruct anchors the resolver omitted: fully-Fresh
/// meshes fed to `apply_fix`, and fresh sibling anchors of a stale mesh on
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
        acknowledged_by: None,
        locus: None,
    }
}

fn render_human(
    repo: &gix::Repository,
    meshes: &[MeshResolved],
    findings: &[Finding],
    pending: &[PendingFinding],
    followed_ids: &HashSet<String>,
    options: HumanRenderOptions,
    mesh_anchor_totals: &std::collections::HashMap<String, usize>,
) -> Result<bool> {
    // named_lookup: true when positional args were given (named lookup mode).
    // For workspace scan: suppress clean meshes and pending bullets.
    // For named lookup: always render block, append pending bullets.
    let is_named_lookup = options.named_lookup;

    let mut printed_any_mesh = false;
    for m in meshes.iter() {
        // Build per-mesh collapsed findings (one row per anchor, deepest layer).
        let mesh_findings_owned: Vec<Finding> = m
            .anchors
            .iter()
            .flat_map(|r| {
                if r.status == AnchorStatus::Fresh {
                    vec![Finding {
                        mesh: m.name.clone(),
                        anchor_id: r.anchor_id.clone(),
                        status: AnchorStatus::Fresh,
                        source: None,
                        anchored: r.anchored.clone(),
                        current: r.current.clone(),
                        acknowledged_by: r.acknowledged_by.clone(),
                        locus: None,
                    }]
                } else {
                    // Collapse per-layer expansions to a single row per
                    // anchor, picking the deepest drifting source
                    // (Worktree > Index > HEAD).
                    let deepest = findings
                        .iter()
                        .filter(|f| f.mesh == m.name && f.anchor_id == r.anchor_id)
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
        let mesh_findings: Vec<&Finding> = mesh_findings_owned.iter().collect();
        let mesh_pending: Vec<&PendingFinding> = pending
            .iter()
            .filter(|p| pending_mesh(p) == m.name.as_str())
            .collect();

        let mesh_stale = mesh_findings
            .iter()
            .filter(|f| f.status != AnchorStatus::Fresh)
            .count();

        // All meshes are printed regardless of drift state — Fresh anchors
        // render as bare bullets so a scan with no drift still shows what
        // is tracked. Named-lookup behavior is unchanged.
        let _ = mesh_stale;

        if printed_any_mesh {
            println!();
            println!("---");
            println!();
        }
        printed_any_mesh = true;

        if options.oneline {
            for f in &mesh_findings {
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
            let stale_findings: Vec<&Finding> = mesh_findings
                .iter()
                .copied()
                .filter(|f| f.status != AnchorStatus::Fresh)
                .collect();
            // The mesh's *full* anchor total comes from the mesh-file
            // read, not from `mesh_findings`: on the cache_v2 path
            // `m.anchors` holds only the stale subset, so
            // `mesh_findings.len()` would equal `mesh_stale` and the
            // heading would falsely read "All anchors … are stale" even
            // when Fresh sibling anchors exist. Fall back to the
            // resolved count only when the mesh is absent from the map
            // (e.g. a staging-only mesh with no committed anchors).
            let mesh_total = mesh_anchor_totals
                .get(m.name.as_str())
                .copied()
                .unwrap_or(mesh_findings.len());
            if mesh_stale > 0 && mesh_stale == mesh_total {
                println!("All anchors in {} are stale:", m.name);
            } else if mesh_stale > 0 {
                println!(
                    "{} of {} anchors in {} are stale:",
                    mesh_stale, mesh_total, m.name
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
        // Shape: ## <mesh-name>
        //        - <plain-path-extent>[ — <status>][ — auto-updated][ — acknowledged]
        //        (blank line)
        //        <why text>

        println!("## {}", m.name);

        // Named lookup only: count pending add/remove bullets.
        let pending_add_remove: Vec<&PendingFinding> = if is_named_lookup {
            mesh_pending
                .iter()
                .filter(|p| {
                    matches!(
                        p,
                        PendingFinding::Add { .. } | PendingFinding::Remove { .. }
                    )
                })
                .copied()
                .collect()
        } else {
            Vec::new()
        };

        if m.anchors.is_empty() && pending_add_remove.is_empty() {
            println!("*Mesh has no anchors*");
        } else {
            // Committed anchors in stored order.
            for f in &mesh_findings {
                let addr = render_path_extent_plain(&f.anchored.path, f.anchored.extent);
                if f.status == AnchorStatus::Fresh {
                    println!("- {addr}");
                } else {
                    let is_followed = followed_ids.contains(&f.anchor_id);
                    let desc = describe_finding_lower(f);
                    let auto_tag = if is_followed { " — auto-updated" } else { "" };
                    let ack_tag = if f.acknowledged_by.is_some() {
                        " — acknowledged"
                    } else {
                        ""
                    };
                    println!("- {addr} — {desc}{auto_tag}{ack_tag}");
                    if options.patch {
                        let diff = render_patch(repo, f);
                        if !diff.trim().is_empty() {
                            println!("{diff}");
                        }
                    }
                }
            }

            // Named lookup only: append pending bullets after committed anchors.
            for p in &pending_add_remove {
                match p {
                    PendingFinding::Add { op, drift, .. } => {
                        let path = std::path::Path::new(&op.path);
                        let addr = render_path_extent_plain(path, op.extent);
                        let suffix = pending_drift_suffix(drift.as_ref());
                        println!("- {addr} — pending add{suffix}");
                    }
                    PendingFinding::Remove { op, drift, .. } => {
                        let path = std::path::Path::new(&op.path);
                        let addr = render_path_extent_plain(path, op.extent);
                        let suffix = pending_drift_suffix(drift.as_ref());
                        println!("- {addr} — pending remove{suffix}");
                    }
                    _ => {}
                }
            }
        }

        // Why text: print verbatim after a blank line if non-empty.
        let why = m.message.trim_end_matches('\n');
        if !why.is_empty() {
            println!();
            println!("{why}");
        }
    }
    Ok(printed_any_mesh)
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
/// extent. Shared with `git mesh history`'s `current` section so the two
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

fn pending_drift_suffix(drift: Option<&PendingDrift>) -> &'static str {
    match drift {
        Some(PendingDrift::SidecarMismatch) => " (sidecar mismatch)",
        Some(PendingDrift::SidecarTampered) => " (sidecar tampered)",
        None => "",
    }
}

fn pending_mesh(p: &PendingFinding) -> &str {
    match p {
        PendingFinding::Add { mesh, .. }
        | PendingFinding::Remove { mesh, .. }
        | PendingFinding::Why { mesh, .. }
        | PendingFinding::ConfigChange { mesh, .. } => mesh,
    }
}

// ---------------------------------------------------------------------------
// Porcelain renderer.
// ---------------------------------------------------------------------------

fn render_porcelain(findings: &[Finding], show_src: bool) {
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
            let mut src = source_marker(f.source).to_string();
            if f.acknowledged_by.is_some() {
                src.push_str("/ack");
            }
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                status_str(&f.status),
                src,
                f.mesh,
                f.anchored.path.display(),
                start_col,
                end_col,
            );
        } else {
            println!(
                "{}\t{}\t{}\t{}\t{}",
                status_str(&f.status),
                f.mesh,
                f.anchored.path.display(),
                start_col,
                end_col,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// JSON renderer (`{ "schema_version": 1, findings, pending }`).
// ---------------------------------------------------------------------------

fn render_json(
    meshes: &[MeshResolved],
    findings: &[Finding],
    pending: &[PendingFinding],
    followed_ids: &HashSet<String>,
) -> Result<()> {
    if findings.is_empty() && pending.is_empty() {
        return Ok(());
    }
    let v = json!({
        "schema_version": 2,
        "mesh": meshes.first().map(|m| m.name.clone()).unwrap_or_default(),
        "findings": findings.iter().map(|f| finding_json(f, followed_ids)).collect::<Vec<_>>(),
        "pending": pending.iter().map(pending_json).collect::<Vec<_>>(),
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
            json!({
                "path": loc.path.display().to_string(),
                "extent": extent_json(loc.extent),
            })
        })
    } else {
        None
    };
    let auto_followed = followed_ids.contains(&f.anchor_id);
    json!({
        "mesh": f.mesh,
        "status": status_json(&f.status),
        "source": f.source.map(|s| match s {
            DriftSource::Head => "HEAD",
            DriftSource::Index => "INDEX",
            DriftSource::Worktree => "WORKTREE",
        }),
        "anchored": location_json(&f.anchored),
        "current": f.current.as_ref().map(location_json),
        "moved_to": moved_to,
        "auto_followed": if auto_followed { Value::Bool(true) } else { Value::Null },
        "acknowledged_by": f.acknowledged_by.as_ref().map(staged_op_ref_json),
        "locus": match f.locus {
            Some(DriftLocus::ChangedAt(oid)) => json!({ "changed_in": oid.to_string() }),
            Some(DriftLocus::OrphanedAt(oid)) => json!({ "deleted_in": oid.to_string() }),
            None => Value::Null,
        },
    })
}

fn staged_op_ref_json(s: &StagedOpRef) -> Value {
    json!({ "mesh": s.mesh, "index": s.index })
}

fn staged_add_json(a: &StagedAdd) -> Value {
    json!({
        "line_number": a.line_number,
        "path": a.path,
        "extent": extent_json(a.extent),
        "anchor": a.anchor,
    })
}

fn staged_remove_json(r: &StagedRemove) -> Value {
    json!({
        "path": r.path,
        "extent": extent_json(r.extent),
    })
}

fn staged_config_json(c: &StagedConfig) -> Value {
    match c {
        StagedConfig::CopyDetection(cd) => json!({
            "kind": "copy_detection",
            "value": format!("{cd:?}"),
        }),
        StagedConfig::IgnoreWhitespace(b) => json!({
            "kind": "ignore_whitespace",
            "value": b,
        }),
        StagedConfig::FollowMoves(b) => json!({
            "kind": "follow_moves",
            "value": b,
        }),
    }
}

fn drift_json(d: Option<&PendingDrift>) -> Value {
    match d {
        Some(PendingDrift::SidecarMismatch) => json!("SIDECAR_MISMATCH"),
        Some(PendingDrift::SidecarTampered) => json!("SIDECAR_TAMPERED"),
        None => Value::Null,
    }
}

fn pending_json(p: &PendingFinding) -> Value {
    match p {
        PendingFinding::Add {
            mesh,
            anchor_id,
            op,
            drift,
        } => json!({
            "kind": "add",
            "mesh": mesh,
            "anchor_id": anchor_id,
            "op": staged_add_json(op),
            "drift": drift_json(drift.as_ref()),
        }),
        PendingFinding::Remove {
            mesh,
            anchor_id,
            op,
            drift,
        } => json!({
            "kind": "remove",
            "mesh": mesh,
            "anchor_id": anchor_id,
            "op": staged_remove_json(op),
            "drift": drift_json(drift.as_ref()),
        }),
        PendingFinding::Why { mesh, body } => json!({
            "kind": "why",
            "mesh": mesh,
            "body": body,
        }),
        PendingFinding::ConfigChange { mesh, change } => json!({
            "kind": "config_change",
            "mesh": mesh,
            "change": staged_config_json(change),
        }),
    }
}

// ---------------------------------------------------------------------------
// JUnit / GitHub Actions renderers.
// ---------------------------------------------------------------------------

fn render_junit(findings: &[Finding]) {
    if findings.is_empty() {
        return;
    }
    println!(
        "<testsuite name=\"git-mesh\" tests=\"{}\" failures=\"{}\">",
        findings.len(),
        findings.len()
    );
    for f in findings {
        let addr = render_path_extent_human(&f.anchored.path, f.anchored.extent);
        let src = source_marker(f.source);
        let ack = if f.acknowledged_by.is_some() {
            " (ack)"
        } else {
            ""
        };
        println!(
            "  <testcase classname=\"{}\" name=\"{} [{}]{}\"><failure message=\"{}\"/></testcase>",
            f.mesh,
            addr,
            src,
            ack,
            status_str(&f.status)
        );
    }
    println!("</testsuite>");
}

fn render_github(findings: &[Finding]) {
    for f in findings {
        let level = match f.status {
            AnchorStatus::Moved => "warning",
            _ => "error",
        };
        let src = source_marker(f.source);
        let ack = if f.acknowledged_by.is_some() {
            " (ack)"
        } else {
            ""
        };
        // Whole-file pins omit `,line=N`; line ranges emit the start line.
        let loc = match f.anchored.extent {
            AnchorExtent::WholeFile => format!("file={}", f.anchored.path.display()),
            AnchorExtent::LineRange { start, .. } => {
                format!("file={},line={}", f.anchored.path.display(), start)
            }
        };
        println!(
            "::{level} {}::{} [{}]{}",
            loc,
            status_str(&f.status),
            src,
            ack,
        );
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;
    use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};

    // -----------------------------------------------------------------------
    // Repo fixtures for F1 batch-porcelain staleness-filter tests
    // -----------------------------------------------------------------------

    fn seed_repo() -> (tempfile::TempDir, gix::Repository) {
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "line1\nline2\nline3\n").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
        let repo = gix::open(dir).unwrap();
        (td, repo)
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Write and commit a mesh file with a specific anchor hash.
    fn create_mesh_with_hash(
        repo: &gix::Repository,
        name: &str,
        anchor_path: &str,
        start: u32,
        end: u32,
        hash: &str,
    ) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        let mesh_dir = workdir.join(".mesh");
        std::fs::create_dir_all(&mesh_dir).unwrap();
        let mf = crate::mesh_file::MeshFile {
            anchors: vec![crate::mesh_file::AnchorRecord {
                path: anchor_path.to_string(),
                start_line: start,
                end_line: end,
                algorithm: RK64_ALGORITHM.to_string(),
                content_hash: hash.to_string(),
            }],
            why: format!("mesh {name}"),
        };
        std::fs::write(mesh_dir.join(name), mf.serialize()).unwrap();
        run_git(&workdir, &["add", "-A"]);
        run_git(&workdir, &["commit", "-m", &format!("add mesh {name}")]);
    }

    /// Compute the rk64 fingerprint of lines [start..=end] of a string
    /// (1-based), using the same joining convention as the stale engine
    /// (`join("\n")` with no trailing newline).
    fn hash_lines(content: &str, start: u32, end: u32) -> String {
        let start_idx = (start - 1) as usize;
        let count = (end - start + 1) as usize;
        let excerpt: String = content
            .lines()
            .skip(start_idx)
            .take(count)
            .collect::<Vec<_>>()
            .join("\n");
        rk64_to_hex(cheap_fingerprint_with_extent(
            excerpt.as_bytes(),
            &crate::types::AnchorExtent::WholeFile,
        ))
    }

    fn default_stale_args() -> crate::cli::StaleArgs {
        crate::cli::StaleArgs {
            paths: vec![],
            format: crate::cli::StaleFormat::Human,
            no_exit_code: false,
            head: false,
            staged: false,
            worktree: false,
            no_worktree: false,
            no_index: false,
            no_staged_mesh: false,
            ignore_unavailable: false,
            oneline: false,
            stat: false,
            patch: false,
            since: None,
            perf_trace: None,
            fix: false,
            batch: true,
            porcelain: true,
        }
    }

    /// Collect all rows emitted by `run_stale_batch_porcelain` for the
    /// given filter lines. We intercept stdout using a pipe-based approach:
    /// since the function writes to stdout directly, we use the internal
    /// helper directly and capture output by redirecting stdout isn't
    /// straightforward. Instead, call `stale_meshes` directly and apply
    /// the filter logic ourselves (mirrors the implementation).
    fn stale_batch_rows(
        repo: &gix::Repository,
        args: &crate::cli::StaleArgs,
        mesh_root: &str,
        filters: &[&str],
    ) -> Vec<(String, String, String)> {
        use crate::cli::show::{BatchFilter, merge_batch_filters};

        let layers = if args.head {
            LayerSet { worktree: false, index: false, staged_mesh: !args.no_staged_mesh }
        } else if args.staged {
            LayerSet { worktree: false, index: true, staged_mesh: !args.no_staged_mesh }
        } else if args.worktree {
            LayerSet { worktree: true, index: true, staged_mesh: !args.no_staged_mesh }
        } else {
            LayerSet {
                worktree: !args.no_worktree,
                index: !args.no_index,
                staged_mesh: !args.no_staged_mesh,
            }
        };
        let options = crate::types::EngineOptions {
            layers,
            ignore_unavailable: args.ignore_unavailable,
            since: None,
            needs_all_layers: false,
        };

        let stale_resolved = stale_meshes(repo, mesh_root, options).unwrap();

        // Parse filter lines.
        let mut filters_by_path: std::collections::HashMap<String, Vec<BatchFilter>> =
            std::collections::HashMap::new();
        let mut path_order: Vec<String> = Vec::new();
        for &line in filters {
            let line = line.trim_end();
            if line.is_empty() {
                continue;
            }
            let filter = BatchFilter::parse(line).unwrap();
            let path = filter.path().to_string();
            if !filters_by_path.contains_key(&path) {
                path_order.push(path.clone());
            }
            filters_by_path.entry(path).or_default().push(filter);
        }

        let mut rows = Vec::new();
        for path in &path_order {
            let filters = filters_by_path.get(path).unwrap();
            let (merged_path, ranges) = merge_batch_filters(filters);

            for mesh in &stale_resolved {
                for anchor in &mesh.anchors {
                    if anchor.status == AnchorStatus::Fresh {
                        continue;
                    }
                    let anchor_path = anchor.anchored.path.to_string_lossy().to_string();
                    let matched = match &ranges {
                        None => anchor_path == merged_path,
                        Some(ranges) => {
                            anchor_path == merged_path
                                && ranges.iter().any(|(s, e)| {
                                    match anchor.anchored.extent {
                                        AnchorExtent::WholeFile => false,
                                        AnchorExtent::LineRange {
                                            start: a_start,
                                            end: a_end,
                                        } => a_start <= *e && a_end >= *s,
                                    }
                                })
                        }
                    };
                    if !matched {
                        continue;
                    }
                    let extent_str = match anchor.anchored.extent {
                        AnchorExtent::LineRange { start, end } => format!("{start}-{end}"),
                        AnchorExtent::WholeFile => "0-0".to_string(),
                    };
                    rows.push((mesh.name.clone(), anchor_path, extent_str));
                }
            }
        }
        rows
    }

    // F1 test 1: fresh mesh whose anchor overlaps a filter → NO row emitted.
    #[test]
    fn stale_batch_fresh_mesh_no_row() {
        let (_td, repo) = seed_repo();
        let content = "line1\nline2\nline3\n";
        let hash = hash_lines(content, 1, 3);
        create_mesh_with_hash(&repo, "fresh-mesh", "a.txt", 1, 3, &hash);

        let args = default_stale_args();
        let rows = stale_batch_rows(&repo, &args, ".mesh", &["a.txt#L1-L3"]);
        assert!(
            rows.is_empty(),
            "expected no rows for fresh mesh, got: {rows:?}"
        );
    }

    // F1 test 2: drifted mesh whose anchor overlaps a filter → row emitted.
    #[test]
    fn stale_batch_drifted_mesh_overlapping_filter_emits_row() {
        let (_td, repo) = seed_repo();
        // Deliberately wrong hash → engine will flag as Changed.
        let bad_hash = "0".repeat(64);
        create_mesh_with_hash(&repo, "drifted-mesh", "a.txt", 1, 3, &bad_hash);

        let args = default_stale_args();
        let rows = stale_batch_rows(&repo, &args, ".mesh", &["a.txt#L1-L3"]);
        assert_eq!(rows.len(), 1, "expected one row for drifted mesh, got: {rows:?}");
        assert_eq!(rows[0].0, "drifted-mesh");
        assert_eq!(rows[0].1, "a.txt");
        assert_eq!(rows[0].2, "1-3");
    }

    // F1 test 3: drifted mesh whose anchor does NOT overlap any filter → NO row.
    #[test]
    fn stale_batch_drifted_mesh_non_overlapping_filter_no_row() {
        let (_td, repo) = seed_repo();
        let bad_hash = "0".repeat(64);
        // Anchor is on lines 1-3 of a.txt; filter is on lines 10-20.
        create_mesh_with_hash(&repo, "drifted-mesh", "a.txt", 1, 3, &bad_hash);

        let args = default_stale_args();
        let rows = stale_batch_rows(&repo, &args, ".mesh", &["a.txt#L10-L20"]);
        assert!(
            rows.is_empty(),
            "expected no rows when filter does not overlap drifted anchor, got: {rows:?}"
        );
    }

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
