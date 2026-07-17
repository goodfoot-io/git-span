# `CONTENT_UNAVAILABLE`

Content should exist but cannot be read locally without a network call. **The
resolver never auto-fetches** — it reports the reason and stops; fetching,
adjusting sparse config, or accepting the gap is the caller's decision.

## Reasons

- **`LfsNotFetched`** — LFS pointer resolves, real bytes not in local cache.
  Fix: `git lfs fetch`.
- **`LfsNotInstalled`** — No `git-lfs` binary on PATH.
  Fix: install `git-lfs`.
- **`PromisorMissing`** — Partial clone; blob not fetched from the promisor
  remote. Fix: `git fetch` with an unfiltered spec.
- **`SparseExcluded`** — Sparse-checkout excludes the path (skip-worktree).
  Fix: adjust the sparse cone.
- **`FilterFailed`** — A custom smudge/clean filter returned non-zero.
  Fix: repair the filter driver; re-run.
- **`IoError`** — Local read failed for reasons unrelated to the above
  (permissions, missing file, etc.). Fix: investigate the specific error the
  resolver printed.

Whole-file LFS anchors mostly avoid `LfsNotFetched` — see the pointer-OID
fast path in `./whole-file-and-lfs.md`.
