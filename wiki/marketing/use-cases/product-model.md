---
title: Commercial Product Model
summary: The capabilities currently shipped in the open-source git-span product and the boundary between local tooling and external services.
aliases: [Product Tiering]
tags: [marketing, use-cases]
keywords: [community, team, enterprise, services, pricing, MIT, SCM integration, analytics]
---

# Product model

The repository is MIT-licensed and ships a local, repository-scoped span system.

## Community product

The current product provides:

- span storage and inspection;
- drift detection;
- line movement healing;
- CLI automation;
- Claude Code, Codex, OpenCode, and Antigravity integration;
- local hooks and CI;
- machine-readable output.

Span declarations, resolver state, and whys remain ordinary tracked repository data. Cross-repository graphs, hosted collaboration, organization policy, and browser workflows are outside the shipped product and must not be presented as current capabilities.

## Related

- [Boundaries and Risks](./boundaries-and-risks.md) — limits on product and marketing claims.
