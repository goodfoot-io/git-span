# ProgramBench experiment setup for git-span

## Purpose

This experiment measures whether git-span and its context-injecting hooks help a
mini-swe-agent build a better ProgramBench solution. It is intentionally a
greenfield test: every task starts without spans. The treatment is the workflow
that prompts the agent to discover implicit couplings, create spans while it
works, receive those spans again as later context, and reconcile them before
committing. Pre-seeding spans would give the treatment task-specific information
that the control does not have and must not be done.

The primary comparison is causal: run the same ProgramBench tasks under a
treatment and a control that differ only in whether the hooks execute. Hook
telemetry is secondary evidence used to explain how the treatment behaved; it
does not replace the benchmark comparison.

## Experimental arms

Use one version of mini-swe-agent, one model configuration, and one set of
derived task images for both arms.

- **Treatment:** `HookedDockerEnvironment` with `hooks_enabled: true` and
  required-hook validation enabled.
- **Control:** the same environment with `hooks_enabled: false`.

Both arms should have the same Node.js binary, git-span binary, hook bundles,
skill files, PATH, prompt, model parameters, limits, and ProgramBench image.
Keeping treatment artifacts in the control image prevents image composition
from becoming an arm-level confound. The control agent is not directed to use
them because its hooks are disabled.

Do not use a separately evolving mini-swe-agent fork as the control. A separate
fork makes agent-loop, dependency, and configuration drift indistinguishable
from the hook effect.

## Pin the experiment

Create an experiment manifest before building images. At minimum, record:

- the ProgramBench package version and dataset revision;
- the ordered instance IDs and original `task_cleanroom_v6` image digests;
- the mini-swe-agent and `mini-swe-agent-git-span` versions and wheel SHA-256;
- the git-span version and executable SHA-256;
- the Node.js version and executable SHA-256;
- the SHA-256 of every bundled hook and every installed skill file;
- the model identifier, endpoint implementation, sampling parameters, prompt
  configuration, step/token/cost/wall-time limits, and random seeds when the
  model provider supports them;
- the derived image digests and the treatment assignment for every run.

Use immutable artifacts or digests throughout a completed experiment. Do not
rebuild one arm midway through a batch.

## Build the mini-swe-agent artifact

From `packages/mini-swe-agent`, rebuild the hooks and then build the wheel:

```sh
yarn build:hooks
uv build
sha256sum dist/mini_swe_agent_git_span-*.whl
```

The wheel embeds the compiled `.mjs` bundles. The ProgramBench host also needs
this wheel installed so that the `mswea-extra` entry point and custom Docker
environment are available.

The current container implementation locates the bundles by importing
`minisweagent_gitspan` inside each task container. Therefore the wheel must also
be installed in every derived task image. Installing it with `--no-deps` is
sufficient inside the task image: the task container runs the Node bundles,
while the mini-swe-agent Python loop runs on the host.

## Install a frozen skill bundle

Install a complete, version-matched copy of the git-span skill at a stable,
world-readable location in every derived image. A recommended layout is:

```text
/opt/git-span/skills/git-span/SKILL.md
/opt/git-span/skills/git-span/references/...
```

Copy the complete skill directory, not only `SKILL.md`, because the main file
routes more involved cases to files under `references/`. Record checksums for
the whole installed tree. This is general git-span operating guidance, not
task-specific span content; no `.span/` data or ProgramBench solution knowledge
belongs in the image.

mini-swe-agent has only a bash tool and cannot invoke a Codex or Claude “load
skill” capability. Treatment hook output should instead give it a literal,
valid command, for example:

```text
Read /opt/git-span/skills/git-span/SKILL.md before acting on this report. Use
sed to read any referenced file under /opt/git-span/skills/git-span/references/.
```

The path is configured with
`environment.skill_file: /opt/git-span/skills/git-span/SKILL.md` and must be
fixed in the experiment manifest.

## Derive the ProgramBench task images

ProgramBench inference uses one clean-room image per instance and mini-swe-agent
2.4.6 selects the exact `{image_name}:task_cleanroom_v6` tag. Extend every image
selected for the experiment with these artifacts:

1. A pinned Linux x86-64 Node.js version at least 20.11.
2. The exact pinned Linux x86-64 `git-span` executable on PATH.
3. The experiment wheel, installed with `pip install --no-deps`.
4. The complete frozen skill directory under `/opt/git-span/skills/git-span`.

Prefer copying verified binaries and wheels into the build context over
unpinned package-manager installation. Inference must remain offline; image
construction may use the network, but all resulting bytes must be pinned and
recorded.

