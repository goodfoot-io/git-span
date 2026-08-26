---
title: Infrastructure and Application Contracts
summary: Protection against operational half-changes — spans connecting application code to Helm, Terraform, probes, alerts, runbooks, and migrations, where production failures originate at the code-to-configuration boundary.
aliases: [Infrastructure Contracts, Operational Half Changes]
tags: [marketing, use-cases]
keywords: [infrastructure, SRE, Helm, Terraform, probe, alert, runbook, configuration, migration]
links-reviewed: 1
---

# Infrastructure and application contracts

A large class of production failures originates at the boundary between application code and operational configuration rather than between imported modules.

High-value spans could connect:

- an environment variable reader to its Helm chart and Terraform declaration;
- a health endpoint's behavior to Kubernetes liveness and readiness probes;
- a metric name and labels to alert rules and dashboards;
- an application port or path to ingress and service configuration;
- a database migration to the ORM model and data backfill;
- a feature flag to its default, rollout logic, and fallback behavior;
- a retention setting to purge jobs and compliance documentation;
- an operational script to the runbook that invokes it.

The git-span documentation itself identifies configuration defaults, call sites, SQL migrations, and ORM models as representative invisible couplings ([`overview.mdx`](/packages/website/content/docs/overview.mdx#L13-L14)).

This can be positioned as protection against **operational half-changes**: changes that compile and may pass unit tests but are incomplete at deployment or incident time.

The likely buyer is a platform or SRE organization, and the paid product would need support for YAML, Terraform, shell scripts, SQL, monitoring rules, and possibly Git-tracked dashboard definitions — not only conventional source code.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Post Incident Institutional Memory](./post-incident-institutional-memory.md) — the adoption loop this buyer is most likely to run.
