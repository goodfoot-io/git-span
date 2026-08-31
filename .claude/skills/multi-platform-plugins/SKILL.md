---
name: multi-platform-plugins
description: This skill should be used when implementing, porting, or testing plugin and skill files that ship to multiple agent platforms (Claude Code, Codex, OpenCode, Antigravity) from a single source via @goodfoot/agent-hooks and @goodfoot/agent-skills. Use when the user asks to "port this plugin to another platform", "add a skill to the plugin trees", "add a new platform target", "rebuild the plugin trees", or "smoke test the plugin installation".
---

<instructions>

One authored source fans out to every agent platform: hook logic from
`@goodfoot/agent-hooks`, skill prose from `@goodfoot/agent-skills`. Every
per-platform tree is generated output that is *also committed*, so the build, the
version fan-out, and the freshness gates are the whole job — hand-editing a
generated tree is always wrong.

<placeholder-variables>
- [PLUGIN_NAME] — the plugin's directory name, identical across every platform tree
- [SMOKE_HOST] — where the agent CLIs run for the install round; prefer a disposable container
</placeholder-variables>

## 1. Orient Before Editing

Read the bundler registry that drives every generated tree — it names each plugin's
template source, its per-platform targets, and its lint baseline. Locate it by
searching for the bundler's config rather than assuming a path.

- **Changing skill prose**: edit only the `.eta` templates under the registry's
  `skillsSrc`. Proceed to Step 3: Author Skills Once, Vary Per Platform.
- **Changing hook behavior**: edit the hook package's `src/`. Proceed to Step 2:
  Author Hooks Once, Adapt Per Platform.
- **Adding a whole platform**: do both, and read `references/platform-matrix.md`
  first — platforms differ in manifest name, hook surface, and install mechanism.
- **A generated tree looks wrong**: never edit it; fix the source and rebuild.

Confirm which surfaces exist by listing the platform tree directories; a repo may
carry fewer platforms than the matrix documents.

## 2. Author Hooks Once, Adapt Per Platform

Keep all decision logic in the shared core module and let each platform entry point
adapt it to that host's calling convention. A platform with no hook surface simply
has no entry point — a supported state, not a gap to fill.

Build through the package's own scripts, never the CLI freehand; each platform
target carries its own required flags. The generated bundle is committed beside its
source.

**STOP** — Rebuild after every hook source edit. A source edit without a rebuild
ships the stale bundle silently, and a hand-edit of the bundle is destroyed by the
next build.

## 3. Author Skills Once, Vary Per Platform

Templates render per platform through a variant helper mapping each platform key to
a value. Mapping a platform to `null` drops the surrounding block entirely — that is
how a hook-less platform loses the hook section without a second copy of the file.

- **Prose identical everywhere**: write it plainly; no variant needed.
- **A value differs per platform** (event name, config path): use the variant helper.
- **A section is inapplicable to a platform**: map that platform to `null` and guard
  the block.

Run the skills linter before building. Diagnostics the project has deliberately
accepted live in the registry's lint baseline with a stated reason — add to it only
with an equally explicit reason, never to silence a real defect.

## 4. Keep Versions Consistent Across Every Surface

A plugin's version lives on one manifest per platform tree plus its marketplace
entry, and a commit gate requires all of them identical. The trap: the gate
enumerates trees independently of the scripts that *write* versions, so a newly
added tree goes unwritten until the gate rejects a release.

When adding a platform tree, update every enumeration in the same change — the
version fan-out script, the max-version scan in the bump script, the commit gate,
and the version test. Grep an existing tree's directory name to find them all;
counts stated in comments and prose ("three trees", "four surfaces") reliably mark
the ones still stale.

## 5. Rebuild and Validate

Run the repo's full validation. It rebuilds both bundlers, then fails if the rebuild
dirtied any committed tree — the only thing standing between a stale artifact and a
release.

- **Rebuild dirties a tree**: commit the regenerated output; do not revert it.
- **Validation surfaces an unrelated warning**: resolve it rather than deferring.

## 6. Smoke Test the Install Round

Rebuilding proves the trees are fresh; only installing proves a user can get them.
Run the round in `references/smoke-test.md` on [SMOKE_HOST].

**STOP** — Installing mutates real agent state on the host. Use a disposable
container unless the user accepts changes to their own agent configuration.

Verify per platform that the *installed* version matches what was published, not
merely that a command exited zero — several hosts report success while leaving a
stale version pinned.

One passing path per platform is not coverage. Most platforms ship through several
independent routes — a local directory, a git URL, an npm package — and they fail
independently: a packaging defect can break the npm route while the local-directory
route succeeds. Enumerate the routes each platform actually supports, then state
which you exercised and which you did not, rather than reporting the platform
itself as passing.

Installing is delivery, not function. Close the round with the behavioral checks in
`references/smoke-test.md`: fire each platform's hook against a real payload, and
have each CLI load and use the installed skill. Files on disk prove neither.

## 7. Validate

Confirm before finishing:
- No generated tree was hand-edited; every change entered through a template or hook source.
- Every platform tree, marketplace entry, and version-writing script agrees on one version.
- Full validation passed with the freshness gates green.
- The install round confirmed the intended version on each platform the plugin targets.

</instructions>
