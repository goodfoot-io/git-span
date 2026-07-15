#!/usr/bin/env bash
# Benchmark `git span` operation latency across repo size, span count, and
# anchors-per-span. Drives the `git-span` binary on the user's PATH against
# a locally cached full clone of vercel/next.js.
#
# Outputs a markdown summary to stdout and a CSV file alongside (default
# ./bench-span.csv). Per cell we collect N raw timings and report
# mean / median / p95 / p99 / min / max.
#
# Card main-157 Phase 0 note: this script previously called `git-span commit`
# and `git-span restore`, neither of which exist in the current CLI (spans
# are `.span/<name>` files persisted with plain `git add .span && git
# commit`, not a span-specific commit/restore subcommand), and `timed()`
# always reported success regardless of the wrapped command's real exit
# status. Both are fixed here — see `notes/benchmark-evidence.md` (card
# main-157) for the failure evidence this repair addresses.

set -euo pipefail

# ----------------------------- Configuration ----------------------------------

CACHE_DIR="${BENCH_CACHE_DIR:-/tmp/git-span-bench-cache}"
NEXTJS_URL="${NEXTJS_URL:-https://github.com/vercel/next.js.git}"
NEXTJS_BARE="$CACHE_DIR/next.js.git"

# Three repo-size tiers via Next.js refs (small / medium / large tree).
REFS=(
  "v9.0.0"
  "v13.0.0"
  "canary"
)

# Sweep axes. Override with --span-counts, --anchors, --iterations, --full.
SPAN_COUNTS=(1 10 100)
ANCHORS_PER_SPAN=(2 20)
ITERATIONS=5
OUT_CSV="./bench-span.csv"
# `commit`/`restore`/`pre-commit`/`ls` are not git-span subcommands (removed
# from the CLI, or never existed under those names — see §10.2 in
# src/cli/mod.rs). `add`/`why`/`show`/`list`/`stale` are the current `.span/`
# file lifecycle operations this harness exercises.
OPS=(add why show list stale)
KEEP_FIXTURE=0

# ----------------------------- Cache-mode controls -----------------------------
#
# Seven named cache states, environment/flag-driven. There is one cache and one
# switch: the Phase 7 cutover deleted both legacy caches (`resolver/cache`,
# `resolver/cache_v2`) and their switches, leaving `GIT_SPAN_CACHE=0` as the
# single "disable all caching" control over the one SQLite store
# (`<git_dir>/span/store.db`). Every mode below reaches its named state by
# ACTIONS (cold-delete, warm-prime, ancestor commit, dirtying, concurrent race)
# against that one store; only `all-off` sets the disable switch.
#
#   all-off              -- the one store disabled (ground truth / oracle)
#   exact-cold            -- persistent tiers live, but cache deleted before each sample (first-build/miss path)
#   exact-warm              -- persistent tiers live, cache primed once before sampling (repeat clean-hit path)
#   incremental-ancestor    -- warm cache, then an unrelated commit lands before sampling (ancestor-reuse path)
#   dirty-exact              -- warm cache, then the anchored source itself is dirtied before sampling
#   dirty-affected           -- warm cache, then an UNRELATED tracked file is dirtied before sampling
#   concurrent-miss          -- cold cache, N processes race `stale` against the same missing key
CACHE_MODE="${CACHE_MODE:-exact-warm}"
CONCURRENT_MISS_PROCS="${CONCURRENT_MISS_PROCS:-4}"

case "$CACHE_MODE" in
  all-off|exact-cold|exact-warm|incremental-ancestor|dirty-exact|dirty-affected|concurrent-miss) ;;
  *)
    echo "invalid CACHE_MODE: $CACHE_MODE (want one of: all-off exact-cold exact-warm incremental-ancestor dirty-exact dirty-affected concurrent-miss)" >&2
    exit 2
    ;;
esac

# `all-off` is the only mode that overrides the environment — every other
# mode runs with the store live and reaches its named state via *actions*
# (delete/prime/commit/dirty) in `apply_cache_mode_state()` below. Exported
# once, for the whole script, rather than threaded per-invocation: `timed()`
# below is a shell FUNCTION, so `env KEY=VAL timed ...` would not work (`env`
# execs a new process and cannot see shell functions) — a plain `export` is
# both correct and simpler here since only one mode needs it.
if [[ "$CACHE_MODE" == "all-off" ]]; then
  export GIT_SPAN_CACHE=0
