---
title: Git Span Documentation Touchpoints
summary: Sources, mirrors, generated artifacts, and checks for git-span guidance changes.
tags: [meta, git-span, tooling]
---

# Git span documentation touchpoints

Update the authoritative source, then its consumers. See [[Wiki Organization]] and
[[Writing Span Whys]].

## Ownership

- **Why policy:** [[Writing Span Whys]].
- **CLI behavior:** Clap declarations and handlers.
- **Hook text:** shared TypeScript hook cores.
- **Generated:** man page and hook bundles; regenerate, never patch.
- **Plugins:** `plugins-claude/` is normative; mirror to `plugins-codex/` while preserving
  harness-specific sections.
- **Historical research:** preserve outcomes. Change only live instructions or specs.

For a span joining plugin trees, name the Claude-to-Codex direction in its why.

## CLI sources

- Clap commands and help: [cli/mod.rs](/packages/git-span/src/cli/mod.rs).
- Bare-name pre-classification: [main.rs](/packages/git-span/src/main.rs#L49-L100).
- Reserved names: [validation.rs](/packages/git-span/src/validation.rs#L7-L28).
- Command behavior and exits: `packages/git-span/src/cli/`, especially `commit.rs`,
  `drift_output.rs`, and `show.rs`.
- Man-page source: [gen-manpage.rs](/packages/git-span/src/bin/gen-manpage.rs).
- Generated man page: [git-span.1](/packages/git-span/man/git-span.1). Regenerate from
  `packages/git-span` with `yarn build:man`.

## Why policy

Use one or two complete present-tense clauses for the relationship and any decisive
nonlocal authority, invariant, permitted difference, lifecycle state, evidence gate, or
focused conditional verification. Labels are optional but must introduce complete
clauses. Omit generic work orders and CLI procedure.

Inherit a why only while it remains true. A satisfied gate authorizes its transition;
update or retire the why, reconcile or retire superseded anchors, and require scoped drift
to be zero. Do not restore superseded rules such as “one subsystem-definition sentence,”
“never use labels,” or “put all invariants in comments.”

### CLI and package surfaces

- `after_help`, `Commands::Why`, and `WhyArgs` in [cli/mod.rs](/packages/git-span/src/cli/mod.rs).
- Description, why-writing, lifecycle, and examples in
  [gen-manpage.rs](/packages/git-span/src/bin/gen-manpage.rs).
- [packages/git-span/README.md](/packages/git-span/README.md#L3).
- Root [README.md](/README.md#L18-L55).

### Agent load paths

Update Claude first, then Codex. Files likely loaded together should divide responsibility:
the core skill owns shared rules; the expert and routed references add only branch-specific
judgment. Claude and Codex router branches may differ by harness.

- Core recipes and routing: `plugins-{claude,codex}/git-span/skills/git-span/SKILL.md`.
- Judgment loaded with the core skill: `plugins-{claude,codex}/git-span/agents/expert.md`.
- Multi-span branch: `plugins-{claude,codex}/git-span/skills/reconcile/SKILL.md`.
- Cleanup branch: `plugins-{claude,codex}/git-span/skills/git-span/references/why-cleanup-campaign.md`.
- Deleted-anchor branch: `.../references/terminal-statuses.md`.
- Why lifecycle caveats: `.../references/command-quirks-and-errors.md`.
- Candidate declaration handoff: `.../references/finding-span-candidates.md`.
- Hook examples and copied text: `.../references/understanding-hook-output.md`.
- Wiki-created spans: [.claude/rules/wiki.md](/.claude/rules/wiki.md).

### Website and marketing

- Definitions: [concepts.mdx](/packages/website/content/docs/concepts.mdx).
- Command: [commands.mdx](/packages/website/content/docs/commands.mdx).
- Introduction: [overview.mdx](/packages/website/content/docs/overview.mdx).
- Hooks: [agent-integration.mdx](/packages/website/content/docs/agent-integration.mdx).
- Creation: [mine-span-candidates.mdx](/packages/website/content/docs/guides/mine-span-candidates.mdx).
- Replacement and lifecycle: [re-anchor-after-an-edit.mdx](/packages/website/content/docs/guides/re-anchor-after-an-edit.mdx).
- Recovery: [reconcile-drifted-spans.mdx](/packages/website/content/docs/guides/reconcile-drifted-spans.mdx).
- Homepage specimens: [specimens.ts](/packages/website/app/components/marketing/story/specimens.ts).
  Its declaration and hook-output whys are intentionally identical and hard-wrapped.
- Homepage copy: [copy.ts](/packages/website/app/components/marketing/story/copy.ts).

### Metadata

- [.claude-plugin/marketplace.json](/.claude-plugin/marketplace.json)
- [Claude manifest](/plugins-claude/git-span/.claude-plugin/plugin.json)
- [Codex manifest](/plugins-codex/git-span/.codex-plugin/plugin.json)

### Live reports

These ignored files still instruct production work:

- [span-creation.md](/reports/span-creation.md)
- [span-corpus-cleanup.md](/reports/span-corpus-cleanup.md)
- [unified-homepage.md](/reports/unified-homepage.md)
- [span-authoring-rules.md](/reports/span-authoring-rules.md)
- [website-guide.md](/reports/website-guide.md)
- [animation-guide.md](/reports/animation-guide.md)

Preserve measured claims. Update live instructions or mark the report superseded.

## Hook messages

Authoritative source and tests:

- [advisor-core.ts](/packages/agent-hooks/src/common/advisor-core.ts)
- [touch-core.ts](/packages/agent-hooks/src/common/touch-core.ts)
- [advisor-core.test.ts](/packages/agent-hooks/test/common/advisor-core.test.ts)
- [touch-core.test.ts](/packages/agent-hooks/test/common/touch-core.test.ts)
- Adapter tests under `packages/agent-hooks/test/{claude,codex}/`

Run `yarn build` in `packages/agent-hooks` to regenerate:

- `plugins-claude/git-span/hooks/bin/{advisor,post-tool-use}.mjs`
- `plugins-claude/git-span/hooks/hooks.json`
- `plugins-codex/git-span/hooks/{advisor,post-tool-use}.mjs`
- `plugins-codex/git-span/hooks/hooks.json`

Keep text marked verbatim exact in the website integration page and both
`understanding-hook-output.md` files. Reconciliation text must say:

- refresh the exact anchor when identity is unchanged — whole-file stays whole-file and a range keeps its exact boundaries;
- remove the old anchor before adding a changed path or range;
- update or retire a stale why; and
- require scoped zero drift.

## Span eligibility and grouping

The eligibility clause is: anchors are “coupled by nothing a schema, type, test, or
build/generator step enforces.” Exclude generated output; span its inputs. Keep it aligned
in the package README, website concepts, both core skills and candidate references, Clap
`after_help`, and the man-page description.

Grouping guidance lives in both core skills, experts, candidate references, cleanup
references, website mining guide, and `.claude/rules/wiki.md`. Preserve these rules:

- one silent-break relationship per span;
- generated output is excluded;
- directed mirrors name an authority;
- single-file spans need a nonlocal relationship;
- anchors have distinct roles; and
- open-set registries are reviewed, not automatically rejected.

Never impose an anchor-count limit. Do not instruct agents to anchor directories; only
submodule roots accept a bare directory path.

## Reconciliation

Relevant declarations include:

- `agent-hooks/hook-message-copy`
- `git-span-touchpoints/cli-config`
- `git-span/span-eligibility-clause`
- `git-span/plugin-twin-guidance`
- `website/specimen-hardwrap-coupling`
- `wiki/meta/command-behavior-source-of-truth`
- `wiki/meta/operator-facing-documentation`
- `wiki/meta/update-order`
- `wiki/meta/references`

Inspect with `git span`, not raw `.span/**` parsing. Refresh the exact existing anchor when
its identity is unchanged. If identity changes, remove the old address before adding the
new one. Require zero drift.

## Update sequence

1. Update [[Writing Span Whys]] and this map.
2. Update CLI and hook sources plus exact-string tests.
3. Update Claude agent instructions; mirror Codex without erasing harness differences.
4. Update READMEs, website, marketing, metadata, and live instructional reports.
5. Regenerate man and hook artifacts.
6. Validate changed packages.
7. Reconcile affected spans and run wiki checks.
8. Run root `yarn validate` and require zero drift.

For CLI-only changes, inspect Clap, pre-classification, validation, and the handler, then
walk affected surfaces. For grouping changes, walk every grouping surface above.

## Validation

From `packages/git-span` after Rust or man-source changes:

```bash
yarn build:man
yarn lint
yarn typecheck
yarn test
```

From `packages/agent-hooks` after source or message changes:

```bash
yarn test test/common/advisor-core.test.ts test/common/touch-core.test.ts
yarn lint
yarn typecheck
yarn build
```

Include adapter tests when rendered output changes. From `packages/website` after
TypeScript changes, run `yarn lint`, `yarn typecheck`, `yarn test`, and `yarn build`.

Run `wiki check` on touched wiki pages, then root `yarn validate`. Any warning, failure,
infrastructure error, generated diff, or nonzero drift blocks completion.

## References

- [Writing Span Whys](../guides/writing-span-whys.md)
- [Evaluating Span Whys](../guides/evaluating-span-whys.md)
