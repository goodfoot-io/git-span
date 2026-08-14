---
title: Post Incident Institutional Memory
summary: Record a hidden obligation as a span whenever an incident, failed deployment, regression, or review comment reveals one — the adoption mechanism that turns span maintenance into a compounding incident-prevention system.
aliases: [Institutional Memory]
tags: [marketing, use-cases]
keywords: [incident, regression, review, organizational memory, Semgrep, adoption]
---

# Post incident institutional memory

This may be the best adoption mechanism across every use case.

Trying to document every implicit dependency in an existing repository is too expensive and will create low-quality spans. Instead:

> Whenever an incident, failed deployment, regression, or review comment reveals a previously hidden obligation, record that obligation as a span.

Examples:

- "Changing this timeout also requires changing the proxy timeout."
- "This serializer and the historical replay reader must interpret the field identically."
- "When this authorization path changes, the audit event must change with it."
- "This release manifest and this platform package must use the same artifact name."

The commercial promise becomes:

> **Learn the relationship once; do not require every future developer and agent to rediscover it.**

Semgrep has validated a closely related commercial pattern in security: it converts human triage decisions into scoped, reusable organizational memories and reports how often each memory affects future decisions.

A git-span control plane could similarly show:

- which incident or review introduced a span;
- how often the span was subsequently activated;
- how often it caused additional files to be inspected or changed;
- whether it prevented drift before merge;
- when it became obsolete and was retired.

This turns span maintenance from speculative documentation into a compounding incident-prevention system.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Commercial Pilot](./commercial-pilot.md) — mining incidents and review comments is step two of the pilot.
- [Security and Privacy Invariants](./security-privacy-invariants.md) — the adjacent buyer whose post-incident memories become security spans.
