# agent-hooks

This project contains hooks for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/hooks) (built with `@goodfoot/claude-code-hooks`) and OpenAI Codex (built with `@goodfoot/codex-hooks`) that keep `.span/` spans reconciled in-session, without a background pipeline or a separate commit. Two harness-agnostic cores in `src/common/` drive both harnesses' adapters:

- **`touch-core.ts`** — the `PostToolUse` touch hook (Claude matcher `Read|Edit|Write`, Codex matcher `apply_patch`). Fires synchronously after each file read/edit/write, re-anchors pure positional drift against the edit's real post-edit content silently, and — only when genuine semantic drift survives that heal — injects a bounded `<git-span>` context block, deduplicated per span-per-status-per-session.
- **`gate-core.ts`** — the `PreToolUse` commit gate (Claude matcher `Bash`, Codex matcher `Bash|shell|exec|local_shell`). Fires before `git commit`/`git push`, resolves the actual changeset (staged files, plus tracked-modified files under `-a`/`-am`), and denies the command when real span debt remains: semantic staleness or an uncovered write outside any span, each denied once per distinct debt state, so an identical retry proceeds once the deny has been shown. `.span/**` writes are excluded so span repairs riding the same commit never self-trigger the gate. A `git span stale` scan failure never blocks the command; it warns and lets the command proceed, the same fail-open behavior the environmental category already uses — resolve the underlying read/scan error if the span coupling still needs verifying.

Both hooks fail open at every layer — a missing `git span` binary, a timeout, or a malformed result resolves to "allow silently, inject nothing." Neither can brick an edit or a commit on its own failure. On Codex, whether `permissionDecision: 'deny'` actually blocks the shell tool was never confirmed live in this repo (see `notes/codex-deny-spike.md` in the card repo, and the header comment in `src/codex/gate.ts`); the adapter ships a hard-deny path per the SDK's documented example, with a one-constant fallback (`CODEX_GATE_HARD_DENY`) to a loud `additionalContext` warning if a live session shows deny doesn't fire.

The old commit-triggered pipeline this replaced (a `Stop` hook writing a touch journal, `post-commit`/`post-rewrite` git hooks, a detached dispatcher subprocess, and a spawned reconciler agent) has been deleted entirely — span repairs now ride the implementing session's own commits instead of arriving as separate, provenance-unclear commits from a background process.

To get started, run `yarn install` to install dependencies, then `yarn build` to compile the hooks into each harness's `hooks.json`. Point your Claude Code settings (or Codex plugin config) at the generated output, and the hooks run automatically. Edit the files in `src/` to customize behavior, and use `yarn test` to verify your changes work correctly.

## Suppressing span references per path

Some spans are noise in certain parts of the tree — wiki or marketing spans that anchor prose add little when you are reading source. A repo can hold them back with a `.span/.hookignore` file at its root. Each non-comment line is a gitignore-style path pattern, a single space, then a comma-separated list of span slug **prefixes** to suppress for anchors under matching paths:

```gitignore
# <path pattern>  <comma-separated span slug prefixes>
packages/agent-hooks/src  wiki,marketing
packages                  wiki
```

A span whose slug equals or begins with one of those prefixes (e.g. `wiki` or `wiki/onboarding`) is then never surfaced for an anchor under the matching path — the `PostToolUse` touch hook never injects it into `additionalContext`. Suppressed spans still count toward write coverage in the gate's uncovered-writes check, so hiding one never makes a covered write look uncovered.

Pattern grammar is a focused subset of gitignore: blank lines and `#` comments are skipped; a trailing `/` restricts a pattern to directories; a pattern containing a slash is anchored to the repo root, otherwise it matches a path component at any depth; `*`/`?` match within one segment and `**` matches across segments. Negation (`!`) is not supported. A missing or malformed file simply suppresses nothing (fail-open).

## Suppressing the gate's uncovered-writes check

A separate, user-owned file, `.span/.gateignore`, excludes specific paths from the gate's uncovered-writes check. Each non-comment line is a gitignore-style path pattern — the same grammar as `.hookignore` above, minus the trailing span-slug-prefix list (a `.gateignore` line either excludes a path or it doesn't). Unlike `.hookignore`, nothing auto-creates it; its absence is the normal, unconfigured state. A missing or unreadable file, or a malformed line, fails open to no additional exclusion. It never suppresses the semantic-staleness check.
