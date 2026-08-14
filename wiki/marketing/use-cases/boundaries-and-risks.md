---
title: Boundaries and Risks
summary: The constraints on git-span's commercial claims — hash drift is not correctness, authoring cost, span content as privileged agent input, cross-repository limits, the early UI surface, and the missing product-specific efficacy study.
aliases: [Commercial Risks]
tags: [marketing, use-cases]
keywords: [risks, boundaries, correctness, authoring cost, prompt injection, cross-repository, efficacy evidence]
---

# Boundaries and risks

These constraints shape both the product roadmap and what marketing may claim. Each one is a boundary the commercial narrative must respect until the product changes.

## Hash drift is not semantic correctness

Git-span detects that recorded content changed. It cannot determine whether the connected implementations still agree. Its documentation explicitly warns that re-anchoring can record a new baseline without resolving an underlying disagreement ([`concepts.mdx`](/packages/website/content/docs/concepts.mdx#L39-L39)).

Commercial messaging should therefore use "surface," "protect," "review," and "assure the change process," not "prove correctness."

## Authoring cost can overwhelm value

The product succeeds only when spans are high-signal. Automatically generating thousands of speculative spans would create a new form of alert fatigue. Automated discovery should rank candidates; humans or trusted agents should declare the obligation and authority.

## Span content becomes privileged agent input

Because a span's explanation is injected into an agent's context, malicious or poorly governed span text could influence agent behavior. This implies a need for authorship provenance, trust boundaries, protected spans, and potentially sanitization or structured fields in enterprise environments.

## Cross-repository support is strategically important

Sourcegraph, Swimm, and enterprise traceability platforms emphasize cross-repository or cross-tool understanding because many consequential relationships cross repository boundaries. Git-span's current repository-local model is appropriate for its first wedge but constrains modernization, microservice, embedded, and enterprise architecture use cases.

## The current UI and integration surface are early

The current VS Code extension is intentionally a lightweight binary and command manager ([`package.json`](/packages/extension/package.json#L1-L25)) and does not yet provide visualization, search, or a custom webview. Agent integrations currently focus on Claude Code and Codex, and Codex hooks are disabled on Windows ([`agent-integration.mdx`](/packages/website/content/docs/agent-integration.mdx#L118-L118)).

That is sufficient for technical pilots, but a commercial team product needs a repository-hosting and browser-based workflow that does not depend on every developer installing or trusting local hooks.

## Product-specific efficacy still needs evidence

The public website states that agents using git-span complete tasks faster and with fewer mistakes ([`copy.ts`](/packages/website/app/components/marketing/story/copy.ts#L134-L141)), but no published controlled evaluation supporting that product-specific claim exists on the public site or repository.

The 2026 context and evidence-gating research makes the hypothesis credible. It does not substitute for a git-span-specific study. Until that study is complete, the strongest marketing claims should focus on observable mechanics:

- the agent was shown a declared relationship;
- a touched anchor was detected;
- another affected location was surfaced;
- unresolved drift was identified before merge.

## Related

- [Commercial Market Position](./market-position.md) — the category definition these boundaries protect.
- [Commercial Pilot](./commercial-pilot.md) — the pilot that can close the evidence gap.
- [Regulated Traceability](./regulated-traceability.md) — the market excluded until several of these boundaries move.
