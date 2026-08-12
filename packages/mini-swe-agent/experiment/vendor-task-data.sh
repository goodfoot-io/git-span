#!/usr/bin/env bash
# Vendors ProgramBench's task definitions (task.yaml/tests.json per instance)
# into the installed `programbench` package's data/tasks directory.
#
# Why this exists: the PyPI wheel (programbench==1.2.4) ships an EMPTY
# data/tasks (just .gitkeep) -- programbench.constants.TASKS_DIR points at
# <installed-package-dir>/data/tasks, and programbench.utils.load_data's
# load_all_instances() reads task.yaml files straight out of that directory
# with no env var or config override. So this is the only path the runner
# (mini-swe-agent's programbench.py, and `programbench` CLI itself) actually
# reads from -- there is nowhere else to point it.
#
# This is NOT durable across a `uv sync`/`uv sync --reinstall` that touches
# the `programbench` package: any reinstall recreates the package's
# site-packages tree from the wheel, which wipes this vendored data (the
# wheel only ever contains .gitkeep). Re-run this script any time
# `programbench` gets reinstalled, e.g. after `uv sync`, `uv lock --upgrade`,
# or a fresh `uv sync --group experiment`.
#
# Pinned source (see experiment/manifest.json "programbench.dataset_revision"
# and reports/programbench/dataset.md): the upstream *source repo* (not the
# PyPI sdist, which also excludes data/tasks -- see setup.py/MANIFEST
# inspection notes in dataset.md) at a fixed commit.
#
# Usage: ./vendor-task-data.sh
set -euo pipefail

PINNED_REPO="https://github.com/facebookresearch/programbench.git"
PINNED_COMMIT="963063c9271cc40fa179977356782ea4582e0b0c"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/.."

TASKS_DIR="$(cd "${PACKAGE_DIR}" && uv run python -c 'from programbench.constants import TASKS_DIR; print(TASKS_DIR)')"
if [[ -z "${TASKS_DIR}" ]]; then
    echo "ERROR: could not resolve programbench.constants.TASKS_DIR (is the venv synced? run 'uv sync --group experiment' first)" >&2
    exit 1
fi
echo "Runner-visible TASKS_DIR: ${TASKS_DIR}" >&2

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

echo "Cloning ${PINNED_REPO} @ ${PINNED_COMMIT} (shallow, sparse: src/programbench/data/tasks only)..." >&2
git -C "${WORKDIR}" init -q
git -C "${WORKDIR}" remote add origin "${PINNED_REPO}"
git -C "${WORKDIR}" fetch -q --depth 1 origin "${PINNED_COMMIT}"
git -C "${WORKDIR}" checkout -q FETCH_HEAD

RESOLVED_COMMIT="$(git -C "${WORKDIR}" rev-parse FETCH_HEAD)"
if [[ "${RESOLVED_COMMIT}" != "${PINNED_COMMIT}" ]]; then
    echo "ERROR: fetched commit ${RESOLVED_COMMIT} does not match pinned ${PINNED_COMMIT}" >&2
    exit 1
fi

SRC_TASKS="${WORKDIR}/src/programbench/data/tasks"
if [[ ! -d "${SRC_TASKS}" ]]; then
    echo "ERROR: ${SRC_TASKS} not found at pinned commit -- upstream layout changed?" >&2
    exit 1
fi

INSTANCE_COUNT="$(find "${SRC_TASKS}" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
echo "Found ${INSTANCE_COUNT} instance directories at pinned commit." >&2

# Replace wholesale: TASKS_DIR should contain exactly the pinned tree, no
# stale leftovers from a prior vendoring of a different commit.
rm -rf "${TASKS_DIR:?}"/*.orig 2>/dev/null || true
find "${TASKS_DIR}" -mindepth 1 -maxdepth 1 -not -name '.gitkeep' -exec rm -rf {} +
cp -a "${SRC_TASKS}/." "${TASKS_DIR}/"

echo "Vendored ${INSTANCE_COUNT} instances into ${TASKS_DIR}" >&2
echo "pinned_commit=${PINNED_COMMIT}"
echo "tasks_dir=${TASKS_DIR}"
echo "instance_count=${INSTANCE_COUNT}"
