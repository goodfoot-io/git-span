"""``mswea``/``mswea-extra``: the upstream CLIs with the git-span hooks wired in.

``mswea`` installs the two hook classes of the ``mini`` CLI by import path so
containers and test environments run the hooks without spelling out
``--agent-class`` and ``--environment-class`` every time:

    mswea -m deepseek/deepseek-v4-flash -t "your task"

``mswea-extra`` does the same for the benchmark runners behind ``mini-extra``,
where ProgramBench executes the agent's commands inside per-instance
containers — there the environment class must be the container-side one:

    mswea-extra programbench -m deepseek/deepseek-v4-flash

Everything else is passed through unchanged (``-c`` config specs, cost/step
limits, ``--yolo``, …).
"""

import sys

from minisweagent.run.mini import app
from minisweagent.run.utilities.mini_extra import main as mini_extra_main

_ENVIRONMENT_CLASS = "minisweagent_gitspan.environment.HookedDockerEnvironment"


def _install_programbench_session_wrapper() -> None:
    """Ensure ProgramBench serializes hook cleanup and span summaries on every exit."""
    from minisweagent.run.benchmarks import programbench

    base = programbench.ProgramBenchAgent
    if getattr(base, "_git_span_session_wrapper", False):
        return

    class HookedProgramBenchAgent(base):
        _git_span_session_wrapper = True

        def run(self, *args, **kwargs):
            try:
                return super().run(*args, **kwargs)
            finally:
                finish_session = getattr(self.env, "finish_session", None)
                if callable(finish_session):
                    finish_session()

    programbench.ProgramBenchAgent = HookedProgramBenchAgent


def main() -> None:
    """Run upstream ``mini`` with the hook agent and environment classes."""
    sys.argv = [
        sys.argv[0],
        "--agent-class",
        "minisweagent_gitspan.agent.HookedAgent",
        "--environment-class",
        "minisweagent_gitspan.environment.HookedLocalEnvironment",
        *sys.argv[1:],
    ]
    app()


def main_extra() -> None:
    """Run upstream ``mini-extra`` with the hook environment wired in.

    Only ProgramBench needs wiring here: its runner builds the environment
    from ``--environment-class`` (the agent class is hardcoded upstream), and
    that environment must execute inside the per-instance container. An
    explicit ``--environment-class`` from the user wins.
    """
    args = sys.argv[1:]
    if args and args[0] == "programbench" and "--environment-class" not in args:
        args = [args[0], "--environment-class", _ENVIRONMENT_CLASS, *args[1:]]
    if args and args[0] == "programbench":
        _install_programbench_session_wrapper()
    sys.argv = [sys.argv[0], *args]
    mini_extra_main()