fi

# Delete the one persistent cache: the SQLite store
# (`<git_dir>/span/store.db` plus its WAL/SHM sidecars). This is the whole
# cache footprint — the Phase 7 cutover deleted both legacy tiers (the
# `resolver/cache` filesystem dir and the `resolver/cache_v2` `stale-cache.db`),
# so there is nothing else to clear. Deleting the store makes the next sample a
# genuine cold start (the historical "cold" hazard — a sibling tier left warm,
# `notes/investigation-question-log.md` Step 2 — cannot recur with one tier).
clear_all_cache_tiers() {
  local workdir="$1"
  rm -f "$workdir/.git/span/store.db" \
        "$workdir/.git/span/store.db-wal" \
        "$workdir/.git/span/store.db-shm"
}

# Bring `$workdir` into the state `$CACHE_MODE` names, using the already-seeded
# span corpus and `$bench_anchors`/`$reader_name` the caller has prepared.
# Runs OUTSIDE the timed region for every mode.
apply_cache_mode_state() {
  local workdir="$1"
  case "$CACHE_MODE" in
    all-off)
      # No further setup needed; the exported GIT_SPAN_CACHE=0 above disables
      # the one store for every invocation in this script run.
      clear_all_cache_tiers "$workdir"
      ;;
    exact-cold)
      # Each sample independently clears the cache (see the `stale` op case
      # in the sweep below) so every sample measures a first build.
      clear_all_cache_tiers "$workdir"
      ;;
    exact-warm)
      clear_all_cache_tiers "$workdir"
      ( cd "$workdir" && git-span stale --no-exit-code >/dev/null 2>&1 || true )
      ;;
    incremental-ancestor)
      clear_all_cache_tiers "$workdir"
      ( cd "$workdir" && git-span stale --no-exit-code >/dev/null 2>&1 || true )
      # An unrelated committed change (no span anchors it) so a warm cache
      # must locate an ancestor generation rather than rebuild from scratch.
      ( cd "$workdir" \
          && echo "bench ancestor marker $(date +%s%N)" >>BENCH_UNRELATED_FILE.md \
          && git add BENCH_UNRELATED_FILE.md \
          && git commit --quiet -m "bench: unrelated ancestor commit" )
      ;;
    dirty-exact)
      # `dirty-exact`/`dirty-affected` exercise the store's dirty-overlay
      # path. The store is the only cache and is always active (no selector
      # switch — the Phase 7 cutover removed the development `GIT_SPAN_CACHE_STORE_V3`
      # selector), so priming warm and then dirtying is all these modes need.
      clear_all_cache_tiers "$workdir"
      ( cd "$workdir" && git-span stale --no-exit-code >/dev/null 2>&1 || true )
      # Dirty exactly one anchored source file (the first bench anchor path).
      if [[ ${#bench_anchors[@]} -gt 0 ]]; then
        local target="${bench_anchors[0]%%#L*}"
        ( cd "$workdir" && printf '\n// bench dirty-exact marker\n' >>"$target" )
      fi
      ;;
    dirty-affected)
      # Same store dirty-overlay path as `dirty-exact`; no selector switch.
      clear_all_cache_tiers "$workdir"
      ( cd "$workdir" && git-span stale --no-exit-code >/dev/null 2>&1 || true )
      # Dirty a tracked file NO span anchors, so the affected-set stays
      # small relative to corpus size (the path this card's dirty-reuse
      # work optimizes for).
      ( cd "$workdir" && printf '\n# bench dirty-affected marker\n' >>README.md 2>/dev/null \
          || printf 'bench dirty-affected marker\n' >BENCH_DIRTY_AFFECTED.md )
      ;;
    concurrent-miss)
      clear_all_cache_tiers "$workdir"
      ;;
  esac
}

