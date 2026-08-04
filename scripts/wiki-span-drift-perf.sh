#!/usr/bin/env bash
# Run `git span drift --perf` in /home/node/wiki on the devcontainer-wiki SSH host.
set -euo pipefail
ssh devcontainer-wiki 'export PATH=/usr/local/share/npm-global/bin:$PATH && cd /home/node/wiki && git span drift --perf'
