---
name: reconcile
description: Reconcile drifted git spans surfaced by `git span drift`. Use when asked to "reconcile drifted spans", "reconcile stale spans", "fix drifted spans", "fix stale spans", "resolve span drift", "clean up drifted spans", "clean up stale spans", or when `git span drift` exits non-zero with drift.
---

<instructions>

If you are already working on other tasks, do not run the reconciliation inline. Spawn a named forked teammate to run it — it inherits this session's context and reads the workflow from this skill's `references/reconcile.md`:

```json
{
  "task_name": "reconcile",
  "message": "Read this skill's references/reconcile.md and run its workflow. You are a forked teammate, not the session's main agent: never commit — after validation, report your findings, every anchor diff, and the commit commands for the session's main agent to run.",
  "fork_turns": "all"
}
```

Continue your other tasks while the teammate works. When its report arrives and the validation it reports is green, run the commit commands it provides.

If you are not working on other tasks, read this skill's `references/reconcile.md` and run its workflow inline yourself.

</instructions>
