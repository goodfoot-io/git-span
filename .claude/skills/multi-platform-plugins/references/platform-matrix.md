# Platform matrix

The four platform trees a plugin can ship to. A repo may target fewer; list the
`plugins-*` directories to see which exist. Directory names below are the
conventional ones — confirm against the bundler registry rather than assuming.

## Trees and manifests

| Platform | Plugin root | Manifest (version-bearing) | Skills dir |
|----------|-------------|----------------------------|------------|
| Claude Code | `plugins-claude/<name>/` | `.claude-plugin/plugin.json` | `skills/` |
| Codex | `plugins-codex/<name>/` | `.codex-plugin/plugin.json` | `skills/` |
| OpenCode | `plugins-opencode/<name>/` | `package.json` (npm-publishable) | `skills/` |
| Antigravity | `plugins-antigravity/<name>/` | `plugin.json` (bare, at root) | `skills/` |

Antigravity's manifest sits at the plugin root with no dot-directory — the one
layout that breaks a naive `plugins-*/<name>/.<platform>-plugin/plugin.json` glob,
and the reason enumerations tend to silently skip it.

## Hook surfaces

| Platform | Registration | Event | Bundle output |
|----------|--------------|-------|---------------|
| Claude Code | `hooks/hooks.json` | `PostToolUse` | `hooks/bin/*.mjs` |
| Codex | `hooks/hooks.json` | `PostToolUse` | `hooks/*.mjs` |
| OpenCode | plugin module export | `tool.execute.after` | `dist/index.mjs` |
| Antigravity | none | — | — |

Antigravity has no hook surface. Its plugin ships skill-only; the hook bundler
produces no Antigravity target and templates map it to `null`.

Codex's build requires a plugin-root flag that the other targets do not. Read the
hook package's own build scripts for the exact per-target invocation.

## Discovery and marketplaces

| Platform | Discovery mechanism | Carries versions? |
|----------|--------------------|-------------------|
| Claude Code | `.claude-plugin/marketplace.json`, `plugins[]` with `source: ./plugins-claude/<name>` | Yes |
| Codex | `.agents/plugins/marketplace.json`, `source: ./plugins-codex/<name>` | No — entries are path-only |
| OpenCode | npm package name in `opencode.json`'s `plugin[]` array | Via npm registry |
| Antigravity | none — installed from a local directory or a git URL | Manifest only |

The Codex marketplace deliberately carries no version fields; a consistency gate
checks only that each entry's source path points at the right tree. Do not "fix"
this by adding versions.

## OpenCode's dual-purpose manifest

`plugins-opencode/<name>/package.json` is the one manifest doing two unrelated
jobs: it is the npm publishing manifest *and* a version-bearing surface the commit
gate checks. It is therefore **hand-maintained**, not generated — the packer reads
it and never writes it. Confirm that before assuming the "never edit a generated
tree" rule applies; grep the packer and renderer for writes to the path.

Its installer contract is a genuine trap. `opencode plugin <pkg>` detects a target
only from the *manifest*, never from the module's exports: it needs
`exports["./tui"]`, `exports["./server"]`, or a top-level `main`. A package whose
code correctly exports `server` but whose manifest declares only `exports["."]` is
rejected with "No plugin targets found" — working code, undeclared entry point.

Declaring the extra keys is safe. On success OpenCode patches the config with the
package *name*, so the runtime still resolves through `exports["."]`; the added
keys change installer detection only. Point both at the same bundle:

```json
"main": "./dist/index.mjs",
"exports": {
  ".": "./dist/index.mjs",
  "./server": "./dist/index.mjs"
}
```

## The version-bearing surfaces

Every platform manifest that exists, plus the Claude marketplace's `plugins[]`
entry for that plugin, must carry one identical version. With all four trees
present that is five surfaces for a single plugin.

A separate `metadata.version` on the marketplace is the catalog's own track, not
the product version — keep it out of any max-version scan or it drags the product
onto the catalog's numbering.