usage() {
  cat <<EOF
Usage: $0 [options]

  --iterations N       samples per cell (default: $ITERATIONS)
  --span-counts a,b,c  span-count tiers (default: ${SPAN_COUNTS[*]})
  --anchors a,b,c      anchors-per-span tiers (default: ${ANCHORS_PER_SPAN[*]})
  --refs a,b,c         git refs to use as repo-size tiers (default: ${REFS[*]})
  --full               extends defaults to span-counts=1,10,100,1000 anchors=2,20,200
  --csv PATH           CSV output path (default: $OUT_CSV)
  --keep               keep per-iteration scratch worktrees (debug)
  -h, --help           this help

Env:
  BENCH_CACHE_DIR       cache root (default: $CACHE_DIR)
  NEXTJS_URL            upstream URL (default: $NEXTJS_URL)
  CACHE_MODE            one of: all-off exact-cold exact-warm incremental-ancestor
                        dirty-exact dirty-affected concurrent-miss (default: $CACHE_MODE)
  CONCURRENT_MISS_PROCS process count for concurrent-miss mode (default: $CONCURRENT_MISS_PROCS)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iterations)  ITERATIONS="$2"; shift 2;;
    --span-counts) IFS=, read -r -a SPAN_COUNTS <<<"$2"; shift 2;;
    --anchors)     IFS=, read -r -a ANCHORS_PER_SPAN <<<"$2"; shift 2;;
    --refs)        IFS=, read -r -a REFS <<<"$2"; shift 2;;
    --full)        SPAN_COUNTS=(1 10 100 1000); ANCHORS_PER_SPAN=(2 20 200); shift;;
    --csv)         OUT_CSV="$2"; shift 2;;
    --keep)        KEEP_FIXTURE=1; shift;;
    -h|--help)     usage; exit 0;;
    *) echo "unknown option: $1" >&2; usage; exit 2;;
  esac
done

command -v git-span >/dev/null || { echo "git-span not on PATH" >&2; exit 1; }
command -v git      >/dev/null || { echo "git not on PATH"      >&2; exit 1; }

GIT_SPAN_BIN="$(command -v git-span)"
echo "# git-span benchmark"
echo
echo "- binary:        \`$GIT_SPAN_BIN\`"
echo "- version:       \`$(git-span --version 2>/dev/null || echo unknown)\`"
echo "- cache:         \`$CACHE_DIR\`"
echo "- cache mode:    $CACHE_MODE"
echo "- iterations:    $ITERATIONS"
echo "- refs:          ${REFS[*]}"
echo "- span counts:   ${SPAN_COUNTS[*]}"
echo "- anchors/span:  ${ANCHORS_PER_SPAN[*]}"
echo "- operations:    ${OPS[*]}"
echo "- date:          $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ----------------------------- Fixture management -----------------------------

mkdir -p "$CACHE_DIR"

if [[ ! -d "$NEXTJS_BARE" ]]; then
  echo "Cloning Next.js (full history) — this may take several minutes…" >&2
  git clone --bare "$NEXTJS_URL" "$NEXTJS_BARE" >&2
else
  echo "Updating Next.js cache…" >&2
  git --git-dir="$NEXTJS_BARE" remote update --prune >&2 || true
fi

# Pre-resolve refs to SHAs (so canary is pinned for the whole run).
declare -A REF_SHA
for ref in "${REFS[@]}"; do
  if sha=$(git --git-dir="$NEXTJS_BARE" rev-parse --verify "$ref^{commit}" 2>/dev/null); then
    REF_SHA["$ref"]="$sha"
  else
    echo "warning: ref $ref not found, skipping" >&2
  fi
done

# ------------------------------ Stats helper ----------------------------------

# stats <space-sep-floats>  ->  "n mean median p95 p99 min max"
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
      printf "%d %.6f %.6f %.6f %.6f %.6f %.6f\n", n, mean, median, pct(0.95), pct(0.99), a[1], a[n]
    }'
}

# Time a command in seconds with sub-millisecond resolution, PROPAGATING its
# real exit status.
#
# Usage: timed <accepted-exit-codes-csv> -- <command...>
# `accepted-exit-codes-csv` is a comma-separated allowlist (e.g. "0" or
# "0,1"); the command's actual exit code must be one of these for the sample
# to count. On an unaccepted exit code this prints nothing and returns
# non-zero — the caller must check `timed`'s own exit status, not just
# consume its stdout, or a masked failure silently becomes a "0.000000"
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

