"""Per-event bridge from the agent loop to the TypeScript git-span hooks.

The hooks are standalone Node bundles (one ``.mjs`` per hook event) compiled
from packages/agent-hooks/src/mswea by ``yarn build:hooks:mswea`` into this
package's ``hooks/bin`` directory. For every bash action the bridge
synthesizes the Claude Code hook wire protocol on stdin: the
``@goodfoot/claude-code-hooks`` runtime reads the envelope verbatim
(snake_case) and writes one JSON object (camelCase) to stdout.

Requested but missing hook bundles fail closed. Runtime failures degrade to
allow-with-warning for ordinary interactive use; ``required=True`` turns them
into infrastructure failures for controlled experiments.
"""

import json
import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("minisweagent.hooks")

# Hook bundles that exist for every host that builds packages/agent-hooks'
# Claude adapters; the order matches the hooks.json registration order.
PRE_TOOL_USE_HOOKS = ("static-plan", "advisor")
ALL_HOOKS = (*PRE_TOOL_USE_HOOKS, "post-tool-use", "post-tool-use-failure", "session-end")
_ANCHOR_LINE = re.compile(r"^(?:[│ ]*[├└]──|[-*])\s+([^\s`]+?)(?:#L\d+(?:-L\d+)?)?(?:\s+—.*)?$")
_SPAN_HEADING = re.compile(r"^##\s+([a-z0-9][a-z0-9/-]*)$")


class RequiredHookError(RuntimeError):
    """The configured experimental treatment could not be delivered."""


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
    """Additional context collected from either PreToolUse hook."""


class HookBridge:
    """Spawns the hook bundles as one-shot subprocesses, one per event.

    Missing bundles always fail closed. Other failures are fail-open unless
    required mode is selected for a controlled experiment.
    """

    def __init__(
        self,
        *,
        session_id: str,
        hooks_dir: str | None = None,
        node_bin: str = "node",
        timeout_ms: int = 10_000,
        env: dict[str, str] | None = None,
        required: bool = False,
        skill_file: str | None = None,
    ):
        self.session_id = session_id
        self.hooks_dir = Path(hooks_dir or os.getenv("MSWEA_HOOKS_DIR") or default_hooks_dir())
        self.node_bin = node_bin
        self.timeout_ms = timeout_ms
        self.env = env if env is not None else os.environ
        self.required = required
        self.skill_file = skill_file
        self.events: list[dict[str, Any]] = []
        self._ordinal = 0

    def _rewrite_context(self, value: str | None) -> str | None:
        """Translate host-specific skill loading into a real mini-agent command."""
        if not value or not self.skill_file:
            return value
        instruction = (
            f"Read `{self.skill_file}` with `sed` before acting on this report; "
            f"read any referenced file relative to `{Path(self.skill_file).parent}`."
        )
        return value.replace("Load the `git-span:git-span` skill for guidance.", instruction).replace(
            "Load the `git-span:git-span` skill in the fork.", instruction
        )

    def _new_event(self, name: str, envelope: dict[str, Any]) -> dict[str, Any]:
        self._ordinal += 1
        event: dict[str, Any] = {
            "ordinal": self._ordinal,
            "hook": name,
            "tool_use_id": envelope.get("tool_use_id"),
            "tool_name": envelope.get("tool_name"),
            "command": (envelope.get("tool_input") or {}).get("command"),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
            "context": None,
            "context_chars": 0,
            "delivered": False,
        }
        self.events.append(event)
        return event

    def _fail(
        self,
        event: dict[str, Any],
        status: str,
        message: str,
        *,
        started: float,
        exit_code: int | None = None,
    ) -> None:
        event.update(status=status, error=message, exit_code=exit_code)
        self._finish_event(event, started)
        logger.warning(message)
        if self.required:
            raise RequiredHookError(message)

    @staticmethod
    def _finish_event(event: dict[str, Any], started: float) -> None:
        event["duration_ms"] = round((time.perf_counter() - started) * 1000, 3)

    def _run_hook(self, name: str, envelope: dict[str, Any]) -> dict[str, Any] | None:
        """Run one hook bundle; return its stdout JSON, or None on any failure."""
        started = time.perf_counter()
        event = self._new_event(name, envelope)
        hook = self.hooks_dir / f"{name}.mjs"
        if not hook.is_file():
            message = f"git-span hook bundle missing, skipping {name}: {hook}"
            event.update(status="missing-bundle", error=message)
            self._finish_event(event, started)
            logger.error(message)
            raise RequiredHookError(message)
        try:
            result = subprocess.run(
                [self.node_bin, str(hook)],
                input=json.dumps(envelope),
                capture_output=True,
                text=True,
                timeout=self.timeout_ms / 1000,
                env=self.env,
            )
        except subprocess.TimeoutExpired as e:
            self._fail(
                event,
                "timeout",
                f"git-span hook {name} timed out after {self.timeout_ms}ms: {e}",
                started=started,
            )
            return None
        except (OSError, subprocess.SubprocessError) as e:
            self._fail(event, "launch-error", f"git-span hook {name} failed open: {e}", started=started)
            return None
        event["exit_code"] = result.returncode
        event["stderr"] = result.stderr
        if result.returncode != 0:
            self._fail(
                event,
                "nonzero-exit",
                f"git-span hook {name} exited {result.returncode}, failing open",
                started=started,
                exit_code=result.returncode,
            )
            return None
        if not result.stdout.strip():
            # No output is a normal no-op: the hook runtime only writes stdout
            # when the hook produced a decision, so an empty reply is a clean
            # "nothing to say" — not an error.
            event["status"] = "clean-noop"
            self._finish_event(event, started)
            return {}
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError:
            self._fail(
                event,
                "malformed-output",
                f"git-span hook {name} wrote unparsable output, failing open",
                started=started,
            )
            return None
        event["status"] = "success"
        self._finish_event(event, started)
        return output

    def _deny_and_context(self, output: dict[str, Any] | None) -> tuple[bool, str | None, str | None]:
        """Extract (denied, reason, context) from a hook's stdout JSON."""
        if not output:
            return False, None, None
        specific = output.get("hookSpecificOutput") or {}
        denied = specific.get("permissionDecision") == "deny"
        reason = self._rewrite_context(specific.get("permissionDecisionReason") or output.get("systemMessage"))
        parts = [part for part in (specific.get("additionalContext"), output.get("systemMessage")) if part]
        context = self._rewrite_context("\n".join(dict.fromkeys(parts)) or None)
        if denied and context is None:
            context = reason
        if self.events:
            self.events[-1]["context"] = context
            self.events[-1]["context_chars"] = len(context or "")
            self.events[-1]["context_tokens"] = None
            self.events[-1]["denied"] = denied
            entities: set[str] = set()
            spans: set[str] = set()
            for line in (context or "").splitlines():
                if match := _ANCHOR_LINE.match(line.strip()):
                    entities.add(match.group(1).split("#L", 1)[0])
                if match := _SPAN_HEADING.match(line.strip()):
                    spans.add(match.group(1))
            self.events[-1]["entities"] = sorted(entities)
            self.events[-1]["spans"] = sorted(spans)
        return denied, reason, context

    def mark_delivered(self, tool_use_id: str, context: str | None = None) -> None:
        """Mark matching generated context as part of the model observation."""
        for event in self.events:
            if event.get("tool_use_id") != tool_use_id or not event.get("context"):
                continue
            if context is None or event["context"] in context:
                event["delivered"] = True

    def _bash_envelope(self, cwd: str, tool_use_id: str, command: str) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "cwd": cwd,
            "tool_name": "Bash",
            "tool_input": {"command": command},
            "tool_use_id": tool_use_id,
        }

    def pre_tool_use(self, command: str, cwd: str, tool_use_id: str) -> PreToolUseResult:
        """Run the PreToolUse hooks (static planning, then the advisor)."""
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
        """Run the SessionEnd hook (per-session hook-state cleanup)."""
        self._run_hook("session-end", {"session_id": self.session_id, "cwd": cwd})


