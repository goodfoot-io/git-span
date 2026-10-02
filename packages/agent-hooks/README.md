# Git Span agent hooks

This package builds the in-session Git Span integrations for Claude Code, OpenAI Codex, OpenCode, and Antigravity. All four adapters share the same attribution core while translating each host's tool events, response channels, and lifecycle into that common behavior.

End users should install the published plugin for their coding agent rather than this workspace package. The canonical documentation is [git-span.com](https://git-span.com).

## Shared behavior

- The touch pipeline observes supported reads and writes, repairs positional drift when it is mechanically safe, and surfaces remaining semantic drift as bounded context.
- `.span/.hookignore` suppresses selected span context by path.
- Hook failures do not block edits or commits.

These hooks are advisory coverage, not the enforcement boundary. Human changes, inactive plugins, unsupported tools, and host-level failures can bypass in-session attribution; run `git span drift` in CI before merge.

## Host coverage

### Claude Code

Claude Code observes `Read`, `Edit`, `Write`, and `Bash`. The plugin includes four Git Span skills plus an expert agent.

### OpenAI Codex

Codex observes `apply_patch` and its shell/exec tool family. Installing the plugin does not activate its hooks until the user reviews and trusts them through `/hooks`. The plugin includes four skills plus an expert agent.

### OpenCode

OpenCode observes `bash`, `read`, `edit`, `write`, and `apply_patch`; its experimental code-mode `execute` tool is outside the integration. Hooks run in-process. Host-level failures that never reach the after hook receive no attribution. The npm plugin installer materializes four skills and an expert agent on disk.

### Antigravity

Antigravity observes the pinned `run_command` contract. Dedicated file-edit tools are outside the integration; explicit `git span drift` checks verify their changes. Tool calls are joined through disk-backed state and context is delivered after the invocation as an ephemeral message. The plugin ships four skills and no separate expert-agent artifact.

## Development

Install workspace dependencies, then build all four generated plugin outputs:

```bash
yarn install
yarn workspace agent-hooks build
```

The build writes committed artifacts under:

- `plugins-claude/git-span/hooks/`
- `plugins-codex/git-span/hooks/`
- `plugins-opencode/git-span/dist/`
- `plugins-antigravity/git-span/bin/` and `hooks.json`

Edit `packages/agent-hooks/src/`, never the generated bundles. Validate changes with:

```bash
yarn workspace agent-hooks lint
yarn workspace agent-hooks typecheck
yarn workspace agent-hooks test
yarn workspace agent-hooks build
```

## License

MIT — Copyright © 2026 Goodfoot Media LLC.
