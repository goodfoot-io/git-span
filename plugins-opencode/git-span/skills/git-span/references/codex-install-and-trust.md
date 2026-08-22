# OpenCode install and skill setup

## Overview

Under OpenCode, git-span ships as an npm plugin package (`opencode-git-span`)
rather than a Claude Code plugin. Getting its hooks (the touch hook and the
advisor) running takes two steps plus one prerequisite — registering the
package in the OpenCode config, and materializing its skills and expert agent
onto disk are two distinct steps, neither of which happens automatically.

## 0. Prerequisite — the `git span` binary on `PATH`

The bundled hooks shell out to `git span list` and `git span drift`. The
plugin does not install or manage this binary — build or install the
`git-span` CLI and confirm it resolves before going further:

```bash
git span --version
```

If this fails, none of the steps below will produce working hooks — fix
`PATH` first.

## 1. Register the plugin package

Add `"opencode-git-span"` to the `plugin` array in your OpenCode config
(`opencode.jsonc` or `opencode.json`, project-level or global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-git-span"]
}
```

OpenCode loads the package in-process at startup, and the touch hook and
advisor are active from the next session on.

## 2. Materialize the skills and the expert agent

An npm plugin cannot contribute skills or agents — OpenCode loads those only
from filesystem directories. Run the package's installer once per checkout
(add `--global` to target your user-level directories instead of the
project's):

```bash
npx opencode-git-span install --global
```

This copies the three skills (`git-span`, `hook-effect-analysis`, and
`reconcile`) into `.opencode/skills/<name>/` and the expert agent into
`.opencode/agents/expert.md`, echoing every path it writes. Skills are then
addressed by their bare directory names through the skill tool, and re-run
the installer after upgrading the package to refresh the copies.

## Trust posture

There is no trust-review step to complete. OpenCode loads plugin hooks
without a prompt, and every git-span hook fails open: nothing it does can
brick an edit or a commit. A hold is an advisory one-time interruption — a
held `git commit`/`git push` surfaces its checklist once as the tool error,
and a bare retry passes — so rely on `git span drift` in CI (see
`references/ci-and-sync.md`) as the enforcement backstop either way.

## Caveat: failed tool calls get no attribution

OpenCode's after hook fires only after a tool executes successfully — it
never fires on a failed tool call. A command that exits nonzero gets no touch
attribution, no positional-drift heal, and no advisor report for what it
wrote, and any report stashed for it is dropped silently. Writes sitting
unattributed behind a failed command still surface later, through the next
successful read/edit that touches them. Don't count on failure-path
attribution; rely on `git span drift` in CI (see
`references/ci-and-sync.md`) as the real backstop, and see
`references/understanding-hook-output.md` for what the hooks do cover.
