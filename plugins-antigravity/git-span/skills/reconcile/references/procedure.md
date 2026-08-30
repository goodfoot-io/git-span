<!-- Generated from skills-src/git-span/reconcile/references/procedure.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Reconcile drifted git spans

Four stages. Stages 1, 2, and 4 belong to whoever owns the reconciliation — run
them once, yourself. Stage 3 is per-span work, divisible by component and the
only stage that may be delegated (see `./team.md`).

**Report** below means your final summary if you own the reconciliation, or your
message to the owner if you are a delegated worker.

Invoke `git-span` only when a topic exceeds what is here; navigate to
the named section.

---

## Stage 1 — Prelude

The only mutating research step.

First scan the bare drift output for `deleted in the working tree` anchors that
are renames in progress: a deletion at the old path plus a new file in `git
status --short`, matched by content (`git hash-object <new>` = `git rev-parse
HEAD:<old>`). Stage both halves (`git add <new> <old>`) — the resolver reads a
staged rename as `moved to <path>` and `--fix` clears it without a commit — and
commit unless a review-before-commit gate forbids. Left unstaged it is invisible
to rename detection (no git data records the untracked destination) and needs a
manual re-anchor. Only a read-only worktree forces that manual pass.

`--fix` never clears a deletion — stage 2's STOP case governs those — but
staging first makes the classification authoritative (`deleted in the index`;
committed, it names the commit). Confirm `--fix`'s `moved to` destination when
another same-content file exists; it matches by content and may pick the wrong
copy. If it did, `git span remove` the wrong address and `add` the right one.

```bash
git span drift --fix
```

If `--fix` changes `.span/`, commit that refresh in one commit with any
uncommitted anchored source it records — list every path it records in `-o`. If
the source is already committed, commit `.span/` alone.

Remaining findings are CHANGED (beyond whitespace) and DELETED. Group them by
span. If none remain, you are done — skip stages 2–4.

---

## Stage 2 — Partition

`git span drift` already lists every anchor of every drifted span (drifted ones
marked `— changed`/`— deleted`, healthy ones unmarked). Do not run `git span
show` or `git span why` per span.

Collect every file appearing in more than one drifted span and pass them all as
roots to one `tree` call — `tree` takes multiple roots and separates unrelated
ones into distinct top-level trees. Never one call per file.

```bash
git span tree '<shared-file-1>' '<shared-file-N>' --depth 1
```

The output is the adjacency list: each top-level tree covers one shared file (or
a clique co-occurring on a span), and each child line is one span anchoring it,
shown by its *other* anchored paths. Drifted spans under the same top-level tree
form one **component** — one unit of work. A drifted span whose files each
appear in only one drifted span is a component of size one. Non-drifted spans in
the output are context telling you what the correct ranges should be.

Repeat at `--depth 2`, same roots, for the blast radius: the component,
non-drifted spans anchoring the same files, and one hop beyond.

Record per component: every span; every drifted anchor (path, range,
CHANGED/DELETED); each span's why, taken from the drift output; shared files and
the non-drifted spans anchoring them; and a flag on any anchors whose ranges
overlap on a shared file. This is structural — what is drifted, not why it
drifted.

Never separate spans with overlapping ranges on a shared file — neither across
delegated units nor across sub-batches. Split an oversized component into
cohesive sub-batches by topic or subsystem.

**Never investigate a DELETED anchor whose file is gone from disk** — you
cannot. This ends that anchor's investigation, not the reconciliation. If the
span's remaining anchors still describe a valid relationship, remove the
deleted-file anchor; if the relationship is gone, `git span delete` the span.

---

## Stage 3 — Per-span procedure

Per span, in each component. If you find here that a DELETED anchor's file is
gone from disk, stage 2's never-investigate case governs — report it and carry
on with your other spans.

1. Run `git span history <name>` once for all its anchors. Use its live-drift
   diffs to identify byte changes, `drift source` (`sources` in JSON) to
   identify layers, and its declaration diff and timeline to establish
   provenance. `HEAD` alone does not prove a committed change; a worktree-only
   declaration re-anchor can produce it. If only the declaration changed,
   inspect it and either commit or revert it rather than searching timeline
   entries for a content commit that does not exist. History does not locate a
   CHANGED anchor's destination — use a targeted old/current file diff only when
   its logical region moved.
