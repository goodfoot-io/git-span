#!/usr/bin/env bash
# Retire "stale" from git-span's vocabulary: `git span stale` becomes
# `git span drift`, and every identifier, filename, doc, plugin skill, CI
# step, bench cell and span name that spells the concept "stale" is renamed
# to spell it "drift". No alias, no compatibility shim.
#
# Usage:
#   ./scripts/rename-stale-to-drift.sh              # dry run (default): report only
#   ./scripts/rename-stale-to-drift.sh --diff [p..] # dry run + unified diff (all or given paths)
#   ./scripts/rename-stale-to-drift.sh --apply      # span moves, rewrite, git mv, rebuild,
#                                                   # re-anchor, verify, validate
#
# Flags:
#   --apply       Perform the rename (requires a clean tracked worktree).
#   --skip-post   With --apply: skip rebuild / re-anchor / yarn validate.
#   --diff [p..]  Dry run only: unified diff of the content rewrite.
#   --verify      Run only the post-apply acceptance checks against the current
#                 tree. Skips the pre-flight assertions, which by design read
#                 zero once the rename has landed.
#   --rewrite <p> Filter stdin through the content rewrite as if it were the
#                 file at pre-rename path <p>, and exit. Reproduces the expected
#                 post-rename bytes of any file from its pre-rename blob.
#
# ALLOWLIST, NOT DENYLIST. A repo-wide grep for "stale" returns ~1,700 hits
# and most are unrelated (the website story engine's stale clock, `wiki
# stale` — a different tool's subcommand, stale sockets in the browser
# skill). The script enumerates the roots it may touch and ignores
# everything else, so an unrelated hit can never be caught by accident.
#
# What it does, in order:
#   1. Span renames for the repo's own `.span/` spans whose *names* carry
#      the word. A span's name IS its path under `.span/` — there is no
#      index and no `git span` subcommand that renames one — so these are
#      plain `git mv`s, kept in their own step because they also have to
#      create the new `drift/` and `drift-fix/` parent directories and must
#      run before the content rewrite re-enumerates the tree.
#   2. Content rewrite of every allowlisted tracked file:
#        a. curated exclusions are sentinel-protected (false positives that
#           must survive verbatim),
#        b. a curated inflection pre-pass fixes English that the mechanical
#           substitution would mangle ("staleness" -> "drift", not
#           "driftness"; "stale spans" -> "drifted spans", not "drift
#           spans"; `anchor_status_is_stale_drift` -> `..._is_drift`, not
#           `..._is_drift_drift`),
#        c. then the mechanical, case-preserving STALE/Stale/stale ->
#           DRIFT/Drift/drift substitution.
#      Every curated rule carries an expected match count; a miss aborts.
#   3. Path renames via `git mv` for every allowlisted tracked path
#      containing "stale".
#   4. Post steps (unless --skip-post): rebuild the bundled agent hooks and
#      the git-span binary (which regenerates the man page), then re-anchor
#      `.span/` — the rewrite changed both the paths and the content that
#      anchors are hashed against — and require `git span drift` to be clean.
#   5. Verification: no "stale" left in allowlisted content or paths beyond
#      the curated exclusions; `FORMAT_VERSION` untouched; every bench cell
#      name still resolves to a `perf-baseline.json` key.
#   6. Final gate (unless --skip-post): `yarn validate` must exit 0.
#
# Deliberately NOT touched: `DriftSource` / `format_drift_label` /
# `src/cli/drift_label.rs` (pre-existing, correctly named, names the *source*
# an anchor drifted from); `FORMAT_VERSION` in `resolver/store/dto.rs` (the
# `StaleSummary` -> `DriftSummary` rename is source-level only — bincode
# encodes structurally and the struct has no `#[serde(rename)]`);
# `packages/website`, `packages/discover`, `.codex`, `.claude`; and generic
# cache/build/filesystem staleness that happens to live inside the allowlist
# (build-artifact cleanup, lock files, executable digests, stat identities,
# session pruning) — if the sentence would still be true in a tool with no
# concept of anchors, it is excluded, not renamed.
#
# `.span/` gets both treatments: names move in step 1 and
# content is rewritten (step 2) so anchor *paths* follow their renamed files.
# The `rk64:` digests and line ranges are left for the re-anchor step, which
# only has to relocate within a file it can actually find.

set -euo pipefail
LC_ALL=C
export LC_ALL

cd "$(git rev-parse --show-toplevel)"

SELF="scripts/rename-stale-to-drift.sh"

MODE=dry
SKIP_POST=0
SHOW_DIFF=0
DIFF_PATHS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --apply) MODE=apply ;;
        --dry-run) MODE=dry ;;
        --verify) MODE=verify ;;
        --rewrite) MODE=rewrite; REWRITE_PATH="$2"; shift ;;
        --skip-post) SKIP_POST=1 ;;
        --diff) SHOW_DIFF=1 ;;
        --*) echo "unknown flag: $1" >&2; exit 2 ;;
        *) DIFF_PATHS+=("$1") ;;
    esac
    shift
done

if [ "$SHOW_DIFF" -eq 1 ] && [ "$MODE" = apply ]; then
    echo "--diff is a dry-run option; drop --apply to preview" >&2
    exit 2
fi

