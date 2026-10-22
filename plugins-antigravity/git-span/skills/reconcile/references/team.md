# Delegating stage 3

You are the owner. You have already run stages 1 and 2, so you hold the
components. Delegate stage 3 only; stages 1, 2, and 4 stay yours. You are the
only one who commits.

## Size the team

Count the drifted anchors left after stage 1:

| Drifted anchors | Workers to spawn |
|---|---|
| 9–20 | 2 |
| 21+ | 3 |

Split the components between the workers by anchor count, keeping one for
yourself to work while they run.

## Spawn

Spawn each worker by delegating to a subagent with `invoke_subagent`, named
`reconcile-worker-<i>`. Delegated subagents are not documented to inherit your
conversation, so the delegation message must carry the whole unit:

```text
Read [absolute path to ./procedure.md] and run its stage 3 on the unit below.
Only stage 3 — do not run stages 1, 2, or 4, and never commit.

Unit: <spans; every drifted anchor as path, range, CHANGED/DELETED; each span's
why; shared files; non-drifted context spans; range-overlap flags>

Report per span: classification, action taken, the decisive nonlocal fact, every
anchor diff (retired and added addresses), and elapsed time. Flag any span you
stopped on and why.
```

Check state with `manage_subagents` while workers run, and re-engage a live
worker with `send_message` when its unit needs a correction.

Units must be disjoint and must never separate spans with overlapping ranges on
a shared file.

## Collect

A worker that stops on unclear authority is reporting correctly — decide it
yourself per `./procedure.md`'s authority rules, or surface it in your own
report. Never re-anchor over a live disagreement.

When every report is in, run stage 4.
