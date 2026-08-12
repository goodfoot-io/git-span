#!/usr/bin/env bash
# Re-pin every pinned hash in the experiment, in lockstep, from the artifacts
# currently on disk. Writes THREE files that must never diverge:
#
#   experiment/manifest.json   wheel_sha256, hook_bundles_sha256 (5 .mjs +
#                              hooks.json), skill hashes, derived_image ids,
#                              arms[].image_id, manifest_version, timestamps
#   experiment/treatment.yaml  expected_bundle_sha256 (5 .mjs only),
#                              expected_skill_tree_sha256
#   experiment/expected.json   expected_bundle_sha256 (5 .mjs only),
#                              expected_skill_tree_sha256
#
# expected.json is easy to miss -- it is NOT mentioned in the setup guide's
# pinning section, but experiment/smoke_test.py reads it, so a re-pin that
# skips it leaves the smoke scenario asserting against dead hashes.
# control.yaml pins nothing (hooks are disabled there, so no attestation).
#
# Ordering: this script only records what is already built. Run the rebuild
# steps FIRST (yarn build:hooks && uv build), then this, then build-image.sh,
# then re-run with --image-id to record the new derived image.
#
# Usage:
#   repin-artifacts.sh --yes [--image-id sha256:...] [--no-bump] [pkg-dir]
#
#   --yes         required; this mutates pinned experiment state
#   --image-id    also re-pin derived_image + both arms to this image id
#                 (take it from build-image.sh's derived_image_id= line)
#   --no-bump     leave manifest_version alone (default: increment it)
#
# Refuses to write if the wheel's embedded bundles differ from the on-disk
# bundles -- that mismatch means the wheel is stale and the pins would attest
# to something the container will never contain.
set -euo pipefail

CONFIRM=0
IMAGE_ID=""
BUMP=1
PKG_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes) CONFIRM=1; shift ;;
        --image-id) IMAGE_ID="${2:-}"; shift 2 ;;
        --no-bump) BUMP=0; shift ;;
        -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) PKG_DIR="$1"; shift ;;
    esac
done

if [[ "${CONFIRM}" -ne 1 ]]; then
    echo "ERROR: refusing to re-pin without --yes (this rewrites pinned experiment state)." >&2
    echo "Run with --help for the full contract." >&2
    exit 2
fi

if [[ -z "${PKG_DIR}" ]]; then
    PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../packages/mini-swe-agent" && pwd)"
fi

if [[ -n "${IMAGE_ID}" && "${IMAGE_ID}" != sha256:* ]]; then
    echo "ERROR: --image-id must be a full 'sha256:...' id, got: ${IMAGE_ID}" >&2
    exit 2
fi

python3 - "$PKG_DIR" "$IMAGE_ID" "$BUMP" <<'PY'
import datetime
import hashlib
import json
import pathlib
import re
import sys
import zipfile

pkg_dir = pathlib.Path(sys.argv[1])
image_id = sys.argv[2]
bump = sys.argv[3] == "1"

experiment = pkg_dir / "experiment"
manifest_path = experiment / "manifest.json"
treatment_path = experiment / "treatment.yaml"
expected_path = experiment / "expected.json"

manifest = json.loads(manifest_path.read_text())


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    if not path.is_file():
        sys.exit(f"ERROR: expected artifact missing: {path}")
    return sha256_bytes(path.read_bytes())


def tree_sha256(root: pathlib.Path) -> str:
    # Must match verify-artifact-hashes.sh and the manifest's documented
    # algorithm exactly: sorted rglob, relpath\0 + bytes + \0.
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


hooks_root = pkg_dir / "src" / "minisweagent_gitspan" / "hooks"
hooks_bin = hooks_root / "bin"

# The five ALL_HOOKS bundles the container's _build_attestation() hashes.
# hooks.json is pinned in manifest.json for provenance only and must NEVER
# appear in treatment.yaml/expected.json -- it is not in bundle_hashes, so any
# expected entry compares against None and fails preflight every time.
all_hooks = [
    "snapshot.mjs",
    "advisor.mjs",
    "post-tool-use.mjs",
    "post-tool-use-failure.mjs",
    "session-end.mjs",
]

bundle_hashes = {name: sha256_file(hooks_bin / name) for name in all_hooks}
hooks_json_hash = sha256_file(hooks_root / "hooks.json")

wheel_path = pkg_dir / manifest["mini_swe_agent_git_span"]["wheel_path"]
wheel_hash = sha256_file(wheel_path)

