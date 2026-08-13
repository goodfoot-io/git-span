# git-span agent hooks for mini-swe-agent

An extension package for [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):
it subclasses the upstream `LocalEnvironment`/`DockerEnvironment` and
`DefaultAgent` so the agent loop carries functional equivalents of the
[`agent-hooks`](../agent-hooks) package — bounded static touch planning,
span-debt advisory holds, and post-action touch tracking — all driven by the
`git-span` executable found on `PATH`.

Nothing here is a fork: the upstream `mini-swe-agent==2.4.6` is pulled from
PyPI, and this package only adds three subclasses, wired in via the upstream
CLI's `--agent-class` / `--environment-class` import-path resolution.

## Architecture

```
Python agent loop                    TypeScript hooks (in packages/agent-hooks)
┌──────────────────────┐  spawn     ┌──────────────────────────────────────────┐
│ HookedLocalEnvironment│  node …   │ src/mswea/static-plan.mjs (PreToolUse)   │
│  execute(action)     │ ─────────▶ │ src/mswea/advisor.mjs   (PreToolUse)     │
│   ├─ pre_tool_use    │            │ src/mswea/post-tool-use.mjs (PostToolUse │
│   ├─ _run(…)         │ ◀───────── │   ├── PostToolUseFailure)                │
│   └─ post_tool_use   │   stdout   │ src/mswea/session-end.mjs (SessionEnd)   │
└──────────────────────┘  JSON      └──────────────────────────────────────────┘
```

- The hook **logic lives once**, in `packages/agent-hooks/src/{claude,common}`.
  Each host gets its own thin adapter set in `packages/agent-hooks/src/`: the
  `src/mswea/**` adapters (this host) re-register the Claude adapters' handlers
  with matching matchers — the same sources, minus Claude-only plumbing like
  forked-subagent tasking, which this host's single-bash agent cannot carry
  out. `yarn build:hooks:mswea` (run there) compiles standalone `.mjs` bundles
  into `src/minisweagent_gitspan/hooks/bin/` — inside the Python package, so a
  built wheel carries them; the generated `hooks.json` is a manifest
  artifact.
- The **Python bridge** (`src/minisweagent_gitspan/bridge.py`) synthesizes the
  Claude Code hook wire protocol on stdin for every bash action and spawns the
  bundles as one-shot subprocesses. Requested but missing bundles fail closed.
  Runtime hook failures remain fail-open for interactive use and fail closed
  when `hooks_required: true`. It never parses `hooks.json`.
- **Two environments, one bridge.** `HookedLocalEnvironment` runs commands on
  the host; `HookedDockerEnvironment` (for container-based runners such as
  ProgramBench) runs the commands inside the per-instance container and
  `docker exec`s each hook bundle there too, so the advisor sees the same
  repo the command touches. Both share `HookedEnvironmentMixin`.
- Events per bash action:
  1. **PreToolUse** — `static-plan.mjs` (bounded tracked ranges and evidence
     needed after the command) then `advisor.mjs` (span-debt hold before
     `git commit`/`git push`/`git status`). A `permissionDecision: "deny"`
     short-circuits the command: it never runs, and the deny reason becomes
     the action's output with exit status 1.
  2. **PostToolUse** on exit 0 / **PostToolUseFailure** on non-zero — the
     static parser verifies planned evidence and execution state;
     `additionalContext` is
     appended to the action's output so the model sees `<git-span>` blocks.
  3. **SessionEnd** — per-session hook-state cleanup and a non-injected
     span lifecycle summary when the run ends (every exit path: submission,
     limits, interruption, exception).

## Wiring

The upstream `mini` CLI resolves classes by import path:

```sh
mini \
  --agent-class minisweagent_gitspan.agent.HookedAgent \
  --environment-class minisweagent_gitspan.environment.HookedLocalEnvironment \
  --task "…"
```

`HookedAgent` is a thin `DefaultAgent` override that fires `SessionEnd` from a
`finally` block, so per-session hook state is cleaned up on every
exit path — including exceptions, which upstream re-raises out of `run()`.

For container-based runners the environment class is the docker one, wired
through the runner's own `--environment-class` option — or with the
`mswea-extra` entry point, which injects it (the upstream `programbench`
runner hardcodes its agent class, so only the environment is injectable):

```sh
mswea-extra programbench -m deepseek/deepseek-v4-flash
```

