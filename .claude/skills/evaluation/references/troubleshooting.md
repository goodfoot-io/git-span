# Troubleshooting / known findings

Findings from the git-span x ProgramBench canary setup
(`reports/programbench/readiness.md` §3, `setup-log.md`, `smoke.md`). Check
here before re-diagnosing something already root-caused.

## a. `git span list --porcelain` isn't byte-empty even with zero spans

Prints the human message `No spans match the filters.` (28 bytes), even
under `--porcelain`, even with zero spans. `_build_attestation`'s real
zero-spans check only counts lines containing a tab, which this message has
none of, so the automated gate is unaffected. Don't script the setup
guide's literal `test -z "$(git span list --porcelain)"` as a pass/fail
gate.

## b. `git -C /workspace status --short` isn't silent in a fresh task container

Typically shows one untracked pre-built binary that ships as base-image
task content (e.g. `?? executable`), not something the git-span layer
introduced. Expected task state, not a failure.

## c. Advisor "already-presented" memoization disarms the commit-time hold

`wasAlreadySeen()` in `advisor.mjs` unconditionally records a
`seen-<digest>` memo for a `report-only` uncovered-writes preview (e.g. a
plain `git status`). A later `git commit` on the **same** digest checks
that memo and resolves to `allow`/`already-presented` — it does **not**
hold, even though the debt was never spanned. This is documented, intended
behavior (`packages/agent-hooks/src/common/advisor-core.ts` ~685-730,
843-844): the hold is a hold-once backstop for debt the agent was *never
shown*, not a re-nag for debt it already saw via `status`.

**Experiment implication**: a treatment agent that runs `git status` before
committing disarms the later commit-time hold for that exact debt state, by
design. When interpreting hold-rate telemetry, the report-only nudge (not
the hold) is the primary mechanism for most agents; the hold only fires for
debt an agent commits without ever previewing.

## d. Uncovered-writes reporting needs ≥2 changed paths

`computeUncoveredPaths` (`advisor.mjs`) short-circuits to zero uncovered
paths whenever the changeset has fewer than 2 paths. A single-file commit
or `git status` structurally cannot trigger a report or hold, regardless of
digest novelty. If you're writing a new smoke/test scenario or interpreting
low hold rates, use file **pairs**, and don't read a single-file no-op as
evidence the advisor is broken.

## e. Wheel filename must not be renamed before `pip install`

