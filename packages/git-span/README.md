# git-span

`git-span` tracks implicit semantic dependencies: exact line ranges or whole files that must stay aligned even though no schema, type, test, or build step enforces the relationship.

Each span records its anchors and a compact, decision-relevant reason. Span declarations live under `.span/` as ordinary tracked repository data, and `git span drift` reports when their recorded content moves, changes, or disappears.

## Install

```bash
npm install -g git-span
git span --version
```

The package installs the native binary for supported Linux, macOS, and Windows hosts.

## Create a span

```bash
git span add checkout-request-flow \
  src/client.ts#L10-L40 \
  src/server.ts#L20-L64

git span why checkout-request-flow \
  "The server contract is authoritative for the request fields the client sends."

git add .span
git commit -m "Record checkout request coupling"
```

A useful why is one or two present-tense clauses that state the shared relationship and any decisive authority, invariant, intentional difference, or lifecycle gate.

## Review and reconcile

```bash
git span list
git span show checkout-request-flow
git span tree checkout-request-flow
git span history checkout-request-flow
git span drift
```

`git span drift --fix` repairs mechanically safe movement and whitespace-only changes. Meaning-changing drift remains visible for review. Refresh an unchanged anchor address with `git span add`; move an anchor atomically with `git span replace`.

`git span drift` exits nonzero when actionable drift remains, making it suitable for CI:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm install -g git-span
- run: git span drift
```

## Agent and editor integrations

Git-span ships integrations for Claude Code, OpenAI Codex, OpenCode, and Antigravity. Their hooks heal positional drift after supported tool calls, surface semantic drift as context, and advise before commits with unresolved span debt. The VS Code extension provides an interactive editor for `.span/` declarations.

Install integrations separately after putting `git span` on `PATH`. See [git-span.com](https://git-span.com) for current host-specific instructions and limitations.

## Automation

Commands with `--format json` provide machine-readable output. `git span context <address>... --format json` returns an exact repository snapshot for paths and inclusive line ranges, including selected spans, whys, current status, and resolver sources. Published JSON Schemas and their contracts are documented at [git-span.com](https://git-span.com).

## Documentation

- [git-span.com](https://git-span.com) — installation, concepts, command reference, agent integration, and CI guidance

## License

MIT — Copyright © 2026 Goodfoot Media LLC.
