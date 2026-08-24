"""Hermetic tests of the HookBridge: envelope construction, deny, fail-open.

The fixture matrix at the bottom pins BOTH bridge classes to identical
classifications of every subprocess outcome: the environments differ only in
how hook bundles are invoked, never in how results are interpreted.
"""

import logging
import os

import pytest
from conftest import read_record

from minisweagent_gitspan.bridge import (
    DockerHookBridge,
    HookBridge,
    PreToolUseResult,
    RequiredHookError,
    default_hooks_dir,
)


def make_bridge(stub_hooks, *, node_bin="python3", **kwargs):
    return HookBridge(
        session_id="sess-1",
        hooks_dir=str(stub_hooks["dir"]),
        node_bin=node_bin,
        env={**os.environ, "MSWEA_TEST_RECORD": str(stub_hooks["record"])},
        **kwargs,
    )


def test_pre_tool_use_envelope(stub_hooks):
    bridge = make_bridge(stub_hooks)
    result = bridge.pre_tool_use("echo hi", "/work", "tu-1")

    assert not result.denied
    assert result.context is None
    records = read_record(stub_hooks["record"])
    assert [r["hook"] for r in records] == ["static-plan.mjs", "advisor.mjs"]
    for r in records:
        assert r["envelope"] == {
            "session_id": "sess-1",
            "cwd": "/work",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_use_id": "tu-1",
        }


