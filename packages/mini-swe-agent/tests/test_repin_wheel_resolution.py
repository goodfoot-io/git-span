"""Wheel-resolution contract for .claude/skills/evaluation/bin/repin-artifacts.sh.

The re-pin tool must resolve the candidate wheel the same way
experiment/build-image.sh does -- versioned glob over dist/ with fail-closed
cardinality -- never via the manifest-pinned filename, which goes stale after
a version bump and can silently attest months-old treatment code (the exact
staleness class main-330 eliminated on the build side).

Sandboxes replicate every artifact the script and its final
verify-artifact-hashes.sh pass touch, so the real script runs unmodified.
"""

import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

import pytest

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
REPIN = WORKSPACE_ROOT / ".claude" / "skills" / "evaluation" / "bin" / "repin-artifacts.sh"

BUNDLE_NAMES = (
    "snapshot.mjs",
    "advisor.mjs",
    "post-tool-use.mjs",
    "post-tool-use-failure.mjs",
    "session-end.mjs",
)
STALE_VERSION = "1.1.4"
CURRENT_VERSION = "1.1.15"


def wheel_name(version: str) -> str:
    return f"mini_swe_agent_git_span-{version}-py3-none-any.whl"


def tree_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


class Sandbox:
    """A minimal but verify-consistent mini-swe-agent package tree."""

    def __init__(self, pkg: Path):
        self.pkg = pkg
        self.dist = pkg / "dist"
        self.experiment = pkg / "experiment"
        self.manifest_path = self.experiment / "manifest.json"

        hooks_bin = pkg / "src" / "minisweagent_gitspan" / "hooks" / "bin"
        hooks_bin.mkdir(parents=True)
        hooks_root = hooks_bin.parent
        self.bundles = {name: f"// bundle {name} body\n".encode() for name in BUNDLE_NAMES}
        for name, data in self.bundles.items():
            (hooks_bin / name).write_bytes(data)
        self.hooks_json = b'{"schemaVersion": 2}\n'
        (hooks_root / "hooks.json").write_bytes(self.hooks_json)

        skill_root = self.experiment / "context" / "git-span-skill"
        skill_root.mkdir(parents=True)
        (skill_root / "SKILL.md").write_text("# git-span evaluation skill\n")
        (skill_root / "reference.md").write_text("reference detail\n")

        staging = pkg / "staging"
        staging.mkdir()
        (staging / "git-span").write_bytes(b"\x7fELF fake git-span binary\n")
        (staging / "node").write_bytes(b"\x7fELF fake node binary\n")

        self.dist.mkdir()
        self.bundle_hashes = {
            **{name: hashlib.sha256(data).hexdigest() for name, data in self.bundles.items()},
            "hooks.json": hashlib.sha256(self.hooks_json).hexdigest(),
        }
        self.skill_tree_hash = tree_sha256(skill_root)

    # -- artifact builders ---------------------------------------------------

    def make_wheel(self, version: str) -> Path:
        """A wheel whose embedded bundles match the on-disk ones (so the
        script's embedded-bundles staleness guard cannot distinguish it);
        versions differ only in their Python payload, like a real bump."""
        path = self.dist / wheel_name(version)
        with zipfile.ZipFile(path, "w") as zf:
            for name, data in self.bundles.items():
                zf.writestr(f"minisweagent_gitspan/hooks/bin/{name}", data)
            zf.writestr("minisweagent_gitspan/hooks/hooks.json", self.hooks_json)
            zf.writestr("minisweagent_gitspan/version.py", f'__version__ = "{version}"\n')
        return path

    def write_manifest(self, wheel_rel: str, wheel_sha256: str) -> None:
        manifest = {
            "_purpose": "repin wheel-resolution test fixture",
            "manifest_version": 7,
            "created_at": "2026-08-24T00:00:00Z",
            "mini_swe_agent_git_span": {
                "wheel_path": wheel_rel,
                "wheel_sha256": wheel_sha256,
                "_wheel_note": "superseded wheels are unusable; see main-330/main-389",
            },
            "git_span": {
                "sha256": hashlib.sha256((self.pkg / "staging/git-span").read_bytes()).hexdigest(),
                "staged_path": "staging/git-span",
            },
            "node": {
                "staged_binary_sha256": hashlib.sha256((self.pkg / "staging/node").read_bytes()).hexdigest(),
                "staged_binary_path": "staging/node",
            },
            "hook_bundles_sha256": dict(self.bundle_hashes),
            "skill": {
                "skill_file_sha256": hashlib.sha256(
                    (self.experiment / "context/git-span-skill/SKILL.md").read_bytes()
                ).hexdigest(),
                "skill_tree_sha256": self.skill_tree_hash,
            },
            "derived_image": {"image_id": "sha256:test", "runner_tag": "programbench/test:task_v6"},
        }
        self.manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        self.write_sidecars()

    def write_sidecars(self) -> None:
        pins = "\n".join(f"  {name}: {self.bundle_hashes[name]}" for name in BUNDLE_NAMES)
        (self.experiment / "treatment.yaml").write_text(
            "expected_bundle_sha256:\n" + pins + f"\nexpected_skill_tree_sha256: {self.skill_tree_hash}\n"
        )
        (self.experiment / "expected.json").write_text(
            json.dumps(
                {
                    "expected_bundle_sha256": {name: self.bundle_hashes[name] for name in BUNDLE_NAMES},
                    "expected_skill_tree_sha256": self.skill_tree_hash,
                },
                indent=2,
            )
            + "\n"
        )

    # -- observation helpers -------------------------------------------------

    def pinned_state(self) -> bytes:
        """Byte snapshot of every file a re-pin may mutate."""
        return b"".join(
            (self.experiment / name).read_bytes()
            for name in ("manifest.json", "treatment.yaml", "expected.json")
        )

    def manifest(self) -> dict:
        return json.loads(self.manifest_path.read_text())

    def repin(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(REPIN), "--yes", str(self.pkg)],
            capture_output=True,
            text=True,
            timeout=120,
        )


