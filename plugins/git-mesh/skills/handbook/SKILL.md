---
name: handbook
description: Use with `git mesh` or meshes.
---

<instructions>
- **`git mesh stale` output shows mesh anchors with `[CHANGED]`, `[MOVED]`, `FRESH`, `(ack)`, or `src=…` and the markers need interpreting**: Read `./sections/reading-stale-output.md`
- **A mesh anchor on a file just edited is drifting and a decision is needed (re-anchor, fix the related anchor, update the why, leave it), or resolver config / `move` / `delete` is in play**: Read `./sections/responding-to-drift.md`
- **About to add a mesh whose two sides are already joined by an import, a function call, a shared type, or a test that fails when one side breaks; or whose anchors span whole modules against their own helpers or tests (a frequent trap when bulk-resolving uncovered writes)**: that coupling is already enforced — do not mesh it. Read `./sections/creating-a-mesh.md` § "Should this be a mesh?" to confirm before adding.
- **A new relationship needs a mesh, or a mesh needs a name, why, anchor shape, or commit sequence**: Read `./sections/creating-a-mesh.md`
- **Candidates for a new mesh need discovering by mining git history for implicit semantic dependencies (co-change, SZZ, churn, lagged change, reviewer overlap, etc.)**: Read `./sections/finding-mesh-candidates.md`
- **A finding is `DELETED`, `MERGE_CONFLICT`, or `SUBMODULE`**: Read `./sections/terminal-statuses.md`
- **A finding is `CONTENT_UNAVAILABLE(...)`, or the failure involves LFS, partial clone, or sparse checkout**: Read `./sections/content-unavailable.md`
- **The anchor omits `#L…`, or the path is binary, image, symlink, submodule root, or LFS-tracked**: Read `./sections/whole-file-and-lfs.md`
- **A `git mesh` command errored or behaved unexpectedly (first why on a new mesh, an unparseable `.mesh` file, `git log --all` noise, `doctor`)**: Read `./sections/command-quirks-and-errors.md`
- **The job is CI wiring, PR gating, `--since <merge-base>`, syncing meshes across remotes, fresh-clone tolerance, or advisory reports**: Read `./sections/ci-and-sync.md`
- **A question asks what meshes exist, what a mesh currently says, its history, or which meshes touch a given path/anchor**: Read `./sections/inspecting-meshes.md`
- **A `<git-mesh>` block appeared in `systemMessage`; or a question is about when the hook fires, why a block appeared or did not appear, or the once-per-session deduplication**: Read `./sections/understanding-hook-output.md`
- **Exact flag, subcommand, anchor grammar, or reserved-name lookup is needed**: Read `./sections/command-reference.md`
- **A question is about whether a git hook (`post-commit`, `post-rewrite`) is needed for meshes**: Read `./sections/git-hook-setup.md`
- **A question is about where meshes/anchors are stored, whether git-mesh uses refs, or how mesh names map to files**: Read `./sections/storage-model.md`

**Note that full codebase validation is not required for mesh-only changes.**
</instructions>


