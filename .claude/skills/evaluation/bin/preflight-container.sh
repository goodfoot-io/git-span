#!/usr/bin/env bash
# Run the derived-image preflight checks from programbench-setup-guide.md
# ("Preflight one real task container") against a real image, under the
# same --user/--network/--cap-drop settings the real runner uses.
#
# Usage: preflight-container.sh <image-tag> [platform]
#   image-tag  e.g. programbench/xorg62_1776_tty-clock.f2f847c:task_cleanroom_v6
#   platform   defaults to linux/amd64 (ProgramBench images are amd64-only)
set -euo pipefail

IMAGE="${1:?usage: preflight-container.sh <image-tag> [platform]}"
PLATFORM="${2:-linux/amd64}"

echo "== preflight: ${IMAGE} (platform ${PLATFORM}) ==" >&2

docker run --rm --platform "${PLATFORM}" --network none --user agent --cap-drop SYS_PTRACE \
  "${IMAGE}" sh -c '
set -e
echo "-- whoami --"; whoami
echo "-- node --version --"; node --version
echo "-- git span --version --"; git span --version
echo "-- bridge import (default_hooks_dir) --"
python3 -c "from minisweagent_gitspan.bridge import default_hooks_dir; print(default_hooks_dir())"
echo "-- skill file readable --"
test -r /opt/git-span/skills/git-span/SKILL.md && echo skill-readable
echo "-- git -C /workspace status --short (expect only pre-existing task content, e.g. a built binary) --"
git -C /workspace status --short || true
echo "-- git -C /workspace span list --porcelain (expect: \"No spans match the filters.\", 28 bytes -- NOT byte-empty, see references/troubleshooting.md finding a) --"
git -C /workspace span list --porcelain
echo "byte length: $(git -C /workspace span list --porcelain | wc -c)"
'

echo "== preflight complete. Compare output against reports/programbench/preflight.md and references/running-and-verifying.md. ==" >&2
