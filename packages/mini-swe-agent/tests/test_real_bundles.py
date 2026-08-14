"""Mandatory installed-wheel smoke against real hook bundles and git-span."""

import json
import os
import re
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pytest

from minisweagent_gitspan.bridge import HookBridge

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
AGENT_HOOKS_ROOT = WORKSPACE_ROOT / "packages" / "agent-hooks"
MINI_SWE_ROOT = WORKSPACE_ROOT / "packages" / "mini-swe-agent"
GIT_SPAN_ROOT = WORKSPACE_ROOT / "packages" / "git-span"
EXPECTED_BUNDLES = {
    "advisor.mjs",
    "post-tool-use-failure.mjs",
    "post-tool-use.mjs",
    "session-end.mjs",
    "static-plan.mjs",
}
LEGACY_RUNTIME_MARKERS = (
    "snapshot-core",
    "snapshot-harness",
    "snapshot-store",
    "snapshot-recordless-note",
    "snapshot-index",
    "activity-log",
    "GIT_SPAN_SNAPSHOT_",
    "git-span.snapshot-",
    "ObservedWriteScope",
)
TEXT = "alpha\nneedle one\nbeta\nneedle two\nomega\n"


@dataclass(frozen=True)
class InstalledWheel:
    hooks_dir: Path
    workspace_git_span: Path
    env: dict[str, str]
    wheel: Path


def checked(args: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True, text=True)


@pytest.fixture(scope="module")
def installed_wheel(tmp_path_factory: pytest.TempPathFactory) -> InstalledWheel:
    temp = tmp_path_factory.mktemp("installed-wheel")
    target_root = Path(os.environ.get("GIT_SPAN_CARGO_TARGET_ROOT", "/var/cache/git-span/cargo-target"))
    target_dir = target_root / "git-span" / "build"
    checked(
        [
            "bash",
            "scripts/with-target-lock.sh",
            "shared",
            "env",
            f"CARGO_TARGET_DIR={target_dir}",
            "cargo",
            "build",
            "--quiet",
            "--locked",
            "--bin",
            "git-span",
        ],
        cwd=GIT_SPAN_ROOT,
    )
    workspace_git_span = target_dir / "debug" / ("git-span.exe" if os.name == "nt" else "git-span")
    assert workspace_git_span.is_file()

    checked(["yarn", "build:hooks"], cwd=MINI_SWE_ROOT)
    dist = temp / "dist"
    checked(["uv", "build", "--wheel", "--out-dir", str(dist)], cwd=MINI_SWE_ROOT)
    wheel = next(dist.glob("*.whl"))
    venv = temp / "venv"
    checked(["uv", "venv", "--python", sys.executable, str(venv)], cwd=MINI_SWE_ROOT)
    installed_python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    checked(["uv", "pip", "install", "--python", str(installed_python), "--no-deps", str(wheel)], cwd=MINI_SWE_ROOT)

    probe = checked(
        [
            str(installed_python),
            "-c",
            (
                "import json; "
                "from minisweagent_gitspan.bridge import ALL_HOOKS, default_hooks_dir; "
                "print(json.dumps({'hooks_dir': str(default_hooks_dir()), 'hooks': list(ALL_HOOKS)}))"
            ),
        ],
        cwd=MINI_SWE_ROOT,
    )
    installed = json.loads(probe.stdout)
    hooks_dir = Path(installed["hooks_dir"])
    assert set(installed["hooks"]) == {name.removesuffix(".mjs") for name in EXPECTED_BUNDLES}
    assert {path.name for path in hooks_dir.glob("*.mjs")} == EXPECTED_BUNDLES

    with zipfile.ZipFile(wheel) as archive:
        bundled = {Path(name).name for name in archive.namelist() if "/hooks/bin/" in name and name.endswith(".mjs")}
    assert bundled == EXPECTED_BUNDLES
    assert "snapshot.mjs" not in bundled
    assert "activity-log.mjs" not in bundled
    assert "subagent-stop.mjs" not in bundled

    for path in [*hooks_dir.glob("*.mjs"), hooks_dir.parent / "hooks.json"]:
        content = path.read_text()
        for marker in LEGACY_RUNTIME_MARKERS:
            assert marker not in content, f"{path.name} contains removed runtime marker {marker}"

    home = temp / "home"
    home.mkdir()
    env = {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{workspace_git_span.parent}{os.pathsep}{os.environ.get('PATH', '')}",
        "GIT_AUTHOR_NAME": "installed smoke",
        "GIT_AUTHOR_EMAIL": "installed-smoke@example.com",
        "GIT_COMMITTER_NAME": "installed smoke",
        "GIT_COMMITTER_EMAIL": "installed-smoke@example.com",
    }
    resolved = checked(["bash", "-c", "command -v git-span"], cwd=MINI_SWE_ROOT, env=env).stdout.strip()
    assert Path(resolved).resolve() == workspace_git_span.resolve()
    return InstalledWheel(hooks_dir=hooks_dir, workspace_git_span=workspace_git_span, env=env, wheel=wheel)


