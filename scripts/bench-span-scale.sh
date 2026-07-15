#!/usr/bin/env bash
# Scale benchmark for git-span operation latency across committed span counts,
# anchors-per-span, anchor mixes, and the downstream wiki coverage workload.
#
# This companion harness uses a synthetic repository so 100/1,000/10,000 span
# runs are reproducible without depending on a large external clone. It drives
# the git-span binary on PATH and writes a CSV plus a Markdown summary.
#
# Card main-157 Phase 0 note: this script previously aborted immediately on
# the first removed `git-span commit` reference (no such subcommand exists;
# spans are `.span/<name>` files persisted with plain `git add .span && git
# commit`) and produced no CSV. It also referenced removed `restore`,
# `pre-commit`, and `ls` subcommands, and benchmarked `refs/span` maintenance
# that no longer applies (spans are files, not refs). All of that is fixed
# here — see `notes/benchmark-evidence.md` (card main-157) for the failure
# evidence this repair addresses.

set -euo pipefail

SPAN_COUNTS=(100 1000 10000)
ANCHORS_PER_SPAN=(2 3 4 5)
EDGE_ANCHORS=()
ITERATIONS=3
WIKI_QUERIES=50
ANCHOR_MIX="mixed"
OUT_CSV="./bench-span-scale.csv"
KEEP_FIXTURE=0
RUN_MAINTENANCE=0
PACK_REFS=0

# ----------------------------- Cache-mode controls -----------------------------
#
# Same seven named cache states as `bench-span.sh` — see that script's
# "Cache-mode controls" section for the full rationale. There is one cache and
# one switch: `GIT_SPAN_CACHE=0` disables the single SQLite store
# (`<git_dir>/span/store.db`); every other mode reaches its named state by
# ACTIONS (delete/prime/commit/dirty) against that one store.
#
#   all-off              -- the one store disabled (ground truth / oracle)
#   exact-cold            -- persistent tiers live, but cache deleted before each sample
#   exact-warm              -- persistent tiers live, cache primed once before sampling
#   incremental-ancestor    -- warm cache, then an unrelated commit lands before sampling
#   dirty-exact              -- warm cache, then the anchored source itself is dirtied
#   dirty-affected           -- warm cache, then an UNRELATED tracked file is dirtied
#   concurrent-miss          -- cold cache, N processes race `stale` against the same missing key
CACHE_MODE="${CACHE_MODE:-exact-warm}"
CONCURRENT_MISS_PROCS="${CONCURRENT_MISS_PROCS:-4}"

usage() {
  cat <<EOF
Usage: $0 [options]

  --iterations N          samples per operation cell (default: $ITERATIONS)
  --span-counts a,b,c     span-count tiers (default: ${SPAN_COUNTS[*]})
  --anchors a,b,c         anchors-per-span tiers (default: ${ANCHORS_PER_SPAN[*]})
  --edge                  include edge anchor tiers 10,20,120
  --anchor-mix MIX        line, whole, or mixed (default: $ANCHOR_MIX)
  --wiki-queries N        process-per-query wiki coverage samples (default: $WIKI_QUERIES)
  --pack-refs             run git pack-refs --all after seeding
  --maintenance           run selected git maintenance tasks after seeding
  --csv PATH              CSV output path (default: $OUT_CSV)
  --keep                  keep scratch repository for profiling
  -h, --help              this help

Env:
  GIT_SPAN_BIN            git-span binary path (default: first git-span on PATH)
  CACHE_MODE              one of: all-off exact-cold exact-warm incremental-ancestor
                          dirty-exact dirty-affected concurrent-miss (default: $CACHE_MODE)
  CONCURRENT_MISS_PROCS   process count for concurrent-miss mode (default: $CONCURRENT_MISS_PROCS)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iterations) ITERATIONS="$2"; shift 2;;
    --span-counts) IFS=, read -r -a SPAN_COUNTS <<<"$2"; shift 2;;
    --anchors) IFS=, read -r -a ANCHORS_PER_SPAN <<<"$2"; shift 2;;
    --edge) EDGE_ANCHORS=(10 20 120); shift;;
    --anchor-mix) ANCHOR_MIX="$2"; shift 2;;
    --wiki-queries) WIKI_QUERIES="$2"; shift 2;;
    --pack-refs) PACK_REFS=1; shift;;
    --maintenance) RUN_MAINTENANCE=1; shift;;
    --csv) OUT_CSV="$2"; shift 2;;
    --keep) KEEP_FIXTURE=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "unknown option: $1" >&2; usage; exit 2;;
  esac
