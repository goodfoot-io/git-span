# Derives a ProgramBench task_cleanroom_v6 image with the git-span
# treatment artifacts baked in, per programbench-setup-guide.md
# ("Derive the ProgramBench task images").
#
# Base image facts (recorded 2026-08-12, see
# reports/programbench/artifacts.md "## Base image inspection"):
#   - Ubuntu 22.04.5 LTS, python3 3.10.12, pip 22.0.2 (distro package,
#     predates PEP 668 enforcement -- no --break-system-packages needed).
#   - No USER declared in the base image Config (defaults to root); an
#     `agent` user (uid 1000) exists and is what the ProgramBench runner
#     uses at container-run time (`--user agent`), so this Dockerfile ends
#     by switching to it, matching the schematic in the setup guide.
#   - git 2.34.1 present; /workspace is already a git repo (owned by
#     `agent`) containing the task's tty-clock checkout.
#
# Build context is experiment/context/ -- see build-image.sh.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root

# Pinned linux-x64 Node.js binary (>=20.11) and the pinned linux x86-64
# git-span executable, verified under amd64 emulation before being staged
# into the build context (see artifacts.md).
COPY node /usr/local/bin/node
COPY git-span /usr/local/bin/git-span
RUN chmod 0755 /usr/local/bin/node /usr/local/bin/git-span

# Experiment wheel, --no-deps only: mini-swe-agent==2.4.6 and pydantic are
# already present via other means / not required inside the image per the
# setup guide. Installed fully offline -- verified in a --network none
# container that `pip install --no-deps <local wheel>` requires no network
# access at all.
# pip validates the wheel filename against the wheel naming convention, so
# the canonical name must be preserved (the setup guide's schematic rename
# to git-span-agent.whl is rejected by pip).
COPY mini_swe_agent_git_span-1.1.4-py3-none-any.whl /tmp/mini_swe_agent_git_span-1.1.4-py3-none-any.whl
RUN python3 -m pip install --no-deps /tmp/mini_swe_agent_git_span-1.1.4-py3-none-any.whl \
    && rm /tmp/mini_swe_agent_git_span-1.1.4-py3-none-any.whl

# Frozen skill tree.
COPY git-span-skill/ /opt/git-span/skills/git-span/

RUN chmod -R a+rX /opt/git-span \
    && node --version \
    && git span --version \
    && python3 -c "from minisweagent_gitspan.bridge import default_hooks_dir; print(default_hooks_dir())"

USER agent
