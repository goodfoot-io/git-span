"""Per-event bridge from the agent loop to the TypeScript git-span hooks.

The hooks are standalone Node bundles (one ``.mjs`` per hook event) compiled
from packages/agent-hooks/src/mswea by ``yarn build:hooks:mswea`` into this
package's ``hooks/bin`` directory. For every bash action the bridge
synthesizes the Claude Code hook wire protocol on stdin: the
``@goodfoot/claude-code-hooks`` runtime reads the envelope verbatim
(snake_case) and writes one JSON object (camelCase) to stdout.

The bridge is fail-open: any hook error (missing bundle, non-zero exit,
timeout, unparsable output) degrades to allow-with-warning — it never blocks
the agent.
"""

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("minisweagent.hooks")

# Hook bundles that exist for every host that builds packages/agent-hooks'
# Claude adapters; the order matches the hooks.json registration order.
PRE_TOOL_USE_HOOKS = ("snapshot", "advisor")


def default_hooks_dir() -> Path:
    """The package's ``hooks/bin`` directory (where build:hooks:mswea emits).

    Bundles ship inside the package (package-data), so this path is the same
    in the source checkout and in an installed wheel.
    """
    return Path(__file__).resolve().parent / "hooks" / "bin"


@dataclass(frozen=True)
class PreToolUseResult:
    """Outcome of the PreToolUse hooks for one action."""

    denied: bool = False
    """True when the advisor held the action (span debt before commit/push)."""
    reason: str | None = None
    """The deny reason to show the model, when denied."""
    context: str | None = None
    """Additional context collected from either hook (snapshot/advisor notes)."""


class HookBridge:
    """Spawns the hook bundles as one-shot subprocesses, one per event.

    Every failure is fail-open: the hook is skipped with a warning and the
    agent proceeds as if no hook had run.
    """

    def __init__(
        self,
        *,
        session_id: str,
        hooks_dir: str | None = None,
        node_bin: str = "node",
        timeout_ms: int = 10_000,
        env: dict[str, str] | None = None,
    ):
        self.session_id = session_id
        self.hooks_dir = Path(hooks_dir or os.getenv("MSWEA_HOOKS_DIR") or default_hooks_dir())
        self.node_bin = node_bin
        self.timeout_ms = timeout_ms
        self.env = env if env is not None else os.environ
        self._warned: set[str] = set()

    def _run_hook(self, name: str, envelope: dict[str, Any]) -> dict[str, Any] | None:
        """Run one hook bundle; return its stdout JSON, or None on any failure."""
        hook = self.hooks_dir / f"{name}.mjs"
        if not hook.is_file():
            if name not in self._warned:
                logger.warning("git-span hook bundle missing, skipping %s: %s", name, hook)
                self._warned.add(name)
            return None
        try:
            result = subprocess.run(
                [self.node_bin, str(hook)],
                input=json.dumps(envelope),
                capture_output=True,
                text=True,
                timeout=self.timeout_ms / 1000,
                env=self.env,
            )
        except (OSError, subprocess.SubprocessError) as e:
            logger.warning("git-span hook %s failed open: %s", name, e)
            return None
        if result.returncode != 0:
            logger.warning("git-span hook %s exited %d, failing open", name, result.returncode)
            return None
        if not result.stdout.strip():
            # No output is a normal no-op: the hook runtime only writes stdout
            # when the hook produced a decision, so an empty reply is a clean
            # "nothing to say" — not an error.
            return {}
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            logger.warning("git-span hook %s wrote unparsable output, failing open", name)
            return None

    @staticmethod
    def _deny_and_context(output: dict[str, Any] | None) -> tuple[bool, str | None, str | None]:
        """Extract (denied, reason, context) from a hook's stdout JSON."""
        if not output:
            return False, None, None
        specific = output.get("hookSpecificOutput") or {}
        denied = specific.get("permissionDecision") == "deny"
        reason = specific.get("permissionDecisionReason") or output.get("systemMessage")
        parts = [part for part in (specific.get("additionalContext"), output.get("systemMessage")) if part]
        return denied, reason, "\n".join(dict.fromkeys(parts)) or None

    def _bash_envelope(self, cwd: str, tool_use_id: str, command: str) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "cwd": cwd,
            "tool_name": "Bash",
            "tool_input": {"command": command},
            "tool_use_id": tool_use_id,
        }

    def pre_tool_use(self, command: str, cwd: str, tool_use_id: str) -> PreToolUseResult:
        """Run the PreToolUse hooks (snapshot capture, then the advisor)."""
        envelope = self._bash_envelope(cwd, tool_use_id, command)
        denied = False
        reason = None
        context: list[str] = []
        for hook_name in PRE_TOOL_USE_HOOKS:
            output = self._run_hook(hook_name, envelope)
            hook_denied, hook_reason, hook_context = self._deny_and_context(output)
            if hook_denied:
                denied = True
                reason = hook_reason
            if hook_context:
                context.append(hook_context)
        return PreToolUseResult(denied=denied, reason=reason, context="\n".join(context) or None)

    def post_tool_use(
        self, command: str, cwd: str, tool_use_id: str, output: dict[str, Any], *, failure: bool
    ) -> str | None:
        """Run the PostToolUse (success) or PostToolUseFailure hook; return context to append."""
        envelope = self._bash_envelope(cwd, tool_use_id, command)
        envelope["tool_response"] = {
            "stdout": output.get("output", ""),
            "stderr": "",
            "exitStatus": output.get("returncode", 0),
            "interrupted": False,
            "timedOutAfterMs": None,
            "rawOutputPath": None,
        }
        hook_name = "post-tool-use-failure" if failure else "post-tool-use"
        result = self._run_hook(hook_name, envelope)
        _, _, context = self._deny_and_context(result)
        return context

    def session_end(self, cwd: str) -> None:
        """Run the SessionEnd hook (per-session snapshot-record cleanup)."""
        self._run_hook("session-end", {"session_id": self.session_id, "cwd": cwd})