done

case "$ANCHOR_MIX" in
  line|whole|mixed) ;;
  *) echo "invalid --anchor-mix: $ANCHOR_MIX" >&2; exit 2;;
esac

case "$CACHE_MODE" in
  all-off|exact-cold|exact-warm|incremental-ancestor|dirty-exact|dirty-affected|concurrent-miss) ;;
  *)
    echo "invalid CACHE_MODE: $CACHE_MODE (want one of: all-off exact-cold exact-warm incremental-ancestor dirty-exact dirty-affected concurrent-miss)" >&2
    exit 2
    ;;
esac

# `all-off` is the only mode that overrides the environment — every other
# mode reaches its named state via actions (delete/prime/commit/dirty). A
# plain `export` (not `env KEY=VAL some_fn`) is required because `timed()`
# below is a shell FUNCTION and `env` cannot see shell functions.
if [[ "$CACHE_MODE" == "all-off" ]]; then
  export GIT_SPAN_CACHE=0
fi

if [[ ${#EDGE_ANCHORS[@]} -gt 0 ]]; then
  ANCHORS_PER_SPAN+=("${EDGE_ANCHORS[@]}")
fi

GIT_SPAN_BIN="${GIT_SPAN_BIN:-$(command -v git-span || true)}"
[[ -n "$GIT_SPAN_BIN" ]] || { echo "git-span not on PATH" >&2; exit 1; }
command -v git >/dev/null || { echo "git not on PATH" >&2; exit 1; }

WORK_ROOT="$(mktemp -d -t git-span-scale-XXXXXX)"
cleanup() {
  if [[ "$KEEP_FIXTURE" -eq 0 ]]; then
    rm -rf "$WORK_ROOT"
  else
    echo "kept scratch: $WORK_ROOT" >&2
  fi
}
trap cleanup EXIT

stats() {
  printf '%s\n' "$@" | sort -n | awk '
    function pct(p,    rank, lo, hi, frac) {
      if (n == 1) return a[1]
      rank = p * (n - 1) + 1
      lo = int(rank); hi = lo + 1; frac = rank - lo
      if (hi > n) hi = n
      return a[lo] + frac * (a[hi] - a[lo])
    }
    { n++; a[n] = $1; sum += $1 }
    END {
      if (n == 0) { print "0 0 0 0 0 0 0"; exit }
      mean = sum / n
      median = (n % 2) ? a[int((n+1)/2)] : (a[n/2] + a[n/2+1]) / 2
      printf "%d %.6f %.6f %.6f %.6f %.6f %.6f\n", n, sum / n, median, pct(0.95), pct(0.99), a[1], a[n]
    }'
}

# Time a command in seconds with sub-millisecond resolution, PROPAGATING its
# real exit status.
#
# Usage: timed <accepted-exit-codes-csv> -- <command...>
# `accepted-exit-codes-csv` is a comma-separated allowlist (e.g. "0" or
# "0,1"); the command's actual exit code must be one of these for the sample
# to count. On an unaccepted exit code this prints nothing and returns
# non-zero — the caller must check `timed`'s own exit status rather than just
# consuming its stdout, or a masked failure silently becomes a "0.000000"
# sample the way the old `timed()` always did via `awk`'s unconditional
# success.
timed() {
  local accepted="$1"; shift
  [[ "$1" == "--" ]] || { echo "timed: expected -- before command" >&2; return 2; }
  shift
  local t0 t1 rc
  t0=$(date +%s.%N)
  "$@" >/dev/null 2>&1
  rc=$?
  t1=$(date +%s.%N)
  local ok=0 code
  IFS=, read -r -a accepted_arr <<<"$accepted"
  for code in "${accepted_arr[@]}"; do
    [[ "$rc" -eq "$code" ]] && ok=1 && break
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "timed: command exited $rc (accepted: $accepted): $*" >&2
    return 1
  fi
  awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.6f", b - a }'
}

# Delete the one persistent cache: the SQLite store
# (`<git_dir>/span/store.db` plus its WAL/SHM sidecars). This is the whole
# cache footprint — the Phase 7 cutover deleted both legacy tiers (the
# `resolver/cache` filesystem dir and the `resolver/cache_v2` `stale-cache.db`),
# so there is nothing else to clear. Deleting the store makes the next sample a
# genuine cold start (the historical "cold" hazard — a sibling tier left warm,
# `notes/investigation-question-log.md` Step 2 — cannot recur with one tier).
clear_all_cache_tiers() {
  local repo="$1"
  rm -f "$repo/.git/span/store.db" \
        "$repo/.git/span/store.db-wal" \
        "$repo/.git/span/store.db-shm"
}

create_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init --quiet
  git -C "$repo" config user.email bench@example.com
  git -C "$repo" config user.name "bench"
  mkdir -p "$repo/src" "$repo/docs/wiki"
  local i
  for (( i = 0; i < 256; i++ )); do
    printf -v file_suffix '%03d' "$i"
    {
      printf 'pub fn module_%03d() -> u32 {\n' "$i"
      local line
      for (( line = 1; line <= 240; line++ )); do
        printf '    let value_%03d_%03d = %d;\n' "$i" "$line" "$line"
      done
      printf '    0\n}\n'
    } >"$repo/src/module_${file_suffix}.rs"
    printf '# Wiki %03d\n\nFragment links for module %03d.\n' "$i" "$i" >"$repo/docs/wiki/page_${file_suffix}.md"
  done
  git -C "$repo" add .
  git -C "$repo" commit --quiet -m "seed synthetic scale repo"
}

anchor_for() {
  local span_idx="$1" anchor_idx="$2" anchors_per="$3"
  local file_idx=$(((span_idx + anchor_idx) % 256))
  if [[ "$ANCHOR_MIX" == "whole" ]]; then
    printf 'src/module_%03d.rs\n' "$file_idx"
    return
  fi
  if [[ "$ANCHOR_MIX" == "mixed" && "$anchor_idx" -eq 0 ]]; then
    printf 'docs/wiki/page_%03d.md\n' "$file_idx"
    return
  fi
  if [[ "$ANCHOR_MIX" == "mixed" && "$anchors_per" -gt 2 && "$anchor_idx" -eq $((anchors_per - 1)) ]]; then
    printf 'src/module_%03d.rs\n' "$file_idx"
    return
  fi
  local start=$((2 + ((span_idx + anchor_idx * 13) % 180)))
  local end=$((start + 4))
  printf 'src/module_%03d.rs#L%d-L%d\n' "$file_idx" "$start" "$end"
}

# Seed `spans` committed spans (untimed setup). Persistence is `.span/<name>`
# files staged and committed with plain git — there is no `git-span commit`
# subcommand.
seed_spans() {
  local repo="$1" spans="$2" anchors_per="$3"
  local i j name
  for (( i = 0; i < spans; i++ )); do
    name="scale-${i}"
    anchors=()
    for (( j = 0; j < anchors_per; j++ )); do
      anchors+=("$(anchor_for "$i" "$j" "$anchors_per")")
    done
    (
      cd "$repo"
      "$GIT_SPAN_BIN" add "$name" "${anchors[@]}" >/dev/null
      "$GIT_SPAN_BIN" why "$name" -m "Synthetic scale span $i" >/dev/null
      git add .span >/dev/null
      git commit --quiet -m "bench: seed span $name" >/dev/null
    )
    if (( i > 0 && i % 1000 == 0 )); then
      echo "      seeded $i spans" >&2
    fi
  done
}

# Discard an uncommitted `.span/<name>` file (the analog of the removed
# `git-span restore` subcommand): if the span is already committed, `git
# checkout` restores the committed version; if it was never committed, `rm
# -f` removes the uncommitted file entirely.
span_discard() {
  local repo="$1" name="$2"
  ( cd "$repo" \
      && { git checkout --quiet -- ".span/${name}" 2>/dev/null || rm -f ".span/${name}"; } )
}

run_maintenance_if_requested() {
  local repo="$1"
  if [[ "$PACK_REFS" -eq 1 ]]; then
    git -C "$repo" pack-refs --all
  fi
  if [[ "$RUN_MAINTENANCE" -eq 1 ]]; then
    git -C "$repo" maintenance run --task=loose-objects --task=incremental-repack --task=commit-graph --task=pack-refs
  fi
}

# Bring `$repo` into the state `$CACHE_MODE` names, using the corpus the
# caller already seeded (`$hit_anchor` is the reader-glob anchor prepared by
# the sweep below). Runs OUTSIDE the timed region for every mode.
apply_cache_mode_state() {
  local repo="$1" hit_anchor="$2"
  case "$CACHE_MODE" in
    all-off)
      # No further setup needed; the exported GIT_SPAN_CACHE=0 above disables
      # the one store for every invocation in this script run.
      clear_all_cache_tiers "$repo"
      ;;
    exact-cold)
      # Each sample independently clears the cache (see the `stale` op case
      # below) so every sample measures a first build.
      clear_all_cache_tiers "$repo"
      ;;
    exact-warm)
      clear_all_cache_tiers "$repo"
      ( cd "$repo" && "$GIT_SPAN_BIN" stale --no-exit-code >/dev/null 2>&1 || true )
      ;;
    incremental-ancestor)
      clear_all_cache_tiers "$repo"
      ( cd "$repo" && "$GIT_SPAN_BIN" stale --no-exit-code >/dev/null 2>&1 || true )
      # An unrelated committed change (no span anchors it) so a warm cache
      # must locate an ancestor generation rather than rebuild from scratch.
      ( cd "$repo" \
          && echo "bench ancestor marker $(date +%s%N)" >>BENCH_UNRELATED_FILE.md \
          && git add BENCH_UNRELATED_FILE.md \
          && git commit --quiet -m "bench: unrelated ancestor commit" )
      ;;
    dirty-exact)
      # `dirty-exact`/`dirty-affected` exercise the store's dirty-overlay
      # path. The store is the only cache and is always active (no selector
      # switch — the Phase 7 cutover removed the development `GIT_SPAN_CACHE_STORE_V3`
      # selector), so priming warm and then dirtying is all these modes need.
      clear_all_cache_tiers "$repo"
      ( cd "$repo" && "$GIT_SPAN_BIN" stale --no-exit-code >/dev/null 2>&1 || true )
      # Dirty exactly the anchored source of the reader-glob anchor.
      local target="${hit_anchor%%#L*}"
      ( cd "$repo" && printf '\n// bench dirty-exact marker\n' >>"$target" )
      ;;
    dirty-affected)
      # Same store dirty-overlay path as `dirty-exact`; no selector switch.
      clear_all_cache_tiers "$repo"
      ( cd "$repo" && "$GIT_SPAN_BIN" stale --no-exit-code >/dev/null 2>&1 || true )
      # Dirty a tracked file NO span anchors, so the affected-set stays small
      # relative to corpus size (the path this card's dirty-reuse work
      # optimizes for).
      ( cd "$repo" && printf '\n# bench dirty-affected marker\n' >>BENCH_DIRTY_AFFECTED.md )
      ;;
    concurrent-miss)
      clear_all_cache_tiers "$repo"
      ;;
  esac
}

