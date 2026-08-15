/**
 * Resource route: the hand-authored root system map at `/llms.txt`. A compact
 * map of the whole system — never a chapter dump, never a bare URL.
 *
 * @summary Root llms.txt system map resource route
 */
import { SITE_URL } from '~/lib/meta';

const headers = { 'Content-Type': 'text/plain; charset=utf-8' };

export function loader(): Response {
  return new Response(
    `# git-span

> git-span is a CLI for git-native semantic code annotations: declare the couplings in your codebase that nothing enforces, then let every Claude Code and Codex session read them from your source tree.

## Start here

- [Documentation index](${SITE_URL}/docs/llms.txt) - The complete, ordered index of every documentation chapter.

## Source

- [GitHub repository](https://github.com/goodfoot-io/git-span) - The git-span source, issue tracker, and release notes.

## CLI

- [Getting started](${SITE_URL}/docs/getting-started.md) - Install the git-span CLI, then wire it into Claude Code or OpenAI Codex.
- [Command reference](${SITE_URL}/docs/commands.md) - Every subcommand, grouped by task, with flags and exit behavior.

## Agent integrations

- [Agent integration](${SITE_URL}/docs/agent-integration.md) - What the Claude Code and Codex plugins wire up.
- [Concepts](${SITE_URL}/docs/concepts.md) - Spans, anchors, drift, and the trust boundary around git-span's output.

## Optional

- [Full documentation corpus](${SITE_URL}/docs/llms-full.txt) - Every chapter's Markdown concatenated for bulk ingestion; not the default path.`,
    { headers }
  );
}
