---
title: Security and Privacy Invariants
summary: The residue static analysis cannot reach — organization-specific authorization, tenant-isolation, redaction, retention, and signing assumptions recorded as spans, with the enterprise controls required to make security-owned spans credible.
aliases: [Security Invariants, Privacy Invariants]
tags: [marketing, use-cases]
keywords: [security, privacy, AppSec, authorization, redaction, retention, tenant isolation]
---

# Security and privacy invariants

Static analysis is highly effective where a security rule can be encoded syntactically. Git-span is useful for the residue: organization-specific assumptions and business-logic relationships that cannot be represented as a reliable static rule.

Examples include:

- an authorization bypass permitted only for one internal identity;
- several ingress paths that must apply equivalent tenant isolation;
- PII redaction in application logs, audit logs, and telemetry;
- a data-retention configuration linked to every deletion path;
- cryptographic or signing behavior mirrored across services;
- a security mitigation linked to the vulnerable implementation and regression test.

This is potentially high-value because omissions can be costly, but the enterprise requirements are substantial:

- security-owned spans and approval rules;
- protected or signed declarations;
- branch and repository trust policies;
- audit logs;
- restricted modification of security spans;
- explicit distinction between advisory context and enforced security controls.

Git-span should complement Semgrep, CodeQL, tests, and policy engines — not be presented as a replacement for them.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Regulated Traceability](./regulated-traceability.md) — the later enterprise market that extends these governance controls.
- [Post Incident Institutional Memory](./post-incident-institutional-memory.md) — the loop through which most security spans enter the corpus.