A schematic Dockerfile is:

```dockerfile
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root
COPY node /usr/local/bin/node
COPY git-span /usr/local/bin/git-span
COPY mini_swe_agent_git_span-1.1.3-py3-none-any.whl /tmp/git-span-agent.whl
RUN python3 -m pip install --no-deps /tmp/git-span-agent.whl
COPY git-span-skill/ /opt/git-span/skills/git-span/
RUN chmod -R a+rX /opt/git-span \
    && node --version \
    && git span --version \
    && python3 -c "from minisweagent_gitspan.bridge import default_hooks_dir; print(default_hooks_dir())"
USER agent
```

The actual base images may have different package tools or user declarations;
adapt the Dockerfile without changing their task contents. Preserve the
original base digest in the experiment manifest before assigning the derived
image the tag expected by the runner.

## Preflight one real task container

Do not rely only on the fake-Docker unit tests. Before a benchmark batch, start
one real derived `task_cleanroom_v6` image with the same `--user agent` and
network settings as ProgramBench and verify:

```sh
node --version
git span --version
python3 -c 'from minisweagent_gitspan.bridge import default_hooks_dir; print(default_hooks_dir())'
test -r /opt/git-span/skills/git-span/SKILL.md
git -C /workspace status --short
test ! -e /workspace/.span
```

Then run a bridge smoke scenario inside a disposable repository:

1. Create and commit at least two ordinary files.
2. Modify both files without creating spans.
3. Run `git status` through `HookedDockerEnvironment` and confirm the model
   observation contains an uncovered-writes `<git-span>` report.
4. Attempt `git commit` and confirm it is held once with span-creation guidance.
5. Create a span and why, stage the code and `.span/` together, and confirm the
   retry commits successfully.
6. Touch or read an anchored region and confirm a later observation contains
   the expected span context.

This smoke test must fail if any expected hook event or context block is absent.

## Run the two arms

Use the normal ProgramBench config first so its prompt and environment settings
are preserved, then merge a small arm-specific config. Conceptually:

```yaml
# treatment.yaml
environment:
  hooks_enabled: true
  hooks_required: true
  hooks_dir: null
  node_bin: node
  hook_timeout_ms: 10000
  skill_file: /opt/git-span/skills/git-span/SKILL.md
  require_initial_no_spans: true
  experiment_arm: treatment
  expected_package_version: 1.1.3
  expected_node_version: v20.x.y
  expected_git_span_version: git-span 1.1.2
  expected_bundle_sha256:
    snapshot.mjs: <sha256>
    advisor.mjs: <sha256>
    post-tool-use.mjs: <sha256>
    post-tool-use-failure.mjs: <sha256>
    session-end.mjs: <sha256>
  expected_skill_tree_sha256: <sha256>
```

```yaml
# control.yaml
environment:
  hooks_enabled: false
  hooks_required: false
  experiment_arm: control
```

Run both through the same `mswea-extra programbench` installation and the same
base configuration:

```sh
mswea-extra programbench -c programbench.yaml -c treatment.yaml -o results/treatment
mswea-extra programbench -c programbench.yaml -c control.yaml -o results/control
```

Add the chosen model and provider configuration identically to both commands.
Run a shuffled, paired assignment rather than completing every treatment run
before starting the controls. For stochastic models, use several replicates per
instance and pair seeds when meaningful. Keep retries attributable: an
infrastructure retry replaces a failed run and retains its audit record; it is
not silently counted as another sample.

## Required treatment attestation and telemetry

The treatment must fail closed before the first model call if it cannot prove
that the intended intervention is available. Record the preflight result in the
trajectory:

- resolved container image digest;
- Node.js and git-span versions;
- hook bundle directory and bundle checksums;
- wheel/package version;
- skill path and skill-tree checksum;
- repository root and confirmation that the initial repository has no spans;
- hook configuration, including timeout and required/fail-closed mode.

Record one structured event per hook invocation, preferably in the trajectory's
serialized environment data and optionally as host-side JSONL. Each event
should include:

- instance/run/session/tool-use identifiers and event ordinal;
- hook name, command class, start/end timestamps, duration, and exit status;
- success, clean no-op, timeout, missing dependency, malformed output, or other
  failure classification;
- whether the command was held;
- the exact context delivered to the model, its character count, and its token
  count under the model tokenizer when available;
- paths/spans named by the emission;
- the git-span state before and after agent-authored span mutations.

Do not store telemetry only inside the disposable container. Avoid writing it
under `/workspace`, where it would enter `submission.tar.gz` and could affect
the solution. Host-side trajectory serialization is preferable.

