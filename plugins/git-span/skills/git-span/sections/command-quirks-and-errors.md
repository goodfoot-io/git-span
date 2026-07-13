# Command quirks and errors

A span is a tracked plain-text file under `.span/<name>`. `git span add` /
`remove` / `why` edit that file in the working tree; you persist edits with
`git add .span && git commit`. There is no staging area and no `git span commit`
step.

## A span edit is not in history

If a teammate (or CI) does not see a span change you made, the edit was written
to `.span/<name>` but never committed. `git span add`/`remove`/`why` only touch
the working-tree file:

```bash
git status .span            # the edited span file shows as modified
git add .span && git commit -m "Update <name> span"
```

`git span show <name>` reflects the working-tree file immediately; teammates
only see it after the commit lands on a shared branch.

## First why on a new span

A new span has no prior why to inherit. A why is optional — `git span add`
succeeds without one — but it is strongly recommended.
Write one before (or alongside) the commit that introduces the span:

```bash
git span why <name> -m "Define the subsystem the anchors form"
git add .span && git commit -m "Add <name> span"
```

The why is inherited across routine re-anchors; only write a new one when the
subsystem itself changes.

## `git log --all` and span history

Spans are ordinary tracked files, so their history is just normal commit
history on whatever branch they live on — `git log --all` shows them only as
part of the commits that touched `.span/`. To see a single span's history:

```bash
git log --oneline -- .span/<name>
git log -p -- .span/<name>            # full diff of every edit
```

There are no custom span refs to exclude from `git log --all`.

## An unparseable `.span` file

If a span file is hand-edited into an invalid state (bad TOML, malformed anchor
line), `git span show`/`stale` fail on it and `git span doctor` reports it:

```
- ERROR — span `<name>` failed to parse: <message>
```

Fix the malformed file (revert it with `git checkout -- .span/<name>` if a
recent commit was good, or correct the syntax by hand) and re-run. This is
fail-closed: a span that cannot be parsed is surfaced, never silently skipped.

## Symlink anchors

`git span add` resolves and rejects a path that traverses a symbolic link —
anchor the real path instead:

```bash
readlink -f public/codex                # → public/claude/codex
git span add <name> public/claude/codex
```

## `git span doctor`

A setup audit, not a semantic-drift check. Its only
job is to confirm every visible span file under the span root parses; it reports
`ERROR — span <name> failed to parse: …` for any that don't. `--strict`
promotes findings to a non-zero exit. Run it when local behavior looks wrong.
