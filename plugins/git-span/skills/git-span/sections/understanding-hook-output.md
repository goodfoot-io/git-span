# Understanding hook output

## The `<git-span>` block

When the agent reads or edits a partial line range that overlaps an existing line-ranged anchor, the `PreToolUse` hook injects a `<git-span>` block as the hook response's `systemMessage`:

```
<git-span>
billing/checkout-request-flow
  src/checkout.tsx#L88-L120 (this file)
  api/charge.ts#L30-L76

Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.
</git-span>
```

The block contains the output of `git span list <intersecting-span-names…>` — the human-readable span listing for every span whose anchors on the touched file intersect the tool's line range.

## When the block appears

The hook fires on `Read`, `Edit`, `MultiEdit`, and `Write`. A block is emitted when all of the following hold:

- The tool resolves to a single file inside a git repository.
- The tool's line range is **partial** — not the whole file.
- The file has at least one span anchor (with a `#L<start>-L<end>` range) that intersects the tool's range.
- The intersecting span has not already been surfaced in this session.

## Once-per-session guarantee

Each span is surfaced at most once per Claude Code session. The hook tracks surfaced span names in a per-session file under `$TMPDIR/agent-hooks-git-span/`. A span that has already appeared in `<git-span>` this session is not repeated, even if the same lines are read or edited again.

## What does NOT surface a block

- **Whole-file reads**: `Read` without `offset`/`limit` parameters.
- **New file writes**: `Write` to a path that does not yet exist on disk.
- **Full-content replacements**: `Write` where every existing line changes.
- **Whole-file anchors**: anchors in span files that have no `#L…` range are excluded from matching.
- **Files outside a git repository**: the hook skips quietly if the file is not inside a working tree.
- **Already-surfaced spans**: spans emitted earlier in the same session are deduplicated.

## Failure behaviour

If either `git span list` invocation fails (non-zero exit, timeout, or the `git span` binary is absent), the hook emits nothing and does not block the tool call. Silence is the correct steady-state when `git span` is not installed or the repo has no spans.
