#!/usr/bin/env bash
set -uo pipefail

# Typecheck every workspace package that declares a `typecheck` script, in
# parallel, delegating each check to the package's own script. Let Yarn resolve
# tool binaries. The package set is enumerated from Yarn's workspace list at
# run time rather than hand-maintained here, so a new package carrying a
# `typecheck` gate is covered locally without touching this file — local runs
# cannot drift from the gates CI enforces per package (card main-323).

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Emit one directory per line for each workspace whose package.json declares
# scripts.typecheck. The root workspace is excluded: it hosts this very script,
# so including it would recurse forever.
mapfile -t PACKAGE_DIRS < <(
  {
    cd "$WORKSPACE_ROOT" &&
      yarn workspaces list --json
  } | node -e '
    const fs = require("fs");
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      for (const line of input.split("\n")) {
        if (!line.trim()) continue;
        const { location } = JSON.parse(line);
        if (location === ".") continue;
        const pkg = JSON.parse(fs.readFileSync(`${location}/package.json`, "utf8"));
        if (pkg.scripts && pkg.scripts.typecheck) console.log(location);
      }
    });
  '
)

# Fail closed: an empty result means either nothing declares the gate anymore
# or enumeration itself broke (yarn/node failure) — both must be loud, never a
# vacuous pass.
if [ "${#PACKAGE_DIRS[@]}" -eq 0 ]; then
  echo "ERROR: no workspace package declares a \`typecheck\` script — refusing to pass vacuously." >&2
  exit 1
fi

PIDS=()
for DIR in "${PACKAGE_DIRS[@]}"; do
  echo "Running typecheck for $DIR..."
  (cd "$WORKSPACE_ROOT/$DIR" && yarn run typecheck) &
  PIDS+=($!)
done

# The two cargo clippy checks (git-span, git-span-core) use separate check/
# target dirs and coexist under with-target-lock.sh's shared lock, so running
# everything concurrently is safe. Every job runs to completion; the script
# fails if any of them did.
EXIT=0
for PID in "${PIDS[@]}"; do
  wait "$PID" || EXIT=1
done

exit $EXIT
