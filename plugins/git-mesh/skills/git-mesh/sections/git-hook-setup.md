# Git hook setup

**No mesh-specific git hooks are needed.**

A mesh is an ordinary tracked plain-text file under `.mesh/<name>`. `git mesh
add` / `remove` / `why` write that file directly, and you persist edits the same
way you persist any source change:

```bash
git add .mesh && git commit
```

There is nothing for a `post-commit` or `post-rewrite` hook to do. Do not
install one for mesh purposes; `git mesh doctor` does not check for any git
hook.

Meshes follow normal git history: a rebase or `git commit --amend` rewrites the
`.mesh/` file content along with everything else in the commit, and a fresh
clone gets the meshes via the same `git clone`/`git pull` that brings the code.

The converse also holds: an existing `post-commit` / `post-rewrite` hook is
**not evidence of mesh involvement**. Repos legitimately run unrelated tooling
from these hooks (version bumping, build steps, doc validation, etc.). Never
remove or rewrite such a hook on the assumption it exists for meshes — it does
not, and `git mesh` neither installs nor depends on it.

Mesh files are LF-pinned on all platforms automatically — no `core.autocrlf`
configuration is needed. The `.mesh/` directory contains a `.gitattributes`
that enforces `* text eol=lf`, so Windows and Unix checkouts produce identical
mesh content without any developer action.

The only related automation is the Claude Code mesh-overlap hook (PreToolUse),
which surfaces intersecting mesh anchors inline — see `./understanding-hook-output.md`.

## Optional merge driver

This is the one piece of git *config* meshes can use — and it is **optional**, not
required. Registering a merge driver makes git collapse the easy majority of
`.mesh/` conflicts in place during `git merge` so they never surface. Skipping it
costs nothing: `.mesh/**` falls back to git's line merge, and
`git mesh stale --fix` resolves the result afterward to the identical clean state
(see `./command-reference.md` § "Merge conflict resolution"). Registration has two
parts, because git distributes one and not the other:

```gitattributes
# committed and shared with the repo
.mesh/** merge=mesh
```

```ini
# .git/config — per-clone, NOT distributed by git; each clone adds it once
[merge "mesh"]
    name = git-mesh structural mesh merge
    driver = git mesh merge-driver %O %A %B %L
```

There is **no auto-installer** — registration is manual by design, and
`git mesh doctor` does not check for it. Never run `git mesh merge-driver` by
hand; git invokes it with the temp-file arguments shown above. Until a clone adds
the `.git/config` block, conflicts simply fall back to `--fix`.
