#!/usr/bin/env python3
"""Bridge smoke test against a real derived ProgramBench task container.

Implements programbench-setup-guide.md's "Preflight one real task container"
/ bridge smoke scenario (lines ~149-176) end to end, against the derived
image built by experiment/build-image.sh. Run from the package venv:

    uv run python experiment/smoke_test.py \
        --image programbench/xorg62_1776_tty-clock.f2f847c:task_cleanroom_v6 \
        [--expected experiment/expected.json]

Exits 0 only if every numbered assertion passes. Always prints a numbered
PASS/FAIL transcript to stdout and appends it to
reports/programbench/smoke.md.

Three environments get exercised: (a)-(f) run the full hooked scenario
(disposable repo, uncovered-writes report, an already-presented allow, a
held commit on fresh debt, span creation, retry, anchored-read context,
serialize() shape) against a hooks_required=False-then-flipped-True
environment rooted at a disposable /tmp/smoke-repo (see the
attestation-ordering design note below); (g) constructs a second, read-only
environment with hooks_required=True set at construction time and
cwd=/workspace -- the derived image's real task checkout -- proving the
actual fail-closed init-time attestation path a real ProgramBench eval run
takes succeeds end-to-end, not just the deferred path used to reach a
disposable repo; (h) constructs a third environment mirroring control.yaml
(hooks_enabled=False) against cwd=/workspace and confirms `git status` is
unhooked (no <git-span> content) and serialize() reports hooks disabled.

NOT YET RUN. Drafted while the wheel rebuild (a parallel task) and the
derived image (experiment/build-image.sh, also not yet run) are still in
flight. This header documents the real API surface it relies on and why,
verified against source rather than guessed:

API facts relied on
--------------------
- ``HookedDockerEnvironment`` / ``HookedDockerEnvironmentConfig`` live in
  ``src/minisweagent_gitspan/environment.py``. The config is
  ``DockerEnvironmentConfig`` (image, cwd, env, forward_env, timeout,
  executable, run_args, container_timeout, pull_timeout, interpreter; see
  vendor/third-party/mini-swe-agent/src/minisweagent/environments/docker.py)
  plus ``HookedConfigMixin`` (hooks_enabled, hooks_dir, node_bin,
  hook_timeout_ms, hooks_required, skill_file, require_initial_no_spans,
  experiment_arm, expected_package_version, expected_node_version,
  expected_git_span_version, expected_bundle_sha256,
  expected_skill_tree_sha256).
- ``config.cwd`` is BOTH the container's ``-w`` working dir at ``docker run``
  time (docker.py ``_start_container``) AND the default cwd for
  ``execute()`` (docker.py ``execute``, environment.py ``execute``) --
  overridable per call via ``execute(action, cwd=...)``. This is how the
  scenario targets a disposable repo instead of the task's real
  ``/workspace`` checkout: construct the environment with
  ``cwd="/tmp/smoke-repo"`` directly, never touching ``/workspace``.
  CORRECTION (found by actually running this against the derived image,
  2026-08-12): a missing ``-w`` leaf directory IS auto-created by dockerd
  before the container's entrypoint runs, but it is created ``root:root``
  mode ``0755`` regardless of where it lives (verified for both ``/tmp/...``
  and ``/home/agent/...`` targets) -- NOT world-writable, and unwritable by
  the non-root ``--user agent`` the container otherwise runs as (only ``/tmp``
  itself carries the sticky world-writable bit; a fresh child of it does
  not inherit that). ``main()`` below therefore does one ``docker exec -u
  root <container> chown agent:agent <cwd>`` immediately after the
  container starts and before any ``agent``-user command touches
  ``DISPOSABLE_CWD``. This is purely a smoke-test harness fix: the real
  ProgramBench pipeline only ever uses ``cwd="/workspace"``, which already
  exists (and is already ``agent``-owned) in every derived task image before
  the container starts, so it never hits this path -- nothing about
  ``HookedDockerEnvironment``, the image, or the hooks is implicated.
- ``execute()`` returns ``{"output": str, "returncode": int,
  "exception_info": str}``. A HELD command (span-debt advisor deny) surfaces
  as an ORDINARY, non-raising return with ``returncode == 1`` and the
  advisor's deny reason as the entire ``output`` text (environment.py
  ``HookedEnvironmentMixin.execute``, the ``pre.denied`` branch) -- there is
  no separate boolean on the return value. The authoritative signal that a
  command was actually held (vs. a legitimate failure) is
  ``hooks.events[-1]["denied"] is True`` on the advisor event
  (bridge.py ``HookBridge._deny_and_context``).
- ``ALL_HOOKS = ("snapshot", "advisor", "post-tool-use",
  "post-tool-use-failure", "session-end")``; every hook invocation appends
  one dict to ``env.hooks.events`` with ``ordinal`` (monotonic, 1-based),
  ``hook``, ``status``, ``denied``, ``context``, ``delivered``
  (bridge.py ``HookBridge._new_event`` / ``_deny_and_context``).
- Design decision -- attestation ordering: ``_build_attestation``
  (environment.py) runs INSIDE ``HookedDockerEnvironment.__init__`` when
  ``hooks_required=True``, against ``self.config.cwd`` -- before any command
  can run to prepare a disposable repo there. Constructing directly with
  ``hooks_required=True`` against a not-yet-created ``/tmp/smoke-repo`` would
  therefore fail construction outright (confirmed against
  tests/test_docker_environment.py::test_required_treatment_records_container_image_id,
  which git-inits its ``tmp_path`` on the HOST *before* constructing --
  not reproducible for an in-container path we don't control ahead of the
  container existing). Instead this script constructs with
  ``hooks_required=False`` (still builds the real ``DockerHookBridge`` and
  starts the real container; only the attestation call is skipped), uses the
  raw command runner (``env._execute_raw``, the same "raw docker exec"
  helper ``HookedEnvironmentMixin`` documents subclasses must supply) to
  ``git init`` the disposable repo without generating hook noise, flips
  ``env.config.hooks_required`` / ``env.hooks.required`` to ``True``, and
  then calls the SAME internal ``_build_attestation`` function (imported
  directly, not reimplemented) against the now-ready repo. This is the real
  production attestation logic, just invoked once the repo exists instead of
  at ``__init__`` time.
- ``HookBridge._rewrite_context`` (bridge.py) replaces "Load the
  `git-span:git-span` skill for guidance." / "...in the fork." with a
  sed-the-SKILL.md instruction whenever ``skill_file`` is configured --
  assertion (f) checks that replacement text appears in some delivered
  event context and that the literal "Load the `git-span:git-span` skill"
  string does not appear anywhere.
- ``env.serialize()["info"]["hooks"]`` (environment.py
  ``HookedEnvironmentMixin.serialize``) contains session_id / enabled /
  required / arm / attestation / events / span_summary / session_finished.
- ProgramBench's real docker run_args (vendor/third-party/mini-swe-agent/
  src/minisweagent/config/benchmarks/programbench.yaml): ``--rm --network
  none --cpus 20 --memory 60g --memory-swap 60g --user agent --cap-drop
  SYS_PTRACE``. This smoke test keeps ``--network none``, ``--user agent``,
  ``--cap-drop SYS_PTRACE`` (the settings that affect what the container is
  allowed to do) but uses smaller ``--cpus``/``--memory`` for a quick local
  run, plus ``--platform linux/amd64`` prepended -- ``run_args`` passes
  straight through to ``docker run`` (docker.py), and ``docker run`` accepts
  a bare ``--platform`` flag directly, so no dedicated config field is
  needed and there is no open question about targeting amd64 from the arm64
  host.

Both things task #8's assignment flagged as open questions turned out to be
directly configurable through the real API (non-/workspace cwd via
``config.cwd``; amd64 targeting via ``run_args``), so nothing here is a
guessed workaround -- it's exactly what ``DockerEnvironmentConfig`` and
``HookedDockerEnvironment`` already expose. The one design decision (the
attestation two-phase construction above) is noted for the lead's awareness,
not because anything is broken -- it's the only ordering that makes sense
given a container-relative disposable path and the constructor being the
sole place ``_build_attestation`` is normally called from.

Reordering rationale -- "already-presented" is documented, intended advisor
behavior, NOT a bug (team-lead ruling, 2026-08-12; verified independently
against source): ``packages/agent-hooks/src/common/advisor-core.ts`` (~lines
685-730, 843-844) explicitly documents that a ``'may-hold'`` commit resolves
to ``allow``/``'already-presented'`` -- passes with no hold -- whenever "a
prior `'report-only'` preview already showed this exact state in full". The
hold is a hold-ONCE backstop for debt the agent was never shown, not a
re-nag for debt it already saw via `status`. Concretely: for the *same*
uncovered-paths digest, a `git commit` immediately following a `git status`
preview is *expected* to be allowed, not held.

This makes ``programbench-setup-guide.md``'s literal smoke-scenario ordering
(run `status` on file_a/file_b, THEN attempt `commit` on the SAME pair and
expect a hold) imprecise, not the advisor: that exact sequence exercises the
allow/already-presented path by design. The scenario below is adjusted to
assert the real documented contract on both halves instead of the guide's
literal wording: (c1) `git commit` on the file_a/file_b debt already
previewed by `status` is asserted ALLOWED (no denial) -- expected, not a
regression; (c2) a FRESH, never-previewed debt state (a different uncovered
digest: the file_c.txt/file_d.txt PAIR, never shown via `status`) is
asserted HELD once, proving the backstop still fires for debt the agent was
never shown. (c2) uses a pair, not a single file, because
``computeUncoveredPaths`` (advisor.mjs) short-circuits to zero uncovered
paths whenever the changeset has fewer than 2 paths -- a single-file
commit/status can never trigger an uncovered-writes report or hold at all,
independent of the already-presented question; confirmed empirically before
settling on the pair. (d)-(e) then exercise span add/why/retry-commit and
anchored-read context against that file_c/file_d debt (the one actually
held), rather than file_a/file_b (whose debt was legitimately disarmed by
the preview in c1). An experiment-level implication worth flagging in the
readiness report: an agent that runs `git status` before committing disarms
the later commit-time hold for that exact debt state -- by design, per the
contract above.
"""

