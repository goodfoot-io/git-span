# `git mesh history` — canonical XML example output

This document is the reference specification for the XML renderer (`render_xml`).
Integration tests assert that `git mesh history billing/checkout-request-flow` produces
output structurally equivalent to the examples below.

## Scenario

A mesh `billing/checkout-request-flow` is created in commit `a1b2c3d`, modified in
`b2c3d4e` (why prose edited, one anchor content changed), then `c3d4e5f` (an anchor
removed), with the working tree currently containing uncommitted drift on one remaining
anchor.

## Format rules (normative)

- No XML declaration, no wrapping container element.
- Tags are un-indented; content sits between open and close tags.
- Attribute order within each element: elements are defined as shown below.
- `<commit>` attributes: `hash` (full 40-hex OID), `date` (`YYYY-MM-DD`), `summary`
  (first commit message line, XML-attribute-escaped).
- `<why>` is emitted only when the why prose changed at this commit, wrapped in CDATA.
- `<anchor>` on timeline entries carries `path` (combined git-mesh address) and `event`
  (`added`, `modified`, or `removed`).
  - `added` and `modified` anchors wrap their body in CDATA.
  - `removed` anchors are self-closing with no body.
- `<current>` block is emitted only when the working tree differs from HEAD.
  - `<anchor>` inside `<current>` carries `path` and `status` (verbatim drift phrase from
    `format_drift_label`, e.g. `changed in the working tree`).
  - Live content of drifted anchors is wrapped in CDATA.
  - Anchors deleted in the working tree are self-closing with no body.
- CDATA escaping: a literal `]]>` inside body text is split as `]]]]><![CDATA[>`.
- Attribute values are XML-attribute-escaped: `&` → `&amp;`, `<` → `&lt;`,
  `"` → `&quot;`.
- Commits where nothing observable changed (pure hash recompute, byte-identical
  re-anchor) are omitted entirely.

## Example output

```xml
<commit hash="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" date="2025-11-03" summary="Wire checkout to charge API">
<why><![CDATA[Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.]]></why>
<anchor path="web/checkout.tsx#L88-L120" event="added"><![CDATA[async function submitCheckout(cart: Cart): Promise<CheckoutResult> {
  const token = await tokenize(cart.payment);
  return fetch('/api/charge', {
    method: 'POST',
    body: JSON.stringify({ token, items: cart.items }),
  }).then(r => r.json());
}]]></anchor>
<anchor path="api/charge.ts#L30-L76" event="added"><![CDATA[export async function handleCharge(req: Request): Promise<Response> {
  const { token, items } = await req.json();
  const amount = items.reduce((sum, i) => sum + i.price, 0);
  const result = await stripe.charges.create({ amount, source: token });
  return json({ id: result.id, status: result.status });
}]]></anchor>
</commit>
<commit hash="b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1" date="2025-11-14" summary="Add retry wrapper around charge call">
<why><![CDATA[Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server, with automatic retry on transient failures.]]></why>
<anchor path="api/charge.ts#L30-L76" event="modified"><![CDATA[export async function handleCharge(req: Request): Promise<Response> {
  const { token, items } = await req.json();
  const amount = items.reduce((sum, i) => sum + i.price, 0);
  const result = await withRetry(() => stripe.charges.create({ amount, source: token }));
  return json({ id: result.id, status: result.status });
}]]></anchor>
</commit>
<commit hash="c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2" date="2025-12-01" summary="Extract retry logic to shared module">
<anchor path="api/charge.ts#L30-L76" event="removed"/>
<anchor path="api/retry.ts#L12-L40" event="added"><![CDATA[export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; }
  }
  throw new Error('unreachable');
}]]></anchor>
</commit>
<current>
<anchor path="api/retry.ts#L12-L40" status="changed in the working tree"><![CDATA[export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 100): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; await sleep(delayMs); }
  }
  throw new Error('unreachable');
}]]></anchor>
</current>
```

## Incomplete-walk warning

When the git-log walk hits its time budget (`walk_complete == false`), the command
prints to stderr and exits non-zero:

```
error: history walk incomplete — not all commits were inspected (hit time budget)
```

No partial output is emitted as though it were the full record. This is a fail-closed
invariant.

## Per-anchor degradation notes

When anchor content is unavailable, the body is a plain-text note (not CDATA-wrapped
source). Examples:

```xml
<anchor path="api/charge.ts#L30-L76" event="added">(file absent at this commit)</anchor>
<anchor path="api/charge.ts#L30-L76" event="modified">(line range past end of file)</anchor>
<anchor path="api/charge.ts#L30-L76" event="added">(binary or non-UTF-8 content)</anchor>
```
