# Git Span agent hooks

This package builds the in-session Git Span integrations for Claude Code, OpenAI Codex, OpenCode, and Antigravity. All four adapters share the same attribution core while translating each host's tool events, response channels, and lifecycle into that common behavior.

End users should install the published plugin for their coding agent rather than this workspace package. The canonical documentation is [git-span.com](https://git-span.com).

## Shared behavior

- The touch pipeline observes supported reads and writes, repairs positional drift when it is mechanically safe, and surfaces remaining semantic drift as bounded context.
- `.span/.hookignore` suppresses selected span context by path.
- All four integrations request a forked subagent to review relevant session notes with `review-notes`, with guards against repeated continuation.
- Hook failures do not block edits or commits.

These hooks are advisory coverage, not the enforcement boundary. Human changes, inactive plugins, unsupported tools, and host-level failures can bypass in-session attribution; run `git span drift` in CI before merge.

Claude Code and Codex record observed Git commits as session notes; editing a file alone creates no commit note. Install the CLI and plugin from the same release: receipt coordination uses the CLI's native lock helper, which releases ownership when a hook exits or crashes.

## Host coverage

### Claude Code

Claude Code observes `Read`, `Edit`, `Write`, and `Bash`. The plugin includes five Git Span skills plus an expert agent.

### OpenAI Codex

Codex observes `apply_patch` and its shell/exec tool family. Installing the plugin does not activate its hooks until the user reviews and trusts them through `/hooks`. The plugin includes five skills plus an expert agent.

### OpenCode

OpenCode observes `bash`, `read`, `edit`, `write`, and `apply_patch`; its experimental code-mode `execute` tool is outside the integration. Hooks run in-process. Host-level failures that never reach the after hook receive no attribution. The npm plugin installer materializes five skills and an expert agent on disk.

After user input, `session.status` (idle) sends one synthetic note-review prompt to a root session when notes exist. Synthetic prompts and child sessions do not trigger another review. OpenCode V2 receives the continuation through `session.synthetic` with `resume: true`.

### Antigravity

Antigravity observes the pinned `run_command` contract. Dedicated file-edit tools are outside the integration; explicit `git span drift` checks verify their changes. Tool calls are joined through disk-backed state and context is delivered after the invocation as an ephemeral message. The plugin ships five skills and no separate expert-agent artifact.

An idle, successful model stop requests note review once per conversation when notes exist. Subsequent stops clean up call state and proceed. Error, step-limit, and busy stops proceed without requesting review.

All four hosts check `git span notes list --format json` before requesting review. Empty repositories and non-repository sessions proceed silently. The check covers the current repository and supplied workspace paths; a failed lookup preserves the review request. Empty Antigravity stops leave its once-only review guard available for later notes.

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