class DockerHookBridge(HookBridge):
    """HookBridge that runs the bundles inside a Docker container.

    Container-based environments (ProgramBench) execute the agent's commands
    inside a per-instance container, so the hooks must run there too: each
    bundle is ``docker exec``'d — with the envelope on stdin and the action's
    cwd — against the same repo the command runs in. ``hooks_dir`` is a path
    *inside* the container (probed from the image at environment
    construction), never a host path, so the host-side existence check of the
    base class does not apply; any failure still degrades to fail-open.
    """

    def __init__(
        self,
        *,
        executable: str,
        container_id: str,
        env_pairs: dict[str, str] | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.executable = executable
        self.container_id = container_id
        self.env_pairs = env_pairs or {}

    def _run_hook(self, name: str, envelope: dict[str, Any]) -> dict[str, Any] | None:
        """Run one hook bundle inside the container; None on any failure."""
        cmd = [self.executable, "exec", "-i", "-w", envelope.get("cwd", "/")]
        for key, value in self.env_pairs.items():
            cmd.extend(["-e", f"{key}={value}"])
        cmd.extend([self.container_id, self.node_bin, str(self.hooks_dir / f"{name}.mjs")])
        try:
            result = subprocess.run(
                cmd,
                input=json.dumps(envelope),
                capture_output=True,
                text=True,
                timeout=self.timeout_ms / 1000,
            )
        except (OSError, subprocess.SubprocessError) as e:
            logger.warning("git-span hook %s failed open: %s", name, e)
            return None
        if result.returncode != 0:
            logger.warning("git-span hook %s exited %d in the container, failing open", name, result.returncode)
            return None
        if not result.stdout.strip():
            # No output is a normal no-op: the hook runtime only writes stdout
            # when the hook produced a decision, so an empty reply is a clean
            # "nothing to say" — not an error.
            return {}
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            logger.warning("git-span hook %s wrote unparsable output, failing open", name)
            return None
