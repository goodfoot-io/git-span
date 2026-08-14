---
title: Commercial Product Model
summary: The open-source community product, the team product's six paid capabilities, enterprise differentiation, and the services portfolio that generates early revenue before the hosted product is mature.
aliases: [Product Tiering]
tags: [marketing, use-cases]
keywords: [community, team, enterprise, services, pricing, MIT, SCM integration, analytics]
---

# Commercial product model

The repository is MIT-licensed, so the natural model is an open-source local primitive with paid collaboration, governance, and enterprise workflow around it.

## Community product

Keep these capabilities free and local:

- span storage and inspection;
- drift detection;
- line movement healing;
- CLI automation;
- basic Claude Code and Codex integration;
- local hooks and CI;
- machine-readable output.

This maximizes adoption and makes the span format a potential standard.

## Team product

The first paid product should provide:

1. **GitHub and GitLab application** — pull-request impact summaries, span drift checks, related locations, and review comments.
2. **Agent-independent context delivery** — hooks and MCP integrations for the major coding agents, rather than making the buyer standardize on one agent.
3. **Shared graph and browser** — search, visualization, ownership, history, impact traversal, and review state.
4. **Span discovery suggestions** — candidate spans inferred from co-change history, repeated review comments, incident reports, semantic similarity, and agent behavior, always requiring human confirmation.
5. **Operational analytics** — activations, corrections before commit, drift age, bypasses, retired spans, and outcomes attributable to particular spans.
6. **Policies and ownership** — criticality, owners, required reviewers, allowed editors, acknowledgement, and expiry dates.

## Enterprise product

Enterprise differentiation would come from:

- cross-repository spans;
- organization-wide graphs;
- SSO and role-based access control;
- audit logs;
- signed or protected spans;
- data residency and on-premises deployment;
- integrations with ticketing, incident, requirements, and architecture systems;
- product variants and branch-aware baselines;
- support and rollout services.

## Services

Services can generate early revenue before the hosted product is mature:

- **Implicit-dependency audit:** mine Git history and review records, then validate the highest-risk candidates.
- **Agent-readiness assessment:** identify the tacit knowledge that agents need but broad repository instructions cannot safely encode.
- **Modernization mapping:** declare old/new relationships, authority, lifecycle state, and cutover gates.
- **Post-incident memory rollout:** convert a backlog of incidents and regressions into curated spans.
- **Traceability bridge:** link exact implementation regions to an existing requirements-management system.

The service should produce durable span assets that remain useful after the engagement, rather than a one-time report.

## Related

- [Recommended Beachhead](./beachhead.md) — which segment buys the team product first.
- [Commercial Pilot](./commercial-pilot.md) — how to validate the team product's value before building it all.
