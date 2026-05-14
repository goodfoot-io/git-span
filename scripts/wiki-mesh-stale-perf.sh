#!/usr/bin/env bash
# Run `git mesh stale --perf` in /home/node/wiki on the devcontainer-wiki SSH host.
set -euo pipefail
ssh devcontainer-wiki 'export PATH=/usr/local/share/npm-global/bin:$PATH && cd /home/node/wiki && git mesh stale --perf'
