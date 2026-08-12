#!/usr/bin/env bash
# Derives the treatment ProgramBench task image (git-span baked in) from the
# pristine task_cleanroom_v6 base, per programbench-setup-guide.md.
#
# Idempotent and fail-closed:
#   - The pristine base is captured under the
#     "${IMAGE_REPO}:${BASE_TAG}_original-base" tag exactly once. On later
#     runs that tag is treated as the source of truth for the build (the
#     runner-expected tag may already point at a previously-derived image),
#     so re-running this script never derives-from-a-derivation.
#   - The runner-expected tag ("${IMAGE_REPO}:${BASE_TAG}") is only ever
#     reassigned here, at build time, to the freshly built derived image.
#
# Usage: ./build-image.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_DIR="${SCRIPT_DIR}/context"
DOCKERFILE="${SCRIPT_DIR}/Dockerfile"
WHEEL_NAME="mini_swe_agent_git_span-1.1.3-py3-none-any.whl"
DIST_DIR="${SCRIPT_DIR}/../dist"

IMAGE_REPO="programbench/xorg62_1776_tty-clock.f2f847c"
BASE_TAG="task_cleanroom_v6"
RUNNER_TAG="${IMAGE_REPO}:${BASE_TAG}"
ORIGINAL_BASE_TAG="${IMAGE_REPO}:${BASE_TAG}_original-base"
PLATFORM="linux/amd64"

echo "== build-image.sh: deriving ${RUNNER_TAG} ==" >&2

# --- 1. Establish the pristine base image, retagging it exactly once. -----
if docker image inspect "${ORIGINAL_BASE_TAG}" >/dev/null 2>&1; then
    echo "Original base already captured under ${ORIGINAL_BASE_TAG}" >&2
else
    if ! docker image inspect "${RUNNER_TAG}" >/dev/null 2>&1; then
        echo "ERROR: neither ${ORIGINAL_BASE_TAG} nor ${RUNNER_TAG} exist locally." >&2
        echo "       Pull the pristine ProgramBench base image first." >&2
        exit 1
    fi
    echo "Retagging current ${RUNNER_TAG} as ${ORIGINAL_BASE_TAG} (first run)" >&2
    docker tag "${RUNNER_TAG}" "${ORIGINAL_BASE_TAG}"
fi

BASE_IMAGE_ID="$(docker image inspect "${ORIGINAL_BASE_TAG}" --format '{{.Id}}')"
if [[ -z "${BASE_IMAGE_ID}" ]]; then
    echo "ERROR: could not resolve an image ID for ${ORIGINAL_BASE_TAG}" >&2
    exit 1
fi
echo "Original base image ID: ${BASE_IMAGE_ID}" >&2

# --- 2. Stage the fresh wheel into the build context. ----------------------
WHEEL_SRC="${DIST_DIR}/${WHEEL_NAME}"
if [[ ! -f "${WHEEL_SRC}" ]]; then
    echo "ERROR: wheel not found at ${WHEEL_SRC}" >&2
    echo "       Build it first (see packages/mini-swe-agent build scripts)." >&2
    exit 1
fi
cp "${WHEEL_SRC}" "${CONTEXT_DIR}/${WHEEL_NAME}"
echo "Staged wheel: ${CONTEXT_DIR}/${WHEEL_NAME} ($(sha256sum "${CONTEXT_DIR}/${WHEEL_NAME}" | cut -d' ' -f1))" >&2

# --- 3. Verify the other pinned artifacts are already staged. --------------
for f in node git-span git-span-skill; do
    if [[ ! -e "${CONTEXT_DIR}/${f}" ]]; then
        echo "ERROR: expected build-context artifact missing: ${CONTEXT_DIR}/${f}" >&2
        exit 1
    fi
done

# --- 4. Build, tagging the derived image over the runner-expected tag. -----
# BuildKit rejects a bare sha256: image ID in FROM (it parses it as a Hub
# repository name), so build from the pinned local tag; BASE_IMAGE_ID above
# remains the immutable identity recorded in the experiment manifest.
docker build \
    --platform "${PLATFORM}" \
    --build-arg "BASE_IMAGE=${ORIGINAL_BASE_TAG}" \
    -t "${RUNNER_TAG}" \
    -f "${DOCKERFILE}" \
    "${CONTEXT_DIR}"

DERIVED_IMAGE_ID="$(docker image inspect "${RUNNER_TAG}" --format '{{.Id}}')"

echo "== done ==" >&2
echo "original_base_id=${BASE_IMAGE_ID}"
echo "derived_image_id=${DERIVED_IMAGE_ID}"
echo "runner_tag=${RUNNER_TAG}"
