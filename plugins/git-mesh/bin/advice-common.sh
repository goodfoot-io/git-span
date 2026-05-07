#!/usr/bin/env bash
# Shared helpers for git-mesh advice hooks.
# Sourced by the per-event scripts under ${CLAUDE_PLUGIN_ROOT}/bin.

set -uo pipefail

# Hooks are recording-only: success is exit 0 with no stdout. On uncaught
# error, write a breadcrumb to stderr and exit 1 — the Claude Code
# *non-blocking* error convention. Exit code 2 is reserved for blocking
# errors and is intentionally not used here.
_advice_hook_err() {
  local rc=$? line=$1
  printf 'git-mesh advice hook: error rc=%s at line %s in %s\n' \
    "$rc" "$line" "${BASH_SOURCE[1]:-?}" >&2
  exit 1
}
trap '_advice_hook_err $LINENO' ERR

# Read the hook payload once into $HOOK_INPUT.
read_hook_input() {
  HOOK_INPUT="$(cat)"
  export HOOK_INPUT
}

hook_field() {
  printf '%s' "$HOOK_INPUT" | jq -r "$1 // empty"
}

# Locate the repo for this hook invocation. Hooks fire from cwd; if cwd
# isn't in a git repo, exit silently — git mesh advice has nothing to do.
in_git_repo() {
  local cwd
  cwd="$(hook_field '.cwd')"
  [ -n "$cwd" ] || cwd="$PWD"
  cd "$cwd" 2>/dev/null || return 1
  git rev-parse --git-dir >/dev/null 2>&1
}

# Map a directory to its containing git repo toplevel, or empty if the
# directory isn't inside a working tree.
resolve_repo_root() {
  local dir="$1"
  [ -n "$dir" ] && [ -d "$dir" ] || return 0
  (cd "$dir" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || true
}

# Resolve $2 against $1 if relative; pass through if absolute.
abspath_against() {
  case "$2" in
    /*) printf '%s\n' "$2" ;;
    *)  printf '%s\n' "$1/$2" ;;
  esac
}

# Run a single advice verb for one repo. Recording verbs are silent on
# success; their stdout is discarded so the hook leaks nothing back to
# Claude. The verb's stderr is inherited so any error message lands in the
# transcript. On non-zero exit, propagate by exiting the hook with code 1
# (non-blocking error per Claude Code's hook protocol).
# Usage: run_advice_verb <repo_root> <sid> <verb> [<arg1> [<arg2>]]
run_advice_verb() {
  local repo_root="$1" sid="$2" verb="$3"
  shift 3
  local args=("$@") rc=0
  (cd "$repo_root" && git mesh advice "$sid" "$verb" "${args[@]}" >/dev/null) || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'git-mesh advice hook: `git mesh advice %s %s` failed (rc=%s)\n' \
      "$sid" "$verb" "$rc" >&2
    exit 1
  fi
}