say()     { printf '%s\n' "$*"; }
# Count matches without tripping `set -o pipefail` when grep finds nothing.
count_re()   { git grep -hoIE -- "$1" "${PATHSPEC[@]}" 2>/dev/null | wc -l || true; }
count_lit()  { grep -oF -- "$2" "$1" 2>/dev/null | wc -l || true; }
count_lit_all() { git grep -hoIF -- "$1" "${PATHSPEC[@]}" 2>/dev/null | wc -l || true; }
head_ln() { printf '\n== %s ==\n' "$*"; }

# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------

ALLOW_ROOTS=(
    packages/git-span
    packages/git-span-core
    packages/agent-hooks
    packages/extension
    wiki/guides
    wiki/meta
    plugins-claude/git-span
    plugins-codex/git-span
    scripts
    .github/workflows
    README.md
    CLAUDE.md
    .githooks
    .span
)

# Whole files excluded from both the rewrite and the rename. Every "stale" in
# them is ordinary cache/build/filesystem staleness — true of any tool that has
# no concept of anchors — so renaming it would be semantic damage, not cleanup.
EXCLUDE_FILES=(
    # Wipes leftover Rust build artifacts and a pre-per-worktree `./target`
    # symlink. Nothing to do with anchors; the filename stays too.
    packages/git-span/scripts/cleanup-stale-target.sh
    # `pruneStaleSessions` over month-old advisor session directories.
    packages/agent-hooks/test/common/memo-store.test.ts
    # One-shot, already-applied mesh->span rebrand script; its allowlist and
    # command references record what actually existed/ran at rebrand time
    # (e.g. `packages/git-mesh/src/cli/stale_fix.rs`, `git span stale --fix`).
    # Renaming "stale" inside it falsifies that historical record.
    scripts/rebrand-mesh-to-span.sh
)

# git-grep pathspec: the allowlist, minus this script and the excluded files.
PATHSPEC=("${ALLOW_ROOTS[@]}" ":!$SELF")
for f in "${EXCLUDE_FILES[@]}"; do PATHSPEC+=(":!$f"); done

is_excluded_file() {
    local f="$1" x
    for x in "${EXCLUDE_FILES[@]}"; do
        [ "$f" = "$x" ] && return 0
    done
    return 1
}

