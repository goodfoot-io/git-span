# Finding span candidates by mining git history

An *implicit semantic dependency* is a load-bearing relationship between two
files that the type system, test suite, build graph, or generator tooling do
not enforce. This
section mines git history to surface those pairs, combining 13 signals
(co-change, lagged co-change, defect propagation, churn correlation,
cross-language symbol overlap, branch topology, reviewer overlap, and more)
into a unified ranked shortlist. The pairs at the top are the strongest span
candidates: real coupling that is currently invisible.

## Scripts

Three scripts live in `../scripts/` (relative to this file). Run them in
order: `mine.mjs` produces a JSON corpus, `shortlist.mjs` distills it into
actionable pairs, `explain.mjs` drills into a single pair to verify the
signal.

### `mine.mjs` — produce the JSON corpus

The engine. Runs all 13 signals, writes `potential-implicit-semantic-dependencies.json`
alongside itself (not checked in — regenerate it by re-running `mine.mjs`), and prints a
long human-readable report to stdout.

```bash
node scripts/mine.mjs --since=6.months --top=25 --no-gh
```

Key options:

- `--since=<git-date>` — history window (default `1.year`). Use `3.months`
  or `6.months` for active repos; `1.year` for stable ones.
- `--max-commit-files=<n>` — drop commits touching more than `n` files
  (default 40). Mega-commits dilute every signal.
- `--min-support=<n>` / `--min-confidence=<f>` — co-change thresholds.
- `--top=<n>` or `--top-percent=<p>` — section size cap.
- `--skip=12,13` — skip slow techniques (SZZ, reviewer overlap).
- `--no-gh` — skip reviewer overlap even if `gh` is on PATH.
- `--fix-regex=<pattern>` — override the bug-fix detector. The default catches
  English fix vocabulary; supply a pattern matching the project's commit
  conventions if §2 (fix-only co-change) is empty.

`mine.mjs` streams git log incrementally, so it handles large histories
without buffering the full log. Narrow the window with `--since` or add path
excludes via `--exclude=path1,path2` when a run is slow. The default excludes
already cover lockfiles, build outputs, snapshots, and minified bundles.

### `shortlist.mjs` — distill JSON to span-candidate ranking

Reads the JSON written by `mine.mjs` and prints only §0 — pairs that fired
across multiple techniques — with each technique's specific evidence
attached.

```bash
node scripts/shortlist.mjs                       # default JSON path
node scripts/shortlist.mjs --min-techniques=3    # only highly-supported pairs
node scripts/shortlist.mjs path/to/mine.json --top=10
```

Each shortlisted pair shows which techniques fired, their numeric values, and
a copy-pasteable `explain.mjs` invocation. The shortlist is the actionable
output; the long `mine.mjs` text report is mainly useful for forensics.

### `explain.mjs` — verify a single pair

Lists every commit in the window that touched both files, with subject, sha,
date, and author. Use after shortlist to confirm a pair's coupling is real.

```bash
node scripts/explain.mjs <fileA> <fileB>
node scripts/explain.mjs <fileA> <fileB> --since=2.years
```

A pair with high mining-signal but unrelated commits (different authors
fixing different things in the same sweep) is a false positive. A pair whose
commits consistently cite the same concern is a real span candidate.

## End-to-End Workflow

Paths below are relative to this skill's directory
(`plugins-claude/git-span/skills/git-span/`).

**1. Mine.** From the repo root:

```bash
node plugins-claude/git-span/skills/git-span/scripts/mine.mjs \
  --since=6.months --top=25 --no-gh
```

This writes `potential-implicit-semantic-dependencies.json` next to the
script and prints a 13-section report. Skim §0 of the report; the JSON is
for the next step.

**2. Shortlist.** Distill to actionable candidates:

```bash
node plugins-claude/git-span/skills/git-span/scripts/shortlist.mjs \
  --min-techniques=2
```

Pairs firing in 3+ techniques are very likely real coupling. Pairs firing in
exactly 2 techniques deserve a look — verify with explain.