from __future__ import annotations

import argparse
import gc
import json
import shlex
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SMOKE_REPORT = REPO_ROOT / "reports" / "programbench" / "smoke.md"

DISPOSABLE_CWD = "/tmp/smoke-repo"
# Spans the file_c/file_d debt held in step (c2) -- the file_a/file_b debt
# from (b)/(c1) is legitimately disarmed by the prior `git status` preview
# (see module docstring "Reordering rationale") and is never spanned in this
# scenario. NOTE: computeUncoveredPaths (advisor.mjs) short-circuits to
# "no uncovered paths" whenever the changeset has fewer than 2 paths -- a
# single-file commit/status can NEVER trigger an uncovered-writes report or
# hold, regardless of digest novelty. So the fresh-debt pair for (c2) must
# also be TWO files, same as (b)'s file_a/file_b pair.
SPAN_NAME = "file-cd-pair"
SPAN_WHY = "file_c.txt and file_d.txt change together for their own reason, independent of file_a.txt/file_b.txt."

KNOWN_HOOK_STATUSES = {
    "success",
    "clean-noop",
    "missing-bundle",
    "timeout",
    "launch-error",
    "nonzero-exit",
    "malformed-output",
}


class SmokeFailure(RuntimeError):
    """Raised to hard-fail the scenario at the first broken assertion."""