in_allowlist() {
    local f="$1" root
    [ "$f" = "$SELF" ] && return 1
    is_excluded_file "$f" && return 1
    for root in "${ALLOW_ROOTS[@]}"; do
        [ "$f" = "$root" ] && return 0
        case "$f" in "$root"/*) return 0 ;; esac
    done
    return 1
}

# ---------------------------------------------------------------------------
# Global exclusions: literal strings that must survive verbatim in EVERY file.
# Format: <literal phrase>|<expected repo-wide count>.
# These name things outside git-span's meaning of the word, and they appear in
# more than one file (source plus its esbuild bundles, or a script plus its
# callers), so pinning them per-file would rot.
# ---------------------------------------------------------------------------

GLOBAL_EXCLUSIONS=(
    # Prunes month-old advisor session directories off disk.
    'pruneStaleSessions|11'
    # Build-artifact cleanup script; not renamed, so neither are its callers
    # (package.json, cargo-build-system.md, with-target-lock.sh, and the
    # `.span/devops/shared-target-lock-mechanism` anchor into it).
    'cleanup-stale-target.sh|6'
    # Historical on-disk filename of the removed legacy `resolver/cache_v2` tier.
    # `store_differential.rs` still unlinks it by name; renaming it would silently
    # orphan the artifact on every machine that has one.
    'stale-cache.db|4'
)

# ---------------------------------------------------------------------------
# Per-file exclusions: in-allowlist false positives that must survive verbatim.
# Format: <file>|<literal phrase>|<expected count>.
# Three kinds: a different tool's subcommand (`wiki stale`), generic English
# about documentation or build output rotting, and cache/plumbing staleness
# that is not an anchor's drift status (lock files, executable digests, stat
# identities, cache keys).
# ---------------------------------------------------------------------------

EXCLUSIONS=(
    # A different tool's subcommand — the single most likely false positive.
    'wiki/meta/git-span-documentation-touchpoints.md|`wiki stale`|1'
    'wiki/meta/wiki-organization.md|`wiki stale`|1'

    # Generic English: documentation and build output rotting.
    'wiki/meta/wiki-organization.md|go stale at different rates|1'
    'wiki/guides/writing-span-whys.md|goes stale the day the file is renamed|1'
    'packages/git-span/tests/cases/cli_history/mod.rs|a stale copy of it living in a test|1'
    'packages/git-span/scripts/cargo-build-system.md|the stale-stamp|1'
    'packages/git-span/scripts/cargo-build-system.md|these subdirectories stale|1'

    # Cache / filesystem plumbing, not anchor drift.
    'packages/git-span/src/cli/commit.rs|a stale lock file|1'
    'packages/git-span/src/resolver/store/lock.rs|stale-lock ambiguity|1'
    'packages/git-span/src/resolver/core/token.rs|publishing under a stale key|1'
    'packages/git-span/src/resolver/core/exe_digest.rs|would serve a stale digest|1'
    'packages/git-span/src/resolver/core/exe_digest_store.rs|cross-invocation staleness|1'
    'packages/git-span/src/resolver/core/exe_digest_store.rs|not a stale hit|1'
    'packages/git-span/src/resolver/core/exe_digest_store.rs|the stale stat no longer matches|1'
    'packages/git-span/src/resolver/core/capture/tests.rs|stale-stat reuse|1'
    'packages/git-span/src/resolver/core/capture/tests.rs|the stale memo row|1'
    'packages/git-span/src/resolver/core/capture/tests.rs|overwrite the stale row|1'

    # A filename earlier releases really wrote. Renaming it would describe a
    # file that never existed; the surrounding "stale cache" prose still moves.

    # `.span/` declarations. The first two are why-prose about other tools; the
    # last two are ANCHORS into paths this rename does not move, so rewriting
    # them would point the anchor at a file that does not exist.
    '.span/marketing/homepage-engine-asset-types|.hdr is stale from a removed HDRI import|1'
    '.span/.advisorignore|for staleness detection|1'
    '.span/website-metadata-image-pipeline|reconcile-stale-spans.png|1'

    # Retirement machinery: the retired `stale` token in RETIRED_SPAN_NAMES,
    # the refusal's comments, and the tests that pin the rename. These lines
    # are the whole point of the retirement — rewriting them would un-pin the
    # guarantee that `stale` is refused and never routed to `show`.
    'packages/git-span-core/src/validation.rs|("stale", "drift")|1'
    'packages/git-span-core/src/validation.rs|`stale` was retired|1'
    'packages/git-span-core/src/validation.rs|name == "stale" && replacement == "drift"|1'
    'packages/git-span-core/src/validation.rs|stale -> drift|1'
    'packages/git-span-core/src/validation.rs|retired_replacement("stale")|1'
    'packages/git-span-core/src/validation.rs|is_reserved_span_name("stale")|1'
    'packages/git-span-core/src/validation.rs|is_reserved_span_name("stale-anchors")|1'
    'packages/git-span-core/src/validation.rs|validate_span_name_shape("stale")|1'
    'packages/git-span/src/main.rs|git span stale --format porcelain|1'
    'packages/git-span/src/main.rs|stopped `stale` from being routed to `show`|1'
    'packages/git-span/src/main.rs|must also reach `git span help stale`|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|when `stale` was renamed to|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|Removing `stale` from the reserved list|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|was spliced into `show`|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|`git span stale` still does not run|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|`git span stale` must name its replacement|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|retired_stale_names_drift_and_does_not_run|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|run_span(["stale"])?;|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|must not be misreported as a missing span|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|flags that `stale` used to|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|retired_stale_with_flags_still_gets_the_rename|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|vec!["stale", "--format", "porcelain"]|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|vec!["stale", "--fix"]|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|vec!["--perf", "stale"]|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|run_span(["add", "stale"|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|`git span help stale` must not fall through|1'
    "packages/git-span/tests/cases/retired_and_reserved_names.rs|unrecognized subcommand 'stale'|1"
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|run_span(["help", "stale"])|1'
    'packages/git-span/tests/cases/retired_and_reserved_names.rs|`help stale` must not reach clap|1'

    # Version-skew commentary: "stale" is the *plugin* being the stale
    # artifact after the binary moved on, or the old subcommand name in the
    # history of the version probe — the skew story is about which side
    # rotted, so the word is the subject.
    'packages/agent-hooks/src/common/advisor-core.ts|the plugin is the stale artifact|1'
    'packages/agent-hooks/src/common/advisor-core.ts|renamed the `stale` subcommand|1'
    'packages/agent-hooks/test/common/advisor-version-skew.test.ts|says which side is stale|1'
    'plugins-claude/git-span/hooks/bin/advisor.mjs|the plugin is the stale artifact|1'
    'plugins-codex/git-span/hooks/advisor.mjs|the plugin is the stale artifact|1'

    # Restored deliberate prose: sentences re-instated verbatim after the
    # rename because "stale" is the point of the sentence (the old extent a
    # mid-merge lookup left behind, the pre-fix worktree diff reuse, the
    # dead webview message that must not be re-posted).
    'packages/extension/src/spanViewer/spanFileEditorProvider.ts|re-posting a stale|1'
    'packages/git-span/tests/cases/cli_drift_fix_mid_merge.rs|leaving the old stale|1'
    'packages/git-span/tests/cases/cli_drift_fix_perf_equivalence.rs|risking a stale drift|1'
    'packages/git-span/src/cli/history.rs|a stale|1'

    # Reconcile skill trigger phrases: the description deliberately keeps the
    # pre-rename wording so a user who still says "stale spans" is routed to
    # the drift reconciler.
    'plugins-claude/git-span/skills/reconcile/SKILL.md|"fix stale spans"|1'
    'plugins-codex/git-span/skills/reconcile/SKILL.md|"fix stale spans"|1'
)

# ---------------------------------------------------------------------------
# Curated inflection pre-pass, applied to every allowlisted file.
# Format: <label>|<ERE match pattern, for counting>|<expected count>|<sed expr>
# Each pattern is counted across the allowlist before anything runs; a count
# mismatch means the tree moved under the script, and the run aborts.
# ---------------------------------------------------------------------------

PREPASS_GLOBAL=(
    # "staleness" is the noun for the condition; "drift" already is. Without
    # this rule the mechanical pass produces "driftness".
    'staleness|staleness|107|s/staleness/drift/g'
    'Staleness|Staleness|12|s/Staleness/Drift/g'
    'STALENESS|STALENESS|0|s/STALENESS/DRIFT/g'

    # Adjectival prose: "drifted spans" reads; "drift spans" does not. Only
    # the space-separated forms — `stale_spans`, `stale-spans` and
    # `resolve-stale-spans` are identifiers that must become `drift_spans`,
    # `drift-spans`, `resolve-drift-spans` and are left to the main pass.
    'stale span(s)|\bstale spans?\b|66|s/\bstale span/drifted span/g'
    'Stale span(s)|\bStale spans?\b|2|s/\bStale span/Drifted span/g'
    'stale anchor(s)|\bstale anchors?\b|16|s/\bstale anchor/drifted anchor/g'
    'Stale anchor(s)|\bStale anchors?\b|3|s/\bStale anchor/Drifted anchor/g'
    'stale declaration(s)|\bstale declarations?\b|6|s/\bstale declaration/drifted declaration/g'
    'stale-declaration|stale-declaration|2|s/stale-declaration/drifted-declaration/g'
    'Stale-span|Stale-span|1|s/Stale-span/Drifted-span/g'
    'non-stale|non-stale|10|s/non-stale/non-drifted/g'
    'Non-stale|Non-stale|2|s/Non-stale/Non-drifted/g'

    # "stale drift" is already tautological once "stale" becomes "drift";
    # the mechanical pass would emit "drift drift" / "_drift_drift".
    'stale drift (prose)|\bstale drift\b|5|s/\bstale drift\b/drift/g'
    'anchor_status_is_stale_drift|anchor_status_is_stale_drift|12|s/anchor_status_is_stale_drift/anchor_status_is_drift/g'
    'stale_drift_boundary|stale_drift_boundary|1|s/stale_drift_boundary/drift_boundary/g'

    # `drift_stale_fix_sources` dirties the sources the stale-fix bench runs
    # against — "drift" there is the verb. `drift_drift_fix_sources` is
    # unreadable; `dirty_` matches the neighbouring `dirty-tree-*` cells.
    'drift_stale_fix_sources|drift_stale_fix_sources|4|s/drift_stale_fix_sources/dirty_drift_fix_sources/g'

    # Predicate adjective: "the recorded hash is stale" -> "is drifted", never
    # "is drift". Runs before the noun rule below so "is stale via …" resolves
    # once. `NOT stale` is spelled separately because the pass is case-sensitive.
    'is stale|\bis stale\b|22|s/\bis stale\b/is drifted/g'
    'are stale|\bare stale\b|9|s/\bare stale\b/are drifted/g'
    'be stale|\bbe stale\b|3|s/\bbe stale\b/be drifted/g'
    'as stale|\bas stale\b|7|s/\bas stale\b/as drifted/g'
    'not stale|\bnot stale\b|5|s/\bnot stale\b/not drifted/g'
    'NOT stale|\bNOT stale\b|1|s/\bNOT stale\b/NOT drifted/g'
    'remains stale|\bremains stale\b|1|s/\bremains stale\b/remains drifted/g'
    'already stale|\balready stale\b|1|s/\balready stale\b/already drifted/g'
    'semantically stale|\bsemantically stale\b|1|s/\bsemantically stale\b/semantically drifted/g'
    'becomes stale|\bbecomes stale\b|1|s/\bbecomes stale\b/becomes drifted/g'
    'stale or|\bstale or\b|5|s/\bstale or\b/drifted or/g'
    'stale git spans|\bstale git spans\b|2|s/\bstale git spans\b/drifted git spans/g'

    # "go stale" is the verb the noun "drift" already covers: "expected to go
    # stale too" -> "expected to drift too". Two of these counts are the
    # curated exclusions, which the sentinels protect before this rule runs.
    'goes stale|\bgoes stale\b|2|s/\bgoes stale\b/drifts/g'
    'go stale|\bgo stale\b|3|s/\bgo stale\b/drift/g'

)

# Attributive adjective in front of a noun that is NOT the subcommand:
# "a stale lock file", "the stale row", "its stale location". Nouns that
# belong to the subcommand instead — output, findings, report(s), scan, run,
# cache, path, summary, block, rows, pill — are deliberately absent, so those
# become "drift output", "drift rows", "the Drift pill". Kept as its own array
# because the alternation would collide with the `|` field separator above.
ADJ_NOUNS=(
    range replay reuse verdict porcelain subset one original exact failure
    generation head heads HEAD location extents baseline stored
    same-head recorded result why deleted-anchor header-only starting
    path-index B1
)
ADJ_NOUNS_EXPECTED=48
ADJ_ALT=$(IFS='|'; printf '%s' "${ADJ_NOUNS[*]}")
ADJ_ERE="\\bstale ($ADJ_ALT)\\b"
ADJ_SED="s/\\bstale \\(${ADJ_ALT//|/\\|}\\)\\b/drifted \\1/g"
PREPASS_GLOBAL+=("stale <noun>|@ADJ@|$ADJ_NOUNS_EXPECTED|$ADJ_SED")

# ---------------------------------------------------------------------------
# Per-file curated fixes. Same format, plus a leading file.
# Format: <file>|<label>|<ERE match pattern>|<expected count>|<sed expr>
# ---------------------------------------------------------------------------

PREPASS_CURATED=(
    # Subject of the sentence is the drifted anchors, not the subcommand.
    'packages/git-span/tests/cases/cli_stale_renderers.rs|Stale get suffix|Stale get suffix|1|s/Stale get suffix/Drifted get suffix/'
    # Frontmatter keyword list: "stale" and "drift" are both already present,
    # so the mechanical pass would leave a duplicate keyword behind.
    # "the stale clean baseline" is the cached clean verdict, not `git span
    # stale`; `clean` stays out of the global noun list because `stale
    # clean-span` elsewhere is a subcommand plus a span-name positional.
    'packages/git-span/tests/cases/dirty_differential.rs|stale clean baseline|the stale clean baseline|1|s/the stale clean baseline/the drifted clean baseline/'
    'wiki/guides/reconciliation-authority.md|keywords dedupe|keywords: \[reconcile, stale, drift,|1|s/keywords: \[reconcile, stale, drift,/keywords: [reconcile, drift,/'
)

# ---------------------------------------------------------------------------
# The mechanical pass. Case-preserving; substring, so `stale_spans`,
# `StalePorcelainRow`, `staleRow`, `stale-fix` and `cli_stale_human.rs` all
# move. `stale_`/`stale-` separators are preserved as `drift_`/`drift-`.
# ---------------------------------------------------------------------------

MAIN_SED='
s/STALE/DRIFT/g
s/Stale/Drift/g
s/stale/drift/g
'

# ---------------------------------------------------------------------------
# `.span/` span names. A span's name is exactly its path under `.span/`, so
# renaming one is a `git mv` of the declaration file; they are listed here
# rather than derived because two of them are not mechanical.
# `history-stale-shared-drift-rendering` reads
# "history and stale share drift rendering" — the mechanical name would be
# `history-drift-shared-drift-rendering`, so it is spelled out here.
# ---------------------------------------------------------------------------

SPAN_RENAMES=(
    'stale/content-unavailable-sparse-promisor|drift/content-unavailable-sparse-promisor'
    'stale/resolved-pending-commit-state|drift/resolved-pending-commit-state'
    'stale/submodule-orphan-classification|drift/submodule-orphan-classification'
    'stale-fix/interior-anchor-soundness-gate|drift-fix/interior-anchor-soundness-gate'
    'stale-fix-output-equivalence-guard|drift-fix-output-equivalence-guard'
    'git-span/stale-fix/hash-canonicalization|git-span/drift-fix/hash-canonicalization'
    'git-span/stale-fix/line-range-coalescing|git-span/drift-fix/line-range-coalescing'
    'git-span/stale-positional-filtering|git-span/drift-positional-filtering'
    'git-span/history-stale-shared-drift-rendering|git-span/history-drift-shared-rendering'
)

# ---------------------------------------------------------------------------
# Coupled key pairs that must move together or a gate silently loses its
# baseline: `real_corpus.rs` cell names are literal keys in
# `perf-baseline.json` (including inside its `_comment` prose).
# ---------------------------------------------------------------------------

BASELINE_FILE=packages/git-span/benches/perf-baseline.json
CORPUS_FILE=packages/git-span/benches/real_corpus.rs
COUPLED_BENCH_KEYS=(stale-cold stale-warm dirty-tree-stale-warm stale-fix)

RESERVED_FILE=packages/git-span-core/src/validation.rs
DTO_FILE=packages/git-span/src/resolver/store/dto.rs

# Read the pinned value from HEAD, not the worktree, so `--verify` after an
# uncommitted apply compares against the same pre-rename baseline `--apply` does.
FORMAT_VERSION_BEFORE=$(git show "HEAD:$DTO_FILE" | grep -oE 'FORMAT_VERSION: u8 = [0-9]+' | head -1 || true)

# ---------------------------------------------------------------------------
# Verification: the acceptance checks, callable on their own via --verify so a
# tree that has already been rewritten can be re-checked without re-running the
# (deliberately non-idempotent) rename.
# ---------------------------------------------------------------------------

run_verification() {
    head_ln "verification"
    FAIL=0

    # Paths that keep the word on purpose: this script, and the wholly excluded
    # files (build-artifact cleanup, session pruning) whose *names* carry it too.
    PATH_EXEMPT_ARGS=(-e "$SELF")
    for f in "${EXCLUDE_FILES[@]}"; do PATH_EXEMPT_ARGS+=(-e "$f"); done
    LEFTOVER_PATHS=$( { git ls-files -- "${ALLOW_ROOTS[@]}" | grep -i stale || true; } \
        | grep -vxF "${PATH_EXEMPT_ARGS[@]}" || true)
    if [ -n "$LEFTOVER_PATHS" ]; then
        printf '%s\n' "$LEFTOVER_PATHS"
        say "FAIL: allowlisted paths above still contain 'stale'"
        FAIL=1
    fi

    RESIDUAL=$(git grep -inI stale -- "${PATHSPEC[@]}" || true)
    if [ -n "$RESIDUAL" ]; then
        HARD="$RESIDUAL"
        for entry in "${GLOBAL_EXCLUSIONS[@]}"; do
            phrase="${entry%|*}"
            HARD=$(printf '%s\n' "$HARD" | grep -vF -- "$phrase" || true)
        done
        for entry in "${EXCLUSIONS[@]}"; do
            phrase="${entry#*|}"; phrase="${phrase%|*}"
            HARD=$(printf '%s\n' "$HARD" | grep -vF -- "$phrase" || true)
        done
        if [ -n "$HARD" ]; then
            say "FAIL: residual 'stale' in allowlisted content:"
            printf '%s\n' "$HARD" | cut -c1-160
            FAIL=1
        else
            say "residual 'stale' is exactly the ${#GLOBAL_EXCLUSIONS[@]} global + ${#EXCLUSIONS[@]} per-file curated exclusions"
        fi
    fi

    FORMAT_VERSION_AFTER=$(grep -oE 'FORMAT_VERSION: u8 = [0-9]+' "$DTO_FILE" | head -1 || true)
    if [ "$FORMAT_VERSION_AFTER" != "$FORMAT_VERSION_BEFORE" ]; then
        say "FAIL: FORMAT_VERSION changed ($FORMAT_VERSION_BEFORE -> $FORMAT_VERSION_AFTER);"
        say "      the DriftSummary rename is source-level only"
        FAIL=1
    fi

    if ! grep -qF '"drift",' "$RESERVED_FILE"; then
        say "FAIL: RESERVED_SPAN_NAMES lost the subcommand token"
        FAIL=1
    fi

    # Every bench cell name emitted by real_corpus.rs must resolve to a
    # perf-baseline.json key, or the no-regression gate silently loses its baseline.
    for key in "${COUPLED_BENCH_KEYS[@]}"; do
        new_key=$(printf '%s' "$key" | sed -e "$MAIN_SED")
        if ! grep -qF "\"$new_key\"" "$BASELINE_FILE" || ! grep -qF "\"$new_key\"" "$CORPUS_FILE"; then
            say "FAIL: bench cell/baseline pair out of lockstep: $new_key"
            FAIL=1
        fi
    done

    if [ "$FAIL" -ne 0 ]; then
        echo "verification failed" >&2
        exit 1
    fi
    say "verification passed"
}

# ---------------------------------------------------------------------------
# Rewrite pipeline
# ---------------------------------------------------------------------------

# Byte sentinels for exclusion protection; neither appears in tracked text.
S1=$'\001'
S2=$'\002'

sed_escape() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

rewrite_stream() {
    local file="$1" prog="" entry phrase i=0

    # a0. protect repo-wide exclusions (own sentinel namespace: `g<index>`)
    for entry in "${GLOBAL_EXCLUSIONS[@]}"; do
        phrase="${entry%|*}"
        prog+="s/$(sed_escape "$phrase")/${S1}g${i}${S2}/g"$'\n'
        i=$((i + 1))
    done
    i=0

    # a. protect curated exclusions
    for entry in "${EXCLUSIONS[@]}"; do
        if [ "${entry%%|*}" = "$file" ]; then
            phrase="${entry#*|}"; phrase="${phrase%|*}"
            prog+="s/$(sed_escape "$phrase")/${S1}${i}${S2}/g"$'\n'
        fi
        i=$((i + 1))
    done

    # b. per-file curated fixes, then the global inflection pre-pass
    for entry in "${PREPASS_CURATED[@]}"; do
        if [ "${entry%%|*}" = "$file" ]; then
            prog+="$(printf '%s' "$entry" | cut -d'|' -f5-)"$'\n'
        fi
    done
    for entry in "${PREPASS_GLOBAL[@]}"; do
        prog+="$(printf '%s' "$entry" | cut -d'|' -f4-)"$'\n'
    done

    # c. mechanical pass
    prog+="$MAIN_SED"

    # d. restore exclusions
    i=0
    for entry in "${EXCLUSIONS[@]}"; do
        if [ "${entry%%|*}" = "$file" ]; then
            phrase="${entry#*|}"; phrase="${phrase%|*}"
            prog+="s/${S1}${i}${S2}/$(sed_escape "$phrase")/g"$'\n'
        fi
        i=$((i + 1))
    done

    # d0. restore repo-wide exclusions
    i=0
    for entry in "${GLOBAL_EXCLUSIONS[@]}"; do
        phrase="${entry%|*}"
        prog+="s/${S1}g${i}${S2}/$(sed_escape "$phrase")/g"$'\n'
        i=$((i + 1))
    done

    sed -e "$prog"
}

map_path() { printf '%s' "$1" | sed -e "$MAIN_SED"; }

# `--rewrite <pre-rename-path>`: filter stdin through the same rewrite the apply
# step uses, as if the stream were that file. Lets an auditor reproduce the
# expected post-rename bytes of any file from its pre-rename blob, so "the whole
# diff is exactly this rename" is checkable rather than asserted.
if [ "$MODE" = rewrite ]; then
    rewrite_stream "$REWRITE_PATH"
    exit 0
fi

# ---------------------------------------------------------------------------
# Enumerate allowlisted tracked files
# ---------------------------------------------------------------------------

# Refuse symlinks: sed -i would rewrite the target through the link.
if git ls-files -s -- "${ALLOW_ROOTS[@]}" | awk '$1 == 120000 { exit 1 }'; then :; else
    echo "tracked symlinks present under the allowlist; teach the script about them first" >&2
    exit 1
fi

mapfile -d '' -t ALL_TRACKED < <(git ls-files -z)

SCOPED=()
for f in "${ALL_TRACKED[@]}"; do
    in_allowlist "$f" && SCOPED+=("$f")
done

mapfile -t TOUCHED < <(git grep -lI -i stale -- "${PATHSPEC[@]}" || true)

if [ "$MODE" = verify ]; then
    run_verification
    exit 0
fi

# ---------------------------------------------------------------------------
# Pre-flight report (both modes)
# ---------------------------------------------------------------------------

head_ln "rename stale -> drift ($MODE run)"
say "tracked files:                    ${#ALL_TRACKED[@]}"
say "allowlisted tracked files:        ${#SCOPED[@]}"
say "allowlisted files with 'stale':   ${#TOUCHED[@]}"
say "'stale' occurrences (any case):   $(count_re '[Ss][Tt][Aa][Ll][Ee]')"

head_ln "allowlist containment"
OUT_OF_SCOPE=0
for f in "${TOUCHED[@]}"; do
    if ! in_allowlist "$f"; then
        say "OUT OF ALLOWLIST: $f"
        OUT_OF_SCOPE=$((OUT_OF_SCOPE + 1))
    fi
done
say "touched paths outside the allowlist: $OUT_OF_SCOPE"
if [ "$OUT_OF_SCOPE" -ne 0 ]; then
    echo "allowlist containment failed" >&2
    exit 1
fi
say "untouched by construction: packages/website, packages/discover, .codex, .claude"

head_ln "step 0: curated assertions"
MISS=0
for entry in "${GLOBAL_EXCLUSIONS[@]}"; do
    phrase="${entry%|*}"; want="${entry##*|}"
    got=$(count_lit_all "$phrase")
    if [ "$got" -ne "$want" ]; then
        say "GLOBAL EXCLUSION MISS ($got matches, want $want): $phrase"
        MISS=1
    else
        say "exclude* [$got] (repo-wide) :: $phrase"
    fi
done
for entry in "${EXCLUSIONS[@]}"; do
    file="${entry%%|*}"; rest="${entry#*|}"
    phrase="${rest%|*}"; want="${rest##*|}"
    got=$(count_lit "$file" "$phrase")
    if [ "$got" -ne "$want" ]; then
        say "EXCLUSION MISS ($got matches, want $want): $file :: $phrase"
        MISS=1
    else
        say "exclude  [$got] $file :: $phrase"
    fi
done
for entry in "${PREPASS_GLOBAL[@]}"; do
    label=$(printf '%s' "$entry" | cut -d'|' -f1)
    pat=$(printf '%s' "$entry" | cut -d'|' -f2)
    want=$(printf '%s' "$entry" | cut -d'|' -f3)
    [ "$pat" = '@ADJ@' ] && pat="$ADJ_ERE"
    got=$(count_re "$pat")
    if [ "$got" -ne "$want" ]; then
        say "PREPASS MISS ($got matches, want $want): $label"
        MISS=1
    else
        say "prepass  [$got] $label"
    fi
done
for entry in "${PREPASS_CURATED[@]}"; do
    file=$(printf '%s' "$entry" | cut -d'|' -f1)
    label=$(printf '%s' "$entry" | cut -d'|' -f2)
    pat=$(printf '%s' "$entry" | cut -d'|' -f3)
    want=$(printf '%s' "$entry" | cut -d'|' -f4)
    got=$(grep -cE -- "$pat" "$file" 2>/dev/null || true)
    # A curated file the rename deleted (e.g. `cli_stale_renderers.rs`)
    # makes grep fail, leaving `got` empty and `[ -ne ]` an arithmetic
    # error; default to 0 so the MISS branch fires instead of skipping
    # silently.
    got=${got:-0}
    if [ "$got" -ne "$want" ]; then
        say "CURATED MISS ($got matches, want $want): $file :: $label"
        MISS=1
    else
        say "curated  [$got] $file :: $label"
    fi
done

# Coupled bench keys: each must exist on both sides before the rename.
for key in "${COUPLED_BENCH_KEYS[@]}"; do
    b=$(count_lit "$BASELINE_FILE" "\"$key\"")
    c=$(count_lit "$CORPUS_FILE" "\"$key\"")
    if [ "$b" -lt 1 ] || [ "$c" -lt 1 ]; then
        say "COUPLED KEY MISS: $key (baseline=$b corpus=$c)"
        MISS=1
    else
        say "coupled  [baseline=$b corpus=$c] $key"
    fi
done

# RESERVED_SPAN_NAMES carries the subcommand list; the "stale" token must
# track the rename or `drift` stays a legal span name.
RES=$(count_lit "$RESERVED_FILE" '"stale",')
if [ "$RES" -ne 1 ]; then
    say "RESERVED TOKEN MISS ($RES matches, want 1): $RESERVED_FILE"
    MISS=1
else
    say "reserved [1] $RESERVED_FILE :: \"stale\" -> \"drift\""
fi

if [ -z "$FORMAT_VERSION_BEFORE" ]; then
    say "FORMAT_VERSION not found in $DTO_FILE"
    MISS=1
else
    say "pinned   $DTO_FILE :: $FORMAT_VERSION_BEFORE (must not change)"
fi

if [ "$MISS" -ne 0 ]; then
    echo "curated rules are out of date with the tree; fix the lists before running." >&2
    echo "If the counts above are ZERO, the most likely explanation is that the rename" >&2
    echo "has already been applied -- this script is not idempotent, and refusing to" >&2
    echo "run twice is deliberate. Check 'git log' before editing any counts." >&2
    exit 1
fi

head_ln "step 1: span renames (git mv under .span/)"
for entry in "${SPAN_RENAMES[@]}"; do
    old="${entry%%|*}"; new="${entry#*|}"
    if [ -e ".span/$old" ]; then
        say "  .span/$old -> .span/$new"
    else
        say "  MISSING SPAN: .span/$old"
        MISS=1
    fi
done
say "total span renames: ${#SPAN_RENAMES[@]}"
LEFTOVER_SPANS=$( { git ls-files -- .span | grep -i stale | sed 's|^\.span/||' || true; } | grep -vxF -f <(
    for entry in "${SPAN_RENAMES[@]}"; do printf '%s\n' "${entry%%|*}"; done
) || true)
if [ -n "$LEFTOVER_SPANS" ]; then
    say "UNLISTED .span paths containing 'stale':"
    printf '  %s\n' $LEFTOVER_SPANS
    MISS=1
fi
if [ "$MISS" -ne 0 ]; then
    echo "span rename list is out of date with .span/" >&2
    exit 1
fi

head_ln "step 3: path renames (git mv)"
RENAME_OLD=()
RENAME_NEW=()
for f in "${SCOPED[@]}"; do
    # `.span/` paths ARE span names, so they move in step 1, which also
    # creates the new parent directories the names imply. The
    # unlisted-span guard above proves SPAN_RENAMES covers all of them.
    case "$f" in .span/*) continue ;; esac
    case "$f" in
        *[Ss]tale*|*STALE*)
            new=$(map_path "$f")
            RENAME_OLD+=("$f")
            RENAME_NEW+=("$new")
            say "  $f -> $new"
            ;;
    esac
done
say "total file renames: ${#RENAME_OLD[@]}"
for i in "${!RENAME_NEW[@]}"; do
    if [ -e "${RENAME_NEW[$i]}" ]; then
        say "RENAME COLLISION: ${RENAME_NEW[$i]} already exists"
        MISS=1
    fi
done
if [ "$MISS" -ne 0 ]; then
    echo "a rename target already exists; resolve before running" >&2
    exit 1
fi

head_ln "step 4-6: post steps (apply mode)"
if [ "$SKIP_POST" -eq 1 ]; then
    say "SKIPPED (--skip-post): hook rebuild; git-span build; re-anchor; yarn validate"
    say "  (verification still runs)"
else
    say "yarn workspace agent-hooks build          # bundled hooks embed the renamed source"
    say "yarn workspace git-span build   # release binary + regenerated man page"
    say "git span drift --fix && git span drift    # re-anchor .span/, confirm clean"
    say "yarn validate                             # full typecheck/lint/test/build gate"
fi

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

if [ "$MODE" = dry ]; then
    if [ "$SHOW_DIFF" -eq 1 ]; then
        head_ln "content diff preview"
        if [ ${#DIFF_PATHS[@]} -gt 0 ]; then
            PREVIEW=()
            for f in "${DIFF_PATHS[@]}"; do
                if in_allowlist "$f"; then
                    PREVIEW+=("$f")
                else
                    say "skipping (outside allowlist): $f"
                fi
            done
        else
            PREVIEW=("${TOUCHED[@]}")
        fi
        for f in "${PREVIEW[@]}"; do
            rewrite_stream "$f" <"$f" | diff -u --label "a/$f" --label "b/$f" "$f" - || true
        done
    fi
    head_ln "dry run complete — nothing changed. Re-run with --apply to execute."
    exit 0
fi

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

# The guard exists so that after apply, `git diff` IS the rename and nothing
# else. Uncommitted edits to this script are exempt: it is excluded from both
# the rewrite and the path renames, so it cannot contaminate that diff.
if [ -n "$(git status --porcelain --untracked-files=no -- . ":!$SELF")" ]; then
    echo "tracked worktree is not clean; commit or stash first" >&2
    exit 1
fi

head_ln "applying span renames"
for entry in "${SPAN_RENAMES[@]}"; do
    old="${entry%%|*}"; new="${entry#*|}"
    mkdir -p ".span/$(dirname "$new")"
    git mv ".span/$old" ".span/$new"
done
say "spans renamed: ${#SPAN_RENAMES[@]}"
# `git mv` empties `.span/stale/` and `.span/*/stale-fix/` but leaves the
# directories on disk; git does not track them, so nothing else would.
find .span -mindepth 1 -type d -empty -delete

# `git span move` renamed files out from under the list captured at startup, so
# re-enumerate before rewriting content or the moved declarations are skipped.
# Stage first: whether the move leaves the new path untracked is git-span's
# business, and `git ls-files` only sees the index.
git add -A .span
mapfile -d '' -t ALL_TRACKED < <(git ls-files -z)
SCOPED=()
for f in "${ALL_TRACKED[@]}"; do
    in_allowlist "$f" && SCOPED+=("$f")
done

head_ln "applying content rewrite"
CHANGED=0
for f in "${SCOPED[@]}"; do
    grep -qiI -e stale -- "$f" || continue
    tmp="$f.rename.tmp"
    rewrite_stream "$f" <"$f" >"$tmp"
    if cmp -s "$f" "$tmp"; then
        rm -f "$tmp"
    else
        chmod --reference="$f" "$tmp"
        mv "$tmp" "$f"
        CHANGED=$((CHANGED + 1))
    fi
done
say "files rewritten: $CHANGED"

head_ln "applying path renames"
for i in "${!RENAME_OLD[@]}"; do
    old="${RENAME_OLD[$i]}"; new="${RENAME_NEW[$i]}"
    mkdir -p "$(dirname "$new")"
    git mv "$old" "$new"
done
say "paths renamed: ${#RENAME_OLD[@]}"

if [ "$SKIP_POST" -eq 0 ]; then
    head_ln "post: rebuild bundled agent hooks"
    yarn workspace agent-hooks build

    head_ln "post: build git-span (binary + man page)"
    yarn workspace git-span build

    head_ln "post: re-anchor .span/"
    BIN_DIR="${GIT_SPAN_CARGO_TARGET_ROOT:-$HOME/.cache/git-span/cargo-target}/git-span/build/release"
    if [ ! -x "$BIN_DIR/git-span" ]; then
        echo "expected binary at $BIN_DIR/git-span not found" >&2
        exit 1
    fi
    PATH="$BIN_DIR:$PATH" git span drift --fix || true
    PATH="$BIN_DIR:$PATH" git span drift
fi

run_verification

if [ "$SKIP_POST" -eq 0 ]; then
    head_ln "final gate: yarn validate"
    yarn validate
fi

head_ln "done"
say "review with: git status; git diff --stat HEAD"
say "this script is now the only file still named 'stale' — delete it after committing."
