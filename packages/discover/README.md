# discover (internal workspace)

This private monorepo package discovers candidate **implicit couplings** in a git repository: groups of
files (or line ranges) that tend to change together although no type, test,
or schema enforces it. Uses only the repository's own tracked content and
ordinary git history — no external inputs, nothing tuned to any particular
repo.

It is a contributor tool, not a published package, and it only proposes candidates. A human or coding agent must confirm that a relationship is real before declaring a span.

## Workspace CLI

```bash
yarn workspace @cards.management/discover exec discover -- --repo /path/to/repo
```

Prints one candidate coupling per line, best first:

```
path/to/a.ts:L10-L42, path/to/b.sql
docs/setup.md, scripts/bootstrap.sh
```

Flags:

- `--repo <path>` — repository root (default: cwd)
- `--exclude <prefix>` — repo-relative prefix excluded from scanning,
  history, and output; repeatable
- `--max-candidates <n>` — cap on emitted groups (default 300)
- `--min-score <x>` — confidence floor in [0, 1] (default 0.5)
- `--no-messages` — disable the commit-message signal
- `--json <file>` — also write a JSON report with scores, contributing
  signals, and evidence tags

## API

```ts
import { discover, resolveConfig } from 'discover';

const { candidates } = discover('/path/to/repo', resolveConfig({ exclude: ['vendor'] }));
```

`discover` runs scan → history → signals → merge and returns the scan and
history snapshots plus ranked `Candidate` objects (`locs`, `score`,
contributing `signal` names, compact `evidence` tags).

## Signals

All signals are generic and self-calibrating against the repository:

1. **Commit-message path groups** — a message naming 2–5 current files
   asserts they changed for one reason; confidence scales with the repo's
   measured message quality (how often its messages name real paths).
2. **"Keep in sync" comments** — sync phrases ("keep in sync", "mirrors",
   "must match", "duplicated in", …) resolved to the paths or backticked
   identifiers they mention.
3. **Doc references** — doc pages citing code via line-anchored links form a
   group with their targets; documentation directories are detected by
   markdown share, and doc↔doc-only link networks are damped.
4. **Shared rare literals** — distinctive strings / ALL_CAPS constants /
   long numbers appearing in 2–4 files (import lines and dependency pins
   excluded).
5. **Near-clones** — winnowed fingerprints of normalized line shingles find
   copied regions across files, with the matched line ranges.
6. **impl↔test pairs** — per-language test-naming conventions, emitted only
   when corroborated by co-change or a shared literal.
7. **Manifest wiring** — adapter-gated; ships a VS Code adapter matching
   `contributes` ids to the files that register or read them.
8. **Code path literals** — scripts/CI/hooks embedding repo paths (module
   imports excluded — the module system already enforces those).
9. **Co-change mining** — logical change groups (same author + time window,
   ticket references) mined with hypergeometric significance and lift;
   percentile-based mega-commit exclusion; release/bump commits removed.

Merging combines same-set signals with attenuated noisy-or, damps doc-only
groups, drops weak subset/superset duplicates, and caps ranked output.

## Excluded from every signal

- generated/built files: `dist/`, `build/`, compiled `.js`/`.d.ts` siblings
  of same-stem TS sources, `@generated`/"do not edit" markers, and anything
  `.gitattributes` marks `linguist-generated`/`linguist-vendored`
- lockfiles, logs, caches, sourcemaps, minified bundles
- binary assets (still allowed as coupling *targets*, never scanned)
- version-bump/release commits and manifest↔changelog pairs (version
  numbers incrementing in unison are not semantic couplings)
- anything under `--exclude` prefixes — excluded paths never appear in any
  git invocation's output, any scanned content, or any emitted candidate
  (the merge layer re-asserts this and fails closed)
