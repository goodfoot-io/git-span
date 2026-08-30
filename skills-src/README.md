# skills-src — authored agent-skill templates

This directory is the single source of truth for every git-span agent skill.
The `skills/` subtrees under `plugins-claude/git-span`, `plugins-codex/git-span`,
`plugins-opencode/git-span`, and `plugins-antigravity/git-span` are **generated
build output** of this tree — committed for install-ability, never edited by
hand. Every rendered file carries a `Generated from skills-src/...` marker
naming the template it came from.

## How to change a skill

1. Edit the template here: `skills-src/git-span/<skill>/...`. Files ending in
   `.md.eta` are Eta templates (per-platform variance via `it.variant({...})`
   and friends — see the `agent-skills` skill's `reference/template-authoring.md`);
   everything else is copied verbatim into every platform tree.
2. Lint: `node scripts/lint-agent-skills.mjs` (portability diagnostics are
   compared against the `lintBaseline` in `scripts/agent-skills-plugins.json`,
   exact in both directions).
3. Build: `node scripts/build-agent-skills.mjs`. This renders all four platform
   trees, stamps each rendered file with its generated-from marker, and
   verifies from the CLI's own output that every declared target and skill was
   actually written.
4. Commit the template change and the rebuilt trees together. `scripts/validate.sh`
   and the release workflow both refuse a tree that does not rebuild
   byte-identical to what is committed.

## How to add a skill

1. Create `skills-src/git-span/<name>/SKILL.md.eta` (the entrypoint **must** be
   `.md.eta` — a plain `SKILL.md` is silently dropped by the renderer, and the
   build refuses the directory).
2. Declare the skill in the plugin's `skills` array in
   `scripts/agent-skills-plugins.json`. The build fails closed when the
   registry and this directory disagree in either direction; the release
   workflow's ship-completeness guards derive their skill list from that array.
3. Lint, build, commit — as above.

## Guardrails you will meet

- **Hand-edits to rendered trees are refused, not destroyed**: the build
  restores your bytes, fails, and names the template the edit belongs in.
- **One staleness gate, one gate-set definition**:
  `scripts/check-generated-tree-freshness.mjs` counts modified, untracked,
  and deleted paths in the rendered trees, and its failure text diagnoses
  *why* the trees are dirty — only genuine new render output is ever advised
  into a commit. Every caller reaches it through the shared gate list in
  `scripts/run-pipeline-gates.sh`, which `validate.sh`, PR CI (`ci.yml`),
  and the release workflow all execute — add or remove a gate there, never
  in a caller.
- **Host-facing vocabulary comes from one glossary**: tool names, skill
  dispatch syntax, and supported-host enumerations live in
  `scripts/agent-skills-vocabulary.mjs`. Templates consume it through a
  `/* BEGIN GENERATED VOCAB */ … /* END GENERATED VOCAB */` region kept in
  sync by `scripts/sync-skill-vocabulary.mjs` (its `--check` is part of the
  shared gate set in `scripts/run-pipeline-gates.sh`), and cross-platform
  references use
  `it.skillRef(...)`/`it.variant(...)` — never hand-written per-host prose. A
  rendered-tree control
  (`packages/agent-hooks/test/antigravity/skill-tree-vocabulary.test.ts`,
  mirroring the opencode one) fails if a tree re-learns a foreign host's
  vocabulary.
- A pre-commit check (`.githooks/pre-commit.generated-trees.sh`) rejects
  commits that stage rendered-tree changes without staging any build input.
- The wiki indexer ignores the rendered trees (`.wikiignore`); author docs
  against this directory, not the output.

## Related

- `scripts/agent-skills-plugins.json` — the plugin registry (targets, declared
  skills, platform dirs, lint baseline).
- `scripts/build-agent-skills.mjs` / `scripts/lint-agent-skills.mjs` — the
  drivers; `scripts/agent-skills-registry.mjs` — shared guards.
- Repository overview: [../README.md](../README.md) § Monorepo Layout.
