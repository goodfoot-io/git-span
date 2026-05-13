#!/usr/bin/env bash
set -euo pipefail
ssh devcontainer-cards 'cd /workspace && /usr/local/share/npm-global/bin/git-mesh stale --perf'
