"""HookedDockerEnvironment: hooks run inside the container, fail-open."""

import pytest
from conftest import read_record
from minisweagent.exceptions import Submitted

from minisweagent_gitspan.bridge import RequiredHookError
from minisweagent_gitspan.environment import HookedDockerEnvironment


def make_environment(stub_hooks, fake_docker, tmp_path, **kwargs):
    return HookedDockerEnvironment(
        image="test:latest",
        cwd=str(tmp_path),
        executable=str(fake_docker["path"]),
        node_bin="python3",
        **kwargs,
    )


def docker_execs(fake_docker):
    return [r for r in read_record(fake_docker["record"]) if r["verb"] == "exec"]


def docker_hook_execs(fake_docker):
    return [
        record
        for record in docker_execs(fake_docker)
        if len(record["command"]) == 2 and record["command"][-1].endswith(".mjs")
    ]


def test_probe_runs_once_and_finds_the_hook_bundles(stub_hooks, fake_docker, tmp_path):
    env = make_environment(stub_hooks, fake_docker, tmp_path)

    env.execute({"command": "echo hi"})

    # The in-container hooks dir came from a single probe, and the bundle
    # execs used the probed path — not a host-side default.
    probes = [r for r in docker_execs(fake_docker) if any("default_hooks_dir" in a for a in r["command"])]
    assert len(probes) == 1
    hook_execs = docker_hook_execs(fake_docker)
    assert hook_execs
    assert str(stub_hooks["dir"]) in hook_execs[0]["command"][1]


def test_advisor_deny_short_circuits_command_in_container(stub_hooks, fake_docker, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_DENY", "git commit")
    env = make_environment(stub_hooks, fake_docker, tmp_path)

    output = env.execute({"command": "git commit -am x && touch should-not-exist"})

    assert output["returncode"] == 1
    assert "span debt: git commit -am x" in output["output"]
    assert not (tmp_path / "should-not-exist").exists()
    # The denied command never reached the container.
    assert not any("git commit" in " ".join(r["command"]) for r in docker_execs(fake_docker))
    # Only the PreToolUse hooks ran; no post hook for a command that never ran.
    hooks = [r["hook"] for r in read_record(stub_hooks["record"])]
    assert hooks == ["snapshot.mjs", "advisor.mjs"]


def test_additional_context_appended_to_output(stub_hooks, fake_docker, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "<git-span> touch")
    env = make_environment(stub_hooks, fake_docker, tmp_path)

    output = env.execute({"command": "echo hello"})

    assert output["returncode"] == 0
    assert output["output"] == "hello\n<git-span> touch\n"


def test_failure_hook_fires_for_nonzero_exit(stub_hooks, fake_docker, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "failure context")
    env = make_environment(stub_hooks, fake_docker, tmp_path)

    output = env.execute({"command": "false"})

    assert output["returncode"] == 1
    hooks = [r["hook"] for r in read_record(stub_hooks["record"])]
    assert hooks == ["snapshot.mjs", "advisor.mjs", "post-tool-use-failure.mjs"]


def test_hooks_disabled_skips_probe_and_hooks(stub_hooks, fake_docker, tmp_path):
    env = make_environment(stub_hooks, fake_docker, tmp_path, hooks_enabled=False)

    output = env.execute({"command": "echo hi"})

    assert output["returncode"] == 0
    assert read_record(stub_hooks["record"]) == []
    # Only the container start and the bare command reached the fake docker —
    # no probe, no hook bundles.
    records = read_record(fake_docker["record"])
    assert [r["verb"] for r in records] == ["run", "exec"]
    assert records[1]["command"] == ["bash", "-lc", "echo hi"]


def test_probe_failure_fails_closed_when_hooks_requested(stub_hooks, fake_docker, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_DOCKER_FAIL_PROBE", "1")
    with pytest.raises(RequiredHookError, match="could not locate"):
        make_environment(stub_hooks, fake_docker, tmp_path)


def test_missing_bundles_fail_environment_construction(tmp_path, fake_docker):
    with pytest.raises(RequiredHookError, match="missing hook bundles"):
        HookedDockerEnvironment(
            image="test:latest",
            cwd=str(tmp_path),
            executable=str(fake_docker["path"]),
            hooks_dir=str(tmp_path / "nope"),
            node_bin="python3",
        )


def test_hook_env_pairs_forwarded_into_container(stub_hooks, fake_docker, tmp_path):
    env = make_environment(stub_hooks, fake_docker, tmp_path, env={"CUSTOM_VAR": "custom-value"})

    env.execute({"command": "echo hi"})

    hook_execs = docker_hook_execs(fake_docker)
    assert hook_execs[0]["envs"]["CUSTOM_VAR"] == "custom-value"


def test_required_treatment_records_container_image_id(stub_hooks, fake_docker, tmp_path):
    import subprocess

    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    skill = tmp_path / "SKILL.md"
    skill.write_text("# skill\n")

    env = make_environment(
        stub_hooks,
        fake_docker,
        tmp_path,
        hooks_required=True,
        skill_file=str(skill),
        require_initial_no_spans=True,
        experiment_arm="treatment",
    )

    attestation = env.serialize()["info"]["hooks"]["attestation"]
    assert attestation["valid"] is True
    assert attestation["configured_image"] == "test:latest"
    assert attestation["container_image_id"] == "sha256:fake-image-id"


def test_finish_session_fires_session_end(stub_hooks, fake_docker, tmp_path):
    env = make_environment(stub_hooks, fake_docker, tmp_path)
    env.execute({"command": "echo hi"})
    env.finish_session()
    env.cleanup()  # teardown must NOT fire hooks again

    records = read_record(stub_hooks["record"])
    assert records[-1]["hook"] == "session-end.mjs"
    # The session id is stable across the environment's lifetime.
    assert records[0]["envelope"]["session_id"] == records[-1]["envelope"]["session_id"]
    # SessionEnd ran inside the container, at the container's cwd.
    assert records[-1]["envelope"]["cwd"] == str(tmp_path)
    # Only one session-end: cleanup() stops the container without re-firing hooks.
    assert [r["hook"] for r in records].count("session-end.mjs") == 1


def test_sentinel_submission_still_works(stub_hooks, fake_docker, tmp_path, monkeypatch):
    monkeypatch.setenv("MSWEA_STUB_CONTEXT_POST", "context after submission")
    env = make_environment(stub_hooks, fake_docker, tmp_path)

    with pytest.raises(Submitted):
        env.execute({"command": "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && echo submission text"})
