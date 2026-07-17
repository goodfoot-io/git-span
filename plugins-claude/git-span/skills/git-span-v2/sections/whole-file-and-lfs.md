# Whole-file anchors and LFS-tracked paths

## Whole-file anchors

Drop the `#L...` suffix at `git span add` to anchor an entire file. Output
shows `(whole)` in place of the line range. `CHANGED` then means "blob OID
differs" rather than "lines drifted" — no slice diff, no per-line culprit.

```bash
git span add brand-refresh marketing/hero.png
git span add api-contract-v2 vendor/openapi-spec
git span add diagram-refs docs/architecture.drawio
git span add charge-msa legal/msa.md
git add .span && git commit -m "Anchor brand and contract assets"
```

Use a whole-file anchor when the file is **consumed as a unit by name or
identity**:
- Images and binary assets pinned next to the copy that describes them
- Design diagrams alongside the code they document
- Prose whose identity is the contract: a license, a one-page ADR, a published
  RFC, a signed MSA
- Submodule roots (gitlink paths) — bumps surface for review without opening
  the submodule
- Symlinks — compared by target string
- Generated/minified assets and binary test fixtures

Whole-file is the **recommended default for prose spans**: line-range anchors
on prose drift noisily under editorial churn (heading renumbers, reflow,
rewrites that preserve meaning). When a prose `CHANGED` finding fires from
churn like that, treat it with the `Changed, coupling still holds` row in
`sections/triage.md` — re-anchor the same range/whole-file extent, don't
chase a "new" range just because the surrounding text moved.

## Rejections at `git span add`

- **Line-range anchor on a binary path, symlink, or a path inside a
  submodule** — rejected; use the whole-file form instead.
- **Whole-file anchor on a path *inside* a submodule** — rejected; only the
  submodule root itself accepts a whole-file anchor.

## LFS-tracked paths

Line-range anchors on `filter=lfs` paths behave like non-LFS anchors as long
as the content is locally cached — `git span add` reads real bytes through the
LFS filter and takes its anchored slice from them.

```bash
git lfs fetch
git span add perf-notes 'benchmarks/results.tsv#L1-L200'
```

If content is not cached, `git span add` fails pointing at `git lfs fetch`,
and a `stale` check surfaces `CONTENT_UNAVAILABLE` with reason `LfsNotFetched`
— see `./content-unavailable.md`. The fast path for whole-file LFS anchors is
pointer-OID equality (the git blob, not the smudged bytes), so those usually
resolve without the real content ever being fetched.

## Submodule roots

A whole-file anchor on the submodule path compares gitlink SHAs without
opening the submodule. Submodule bumps surface as `CHANGED` with no slice
diff — the signal to "review the related code before merging." A path that
becomes a submodule *after* it was anchored (directory promoted to a gitlink)
surfaces the `SUBMODULE` terminal status instead; see `./terminal-statuses.md`.

## Re-anchoring whole-file anchors

Same as line-range anchors: a second `git span add` over the same path is a
re-anchor (last-write-wins) — it rewrites the recorded hash in `.span/<name>`.

```bash
git span add brand-refresh marketing/hero.png
git add .span && git commit -m "Re-anchor brand-refresh"
```
