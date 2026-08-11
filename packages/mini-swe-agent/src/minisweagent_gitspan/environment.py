"""Hooked environments: the git-span hooks bridged around command execution.

Two upstream environment classes get the same treatment: ``LocalEnvironment``
for direct runs, and ``DockerEnvironment`` for container-based runners such as
ProgramBench. The shared plumbing lives in :class:`HookedEnvironmentMixin`;
each hooked environment only supplies its raw command runner.
"""

import os
import subprocess
import uuid
from typing import Any

from minisweagent.environments.docker import DockerEnvironment, DockerEnvironmentConfig
from minisweagent.environments.local import LocalEnvironment, LocalEnvironmentConfig, _run

from minisweagent_gitspan.bridge import DockerHookBridge, HookBridge, logger

_PROBE_TIMEOUT = 30
"""Seconds for probing the container for the package's hooks/bin."""


class HookedConfigMixin:
    """Hook-bridge settings shared by the hooked environment configs."""

    hooks_enabled: bool = True
    """Run the git-span hook bridge around every action."""
    hooks_dir: str | None = None
    """Hook bundle directory; defaults to this package's hooks/bin, overridable with MSWEA_HOOKS_DIR."""
    node_bin: str = "node"
    """Node executable used to spawn the hook bundles."""
    hook_timeout_ms: int = 10_000
    """Per-hook subprocess timeout in milliseconds."""


class HookedLocalEnvironmentConfig(LocalEnvironmentConfig, HookedConfigMixin):
    """LocalEnvironmentConfig plus the hook-bridge settings."""


class HookedDockerEnvironmentConfig(DockerEnvironmentConfig, HookedConfigMixin):
    """DockerEnvironmentConfig plus the hook-bridge settings."""


