---
title: Wiki Organization
summary: Current page membership, placement, documentation modes, source-link discipline, and validation for this repository's wiki.
tags: [meta, wiki]
links-reviewed: 1
---

# Wiki organization

A Markdown file is a wiki page when its frontmatter contains non-empty `title` and `summary` fields. Page membership is independent of location: cross-cutting pages live under `wiki/`, while a component-specific page may live beside its source. The current central corpus uses:

- `wiki/architecture/` for explanations of cross-cutting system design;
- `wiki/guides/` for procedures and operating guidance;
- `wiki/meta/` for repository-wide documentation reference;
- `wiki/marketing/use-cases/` for current product positioning and usage boundaries.

Tutorials stay in package READMEs, code, and JSDoc. Ephemeral investigations, completion reports, and plans are not live wiki pages.

## Placement and scope

Centralize a page under `wiki/` when it synthesizes several packages or when readers cannot know which component owns the subject. Place a page beside one component when that component alone owns its design or operating contract. Frontmatter makes either location searchable.

A wiki page should explain why a relationship exists or how several components connect. Single-function detail belongs in JSDoc; a package's local API belongs in its README; an unanchorable essay does not belong in the wiki.

## Source links

Named functions, types, schemas, constants, and modules link to their definitions. Load-bearing claims use line-range fragments so `wiki check` can detect drift. A page with fragment links carries `links-reviewed`; change that value only after reviewing every flagged link and conforming the prose to current source behavior.

## Mode separation

Each page has one primary mode: explanation, how-to, or reference. A small component page may separate modes with explicit H2 sections, but independently searched subjects belong in separate pages. A directory with several leaves may add a hub that orients readers and links to those leaves without duplicating their detail.

## Validation

Run `wiki "query"` before adding a page to find the current home and avoid title or alias collisions. After editing, run:

```bash
wiki check --fix
wiki check
```

`--fix` handles mechanical link movement. Any skipped link requires review of the cited source and surrounding prose before `links-reviewed` changes. Every warning and failure must be resolved.