# Guard: the wheel is what actually lands in the image. If its embedded
# bundles differ from the on-disk ones we just hashed, the wheel is stale and
# these pins would attest to bytes the container will never have.
with zipfile.ZipFile(wheel_path) as zf:
    members = {pathlib.PurePosixPath(n).name: n for n in zf.namelist()
               if "/hooks/" in n and (n.endswith(".mjs") or n.endswith("hooks.json"))}
    stale = []
    for name, want in list(bundle_hashes.items()) + [("hooks.json", hooks_json_hash)]:
        member = members.get(name)
        if member is None:
            stale.append(f"{name} (absent from wheel)")
        elif sha256_bytes(zf.read(member)) != want:
            stale.append(name)

if stale:
    sys.exit(
        "ERROR: the wheel does not match the on-disk hook bundles: "
        + ", ".join(stale)
        + f"\n  wheel: {wheel_path}"
        + "\nRebuild it first, from packages/mini-swe-agent:  yarn build:hooks && uv build"
    )

skill_root = experiment / "context" / "git-span-skill"
skill_file_hash = sha256_file(skill_root / "SKILL.md")
skill_tree_hash = tree_sha256(skill_root)

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
changes = []


def note(label, old, new):
    if old != new:
        changes.append(f"  {label}: {str(old)[:16]}… -> {str(new)[:16]}…")


# ---- manifest.json -------------------------------------------------------
note("wheel_sha256", manifest["mini_swe_agent_git_span"]["wheel_sha256"], wheel_hash)
manifest["mini_swe_agent_git_span"]["wheel_sha256"] = wheel_hash

for name, value in bundle_hashes.items():
    note(f"bundle {name}", manifest["hook_bundles_sha256"].get(name), value)
    manifest["hook_bundles_sha256"][name] = value
note("hooks.json", manifest["hook_bundles_sha256"].get("hooks.json"), hooks_json_hash)
manifest["hook_bundles_sha256"]["hooks.json"] = hooks_json_hash

note("skill_file_sha256", manifest["skill"]["skill_file_sha256"], skill_file_hash)
note("skill_tree_sha256", manifest["skill"]["skill_tree_sha256"], skill_tree_hash)
manifest["skill"]["skill_file_sha256"] = skill_file_hash
manifest["skill"]["skill_tree_sha256"] = skill_tree_hash

if image_id:
    derived = manifest["derived_image"]
    tag_repo = derived["runner_tag"].split(":", 1)[0]
    note("derived_image.image_id", derived["image_id"], image_id)
    derived["image_id"] = image_id
    derived["repo_digest"] = f"{tag_repo}@{image_id}"
    derived["built_at"] = now
    for arm in manifest.get("arms", {}).values() if isinstance(manifest.get("arms"), dict) else manifest.get("arms", []):
        if isinstance(arm, dict) and "image_id" in arm:
            arm["image_id"] = image_id

if bump:
    manifest["manifest_version"] = int(manifest["manifest_version"]) + 1
    changes.append(f"  manifest_version -> {manifest['manifest_version']}")
manifest["created_at"] = now

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

# ---- treatment.yaml (line-targeted; preserves its explanatory comments) ---
text = treatment_path.read_text()
for name, value in bundle_hashes.items():
    pattern = rf"(^[ \t]*{re.escape(name)}:[ \t]*)[0-9a-f]{{64}}[ \t]*$"
    text, n = re.subn(pattern, rf"\g<1>{value}", text, flags=re.MULTILINE)
    if n != 1:
        sys.exit(f"ERROR: expected exactly 1 '{name}' pin in treatment.yaml, found {n}")
text, n = re.subn(r"(^[ \t]*expected_skill_tree_sha256:[ \t]*)[0-9a-f]{64}[ \t]*$",
                  rf"\g<1>{skill_tree_hash}", text, flags=re.MULTILINE)
if n != 1:
    sys.exit(f"ERROR: expected exactly 1 expected_skill_tree_sha256 in treatment.yaml, found {n}")
if re.search(r"^\s*hooks\.json:", text, flags=re.MULTILINE):
    sys.exit("ERROR: treatment.yaml lists hooks.json under expected_bundle_sha256; "
             "that key always fails preflight. Remove it.")
treatment_path.write_text(text)

# ---- expected.json (smoke_test.py) ---------------------------------------
expected = json.loads(expected_path.read_text())
expected["expected_bundle_sha256"] = dict(bundle_hashes)
expected["expected_skill_tree_sha256"] = skill_tree_hash
expected_path.write_text(json.dumps(expected, indent=2) + "\n")

print("Re-pinned manifest.json, treatment.yaml, expected.json.")
if changes:
    print("Changed:")
    for line in changes:
        print(line)
else:
    print("  (all pins already current)")
if not image_id:
    print("\nNOTE: derived_image not re-pinned. After ./experiment/build-image.sh, "
          "re-run with --image-id <derived_image_id> to record it.")
PY

echo
echo "== verifying =="
"$(dirname "${BASH_SOURCE[0]}")/verify-artifact-hashes.sh" "${PKG_DIR}"
