#!/usr/bin/env bash
# Guarded wrapper for a real `mswea-extra programbench` run (treatment or
# control). This calls the live model API and can occupy a container for up
# to the configured wall-time/container-timeout ceiling (hours) -- it is
# NOT something to run speculatively. Requires an explicit --yes and refuses
# to run over an unanchored/missing --filter (which would run all vendored
# instances, not one canary).
#
# Usage:
#   run-arm.sh <treatment|control> --filter '<anchored-regex>' --yes \
#     [--model deepseek/deepseek-v4-flash] [--out results/<arm>] [--env-file /workspace/.env.deepseek]
set -euo pipefail

ARM="${1:?usage: run-arm.sh <treatment|control> --filter <anchored-regex> --yes [--model M] [--out DIR] [--env-file FILE]}"
shift
MODEL="deepseek/deepseek-v4-flash"
OUT=""
ENV_FILE="/workspace/.env.deepseek"
FILTER=""
CONFIRMED=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --filter) FILTER="$2"; shift 2 ;;
        --yes) CONFIRMED=1; shift ;;
        --model) MODEL="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        --env-file) ENV_FILE="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ "${ARM}" != "treatment" && "${ARM}" != "control" ]]; then
    echo "ERROR: arm must be 'treatment' or 'control', got '${ARM}'" >&2
    exit 1
fi
if [[ -z "${FILTER}" ]]; then
    echo "ERROR: --filter is required. programbench has no -i/--instance flag; --filter is" >&2
    echo "       matched with re.match (start-anchored only) against instance_id, so an" >&2
    echo "       unanchored pattern silently runs ALL vendored instances (201 by default)." >&2
    echo "       Anchor both ends, e.g. --filter '^xorg62__tty-clock\\.f2f847c\$'" >&2
    exit 1
fi
if [[ "${CONFIRMED}" -ne 1 ]]; then
    echo "ERROR: pass --yes to confirm you intend to spend real API cost/time and start a" >&2
    echo "       container that can run up to the configured wall-time/container-timeout" >&2
    echo "       ceiling (hours). See references/running-and-verifying.md." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/../../../../packages/mini-swe-agent" && pwd)"
OUT="${OUT:-results/${ARM}}"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: model API key file not found at ${ENV_FILE}" >&2
    exit 1
fi

echo "== running ${ARM} arm: filter=${FILTER} model=${MODEL} out=${OUT} ==" >&2
cd "${PKG_DIR}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
export DEEPSEEK_API_KEY="${DEEPSEEK_API_TOKEN:?ENV_FILE did not set DEEPSEEK_API_TOKEN}"

uv run mswea-extra programbench \
    -c programbench.yaml \
    -c "experiment/${ARM}.yaml" \
    -m "${MODEL}" \
    --filter "${FILTER}" \
    -o "${OUT}"
