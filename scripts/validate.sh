#!/usr/bin/env bash
set -o pipefail

# Single-instance guard: only one validation may run at a time, across every
# worktree of this repo. The lock lives in the git common dir — the one
# directory all worktrees share — so validations in sibling worktrees
# serialize while unrelated repos stay independent. flock releases the lock
# automatically when the holder exits (even on a crash), so a dead validation
# can never wedge future runs.
#
# On conflict the default is to alert on stdout and exit 2; `--wait` blocks
# until the running validation finishes, then proceeds.
WAIT=0
for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=1 ;;
    *)
      echo "ERROR: unknown option '$arg' (only --wait is supported)" >&2
      exit 2
      ;;
  esac
done

common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -z "$common_dir" ]; then
  echo "ERROR: not inside a git repository — cannot take the validation lock" >&2
  exit 1
fi

lock_path="$common_dir/validate.lock"
owner_path="$common_dir/validate.lock.owner"

exec 9>"$lock_path"

acquire_lock() {
  if flock -x -n 9; then
    # Record the holder (pid, host, worktree, start time, kind) so blocked
    # runs can point at the worktree in question and name what actually holds
    # the lock. Written atomically via tmp + mv while the lock is held, so
    # readers always see a complete record. "kind" is "validate" here, and
    # "gate" when scripts/../packages/website/scripts/with-gate-lock.sh is the
    # writer — the two scripts share this lock and this owner-file format, so
    # a reader must not assume its own kind is the one that wrote the file.
    printf '%s\n' "$$" "${HOSTNAME:-unknown}" "$PWD" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "validate" > "$owner_path.tmp"
    mv "$owner_path.tmp" "$owner_path"
    return 0
  fi
  return 1
}

holder_info() {
  local pid="" host="" worktree="" started="" kind=""
  if [ -f "$owner_path" ]; then
    pid="$(sed -n '1p' "$owner_path")"
    host="$(sed -n '2p' "$owner_path")"
    worktree="$(sed -n '3p' "$owner_path")"
    started="$(sed -n '4p' "$owner_path")"
    kind="$(sed -n '5p' "$owner_path")"
  fi
  if [ "$kind" = "gate" ]; then
    echo "a website gate run is using this worktree's build (pid ${pid:-unknown} on ${host:-unknown}, started ${started:-unknown})"
  else
    echo "another validation is already running (pid ${pid:-unknown} on ${host:-unknown}, started ${started:-unknown})"
  fi
  [ -n "$worktree" ] && echo "  worktree: $worktree"
}

if ! acquire_lock; then
  if [ "$WAIT" -eq 1 ]; then
    holder_info
    echo "Waiting for it to finish — validation will start once the lock is released."
    waited=0
    while ! acquire_lock; do
      waited=$((waited + 1))
      if [ $((waited % 12)) -eq 0 ]; then
        echo "still waiting for the other validation to finish..."
      fi
      sleep 5
    done
    echo "validation lock acquired — starting."
  else
    holder_info
    echo "Only one validation may run at a time — re-run with 'yarn validate --wait'"
    echo "to wait for the running validation to finish."
    exit 2
  fi
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Guardrail: integration tests must not reference `std::os::unix` directly —
# they go through tests/support/mod.rs cross-platform helpers so the suite
# compiles and runs on Windows. Fail fast before the (slow) yarn pipeline.
guardrail_root="$repo_root/packages/git-span/tests"
if [ -d "$guardrail_root" ]; then
  offenders=""
  while IFS= read -r f; do
    # Allow os::unix only in tests/support/ cross-platform helpers.
    case "$f" in
      "$guardrail_root/support/"*) continue ;;
    esac
    if grep -q 'os::unix' "$f"; then
      offenders="$offenders$f"$'\n'
    fi
  done < <(find "$guardrail_root" -type f -name '*.rs')
  if [ -n "$offenders" ]; then
    echo "ERROR: forbidden 'os::unix' reference in integration tests" >&2
    echo "Use the cross-platform helpers in tests/support/mod.rs instead." >&2
    printf '%s' "$offenders" >&2
    exit 1
  fi
fi

# Log to the per-worktree git dir: unlike a repo-root path, it is never
# symlink-shared between worktrees, so the log always belongs to this run.
log_path="$(git rev-parse --absolute-git-dir)/validate-output.log"
echo "Full validation log: $log_path"

# The drift gate must certify the tree with the binary built from it, never
# with a git-span resolved through PATH. The npm-installed release and the
# workspace build report the same version string, so a --version comparison is
# not a signal — only provenance is. Build the workspace binary under the
# shared target lock (the same pattern every cargo gate in
# packages/git-span/package.json uses), then prepend its build directory to
# PATH so `git span` resolves to this tree's build and nothing else. If the
# build fails, the && chain below fails the validation — the gate fails closed
# rather than falling through to an installed release.
target_root="${GIT_SPAN_CARGO_TARGET_ROOT:-/var/cache/git-span/cargo-target}"
build_dir="$target_root/git-span/build"

