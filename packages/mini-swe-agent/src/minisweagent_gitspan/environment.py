"""Hooked environments: the git-span hooks bridged around command execution.

Two upstream environment classes get the same treatment: ``LocalEnvironment``
for direct runs, and ``DockerEnvironment`` for container-based runners such as
ProgramBench. The shared plumbing lives in :class:`HookedEnvironmentMixin`;
each hooked environment only supplies its raw command runner.
"""

import json
import os
import shlex
import subprocess
import sys
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from minisweagent.environments.docker import DockerEnvironment, DockerEnvironmentConfig
from minisweagent.environments.local import LocalEnvironment, LocalEnvironmentConfig, _run
from minisweagent.exceptions import Submitted

from minisweagent_gitspan import __version__
from minisweagent_gitspan.bridge import ALL_HOOKS, DockerHookBridge, HookBridge, RequiredHookError

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
    hooks_required: bool = False
    """Fail the run when the configured treatment cannot be delivered."""
    skill_file: str | None = None
    """Absolute in-environment path to the git-span SKILL.md shown by mini-swe-agent hook output."""
    require_initial_no_spans: bool = False
    """Reject a treatment repository that already contains spans."""
    experiment_arm: str = "unspecified"
    """Arm label serialized into the trajectory."""
    expected_package_version: str | None = None
    expected_node_version: str | None = None
    expected_git_span_version: str | None = None
    expected_bundle_sha256: dict[str, str] = {}
    expected_skill_tree_sha256: str | None = None


_TREE_HASH_SCRIPT = r"""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
if not root.is_dir():
    raise SystemExit(f"not a directory: {root}")
digest = hashlib.sha256()
files = []
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    relative = path.relative_to(root).as_posix()
    digest.update(relative.encode())
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
    files.append(relative)
print(json.dumps({"sha256": digest.hexdigest(), "files": files}))
"""

_FILE_HASH_SCRIPT = r"""
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
print(hashlib.sha256(path.read_bytes()).hexdigest())
"""

_BUNDLE_CHECK_SCRIPT = r"""
import pathlib
import sys

missing = [path for path in sys.argv[1:] if not pathlib.Path(path).is_file()]
if missing:
    raise SystemExit("missing hook bundles: " + ", ".join(missing))
"""

Probe = Callable[[list[str], str | None], subprocess.CompletedProcess[str]]


