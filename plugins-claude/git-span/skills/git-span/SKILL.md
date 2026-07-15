---
name: git-span
description: Use with `git span` or spans.
---

<instructions>
- **`git span stale` output shows span anchors with `[CHANGED]`, `[MOVED]`, `FRESH`, `(ack)`, or `src=…` and the markers need interpreting**: Read `./sections/reading-stale-output.md`
- **A span anchor on a file just edited is drifting and a decision is needed (re-anchor, fix the related anchor, update the why, leave it), or resolver config or `delete` is in play**: Read `./sections/responding-to-drift.md`
- **About to add a span whose two sides are already joined by an import, a function call, a shared type, or a test that fails when one side breaks; or whose anchors span whole modules against their own helpers or tests (a frequent trap when bulk-resolving uncovered writes)**: that coupling is already enforced — do not span it. Read `./sections/creating-a-span.md` § "Should this be a span?" to confirm before adding.
- **A new relationship needs a span, or a span needs a name, why, anchor shape, or commit sequence**: Read `./sections/creating-a-span.md`
- **Candidates for a new span need discovering by mining git history for implicit semantic dependencies (co-change, SZZ, churn, lagged change, reviewer overlap, etc.)**: Read `./sections/finding-span-candidates.md`
- **A finding is `DELETED`, `MERGE_CONFLICT`, or `SUBMODULE`; or a `.span/` file carries git conflict markers and needs resolving (`git span stale --fix`)**: Read `./sections/terminal-statuses.md`
- **A finding is `CONTENT_UNAVAILABLE(...)`, or the failure involves LFS, partial clone, or sparse checkout**: Read `./sections/content-unavailable.md`
- **The anchor omits `#L…`, or the path is binary, image, symlink, submodule root, or LFS-tracked**: Read `./sections/whole-file-and-lfs.md`
- **A `git span` command errored or behaved unexpectedly (first why on a new span, an unparseable `.span` file, `git log --all` noise, `doctor`)**: Read `./sections/command-quirks-and-errors.md`
- **The job is CI wiring, PR gating, syncing spans across remotes, fresh-clone tolerance, or advisory reports**: Read `./sections/ci-and-sync.md`
- **A question asks what spans exist, what a span currently says, its history, which spans touch a given path/anchor, or how to trace the blast radius / impact tree of a change (`git span tree`)**: Read `./sections/inspecting-spans.md`
- **A `<git-span>` block appeared in `systemMessage`; or a question is about when the hook fires, why a block appeared or did not appear, or the once-per-session deduplication**: Read `./sections/understanding-hook-output.md`
- **Exact flag, subcommand, anchor grammar, or reserved-name lookup is needed**: Read `./sections/command-reference.md`
- **A question is about whether a git hook (`post-commit`, `post-rewrite`) is needed for spans, or about registering the optional `.span/` merge driver**: Read `./sections/git-hook-setup.md`
- **A question is about where spans/anchors are stored, whether git-span uses refs, or how span names map to files**: Read `./sections/storage-model.md`
- **A span should be hidden from the hooks for certain paths, or a `.span/.hookignore` file / per-path span suppression is in play**: Read `./sections/hookignore.md`
- **A question is about installing the git-span plugin under OpenAI Codex, the `codex plugin marketplace add` / `codex plugin add` flow, or trusting Codex hooks via the `/hooks` prompt**: Read `./sections/codex-install-and-trust.md`

**Note that full codebase validation is not required for span-only changes.**
</instructions>


