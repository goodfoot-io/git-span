"""HookedLocalEnvironment: deny short-circuit, context append, session end."""

import os
import subprocess

import pytest
from conftest import read_record

from minisweagent_gitspan.bridge import RequiredHookError
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
    assert hooks == ["static-plan.mjs", "advisor.mjs"]


def test_additional_context_appended_to_output(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "<git-span> touch")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "echo hello"})

    assert output["returncode"] == 0
    assert output["output"] == "hello\n<git-span> touch\n"


def test_allowed_pre_context_is_appended_to_output(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_PRE", "<git-span> uncovered writes")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "git status"})

    assert output["output"].endswith("<git-span> uncovered writes\n")
    plan_event = env.hooks.events[0]
    assert plan_event["context"] == "<git-span> uncovered writes"
    assert plan_event["delivered"] is True


def test_failure_hook_fires_for_nonzero_exit(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "failure context")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "false"})

    assert output["returncode"] == 1
    hooks = [r["hook"] for r in read_record(stub_hooks["record"])]
    assert hooks == ["static-plan.mjs", "advisor.mjs", "post-tool-use-failure.mjs"]


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


def test_missing_bundles_fail_environment_construction(tmp_path):
    with pytest.raises(RequiredHookError, match="missing hook bundles"):
        HookedLocalEnvironment(cwd=str(tmp_path), hooks_dir=str(tmp_path / "nope"))


def test_required_treatment_attests_and_serializes(stub_hooks, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text("# git-span\n")
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    env = HookedLocalEnvironment(
        cwd=str(repo),
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
        hooks_required=True,
        skill_file=str(skill_file),
        require_initial_no_spans=True,
        experiment_arm="treatment",
    )

    env.execute({"command": "echo hi"})
    serialized = env.serialize()["info"]["hooks"]

    assert serialized["arm"] == "treatment"
    assert serialized["attestation"]["valid"] is True
    assert serialized["attestation"]["initial_span_count"] == 0
    assert serialized["attestation"]["skill_file_sha256"]
    assert set(serialized["attestation"]["bundle_sha256"]) == {
        "static-plan.mjs",
        "advisor.mjs",
        "post-tool-use.mjs",
        "post-tool-use-failure.mjs",
        "session-end.mjs",
    }
    assert [event["ordinal"] for event in serialized["events"]] == [1, 2, 3]


def test_required_treatment_rejects_missing_skill_file(stub_hooks, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)

    with pytest.raises(RequiredHookError, match="skill file"):
        HookedLocalEnvironment(
            cwd=str(repo),
            hooks_dir=str(stub_hooks["dir"]),
            node_bin="python3",
            hooks_required=True,
            skill_file=str(skill_dir / "SKILL.md"),
        )


def test_required_treatment_rejects_version_mismatch(stub_hooks, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    skill = tmp_path / "SKILL.md"
    skill.write_text("# skill\n")
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    with pytest.raises(RequiredHookError, match="node version"):
        HookedLocalEnvironment(
            cwd=str(repo),
            hooks_dir=str(stub_hooks["dir"]),
            node_bin="python3",
            hooks_required=True,
            skill_file=str(skill),
            expected_node_version="definitely-not-python",
        )


def test_long_output_keeps_hook_context_in_tail(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "<git-span> tail context")
    env = make_environment(stub_hooks, tmp_path)

    output = env.execute({"command": "python3 -c 'print(\"x\" * 11000)'"})

    assert len(output["output"]) > 10_000
    assert output["output"].endswith("<git-span> tail context\n")


def test_finish_session_serializes_span_lifecycle_summary(stub_hooks, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "test",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    subprocess.run(["git", "init", "-q", str(repo)], check=True, env=git_env)
    (repo / "a.txt").write_text("a\n")
    (repo / "b.txt").write_text("b\n")
    subprocess.run(["git", "-C", str(repo), "add", "a.txt", "b.txt"], check=True, env=git_env)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "seed"], check=True, env=git_env)
    subprocess.run(["git", "-C", str(repo), "span", "add", "linked-files", "a.txt", "b.txt"], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "span", "why", "linked-files", "The two files preserve the same value."],
        check=True,
    )
    env = make_environment(stub_hooks, repo)

    env.finish_session()
    hooks = env.serialize()["info"]["hooks"]

    assert hooks["session_finished"] is True
    assert hooks["span_summary"]["span_count"] == 1
    assert hooks["span_summary"]["anchor_count"] == 2
    assert hooks["span_summary"]["why_count"] == 1


def test_sentinel_submission_still_works(stub_hooks, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "context after submission")
    env = make_environment(stub_hooks, tmp_path)

    # The sentinel is detected on the first line with exit 0; the hook
    # context appended after must not disturb the submission.
    from minisweagent.exceptions import Submitted

    with pytest.raises(Submitted):
        env.execute({"command": "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && echo submission text"})
