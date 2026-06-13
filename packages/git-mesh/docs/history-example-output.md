# `git mesh history` — markdown variant (reference only)

This document is the earlier markdown rendering of `git mesh history` output, kept for
reference. It was superseded by the canonical XML format (see
`history-example-output-xml.md`). The XML format is the authoritative spec.

The markdown format is **not produced by any current renderer** — it is preserved here
to document why XML was chosen and to give the JSON shape a readable home.

## Why XML won

Markdown fences delimit blocks by backtick length: the fence must be longer than any
interior backtick run. Anchor content can contain its own backtick sequences (e.g. in
`.md` files or documentation strings), making dynamic fence sizing fragile. XML CDATA
eliminates this problem entirely: the only character sequence that terminates a CDATA
block is `]]>`, which is defensively split in the renderer. XML is also structurally
self-describing, which makes it more tractable for Claude and other tooling.

## JSON shape (`--format json`)

The JSON output is the data-equivalent of the canonical XML. It is built with
`serde_json::json!` and carries a top-level `schema_version`.

```json
{
  "schema_version": 1,
  "mesh": "billing/checkout-request-flow",
  "commits": [
    {
      "hash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "date": "2025-11-03",
      "summary": "Wire checkout to charge API",
      "why": "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.",
      "anchors": [
        {
          "path": "web/checkout.tsx#L88-L120",
          "event": "added",
          "content": "async function submitCheckout(cart: Cart): Promise<CheckoutResult> {\n  const token = await tokenize(cart.payment);\n  return fetch('/api/charge', {\n    method: 'POST',\n    body: JSON.stringify({ token, items: cart.items }),\n  }).then(r => r.json());\n}"
        },
        {
          "path": "api/charge.ts#L30-L76",
          "event": "added",
          "content": "export async function handleCharge(req: Request): Promise<Response> {\n  const { token, items } = await req.json();\n  const amount = items.reduce((sum, i) => sum + i.price, 0);\n  const result = await stripe.charges.create({ amount, source: token });\n  return json({ id: result.id, status: result.status });\n}"
        }
      ]
    },
    {
      "hash": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
      "date": "2025-11-14",
      "summary": "Add retry wrapper around charge call",
      "why": "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server, with automatic retry on transient failures.",
      "anchors": [
        {
          "path": "api/charge.ts#L30-L76",
          "event": "modified",
          "content": "export async function handleCharge(req: Request): Promise<Response> {\n  const { token, items } = await req.json();\n  const amount = items.reduce((sum, i) => sum + i.price, 0);\n  const result = await withRetry(() => stripe.charges.create({ amount, source: token }));\n  return json({ id: result.id, status: result.status });\n}"
        }
      ]
    },
    {
      "hash": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
      "date": "2025-12-01",
      "summary": "Extract retry logic to shared module",
      "anchors": [
        {
          "path": "api/charge.ts#L30-L76",
          "event": "removed"
        },
        {
          "path": "api/retry.ts#L12-L40",
          "event": "added",
          "content": "export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {\n  for (let i = 0; i < attempts; i++) {\n    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; }\n  }\n  throw new Error('unreachable');\n}"
        }
      ]
    }
  ],
  "current": {
    "anchors": [
      {
        "path": "api/retry.ts#L12-L40",
        "status": "changed in the working tree",
        "content": "export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 100): Promise<T> {\n  for (let i = 0; i < attempts; i++) {\n    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; await sleep(delayMs); }\n  }\n  throw new Error('unreachable');\n}"
      }
    ]
  }
}
```

## JSON shape rules (normative)

- `schema_version`: always `1`.
- `why` key is omitted from a commit object when the prose did not change at that commit.
- `current` key is omitted entirely when the working tree matches HEAD.
- A `removed` anchor has no `content` key (the key is omitted, not set to null).
- The `path` field for all anchor objects is the combined git-mesh address string:
  `path#L<start>-L<end>` for line-range anchors; bare path for whole-file anchors.
- Degradation notes (file absent, line range past EOF, binary content) appear as the
  `content` string value verbatim — they are not a structured error object.

## Earlier markdown format (superseded)

The markdown format used `#### \`addr\`` headings and language-tagged fences whose
fence length was set dynamically to one backtick longer than any interior backtick run.
This is kept here only to explain the lineage; the XML renderer does not produce it.

### Commit a1b2c3d — 2025-11-03 — Wire checkout to charge API

**why:** Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

#### `web/checkout.tsx#L88-L120` added

```tsx
async function submitCheckout(cart: Cart): Promise<CheckoutResult> {
  const token = await tokenize(cart.payment);
  return fetch('/api/charge', {
    method: 'POST',
    body: JSON.stringify({ token, items: cart.items }),
  }).then(r => r.json());
}
```

#### `api/charge.ts#L30-L76` added

```ts
export async function handleCharge(req: Request): Promise<Response> {
  const { token, items } = await req.json();
  const amount = items.reduce((sum, i) => sum + i.price, 0);
  const result = await stripe.charges.create({ amount, source: token });
  return json({ id: result.id, status: result.status });
}
```

### Commit b2c3d4e — 2025-11-14 — Add retry wrapper around charge call

**why:** Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server, with automatic retry on transient failures.

#### `api/charge.ts#L30-L76` modified

```ts
export async function handleCharge(req: Request): Promise<Response> {
  const { token, items } = await req.json();
  const amount = items.reduce((sum, i) => sum + i.price, 0);
  const result = await withRetry(() => stripe.charges.create({ amount, source: token }));
  return json({ id: result.id, status: result.status });
}
```

### Commit c3d4e5f — 2025-12-01 — Extract retry logic to shared module

#### `api/charge.ts#L30-L76` removed

#### `api/retry.ts#L12-L40` added

```ts
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; }
  }
  throw new Error('unreachable');
}
```

### current (working tree)

#### `api/retry.ts#L12-L40` — changed in the working tree

```ts
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 100): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; await sleep(delayMs); }
  }
  throw new Error('unreachable');
}
```