CSV_TMP="$(mktemp)"
echo "span_count,anchors_per_span,anchor_mix,layout,cache_mode,op,n,mean_s,median_s,p95_s,p99_s,min_s,max_s" >"$CSV_TMP"

echo "# git-span scale benchmark"
echo
echo "- binary: \`$GIT_SPAN_BIN\`"
echo "- version: \`$("$GIT_SPAN_BIN" --version 2>/dev/null || echo unknown)\`"
echo "- cache mode: $CACHE_MODE"
echo "- iterations: $ITERATIONS"
echo "- span counts: ${SPAN_COUNTS[*]}"
echo "- anchors/span: ${ANCHORS_PER_SPAN[*]}"
echo "- anchor mix: $ANCHOR_MIX"
echo "- wiki queries: $WIKI_QUERIES"
echo "- layout: $([[ "$PACK_REFS" -eq 1 ]] && echo packed-refs || echo loose-refs)$([[ "$RUN_MAINTENANCE" -eq 1 ]] && echo +maintenance || true)"
echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
printf "| spans | anchors | mix | mode | op | n | mean | median | p95 | p99 | min | max |\n"
printf "|---:|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n"

for M in "${SPAN_COUNTS[@]}"; do
  for A in "${ANCHORS_PER_SPAN[@]}"; do
    REPO="$WORK_ROOT/repo-${M}-${A}-${ANCHOR_MIX}"
    echo "==> preparing synthetic repo M=$M A=$A mix=$ANCHOR_MIX mode=$CACHE_MODE" >&2
    create_repo "$REPO"
    seed_spans "$REPO" "$M" "$A"
    run_maintenance_if_requested "$REPO"

    if [[ "$ITERATIONS" -eq 0 ]]; then
      continue
    fi

    hit_anchor="$(anchor_for 0 1 "$A")"
    if [[ "$hit_anchor" != *"#L"* ]]; then
      hit_anchor="src/module_001.rs#L2-L6"
    fi
    miss_anchor="src/no-such-file.rs#L1-L3"
    show_name="scale-0"
    new_name="scale-new-${M}-${A}"
    layout="$([[ "$PACK_REFS" -eq 1 ]] && echo packed-refs || echo loose-refs)"
    [[ "$RUN_MAINTENANCE" -eq 1 ]] && layout="${layout}+maintenance"

    apply_cache_mode_state "$REPO" "$hit_anchor"

    # `commit`, `pre_commit`, and `ls*` operations from the removed CLI are
    # gone — `add`/`why`/`show`/`list`/`stale` are the current `.span/` file
    # lifecycle operations; `list_*` supersedes `ls_*` and `list <glob>`
    # supersedes `ls <glob>`.
    for op in add why show list_all_porcelain list_filtered_hit list_filtered_miss stale wiki_hit_queries wiki_miss_queries; do
      samples=()
      for (( it = 0; it < ITERATIONS; it++ )); do
        t=""
        case "$op" in
          add)
            span_discard "$REPO" "${new_name}-${it}"
            t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" add "${new_name}-${it}" "$(anchor_for "$it" 0 "$A")" "$(anchor_for "$it" 1 "$A")") || continue
            ;;
          why)
            ( cd "$REPO" && "$GIT_SPAN_BIN" add "${new_name}-${it}" "$(anchor_for "$it" 0 "$A")" >/dev/null 2>&1 || true )
            t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" why "${new_name}-${it}" -m "bench why") || continue
            ;;
          show)
            t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" show "$show_name") || continue
            ;;
          list_all_porcelain)
            t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" list --porcelain) || continue
            ;;
          list_filtered_hit)
            t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" list "$hit_anchor" --porcelain) || continue
            ;;
          list_filtered_miss)
            # Current behavior: `list <no-match>` exits 1 (an error, not an
            # empty match) — the ORIGINAL script's bug was assuming this
            # cell always succeeds. Accept 0,1 so a genuine crash (any other
            # code) still fails the sample instead of being masked.
            t=$(cd "$REPO" && timed 0,1 -- "$GIT_SPAN_BIN" list "$miss_anchor" --porcelain) || continue
            ;;
          stale)
            if [[ "$CACHE_MODE" == "exact-cold" ]]; then
              clear_all_cache_tiers "$REPO"
            fi
            if [[ "$CACHE_MODE" == "concurrent-miss" ]]; then
              clear_all_cache_tiers "$REPO"
              # N processes race `stale` against the same missing key; the
              # sample is the WALL time of the slowest racer (what a caller
              # of a stampede actually waits for).
              race_pids=()
              t0=$(date +%s.%N)
              for (( p = 0; p < CONCURRENT_MISS_PROCS; p++ )); do
                ( cd "$REPO" && "$GIT_SPAN_BIN" stale --no-exit-code >/dev/null 2>&1 ) &
                race_pids+=("$!")
              done
              rc=0
              for pid in "${race_pids[@]}"; do
                wait "$pid" || rc=1
              done
              t1=$(date +%s.%N)
              if [[ "$rc" -ne 0 ]]; then
                echo "timed: a concurrent-miss racer exited non-zero" >&2
                continue
              fi
              t=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.6f", b - a }')
            else
              t=$(cd "$REPO" && timed 0 -- "$GIT_SPAN_BIN" stale --no-exit-code) || continue
            fi
            ;;
          wiki_hit_queries)
            t0=$(date +%s.%N)
            wiki_rc=0
            for (( q = 0; q < WIKI_QUERIES; q++ )); do
              query="$(anchor_for "$q" 1 "$A")"
              [[ "$query" == *"#L"* ]] || query="$(printf 'src/module_%03d.rs#L2-L6' $(((q + 1) % 256)))"
              ( cd "$REPO" && "$GIT_SPAN_BIN" list "$query" --porcelain >/dev/null ) || wiki_rc=1
            done
            t1=$(date +%s.%N)
            if [[ "$wiki_rc" -ne 0 ]]; then
              echo "timed: a wiki_hit_queries invocation exited non-zero" >&2
              continue
            fi
            t=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.6f", b - a }')
            ;;
          wiki_miss_queries)
            # Current behavior: `list <no-match>` exits 1 — see
            # `list_filtered_miss` above. Each per-query invocation therefore
            # accepts 0 or 1; only a genuine crash (any other code) fails
            # the sample.
            t0=$(date +%s.%N)
            wiki_rc=0
            for (( q = 0; q < WIKI_QUERIES; q++ )); do
              qrc=0
              ( cd "$REPO" && "$GIT_SPAN_BIN" list "src/missing_$q.rs#L1-L3" --porcelain >/dev/null 2>&1 ) || qrc=$?
              [[ "$qrc" -eq 0 || "$qrc" -eq 1 ]] || wiki_rc=1
            done
            t1=$(date +%s.%N)
            if [[ "$wiki_rc" -ne 0 ]]; then
              echo "timed: a wiki_miss_queries invocation exited an unaccepted code" >&2
              continue
            fi
            t=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.6f", b - a }')
            ;;
        esac
        samples+=("$t")
      done

      if [[ ${#samples[@]} -eq 0 ]]; then
        echo "WARNING: no successful samples for M=$M A=$A mode=$CACHE_MODE op=$op" >&2
        continue
      fi

      read -r n mean median p95 p99 min max < <(stats "${samples[@]}")
      printf "%d,%d,%s,%s,%s,%s,%d,%s,%s,%s,%s,%s,%s\n" \
        "$M" "$A" "$ANCHOR_MIX" "$layout" "$CACHE_MODE" "$op" "$n" "$mean" "$median" "$p95" "$p99" "$min" "$max" >>"$CSV_TMP"
      printf "| %d | %d | %s | %s | %s | %d | %.4f | %.4f | %.4f | %.4f | %.4f | %.4f |\n" \
        "$M" "$A" "$ANCHOR_MIX" "$CACHE_MODE" "$op" "$n" "$mean" "$median" "$p95" "$p99" "$min" "$max"
    done
  done
done

mv "$CSV_TMP" "$OUT_CSV"
echo
echo "CSV written to $OUT_CSV"