def git(repo: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return checked(["git", "-C", str(repo), *args], cwd=repo, env=env)


def add_span(repo: Path, env: dict[str, str], name: str, path: str, start: int, end: int) -> None:
    git(repo, env, "span", "add", name, f"{path}#L{start}-L{end}")
    git(repo, env, "span", "why", name, f"installed mini-swe smoke {name}")


def seed_repo(repo: Path, env: dict[str, str]) -> None:
    repo.mkdir()
    git(repo, env, "init", "-q")
    git(repo, env, "config", "user.name", "installed smoke")
    git(repo, env, "config", "user.email", "installed-smoke@example.com")
    cases = repo / "cases"
    cases.mkdir()
    for name in [
        "loop-a",
        "loop-b",
        "sed",
        "perl",
        "python",
        "node",
        "tracked",
        "dynamic",
        "generator",
        "later-write",
        "later-read",
        "short-circuit",
        "interrupted",
        "failure",
    ]:
        (cases / f"{name}.txt").write_text(TEXT)
    generator = repo / "generator.sh"
    generator.write_text("#!/usr/bin/env bash\nprintf 'generated\\n' > cases/generator.txt\n")
    generator.chmod(0o755)
    git(repo, env, "add", "-A")
    git(repo, env, "commit", "-qm", "seed installed mini-swe smoke")

    spans = [
        ("smoke/loop-a", "cases/loop-a.txt", 2, 2),
        ("smoke/loop-b", "cases/loop-b.txt", 2, 2),
        ("smoke/sed-first", "cases/sed.txt", 2, 2),
        ("smoke/sed-second", "cases/sed.txt", 4, 4),
        ("smoke/sed-decoy", "cases/sed.txt", 5, 5),
        ("smoke/perl", "cases/perl.txt", 2, 4),
        ("smoke/perl-decoy", "cases/perl.txt", 5, 5),
        ("smoke/python", "cases/python.txt", 3, 3),
        ("smoke/python-decoy", "cases/python.txt", 5, 5),
        ("smoke/node", "cases/node.txt", 3, 3),
        ("smoke/node-decoy", "cases/node.txt", 5, 5),
        ("smoke/tracked", "cases/tracked.txt", 1, 5),
        ("smoke/dynamic", "cases/dynamic.txt", 1, 5),
        ("smoke/generator", "cases/generator.txt", 1, 5),
        ("smoke/later-write", "cases/later-write.txt", 1, 5),
        ("smoke/later-read", "cases/later-read.txt", 4, 4),
        ("smoke/short-circuit", "cases/short-circuit.txt", 3, 3),
        ("smoke/interrupted", "cases/interrupted.txt", 3, 3),
        ("smoke/failure", "cases/failure.txt", 3, 3),
    ]
    for span in spans:
        add_span(repo, env, *span)
    git(repo, env, "add", ".span")
    git(repo, env, "commit", "-qm", "anchor installed mini-swe smoke spans")
    git(repo, env, "branch", "topic")


def run_command(
    bridge: HookBridge,
    repo: Path,
    env: dict[str, str],
    tool_id: str,
    command: str,
    *,
    interrupted: bool = False,
) -> tuple[subprocess.CompletedProcess[str], str]:
    pre = bridge.pre_tool_use(command, str(repo), tool_id)
    assert not pre.denied
    result = subprocess.run(["bash", "-c", command], cwd=repo, env=env, capture_output=True, text=True)
    if interrupted:
        envelope = bridge._bash_envelope(str(repo), tool_id, command)
        envelope["tool_response"] = {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exitStatus": result.returncode,
            "interrupted": True,
            "timedOutAfterMs": None,
            "rawOutputPath": None,
        }
        output = bridge._run_hook("post-tool-use", envelope)
        _, _, context = bridge._deny_and_context(output)
    else:
        context = bridge.post_tool_use(
            command,
            str(repo),
            tool_id,
            {"output": result.stdout, "returncode": result.returncode},
            failure=result.returncode != 0,
        )
    return result, context or ""


def assert_context(context: str, expected: tuple[str, ...], excluded: tuple[str, ...] = ()) -> None:
    for name in expected:
        assert name in context
    for name in excluded:
        assert name not in context
    if not expected:
        assert context == ""


def assert_no_legacy_runtime_artifacts(repo: Path, home: Path) -> None:
    paths = [path for root in (repo, home) for path in root.rglob("*")]
    context_socket = re.compile(r"/\.git/span/context/[a-f0-9]+/service\.sock$")
    forbidden = re.compile(
        r"(?:snapshots|snapshot-recordless-note|activity-log|\.objects(?:/|$)|\.index$|tombstone|watcher|\.sock$|socket)",
        re.IGNORECASE,
    )
    assert [path for path in paths if forbidden.search(path.as_posix()) and not context_socket.search(path.as_posix())] == []
    sockets = [path for path in paths if path.is_socket()]
    assert sockets
    assert all(context_socket.search(path.as_posix()) for path in sockets)


def test_installed_wheel_runs_static_matrix_without_legacy_state(installed_wheel: InstalledWheel, tmp_path: Path):
    repo = tmp_path / "repo"
    seed_repo(repo, installed_wheel.env)
    bridge = HookBridge(
        session_id="installed-mini-swe",
        hooks_dir=str(installed_wheel.hooks_dir),
        env=installed_wheel.env,
        required=True,
    )
    commands = [
        (
            'for f in cases/loop-a.txt cases/loop-b.txt; do sed -i "2s/needle/pin/" "$f"; done',
            ("smoke/loop-a", "smoke/loop-b"),
            (),
        ),
        ("sed -i 's/needle/pin/' cases/sed.txt", ("smoke/sed-first", "smoke/sed-second"), ("smoke/sed-decoy",)),
        ("perl -pi -e 's/needle/pin/' cases/perl.txt", ("smoke/perl",), ("smoke/perl-decoy",)),
        (
            "python3 - <<'PY'\nfrom pathlib import Path\np=Path('cases/python.txt')\ns=p.read_text()\np.write_text(s.replace('beta','BETA'))\nPY",
            ("smoke/python",),
            ("smoke/python-decoy",),
        ),
        (
            "node -e \"const fs=require('node:fs');const p='cases/node.txt';const s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,s.replace('beta','BETA'))\"",
            ("smoke/node",),
            ("smoke/node-decoy",),
        ),
        ("printf x | tee cases/tracked.txt cases/untracked.txt >/dev/null", ("smoke/tracked",), ()),
        ("printf '%s\\n' alpha changed beta > cases/later-write.txt", ("smoke/later-write",), ()),
        (f"rg -n 'needle two' {repo}/cases/later-read.txt", ("smoke/later-read",), ()),
        ("false && sed -i '3s/beta/BETA/' cases/short-circuit.txt", (), ()),
        ("sed -i 's/beta/BETA/' cases/failure.txt; false", ("smoke/failure",), ()),
        ("node -e \"require('node:fs').writeFileSync(process.argv[1],'x')\" cases/dynamic.txt", (), ()),
        ("git merge topic", (), ()),
        ("./generator.sh", (), ()),
    ]
    for index, (command, expected, excluded) in enumerate(commands):
        _, context = run_command(bridge, repo, installed_wheel.env, f"tool-{index}", command)
        assert_context(context, expected, excluded)

    _, interrupted = run_command(
        bridge,
        repo,
        installed_wheel.env,
        "tool-interrupted",
        "sed -i '3s/beta/BETA/' cases/interrupted.txt",
        interrupted=True,
    )
    assert_context(interrupted, ())
    assert_no_legacy_runtime_artifacts(repo, Path(installed_wheel.env["HOME"]))


def test_installed_advisor_holds_drifted_commit(installed_wheel: InstalledWheel, tmp_path: Path):
    repo = tmp_path / "advisor-repo"
    repo.mkdir()
    git(repo, installed_wheel.env, "init", "-q")
    (repo / "seed.txt").write_text("seed\n")
    git(repo, installed_wheel.env, "add", "seed.txt")
    git(repo, installed_wheel.env, "commit", "-qm", "init")
    add_span(repo, installed_wheel.env, "test-span", "seed.txt", 1, 1)
    git(repo, installed_wheel.env, "add", ".span")
    git(repo, installed_wheel.env, "commit", "-qm", "span")
    (repo / "seed.txt").write_text("changed\n")

    bridge = HookBridge(
        session_id="installed-mini-swe-advisor",
        hooks_dir=str(installed_wheel.hooks_dir),
        env=installed_wheel.env,
        required=True,
    )
    denied = bridge.pre_tool_use("git commit -am x", str(repo), "advisor-denied")
    allowed = bridge.pre_tool_use("echo hi", str(repo), "advisor-allowed")
    assert denied.denied
    assert "test-span" in (denied.reason or "")
    assert not allowed.denied
