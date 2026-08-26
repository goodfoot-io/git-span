---
title: Agent Change Assurance
summary: The strongest horizontal commercial product — git-span's touch hook, commit advisor, and CI check as a change-assurance workflow for coding agents, the commercial extensions, and the measurable economic outcomes.
aliases: [Change Assurance, Pull Request Impact Review]
tags: [marketing, use-cases]
keywords: [agent, pull request, review, touch hook, commit advisor, CI, MCP]
links-reviewed: 1
---

# Agent change assurance

This is the strongest horizontal commercial product.

The buyer's problem is not that an agent cannot write the local edit. It is that the agent can produce a locally plausible change before discovering all of the nonlocal evidence needed to finish it. Git-span's current touch hook ([`touch-core.ts`](/packages/agent-hooks/src/common/touch-core.ts#L3-L16)), commit advisor ([`advisor-core.ts`](/packages/agent-hooks/src/common/advisor-core.ts#L1-L24)), and CI check ([`ci.yml`](/.github/workflows/ci.yml#L137-L140)) already form the outline of a change-assurance workflow:

1. The agent touches a protected region.
2. Git-span surfaces the connected regions and the relevant nonlocal fact.
3. The agent can inspect and update those regions.
4. Before commit, unresolved drift is surfaced.
5. CI catches debt created outside a hooked agent session.

A commercial version would generalize this beyond local plugins:

- GitHub and GitLab pull-request checks
- comments showing affected spans and unresolved anchors
- agent-independent delivery through MCP and supported hook systems
- required review by the owner of a high-risk span
- policies that are stricter for autonomous or agent-authored changes
- organization-level reporting on which obligations were triggered, reviewed, corrected, or bypassed

The economic outcomes are measurable:

- fewer partial agent changes
- fewer reviewer comments of the form "you also need to update…"
- fewer agent retries after integration tests fail
- lower review burden on staff engineers
- fewer regressions that escape because only one side of a contract changed

This should be sold as **assurance around the agents a company already uses**, not as another coding agent.

## Related

- [Use Case Ranking](./use-case-ranking.md) — where this ranks against the other candidates.
- [API SDK and Protocol Synchronization](./api-sdk-protocol-synchronization.md) — the beachhead segment this product would serve first.
- [Commercial Product Model](./product-model.md) — the team-product features that realize this use case.
