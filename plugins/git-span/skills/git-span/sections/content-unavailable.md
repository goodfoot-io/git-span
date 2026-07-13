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

**Known gap.** Of the six reasons above, `PromisorMissing` and `SparseExcluded`
are documented behavior the resolver does not yet actually construct — there
is no code path that emits either variant today. A partial-clone missing blob
or a sparse-checkout-excluded anchored path both currently surface as
`DELETED` instead, with `--fix` failing closed on them (nothing is corrupted),
but the `DELETED` guidance is misleading: the content is not gone, it's just
not materialized locally. If a `DELETED` finding's path is excluded by your
sparse-checkout cone (`git sparse-checkout list`) or missing only its blob in a
partial clone, treat it as this section's guidance (adjust the cone / fetch
unfiltered) rather than `DELETED`'s. `LfsNotFetched`, `LfsNotInstalled`,
`FilterFailed`, and `IoError` are all live and behave as documented.

## Why no auto-fetch

The resolver is intentionally local and predictable. A stale run should not reach across the network, start LFS downloads, or change sparse state as a side effect. If content is unavailable, the tool says so and lets the caller decide whether to fetch, adjust sparse config, or accept the gap.
