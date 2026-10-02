# Cards workspace hook misclassifies ordinary JSON metadata as HTML sidecars

A Cards-provisioned Git workspace cannot commit ordinary generated metadata named `hooks.meta.json`: the deployed pre-commit validator treats it as a Cards HTML document sidecar and demands `hooks.html`. The rejection runs before the repository's original pre-commit hook, so the project's own validation never executes.

Verified on 2026-10-02 against the deployed Cards workspace dispatcher and validator. All witnesses used a disposable Git repository, synthetic files, and an original hook that records whether delegation occurred. No skip variable, hook override, or validation bypass was used to make a rejected case pass. This report does not implement a fix.

## Minimal reproduction

Prerequisite: the deployed Cards workspace hooks exist under `$HOME/.cards/workspace-hooks` and Node.js is available. This creates an isolated repository with no card metadata.

```bash
repro_dir=$(mktemp -d)
cd "$repro_dir"
git init -q
git config core.hooksPath "$HOME/.cards/workspace-hooks"
mkdir -p .cards original-hooks build
cat > original-hooks/pre-commit <<'HOOK'
#!/bin/sh
printf 'original hook ran\n' > original-hook-witness
HOOK
chmod +x original-hooks/pre-commit
printf '%s\n' "$repro_dir/original-hooks" > .cards/CARD_ORIGINAL_HOOK_PATH
printf '{"files":["hook.js"]}\n' > build/hooks.meta.json
git add build/hooks.meta.json
"$HOME/.cards/workspace-hooks/pre-commit"
printf 'hook exit: %s\n' "$?"
test -e original-hook-witness
printf 'original hook witness exit: %s\n' "$?"
```

Calling the dispatcher directly observes the same staged-index validation path that Git invokes during a commit, without creating a commit or needing an author identity.

Expected: Cards recognizes this as ordinary workspace data, does not require an HTML sibling, and delegates to the original hook. That hook decides whether project validation permits the commit.

Actual: dispatcher exit 1, no original-hook witness, and this exact diagnostic:

```text
build/hooks.meta.json: orphaned HTML sidecar — no matching build/hooks.html found
```

The contents are a normal generated-file inventory, `{"files":["hook.js"]}`, rather than Cards HTML presentation metadata. An unrelated schema or filename change is not required to demonstrate the defect.

## Mechanism

The deployed [sidecar classifier](/home/node/.cards/workspace-hooks/pre-commit.mjs#L23812-L23818) accepts `.meta.json` when its stem basename contains no dot and the synthesized `.html` path passes the HTML path classifier. The [HTML classifier](/home/node/.cards/workspace-hooks/pre-commit.mjs#L23805-L23810) excludes attachment directories and root `assets/`, but neither classifier distinguishes a card repository from an ordinary workspace or examines the JSON's role.

The [staged-file dispatcher](/home/node/.cards/workspace-hooks/pre-commit.mjs#L33454-L33472) applies those classifiers to every eligible staged file. The [HTML validator](/home/node/.cards/workspace-hooks/pre-commit.mjs#L33385-L33395) then derives `build/hooks.html` and rejects the missing staged sibling before reading or validating the metadata payload.

The [main validator](/home/node/.cards/workspace-hooks/pre-commit.mjs#L33624-L33647) starts from the current working directory and runs card-oriented pairing checks without a repository-kind boundary. This affects ordinary `.html` files as well as `.meta.json` files. Deletion pairing and changed-stylesheet revalidation also run before per-file dispatch, so regression coverage must include those paths rather than fixing only one filename classifier.

The [workspace shell dispatcher](/home/node/.cards/workspace-hooks/pre-commit#L35-L45) correctly propagates a Cards failure before executing the original hook. The defect is the validation applied to the workspace; bypassing that failure would weaken legitimate card validation and is not the expected resolution.

## Verified witnesses and regression expectations

| Staged input | Deployed result | Original hook ran | Required behavior |
|---|---|---|---|
| Ordinary workspace `build/hooks.meta.json`, `{"files":["hook.js"]}` | Exit 1, orphaned HTML sidecar | No | Cards accepts ordinary metadata; original hook runs |
| Ordinary workspace `config/settings.json`, `{"enabled":true}` | Exit 0 | Yes | Preserve acceptance and delegation |
| Ordinary workspace `public/page.html`, no Cards sidecar | Exit 1, orphaned HTML file | No | Cards does not impose card pairing on website HTML; original hook runs |
| Card repository `page.html`, missing `page.meta.json` | Exit 1, orphaned HTML file | No | Preserve fail-closed card pairing |
| Card repository `page.meta.json`, missing `page.html` | Exit 1, orphaned HTML sidecar | No | Preserve fail-closed card pairing |

The card witnesses included a card metadata file in the repository while staging only the orphaned member. They establish that both pairing errors still reject; they do not claim successful end-to-end validation of a complete card repository.

Additional regression witnesses should verify:

- A valid card HTML/sidecar pair still passes the complete Cards validator, and malformed card metadata, unsafe resource references, missing assets, symlink members, or one-sided pair deletion still fail.
- Ordinary workspace HTML, CSS, JSON metadata, and their deletion remain subject to the project's original hook rather than card document constraints.
- A passing Cards validation invokes the original hook exactly once and preserves its arguments and exit status; a legitimate Cards rejection never invokes it.
- A failing original hook still blocks the commit. Fixing the classification must not turn project validation into an optional step.

Only the five table rows were executed in this investigation; the additional witnesses describe acceptance coverage for a maintainer's fix.

## Impact and resolution boundary

Generated metadata with the common `.meta.json` suffix can block otherwise valid commits in any Cards-provisioned workspace. Ordinary website HTML has the same repository-boundary problem. The rejection is deterministic on staged paths and prevents the normal project validation boundary from running.

The desired outcome preserves strict HTML pairing inside card repositories and normal hook delegation inside ordinary workspaces. Keep the reproduction unchanged when verifying the fix; do not require users to rename legitimate metadata, create dummy HTML siblings, or disable hooks.