# --------------------------- Worktree per (ref) -------------------------------

WORK_ROOT="$(mktemp -d -t git-span-bench-XXXXXX)"
cleanup() {
  if [[ "$KEEP_FIXTURE" -eq 0 ]]; then
    rm -rf "$WORK_ROOT"
  else
    echo "kept scratch: $WORK_ROOT" >&2
  fi
}
trap cleanup EXIT

# Pick A real anchors (line-range or whole-file) from the working tree.
gen_anchors() {
  local count="$1" workdir="$2"
  # Shuffle a stable list of tracked source files; take `count` of them.
  ( cd "$workdir" && git ls-files '*.js' '*.ts' '*.tsx' '*.jsx' '*.md' 2>/dev/null \
      | head -n 5000 | awk 'BEGIN{srand(42)} {print rand()"\t"$0}' \
      | sort | cut -f2- | head -n "$count" )
}

# Init the span refs/dirs that git-span expects in a worktree.
span_init_in() {
  local workdir="$1"
  ( cd "$workdir" && git config --local user.email bench@example.com \
      && git config --local user.name "bench" )
}

# Pre-populate (M-1) spans (untimed setup) so reader ops have something to
# scan. Persistence is `.span/<name>` files staged and committed with plain
# git — there is no `git-span commit` subcommand.
seed_spans() {
  local workdir="$1" count="$2" anchors_per="$3"
  local i
  for (( i = 0; i < count; i++ )); do
    local name="seed-${i}"
    mapfile -t anchors < <(gen_anchors "$anchors_per" "$workdir")
    [[ ${#anchors[@]} -gt 0 ]] || continue
    ( cd "$workdir" \
        && git-span add "$name" "${anchors[@]}" >/dev/null 2>&1 \
        && git-span why "$name" -m "Seed span $i for benchmark" >/dev/null 2>&1 \
        && git add .span >/dev/null 2>&1 \
        && git commit --quiet -m "bench: seed span $name" >/dev/null 2>&1 ) || true
  done
}

# Discard an uncommitted `.span/<name>` file (the analog of the removed
# `git-span restore` subcommand): if the span is already committed, `git
# checkout` restores the committed version; if it was never committed,
# `rm -f` removes the uncommitted file entirely.
span_discard() {
  local workdir="$1" name="$2"
  ( cd "$workdir" \
      && { git checkout --quiet -- ".span/${name}" 2>/dev/null || rm -f ".span/${name}"; } )
}

# ----------------------------- Main sweep -------------------------------------

CSV_TMP="$(mktemp)"
echo "repo_ref,repo_sha,span_count,anchors_per_span,cache_mode,op,n,mean_s,median_s,p95_s,p99_s,min_s,max_s" >"$CSV_TMP"

# Markdown header
printf "| ref | spans | anchors | mode | op | n | mean | median | p95 | p99 | min | max |\n"
printf "|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|\n"

for ref in "${REFS[@]}"; do
  sha="${REF_SHA[$ref]:-}"
  [[ -n "$sha" ]] || continue

  # One scratch worktree per ref, reused across (span_count × anchors) cells.
  WORKDIR="$WORK_ROOT/$ref"
  echo "==> preparing worktree for $ref ($sha)" >&2
  rm -rf "$WORKDIR"
  git clone --shared --no-local-tags --quiet "$NEXTJS_BARE" "$WORKDIR" >&2 2>/dev/null \
    || git clone --quiet "$NEXTJS_BARE" "$WORKDIR" >&2
  ( cd "$WORKDIR" && git checkout --quiet --detach "$sha" )
  span_init_in "$WORKDIR"

  for M in "${SPAN_COUNTS[@]}"; do
    for A in "${ANCHORS_PER_SPAN[@]}"; do
      # Fresh span state for each (M, A) combo — current `.span/` file
      # lifecycle, not the obsolete `.git/span`/`refs/span` layout.
      ( cd "$WORKDIR" && rm -rf .span && git checkout --quiet HEAD -- .span 2>/dev/null || true )
      ( cd "$WORKDIR" && rm -rf .span )

      echo "    ref=$ref M=$M A=$A mode=$CACHE_MODE — seeding $((M > 0 ? M : 0)) spans" >&2
      if [[ "$M" -gt 0 ]]; then
        seed_spans "$WORKDIR" "$M" "$A"
        seeded=$(cd "$WORKDIR" && git-span list --porcelain 2>/dev/null | awk '{print $1}' | sort -u | wc -l)
        if [[ "$seeded" -lt "$M" ]]; then
          echo "FATAL: seeded only $seeded of $M spans (ref=$ref M=$M A=$A)" >&2
          exit 1
        fi
      fi

      # Cache one anchor list to reuse across iterations of write-ops.
      mapfile -t bench_anchors < <(gen_anchors "$A" "$WORKDIR")
      [[ ${#bench_anchors[@]} -gt 0 ]] || { echo "no anchors found, skipping" >&2; continue; }

      # Pick an existing seeded span name for readers (`show`).
      reader_name="seed-0"

      apply_cache_mode_state "$WORKDIR"
      for op in "${OPS[@]}"; do
        samples=()
        for (( it = 0; it < ITERATIONS; it++ )); do
          name="bench-${M}-${A}-${it}"
          t=""
          case "$op" in
            add)
              span_discard "$WORKDIR" "$name"
              t=$(cd "$WORKDIR" && timed 0 -- git-span add "$name" "${bench_anchors[@]}") || continue
              ;;
            why)
              ( cd "$WORKDIR" && git-span add "$name" "${bench_anchors[@]}" >/dev/null 2>&1 || true )
              t=$(cd "$WORKDIR" && timed 0 -- git-span why "$name" -m "bench why for $name") || continue
              ;;
            show)
              t=$(cd "$WORKDIR" && timed 0 -- git-span show "$reader_name") || continue
              ;;
            list)
              t=$(cd "$WORKDIR" && timed 0 -- git-span list) || continue
              ;;
            stale)
              if [[ "$CACHE_MODE" == "exact-cold" ]]; then
                clear_all_cache_tiers "$WORKDIR"
              fi
              if [[ "$CACHE_MODE" == "concurrent-miss" ]]; then
                clear_all_cache_tiers "$WORKDIR"
                # N processes race `stale` against the same missing key; the
                # sample is the WALL time of the slowest racer (what a caller
                # of a stampede actually waits for).
                local_pids=()
                t0=$(date +%s.%N)
                for (( p = 0; p < CONCURRENT_MISS_PROCS; p++ )); do
                  ( cd "$WORKDIR" && git-span stale --no-exit-code >/dev/null 2>&1 ) &
                  local_pids+=("$!")
                done
                rc=0
                for pid in "${local_pids[@]}"; do
                  wait "$pid" || rc=1
                done
                t1=$(date +%s.%N)
                if [[ "$rc" -ne 0 ]]; then
                  echo "timed: a concurrent-miss racer exited non-zero" >&2
                  continue
                fi
                t=$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.6f", b - a }')
              else
                # `stale --no-exit-code` always exits 0 by design; `stale`
                # itself may legitimately exit 0 or 1 (drift found) — this
                # harness uses --no-exit-code so 0 is the only accepted code.
                t=$(cd "$WORKDIR" && timed 0 -- git-span stale --no-exit-code) || continue
              fi
              ;;
          esac
          samples+=("$t")
        done

        if [[ ${#samples[@]} -eq 0 ]]; then
          echo "WARNING: no successful samples for ref=$ref M=$M A=$A mode=$CACHE_MODE op=$op" >&2
          continue
        fi

        read -r n mean median p95 p99 min max < <(stats "${samples[@]}")
        printf "%s,%s,%d,%d,%s,%s,%d,%s,%s,%s,%s,%s,%s\n" \
          "$ref" "$sha" "$M" "$A" "$CACHE_MODE" "$op" "$n" "$mean" "$median" "$p95" "$p99" "$min" "$max" \
          >>"$CSV_TMP"
        printf "| %s | %d | %d | %s | %s | %d | %.4f | %.4f | %.4f | %.4f | %.4f | %.4f |\n" \
          "$ref" "$M" "$A" "$CACHE_MODE" "$op" "$n" "$mean" "$median" "$p95" "$p99" "$min" "$max"
      done
    done
  done
done

mv "$CSV_TMP" "$OUT_CSV"
echo
echo "CSV written to $OUT_CSV"