Equivalent, unwrapped: `mini-extra programbench --environment-class
minisweagent_gitspan.environment.HookedDockerEnvironment …`.

## Model compatibility

The hooks are **model-agnostic**. They never see the model: the bridge
synthesizes the Claude-protocol envelopes itself, and hook results ride in the
plain action-output dict (`output`/`returncode`) that any model's observation
template renders. So the agent works with any mini-swe-agent model — including
`deepseek-v4-flash`, e.g. via litellm (`-m deepseek/deepseek-v4-flash` or any
OpenAI-compatible endpoint). There is no Claude-specific code in the loop.

## Requirements

- A `git-span` executable on `PATH` (the hooks invoke `git span …`; git
  resolves `git-span` from `PATH`). The advisor requires >= 1.0.142.
- The hook bundles built (`yarn build` in this package, or the root
  `yarn build` — agent-hooks builds them into `hooks/` topologically first).
  Enabling hooks without all five bundles is an initialization error.
- Node >= 20.11 at hook runtime. The bundles are self-contained JavaScript but
  still execute under Node.

## Configuration

`HookedLocalEnvironmentConfig` (YAML `environment:` section or `-c` specs):

| key                          | default      | meaning                                                   |
| ---------------------------- | ------------ | --------------------------------------------------------- |
| `hooks_enabled`              | `true`       | request the bridge; missing bundles fail closed           |
| `hooks_dir`                  | *(built-in)* | hook bundle directory (`<package>/hooks/bin`)             |
| `node_bin`                   | `node`       | Node executable used to spawn the bundles                 |
| `hook_timeout_ms`            | `10000`      | per-hook subprocess timeout                               |
| `hooks_required`             | `false`      | fail closed on runtime errors and attest the treatment    |
| `skill_file`                 | `null`       | absolute in-environment git-span `SKILL.md` path          |
| `require_initial_no_spans`   | `false`      | reject a treatment repository that already contains spans |
| `experiment_arm`             | `unspecified`| arm label serialized into the trajectory                  |
| `expected_package_version`   | `null`       | exact extension version required by preflight             |
| `expected_node_version`      | `null`       | exact `node --version` output required by preflight       |
| `expected_git_span_version`  | `null`       | exact `git span --version` output required by preflight   |
| `expected_bundle_sha256`     | `{}`         | expected digest keyed by bundle filename                  |
| `expected_skill_tree_sha256` | `null`       | expected digest for the installed skill directory        |

`MSWEA_HOOKS_DIR` overrides `hooks_dir`. Hook processes run with the ambient
environment plus the configured `environment.env`.

When `skill_file` is configured, mini-swe-agent-specific hook output replaces
the unsupported “load skill” instruction with a concrete instruction to read
that absolute file and its relative references using bash. Required-mode
preflight verifies the path, artifact versions/checksums, image identity,
repository root, and initial span state before the first model action.

Every hook invocation is serialized under `info.hooks.events`, including its
ordinal, tool-use ID, status, duration, stderr, emitted context, extracted
entities/spans, character count, and whether the context reached a model
observation. The exact token count remains `null` because the environment does
not own the model tokenizer. Attestation and the final span lifecycle summary
are serialized under the same `info.hooks` object.

## Distributing

`mini-swe-agent-git-span` is built for testing environments, not published to
an index. Generate the artifacts with:

```sh
yarn build:hooks   # rebuild the bundles into src/minisweagent_gitspan/hooks/
uv build           # build dist/mini_swe_agent_git_span-*.whl (+ sdist)
```

The wheel is **self-contained**: it embeds the compiled hook bundles, so a test
environment needs only the wheel, `pip install` (or `uv tool install`), and a
`git-span` executable on `PATH` — no Node toolchain, no checkout of this
monorepo. Bump the package version together with `agent-hooks` so a published
artifact unambiguously corresponds to the hook logic it embeds.

## Running in a distinct container

The wheel installs two entry points: `mswea` (the upstream `mini` CLI with
the hook agent/environment classes already wired in, so containers don't
spell out `--agent-class`/`--environment-class`) and `mswea-extra` (the
upstream `mini-extra` benchmark runner with the docker environment wired
into `programbench`). Image sketch:

