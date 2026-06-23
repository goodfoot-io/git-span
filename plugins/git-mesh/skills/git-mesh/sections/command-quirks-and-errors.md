# Command quirks and errors

A mesh is a tracked plain-text file under `.mesh/<name>`. `git mesh add` /
`remove` / `why` edit that file in the working tree; you persist edits with
`git add .mesh && git commit`. There is no staging area and no `git mesh commit`
step.

## A mesh edit is not in history

If a teammate (or CI) does not see a mesh change you made, the edit was written
to `.mesh/<name>` but never committed. `git mesh add`/`remove`/`why` only touch
the working-tree file:

```bash
git status .mesh            # the edited mesh file shows as modified
git add .mesh && git commit -m "Update <name> mesh"
```

`git mesh show <name>` reflects the working-tree file immediately; teammates
only see it after the commit lands on a shared branch.

## First why on a new mesh

A new mesh has no prior why to inherit. A why is optional — `git mesh add`
succeeds without one — but it is strongly recommended.
Write one before (or alongside) the commit that introduces the mesh:

```bash
git mesh why <name> -m "Define the subsystem the anchors form"
git add .mesh && git commit -m "Add <name> mesh"
```

The why is inherited across routine re-anchors; only write a new one when the
subsystem itself changes.

## `git log --all` and mesh history

Meshes are ordinary tracked files, so their history is just normal commit
history on whatever branch they live on — `git log --all` shows them only as
part of the commits that touched `.mesh/`. To see a single mesh's history:

```bash
git log --oneline -- .mesh/<name>
git log -p -- .mesh/<name>            # full diff of every edit
```

There are no custom mesh refs to exclude from `git log --all`.

## An unparseable `.mesh` file

If a mesh file is hand-edited into an invalid state (bad TOML, malformed anchor
line), `git mesh show`/`stale` fail on it and `git mesh doctor` reports it:

```
- ERROR — mesh `<name>` failed to parse: <message>
```

Fix the malformed file (revert it with `git checkout -- .mesh/<name>` if a
recent commit was good, or correct the syntax by hand) and re-run. This is
fail-closed: a mesh that cannot be parsed is surfaced, never silently skipped.

## Symlink anchors

`git mesh add` resolves and rejects a path that traverses a symbolic link —
anchor the real path instead:

```bash
readlink -f public/codex                # → public/claude/codex
git mesh add <name> public/claude/codex
```

## `git mesh doctor`

A setup audit, not a semantic-drift check. Its only
job is to confirm every visible mesh file under the mesh root parses; it reports
`ERROR — mesh <name> failed to parse: …` for any that don't. `--strict`
promotes findings to a non-zero exit. Run it when local behavior looks wrong.
