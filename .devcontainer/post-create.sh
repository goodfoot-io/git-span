#!/bin/bash

set -e

# Fail fast on a wrong container clock (Docker Desktop VM drift after host sleep
# breaks TLS, npm, git tags, etc.). When SYS_TIME is granted by docker-compose,
# step the clock in-place; otherwise print the host-side recovery command.
local_now=$(date -u +%s)
http_date=$(curl -sI --max-time 5 https://www.google.com 2>/dev/null \
    | awk -F': ' 'tolower($1)=="date"{sub(/\r$/,"",$2); print $2; exit}')
if [ -n "$http_date" ]; then
    remote_now=$(date -u -d "$http_date" +%s 2>/dev/null || true)
    if [ -n "$remote_now" ]; then
        drift=$((local_now - remote_now)); drift=${drift#-}
        if [ "$drift" -gt 60 ]; then
            echo "Container clock drift: ${drift}s vs network. Stepping with chrony..." >&2
            if ! sudo -n /usr/sbin/chronyd -q 'pool pool.ntp.org iburst' >&2; then
                cat >&2 <<'MSG'
Failed to step the clock from inside the container.
Likely cause: Docker Desktop VM clock drifted after the macOS host slept.
Fix on the macOS host (not inside this container):

  docker run --rm --privileged --pid=host alpine \
    nsenter -t 1 -m -u -i -n -p -- hwclock -s

Then reopen the dev container.
MSG
                exit 1
            fi
        fi
    fi
fi

# Make all scripts in utilities directory executable
if [ -d "/workspace/.devcontainer/utilities" ]; then
    echo "Making scripts in /workspace/.devcontainer/utilities executable..."
    chmod +x /workspace/.devcontainer/utilities/*
fi

# Create VSCode MCP Bridge directory with proper permissions
echo "Setting up VSCode MCP Bridge directories..."
mkdir -p /home/node/.local/share/yutengjing-vscode-mcp
chmod 755 /home/node/.local/share/yutengjing-vscode-mcp
chown -R node:node /home/node/.local
echo "VSCode MCP Bridge directories created"

# Start system dbus daemon if not already running
echo "Setting up dbus for VS Code extension testing..."
if ! pgrep -x "dbus-daemon" > /dev/null; then
    # Ensure dbus directories exist with proper permissions
    sudo mkdir -p /run/dbus /var/run/dbus
    sudo chmod 755 /run/dbus /var/run/dbus

    # Start system dbus daemon
    sudo dbus-daemon --system --fork

    # Wait for socket to be created
    sleep 1

    # Verify dbus is running
    if [ -S /run/dbus/system_bus_socket ] || [ -S /var/run/dbus/system_bus_socket ]; then
        echo "System dbus daemon started successfully"
    else
        echo "Warning: dbus daemon started but socket not found"
    fi
else
    echo "System dbus daemon already running"
fi

# Create X11 unix directory with proper permissions for Xvfb
sudo mkdir -p /tmp/.X11-unix
sudo chmod 1777 /tmp/.X11-unix
echo "X11 directory prepared for headless testing"

# Configure git to use .githooks directory for hooks
if ! git config --global --get-all safe.directory | grep -Fx /workspace > /dev/null; then
    echo "Marking /workspace as a safe git directory..."
    git config --global --add safe.directory /workspace
fi

# Bring up Tailscale in TUN mode (MagicDNS) — shared routine from the base image.
# Reads $TS_HOSTNAME / $TS_AUTHKEY from .devcontainer/.env.
/usr/local/share/devcontainer/tailscale-up.sh

echo "Configuring git hooks path..."
git config core.hooksPath .githooks
echo "Git hooks path set to .githooks"

echo "Configuring package version merge driver..."
git config merge.json-version.name "Resolve package version conflicts by highest semver"
git config merge.json-version.driver ".githooks/merge-json-version %O %A %B %P"
echo "Package version merge driver configured"

# Shared runtime setup from the base image: Rust (latest stable) + clippy/rustfmt,
# uv, Antigravity, the zsh theme, and a rootless sshd — all installed into the
# persisted /home/node.
/usr/local/share/devcontainer/post-create-common.sh

# inferno for flame-graph generation (needs cargo, installed by the common
# routine above; ensure the toolchain's bin dir is on PATH).
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v inferno-flamegraph >/dev/null 2>&1; then
    echo "Installing inferno..."
    cargo install inferno --locked
fi
