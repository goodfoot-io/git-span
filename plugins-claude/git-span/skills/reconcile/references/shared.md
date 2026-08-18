<instructions>

Do not run the reconciliation inline. Run the mechanical prelude yourself, then spawn worker teammates:

1. Scan the bare drift output for `deleted in the working tree` anchors that are renames in progress — a deletion at the old path plus a new file in `git status --short`, matched by content (`git hash-object <new>` = `git rev-parse HEAD:<old>`). Stage both halves (`git add <new> <old>`) — the resolver sees a staged rename as `moved to <path>` and `--fix` clears it without a commit — and commit when no review-before-commit gate forbids; unstaged it is invisible to today's rename detection — no git data records the untracked destination — and needs a manual re-anchor (or the R1 worktree-fallback when it ships). Deletions are never cleared by `--fix` — staging first makes the classification authoritative (`deleted in the index`; committed, it names the commit). Under a review-before-commit gate, staging still resolves the move; only a read-only worktree forces the manual pass (or the R1 fallback when it ships). Confirm `--fix`'s `moved to` destination when another same-content file exists — it may pick the wrong copy. Then run `git span drift --fix` once. If it changes `.span/`, commit that refresh with any uncommitted anchored source it records — list every path it records in the `-o`; if the source is already committed, commit `.span/` alone. Use one commit.
2. If no drift remains, stop. Otherwise count the drifted anchors in the `--fix` output and derive the worker count from the scale bands: 1–2 → 1, 3–8 → 2, 9–20 → 3, 21+ → 4. Always fork.
3. Spawn that many named worker forks in order — the last one is the controller. Preceding workers (1 … N−1):

```xml
<invoke name="Agent">
<parameter name="description" string="true">Reconcile worker <i></parameter>
<parameter name="subagent_type" string="true">fork</parameter>
<parameter name="name" string="true">reconcile-worker-<i></parameter>
<parameter name="prompt" string="true">
Read [path to the skill ./references/worker.md] and follow it. You are worker <i> of <N>. Wait for your unit assignment from the controller (reconcile-worker-<N>) via SendMessage, execute it, and report back to the controller with the elapsed time per span. Never commit.
</parameter>
</invoke>
```

The final worker (the controller, <N>):

```xml
<invoke name="Agent">
<parameter name="description" string="true">Reconcile worker <N> (controller)</parameter>
<parameter name="subagent_type" string="true">fork</parameter>
<parameter name="name" string="true">reconcile-worker-<N></parameter>
<parameter name="prompt" string="true">
Read this skill's [path to the skill ./references/worker.md] and [path to the skill ./references/controller.md] and follow them. You are worker <N> of <N> — the controller, possibly the only worker. Assign the other workers (reconcile-worker-1 … reconcile-worker-<N-1>) their disjoint units via SendMessage and report to the session's main agent. Never commit.
</parameter>
</invoke>
```

When the controller's report arrives and the validation it reports is green, run the commit commands it provides.

</instructions>