2. Read current bytes at each drifted anchor.
3. Write a concise confirmation of the relationship and its decisive nonlocal
   fact. Stop if you cannot.
4. Classify and execute:

| Category | Action |
|---|---|
| Whole-file anchor CHANGED; the file is still consumed as a unit | `git span add <name> '<path>'` — re-add the same bare path; a whole-file anchor stays whole-file |
| Range anchor CHANGED at the same address; the logical region did not move | `git span add <name> '<path>#L<start>-L<end>'` — re-add the exact existing range, nothing else |
| File shrunken below the anchored end; the region still exists | `git span remove <name> '<path>#L<old>'` then `git span add <name> '<path>#L<new>'` — an identity change, the new end line being the file's current line count |
| Logical region genuinely moved to a new range | `git span remove <name> '<path>#L<old>'` then `git span add <name> '<path>#L<new>'` |
| One anchor lags a confirmed authority | Conform it, validate any code change, then re-anchor; include the content diff in your report |
| Content no longer describes relationship | `git span remove <name> '<path>#L<N>'` |
| Relationship gone entirely | `git span delete <name>` |
| Span has no why | Invoke the core skill's why rules, then use `git span why` |
| Lifecycle gate is satisfied | Make the authorized behavior change, revise or retire the substantive why, and reconcile or retire every superseded anchor |
| Authority remains unclear or no intentional change explains drift | Stop and report — the user decides |

5. `git span drift <name>` — require exit 0 and zero drift for this span.

Then confirm the intended canonical address occurs exactly once, every
superseded address is absent, and the why remains accurate.

Never add a narrower range because edited code now looks locally narrower: an
unchanged whole-file anchor stays whole-file, an unchanged range keeps its exact
boundaries. A file whose line count no longer reaches the anchored end is the
exception — the extent genuinely contracted, so the shrunken-file row governs.
If a span holds both a whole-file and a range anchor for the same file, retire
whichever no longer reflects the logical region and keep exactly one.

Confirm each CHANGED finding individually; never bulk re-add anchors. `add` does
not retire a different address. Stop on unconfirmed findings.

Every `add`/`why` write ends with a post-write span-wide check sharing `drift`'s
exit contract: exit 0 = clean, exit 1 = actionable drift remains or the check
errored (the output says which: remains lines vs `state unverified`), exit 2 =
indeterminate — the resolver's `index_changed` verdict, retryable. Read the
mutation's span-wide line (`0 drift across ...`, `N anchors drifted — ...`,
`state indeterminate`, `state unverified`) before the trailing scoped `drift`.
Drift's own 0/1/2 semantics are unchanged.

### Deciding authority

A doc drifting behind a deliberate, committed code change is wrong — conform it.
A code change with no coherent commit story may be a regression — the doc may be
the truth. Docs follow deliberate committed code and describe current reality —
never "we used to" framing. Keep the why across routine re-anchors; write a new
one only when the subsystem itself changed. Fail closed on ambiguity, not on
editing per se: surface the stop, never re-anchor over a live disagreement.

---

## Stage 4 — Validation and commit — owner only

```bash
git span drift     # must exit 0 with "0 drift"
git span doctor    # must report "no findings"
```

Run required validation for every behavior change and surface every anchor diff.
If validation fails, handle the failing component before committing.

```bash
git add <changed-anchor-paths> .span   # omit content paths when no anchor changed
git commit -o .span <changed-anchor-paths> -m "Restore spanned relationships"
```

---

## Git allowlist

In a shared worktree restrict yourself to: `git span …`; edits to anchors you
own, when confirmed authority or a satisfied gate decides them; required tests;
`git checkout <commit-ish> -- .span/<name>`; and read-only `git status`/`git
diff`/`git log`/`git show`. Never touch unrelated paths or rewind HEAD.

Staging and committing are stage 4, so they are the owner's alone: `git add
.span[/<name>]`, `git add <owned-anchor>`, `git commit -o .span[/<name>]
<owned-anchor> -m` (never `-a` or `--amend`). A delegated worker runs none of
these and leaves its `git span` writes unstaged for the owner.