{
  # Reject superseded hook packages before any build or test can rewrite
  # generated artifacts and hide the tracked-tree state being certified. The
  # focused suite runs the real scanner in temporary git repositories so its
  # tracked-file scope and retained-identifier allowlist stay fail-closed.
  node scripts/check-agent-hooks-migration.mjs &&
  node --test scripts/check-agent-hooks-migration.test.mjs &&
  # Every plugin must carry one version across all four platform manifests and
  # its marketplace entry — the fan-out scripts enumerate the manifests, and
  # this gate refuses a tree where any enumeration was missed. The focused
  # suite runs the real checker against temporary git fixtures, plus this
  # repository itself.
  node scripts/check-version-consistency.mjs &&
  node --test scripts/check-version-consistency.test.mjs &&
  # The skills build and lint drivers must fail closed when the CLI silently
  # declines to run, refuse to destroy hand-edits to rendered trees, and
  # reconcile the registry's skill declarations against disk — the focused
  # suite exercises the real drivers end-to-end in fixture repositories.
  node --test scripts/agent-skills-drivers.test.mjs &&
  (
    cd "$repo_root/packages/git-span"
    bash scripts/with-target-lock.sh shared env CARGO_TARGET_DIR="$build_dir" cargo build --quiet --locked --bin git-span
  ) &&
  PATH="$build_dir/debug:$PATH" git span drift &&
  yarn typecheck &&
  yarn lint &&
  # rkyv-js must stay resolvable through its own package exports (card
  # main-386): Node resolves every declared target, tsc binds the bare
  # specifier without paths entries, and no alias workaround creeps back.
  node scripts/check-rkyv-resolution.mjs &&
  # Migration-bundle proof (card main-386-1): validate must build the bundle
  # itself — scripts/dist/ is gitignored and worktree-provisioned as a shared
  # symlink, so a fresh checkout has nothing at that path. The golden gate then
  # holds dry-run output byte-equal to the pre-upgrade bundle's, and the compat
  # scan keeps the node20 target honest about runtime APIs esbuild won't catch.
  yarn build:migration &&
  node scripts/check-migration-golden.mjs &&
  node scripts/check-migration-bundle-compat.mjs &&
  # The artifact drift gate runs before the test suites, never after: after
  # `yarn build` the build would have rewritten the committed file and the
  # check would trivially pass, and after `yarn test` the website contract
  # suite's toEqual failure (which names no fix command) would pre-empt the
  # umbrella's "ERROR: … is stale; run …" — the named-error contract must be
  # the first failure a developer sees. First placement also keeps its lines
  # in the failure-summary tail even when later steps fail too.
  yarn workspace @goodfoot/git-span-website artifacts:check &&
  yarn test &&
  {
    # The website's rolldown-vite build carries three upstream races that open
    # almost exclusively when the machine is still hot from the parallel test
    # phase, where virtiofs worktree mounts stretch IO latency:
    #   1. vite's JS prepareOutDir and rolldown's native chunk writer both
    #      ensure dist/server exists; the loser's mkdir surfaces as
    #      "[UNHANDLEABLE_ERROR] … File exists (os error 17)".
    #   2. vite bundles vite.config.ts into node_modules/.vite-temp/ and
    #      dynamic-imports it; on this mount the import can lose a just-written
    #      timestamped file — ERR_MODULE_NOT_FOUND naming .vite-temp.
    #   3. fumadocs-mdx's postinstall mkdirs packages/website/.source; on this
    #      mount the fresh-entry create intermittently reports ENOENT while
    #      materializing the directory anyway — the same misreport the
    #      recovery-domain lock creation hits (see recovery_domain.rs).
    # One retry gated on those exact signatures keeps every other build
    # failure fail-closed on first occurrence.
    if ! SKIP_INSTALL=1 yarn build; then
      if tail -n 400 "$log_path" 2>/dev/null | grep -q -e 'Could not create directory for output chunks' -e 'ERR_MODULE_NOT_FOUND.*\.vite-temp' -e "no such file or directory, mkdir .*packages/website/\.source"; then
        echo "known website-toolchain race after test phase — retrying build once" >&2
        SKIP_INSTALL=1 yarn build
      else
        exit 1
      fi
    fi
  } &&
  # Generated-tree freshness gates. Both call the one shared staleness
  # predicate in check-generated-tree-freshness.mjs — the same script the
  # release workflow runs — so the local and CI gates cannot measure
  # different things (modified, untracked, AND deleted paths all count).
  # The hooks bundles were rebuilt by 'yarn build' above; the skills suite
  # runs its own build driver, whose guards make the measurement witnessing
  # rather than healing (a hand-edit or unverifiable render fails with its
  # own diagnosis instead of being flattened into "commit the trees").
  # Lint runs first as its own step — a lint-baseline drift is a
  # build-independent failure mode and must name itself rather than hide
  # behind a build error.
  # The vocabulary sync check runs before the skills gate: a stale copy of
  # the glossary inside a template means the rendered trees are about to
  # teach per-platform vocabulary the glossary no longer sanctions.
  node scripts/check-generated-tree-freshness.mjs hooks &&
  node scripts/lint-agent-skills.mjs &&
  node scripts/sync-skill-vocabulary.mjs --check &&
  node scripts/check-generated-tree-freshness.mjs skills
} 2>&1 | tee "$log_path"

EXIT_CODE=${PIPESTATUS[0]}
echo "Exit code: $EXIT_CODE" | tee -a "$log_path"

# On failure, restate the cause at the very end of the stream. Captured output
# is often truncated in the middle, so keeping the failing lines in the tail
# makes one run sufficient — the full log stays at $log_path for anything else.
if [ "$EXIT_CODE" -ne 0 ]; then
  summary="$(grep -aiE 'error|fail(ed|ure|ing)?\b|✗|✖' "$log_path" | grep -avE '\bPASS\b|✔|\b0 fail' | tail -40)"
  {
    echo ""
    echo "=== VALIDATION FAILED (exit $EXIT_CODE) — failure summary ==="
    if [ -n "$summary" ]; then
      printf '%s\n' "$summary"
    else
      echo "(no lines matched the error patterns — read the full log)"
    fi
    echo "=== end summary — full log: $log_path ==="
  } | tee -a "$log_path"
fi
exit "$EXIT_CODE"
