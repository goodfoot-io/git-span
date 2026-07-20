# `CONTENT_UNAVAILABLE`

`CONTENT_UNAVAILABLE` means the content should exist but cannot be read locally without a network call. **The resolver never auto-fetches.** Every reason points at a specific fix.

## Reasons

- **`LfsNotFetched`** — LFS pointer resolves, real bytes not in local cache.
  Fix: `git lfs fetch`.
- **`LfsNotInstalled`** — No `git-lfs` binary on PATH.
  Fix: install `git-lfs`.
- **`PromisorMissing`** — Partial clone; blob not fetched from the promisor remote.
  Fix: `git fetch` with an unfiltered spec.
- **`SparseExcluded`** — Sparse-checkout excludes the path.
  Fix: adjust the sparse cone.
- **`FilterFailed`** — A custom smudge/clean filter returned non-zero.
  Fix: repair the filter driver; re-run.
- **`IoError`** — Local read failed for reasons unrelated to the above (permissions, missing file, etc.).
  Fix: investigate the specific error the resolver printed.

All six reasons above are live. `SparseExcluded` is raised when the deepest
drift layer reads as empty from the worktree and the anchored path is marked
skip-worktree (sparse-checkout excludes it). `PromisorMissing` is raised when
a git-object read for the index or HEAD layer fails and the repo has an
active promisor remote (partial clone), i.e. the blob simply hasn't been
fetched rather than being genuinely missing. Both checks run inline in the
resolver's anchor-drift path, immediately after the corresponding read
failure/emptiness is observed, so they surface before the code would
otherwise fall through to treating the anchor as `DELETED`.

## Why no auto-fetch

The resolver is intentionally local and predictable. A stale run should not reach across the network, start LFS downloads, or change sparse state as a side effect. If content is unavailable, the tool says so and lets the caller decide whether to fetch, adjust sparse config, or accept the gap.