pip validates a wheel's filename against its own `{name}-{version}-{tag}`
metadata; a Dockerfile that `COPY`s + renames the wheel (as the setup
guide's schematic does, to `git-span-agent.whl`) gets "not a valid wheel
filename". `experiment/Dockerfile` installs it under its original name —
keep that if you edit the Dockerfile.

## f. `datetime.UTC` is Python 3.11+ only

The task image is Ubuntu 22.04 / Python 3.10.12 and the package's own
`requires-python` already declares `>=3.10`. `from datetime import UTC`
breaks at import time inside the container even though it imports fine on
a newer host. Use `datetime.timezone.utc` instead. Caught by the derived
image's in-image `RUN` check (`python3 -c "from minisweagent_gitspan..."`)
— if you add a new in-container import, exercise it under `python3.10`
before trusting a passing host-side test suite.

## g. Wheel zip bytes aren't reproducible across builds

`uv build` output differs byte-for-byte across otherwise-identical runs
(zip member timestamp/ordering), even though unpacked contents are
byte-identical. Don't chase a matching wheel sha256 on rebuild — diff the
*unpacked* contents, and treat one staged copy (`experiment/context/`'s) as
canonical once you've built the version you intend to ship.

## h. Vendored task dataset isn't durable across `uv sync`

`programbench`'s PyPI wheel ships an empty `data/tasks/` (`.gitkeep` only).
The vendored 201-instance tree lives under
`.venv/.../site-packages/programbench/data/tasks`, which is **not** part of
the wheel — any `uv sync`/`uv sync --reinstall` that reinstalls
`programbench` silently wipes it back to empty. Re-run
`experiment/vendor-task-data.sh` any time that happens (it's idempotent and
re-verifies the pinned commit before overwriting).

## i. Docker auto-creates a missing `-w` directory as root, not world-writable

If you point a `HookedDockerEnvironment`'s `cwd` at a not-yet-existing path
(e.g. a disposable scratch repo for a new test, rather than the task's
real `/workspace`, which always pre-exists and is pre-owned by `agent`),
dockerd creates that leaf directory as `root:root` mode `0755` before the
entrypoint runs — regardless of whether the parent (`/tmp`) is
world-writable. The first `agent`-user write into it then fails with
`Permission denied`. Fix: one `docker exec -u root <container> chown
agent:agent <cwd>` right after container start, before touching it as
`agent`. This never affects a real ProgramBench run (`cwd` is always
`/workspace`), only ad hoc scratch-repo test scenarios.

## j. `hooks.json` is not part of the attestation

`_build_attestation` only hashes the five `ALL_HOOKS` `.mjs` files. If
`expected_bundle_sha256` (in an arm YAML or a diagnostic script) includes a
`hooks.json` key, preflight always fails — `bundle_hashes.get("hooks.json")`
is always `None`, so any expected value mismatches. Track `hooks.json`'s
hash in the manifest for provenance only, never in `expected_bundle_sha256`.

## k. amd64-only images on an arm64 host

Every derived task image is single-platform amd64 (`docker manifest
inspect` confirms no manifest list). On an arm64 Docker Desktop host,
every `docker build`/`docker run` against these images needs
`--platform linux/amd64` explicitly — emulation works fine (verified with
`debian:stable-slim` and the derived image itself) but is not the default
architecture selection.

## l. PEP 668 does not apply inside the task image

The task image's `pip` (22.0.2, Ubuntu 22.04 distro package) predates PEP
668 `externally-managed-environment` enforcement — `pip install --no-deps
<wheel>` as root needs no `--break-system-packages` flag, unlike a newer
Debian-based dev host. Don't add that flag to the Dockerfile; it's not
needed and signals the wrong assumption about the base image.

## m. The Docker socket here is a sibling, not nested Docker

`/var/run/docker.sock` in this devcontainer is a mounted symlink to the
**host's** Docker Desktop socket (container-in-container / sibling-container
setup) — there is no dockerd running inside this container. Confirm before
relying on anything Docker-related: `docker version` must print both a
`Client` and a `Server` stanza; a missing `Server` stanza means no daemon is
reachable and nothing in the setup guide or this skill has a fallback for
that.

**Consequence — bind mounts don't work as you'd expect.** `docker run -v
<path-in-this-container>:/x` resolves `<path-in-this-container>` against the
**host** filesystem, not this sandbox — the sandboxed path isn't shared with
the host. `docker cp` (copy into/out of a running container) and Docker
build contexts (which stream file contents through the socket protocol
itself, not a host path) both work fine and are what every script here
uses (`build-image.sh`'s build context, `smoke_test.py`'s `docker exec`).
Never add a `-v` bind mount pointing at a path inside this container's
sandbox.

Before trusting `--platform linux/amd64` emulation, don't just read
`docker buildx ls` (advertised platform support isn't proof) — run
`docker run --rm --platform linux/amd64 debian:stable-slim uname -m` and
confirm it prints `x86_64`.

Resource caps (`--cpus 20 --memory 60g` etc. in `programbench.yaml`) are
requests to a Docker Desktop VM shared with the host and possibly other
containers. Confirmed failure mode (not just silent throttling): a VM with
fewer than 20 CPUs rejects the `docker run` outright — `range of CPUs is
from 0.01 to 10.00, as there are only 10 CPUs available` — the container
never starts and `mswea-extra` logs a bare `CalledProcessError` with no
CPU-related text, so the real cause only shows by re-running the printed
`docker run ...` command by hand. Check `docker info | grep -i cpu` /
`docker run --rm --platform linux/amd64 debian:stable-slim nproc` before a
real run. Fix: add an `environment.run_args` override to **both**
`treatment.yaml` and `control.yaml` (identical values — an arm-level
mismatch would confound the comparison) sized to the host, e.g. `--cpus 8
--memory 20g --memory-swap 20g`; `recursive_merge` (mini-swe-agent's config
merger) replaces the whole list wholesale, so the override doesn't need to
repeat anything from the base config beyond what you want kept.

**Verifying a staged amd64 binary works under emulation** (git-span, node)
also can't use `-v` (finding m above) — `docker create --platform
linux/amd64 <image> sleep 60`, `docker cp <binary> <cid>:/x`, `docker start
<cid>`, `docker exec <cid> /x --version`, `docker rm -f <cid>`.

## n. `/workspace/.env.deepseek` is world-readable

Mode `644` at last check. Treat this as a standing finding worth raising,
not something to silently work around — least-privilege would have it
readable only by the user running the agent.