def test_pre_tool_use_deny(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_DENY", "git commit")
    bridge = make_bridge(stub_hooks)

    result = bridge.pre_tool_use("git commit -am x", "/work", "tu-2")

    assert result.denied
    assert result.reason == "span debt: git commit -am x"


def test_pre_tool_use_context(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_PRE", "<git-span> note")
    bridge = make_bridge(stub_hooks)

    result = bridge.pre_tool_use("cat x", "/work", "tu-3")

    assert not result.denied
    assert result.context == "<git-span> note"


def test_post_tool_use_envelope_and_context(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "<git-span> touch")
    bridge = make_bridge(stub_hooks)

    output = {"output": "hello\n", "returncode": 0, "exception_info": ""}
    context = bridge.post_tool_use("echo hello", "/work", "tu-4", output, failure=False)

    assert context == "<git-span> touch"
    records = read_record(stub_hooks["record"])
    assert [r["hook"] for r in records] == ["post-tool-use.mjs"]
    envelope = records[0]["envelope"]
    assert envelope["tool_response"] == {
        "stdout": "hello\n",
        "stderr": "",
        "exitStatus": 0,
        "interrupted": False,
        "timedOutAfterMs": None,
        "rawOutputPath": None,
    }


def test_post_tool_use_failure_branch(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "failed context")
    bridge = make_bridge(stub_hooks)

    output = {"output": "", "returncode": 1, "exception_info": ""}
    context = bridge.post_tool_use("false", "/work", "tu-5", output, failure=True)

    assert context == "failed context"
    records = read_record(stub_hooks["record"])
    assert [r["hook"] for r in records] == ["post-tool-use-failure.mjs"]


def test_session_end(stub_hooks):
    bridge = make_bridge(stub_hooks)
    bridge.session_end("/work")

    records = read_record(stub_hooks["record"])
    assert [r["hook"] for r in records] == ["session-end.mjs"]
    assert records[0]["envelope"] == {"session_id": "sess-1", "cwd": "/work"}


def test_missing_bundles_fail_closed_when_hooks_were_requested(tmp_path):
    bridge = HookBridge(session_id="sess-2", hooks_dir=str(tmp_path / "nope"))

    with pytest.raises(RequiredHookError, match="missing"):
        bridge.pre_tool_use("echo hi", "/work", "tu-6")


def test_hook_crash_fails_open(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_EXIT", "2")
    bridge = make_bridge(stub_hooks)

    result = bridge.pre_tool_use("echo hi", "/work", "tu-7")

    assert not result.denied


def test_required_hook_crash_fails_closed(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_EXIT", "2")
    bridge = make_bridge(stub_hooks, required=True)

    with pytest.raises(RequiredHookError, match="exited 2"):
        bridge.pre_tool_use("echo hi", "/work", "tu-required")

    assert bridge.events[-1]["status"] == "nonzero-exit"


def test_hook_garbage_output_fails_open(stub_hooks, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_RAW", "not json at all")
    bridge = make_bridge(stub_hooks)

    result = bridge.post_tool_use("echo hi", "/work", "tu-8", {"output": "", "returncode": 0}, failure=False)

    assert result is None


def test_hook_empty_output_is_a_quiet_noop(stub_hooks, monkeypatch, caplog):
    # Hooks that have "nothing to say" write nothing to stdout (the Claude
    # runtime writes output only when the hook produces some). That must be a
    # silent no-op, not an "unparsable output" warning.
    monkeypatch.setenv("MSWEA_STUB_EMPTY", "1")
    bridge = make_bridge(stub_hooks)

    with caplog.at_level(logging.WARNING, logger="minisweagent.hooks"):
        result = bridge.pre_tool_use("echo hi", "/work", "tu-9")
        context = bridge.post_tool_use("echo hi", "/work", "tu-10", {"output": "", "returncode": 0}, failure=False)

    assert not result.denied
    assert result.context is None
    assert context is None
    assert "unparsable" not in caplog.text


def test_hooks_dir_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_HOOKS_DIR", str(tmp_path / "elsewhere"))
    bridge = HookBridge(session_id="sess-3", hooks_dir=None)

    assert bridge.hooks_dir == tmp_path / "elsewhere"


def test_default_hooks_dir_points_at_package_bundles():
    hooks_dir = default_hooks_dir()
    assert hooks_dir.name == "bin"
    assert hooks_dir.parent.name == "hooks"
    assert hooks_dir.parent.parent.name == "minisweagent_gitspan"


def test_context_is_rewritten_for_the_mini_agent_and_recorded(stub_hooks, monkeypatch):
    monkeypatch.setenv(
        "MSWEA_STUB_CONTEXT_PRE",
        "<git-span>\n## linked-files\n- src/a.py#L1-L2\n\n{{skill-ref:git-span}}\n</git-span>",
    )
    monkeypatch.setenv("MSWEA_STUB_SKILL_REF", "git-span")
    bridge = make_bridge(stub_hooks, skill_file="/opt/git-span/skills/git-span/SKILL.md")

    result = bridge.pre_tool_use("git status", "/work", "tu-skill")
    bridge.mark_delivered("tu-skill", result.context)

    assert "Load the" not in result.context
    assert "{{skill-ref:" not in result.context
    assert "`/opt/git-span/skills/git-span/SKILL.md`" in result.context
    event = bridge.events[0]
    assert event["context"] == result.context
    assert event["context_chars"] == len(result.context)
    assert event["context_tokens"] is None
    assert event["entities"] == ["src/a.py"]
    assert event["spans"] == ["linked-files"]
    assert event["delivered"] is True
    assert event["ordinal"] == 1
    assert event["duration_ms"] >= 0


def test_deny_reason_is_rewritten_when_the_field_gates_it(stub_hooks, monkeypatch):
    # The advisor's deny reason carries the same placeholder; substitution is
    # gated on the structured field, not on where the payload travels.
    monkeypatch.setenv("MSWEA_STUB_DENY", "git commit")
    monkeypatch.setenv("MSWEA_STUB_REASON_SUFFIX", "\n{{skill-ref:git-span}}")
    monkeypatch.setenv("MSWEA_STUB_SKILL_REF", "git-span")
    bridge = make_bridge(stub_hooks, skill_file="/opt/git-span/skills/git-span/SKILL.md")

    result = bridge.pre_tool_use("git commit -am x", "/work", "tu-reason")

    assert result.denied
    assert "{{skill-ref:" not in (result.reason or "")
    assert "`/opt/git-span/skills/git-span/SKILL.md`" in (result.reason or "")


def test_absent_skill_ref_field_leaves_the_payload_untouched(stub_hooks, monkeypatch):
    # Fail-closed: without hookSpecificOutput.skillRef the bridge never
    # attempts any rewriting — a raw placeholder passes through verbatim
    # rather than being silently matched against prose.
    payload = "<git-span>\n- src/a.py#L1-L2\n\n{{skill-ref:git-span}}\n</git-span>"
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_PRE", payload)
    bridge = make_bridge(stub_hooks, skill_file="/opt/git-span/skills/git-span/SKILL.md")

    result = bridge.pre_tool_use("cat x", "/work", "tu-nofield")

    assert result.context == payload


def test_unknown_skill_ref_drops_the_guidance_line(stub_hooks, monkeypatch):
    # A ref this environment cannot resolve must not leak a Claude Code skill
    # name (or a raw token) to the model: the guidance line is dropped.
    monkeypatch.setenv(
        "MSWEA_STUB_CONTEXT_PRE",
        "<git-span>\n- src/a.py#L1-L2\n\n{{skill-ref:reconcile}}\n</git-span>",
    )
    monkeypatch.setenv("MSWEA_STUB_SKILL_REF", "reconcile")
    bridge = make_bridge(stub_hooks, skill_file="/opt/git-span/skills/git-span/SKILL.md")

    result = bridge.pre_tool_use("cat x", "/work", "tu-unknown")

    assert result.context == "<git-span>\n- src/a.py#L1-L2\n\n</git-span>"


def test_unconfigured_skill_file_still_never_leaks_the_placeholder(stub_hooks, monkeypatch):
    # Without a configured skill_file no instruction can be produced, but the
    # placeholder line is still dropped: the mini agent never sees the token.
    monkeypatch.setenv(
        "MSWEA_STUB_CONTEXT_PRE",
        "<git-span>\n- src/a.py#L1-L2\n\n{{skill-ref:git-span}}\n</git-span>",
    )
    monkeypatch.setenv("MSWEA_STUB_SKILL_REF", "git-span")
    bridge = make_bridge(stub_hooks)

    result = bridge.pre_tool_use("cat x", "/work", "tu-nofile")

    assert result.context == "<git-span>\n- src/a.py#L1-L2\n\n</git-span>"


def make_docker_bridge(stub_hooks, fake_docker, *, executable=None, **kwargs):
    return DockerHookBridge(
        session_id="sess-d",
        executable=executable or str(fake_docker["path"]),
        container_id="fake-container-1",
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
        **kwargs,
    )


def test_docker_bridge_exec_command_shape(stub_hooks, fake_docker):
    bridge = make_docker_bridge(stub_hooks, fake_docker, env_pairs={"FOO": "bar"})

    bridge.pre_tool_use("echo hi", "/work", "tu-d1")

    execs = [r for r in read_record(fake_docker["record"]) if r["verb"] == "exec"]
    assert execs[0] == {
        "verb": "exec",
        "container_id": "fake-container-1",
        "cwd": "/work",
        "envs": {"FOO": "bar"},
        "command": ["python3", f"{stub_hooks['dir']}/static-plan.mjs"],
    }


def test_docker_bridge_empty_output_is_a_quiet_noop(stub_hooks, fake_docker, monkeypatch, caplog):
    monkeypatch.setenv("MSWEA_STUB_EMPTY", "1")
    bridge = make_docker_bridge(stub_hooks, fake_docker)

    with caplog.at_level(logging.WARNING, logger="minisweagent.hooks"):
        result = bridge.pre_tool_use("echo hi", "/work", "tu-d2")

    assert not result.denied
    assert result.context is None
    assert "unparsable" not in caplog.text


def test_docker_bridge_missing_executable_fails_open(stub_hooks, tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("MSWEA_STUB_DENY", "git commit")
    bridge = DockerHookBridge(
        session_id="sess-d",
        executable=str(tmp_path / "no-such-docker"),
        container_id="cid",
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
    )

    with caplog.at_level(logging.WARNING, logger="minisweagent.hooks"):
        result = bridge.pre_tool_use("git commit -am x", "/work", "tu-d3")

    assert not result.denied
    assert "failed open" in caplog.text


# One taxonomy of subprocess outcomes, shared by every environment: timeout,
# OSError on spawn, nonzero exit, clean no-op, malformed JSON. Each case lists
# the stub env that produces it, the event status both bridges must record,
# and a fragment of the error message (absent for the clean no-op). The
# launch-error case instead breaks the launcher binary itself, which is
# environment-specific (host node vs docker executable).
#
# Only the timeout case is about the timeout taxonomy, so only it carries a
# tight budget; every other case classifies on exit code or stdout shape, and
# a shared tight budget made those classifications depend on scheduler
# latency — under the workspace-parallel validation load a bare interpreter
# startup could exceed 250ms and flip e.g. nonzero-exit into timeout,
# identically on pristine baselines, host and docker alike.
HOOK_RESULT_MATRIX = [
    {
        "stub_env": {"MSWEA_STUB_EXIT": "2"},
        "status": "nonzero-exit",
        "error": "exited 2",
        "timeout_ms": 10_000,
    },
    {
        "stub_env": {"MSWEA_STUB_EMPTY": "1"},
        "status": "clean-noop",
        "timeout_ms": 10_000,
    },
    {
        "stub_env": {"MSWEA_STUB_RAW": '{"hookSpecificOutput": '},
        "status": "malformed-output",
        "error": "unparsable",
        "timeout_ms": 10_000,
    },
    {
        "stub_env": {"MSWEA_STUB_SLEEP": "10"},
        "status": "timeout",
        "error": "timed out after 250ms",
        "timeout_ms": 250,
    },
    {
        "stub_env": {},
        "status": "launch-error",
        "error": "failed open",
        "break_launcher": True,
        "timeout_ms": 10_000,
    },
]


@pytest.mark.parametrize("bridge_kind", ["host", "docker"])
@pytest.mark.parametrize("case", HOOK_RESULT_MATRIX, ids=lambda case: case["status"])
def test_result_taxonomy_identical_across_environments(
    case, bridge_kind, stub_hooks, fake_docker, tmp_path, monkeypatch
):
    """Both bridge classes classify every subprocess outcome identically."""
    for key, value in case["stub_env"].items():
        monkeypatch.setenv(key, value)
    broken = case.get("break_launcher", False)
    host_kwargs = {"node_bin": str(tmp_path / "no-such-node")} if broken else {}
    docker_kwargs = {"executable": str(tmp_path / "no-such-docker")} if broken else {}

    def make(kind, required):
        common = {"timeout_ms": case["timeout_ms"], "required": required}
        if kind == "host":
            return make_bridge(stub_hooks, **common, **host_kwargs)
        return make_docker_bridge(stub_hooks, fake_docker, **common, **docker_kwargs)

    # A real cwd: `docker exec -w` fails on a nonexistent workdir, which would
    # mask the hook outcome under test.
    cwd = str(tmp_path)

    # Fail-open default: no denial, no context — for failures and clean no-ops alike.
    bridge = make(bridge_kind, required=False)
    assert bridge.pre_tool_use("echo hi", cwd, f"tu-m-{bridge_kind}") == PreToolUseResult()
    event = bridge.events[-1]
    assert event["hook"] == "advisor"
    assert event["status"] == case["status"]
    assert case.get("error", "") in (event.get("error") or "")

    # Required mode escalates every failure; a clean no-op stays a success.
    if case["status"] == "clean-noop":
        assert make(bridge_kind, required=True).pre_tool_use("echo hi", cwd, f"tu-r-{bridge_kind}") == (
            PreToolUseResult()
        )
    else:
        with pytest.raises(RequiredHookError, match=case["error"]):
            make(bridge_kind, required=True).pre_tool_use("echo hi", cwd, f"tu-r-{bridge_kind}")