**3. Explain.** For each candidate worth pursuing:

```bash
node plugins-claude/git-span/skills/git-span/scripts/explain.mjs \
  packages/foo/src/Foo.ts packages/bar/src/Bar.ts
```

Read the commit subjects. Ask:

- Does one file rely on a contract the other defines but does not enforce?
- If the related anchor changed silently, what concrete wrong decision would I make?
- Are these the same bug recurring under different names? (SZZ signal)

If yes, the pair is a real span candidate: declare it with `git span add` and
`git span why` (see this skill's `SKILL.md` § "Declare a new coupling").

## Reading the Output

The aggregate shortlist tags each pair with the techniques that fired:

```
[1,4,7,11,12]
  packages/foo/src/Producer.ts
  packages/bar/src/Consumer.ts
  techniques (5): 1=co-change, 4=range, 7=lagged, 11=churn, 12=SZZ
    co-change: support=8.2 conf=0.91 jaccard=0.33
    range:     emitMessage ↔ handleMessage support=4.1
    lagged:    Producer.ts → Consumer.ts support=6.8
    churn:     r=0.78 weeks=18
    SZZ:       Producer.ts → Consumer.ts ×3
```

The reading: every time `Producer.ts` changes, `Consumer.ts` follows within
a few commits (lagged); both files breathe in sync week-to-week (churn);
their churn is concentrated in the `emitMessage`/`handleMessage` pair
(range); and historical bugs in `Producer.ts` have been fixed by also
touching `Consumer.ts` (SZZ). Five orthogonal signals agree — this is a
real producer/consumer contract worth making explicit.

A pair with `[1]` only is a single-signal hit and is much more likely noise.
Filter with `--min-techniques=2` (default) or `--min-techniques=3` for higher
confidence at the cost of recall.

## Heuristics for Acting on Results

**Trust the multi-technique pairs.** A pair that fires in 3+ orthogonal
techniques is overwhelmingly real. Investigate before dismissing.

**Distrust pairs with high `authors∩` jaccard.** If the same person writes
both sides, mining will flag the coupling but it is not "hidden," just
personal context — the aggregate rerank already pushes these down.

**`[structural]` tags mean explicit coupling.** One file references the other
by name (import, manifest entry, doc link). Real but already visible to the
compiler/reader; less urgent than truly latent pairs.

**Empty §2 and §12 means the regex misses your conventions.** Use
`--fix-regex='your|fix|vocabulary'` to align the bug-fix detector with
project commit style.

**Range pairs (§3) tell you *where*.** A function in A coupled to a section
in B is more actionable than the file-level pair, because you know exactly
where the contract lives. Pull range pairs out of `range_pairs` in the JSON
when planning a fix.

## Additional Resources

- **`../scripts/mine.mjs`** — the 13-technique mining engine. Self-contained;
  no dependencies beyond Node and git.
- **`../scripts/shortlist.mjs`** — JSON consumer; prints the actionable §0.
- **`../scripts/explain.mjs`** — per-pair commit listing.
- **`../references/techniques.md`** — deep dive on each of the 13 signals:
  what they measure, when they are trustworthy, how to tune them, and how to
  read each section of the long report. Consult when output looks empty or
  when deciding whether to trust a particular signal.

## Common Failure Modes

- **`mine.mjs` reports 0 fix commits**: default fix regex misses the
  project's vocabulary. Set `--fix-regex=` to the team's actual style.
- **Shortlist is empty**: lower `--min-techniques`, widen `--since`, or
  drop `--min-support`/`--min-confidence` in `mine.mjs`.
- **Shortlist top is dominated by manifest/doc pairs**: those are already
  tagged `[structural]` in §1 of `mine.mjs`'s text report. The shortlist
  inherits them through §0; treat structural pairs as known coupling and
  filter them out by reading the per-pair evidence.
- **`gh` errors**: pass `--no-gh` to skip technique 13. The other techniques
  still run.
- **Run takes too long**: pass `--skip=12,13` to drop SZZ (per-fix `git
  blame` calls) and reviewer overlap (network).