class Transcript:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self._n = 0

    def step(self, description: str, ok: bool, detail: str = "") -> None:
        self._n += 1
        status = "PASS" if ok else "FAIL"
        line = f"{self._n}. [{status}] {description}"
        if detail:
            line += f" -- {detail}"
        print(line)
        self.lines.append(line)
        if not ok:
            raise SmokeFailure(f"step {self._n} failed: {description} -- {detail}")

    def note(self, text: str) -> None:
        print(text)
        self.lines.append(text)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--image",
        default="programbench/xorg62_1776_tty-clock.f2f847c:task_cleanroom_v6",
        help="Derived image tag to smoke-test.",
    )
    parser.add_argument(
        "--skill-file",
        default="/opt/git-span/skills/git-span/SKILL.md",
        help="In-container absolute path to the frozen SKILL.md (see experiment/Dockerfile).",
    )
    parser.add_argument(
        "--expected",
        type=Path,
        default=None,
        help=(
            "Optional JSON file with expected_package_version / expected_node_version / "
            "expected_git_span_version / expected_bundle_sha256 / expected_skill_tree_sha256 "
            "(the experiment manifest task's real values). Omit to run the attestation "
            "without exact-value checks -- only structural/consistency checks then apply."
        ),
    )
    parser.add_argument(
        "--keep-container",
        action="store_true",
        help="Do not stop/remove the container on failure (for post-mortem debugging).",
    )
    return parser.parse_args()


