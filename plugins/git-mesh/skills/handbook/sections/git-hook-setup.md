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

The only related automation is the optional Claude Code advice integration
(PreToolUse / PostToolUse / SessionEnd), which is unrelated to git hooks — see
`./understanding-hook-output.md` and `./using-advice.md`.
