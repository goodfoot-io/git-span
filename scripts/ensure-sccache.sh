#!/usr/bin/env bash
#
# ensure-sccache.sh — guarantee a reachable sccache server before Rust builds.
#
# The shared sccache server (RUSTC_WRAPPER=sccache, SCCACHE_DIR shared across
# worktrees) occasionally falls out of sync with its client: a stale or
# version-mismatched server is left holding the server socket, so the client
# handshake fails with "Failed to read response header / failed to fill whole
# buffer" and Cargo reports it as a compile error. A truly-absent server
# self-heals — any client command auto-spawns one — so the only state that needs
# intervention is a present-but-wedged server occupying the port, which the
# client will never replace on its own.
#
# This preflight is idempotent and self-healing: it no-ops when the server is
# healthy (or absent and auto-startable), reclaims the port from a wedged server
# and brings up a clean one using the *same* binary the client will resolve
# (keeping client and server versions matched), and fails loudly with a
# documented manual recovery step when it cannot. It never disables caching.
#
# Honors SCCACHE_DIR and SCCACHE_SERVER_PORT for isolated invocations.

set -uo pipefail

# Resolve sccache once so the server we (re)start matches the client Cargo will
# invoke via RUSTC_WRAPPER. Absent binary => nothing to ensure (e.g. CI runners
# that compile without sccache); succeed quietly.
SCCACHE_BIN="$(command -v sccache 2>/dev/null || true)"
if [ -z "$SCCACHE_BIN" ]; then
  exit 0
fi

PORT="${SCCACHE_SERVER_PORT:-4226}"
CACHE_DIR="${SCCACHE_DIR:-$HOME/.cache/sccache}"

# A reachable server answers --show-stats. Against a free port this auto-starts a
# healthy server (the desired outcome); against a wedged occupant it fails.
server_ok() {
  "$SCCACHE_BIN" --show-stats >/dev/null 2>&1
}

# PIDs currently listening on the sccache port. The port is sccache's by
# configuration, so whatever holds it when the server is unreachable is the
# stale occupant to reclaim.
port_holders() {
  ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+' | sort -u
}

if server_ok; then
  exit 0
fi

# Serialize recovery so concurrent worktrees sharing this server don't all kill
# and restart it at once.
mkdir -p "$CACHE_DIR"
exec 9>"$CACHE_DIR/.ensure-sccache.lock"
flock 9

# Re-check under the lock: a peer worktree may have just recovered the server.
if server_ok; then
  exit 0
fi

echo "ensure-sccache: server on port $PORT is unreachable; recovering..." >&2

# Graceful stop first, in case the occupant is a real (but mismatched) sccache.
"$SCCACHE_BIN" --stop-server >/dev/null 2>&1 || true

# Force-reclaim the port if anything still holds it.
for pid in $(port_holders); do
  echo "ensure-sccache: reclaiming port $PORT from pid $pid" >&2
  kill -9 "$pid" 2>/dev/null || true
done

# Start a clean server with the resolved binary. SCCACHE_START_SERVER cannot be
# combined with a subcommand, so invoke the binary bare.
SCCACHE_START_SERVER=1 "$SCCACHE_BIN" >/dev/null 2>&1 || true

# Verify the server came up.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if server_ok; then
    echo "ensure-sccache: server healthy on port $PORT" >&2
    exit 0
  fi
  sleep 0.3
done

cat >&2 <<EOF
ensure-sccache: automatic recovery FAILED — sccache server on port $PORT is still
unreachable. Build aborted rather than compiling without the shared cache.

Manual recovery:
  pkill -9 -f sccache
  SCCACHE_DIR='$CACHE_DIR' SCCACHE_START_SERVER=1 sccache
  sccache --show-stats   # confirm it answers

See the sccache recovery note in CLAUDE.md.
EOF
exit 1