## Outcomes and analysis

The primary outcome is the official ProgramBench score computed by
`programbench eval`/`programbench info`. Also compare:

- successful compilation and submission rates;
- model calls, input/output tokens, cost, wall time, and command count;
- number and timing of created spans;
- number of spans with a why, number of anchors, and final drift state;
- hook invocations, successful emissions, held commands, failures, and emitted
  tokens;
- whether a surfaced span is followed by relevant later activity or a
  consistency-preserving change.

For observational emission analysis, do not count the file that triggered the
emission as evidence that the emission was useful, do not count activity that
occurred before the emission, and account for late-session emissions having
less opportunity to be used. Compare surfaced paths with a same-project
placebo pool; a raw “later touched” rate has no interpretable baseline by
itself. The existing hook-effect-analysis scripts consume Claude Code JSONL,
not mini-swe-agent trajectories, so either export their expected intermediate
records or implement equivalent joins over ProgramBench trajectories.

Inspect span quality separately from hook usefulness. A high span count can be
mechanical compliance rather than useful coupling documentation. Sample spans
blind to arm outcome and assess whether each why identifies a real implicit
dependency and whether its anchors cover the relevant counterparties.

## Package safeguards and remaining validation

The custom package implements the following safeguards. They must remain
covered by package tests and enabled in the experiment configuration.

1. **Deliver allowed PreToolUse context.** `HookedEnvironmentMixin.execute()`
   appends allowed advisor context to the command's eventual observation. This
   is especially important for `git status`, whose
   report-only uncovered-writes guidance is the mechanism for creating spans
   during development rather than only at the final commit.

2. **Replace unsupported skill-loading prose.** The Python bridge replaces
   “Load the `git-span:git-span` skill” in mini-swe-agent emissions with an
   instruction to read the configured absolute skill file. Required-mode
   preflight validates that file and its containing skill tree.

3. **Use fail-closed treatment semantics.** Enabling hooks is an explicit
   request, so missing bundles always fail environment construction.
   `hooks_required: true` additionally validates Node, git-span, the skill,
   versions/checksums, repository state, and image identity, and turns runtime
   timeouts, non-zero exits, and malformed output into infrastructure failures.

4. **Serialize structured telemetry.** `environment.serialize()` records the
   attestation, ordered per-hook events, exact emitted context, delivery state,
   extracted entities/spans, failures versus clean no-ops, and lifecycle
   summary. The environment records token count as unavailable because it does
   not own the model tokenizer.

5. **Use the same environment class in both arms.** Select treatment with a
   configuration flag, not a different mini-swe-agent distribution. The arm
   label, enabled/required state, image ID, and package identity are serialized
   into every trajectory.

6. **Make artifact versions explicit.** Exact package, Node, git-span, bundle,
   and skill-tree expectations are supported by required-mode preflight.

7. **Preserve context around output truncation.** Context is appended to the
   output tail and also stored separately in telemetry, so exposure remains
   auditable through ProgramBench's 10,000-character observation branch.

8. **Expose clean span lifecycle summaries.** The package records span, anchor,
   why, and drift summaries without injecting them into the model. The
   `mswea-extra` ProgramBench wrapper calls `finish_session()` on every agent
   exit path before the runner's final trajectory save.

### Remaining external validation

9. **Run a real-container integration test outside the development container.** Exercise an actual derived
   ProgramBench image, the `agent` user, bundle discovery, an uncovered
   `git status`, a held commit, span creation, commit retry, and later context
   surfacing. This cannot be executed from the repository development
   container and must be completed in the actual benchmark host environment.
   Fake-Docker and local real-bundle tests are necessary but not sufficient
   evidence that treatment delivery works.

10. **Keep experiment instructions generic.** Do not add ProgramBench-specific
    solution hints, candidate spans, or task-derived examples to the skill or
    hook output. The intervention may explain how and when to use git-span, but
    the agent must discover every task coupling itself.

## Readiness gate

Start the full experiment only after a small shuffled pilot demonstrates all of
the following:

- every treatment trajectory has a valid attestation and zero unclassified
  hook failures;
- every control trajectory reports hooks disabled and uses the identical image
  digest and agent configuration;
- at least some treatment agents receive uncovered-write guidance, create spans,
  and later receive context from those spans;
- no task starts with `.span/` data;
- official evaluation completes for both arms; and
- telemetry can reconstruct exactly which context each model observation saw.

If treatment agents never create spans in the pilot, report that as a finding
about the intervention rather than adding pre-seeded spans. Improve only the
generic workflow guidance, freeze a new treatment bundle, and begin a new
versioned experiment.
