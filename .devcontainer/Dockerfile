# Git Span devcontainer — builds on the shared local base image.
# The base (devcontainer-base:node24.16-trixie) is built on demand by the
# initializeCommand in devcontainer.json (see ../../devcontainer-base).
FROM devcontainer-base:node24.16-trixie

ARG TZ
ENV TZ="$TZ"

# Repo-specific system packages on top of the base: the Rust profiling/linking
# tools (mold, linux-perf, build-essential) for the Rust CLI in ./packages, the
# headless-browser stack for VS Code extension tests, chrony for stepping a
# drifted container clock, and cloudflared for the website's dev tunnel
# (packages/website/scripts/dev-with-tunnel.mjs).
#
# Cloudflare's apt repo has no `trixie` suite yet, so we pin to `bookworm`;
# cloudflared is a self-contained Go binary and doesn't depend on the host's
# Debian codename.
USER root
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive && apt-get install -y \
  build-essential \
  mold \
  linux-perf \
  chromium \
  dbus-x11 \
  xvfb \
  chrony \
  curl \
  gnupg \
  && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-main.gpg \
  && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' > /etc/apt/sources.list.d/cloudflared.list \
  && apt-get update && apt-get install -y cloudflared \
  && rm -rf /var/lib/apt/lists/*

# Verify mold and cloudflared are installed and functional (fail-fast for corrupt or missing binaries)
RUN mold --version
RUN cloudflared --version

# Extra sudoers entry (beyond the base's node-packages): chronyd, used at runtime
# to step a drifted container clock.
RUN echo "node ALL=(root) NOPASSWD: /usr/sbin/chronyd" > /etc/sudoers.d/node-chrony && \
  chmod 0440 /etc/sudoers.d/node-chrony
USER node

# Yarn workspace-local caches + a larger Node heap.
ENV YARN_CACHE_FOLDER=/workspace/.yarn/cache
ENV YARN_GLOBAL_FOLDER=/workspace/.yarn/global
ENV NODE_OPTIONS=--max-old-space-size=4096

# Repo dev CLIs (installed to the base's system npm prefix, so they survive the
# /home/node bind mount).
RUN npm install -g @anthropic-ai/claude-code @openai/codex && \
  npm install -g tsx dotenv-cli @ast-grep/cli jsdoczoom
