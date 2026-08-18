<instructions>

Do not run the reconciliation inline. Run the mechanical prelude yourself, then spawn worker teammates:

1. Scan the bare drift output for `deleted in the working tree` anchors that are renames in progress — a deletion at the old path plus a new file in `git status --short`, matched by content (`git hash-object <new>` = `git rev-parse HEAD:<old>`). Stage both halves (`git add <new> <old>`) — the resolver sees a staged rename as `moved to <path>` and `--fix` clears it without a commit — and commit when no review-before-commit gate forbids; unstaged it is invisible to today's rename detection — no git data records the untracked destination — and needs a manual re-anchor (or the R1 worktree-fallback when it ships). Deletions are never cleared by `--fix` — staging first makes the classification authoritative (`deleted in the index`; committed, it names the commit). Under a review-before-commit gate, staging still resolves the move; only a read-only worktree forces the manual pass (or the R1 fallback when it ships). Confirm `--fix`'s `moved to` destination when another same-content file exists — it may pick the wrong copy. Then run `git span drift --fix` once. If it changes `.span/`, commit that refresh with any uncommitted anchored source it records — list every path it records in the `-o`; if the source is already committed, commit `.span/` alone. Use one commit.
2. If no drift remains, stop. Otherwise count the drifted anchors in the `--fix` output and derive the worker count from the scale bands: 1–2 → 1, 3–8 → 2, 9–20 → 3, 21+ → 4. Always fork.
3. You are the controller — research the drift from scratch before spawning: components, shared files, blast radius, and range overlaps, following this skill's `./references/controller.md`. Never split spans with overlapping ranges on a shared file across workers.
4. Spawn the unit workers (1 … N−1) via `spawn_agent` with `fork_turns: "all"`, each disjoint unit in the `message`; keep a unit for yourself. When N is 1, keep every unit and execute it yourself — spawn nothing:

```json
{
  "task_name": "reconcile-worker-<i>",
  "message": "Read this skill's ./references/worker.md and follow it. You are worker <i> of <N>. Your unit: <spans, drifted anchors (path, range, CHANGED/DELETED), why, shared files, non-drifted context spans, range-overlap flags>. Never commit. Report per span with the elapsed time.",
  "fork_turns": "all"
}
```

5. When the workers' reports arrive and the validation they report is green, run the commit commands from this skill's `./references/controller.md`.

</instructions>
