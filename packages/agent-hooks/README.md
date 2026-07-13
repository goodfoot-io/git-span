# agent-hooks

This project contains [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) built with the `@goodfoot/claude-code-hooks` library. Hooks let you extend Claude Code's behavior by running custom code at specific points during a session—before or after tool execution, when Claude starts or stops, and more. This project includes hooks for: `PreToolUse`, `PostToolUse`, `SessionEnd`.

To get started, run `npm install` to install dependencies, then `npm run build` to compile your hooks into `hooks.json`. Copy the generated `hooks.json` to your Claude Code settings directory (or reference it in your `.claude/settings.json`), and your hooks will run automatically. Edit the files in `src/` to customize behavior, and use `npm test` to verify your changes work correctly.

## Suppressing span references per path

Some spans are noise in certain parts of the tree — wiki or marketing spans that anchor prose add little when you are reading source. A repo can hold them back with a `.span/.hookignore` file at its root. Each non-comment line is a gitignore-style path pattern, a single space, then a comma-separated list of span slug **prefixes** to suppress for anchors under matching paths:

```gitignore
# <path pattern>  <comma-separated span slug prefixes>
packages/agent-hooks/src  wiki,marketing
packages                  wiki
```

A span whose slug equals or begins with one of those prefixes (e.g. `wiki` or `wiki/onboarding`) is then never surfaced for an anchor under the matching path — neither inline by the `PreToolUse` hook while you read, nor in the `Stop` hook's stale / related sections. Suppressed spans still count toward write coverage, so hiding one never makes a covered write look uncovered.

Pattern grammar is a focused subset of gitignore: blank lines and `#` comments are skipped; a trailing `/` restricts a pattern to directories; a pattern containing a slash is anchored to the repo root, otherwise it matches a path component at any depth; `*`/`?` match within one segment and `**` matches across segments. Negation (`!`) is not supported. A missing or malformed file simply suppresses nothing (fail-open).