@pytest.fixture
def sandbox(tmp_path: Path) -> Sandbox:
    return Sandbox(tmp_path / "mini-swe-agent")


def test_multiple_wheels_refused_naming_both_without_writing(sandbox: Sandbox):
    stale = sandbox.make_wheel(STALE_VERSION)
    current = sandbox.make_wheel(CURRENT_VERSION)
    sandbox.write_manifest(f"dist/{stale.name}", hashlib.sha256(stale.read_bytes()).hexdigest())

    before = sandbox.pinned_state()
    proc = sandbox.repin()

    assert proc.returncode != 0, (
        "repin must refuse ambiguous dist/, not silently hash the pinned stale wheel:\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )
    combined = proc.stdout + proc.stderr
    assert stale.name in combined, f"refusal must name the stale candidate:\n{combined}"
    assert current.name in combined, f"refusal must name the current candidate:\n{combined}"
    assert "prune" in combined.lower(), f"refusal must instruct pruning dist/:\n{combined}"
    assert sandbox.pinned_state() == before, "a refused re-pin must not mutate any pinned file"


def test_single_wheel_with_unpinned_name_is_resolved_and_recorded(sandbox: Sandbox):
    current = sandbox.make_wheel(CURRENT_VERSION)
    sandbox.write_manifest(
        f"dist/{wheel_name(STALE_VERSION)}", "0" * 64
    )  # pin still names the pre-bump wheel

    proc = sandbox.repin()

    assert proc.returncode == 0, f"single current wheel must re-pin cleanly:\n{proc.stderr}"
    span = sandbox.manifest()["mini_swe_agent_git_span"]
    assert span["wheel_sha256"] == hashlib.sha256(current.read_bytes()).hexdigest(), (
        "recorded wheel_sha256 must be the hash of the one wheel in dist/"
    )
    assert span["wheel_path"] == f"dist/{current.name}", (
        "recorded wheel_path must name the resolved wheel so verify-artifact-hashes.sh "
        "re-checks the attested bytes"
    )


def test_zero_wheels_refused_with_build_hint(sandbox: Sandbox):
    sandbox.write_manifest(f"dist/{wheel_name(CURRENT_VERSION)}", "0" * 64)

    proc = sandbox.repin()

    assert proc.returncode != 0, "an empty dist/ must refuse rather than attest anything"
    combined = proc.stdout + proc.stderr
    assert "mini_swe_agent_git_span-*.whl" in combined, f"error must show the glob pattern:\n{combined}"
    assert "build" in combined.lower(), f"error must point at the build step:\n{combined}"


def test_clean_case_pin_matches_single_wheel_still_repins(sandbox: Sandbox):
    current = sandbox.make_wheel(CURRENT_VERSION)
    sandbox.write_manifest(f"dist/{current.name}", hashlib.sha256(current.read_bytes()).hexdigest())

    proc = sandbox.repin()

    assert proc.returncode == 0, f"documented clean flow must keep working:\n{proc.stderr}"
    span = sandbox.manifest()["mini_swe_agent_git_span"]
    assert span["wheel_sha256"] == hashlib.sha256(current.read_bytes()).hexdigest()
    assert span["wheel_path"] == f"dist/{current.name}"

