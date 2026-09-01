# Git Span for VS Code

Git Span makes the implicit relationships in a repository visible. The extension opens tracked `.span/` declarations as an interactive anchor-diff view, links anchors back to their source, and exposes the installed `git span` CLI inside VS Code.

## Prerequisite

Install the CLI separately and make sure VS Code can find it on `PATH`:

```bash
npm install -g git-span
git span --version
```

The extension does not download or manage the binary. If the version command works in a normal shell but not from VS Code, restart VS Code from that shell or update the environment used to launch it.

## Open a span

Open any declaration below a repository's `.span/` directory. The **Git Span Anchor Diff** editor shows the span's why, current anchor status, recorded content, current content, and navigation back to each source location.

Use **Reopen Editor With… → Text Editor** when you need to inspect the underlying declaration. Span files are managed by the CLI; use `git span add`, `replace`, `remove`, `why`, `config`, and `delete` instead of editing their storage format by hand.

## Commands

- **Git Span: Show CLI Version** verifies the binary VS Code resolves.
- **Git Span: Open Terminal** opens a terminal for the current workspace with `git span` available.

## Agent integrations

The VS Code extension is independent of the Claude Code, Codex, OpenCode, and Antigravity plugins. Those plugins provide in-session drift healing, commit advice, and git-span skills; install them separately using the canonical documentation at [git-span.com](https://git-span.com).

## Learn more

- [Documentation](https://git-span.com)
- [Source repository](https://github.com/goodfoot-io/git-span)

## License

MIT — Copyright © 2026 Goodfoot Media LLC.
