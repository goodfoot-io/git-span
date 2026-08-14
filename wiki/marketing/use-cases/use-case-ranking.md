---
title: Use Case Ranking
summary: The ranked commercial use-case table for git-span — priority, buyer, and typical span content for all twelve candidates, with links to the detailed page for each ranked use case.
aliases: [Ranked Commercial Use Cases]
tags: [marketing, use-cases]
keywords: [ranking, priority, buyer, willingness to pay, span content]
---

# Use case ranking

This page is the single overview of all candidate commercial use cases. The ranking combines present product fit, severity of the underlying problem, buyer clarity, and potential willingness to pay. Rows link to the detailed page for each use case; the two later-market rows have no dedicated page yet.

| Priority | Commercial use case | Primary buyer | Typical span content |
|---|---|---|---|
| **Highest** | [Agent change assurance](./agent-change-assurance.md) and pull-request impact review | Head of Developer Platform, DevEx, AI Engineering | Touched implementation ↔ nonlocal dependents, authority, invariants, migration state, required verification |
| **Highest** | [Polyglot API, SDK, and protocol synchronization](./api-sdk-protocol-synchronization.md) | API platform lead, SDK engineering lead | Server serializer ↔ manually maintained SDK parsers, webhook implementations, protocol constants, error mappings |
| **High** | [Modernization, migration, and deprecation governance](./modernization-migration-governance.md) | CTO, enterprise architect, modernization program lead | Legacy path ↔ replacement path, dual-write rules, compatibility adapters, cutover gates, deprecation conditions |
| **High** | [Infrastructure and application contract synchronization](./infrastructure-contracts.md) | Platform engineering, SRE | Application configuration ↔ Helm/Terraform, health endpoint ↔ probe, metric emitter ↔ alert, migration ↔ ORM |
| **High** | [Post-incident institutional memory](./post-incident-institutional-memory.md) | VP Engineering, SRE, quality engineering, AppSec | Defect-producing regions ↔ related implementation, mitigation, verification, runbook |
| **High, governance-sensitive** | [Security and privacy invariant protection](./security-privacy-invariants.md) | AppSec, product security, privacy engineering | Authorization decision points, redaction paths, logging assumptions, data-retention controls |
| **Medium–high** | [Code, documentation, examples, and runbook consistency](./documentation-runbook-consistency.md) | DevEx, technical writing, SRE | CLI behavior ↔ docs, public API ↔ examples, operational command ↔ runbook |
| **Medium** | [Release, packaging, and distribution integrity](./release-packaging-integrity.md) | Release engineering | Version declarations, package wrappers, manifests, checksums, release scripts, marketplace metadata |
| **Medium–high, hosted product** | [Semantic architecture and implicit-debt mapping](./semantic-architecture-mapping.md) | Principal engineers, architecture teams | ADR ↔ implementation, mirrored business rules, designated sources of truth, intentionally duplicated behavior |
| **Later enterprise market** | [Regulated software traceability](./regulated-traceability.md) | Quality systems, systems engineering, safety engineering | Requirement or risk control ↔ implementation ↔ verification code and evidence |
| **Later vertical market** | Data and machine-learning semantic consistency | Data platform and ML platform teams | Metric definitions, SQL transformations, API fields, train/serve feature logic, model documentation |
| **Later, requires cross-repository support** | Embedded systems and product-variant synchronization | IoT, automotive, industrial, OEM platform teams | Firmware packet definitions ↔ cloud decoders ↔ mobile clients ↔ protocol documentation |

## Related

- [Commercial Market Position](./market-position.md) — the category and value model behind this ranking.
- [Recommended Beachhead](./beachhead.md) — which of these rows anchors the initial commercial offering.