def _in_container_hooks_dir(executable: str, container_id: str) -> str | None:
    """Locate the package's hooks/bin inside the container.

    The wheel is installed in the image, so the bundles live where
    ``default_hooks_dir()`` resolves from inside the container. None when the
    package (or the probe interpreter) is not there.
    """
    probe = "from minisweagent_gitspan.bridge import default_hooks_dir; print(default_hooks_dir())"
    for python in ("python", "python3"):
        try:
            result = subprocess.run(
                [executable, "exec", container_id, python, "-c", probe],
                capture_output=True,
                text=True,
                timeout=_PROBE_TIMEOUT,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if result.returncode == 0 and (path := result.stdout.strip()):
            return path
    return None


class HookedEnvironmentMixin:
    """Shared bridge plumbing for the hooked environments.

    Subclasses provide ``_execute_raw(command, cwd, timeout)`` — the raw
    command runner (host subprocess or docker exec) — and may override
    ``_make_hooks(session_id)``; everything else (pre/post hooks, deny
    short-circuit, context append, session end) lives here.
    """

    def __init__(self, *, config_class: type, **kwargs):
        super().__init__(config_class=config_class, **kwargs)
        self.session_id = uuid.uuid4().hex
        self.hooks = self._make_hooks(self.session_id)

    def _make_hooks(self, session_id: str) -> HookBridge | None:
        """Build the hook bridge; None when disabled."""
        if not self.config.hooks_enabled:
            return None
        return HookBridge(
            session_id=session_id,
            hooks_dir=self.config.hooks_dir,
            node_bin=self.config.node_bin,
            timeout_ms=self.config.hook_timeout_ms,
            env=os.environ | self.config.env,
        )

    def execute(self, action: dict, cwd: str = "", *, timeout: int | None = None) -> dict[str, Any]:
        """Execute a command, bridged through the git-span hooks.

        Before the command the PreToolUse hooks run (snapshot capture, then
        the advisor). A span-debt hold short-circuits the command: it never
        executes, and the deny reason becomes the action's output with exit
        status 1, so the model sees the hold as a failed command carrying the
        reconcile guidance. After the action the PostToolUse (exit 0) or
        PostToolUseFailure (non-zero) hook runs, and its additional context
        is appended to the action's output. The hooks are fail-open.
        """
        command = action.get("command", "")
        cwd = cwd or self.config.cwd or os.getcwd()
        tool_use_id = uuid.uuid4().hex
        denied = False
        if self.hooks is not None:
            pre = self.hooks.pre_tool_use(command, cwd, tool_use_id)
            if pre.denied:
                # The command never ran: the deny reason is the whole output.
                denied = True
                output = {
                    "output": pre.reason or "Command denied by the git-span advisor.",
                    "returncode": 1,
                    "exception_info": "",
                }
                self._check_finished(output)
                return output
        output = self._execute_raw(command, cwd, timeout)
        if self.hooks is not None and not denied:
            context = self.hooks.post_tool_use(command, cwd, tool_use_id, output, failure=output["returncode"] != 0)
            if context:
                separator = "" if not output["output"] or output["output"].endswith("\n") else "\n"
                output["output"] = f"{output['output']}{separator}{context}\n"
        self._check_finished(output)
        return output

    def finish_session(self) -> None:
        """Fire the SessionEnd hook; called by HookedAgent on every exit path."""
        if self.hooks is not None:
            self.hooks.session_end(self.config.cwd or os.getcwd())


class HookedLocalEnvironment(HookedEnvironmentMixin, LocalEnvironment):
    """A LocalEnvironment that bridges the TypeScript git-span hooks.

    Wire this class into the agent via the upstream ``mini`` CLI:

        mini --environment-class minisweagent_gitspan.environment.HookedLocalEnvironment ...
    """

    def __init__(self, *, config_class: type = HookedLocalEnvironmentConfig, **kwargs):
        """Like LocalEnvironment, plus a HookBridge bound to a per-run session id."""
        super().__init__(config_class=config_class, **kwargs)

    def _execute_raw(self, command: str, cwd: str, timeout: int | None) -> dict[str, Any]:
        try:
            result = _run(command, cwd, os.environ | self.config.env, timeout or self.config.timeout)
            return {"output": result.stdout, "returncode": result.returncode, "exception_info": ""}
        except Exception as e:
            raw_output = getattr(e, "output", None)
            raw_output = (
                raw_output.decode("utf-8", errors="replace") if isinstance(raw_output, bytes) else (raw_output or "")
            )
            return {
                "output": raw_output,
                "returncode": -1,
                "exception_info": f"An error occurred while executing the command: {e}",
                "extra": {"exception_type": type(e).__name__, "exception": str(e)},
            }


class HookedDockerEnvironment(HookedEnvironmentMixin, DockerEnvironment):
    """A DockerEnvironment that bridges the TypeScript git-span hooks.

    ProgramBench-style runners execute the agent's commands inside a
    per-instance container, so the hooks run there too: every bundle is
    ``docker exec``'d with the envelope on stdin against the same repo the
    command runs in. The image must carry the hook bundles (install this
    wheel into the image, or point ``hooks_dir`` at their in-container
    path), plus ``node`` and ``git-span`` on the container's PATH. The
    bundles' path is probed from the image at construction.

    SessionEnd fires via :meth:`finish_session` (HookedAgent). ProgramBench's
    runner instantiates the upstream agent, which never calls it — harmless,
    because the per-session git-span state lives inside the container and is
    discarded with it.

    Wire this class into the upstream runner via its ``--environment-class``
    option:

        mini-extra programbench \
            --environment-class minisweagent_gitspan.environment.HookedDockerEnvironment ...
    """

    def __init__(self, *, config_class: type = HookedDockerEnvironmentConfig, **kwargs):
        """Like DockerEnvironment, plus a DockerHookBridge bound to the container."""
        super().__init__(config_class=config_class, **kwargs)

    def _make_hooks(self, session_id: str) -> DockerHookBridge | None:
        if not self.config.hooks_enabled:
            return None
        hooks_dir = self.config.hooks_dir or _in_container_hooks_dir(self.config.executable, self.container_id)
        if hooks_dir is None:
            logger.warning("could not locate the hook bundles inside the container; hooks disabled for this run")
            return None
        env_pairs = {key: os.environ[key] for key in self.config.forward_env if os.environ.get(key) is not None}
        env_pairs.update(self.config.env)
        return DockerHookBridge(
            session_id=session_id,
            executable=self.config.executable,
            container_id=self.container_id,
            env_pairs=env_pairs,
            hooks_dir=hooks_dir,
            node_bin=self.config.node_bin,
            timeout_ms=self.config.hook_timeout_ms,
        )

    def _execute_raw(self, command: str, cwd: str, timeout: int | None) -> dict[str, Any]:
        cmd = [self.config.executable, "exec", "-w", cwd]
        for key in self.config.forward_env:
            if (value := os.getenv(key)) is not None:
                cmd.extend(["-e", f"{key}={value}"])
        for key, value in self.config.env.items():
            cmd.extend(["-e", f"{key}={value}"])
        cmd.extend([self.container_id, *self.config.interpreter, command])
        try:
            result = subprocess.run(
                cmd,
                text=True,
                timeout=timeout or self.config.timeout,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            return {"output": result.stdout, "returncode": result.returncode, "exception_info": ""}
        except Exception as e:
            raw_output = getattr(e, "output", None)
            raw_output = (
                raw_output.decode("utf-8", errors="replace") if isinstance(raw_output, bytes) else (raw_output or "")
            )
            return {
                "output": raw_output,
                "returncode": -1,
                "exception_info": f"An error occurred while executing the command: {e}",
                "extra": {"exception_type": type(e).__name__, "exception": str(e)},
            }
