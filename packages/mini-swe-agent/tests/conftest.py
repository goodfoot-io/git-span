"""Shared fixtures for the minisweagent-hooks test suite."""

import json
import os
from pathlib import Path

import pytest

# The upstream package prints a startup banner on import.
os.environ.setdefault("MSWEA_SILENT_STARTUP", "1")

# Stub hook executables: every hook file gets the same script, whose behavior
# is driven by env vars so a test can make any hook deny / emit context /
# crash / print garbage. Hooks are spawned as [node_bin, <hook file>], so the
# bridge can be pointed at Python scripts via node_bin="python3".
STUB_HOOK_TEMPLATE = r"""#!/usr/bin/env python3
import json
import os
import sys

envelope = json.load(sys.stdin)
name = os.path.basename(sys.argv[0])
record = os.environ.get("MSWEA_TEST_RECORD")
if record:
    with open(record, "a") as f:
        f.write(json.dumps({"hook": name, "envelope": envelope}) + "\n")
cmd = envelope.get("tool_input", {}).get("command", "")
out = {}
if name == "advisor.mjs" and os.environ.get("MSWEA_STUB_DENY") and os.environ["MSWEA_STUB_DENY"] in cmd:
    out = {
        "hookSpecificOutput": {
            "permissionDecision": "deny",
            "permissionDecisionReason": "span debt: " + cmd,
        }
    }
elif name == "static-plan.mjs" and os.environ.get("MSWEA_STUB_CONTEXT_PRE"):
    out = {"hookSpecificOutput": {"additionalContext": os.environ["MSWEA_STUB_CONTEXT_PRE"]}}
elif name in ("post-tool-use.mjs", "post-tool-use-failure.mjs") and os.environ.get("MSWEA_STUB_CONTEXT_POST"):
    out = {"hookSpecificOutput": {"additionalContext": os.environ["MSWEA_STUB_CONTEXT_POST"]}}
if os.environ.get("MSWEA_STUB_EMPTY"):
    pass  # the hook returned nothing: no stdout at all
elif raw := os.environ.get("MSWEA_STUB_RAW"):
    sys.stdout.write(raw)
else:
    print(json.dumps(out))
sys.exit(int(os.environ.get("MSWEA_STUB_EXIT", "0")))
"""

HOOK_NAMES = (
    "static-plan.mjs",
    "advisor.mjs",
    "post-tool-use.mjs",
    "post-tool-use-failure.mjs",
    "session-end.mjs",
)


@pytest.fixture
def stub_hooks(tmp_path, monkeypatch):
    """Write the five stub hook executables; record envelopes to a JSONL file."""
    hooks_dir = tmp_path / "hooks"
    hooks_dir.mkdir()
    record = tmp_path / "record.jsonl"
    for name in HOOK_NAMES:
        hook = hooks_dir / name
        hook.write_text(STUB_HOOK_TEMPLATE)
        hook.chmod(0o755)
    monkeypatch.setenv("MSWEA_TEST_RECORD", str(record))
    return {"dir": hooks_dir, "record": record}


def read_record(record: Path) -> list[dict]:
    """Read the recorded hook invocations as [{hook, envelope}, ...]."""
    if not record.is_file():
        return []
    return [json.loads(line) for line in record.read_text().splitlines()]


# A stand-in for the docker executable, hermetic and recordable. Behaves
# enough like `docker` for the container-environment tests:
# - `run` prints a stable container id;
# - `exec` parses -i/-w/-e, then either answers the hooks-dir probe (with
#   FAKE_DOCKER_HOOKS_DIR), or runs the command locally (bash -lc, or the
#   interpreter for the hook bundles) with the -e env, inheriting stdin and
#   streaming stdout;
# - `stop`/`rm`/`cp` just record.
FAKE_DOCKER_TEMPLATE = r"""#!/usr/bin/env python3
import json
import os
import subprocess
import sys

record_path = os.environ.get("FAKE_DOCKER_RECORD")
probe_hooks_dir = os.environ.get("FAKE_DOCKER_HOOKS_DIR", "")


def record(**line):
    if record_path:
        with open(record_path, "a") as f:
            f.write(json.dumps(line) + "\n")


args = sys.argv[1:]
verb = args[0]

if verb == "run":
    record(verb="run", args=args[1:])
    print("fake-container-1")
    sys.exit(0)
if verb == "inspect":
    record(verb="inspect", args=args[1:])
    print("sha256:fake-image-id")
    sys.exit(0)
if verb == "exec":
    rest = args[1:]
    cwd = "/"
    envs = {}
    while rest and rest[0].startswith("-"):
        flag = rest.pop(0)
        if flag == "-i":
            continue
        if flag == "-w":
            cwd = rest.pop(0)
        elif flag == "-e":
            key, value = rest.pop(0).split("=", 1)
            envs[key] = value
    container_id = rest.pop(0)
    record(verb="exec", container_id=container_id, cwd=cwd, envs=envs, command=rest)
    env = {**os.environ, **envs}
    if any("default_hooks_dir" in arg for arg in rest):
        if os.environ.get("FAKE_DOCKER_FAIL_PROBE"):
            sys.exit(1)
        print(probe_hooks_dir)
        sys.exit(0)
    if rest[0] == "bash" and rest[1] == "-lc":
        proc = subprocess.run(["bash", "-lc", rest[2]], cwd=cwd, env=env, text=True)
    else:  # [<interpreter>, <hook bundle>]: the hook processes
        proc = subprocess.run(rest, cwd=cwd, env=env, text=True)
    sys.exit(proc.returncode)
sys.exit(0)  # stop/rm/cp: silent no-ops (teardown fires at GC time; keep records deterministic)
"""


@pytest.fixture
def fake_docker(tmp_path, monkeypatch, stub_hooks):
    """A hermetic stand-in docker executable; records every invocation.

    The hooks-dir probe answers with the stub hooks directory, so
    container-based tests exercise the full probe -> exec -> hook flow.
    """
    path = tmp_path / "fake-docker"
    path.write_text(FAKE_DOCKER_TEMPLATE)
    path.chmod(0o755)
    record = tmp_path / "docker.jsonl"
    monkeypatch.setenv("FAKE_DOCKER_RECORD", str(record))
    monkeypatch.setenv("FAKE_DOCKER_HOOKS_DIR", str(stub_hooks["dir"]))
    return {"path": path, "record": record}
