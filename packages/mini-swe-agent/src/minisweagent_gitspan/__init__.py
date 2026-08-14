"""git-span agent hooks for mini-swe-agent.

A thin extension of the upstream `mini-swe-agent` package (installed from
PyPI): :class:`minisweagent_gitspan.environment.HookedLocalEnvironment`,
:class:`minisweagent_gitspan.environment.HookedDockerEnvironment`, and
:class:`minisweagent_gitspan.agent.HookedAgent` subclass the upstream agent
and environment classes (mini-swe-agent's documented customization
mechanism) and bridge the TypeScript git-span hooks — built from
packages/agent-hooks into this package's hooks/ directory — into the agent
loop over the Claude Code hook wire protocol.

Use from the upstream `mini` CLI:

    mini --agent-class minisweagent_gitspan.agent.HookedAgent \
         --environment-class minisweagent_gitspan.environment.HookedLocalEnvironment \
         -t "your task"

Or from the `mini-extra` benchmark runner (ProgramBench):

    mini-extra programbench \
        --environment-class minisweagent_gitspan.environment.HookedDockerEnvironment
"""

__version__ = "1.1.5"
