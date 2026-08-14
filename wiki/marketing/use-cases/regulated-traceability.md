---
title: Regulated Traceability
summary: The later enterprise market — requirement, risk-control, and verification links in medical, automotive, aerospace, and industrial development — what git-span would need before it is commercially credible there.
aliases: [Compliance Traceability]
tags: [marketing, use-cases]
keywords: [regulated, compliance, traceability, requirements, Jama, Polarion, baseline, audit]
---

# Regulated traceability

There is a plausible long-term enterprise use case in medical devices, automotive systems, aerospace, industrial control, and other regulated development:

- requirement ↔ design decision;
- risk control ↔ implementation;
- implementation ↔ verification test;
- safety requirement ↔ firmware and application regions;
- change request ↔ affected code and validation evidence.

The conceptual resemblance to requirements-management "suspect links" is strong: when one artifact changes, downstream artifacts are flagged for reassessment, and the decision is recorded. Jama Connect additionally provides required-link models, approvals, baselines, variant management, cross-tool integrations, and audit records.

Git-span is **not currently a compliance system**. To be commercially credible in this market it would need:

- typed relationships rather than only generic membership;
- external requirement and risk-control identifiers;
- bidirectional links into Jama, Polarion, Jira, Azure DevOps, or equivalent systems;
- approvals and electronic signatures where required;
- immutable baselines and formal change records;
- role-based access control;
- audit exports and qualification evidence;
- cross-repository and product-variant support.

The better strategy would initially be to integrate with requirements-management platforms and provide exact code-region traceability, rather than attempt to replace the broader ALM system.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Security and Privacy Invariants](./security-privacy-invariants.md) — the governance-sensitive use case that precedes this one commercially.
- [Boundaries and Risks](./boundaries-and-risks.md) — the cross-repository and workflow constraints that currently exclude this market.
