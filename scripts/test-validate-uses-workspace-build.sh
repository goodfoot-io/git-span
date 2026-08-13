#!/usr/bin/env bash
set -euo pipefail

# Provenance test for the validation drift gate (card main-231-4):
# [scripts/validate.sh](./validate.sh) must certify drift with the binary built
# from this tree, never with a `git-span` resolved through PATH. Both the
# npm-installed release and the workspace build report the same version string
# (1.1.3), so the version is not a signal — only provenance is.
#
# The test plants a decoy `git-span` first on PATH. The decoy records a marker
# when invoked and emits a fabricated drift verdict. If the gate consulted PATH
# resolution, the marker appears and the fabricated verdict reaches the
# validation output. A second decoy `yarn` turns the rest of the pipeline into
# no-ops so the test exercises the real gate in seconds instead of minutes; it
# is speed scaffolding only — nothing asserted here concerns yarn.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

marker="$tmp/decoy-invoked"
out="$tmp/validate-output.log"

cat > "$tmp/git-span" <<EOF
#!/usr/bin/env bash
printf '%s\n' 'decoy consulted' >> "$marker"
echo "DECOY-FABRICATED-VERDICT: 0 drift across 999 spans (fabricated by the decoy — must never reach the gate)"
exit 1
EOF
chmod +x "$tmp/git-span"

cat > "$tmp/yarn" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$tmp/yarn"

set +e
(
  cd "$repo_root"
  PATH="$tmp:$PATH" bash scripts/validate.sh > "$out" 2>&1
)
status=$?
set -e

if [ "$status" -eq 2 ] && grep -q "another validation is already running" "$out"; then
  echo "FAIL (environment): another validation holds the lock — re-run when no validation is in flight" >&2
  exit 1
fi

fails=0

if [ -f "$marker" ]; then
  echo "FAIL: the drift gate consulted the PATH-resolved decoy git-span (marker written)" >&2
  fails=$((fails + 1))
fi

if grep -qF 'DECOY-FABRICATED-VERDICT' "$out"; then
  echo "FAIL: the decoy's fabricated drift verdict reached the validation output" >&2
  fails=$((fails + 1))
fi

if ! grep -Eq '[0-9]+ drift across [0-9]+ spans' "$out"; then
  echo "FAIL: the workspace build's drift verdict is missing from the validation output" >&2
  fails=$((fails + 1))
fi

if [ "$fails" -ne 0 ]; then
  echo "validation output:" >&2
  sed 's/^/  | /' "$out" >&2
  exit 1
fi

echo "PASS: validate.sh drift gate used the workspace build (decoy never consulted, real verdict present)"
