<!-- Generated from skills-src/git-span/git-span/references/install-and-trust.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

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
(add `--global` to target your user-level `~/.config/opencode/` directories
instead of the project's `.opencode/`):

```bash
npx opencode-git-span install --global
```

This copies the three skills (`git-span`, `hook-effect-analysis`, and
`reconcile`) into the project's `.opencode/skills/<name>/` and the expert
agent into `.opencode/agents/expert.md`; with `--global` the same layout lands
under `~/.config/opencode/` instead (`~/.config/opencode/skills/<name>/`,
`~/.config/opencode/agents/expert.md`). Either way the installer echoes every
path it writes. Skills are then
addressed by their bare directory names through the skill tool, and re-run
the installer after upgrading the package to refresh the copies.

## Trust posture

There is no trust-review step to complete. OpenCode loads plugin hooks
without a prompt, and every git-span hook fails open: nothing it does can
brick an edit or a commit. A hold is an advisory one-time interruption — a
held `git commit`/`git push` surfaces its checklist once as the tool error,
and a bare retry passes — so rely on `git span drift` in CI (see
`references/ci-and-sync.md`) as the enforcement backstop either way.

## Caveat: host-level failures get no attribution

OpenCode's after hook fires only after a tool executes successfully — and only
host-level failures skip it (invalid arguments, denied permission, a spawn
error). Those calls get no touch attribution, no positional-drift heal, and no
advisor report for what they attempted, and any report stashed for them is
dropped silently; writes sitting behind such a failure still surface later,
through the next successful read/edit that touches them. A command that merely
exits nonzero is different: the bash tool returns normally with a numeric
`exit`, the after hook fires, and exit-gated attribution applies (a
short-circuited `&&` attributes nothing because its write never ran) — but,
as with the twins' failed commands, it can still surface a write only when
the parse provides decisive post-state evidence, such as an expected
replacement result; an inconclusive write stays silent under a nonzero exit.
Aborts and timeouts surface as `exit: null` and suppress attribution exactly
like interrupted rows. Don't count on attribution across host-level failures; rely
on `git span drift` in CI (see `references/ci-and-sync.md`) as the real
backstop, and see `references/understanding-hook-output.md` for what the hooks
do cover.
