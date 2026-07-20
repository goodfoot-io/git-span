# Codex install and trust flow

## Overview

Under OpenAI Codex, git-span ships as a hook-bundling plugin rather than a
Claude Code plugin. Getting its hooks running takes four steps plus one
prerequisite — registering a marketplace, installing the plugin, and
explicitly **trusting** the hooks are three distinct steps, none of which
happen automatically.

## 0. Prerequisite — the `git span` binary on `PATH`

The bundled hooks shell out to `git span list` and `git span stale`. Codex
does not install or manage this binary — build or install the `git-span`
CLI (`packages/git-span`) and confirm it resolves before going further:

```bash
git span --version
```

If this fails, none of the steps below will produce working hooks — fix
`PATH` first.

## 1. Register the marketplace

```bash
codex plugin marketplace add ./
```

Run from the repo root. This reads the repo-root `.agents/plugins/marketplace.json`
and registers its single entry under that file's `name` field (`git-span`).
Because the source is a local path, Codex snapshots it at version `local`
rather than a resolved git ref.

## 2. Install the plugin

```bash
codex plugin add git-span@git-span
```

This copies the plugin into `~/.codex/plugins/cache/git-span/git-span/local/`
and enables it. `${PLUGIN_ROOT}` in the plugin's hook commands resolves to
that cache path at hook-run time — not to the source checkout.

## 3. Trust the hooks

Installing and enabling the plugin does **not** trust its hooks. Hooks stay
inert until reviewed:

```bash
codex
/hooks
```

Launch `codex` and run `/hooks` to review the git-span hook definitions and
trust them. This is fail-closed by design: Codex prints a startup warning
pointing at `/hooks` for as long as trust review is pending, and the hooks do
nothing until you complete it. `--dangerously-bypass-hook-trust` exists for
one-off or CI runs where an interactive trust prompt isn't possible — avoid
it for normal interactive use.

Hash-stable filenames (produced by the plugin's `--plugin-root` build) keep
an existing trust decision valid across plugin updates, so re-trusting after
every upgrade is not expected to be necessary.

## 4. (Optional) reconciler git hooks

The `/hooks` trust flow above only covers Codex's own PreToolUse/Stop-style
plugin hooks. The separate `post-commit`/`post-rewrite` symlinks that drive
background span reconciliation are a manual, git-level step, independent of
Codex or plugin trust, and outside this skill's scope.

## Windows caveat

`@goodfoot/codex-hooks` disables hooks entirely on Windows. There is no
partial-functionality fallback — on Windows, none of the steps above produce
running hooks.