```dockerfile
FROM python:3.12-slim
RUN npm install -g git-span   # or COPY a git-span binary onto PATH
COPY mini_swe_agent_git_span-1.1.3-py3-none-any.whl /tmp/
RUN pip install /tmp/mini_swe_agent_git_span-1.1.3-py3-none-any.whl
```

Run against a mounted repository with any litellm model — the hooks are
model-agnostic:

```sh
docker run -it --rm -e DEEPSEEK_API_KEY \
  -v "$PWD/repo:/work" -w /work image \
  mswea -m deepseek/deepseek-v4-flash -t "your task"
```

Notes:

- A repository may start without spans. Multi-file uncovered-write reports on
  `git status` and the one-time commit hold guide the agent to create them.
- Any model mini-swe-agent supports works. For `deepseek-v4-flash`,
  `DEEPSEEK_API_KEY` is required (litellm's `deepseek/` provider), or use a
  custom endpoint with `-c model.model_kwargs.base_url=… -c
  model.model_kwargs.api_key=…`.
- Passing any `-c` replaces the default `mini.yaml` config, so keep the
  templates with `-c mini.yaml` first. A model not in litellm's cost registry
  (e.g. a custom `deepseek-v4-flash` endpoint) needs
  `-c model.cost_tracking=ignore_errors` or the run fails on cost
  calculation.

## Running on ProgramBench

[ProgramBench](https://github.com/facebookresearch/ProgramBench)'s runner
(`mini-extra programbench`) executes the agent's commands inside per-instance
`task_cleanroom_v6` containers — so the hooks must run there too, and
`HookedDockerEnvironment` does exactly that: every hook bundle is
`docker exec`'d with the envelope on stdin against the same repo the command
runs in. Invoke it through `mswea-extra`:

```sh
mswea-extra programbench \
  -m deepseek/deepseek-v4-flash \
  -c programbench.yaml -c model.cost_tracking=ignore_errors \
  -o results/
```

The per-instance image must be extended so the hooks can run:

- `git-span` on the container's PATH (the hooks invoke `git span` inside the
  container);
- the wheel installed in the image (it ships the hook bundles, and the runner
  probes the image for them);
- `node` >= 20.11 on the container's PATH (the bundles run under node).

The runner pins the per-instance image to
`{instance image name}:task_cleanroom_v6`, so build the extension under that
exact name and tag.

### Packaging for ProgramBench

The artifact is the self-contained wheel; build it from this package:

```sh
yarn build:hooks   # rebuild the bundles into src/minisweagent_gitspan/hooks/ (see "Distributing")
uv build           # dist/mini_swe_agent_git_span-*.whl
```

Then extend the image (sketch; the base image is the instance's):

```dockerfile
FROM <per-instance base image>
# git-span and node >= 20.11 on the container's PATH
RUN npm install -g git-span node@20
COPY mini_swe_agent_git_span-1.1.3-py3-none-any.whl /tmp/
RUN pip install /tmp/mini_swe_agent_git_span-1.1.3-py3-none-any.whl
```

tag it `{image_name}:task_cleanroom_v6`, and push it to where the runner's
docker daemon pulls from.

Notes:

- ProgramBench's default config (`-c programbench.yaml`) already sets
  `environment.cwd: /workspace` and the `agent` container user; the hooks
  inherit the same environment as the commands.
- The workspace starts with no spans. Multi-file uncovered-write guidance is
  delivered after `git status`; commit/push can hold once so the agent reads
  the same guidance before proceeding.
- `mswea-extra programbench` wraps the upstream ProgramBench agent so
  SessionEnd cleanup and lifecycle summaries run on every exit path.
- If requested bundles cannot be located or verified inside the image,
  environment construction fails. `-c environment.hooks_dir=…` points at an
  explicit in-container bundle path; `-c environment.hooks_enabled=false`
  selects the control arm and skips bundle probing.
- Offline inference: serve the model on a local OpenAI-compatible endpoint
  and point the agent at it (`-c model.model_kwargs.base_url=…`), keeping
  `-c programbench.yaml` first. A model name litellm can't cost out needs
  `-c model.cost_tracking=ignore_errors`.

## Development

```sh
yarn build:hooks      # rebuild hooks/bin + hooks.json from packages/agent-hooks
yarn test             # uv run --group dev pytest -q
yarn lint             # uv run ruff check .
```

Hook logic and its test suite live in `packages/agent-hooks` — changes to hook
behavior belong there, where they apply to every host.
