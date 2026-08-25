#!/usr/bin/env bash
# Benchmark harness for `yarn validate`: N warm end-to-end runs under GNU time,
# reporting per-run wall/user/sys seconds and the medians. Wall-clock is the
# primary metric; CPU seconds (user+sys) is secondary. Runs must be warm
# (a prior green validate on this worktree) and the machine otherwise idle —
# this harness measures, it does not isolate.
#
# Usage: scripts/bench-validate.sh [runs]   (default 3)
set -euo pipefail

runs="${1:-3}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v /usr/bin/time >/dev/null || { echo "ERROR: GNU time (/usr/bin/time) is required" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "bench-validate: $runs run(s) of 'yarn validate' at $(git rev-parse --short HEAD)"
for i in $(seq 1 "$runs"); do
  if ! /usr/bin/time -f '%e\t%U\t%S' -o "$tmp/run$i.time" yarn validate > "$tmp/run$i.log" 2>&1; then
    echo "ERROR: run $i failed — a benchmark run must be green (log: $tmp/run$i.log)" >&2
    trap - EXIT
    exit 1
  fi
  printf 'run%d\treal=%ss\tuser=%ss\tsys=%ss\n' "$i" $(cut -f1,2,3 "$tmp/run$i.time")
done

median() {
  cut -f"$1" "$tmp"/run*.time | sort -n | awk '{a[NR]=$1} END {
    if (NR % 2) printf "%.2f", a[(NR+1)/2];
    else printf "%.2f", (a[NR/2] + a[NR/2+1]) / 2
  }'
}

real_med="$(median 1)"
cpu_med="$(paste <(cut -f2 "$tmp"/run*.time) <(cut -f3 "$tmp"/run*.time) \
  | awk '{print $1+$2}' | sort -n | awk '{a[NR]=$1} END {
    if (NR % 2) printf "%.2f", a[(NR+1)/2];
    else printf "%.2f", (a[NR/2] + a[NR/2+1]) / 2
  }')"
echo "median: real=${real_med}s cpu(user+sys)=${cpu_med}s"
