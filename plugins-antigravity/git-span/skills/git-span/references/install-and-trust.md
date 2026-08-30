<!-- Generated from skills-src/git-span/git-span/references/install-and-trust.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Antigravity install flow

## Overview

Under Antigravity, git-span ships as a plugin directory
(`plugins-antigravity/git-span/` in this repository) holding a bare
`plugin.json`, the skill tree, and the hook manifest (`hooks.json` at the
plugin root). Installation is a single `agy plugin install` — there is no
marketplace and no separate trust-review step.

## 0. Prerequisite — the `git span` binary on `PATH`

The bundled hooks shell out to `git span list` and `git span drift`. The
plugin does not install or manage this binary — build or install the
`git-span` CLI and confirm it resolves before going further:

```bash
git span --version
```

If this fails, none of the steps below will produce working hooks — fix
`PATH` first.

## 1. Install the plugin

From a local checkout:

```bash
agy plugin install ./plugins-antigravity/git-span
```

Or directly from the repository, appending the in-repo path to the git URL:

```bash
agy plugin install https://github.com/goodfoot-io/git-span.git/plugins-antigravity/git-span
```

(The `#subdirectory` fragment form fails with `could not detect plugin
structure` — append the path to the URL instead.) Installed files land under
`~/.gemini/config/plugins/git-span/`, and `agy plugin list` reports the
import and its components. `agy plugin validate <root>` runs unattended and
can be used to pre-check a local plugin root before installing. Re-run the
install after upgrading to refresh the copies.

## Trust posture

There is no trust-review step to complete — Antigravity runs installed plugin
hooks without a prompt. Every git-span hook fails open on anything deciding
*whether* there is something to say, and the host gives hooks no exit-code
channel at all: nothing they do can brick an edit or a commit. One host
behavior shapes the hook replies: Antigravity treats an **empty** PreToolUse
reply (`{}`) as a deny with an empty reason, so every non-deny path in the
bundled hooks answers with an explicit `{"decision": "allow"}` — silence is
not consent on this host. A hold is an
advisory one-time interruption — a held `git commit`/`git push` is denied
once with its checklist as the deny reason, and a bare retry passes — so rely
on `git span drift` in CI (see `references/ci-and-sync.md`) as the
enforcement backstop either way.

## Caveat: file edits get no attribution

Antigravity's hook contract pins the `run_command` (shell) tool, so shell
activity is fully attributed, but the names and argument shapes of its
dedicated file-edit tools are not pinned — and the hooks never guess at tool
names. In this version, edits made through those tools are invisible to the
touch pipeline: no touch attribution, no inline positional-drift heal, and no
`<git-span>` block for the edit itself. Drift such an edit causes still
surfaces later — through the next shell command touching the same anchors,
through `git span drift`, and through the commit advisor, which resolves the
real changeset from git state and therefore sees every edit however it was
made. Don't count on per-edit attribution outside `run_command`; rely on
`git span drift` in CI (see `references/ci-and-sync.md`) as the real
backstop, and see `references/understanding-hook-output.md` for what the
hooks do cover.
