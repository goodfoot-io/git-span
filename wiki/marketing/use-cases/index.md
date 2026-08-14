---
title: Marketing Use Cases
summary: The commercial analysis of git-span — the semantic change assurance category, the ranked use cases with buyers and typical span content, the product model, beachhead, pilot design, and the boundaries that constrain commercial claims.
aliases: [Commercial Use Cases]
tags: [marketing, use-cases]
keywords: [commercial, category, use case, buyer, beachhead, pilot, product model, market]
---

# Marketing use cases

This section holds the repository's commercial analysis of git-span: what category the product occupies, which use cases justify payment and in what order, how the product should be packaged and sold, and which claims the current implementation cannot yet support. Each page covers one topic; [Use Case Ranking](./use-case-ranking.md) is the single overview of all twelve candidate use cases.

## Category and market

- [[Commercial Market Position]] — the category definition (semantic change assurance), the value model for a span, and where git-span sits relative to adjacent product categories.

## The ranked use cases

- [[Use Case Ranking]] — the full priority table: buyer, severity, willingness to pay.
- [[Agent Change Assurance]] — the strongest horizontal product: assurance around the agents a company already uses.
- [[API SDK and Protocol Synchronization]] — the best beachhead segment; the homepage's `page`-to-`cursor` example.
- [[Modernization Migration and Deprecation Governance]] — transitional couplings that are valid only during a lifecycle state.
- [[Infrastructure and Application Contracts]] — application code connected to Helm, Terraform, probes, alerts, and runbooks.
- [[Post Incident Institutional Memory]] — learn the relationship once; do not force every future developer to rediscover it.
- [[Security and Privacy Invariants]] — organization-specific assumptions that cannot be a reliable static rule.
- [[Documentation and Runbook Consistency]] — code-coupled documentation without a new document format.
- [[Release and Packaging Integrity]] — manually synchronized declarations in release engineering.
- [[Semantic Architecture and Implicit Debt Mapping]] — use spans to identify which implicit dependencies should be engineered away.
- [[Regulated Traceability]] — the later enterprise market; integration with requirements-management platforms.

## Go to market

- [[Commercial Product Model]] — community, team, enterprise, and services tiers.
- [[Recommended Beachhead]] — the initial customer profile and positioning statement.
- [[Commercial Pilot]] — a 20–50 span pilot design and the metrics that matter.

## Operating constraints

- [[Boundaries and Risks]] — hash drift is not correctness, authoring cost, span content as privileged agent input, cross-repository limits, the early UI surface, and the efficacy-evidence gap.

The original analysis this section was converted from is archived at [/reports/archive/use-cases.md](/reports/archive/use-cases.md).

## Bottom line

The highest-potential commercial sequence:

1. **Category:** semantic change assurance, or "change obligations as code."
2. **Initial product:** agent and pull-request assurance around the open-source CLI.
3. **Beachhead:** API, SDK, infrastructure, and developer-tool teams with polyglot repositories.
4. **Adoption loop:** turn incidents and repeated review knowledge into permanent, narrowly scoped spans.
5. **Paid layer:** SCM integration, shared graph, discovery suggestions, analytics, ownership, and policy.
6. **Enterprise expansion:** cross-repository modernization, security governance, regulated traceability, embedded systems, and product variants.

The durable opportunity is not the hash format or the line anchors themselves. It is the workflow for **capturing tacit engineering knowledge, delivering it at the moment of change, proving that it was considered, and keeping it current as the repository evolves**.
