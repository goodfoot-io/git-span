"""Hermetic tests of the HookBridge: envelope construction, deny, fail-open."""

import logging
import os

import pytest
from conftest import read_record

from minisweagent_gitspan.bridge import DockerHookBridge, HookBridge, RequiredHookError, default_hooks_dir


def make_bridge(stub_hooks, **kwargs):
    return HookBridge(
        session_id="sess-1",
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
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
        "<git-span>\n## linked-files\n- src/a.py#L1-L2\n\nLoad the `git-span:git-span` skill for guidance.\n</git-span>",
    )
    bridge = make_bridge(stub_hooks, skill_file="/opt/git-span/skills/git-span/SKILL.md")

    result = bridge.pre_tool_use("git status", "/work", "tu-skill")
    bridge.mark_delivered("tu-skill", result.context)

    assert "Load the" not in result.context
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


def make_docker_bridge(stub_hooks, fake_docker, **kwargs):
    return DockerHookBridge(
        session_id="sess-d",
        executable=str(fake_docker["path"]),
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