def _build_attestation(config: Any, hooks: HookBridge, cwd: str, probe: Probe, python_bin: str) -> dict[str, Any]:
    """Validate and identify one required hook treatment environment."""
    attestation: dict[str, Any] = {
        "required": config.hooks_required,
        "enabled": True,
        "arm": config.experiment_arm,
        "package_version": __version__,
        "hooks_dir": str(hooks.hooks_dir),
        "skill_file": config.skill_file,
        "valid": False,
    }
    errors: list[str] = []

    def checked(label: str, args: list[str], *, command_cwd: str | None = None) -> str:
        try:
            result = probe(args, command_cwd)
        except (OSError, subprocess.SubprocessError) as exc:
            errors.append(f"{label}: {exc}")
            return ""
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            errors.append(f"{label}: exited {result.returncode}{f' ({detail})' if detail else ''}")
            return ""
        return result.stdout.strip()

    node_version = checked("node version", [config.node_bin, "--version"])
    git_span_version = checked("git-span version", ["git", "span", "--version"])
    attestation.update(node_version=node_version, git_span_version=git_span_version)

    bundle_hashes: dict[str, str] = {}
    for name in ALL_HOOKS:
        filename = f"{name}.mjs"
        path = str(hooks.hooks_dir / filename)
        digest = checked(f"bundle {filename}", [python_bin, "-c", _FILE_HASH_SCRIPT, path])
        if digest:
            bundle_hashes[filename] = digest
    attestation["bundle_sha256"] = bundle_hashes

    if not config.skill_file:
        errors.append("skill_file: required treatment has no configured skill file")
    else:
        skill_path = Path(config.skill_file)
        if not skill_path.is_absolute():
            errors.append(f"skill_file: path must be absolute ({config.skill_file})")
        skill_digest = checked(
            "skill file",
            [python_bin, "-c", _FILE_HASH_SCRIPT, str(skill_path)],
        )
        if skill_digest:
            attestation["skill_file_sha256"] = skill_digest
        skill_tree = checked(
            "skill tree",
            [python_bin, "-c", _TREE_HASH_SCRIPT, str(skill_path.parent)],
        )
        if skill_tree:
            try:
                attestation["skill_tree"] = json.loads(skill_tree)
            except json.JSONDecodeError as exc:
                errors.append(f"skill tree: invalid probe output ({exc})")

    repo_root = checked("repository root", ["git", "-C", cwd, "rev-parse", "--show-toplevel"])
    span_rows = checked("initial span list", ["git", "-C", cwd, "span", "list", "--porcelain"])
    span_names = sorted({line.split("\t", 1)[0] for line in span_rows.splitlines() if "\t" in line})
    attestation.update(repository_root=repo_root, initial_span_count=len(span_names), initial_span_names=span_names)
    if config.require_initial_no_spans and span_names:
        errors.append(f"initial span list: expected zero spans, found {len(span_names)}")

    expected_scalars = {
        "package version": (config.expected_package_version, __version__),
        "node version": (config.expected_node_version, node_version),
        "git-span version": (config.expected_git_span_version, git_span_version),
        "skill tree sha256": (
            config.expected_skill_tree_sha256,
            (attestation.get("skill_tree") or {}).get("sha256"),
        ),
    }
    for label, (expected, actual) in expected_scalars.items():
        if expected is not None and expected != actual:
            errors.append(f"{label}: expected {expected!r}, got {actual!r}")
    for filename, expected in config.expected_bundle_sha256.items():
        actual = bundle_hashes.get(filename)
        if actual != expected:
            errors.append(f"bundle {filename}: expected {expected!r}, got {actual!r}")

    attestation["errors"] = errors
    attestation["valid"] = not errors
    if errors:
        raise RequiredHookError("hook treatment preflight failed: " + "; ".join(errors))
    return attestation


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
    short-circuit, context append, session end, treatment telemetry) lives here.
    """

    def __init__(self, *, config_class: type, **kwargs):
        super().__init__(config_class=config_class, **kwargs)
        if self.config.hooks_required and not self.config.hooks_enabled:
            raise ValueError("hooks_required=true requires hooks_enabled=true")
        self.session_id = uuid.uuid4().hex
        self._session_finished = False
        self.span_summary: dict[str, Any] | None = None
        self.hook_attestation: dict[str, Any] = {
            "enabled": bool(self.config.hooks_enabled),
            "required": bool(self.config.hooks_required),
            "arm": self.config.experiment_arm,
            "valid": True if not self.config.hooks_enabled else None,
        }
        self.hooks = self._make_hooks(self.session_id)

    def _make_hooks(self, session_id: str) -> HookBridge | None:
        """Build the hook bridge; None when disabled."""
        if not self.config.hooks_enabled:
            return None
        hooks = HookBridge(
            session_id=session_id,
            hooks_dir=self.config.hooks_dir,
            node_bin=self.config.node_bin,
            timeout_ms=self.config.hook_timeout_ms,
            env=os.environ | self.config.env,
            required=self.config.hooks_required,
            skill_file=self.config.skill_file,
        )
        missing = [
            str(hooks.hooks_dir / f"{name}.mjs")
            for name in ALL_HOOKS
            if not (hooks.hooks_dir / f"{name}.mjs").is_file()
        ]
        if missing:
            raise RequiredHookError("missing hook bundles: " + ", ".join(missing))
        if self.config.hooks_required:
            self.hook_attestation = _build_attestation(
                self.config,
                hooks,
                self.config.cwd or os.getcwd(),
                self._local_probe,
                sys.executable,
            )
        return hooks

    def _local_probe(self, args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT,
            env=os.environ | self.config.env,
        )

    def execute(self, action: dict, cwd: str = "", *, timeout: int | None = None) -> dict[str, Any]:
        """Execute a command, bridged through the git-span hooks.

        Before the command the PreToolUse hooks run (static planning, then
        the advisor). A span-debt hold short-circuits the command: it never
        executes, and the deny reason becomes the action's output with exit
        status 1, so the model sees the hold as a failed command carrying the
        reconcile guidance. After the action the PostToolUse (exit 0) or
        PostToolUseFailure (non-zero) hook runs, and its additional context
        is appended to the action's output. Missing requested bundles fail
        closed; runtime failures fail open unless required mode is enabled.
        """
        command = action.get("command", "")
        cwd = cwd or self.config.cwd or os.getcwd()
        tool_use_id = uuid.uuid4().hex
        denied = False
        pre_context = None
        hooks_active = self.hooks is not None and not self._session_finished
        if hooks_active:
            pre = self.hooks.pre_tool_use(command, cwd, tool_use_id)
            if pre.denied:
                # The command never ran: the deny reason is the whole output.
                denied = True
                output = {
                    "output": pre.reason or "Command denied by the git-span advisor.",
                    "returncode": 1,
                    "exception_info": "",
                }
                self.hooks.mark_delivered(tool_use_id, pre.reason)
                try:
                    self._check_finished(output)
                except Submitted:
                    self.finish_session()
                    raise
                return output
            pre_context = pre.context
        output = self._execute_raw(command, cwd, timeout)
        contexts = [pre_context] if pre_context else []
        if hooks_active and not denied:
            post_context = self.hooks.post_tool_use(
                command, cwd, tool_use_id, output, failure=output["returncode"] != 0
            )
            if post_context:
                contexts.append(post_context)
            if contexts:
                context = "\n".join(contexts)
                separator = "" if not output["output"] or output["output"].endswith("\n") else "\n"
                output["output"] = f"{output['output']}{separator}{context}\n"
                self.hooks.mark_delivered(tool_use_id, context)
        try:
            self._check_finished(output)
        except Submitted:
            self.finish_session()
            raise
        return output

    def finish_session(self) -> None:
        """Fire the SessionEnd hook; called by HookedAgent on every exit path."""
        if self._session_finished:
            return
        self.span_summary = self._collect_span_summary()
        if self.hooks is not None:
            self.hooks.session_end(self.config.cwd or os.getcwd())
        self._session_finished = True

    def _collect_span_summary(self) -> dict[str, Any]:
        """Collect non-injected end-state evidence for trajectory analysis."""
        cwd = self.config.cwd or os.getcwd()
        listed = self._execute_raw("git span list --porcelain", cwd, self.config.timeout)
        rows = listed.get("output", "") if listed.get("returncode") == 0 else ""
        anchors = [line.split("\t") for line in rows.splitlines() if "\t" in line]
        names = sorted({row[0] for row in anchors if row})
        why_count = 0
        why_errors: list[str] = []
        for name in names:
            # `git span why <name>` is interactive read mode and fails outright on a
            # non-terminal stdin, so the session summary reads the why out of the span's
            # `list` block instead: `## <name>` header, `- <path>` anchor bullets, then
            # the why prose. A span carries a why iff its block has a non-bullet body line.
            result = self._execute_raw(f"git span list {shlex.quote(name)}", cwd, self.config.timeout)
            if result.get("returncode") != 0:
                why_errors.append(name)
                continue
            body = [
                line.strip()
                for line in result.get("output", "").splitlines()
                if line.strip() and not line.startswith(("#", "-"))
            ]
            if body:
                why_count += 1
        drift = self._execute_raw("git span drift --format json --no-exit-code", cwd, self.config.timeout)
        drift_output = drift.get("output", "").strip()
        try:
            drift_data: Any = json.loads(drift_output) if drift_output else []
        except json.JSONDecodeError:
            drift_data = {"unparsed": drift_output}
        return {
            "span_count": len(names),
            "anchor_count": len(anchors),
            "why_count": why_count,
            "why_errors": why_errors,
            "list_returncode": listed.get("returncode"),
            "drift_returncode": drift.get("returncode"),
            "drift": drift_data,
        }

    def serialize(self) -> dict[str, Any]:
        data = super().serialize()
        data.setdefault("info", {})["hooks"] = {
            "session_id": self.session_id,
            "enabled": bool(self.config.hooks_enabled),
            "required": bool(self.config.hooks_required),
            "arm": self.config.experiment_arm,
            "attestation": self.hook_attestation,
            "events": list(self.hooks.events) if self.hooks is not None else [],
            "span_summary": self.span_summary,
            "session_finished": self._session_finished,
        }
        return data


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

    SessionEnd fires via :meth:`finish_session`. ``mswea-extra programbench``
    wraps the upstream benchmark agent so cleanup and lifecycle summaries run
    on every exit path before its final trajectory save.

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
            message = "could not locate the requested hook bundles inside the container"
            raise RequiredHookError(message)
        env_pairs = {key: os.environ[key] for key in self.config.forward_env if os.environ.get(key) is not None}
        env_pairs.update(self.config.env)
        hooks = DockerHookBridge(
            session_id=session_id,
            executable=self.config.executable,
            container_id=self.container_id,
            env_pairs=env_pairs,
            hooks_dir=hooks_dir,
            node_bin=self.config.node_bin,
            timeout_ms=self.config.hook_timeout_ms,
            required=self.config.hooks_required,
            skill_file=self.config.skill_file,
        )
        bundle_paths = [str(hooks.hooks_dir / f"{name}.mjs") for name in ALL_HOOKS]
        try:
            checked = self._container_probe(["python3", "-c", _BUNDLE_CHECK_SCRIPT, *bundle_paths])
        except (OSError, subprocess.SubprocessError) as exc:
            raise RequiredHookError(f"hook bundle check failed: {exc}") from exc
        if checked.returncode != 0:
            detail = (checked.stderr or checked.stdout).strip()
            raise RequiredHookError(detail or "could not verify hook bundles inside the container")
        if self.config.hooks_required:
            self.hook_attestation = _build_attestation(
                self.config,
                hooks,
                self.config.cwd,
                self._container_probe,
                "python3",
            )
            try:
                inspected = subprocess.run(
                    [self.config.executable, "inspect", "--format", "{{.Image}}", self.container_id],
                    capture_output=True,
                    text=True,
                    timeout=_PROBE_TIMEOUT,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise RequiredHookError(f"container image inspection failed: {exc}") from exc
            image_id = inspected.stdout.strip()
            if inspected.returncode != 0 or not image_id:
                detail = (inspected.stderr or inspected.stdout).strip()
                raise RequiredHookError(detail or "could not resolve the treatment container image ID")
            self.hook_attestation.update(configured_image=self.config.image, container_image_id=image_id)
        return hooks

    def _container_probe(self, args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess[str]:
        cmd = [self.config.executable, "exec"]
        if cwd:
            cmd.extend(["-w", cwd])
        for key, value in self.config.env.items():
            cmd.extend(["-e", f"{key}={value}"])
        cmd.extend([self.container_id, *args])
        return subprocess.run(cmd, capture_output=True, text=True, timeout=_PROBE_TIMEOUT)

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
