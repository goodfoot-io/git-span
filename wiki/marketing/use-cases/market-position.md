---
title: Commercial Market Position
summary: Git-span's commercial category — semantic change assurance — the value model for a span, the distinction from enforceable mechanisms, the competitive landscape table, and the 2026 research supporting event-conditioned context.
aliases: [Market Position, Commercial Category]
tags: [marketing, use-cases]
keywords: [category, value model, competition, Nx, Sonargraph, CodeScene, Sourcegraph, Swimm, Jama]
---

# Commercial market position

This page defines the commercial category git-span occupies and where that category sits relative to adjacent products. The per-use-case economics in [Use Case Ranking](./use-case-ranking.md) build on the value model defined here.

## Executive assessment

Git-span has a credible commercial category, but it is not "documentation for coding agents." The stronger category is:

> **Semantic change assurance: a Git-native registry of change obligations that the compiler, type system, build graph, schema, generator, and test suite do not enforce.**

A span records that exact regions of a repository participate in the same obligation, adds the nonlocal fact needed to reason about them, hashes the anchored content, and stores the declaration alongside the code. The current implementation can surface this information when an agent reads or edits a connected region, advise before commit or push, trace a span's blast radius and history, and report drift in CI.

The economically useful unit is not "a relationship between files." It is:

> **A frequently encountered, easily missed, economically consequential obligation between code regions.**

A rough value model is:

**Value of a span ≈ change frequency × probability of omission × cost of the escaped omission − maintenance cost**

That immediately excludes many apparent use cases. Where a relationship can be enforced through a shared type, schema, generated client, import, deterministic architecture rule, or test, that mechanism is preferable. Git-span's own guidance makes the same distinction: the eligibility clause declares a span as anchors "coupled by nothing a schema, type, test, or build/generator step enforces" ([`concepts.mdx`](/packages/website/content/docs/concepts.mdx#L8-L8)) — spans are for couplings that remain after enforceable and incidental relationships are filtered out.

## Where git-span fits in the market

Git-span occupies a useful gap between several established categories.

| Adjacent category | What existing products know | The remaining gap git-span can occupy |
|---|---|---|
| **Build and dependency graphs** | Nx, for example, uses Git changes and a project graph to determine affected projects and tasks.  | The relationship is visible only when it appears in imports, project configuration, or another machine-readable graph. Git-span can record a semantic obligation between exact regions that the graph cannot see. |
| **Architecture and static-analysis rules** | Sonargraph and similar products define and enforce machine-readable architectural constraints.  | Some rules are contextual rather than syntactic: two implementations must preserve equivalent behavior, a temporary migration rule applies, or one implementation is authoritative only under a stated condition. |
| **Historical change coupling** | CodeScene infers files that normally change together and warns when an expected co-change is absent. The warning is probabilistic and may represent an omission or a legitimate design change.  | Git-span turns a confirmed pattern into an explicit, named, line-level declaration with authority and intent. CodeScene-like analysis is a natural discovery input; git-span is the curated operational record. |
| **Code search and intelligence** | Sourcegraph supplies semantic, historical, architectural, and cross-repository context to developers and agents.  | Search answers a question when someone asks it. A span persistently records a specific answer and delivers it automatically when the relevant bytes are touched. |
| **Code-coupled documentation and modernization** | Swimm historically coupled documentation snippets to code and now sells agentic context and modernization services based on deterministic analysis, AI, and expert knowledge capture.  | Git-span is a lower-level, open, Git-native primitive that can connect code to code, configuration, documentation, tests, scripts, and migration state without requiring a proprietary documentation format. |
| **Requirements traceability** | Jama Connect maintains lifecycle links, flags downstream artifacts as suspect after upstream changes, detects missing coverage, and performs multi-degree impact analysis.  | Git-span could provide the developer-native, exact-code-region portion of such a traceability chain. It is substantially lighter, but currently lacks the formal workflow and controls required for regulated use. |
| **Repository instruction files** | `AGENTS.md`, `CLAUDE.md`, and rules files supply repository-, directory-, or glob-scoped instructions. | Git-span supplies narrower, event-conditioned context attached to exact regions, reducing the need to place every instruction in every agent session. |

The commercial white space is therefore not "another dependency graph." It is:

> **An explicit graph of unenforced obligations, maintained in Git and activated during change.**

That distinction is increasingly relevant to coding agents. A February 2026 study found repository-level context files generally reduced task success while increasing inference cost by more than 20%. A June 2026 study found that exact source carried substantially more actionable information than natural-language summaries. Separately, a July 2026 study of an evidence-conditioned execution layer reported Pass@1 gains of 4.8–11.8 percentage points by postponing edits or submissions until relevant repository evidence had been observed. These studies support precise, event-conditioned context and intervention as a product direction, but they do **not** establish that git-span itself improves outcomes.

## Related

- [Use Case Ranking](./use-case-ranking.md) — the ranked table that turns this category into purchasable outcomes.
- [Boundaries and Risks](./boundaries-and-risks.md) — the constraints on commercial claims, including the efficacy-evidence gap.
