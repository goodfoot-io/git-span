---
title: Semantic Architecture and Implicit Debt Mapping
summary: An organization-wide span graph as an explicit map of where architecture relies on manual coordination — blast radii, frequently drifting obligations, and spans that should be engineered away.
aliases: [Implicit Debt Mapping]
tags: [marketing, use-cases]
keywords: [architecture, implicit debt, blast radius, span graph, CodeScene, remediation]
links-reviewed: 1
---

# Semantic architecture and implicit debt mapping

An organization-wide span graph could become an explicit map of where the architecture relies on manual coordination.

Useful derived signals include:

- highly connected spans with large blast radii;
- frequently drifting obligations;
- relationships repeatedly repaired by the same experts;
- parts of the system with many declared sources of truth;
- spans that should be replaced by a schema, generator, shared library, or contract test;
- temporary migration spans that have exceeded their intended lifetime.

The current `git span tree` command ([`tree.rs`](/packages/git-span/src/cli/tree.rs#L1-L15)) already traces impact through span co-occurrence, while `history` ([`history.rs`](/packages/git-span/src/cli/history.rs#L1-L20)) preserves provenance.

This creates a second-order commercial use case:

> **Use spans not only to protect implicit dependencies, but also to identify which implicit dependencies should be engineered away.**

That would complement CodeScene's inferred change-coupling analysis. CodeScene can suggest that two areas often change together; git-span can add the declared reason, authority, lifecycle, and eventual remediation.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Modernization Migration and Deprecation Governance](./modernization-migration-governance.md) — the migration spans whose lifetimes this mapping audits.
