"""HookedLocalEnvironment: deny short-circuit, context append, session end."""

import pytest
from conftest import read_record

from minisweagent_gitspan.environment import HookedLocalEnvironment


def make_environment(stub_hooks, tmp_path, **kwargs):
    return HookedLocalEnvironment(
        cwd=str(tmp_path),
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
        **kwargs,
    )


def test_advisor_deny_short_circuits_command(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_DENY", "git commit")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "git commit -am x && touch should-not-exist"})

    assert output["returncode"] == 1
    assert "span debt: git commit -am x" in output["output"]
    assert not (tmp_path / "should-not-exist").exists()
    # Only the PreToolUse hooks ran; no post hook for a command that never ran.
    hooks = [r["hook"] for r in read_record(stub_hooks["record"])]
    assert hooks == ["snapshot.mjs", "advisor.mjs"]


def test_additional_context_appended_to_output(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "<git-span> touch")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "echo hello"})

    assert output["returncode"] == 0
    assert output["output"] == "hello\n<git-span> touch\n"


def test_failure_hook_fires_for_nonzero_exit(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "failure context")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "false"})

    assert output["returncode"] == 1
    hooks = [r["hook"] for r in read_record(stub_hooks["record"])]
    assert hooks == ["snapshot.mjs", "advisor.mjs", "post-tool-use-failure.mjs"]


def test_finish_session_fires_session_end(stub_hooks, tmp_path):
    env = make_environment(stub_hooks, tmp_path)
    env.execute({"command": "echo hi"})
    env.finish_session()

    records = read_record(stub_hooks["record"])
    assert records[-1]["hook"] == "session-end.mjs"
    # The session id is stable across the environment's lifetime.
    assert records[0]["envelope"]["session_id"] == records[-1]["envelope"]["session_id"]
    assert records[-1]["envelope"]["cwd"] == str(tmp_path)


def test_hooks_disabled(stub_hooks, tmp_path):
    env = make_environment(stub_hooks, tmp_path, hooks_enabled=False)

    output = env.execute({"command": "echo hi"})

    assert output["returncode"] == 0
    assert read_record(stub_hooks["record"]) == []


def test_missing_bundles_are_a_silent_noop(tmp_path):
    env = HookedLocalEnvironment(cwd=str(tmp_path), hooks_dir=str(tmp_path / "nope"))

    output = env.execute({"command": "echo hi"})

    assert output["returncode"] == 0
    assert output["output"] == "hi\n"


def test_sentinel_submission_still_works(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "context after submission")
    env = make_environment(stub_hooks, tmp_path)

    # The sentinel is detected on the first line with exit 0; the hook
    # context appended after must not disturb the submission.
    from minisweagent.exceptions import Submitted

    with pytest.raises(Submitted):
        env.execute({"command": "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && echo submission text"})
