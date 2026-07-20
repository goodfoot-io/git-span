# Multi-span / uncertain-coupling triage

1. Batch history lookups by path class, not per file: one
   `git log --all --full-history -- <src-path-1> <src-path-2> ...` for all source paths,
   one more for all doc paths. Never one call per file.
2. Read the CURRENT content at each anchor (the file itself) to judge whether the
   coupling still describes something real.
3. Classify each drifted span with `git span stale` and resolve by row:

| `stale` reports                          | resolution |
|---|---|
| Moved                                     | `git span stale --fix <name>` — unconditional for a pure move |
| Changed, coupling still holds             | `grep -n <symbol>` (the identifier the span's `why` names) in the target file. If the hit falls inside the anchor's existing range, `add` the SAME range (hash refresh only) — do NOT pick a new range because the code now "looks like" it's about something else. Only a symbol that physically moved lines changes the range. |
| Changed, but the coupled feature is gone  | `git span delete <name>` — do not re-anchor onto unrelated content left behind at the same lines |
| Not reported by `stale` at all            | undeclared coupling — declare it (SKILL.md) |

4. Stop at `git span stale`'s output for each verdict — do not additionally run
   `git log`, `git show <hash>`, or read raw `.span/*` files once a row above resolves
   the case.
5. After all fixes, re-run `git span stale` with no filter: must exit 0.
6. `git add .span && git commit -m "..."`.
