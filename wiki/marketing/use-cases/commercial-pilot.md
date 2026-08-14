---
title: Commercial Pilot
summary: A credible pilot design — one polyglot repository, 20–50 high-value spans mined from incidents and review comments, agent-time delivery plus CI reporting, and the success metrics that measure protected obligations.
aliases: [Pilot Design]
tags: [marketing, use-cases]
keywords: [pilot, evaluation, metrics, span mining, protected obligations, merge time]
---

# Commercial pilot

A credible pilot would avoid attempting to map an entire repository.

1. Select one active, polyglot repository with known partial-change failures.
2. Mine and validate approximately 20–50 high-value spans from:
   - previous incidents;
   - reverted pull requests;
   - integration failures;
   - "also update X" review comments;
   - co-change history.
3. Enable agent-time delivery and CI or pull-request reporting.
4. Compare protected tasks with historical or controlled unprotected tasks.
5. Measure:
   - missed companion changes;
   - span-triggered inspections and edits;
   - corrections before commit;
   - review comments concerning omitted files;
   - integration failures;
   - agent retries;
   - time to merge;
   - escaped defects;
   - mean age of unresolved drift.

Do **not** use raw span count or percentage of repository files covered as the principal success metric. Most files should not need spans. A commercial product should measure the number and value of **protected obligations**, not encourage teams to annotate the repository indiscriminately.

## Related

- [Recommended Beachhead](./beachhead.md) — the segment in which this pilot runs.
- [Post Incident Institutional Memory](./post-incident-institutional-memory.md) — the adoption loop the pilot exercises.
- [Boundaries and Risks](./boundaries-and-risks.md) — the authoring-cost risk that shapes the 20–50 span target.