def build_run_args() -> list[str]:
    # See module docstring: keeps ProgramBench's real network/user/capability
    # restrictions, adds --platform for the arm64 host, trims cpu/memory for
    # a quick local smoke run.
    return [
        "--rm",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--user",
        "agent",
        "--cap-drop",
        "SYS_PTRACE",
        "--cpus",
        "2",
        "--memory",
        "2g",
        "--memory-swap",
        "2g",
    ]


def main() -> int:
    args = parse_args()
    expected: dict = {}
    if args.expected is not None:
        expected = json.loads(args.expected.read_text())

    # Imported here (not at module scope) so --help works even before the
    # package venv/wheel exists.
    from minisweagent_gitspan.environment import HookedDockerEnvironment, _build_attestation

    t = Transcript()
    t.note(f"# Bridge smoke test -- {datetime.now(UTC).isoformat()}")
    t.note(f"image={args.image!r} skill_file={args.skill_file!r} cwd={DISPOSABLE_CWD!r}")

    env = None
    env_init = None
    env_control = None
    try:
        env = HookedDockerEnvironment(
            image=args.image,
            cwd=DISPOSABLE_CWD,
            run_args=build_run_args(),
            timeout=60,
            hooks_enabled=True,
            hooks_required=False,  # attestation deferred; see module docstring
            skill_file=args.skill_file,
            experiment_arm="treatment-smoke",
            node_bin="node",
            env={"PAGER": "cat", "MANPAGER": "cat"},
            **expected,  # expected_package_version / expected_node_version / etc., already named to match the config fields
        )
        t.step("environment constructed, container started, hook bundles probed", True)

        # --- Fix ownership of the auto-created disposable-cwd directory. ---
        # docker auto-creates a missing `-w` leaf dir as root:root 0755 (see
        # module docstring CORRECTION); the container otherwise runs as the
        # non-root `agent` user, so without this the very first `agent`-user
        # write into DISPOSABLE_CWD fails with EACCES. One-off root exec,
        # harness-only -- does not touch src/, the image, or hooks.
        chown_fix = subprocess.run(
            [env.config.executable, "exec", "-u", "root", env.container_id, "chown", "agent:agent", DISPOSABLE_CWD],
            capture_output=True,
            text=True,
            timeout=30,
        )
        t.step(
            f"fixed up docker-auto-created {DISPOSABLE_CWD} ownership (root:root -> agent:agent)",
            chown_fix.returncode == 0,
            (chown_fix.stderr or chown_fix.stdout).strip(),
        )

        # --- Prepare the disposable repo, bypassing hooks (raw runner). ----
        setup_cmd = (
            f"set -e; mkdir -p {shlex.quote(DISPOSABLE_CWD)}; cd {shlex.quote(DISPOSABLE_CWD)}; "
            "git init -q; "
            "git config user.email smoke@example.invalid; git config user.name 'git-span smoke test'; "
            "printf 'one\\n' > file_a.txt; printf 'two\\n' > file_b.txt; "
            "git add file_a.txt file_b.txt; git commit -q -m 'initial commit'"
        )
        setup = env._execute_raw(setup_cmd, DISPOSABLE_CWD, env.config.timeout)
        t.step(
            "disposable repo initialized with two ordinary committed files (no spans)",
            setup["returncode"] == 0,
            setup["output"].strip()[-500:],
        )

        # --- Flip to the real treatment mode and build the attestation. ----
        env.config.hooks_required = True
        env.config.require_initial_no_spans = True
        env.hooks.required = True
        try:
            attestation = _build_attestation(env.config, env.hooks, env.config.cwd, env._container_probe, "python3")
            env.hook_attestation = attestation
            attestation_ok = attestation.get("valid") is True
            attestation_detail = ""
        except Exception as exc:  # RequiredHookError or similar
            attestation_ok = False
            attestation_detail = str(exc)
        t.step(
            "attestation valid (node/git-span versions, bundle hashes, skill file/tree, zero initial spans)",
            attestation_ok,
            attestation_detail,
        )

        # --- (b) modify both files, `git status` carries uncovered-writes guidance. ---
        # The file writes must land on disk in their OWN step before `git
        # status` runs as a separate `env.execute()` call: the advisor's
        # PreToolUse hook inspects git state (staged/tracked-modified paths)
        # BEFORE the bash tool's command body actually executes, so bundling
        # "modify files; git status" into a single execute() call means the
        # advisor sees the pre-modification (unchanged) worktree and reports
        # nothing to cover. Splitting the write into its own raw (unhooked --
        # matches the guide's step 2, "modify both files without creating
        # spans", being distinct from step 3's hooked `git status`) step
        # fixes this; harness-only, no src/ change.
        modify = env._execute_raw(
            "printf 'one changed\\n' >> file_a.txt; printf 'two changed\\n' >> file_b.txt",
            DISPOSABLE_CWD,
            env.config.timeout,
        )
        t.step(
            "modified both tracked files (no spans created)", modify["returncode"] == 0, modify["output"].strip()[-300:]
        )

        status = env.execute({"command": "git status"})
        # The actual advisor copy for this report never uses the literal word
        # "uncovered" (checked against the real bundle output below) -- it
        # lists the unspanned paths and points at `git span add`/`git span
        # why`. Assert on that real wording instead of a guessed substring.
        has_tag = "<git-span>" in status["output"]
        has_file_list = "file_a.txt" in status["output"] and "file_b.txt" in status["output"]
        has_guidance = "git span add" in status["output"] and "git span why" in status["output"]
        status_ok = has_tag and has_file_list and has_guidance
        t.step(
            "`git status` observation contains a <git-span> report listing both unspanned files with span-creation guidance",
            status_ok,
            "" if status_ok else status["output"][-800:],
        )

        # --- (c1) `git commit -am` for the ALREADY-PRESENTED debt is ALLOWED,
        # not held (see module docstring "Reordering rationale" / advisor-core.ts
        # ~685-730, 843-844): the prior `git status` above already showed this
        # exact uncovered-paths digest ({file_a.txt, file_b.txt}) in full, so
        # the advisor's hold-once backstop does not re-fire -- this commit is
        # EXPECTED to succeed.
        allowed_attempt = env.execute({"command": "git commit -am 'update both files (already-presented debt)'"})
        advisor_events_c1 = [e for e in env.hooks.events if e.get("hook") == "advisor"]
        c1_not_denied = not (bool(advisor_events_c1) and advisor_events_c1[-1].get("denied") is True)
        allowed_ok = allowed_attempt["returncode"] == 0 and c1_not_denied
        t.step(
            "`git commit -am` for the already-presented file_a/file_b debt is ALLOWED (advisor: allow/already-presented, no denial)",
            allowed_ok,
            ""
            if allowed_ok
            else f"returncode={allowed_attempt['returncode']} advisor_events={advisor_events_c1[-1:]} output={allowed_attempt['output'][-500:]}",
        )

        # --- (c2) FRESH uncovered debt -- a DIFFERENT digest ({file_c.txt,
        # file_d.txt} instead of {file_a.txt, file_b.txt}) -- that was never
        # shown via a prior `git status` preview must still be HELD once.
        # This proves the backstop still fires for debt the agent was never
        # shown, per the same documented contract. Uses a PAIR of files, not
        # a single one: computeUncoveredPaths (advisor.mjs) short-circuits to
        # zero uncovered paths whenever the changeset has fewer than 2 paths
        # (``if (paths.length < 2) return { uncovered: [], covering: [] };``),
        # so a single-file commit can NEVER hold regardless of digest
        # novelty -- confirmed empirically (a file_c-only version of this
        # step returned clean-noop/allow every time, never a hold).
        new_files_setup = env._execute_raw(
            "printf 'three\\n' > file_c.txt; printf 'four\\n' > file_d.txt; "
            "git add file_c.txt file_d.txt; git commit -q -m 'add file_c and file_d'; "
            "printf 'three changed\\n' >> file_c.txt; printf 'four changed\\n' >> file_d.txt",
            DISPOSABLE_CWD,
            env.config.timeout,
        )
        t.step(
            "file_c.txt/file_d.txt committed clean then both modified (fresh debt digest, no prior status preview for it)",
            new_files_setup["returncode"] == 0,
            new_files_setup["output"].strip()[-300:],
        )
        held_attempt = env.execute({"command": "git commit -am 'update file_c and file_d'"})
        advisor_events = [e for e in env.hooks.events if e.get("hook") == "advisor"]
        last_advisor_denied = bool(advisor_events) and advisor_events[-1].get("denied") is True
        held_ok = held_attempt["returncode"] != 0 and last_advisor_denied and bool(held_attempt["output"].strip())
        t.step(
            "`git commit -am` for never-previewed file_c/file_d debt held once with span-creation guidance (advisor event denied=True)",
            held_ok,
            "" if held_ok else f"returncode={held_attempt['returncode']} advisor_events={advisor_events[-1:]}",
        )

        # --- (d) create the span + why for the held file_c/file_d debt, stage code+.span/, retry commit succeeds. ---
        add_span = env.execute({"command": f"git span add {SPAN_NAME} file_c.txt file_d.txt"})
        t.step("`git span add` created the span", add_span["returncode"] == 0, add_span["output"].strip()[-500:])
        add_why = env.execute({"command": f"git span why {SPAN_NAME} {shlex.quote(SPAN_WHY)}"})
        t.step("`git span why` recorded the why", add_why["returncode"] == 0, add_why["output"].strip()[-500:])
        retry_commit = env.execute(
            {"command": "git add file_c.txt file_d.txt .span && git commit -m 'update file_c/file_d with span'"}
        )
        t.step(
            "retry commit (code + .span/ staged together) succeeds",
            retry_commit["returncode"] == 0,
            retry_commit["output"].strip()[-500:],
        )

        # --- (e) touch/read the anchored region surfaces span context later. ---
        read_anchor = env.execute({"command": "cat file_c.txt"})
        context_mentions_span = SPAN_NAME in read_anchor["output"] or "<git-span>" in read_anchor["output"]
        t.step(
            "reading an anchored region surfaces span context in a later observation",
            context_mentions_span,
            "" if context_mentions_span else read_anchor["output"][-500:],
        )

        # --- (f) serialize()/hooks: attestation, ordered events, skill-loading rewrite. ---
        env.finish_session()
        info = env.serialize()["info"]["hooks"]
        events = info["events"]
        ordinals_ok = [e["ordinal"] for e in events] == list(range(1, len(events) + 1))
        statuses_ok = all(e.get("status") in KNOWN_HOOK_STATUSES for e in events)
        contexts = [e.get("context") or "" for e in events]
        rewrite_present = any(f"Read `{args.skill_file}` with `sed`" in c for c in contexts)
        raw_prose_absent = all("Load the `git-span:git-span` skill" not in c for c in contexts)
        serialize_ok = (
            info["attestation"].get("valid") is True
            and ordinals_ok
            and statuses_ok
            and rewrite_present
            and raw_prose_absent
        )
        t.step(
            "serialize()['info']['hooks']: valid attestation, ordered events, no unclassified failures, skill prose rewritten",
            serialize_ok,
            ""
            if serialize_ok
            else json.dumps(
                {
                    "ordinals_ok": ordinals_ok,
                    "statuses_ok": statuses_ok,
                    "rewrite_present": rewrite_present,
                    "raw_prose_absent": raw_prose_absent,
                }
            ),
        )

        # --- (g) the REAL init-time attestation path: hooks_required=True at
        # construction, against /workspace, which is already a git repo (the
        # task checkout) in the derived image -- unlike the disposable-repo
        # scenario above, nothing needs to be prepped first, so this exercises
        # the actual code path a real ProgramBench eval run takes. Read-only:
        # no commands are executed in this environment, only construction and
        # serialize().
        try:
            env_init = HookedDockerEnvironment(
                image=args.image,
                cwd="/workspace",
                run_args=build_run_args(),
                timeout=60,
                hooks_enabled=True,
                hooks_required=True,
                require_initial_no_spans=True,
                skill_file=args.skill_file,
                experiment_arm="treatment-smoke-init",
                node_bin="node",
                env={"PAGER": "cat", "MANPAGER": "cat"},
                **expected,
            )
            env_init.finish_session()
            init_attestation = env_init.serialize()["info"]["hooks"]["attestation"]
            init_ok = init_attestation.get("valid") is True
            init_detail = "" if init_ok else json.dumps(init_attestation.get("errors"))
        except Exception as exc:  # RequiredHookError (or any other __init__ failure)
            init_ok = False
            init_detail = str(exc)
            # Construction raised inside __init__, so the (partially built)
            # instance was never assigned to env_init -- there is no handle
            # to call .cleanup() on directly. DockerEnvironment also runs
            # cleanup() from __del__; the only thing keeping the orphaned
            # instance alive is this except block's traceback frame (it
            # references __init__'s `self` via the call stack). Drop that
            # reference and force a collection now so the leaked container is
            # stopped/removed before the script exits, instead of whenever
            # the interpreter next happens to collect it.
            del exc
            gc.collect()
        t.step(
            "second HookedDockerEnvironment(hooks_required=True, cwd=/workspace) constructs cleanly with a valid init-time attestation",
            init_ok,
            init_detail,
        )

        # --- (h) control arm (control.yaml semantics): hooks_enabled=False
        # must produce a bare, unhooked `git status` -- no <git-span> content
        # anywhere in the observation -- and serialize() must report hooks
        # disabled. Mirrors control.yaml's environment block exactly
        # (hooks_enabled/hooks_required false, experiment_arm "control");
        # model/limits config from control.yaml isn't exercised here since
        # this smoke test never invokes the model.
        env_control = HookedDockerEnvironment(
            image=args.image,
            cwd="/workspace",
            run_args=build_run_args(),
            timeout=60,
            hooks_enabled=False,
            hooks_required=False,
            skill_file=args.skill_file,
            experiment_arm="control",
            node_bin="node",
            env={"PAGER": "cat", "MANPAGER": "cat"},
        )
        control_status = env_control.execute({"command": "git status"})
        env_control.finish_session()
        control_info = env_control.serialize()["info"]["hooks"]
        control_ok = (
            "<git-span>" not in control_status["output"]
            and control_info.get("enabled") is False
            and control_info.get("arm") == "control"
        )
        t.step(
            "control arm (hooks_enabled=False): `git status` carries no <git-span> content and serialize() reports hooks disabled",
            control_ok,
            ""
            if control_ok
            else json.dumps(
                {
                    "enabled": control_info.get("enabled"),
                    "arm": control_info.get("arm"),
                    "status_output": control_status["output"][-300:],
                }
            ),
        )

        t.note("\nALL ASSERTIONS PASSED")
        return 0

    except SmokeFailure as exc:
        t.note(f"\nSMOKE TEST FAILED: {exc}")
        return 1
    finally:
        SMOKE_REPORT.parent.mkdir(parents=True, exist_ok=True)
        with SMOKE_REPORT.open("a") as f:
            f.write("\n".join(t.lines) + "\n\n")
        if env is not None and not args.keep_container:
            env.cleanup()
        if env_init is not None and not args.keep_container:
            env_init.cleanup()
        if env_control is not None and not args.keep_container:
            env_control.cleanup()


if __name__ == "__main__":
    sys.exit(main())
