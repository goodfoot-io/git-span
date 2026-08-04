---
title: Git Span Documentation Touchpoints
summary: Canonical map of git-span CLI implementation, operator instructions, and maintenance references that must stay aligned when git-span documentation behavior changes.
tags:
  - meta
  - git-span
  - tooling
---

This page is the maintenance map for future git-span documentation updates. When command behavior or recommended usage changes, update the implementation-facing source of truth first, then walk the operator-facing documents and automation references listed here so guidance does not drift.

For the broader rules governing wiki pages, see [[Wiki Organization]].

`plugins-claude/` is the **normative** plugin tree; `plugins-codex/` mirrors it. Edit the
Claude side first, then copy across — and name that direction in the `why` of any span
anchoring both trees.

## Command Behavior Source Of Truth

The primary source of truth for top-level CLI behavior is the Clap configuration in [packages/git-span/src/cli/mod.rs](/packages/git-span/src/cli/mod.rs#L40-L195). That block defines the `Cli` struct, the `Commands` enum, and the help text for every subcommand. The [dispatch function](/packages/git-span/src/cli/mod.rs#L437-L501) in the same file routes parsed commands to their handlers.

The pre-classification logic that makes `git span <name>` route to `Commands::Show` rather than failing as an unknown subcommand lives in [packages/git-span/src/main.rs](/packages/git-span/src/main.rs#L49-L100). That block is what resolves the ambiguity between a span name positional and a subcommand name before Clap parses the arguments. The reserved subcommand set it checks against is defined in [packages/git-span/src/validation.rs](/packages/git-span/src/validation.rs#L7-L28).

When documentation changes are about subcommand behavior or exit-code semantics, the relevant handler implementations live under `packages/git-span/src/cli/` (e.g., `drift_output.rs`, `commit.rs`, `show.rs`).

## Operator-Facing Documentation

These files are the public guidance surfaces most likely to drift when the CLI contract changes:

- The [README CLI section](/README.md#L18-L55) is the reader-facing quick reference for common command shapes, exit code semantics, and `--format` placeholders.
- The [website's agent integration doc](/packages/website/content/docs/agent-integration.mdx) is where agent-facing git-span workflow guidance lives — what the touch hook and advisor do, and how a held command gets resolved.
- The [git-span skill](/plugins-claude/git-span/skills/git-span/SKILL.md), bundled with the `git-span` plugin and tracked in this repo, is the highest-leverage agent workflow contract for creating, updating, and querying spans. Its [finding-span-candidates reference](/plugins-claude/git-span/skills/git-span/references/finding-span-candidates.md) (backed by `scripts/mine.mjs`) is the topic within that same skill that guides agents through identifying and recording implicit semantic dependencies — coupling that has no schema or test enforcement.
- The [man page](/packages/git-span/man/git-span.1) is the installed reference for the CLI. It is generated from the Clap config; changes to command signatures surface here automatically on the next build, but prose descriptions require manual attention.

If a documentation update changes the recommended operator workflow, all of these surfaces should be checked explicitly, not only the page that first exposed the inconsistency.

## What A Good Why Is

[[Writing Span Whys]] is the canonical definition of a span `why` — the long, medium, and short forms, the good/bad examples, and the reasoning behind the rules. Change that page first when the recommended convention moves, then walk every surface that restates the definition in its own register:

- Clap help text in [packages/git-span/src/cli/mod.rs](/packages/git-span/src/cli/mod.rs) — the top-level `after_help`, the `Commands::Why` doc comment, and the `WhyArgs` field docs.
- The hand-authored `Writing the why` section in [packages/git-span/src/bin/gen-manpage.rs](/packages/git-span/src/bin/gen-manpage.rs), which generates the man page (`yarn build:man`) — never edit `man/git-span.1` directly.
- The `Declare a new coupling` recipe in the git-span skill and the `<one sentence>` placeholder in the reconcile skill, in **both** plugin trees (`plugins-claude/` and `plugins-codex/`).
- The `Why-writing discipline` section of `git-span/agents/expert.md`, kept byte-identical across both plugin trees.
- The positional why text placeholder rendered by the advisor hook's uncovered-writes reason in [packages/agent-hooks/src/common/advisor-core.ts](/packages/agent-hooks/src/common/advisor-core.ts). That string is quoted verbatim by the `agent-hooks/hook-message-copy` span's doc mirrors — reword it, run `yarn build` in `packages/agent-hooks`, and update every mirror byte-for-byte.
- The `why`-writing line in [.claude/rules/wiki.md](/.claude/rules/wiki.md).

## What A Span Is (Eligibility)

The canonical span definition — "coupled by nothing a schema, type, test, or build/generator
step enforces" — excludes generated/build output; span its inputs instead. Reference
surfaces state the exclusion as a category list (compiled artifacts, generated images,
lockfiles, the man page); agent surfaces state it as a test (does a script or generator
write this path, with nobody hand-editing it?). Both registers are current. The clause must
move as one unit across:

- [packages/git-span/README.md](/packages/git-span/README.md#L3) opening sentence.
- [concepts.mdx](/packages/website/content/docs/concepts.mdx) `## Span` section.
- Both `SKILL.md` frontmatter `description` and the `Core gotchas` bullet, in **both**
  plugin trees (`plugins-claude/` and `plugins-codex/`).
- [finding-span-candidates.md](/plugins-claude/git-span/skills/git-span/references/finding-span-candidates.md),
  in both plugin trees.
- Clap `after_help` in [cli/mod.rs](/packages/git-span/src/cli/mod.rs#L46-L46).
- `DESCRIPTION_SECTION` in [gen-manpage.rs](/packages/git-span/src/bin/gen-manpage.rs) —
  run `yarn build:man` after, never edit `man/git-span.1` directly.

## What Belongs In One Span

The eligibility clause above governs which anchors are *in scope*. This section governs
which anchors belong *together*. These rules live only on surfaces that walk someone
through authoring a span — the agent skills plus the website mining guide. The reference
surfaces (README, concepts, Clap help, man page) deliberately do not restate them; adding
them there grows the mirror set for no gain.

- `Core gotchas` in both `SKILL.md` files — the build-output test, the mirror-bundle rule,
  and the single-file rule — plus the silent-break test opening the `Declare a new
  coupling` recipe, in **both** plugin trees.
- The `Merging pairs into one span needs distinct roles` heuristic in
  [finding-span-candidates.md](/plugins-claude/git-span/skills/git-span/references/finding-span-candidates.md),
  in both plugin trees.
- The `Distinct roles across the set` and `Duplicated content needs a named source of
  truth` bullets in [git-span/agents/expert.md](/plugins-claude/git-span/agents/expert.md),
  kept byte-identical across both trees.
- The `generated-output`, `mirror-bundle`, `single-file`, and `open-set registry` triage
  rows in
  [why-cleanup-campaign.md](/plugins-claude/git-span/skills/git-span/references/why-cleanup-campaign.md),
  in both plugin trees.
- The already-visible filter bullets and the growth question in
  [mine-span-candidates.mdx](/packages/website/content/docs/guides/mine-span-candidates.mdx).
- Step 3 of [.claude/rules/wiki.md](/.claude/rules/wiki.md) — consolidate created spans per
  coupling, never per source file.

Three constraints bind future edits to this set. The `open-set registry` row is
**advisory** — it flags for human review and must never become an auto-reject. No surface
may carry an anchor-count threshold: breadth tracks how broad a mechanism is, and
verified-good spans reach every layer they govern. And no surface may tell an agent to
anchor a directory — `add` rejects one with `error: Is a directory (os error 21)`. Only
submodule roots take a bare *directory* path; a bare path on a file is the ordinary
whole-file anchor.

## Update Order

When git-span CLI behavior or documentation changes, use this order:

1. Confirm the implementation in [packages/git-span/src/cli/mod.rs](/packages/git-span/src/cli/mod.rs#L40-L193) (Clap config and Commands enum) and [packages/git-span/src/main.rs](/packages/git-span/src/main.rs#L49-L100) (pre-classification and dispatch).
2. Update the primary user docs in [README.md](/README.md#L18-L55) and the [website's agent integration doc](/packages/website/content/docs/agent-integration.mdx).
3. Update the agent workflow contract in the [git-span skill](/plugins-claude/git-span/skills/git-span/SKILL.md).
4. Update secondary references such as the finding-span-candidates section and the man page.
5. If the change moves what a good `why` is, update [[Writing Span Whys]] first, then walk the "What A Good Why Is" list above.
6. If the change moves which anchors belong together, walk the "What Belongs In One Span" list above — every entry, both plugin trees.
7. Run `wiki check` on the touched pages so fragment links validate and the page participates in `wiki stale`.

## References

- [CLI mod](/packages/git-span/src/cli/mod.rs#L1-L32)
- [main.rs dispatch](/packages/git-span/src/main.rs#L49-L100)
- [validation.rs reserved names](/packages/git-span/src/validation.rs#L7-L28)
