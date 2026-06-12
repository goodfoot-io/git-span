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
