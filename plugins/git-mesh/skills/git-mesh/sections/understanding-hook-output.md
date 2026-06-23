# Understanding hook output

## The `<git-mesh>` block

When the agent reads or edits a partial line range that overlaps an existing line-ranged anchor, the `PreToolUse` hook injects a `<git-mesh>` block as the hook response's `systemMessage`:

```
<git-mesh>
billing/checkout-request-flow
  src/checkout.tsx#L88-L120 (this file)
  api/charge.ts#L30-L76

Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.
</git-mesh>
```

The block contains the output of `git mesh list <intersecting-mesh-names…>` — the human-readable mesh listing for every mesh whose anchors on the touched file intersect the tool's line range.

## When the block appears

The hook fires on `Read`, `Edit`, `MultiEdit`, and `Write`. A block is emitted when all of the following hold:

- The tool resolves to a single file inside a git repository.
- The tool's line range is **partial** — not the whole file.
- The file has at least one mesh anchor (with a `#L<start>-L<end>` range) that intersects the tool's range.
- The intersecting mesh has not already been surfaced in this session.

## Once-per-session guarantee

Each mesh is surfaced at most once per Claude Code session. The hook tracks surfaced mesh names in a per-session file under `$TMPDIR/agent-hooks-git-mesh/`. A mesh that has already appeared in `<git-mesh>` this session is not repeated, even if the same lines are read or edited again.

## What does NOT surface a block

- **Whole-file reads**: `Read` without `offset`/`limit` parameters.
- **New file writes**: `Write` to a path that does not yet exist on disk.
- **Full-content replacements**: `Write` where every existing line changes.
- **Whole-file anchors**: anchors in mesh files that have no `#L…` range are excluded from matching.
- **Files outside a git repository**: the hook skips quietly if the file is not inside a working tree.
- **Already-surfaced meshes**: meshes emitted earlier in the same session are deduplicated.

## Failure behaviour

If either `git mesh list` invocation fails (non-zero exit, timeout, or the `git mesh` binary is absent), the hook emits nothing and does not block the tool call. Silence is the correct steady-state when `git mesh` is not installed or the repo has no meshes.
