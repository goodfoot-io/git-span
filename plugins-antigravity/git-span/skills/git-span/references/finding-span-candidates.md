# Finding span candidates by mining git history

Mine history for broad discovery of decision-changing relationships and reminders,
including test-covered contracts when context adds value. For pending commit notes, use `review-notes`;
direct commit evidence needs no statistical co-change threshold.

## Scripts

Run the scripts in `../scripts/` in order: `mine.mjs` collects history,
`shortlist.mjs` ranks pairs, `explain.mjs` verifies their commit evidence.

### `mine.mjs` — produce the JSON corpus

Runs all 13 signals, writes `potential-implicit-semantic-dependencies.json`
alongside itself (untracked; regenerate as needed), and prints the report.

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

Reads that JSON and prints §0: pairs supported by multiple techniques,
with evidence and an `explain.mjs` invocation.

```bash
node scripts/shortlist.mjs                       # default JSON path
node scripts/shortlist.mjs --min-techniques=3    # only highly-supported pairs
node scripts/shortlist.mjs path/to/mine.json --top=10
```

Use the shortlist to select candidates; consult the full report for detail.

### `explain.mjs` — verify a single pair

Lists shared commits with subject, SHA, date and author.

```bash
node scripts/explain.mjs <fileA> <fileB>
node scripts/explain.mjs <fileA> <fileB> --since=2.years
```

Reject incidental co-change, such as unrelated fixes in one sweep.
Shared concerns warrant checking the contract; co-change alone proves none.

## End-to-End Workflow

Paths below name the installed plugin's skill directory
(`~/.gemini/config/plugins/git-span/skills/git-span/` — `agy plugin install`
copies the plugin, these scripts included, under
`~/.gemini/config/plugins/git-span/`). In a checkout of this repository the
same scripts live under `plugins-antigravity/git-span/skills/git-span/scripts/`;
prefer the installed copies.

**1. Mine.** From the repo root:

```bash
node ~/.gemini/config/plugins/git-span/skills/git-span/scripts/mine.mjs \
  --since=6.months --top=25 --no-gh
```

This writes `potential-implicit-semantic-dependencies.json` next to the
script and prints a 13-section report. Skim §0 of the report; the JSON is
for the next step.

**2. Shortlist.** Distill to actionable candidates:

```bash
node ~/.gemini/config/plugins/git-span/skills/git-span/scripts/shortlist.mjs \
  --min-techniques=2
```

Pairs firing in 3+ techniques are very likely real coupling. Pairs firing in
exactly 2 techniques deserve a look — verify with explain.

**3. Explain.** For each candidate worth pursuing:

```bash
node ~/.gemini/config/plugins/git-span/skills/git-span/scripts/explain.mjs \
  packages/foo/src/Foo.ts packages/bar/src/Bar.ts
```

Read the commit subjects. Ask:

- Does the pair preserve a contract, distinction or reminder that changes a likely decision?
- If the related anchor changed silently, what concrete wrong decision would I make?
- Are these the same bug recurring under different names? (SZZ signal)

If yes, choose a type in [the selector](span-types/index.md), then use the declaration
recipe in this skill. Co-change does not establish the rule or its authority.

### Dependency capabilities

For import/manifest candidates, inspect packaging, import-lint, build and runtime-profile
checks before describing protection. A checked inventory alone is usually redundant;
a span can still explain a capability promise or surprising check when that context
changes a decision. Consult [external protocols](span-types/external-protocol-and-environment-contracts.md)
for adapters, probes and vendored artifact identity, and [negative contracts](span-types/branch-specific-and-negative-contracts.md)
for optional-dependency absence behavior. Do not install dependencies or change runtime
policy during review. Test actual selected artifacts/capabilities rather than version
strings alone; adding a standard-library import does not falsify “stdlib-only”.

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

Here lag, churn, range and bug-fix evidence support investigating the
`emitMessage`/`handleMessage` contract. Verify its useful decision context
before declaring a span.

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

**Merge only distinct roles in one mechanism.** Name each anchor's role:
definer, consumer, gate, serializer, fixture or doc. Repeated roles suggest an
inventory that fires without a concrete obligation. For mirrored platform
copies, keep one span rather than one per pair (`add` rejects directory
roots). Anchor normative files and the parity mechanism; if nothing enforces
parity, anchor both sides instead.

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
