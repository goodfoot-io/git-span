# Using `git mesh advice`

Advice is a session-scoped stream that surfaces the implicit semantic
dependencies a developer crosses while working. `flush` (and `read`) emits one
candidate per coupling crossed since the last flush — a mesh anchor read, a
related anchor that drifted under an edit, a rename that broke an anchored path,
sibling anchors co-touched in the session — and carries the mesh's why so the
developer reads which subsystem the anchors form at the moment they're stepping
on it. The related anchor the candidate routes to may be code or prose: an ADR
section, a contract clause, a runbook step, an API doc are normal targets.

Advice is observation, not enforcement. It doesn't gate commits and doesn't run
in CI. Drift gating belongs to `git mesh stale`; advice is the *during-work*
surface that shows the developer which dependencies they've touched.

## How it is driven

Advice is normally driven by the Claude Code hooks, not invoked by hand. The
hooks call these subcommands for you — see `./understanding-hook-output.md` for
the full timing/trigger map. The subcommands are:

```bash
git mesh advice <sid> mark <id>             # capture a before snapshot for a tool call
git mesh advice <sid> diff <id>             # diff against the mark snapshot, record touches
git mesh advice <sid> read <anchor> [<id>]  # record a read of an anchor / whole-file path
git mesh advice <sid> touch <id> <anchor> <kind>   # record an Edit/Write touch directly
git mesh advice <sid> flush                 # emit candidates for un-advised touches/reads
git mesh advice <sid> touched               # list paths created/updated/deleted this session
git mesh advice <sid> end                   # remove the session store
```

There is no `snapshot` subcommand and no bare `git mesh advice <sid>` render —
a bare invocation errors with "a subcommand is required". `flush` is the verb
that emits candidates; `read` may also emit when the read intersects a mesh.

## Session identity and store

A session is identified by a `<sid>` chosen by the caller (an editor, an agent
harness). Allowed characters: ASCII letters, digits, `-`, `_`, `.`. Anything
else (path separators, whitespace, NUL, control chars) is rejected.

The session store lives **outside the repo** — under `$TMPDIR/git-mesh/advice/`
by default, overridable with `GIT_MESH_ADVICE_DIR`. It never touches `.mesh/`
or git history.

## Baseline

There is no manual baseline step. Every `git mesh advice` call lazily
establishes the session's mesh baseline (a content fingerprint of the mesh
files at first touch). A mesh whose file content has changed since that
baseline — including a brand-new mesh — counts as "committed this session", and
plain reads that intersect it surface the rest of the mesh. Meshes unchanged
since the baseline stay silent on plain reads; their rationale is too far from
working memory to be actionable on a mere read. Deliberate edit/write touches
surface a matching mesh regardless of baseline.

## Reading candidates

Candidates surface several kinds of crossing — read-intersects-mesh,
delta-intersects-mesh, related-anchor drift, rename consequence, anchor shrink,
session co-touch. Markers and routing are documented in
`./understanding-hook-output.md`; the question advice answers is "which coupling
did I just touch?" — and the answer is the mesh's why, rendered alongside the
affected anchors.

When a candidate fires:

- **Read or open the related anchor** the candidate routes to. The anchor
  address plus the subsystem definition is usually enough to orient you.
- **If the subsystem itself has changed** (the anchors no longer form what the
  why says), update the why (`git mesh why <name> -m …`) and commit `.mesh`.
- **If the subsystem is the same but the anchors drifted**, see
  `./responding-to-drift.md`.

## Common quirks

- **`last-flush` inconsistent with objects**: a crash between the rename and
  the state write can leave a stale state. The next flush falls back to a
  baseline diff and prints a one-line note on stderr; no action needed.
- **Stdout broken pipe**: cache-correctness writes run before stdout, so an
  EPIPE doesn't corrupt the session store. Seen-set advances happen only on
  stdout success or EPIPE; any other write failure leaves candidates to
  resurface next flush.
- **Internal advice paths**: paths under the session store directory are
  filtered out of touch intervals automatically — the session's own writes
  don't trigger advice on themselves.

## When advice belongs vs when it doesn't

Advice is the right surface when the question is "which dependencies have I
touched in this session, and what do they form?" — observational,
per-developer, scoped to a unit of work.

Advice is the wrong surface for:
- **Drift gating.** Use `git mesh stale`.
- **Authoring decisions** (re-anchor, fix the related anchor, update why).
  Advice points at the coupling; `./responding-to-drift.md` covers what to do.
- **Cross-developer signal.** Sessions are local; advice does not aggregate
  across machines.
