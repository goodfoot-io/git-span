# Creating a span

## Should this be a span?

A span names an **implicit semantic dependency**: a coupling between anchors (line-range anchors or whole-file anchors), in code or prose, that is real, that the developer at one anchor needs to know about when touching the other, and that no schema, type, or test already enforces. The standing question at commit time: *did this change create or rely on a coupling that isn't visible from the lines themselves?*

Good candidates (a deliberate mix of code↔code, code↔prose, and prose↔prose):
- Request construction in a client and request parsing in a server
- A documented API request shape and the handwritten parser that honors it (`docs/api/charge.md` ↔ `api/charge.ts`)
- An ADR that governs a runtime assumption and the code that relies on it (`docs/adr/0017-uuidv4.md` ↔ `services/joiner/sort.ts`)
- A runbook step a responder follows under pressure and the alert handler that emits the alert
- A contract clause and the billing code that performs against it
- A threat-model item and the control doc that mitigates it (`docs/security/threat-model.md§T-07` ↔ `docs/security/controls.md§C-12`)
- A feature flag declaration and the code that interprets the flag
- An ordering or sort invariant maintained at one site and relied on at another
- A regen target and the source it regenerates from
- A load-bearing flush, sleep, or import-time call whose role isn't visible locally

Skip when:
- **A type system, schema, validator, or test already enforces it.** Use that instead — it rejects violations automatically.
- A build step regenerates one side from the other perfectly and the regen is not itself the dependency.
- **The prose is purely descriptive of code that is itself the source of truth** — a tutorial paragraph, a README walkthrough, a code-comment paraphrased into a doc — *and* it stands alone, not as part of a corpus whose freshness is independently maintained. Reach for a span only when the prose is *load-bearing*. Prose is load-bearing in either of two ways:
  - **By content** — someone reads it and acts on it: a contract, a normative spec, a published API promise, a runbook a responder follows under pressure. Here the prose constrains the code.
  - **By corpus** — the prose belongs to a curated reference corpus whose accuracy against the code is itself a maintained contract, and the span is the drift-detection link that keeps it honest. A wiki is the canonical case: `wiki check` *requires* a span covering both the page and each code fragment it cites, so the span is how a code change surfaces as "this article may now be wrong." Here the value is in keeping the corpus trustworthy, not in re-deriving the code — the prose is descriptive, but the freshness link is load-bearing. Such spans are created by tooling (anchors only, often no why); do not delete them as "merely descriptive prose." Delete them only if the page itself is being removed or the link genuinely stops mattering.
- The dependency isn't path-addressable (production data shape, external service config, runtime db state). Document those somewhere with a different shape.
- **An anchor would point at a span file itself.** A span never anchors another span — the freshness link *is* the span's own job, so spanning one is circular and self-referential. This holds wherever span files live: the root is `.span/` by default but `GIT_SPAN_DIR` can relocate it (e.g. `.wiki/`), so judge by whether the path is a span file, not by its directory name. (Wiki *pages* and other prose are fine anchors; the span *storage* files are not.)
- The anchors would just be a note to self better written as a commit message or PR comment.

## Naming

Kebab-case slug that names the *relationship*, not either side. Prefer a **hierarchical path** of kebab-case segments separated by `/`: `<category>/<subcategory>/<identifier-slug>`. Each segment is lowercase a-z, 0-9, and `-`, and starts with a letter or digit. The leaf slug should still fit if either anchor is rewritten.

Recommended shapes, in order of growing scope:

- `<identifier-slug>` — small repo, one obvious domain. `checkout-request-flow`.
- `<category>/<identifier-slug>` — repo spans a few domains. `billing/checkout-request-flow`.
- `<category>/<subcategory>/<identifier-slug>` — recommended default once a category contains more than a handful of spans, or when the middle segment carries a stable id (an ADR number, a wiki article slug, a threat-model id, a sub-team). `billing/payments/checkout-request-flow`, `auth/oauth/token-refresh`, `adr/0017/uuidv4-lex-order`, `wiki/world-war-ii/eastern-front`, `security/threat-model/t-07-controls-link`.
- Deeper paths are allowed when the hierarchy is real, but stop once another segment stops adding grouping value — flat-but-descriptive beats deep-and-redundant.

Choosing segments:

