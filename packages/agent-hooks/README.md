# Git Span agent hooks

This package builds the in-session Git Span integrations for Claude Code, OpenAI Codex, OpenCode, and Antigravity. All four adapters share the same attribution core while translating each host's tool events, response channels, and lifecycle into that common behavior.

End users should install the published plugin for their coding agent rather than this workspace package. The canonical documentation is [git-span.com](https://git-span.com).

## Shared behavior

- The touch pipeline observes supported reads and writes, repairs positional drift when it is mechanically safe, and surfaces remaining semantic drift as bounded context.
- `.span/.hookignore` suppresses ordinary touch context by path; complete commit reports include all overlapping spans.
- All four integrations request a forked subagent to review existing session notes with `review-notes`, with guards against repeated continuation.
- Hook failures do not block edits or commits.

These hooks are advisory coverage, not the enforcement boundary. Human changes, inactive plugins, unsupported tools, and host-level failures can bypass in-session attribution; run `git span drift` in CI before merge.

Claude Code and Codex record observed Git commits as session notes; editing a file alone creates no commit note. Install the CLI and plugin from the same release: receipt coordination uses the CLI's native lock helper, which releases ownership when a hook exits or crashes.

Known exception: commit observation is fixed when the Bash call is enrolled, and watches only the hook's `cwd` and repositories named by literal paths in the command. A commit in a repository created or first entered in the same Bash call (`git init` then `git commit`, or a repository named only through a shell variable such as `cd $dir`) receives no note. Notes are advisory coverage, not a durable guarantee; run `git span drift` in CI.

## Commit inspection context

Successful supported `git show` and `git log` calls deliver every overlapping current span once, with complete current anchors, statuses, and explanations. Plain, one-line, patch, and truncated host output use the same native Git selection. Repeated inspections repeat the complete report, independently of ordinary touch exposure. Inspection does not repair definitions.

Supported forms are literal standalone Git commands, repeated literal `git -C` directories, and `cd <literal-directory> && git …`. An explicit option grammar preserves supported revision ranges, traversal, filtering, pickaxe, and count/skip options; unknown options, pipelines, mixed commands, redirects, shell expansion, background execution, repository environment overrides, `--not`, reflog and line-history traversal, annotated tags, and tree objects are excluded. Raw `git show revision:path` remains an ordinary blob read. Repositories with replace refs, grafts, configured external diff helpers, or text conversion helpers are excluded. Recognized unsupported commit forms produce an unavailable notice and suppress partial patch context while retaining unrelated command reads and writes.

Selection replays the command options after the tool completes, so moving refs and time-relative date boundaries can differ from execution-time selection. Native notes-sensitive message filtering preserves supported explicit and implicit notes behavior; unresolved combinations of repeated formats, nested formats, or configured pretty aliases produce an unavailable notice. Pathspecs constrain Git's selected commits; each selected commit contributes its complete changes. Roots compare with an empty tree and merges contribute changes against every parent. Historical selection uses deterministic rename-aware tree correspondence, including whole replacement regions and identical delete/recreate endpoint trees; it does not establish uninterrupted object lineage. Current resolver evidence supplies displayed statuses, including moved, deleted, conflicting, and unavailable anchors.

The complete report is limited to 64 KiB; selection and querying share an eight-second driver budget, with at most three seconds for selection and five seconds for native querying. Native limits include 4096 commits, 8192 parent comparisons, and 8192 distinct tree diffs across the complete query. Missing evidence, ambiguous rename correspondence, resource limits, and failed queries produce an unavailable notice without a partial report. The notice includes a quoted native retrieval command when it fits; very large selections include command syntax and the selected count instead of an incomplete ID list. Native retrieval uses `git -C <repository> span commit-context <full-commit-id>...` and returns JSON. [The dedicated delivery implementation](./packages/agent-hooks/src/common/commit-inspection-context.ts#L1) validates the complete native envelope before rendering.

Complete commit reports are available for synchronous Claude Code Bash, Codex shell/exec calls with one statically recoverable synchronous command and explicit successful completion, and OpenCode bash. Codex asynchronous polling and batches without individual completion evidence are excluded. Antigravity lacks the response/exit evidence this feature requires and retains ordinary attribution. Host process termination can prevent delivery even when native selection succeeded.

## Host coverage

### Claude Code

Claude Code observes `Read`, `Edit`, `Write`, and `Bash`. The plugin includes three Git Span skills plus an expert agent.

### OpenAI Codex

Codex observes `apply_patch` and its shell/exec tool family. Installing the plugin does not activate its hooks until the user reviews and trusts them through `/hooks`. The plugin includes three skills plus an expert agent.

### OpenCode

OpenCode observes `bash`, `read`, `edit`, `write`, and `apply_patch`; its experimental code-mode `execute` tool is outside the integration. Hooks run in-process. Host-level failures that never reach the after hook receive no attribution. The npm plugin installer materializes three skills and an expert agent on disk.

After user input, `session.status` (idle) sends one synthetic note-review prompt to a root session when any note exists in the repository. Synthetic prompts and child sessions do not trigger another review. OpenCode V2 receives the continuation through `session.synthetic` with `resume: true`.

### Antigravity

Antigravity observes the pinned `run_command` contract. Dedicated file-edit tools are outside the integration; explicit `git span drift` checks verify their changes. Tool calls are joined through disk-backed state and context is delivered after the invocation as an ephemeral message. The plugin ships three skills and no separate expert-agent artifact.

An idle, successful model stop requests note review once per conversation when any note exists in the repository. Subsequent stops clean up call state and proceed. Error, step-limit, and busy stops proceed without requesting review.

All four hosts check `git span notes list --format json` before requesting review; Claude Code and Codex count only notes tagged with the current session, while Antigravity and OpenCode count any note in the repository. Empty repositories and non-repository sessions proceed silently. The check covers the current repository and supplied workspace paths; a failed lookup skips review. Empty Antigravity stops leave its once-only review guard available for later notes.

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
