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

Dispatch each worker with `subagent`. Include this prompt with its unit:

```text
Read [absolute path to ./procedure.md] and run stage 3 only. Never commit.
Unit: <spans; drifted anchors with path, range and status; whys; shared files;
non-drifted context spans; range-overlap flags>
Report classifications, actions, decisive nonlocal facts, retired and added
anchors, elapsed time, and blockers. Use the returned sessionID for follow-ups.
```

Units must be disjoint and must never separate spans with overlapping ranges on
a shared file.

## Collect

A worker that stops on unclear authority is reporting correctly — decide it
yourself per `./procedure.md`'s authority rules, or surface it in your own
report. Never re-anchor over a live disagreement.

When every report is in, run stage 4.
