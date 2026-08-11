"""HookedAgent: a DefaultAgent that ends the hook session on every exit."""

from minisweagent.agents.default import DefaultAgent


class HookedAgent(DefaultAgent):
    """DefaultAgent that fires the SessionEnd hook when the run exits.

    The whole run is wrapped in try/finally so the SessionEnd hook fires on
    every exit path — submission, limits, interruption, or exception. The
    environment must provide ``finish_session`` (as
    :class:`minisweagent_gitspan.environment.HookedLocalEnvironment` does);
    other environments are untouched.

    Wire this class into the agent via the upstream ``mini`` CLI:

        mini --agent-class minisweagent_gitspan.agent.HookedAgent ...
    """

    def run(self, task: str = "", **kwargs) -> dict:
        try:
            return super().run(task, **kwargs)
        finally:
            finish_session = getattr(self.env, "finish_session", None)
            if callable(finish_session):
                finish_session()
