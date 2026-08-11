"""HookedAgent: the SessionEnd hook fires on every exit path of a real run."""

from conftest import read_record

from minisweagent_gitspan.agent import HookedAgent
from minisweagent_gitspan.environment import HookedLocalEnvironment


class StubModel:
    """Minimal Model-protocol stub that scripts the actions to run."""

    config = None

    def __init__(self, *commands):
        self._commands = commands
        self.n_calls = 0

    def query(self, messages, **kwargs):
        self.n_calls += 1
        return {
            "role": "assistant",
            "content": "running",
            "extra": {"actions": [{"command": command} for command in self._commands]},
        }

    def format_message(self, **kwargs):
        return dict(kwargs)

    def format_observation_messages(self, message, outputs, template_vars=None):
        return []

    def get_template_vars(self, **kwargs):
        return {}

    def serialize(self):
        return {}


def run_agent(stub_hooks, tmp_path, *commands):
    env = HookedLocalEnvironment(
        cwd=str(tmp_path),
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
    )
    agent = HookedAgent(
        StubModel(*commands),
        env,
        system_template="",
        instance_template="",
    )
    return agent.run(task="test task")


def test_session_end_fires_on_submission(stub_hooks, tmp_path):
    result = run_agent(
        stub_hooks,
        tmp_path,
        "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && echo submission text",
    )

    assert result["exit_status"] == "Submitted"
    records = read_record(stub_hooks["record"])
    assert records[-1]["hook"] == "session-end.mjs"
    # Same session id across the whole run, and the last pre-hook event is the
    # sentinel submission command.
    pre_ids = {r["envelope"]["session_id"] for r in records}
    assert pre_ids == {records[-1]["envelope"]["session_id"]}


def test_session_end_fires_on_step_limit(stub_hooks, tmp_path):
    env = HookedLocalEnvironment(
        cwd=str(tmp_path),
        hooks_dir=str(stub_hooks["dir"]),
        node_bin="python3",
    )
    agent = HookedAgent(StubModel("echo hi"), env, system_template="", instance_template="", step_limit=1)
    agent.run(task="test task")
    # step_limit=1: the second query raises LimitsExceeded -> run exits.
    assert agent.n_calls == 1

    records = read_record(stub_hooks["record"])
    assert records[-1]["hook"] == "session-end.mjs"
