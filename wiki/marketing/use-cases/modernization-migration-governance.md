---
title: Modernization Migration and Deprecation Governance
summary: Modernization creates temporary couplings valid only during a lifecycle state — dual writes, cutover gates, deprecation thresholds — which the why format's authority, permitted-difference, lifecycle, and evidence-gate vocabulary is built to express.
aliases: [Migration Governance, Deprecation Governance]
tags: [marketing, use-cases]
keywords: [modernization, migration, deprecation, dual write, cutover, lifecycle, evidence gate]
---

# Modernization migration and deprecation governance

Modernization creates temporary couplings that are especially dangerous because they are valid only during a particular lifecycle state.

Examples:

- old and new services must produce equivalent output until cutover;
- writes must be mirrored until a backfill completes;
- a compatibility adapter remains authoritative for older clients;
- a feature flag controls which implementation owns a decision;
- a deprecated field remains populated until a measured usage threshold is reached;
- a migration may proceed only after a test, reconciliation, or operational gate passes.

Git-span's `why` format explicitly accommodates authority, permitted differences, lifecycle state, and evidence gates ([`concepts.mdx`](/packages/website/content/docs/concepts.mdx#L21-L21)). That makes it unusually well suited to transitional architecture rather than only permanent architecture.

This use case can produce both software and services revenue:

- a modernization assessment that mines candidate couplings;
- expert review that determines authority and migration state;
- a migration workspace showing drift, ownership, and affected systems;
- agent-assisted execution against the approved span graph;
- an evidence package showing how transitional obligations were resolved or retired.

Swimm's current positioning around agentic modernization, deterministic dependency analysis, expert knowledge capture, and staged engagements provides direct market evidence that enterprises will purchase this general outcome.

The limitation is that large modernization programs are commonly cross-repository. Repository-local spans are enough for monorepos and bounded pilots, but cross-repository declarations would be necessary for this to become a major enterprise offering.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Semantic Architecture and Implicit Debt Mapping](./semantic-architecture-mapping.md) — spotting migration spans that have outlived their intended lifetime.
- [Boundaries and Risks](./boundaries-and-risks.md) — the cross-repository constraint this use case runs into.
