---
title: Documentation and Runbook Consistency
summary: Git-span as a minimal code-coupled documentation system without a new document format — API docs, CLI guides, runbooks, and agent instructions tied to the exact regions they describe.
aliases: [Runbook Consistency]
tags: [marketing, use-cases]
keywords: [documentation, runbook, docs drift, examples, ADR, migration guide]
links-reviewed: 2
---

# Documentation and runbook consistency

Git-span can serve as a minimal code-coupled documentation system without introducing a new document format.

Commercially useful examples include:

- public API implementation ↔ reference documentation;
- CLI flags ↔ installation guides and examples;
- configuration behavior ↔ deployment documentation;
- operational scripts ↔ runbooks;
- architectural decisions ↔ implementation sites;
- deprecation behavior ↔ migration guides;
- agent instructions ↔ the code regions to which they apply.

The repository's own corpus already declares spans of this shape — for example, [`content-unavailable/live-vs-dead-reasons`](/.span/docs/content-unavailable/live-vs-dead-reasons#L1-L2) joins the CLI's status vocabulary to the skill reference that documents each cause and fix.

This is likely a useful product-led adoption route because the problem is obvious and the setup is small. On its own, however, generic documentation drift probably has lower willingness to pay than agent assurance, production operations, migrations, or regulated traceability. It becomes commercially stronger when the documentation is itself operationally consequential: public API docs, customer integration examples, incident runbooks, or regulated evidence.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [Release and Packaging Integrity](./release-packaging-integrity.md) — the adjacent declaration-synchronization surface.
