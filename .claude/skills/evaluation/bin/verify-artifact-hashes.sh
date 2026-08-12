#!/usr/bin/env bash
# Recompute the sha256 of every pinned experiment artifact on disk and diff
# against packages/mini-swe-agent/experiment/manifest.json. Run this after
# any change to hooks, the skill, or the wheel, and before rebuilding the
# derived image -- it catches drift before it turns into a preflight
# failure inside a container.
#
# Usage: verify-artifact-hashes.sh [path-to-mini-swe-agent-package]
set -euo pipefail

PKG_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../packages/mini-swe-agent" && pwd)}"
EXPERIMENT_DIR="${PKG_DIR}/experiment"
MANIFEST="${EXPERIMENT_DIR}/manifest.json"

if [[ ! -f "${MANIFEST}" ]]; then
    echo "ERROR: manifest not found at ${MANIFEST}" >&2
    exit 1
fi

python3 - "$MANIFEST" "$EXPERIMENT_DIR" "$PKG_DIR" <<'PY'
import hashlib
import json
import pathlib
import sys

manifest_path, experiment_dir, pkg_dir = (pathlib.Path(p) for p in sys.argv[1:4])
manifest = json.loads(manifest_path.read_text())

mismatches = []

def sha256_file(path: pathlib.Path) -> str | None:
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()

def tree_sha256(root: pathlib.Path) -> str | None:
    if not root.is_dir():
        return None
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()

def check(label, expected, actual):
    status = "OK" if expected == actual else "MISMATCH"
    print(f"[{status}] {label}: expected={expected} actual={actual}")
    if expected != actual:
        mismatches.append(label)

# Wheel.
wheel_rel = manifest["mini_swe_agent_git_span"]["wheel_path"]
wheel_path = pkg_dir / wheel_rel
check("wheel sha256", manifest["mini_swe_agent_git_span"]["wheel_sha256"], sha256_file(wheel_path))

# git-span / node staged binaries.
check("git-span binary sha256", manifest["git_span"]["sha256"], sha256_file(pkg_dir / manifest["git_span"]["staged_path"]))
check("node binary sha256", manifest["node"]["staged_binary_sha256"], sha256_file(pkg_dir / manifest["node"]["staged_binary_path"]))

# Hook bundles, on-disk src (source of truth before a rebuild).
hooks_dir = pkg_dir / "src" / "minisweagent_gitspan" / "hooks" / "bin"
for filename, expected in manifest["hook_bundles_sha256"].items():
    if filename.startswith("_"):
        continue
    check(f"hook bundle {filename}", expected, sha256_file(hooks_dir / filename))

# Frozen skill tree (staged copy baked into the image).
skill_root = pkg_dir / "experiment" / "context" / "git-span-skill"
check("skill file sha256", manifest["skill"]["skill_file_sha256"], sha256_file(skill_root / "SKILL.md"))
check("skill tree sha256", manifest["skill"]["skill_tree_sha256"], tree_sha256(skill_root))

if mismatches:
    print(f"\n{len(mismatches)} mismatch(es): {mismatches}", file=sys.stderr)
    print("Rebuild the wheel/image and/or update manifest.json + treatment.yaml's expected_* fields together.", file=sys.stderr)
    sys.exit(1)
print("\nAll artifact hashes match manifest.json.")
PY
