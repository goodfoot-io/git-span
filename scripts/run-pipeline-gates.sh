#!/usr/bin/env bash
set -euo pipefail

# THE definition of the skills/hooks pipeline gate set. scripts/validate.sh,
# .github/workflows/ci.yml (the PR gate), and
# .github/workflows/release-git-span.yml all execute the phases below instead
# of naming individual gate scripts — one list, several callers, so a gate can
# never again run locally but be absent from the PR path (round-2 finding
# new-gates-absent-from-the-pr-gate: none of the wave's gates ran on
# pull_request, and the agent-hooks vocabulary controls had no CI execution at
# all). Add or remove a gate HERE; hand-copying an invocation into a caller
# recreates exactly the local-vs-CI divergence this file exists to end.
#
# CALLER OBLIGATION: the ci.yml job that runs these phases (pipeline-gates)
# must remain a REQUIRED status check on main in branch protection. Merging to
# main IS publishing for the Antigravity route — `agy plugin install` consumes
# the default branch directly, with no tag, release, or later gate in between —
# so an advisory-only run of this file protects nobody. The requirement lives
# in repository settings, which no file in this tree can enforce; this notice
# is the in-tree record of that obligation, placed here because the
# generated-tree-freshness-gate span watches this file.
#
# Phases (a caller passes one, or `all`):
#
#   pre-build        Integrity checks that must run before any build or test
#                    can rewrite generated artifacts and hide the tracked-tree
#                    state being certified: the superseded-hook-package scan,
#                    plugin version consistency, refusal-coverage
#                    reconciliation for the agent-skills gate family, and the
#                    agent-skills driver suite — each check paired with the
#                    node --test suite that proves its mechanism still trips.
#
#   agent-hooks-tests  The packages/agent-hooks vitest suite — the hook
#                    runtime tests plus the skill-tree vocabulary controls
#                    (test/opencode and test/antigravity), which have no
#                    tag-time backstop and exist only here. The suite's one
#                    definition is the workspace's own `test` script;
#                    scripts/validate.sh reaches it through the root
#                    `yarn test` workspaces run instead of this phase, so it
#                    must not double-run it (see validate.sh).
#                    Requires a buildable packages/git-span (the suite
#                    cargo-builds the workspace binary via
#                    test/real-bundle-helpers.ts).
#
#   generated-trees  The committed-generated-output gates, self-contained:
#                    rebuild every hook bundle, then measure both tree
#                    families with the one staleness predicate
#                    (check-generated-tree-freshness.mjs), with the lint
#                    driver first (a lint-baseline drift is build-independent
#                    and must name itself) and the vocabulary sync check
#                    before the skills gate (a stale glossary copy means the
#                    trees are about to teach unsanctioned vocabulary).
#                    The skills gate runs the build driver itself; its guards
#                    make the measurement witnessing rather than healing.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

run_pre_build() {
  node scripts/check-agent-hooks-migration.mjs
  node --test scripts/check-agent-hooks-migration.test.mjs
  node scripts/check-version-consistency.mjs
  node --test scripts/check-version-consistency.test.mjs
  node scripts/check-refusal-coverage.mjs
  node --test scripts/check-refusal-coverage.test.mjs
  node --test scripts/agent-skills-drivers.test.mjs
}

run_agent_hooks_tests() {
  yarn workspace agent-hooks test
}

run_generated_trees() {
  # Rebuilding the bundles here (not in the caller) keeps the phase meaningful
  # everywhere it runs: without a rebuild, a fresh checkout measures the
  # committed bytes against themselves and the hooks gate passes vacuously.
  yarn workspace agent-hooks build
  node scripts/check-generated-tree-freshness.mjs hooks
  node scripts/lint-agent-skills.mjs
  node scripts/sync-skill-vocabulary.mjs --check
  node scripts/check-generated-tree-freshness.mjs skills
}

phase="${1:-all}"
case "$phase" in
  pre-build) run_pre_build ;;
  agent-hooks-tests) run_agent_hooks_tests ;;
  generated-trees) run_generated_trees ;;
  all)
    run_pre_build
    run_agent_hooks_tests
    run_generated_trees
    ;;
  *)
    echo "ERROR: unknown phase '$phase' (expected pre-build | agent-hooks-tests | generated-trees | all)" >&2
    exit 2
    ;;
esac
