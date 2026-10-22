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

Spawn each worker with `spawn_agent`, setting `fork_turns: "all"`, its unit in
the `message`:

```json
{
  "task_name": "reconcile-worker-<i>",
  "message": "Read [absolute path to ./procedure.md] and run its stage 3 on the unit below. Only stage 3 — do not run stages 1, 2, or 4, and never commit.\n\nUnit: <spans; every drifted anchor as path, range, CHANGED/DELETED; each span's why; shared files; non-drifted context spans; range-overlap flags>\n\nReport per span: classification, action taken, the decisive nonlocal fact, every anchor diff (retired and added addresses), and elapsed time. Flag any span you stopped on and why.",
  "fork_turns": "all"
}
```

Units must be disjoint and must never separate spans with overlapping ranges on
a shared file.

## Collect

A worker that stops on unclear authority is reporting correctly — decide it
yourself per `./procedure.md`'s authority rules, or surface it in your own
report. Never re-anchor over a live disagreement.

When every report is in, run stage 4.