class DockerHookBridge(HookBridge):
    """HookBridge that runs the bundles inside a Docker container.

    Container-based environments (ProgramBench) execute the agent's commands
    inside a per-instance container, so the hooks must run there too: each
    bundle is ``docker exec``'d — with the envelope on stdin and the action's
    cwd — against the same repo the command runs in. ``hooks_dir`` is a path
    *inside* the container (probed from the image at environment
    construction), never a host path, so the host-side existence check of the
    base class does not apply. Container bundle discovery is verified during
    environment construction; later runtime failures follow required mode.
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
        started = time.perf_counter()
        event = self._new_event(name, envelope)
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
        except subprocess.TimeoutExpired as e:
            self._fail(
                event,
                "timeout",
                f"git-span hook {name} timed out after {self.timeout_ms}ms in the container: {e}",
                started=started,
            )
            return None
        except (OSError, subprocess.SubprocessError) as e:
            self._fail(event, "launch-error", f"git-span hook {name} failed open: {e}", started=started)
            return None
        event["exit_code"] = result.returncode
        event["stderr"] = result.stderr
        if result.returncode != 0:
            self._fail(
                event,
                "nonzero-exit",
                f"git-span hook {name} exited {result.returncode} in the container, failing open",
                started=started,
                exit_code=result.returncode,
            )
            return None
        if not result.stdout.strip():
            # No output is a normal no-op: the hook runtime only writes stdout
            # when the hook produced a decision, so an empty reply is a clean
            # "nothing to say" — not an error.
            event["status"] = "clean-noop"
            self._finish_event(event, started)
            return {}
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError:
            self._fail(
                event,
                "malformed-output",
                f"git-span hook {name} wrote unparsable output, failing open",
                started=started,
            )
            return None
        event["status"] = "success"
        self._finish_event(event, started)
        return output