- **Leaf (identifier-slug).** The noun phrase a person would naturally use to refer to the subsystem the anchors form: `checkout-request-flow`, `tier-rollout`, `rate-limits`, `auth-token`.
- For anchors that form a thing together, name what they form: `checkout-request-flow`, `tier-rollout`, `auth-token`, `rate-limits`.
- For one side that promises or governs the other, name the contract or rule: `charge-request-contract`, `uuidv4-lex-order`, `p1-payment-runbook`.
- For prose-to-prose citations or summaries, name what's being kept in sync: `architecture-summary-sync`, `threat-model-controls-link`.
- **Category / subcategory.** Domain or team at the top (`billing/`, `platform/`, `experiments/`, `docs/`, `auth/`, `wiki/`, `adr/`, `security/`); a stable sub-grouping in the middle (a feature area, a numbered artifact, an article slug, a sub-team). Reuse the same prefix across sibling spans so prefix listings (`git span list 'billing/payments/'`) group naturally.
- Avoid naming after one anchor (`charge-ts-deps`, `adr-0017-impl`); the leaf should survive a rename or rewrite of either side.
- Avoid `misc`, `john-work`, `temp`, `frontend`, and other catch-all segments at any level.
- One relationship per span. If anchors split into two reasons to change together, create two spans — typically siblings under the same prefix.

## Writing the why

Write the **why** as a **definition in the present tense of the current bytes** — *"X is a Y that does Z"*: name the subsystem, flow, or concern the anchors collectively form, and say plainly what it does across them. The test for any why: *would this sentence still be true, and still verifiable from the anchored bytes alone, a year from now with no memory of this commit?* If it describes a transition (got faster, was added, now handles), an achievement (hit the target, passes), or anything only true *relative to a prior state*, it is not a definition — it's a changelog entry. A "5× speedup" is the change you just made dressed as a metric; the baseline it's measured against is deleted, so the anchored bytes can't show it and `stale` can't catch its decay. Reword to the standing property the anchors guard, or it belongs in the commit message, not the span. Leave invariants, caveats, ownership, and review triggers to source comments, commit messages, CODEOWNERS, and PR descriptions. The why is inherited across routine re-anchors; only stage a new one when the subsystem itself changes.

```bash
# GOOD — a standing property, present tense, readable out of context
git span why billing/checkout-request-flow -m "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server."
```

Re-anchor after drift; do not rewrite the why. See `./responding-to-drift.md` § "Re-anchoring" for the grammar.

## Line-range anchor vs whole-file anchor

- **Line-range anchor (`path#Lstart-Lend`)** — Default for source code. Points a reviewer at the exact bytes. 1-based, inclusive. A Markdown section, an ADR clause, a contract paragraph, a runbook step are all valid line-range anchor targets.
- **Whole-file anchor (`path` alone)** — The file is consumed as a unit by name or identity. Use for: binaries, images, symlinks, submodule roots, generated/minified assets, **and prose documents whose identity is the contract** — a license, a one-page ADR, a published RFC.

**Recommended default for prose spans is a whole-file anchor.** Line-range anchors on prose work mechanically but drift noisily under editorial churn (heading renumbers, prettier reflow, sentence rewrites that preserve meaning). Use line-range anchors on prose only when the document has stable structural landmarks (numbered ADRs, contract clauses, threat-model items with stable IDs) *and* the team is willing to re-anchor on editorial passes. See `./responding-to-drift.md` for the chattier prose-drift workflow. See also `./whole-file-and-lfs.md`.

## Commit sequence alongside a code change

```bash
git span add billing/checkout-request-flow \
  'web/checkout.tsx#L88-L120' \
  'api/charge.ts#L30-L76'
git span why billing/checkout-request-flow \
  -m "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server."
git add .span
git commit -m "Wire checkout to charge API"
```

`git span add` / `why` write directly into the tracked file `.span/billing/checkout-request-flow`; `git add .span && git commit` persists the span in the same commit (or any commit) as the code change. `git span add` without `--at` hashes each anchor against the file content at `HEAD`.

**Standard — commit a span only once every file it anchors is committed.** Because `git span add` hashes each anchor against `HEAD`, committing `.span/<name>` while an anchored file still has uncommitted changes records bytes that aren't at `HEAD`, and the span is born stale. The flow above satisfies this by landing the code and the span in one commit. When the anchored code is committed separately (or by someone else), hold the span: leave it staged and commit it with or after the source, never before. Confirm each anchor is clean first — `git status --short -- <anchor-path>` is empty — and treat a non-empty result as the blocking condition, not as "the source is safely unstaged." After committing, a quick `git show --stat HEAD` should list only `.span/` paths.

## Documenting existing code

When the relationship already exists in history:

```bash
git span add auth/token-contract \
  'packages/auth/token.ts#L88-L104' \
  'packages/auth/crypto.ts#L12-L40'
git span why auth/token-contract -m "Token verification depends on signature verification."
git add .span && git commit -m "Document token/crypto coupling"
```

Use `--at <commit-ish>` (any ref, tag, or SHA) only when the anchor should be hashed against a specific historical commit other than `HEAD`.

A why is optional but strongly recommended: write one before (or with) the commit that introduces a new span. A span without a why is valid and not flagged as stale, but the anchors carry no statement of the subsystem they form. See `./command-quirks-and-errors.md` § "First why on a new span".
