import { describe, expect, it } from 'vitest';
import { getLLMText } from '~/lib/get-llm-text';

/**
 * Fixtures below are the exact `getText('processed')` shapes captured by the
 * spike in the card repo (spike/processed-markdown-callout/captured/) — the
 * real stringifier output for git-span's docs pages, including the two
 * worst-case Callout shapes (two paragraphs separated by a blank line; a
 * fenced ```bash block inside).
 */

/** Preamble the stringifier emits for pages with YAML frontmatter. */
const PREAMBLE = `***

title: Agent integration
description: What the Claude Code and Codex plugins wire up — the touch hook, the commit advisor, the skills, and the expert subagent.
${'-'.repeat(134)}

`;

/** agent-integration.mdx processed form, L21–25 of the capture. */
const TWO_PARAGRAPH_CALLOUT = `<Callout type="info">
  Both hooks fail open on everything that decides *whether* there is something to say: a missing \`git span\` binary, a timeout, or an unexpected result resolves to "allow silently, inject nothing." Neither can brick an edit or a commit on its own failure.

  Rendering is the deliberate exception, and fails **closed**. If the anchor tree can't be drawn, the hook falls back to the flat bullet form and still holds — a defect in how a hold is presented must cost presentation, never the hold itself. That's why those \`try/catch\` blocks sit around the render calls rather than deferring to the advisor's outer fail-open catch: they exist precisely to keep a formatting error from converting a correctly computed hold into a silent allow. Treat them as load-bearing, not as fallbacks that escaped the rule above.
</Callout>`;

/** getting-started.mdx processed form, L38–45 of the capture. */
const FENCED_CALLOUT = `<Callout type="info">
  For a non-interactive or scripted install, use the \`claude\` CLI form instead:

  \`\`\`bash
  claude plugin marketplace add goodfoot-io/git-span
  claude plugin install git-span@git-span
  \`\`\`
</Callout>`;

type PageParam = Parameters<typeof getLLMText>[0];

function fakePage(processed: string | null): PageParam {
  return {
    data: {
      title: 'Agent integration',
      getText: async () => processed
    },
    url: '/docs/agent-integration'
  } as unknown as PageParam;
}

describe('getLLMText', () => {
  it('prefixes the title and canonical URL', async () => {
    const text = await getLLMText(fakePage('## Heading\n\nBody.\n'));
    expect(text).toBe('# Agent integration (/docs/agent-integration)\n\n## Heading\n\nBody.\n');
  });

  it('strips the frontmatter preamble at the first dashed rule, keeping body rules', async () => {
    const processed = `${PREAMBLE}## What the advisor holds on\n\nBody before the hr.\n\n---\n\nBody after the hr.\n`;
    const text = await getLLMText(fakePage(processed));
    expect(text).not.toContain('description:');
    expect(text).not.toContain('-'.repeat(134));
    expect(text).toBe(
      '# Agent integration (/docs/agent-integration)\n\n## What the advisor holds on\n\nBody before the hr.\n\n---\n\nBody after the hr.\n'
    );
  });

  it('leaves a frontmatter-less document whose body opens with an hr untouched', async () => {
    const processed = '---\n\nBody that starts with a rule.\n';
    const text = await getLLMText(fakePage(processed));
    expect(text).toBe('# Agent integration (/docs/agent-integration)\n\n---\n\nBody that starts with a rule.\n');
  });

  it('rewrites a single-paragraph Callout into a GFM note', async () => {
    const processed =
      '<Callout type="info">\n  Some *emphasized* text and a [link](/docs/agent-integration).\n</Callout>\n';
    const text = await getLLMText(fakePage(processed));
    expect(text).toBe(
      '# Agent integration (/docs/agent-integration)\n\n> [!NOTE]\n> Some *emphasized* text and a [link](/docs/agent-integration).\n'
    );
  });

  it('rewrites a warn Callout into a GFM warning', async () => {
    const processed = '<Callout type="warn">\n  Do not run this twice.\n</Callout>\n';
    const text = await getLLMText(fakePage(processed));
    expect(text).toBe('# Agent integration (/docs/agent-integration)\n\n> [!WARNING]\n> Do not run this twice.\n');
  });

  it('blockquotes the blank line between two Callout paragraphs so the alert stays whole', async () => {
    const text = await getLLMText(fakePage(TWO_PARAGRAPH_CALLOUT));
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Agent integration (/docs/agent-integration)');
    expect(lines[1]).toBe('');
    // Every content line — the blank separator included — carries the quote
    // marker, so the two paragraphs render as one alert, not alert + orphan.
    const blockquote = lines.slice(2);
    expect(blockquote[0]).toBe('> [!NOTE]');
    expect(blockquote.every((line) => line.startsWith('>'))).toBe(true);
    expect(blockquote[2]).toBe('>');
    expect(blockquote).toContain(
      '> Both hooks fail open on everything that decides *whether* there is something to say: a missing `git span` binary, a timeout, or an unexpected result resolves to "allow silently, inject nothing." Neither can brick an edit or a commit on its own failure.'
    );
    // The second paragraph's full line continues past the excerpt asserted
    // here, so check the prefix rather than element equality.
    expect(
      blockquote.some((line) => line.startsWith('> Rendering is the deliberate exception, and fails **closed**.'))
    ).toBe(true);
  });

  it('blockquotes fence lines so a fenced block inside a Callout stays inside the alert', async () => {
    const text = await getLLMText(fakePage(FENCED_CALLOUT));
    expect(text).toBe(
      `# Agent integration (/docs/agent-integration)

> [!NOTE]
> For a non-interactive or scripted install, use the \`claude\` CLI form instead:
>
> \`\`\`bash
> claude plugin marketplace add goodfoot-io/git-span
> claude plugin install git-span@git-span
> \`\`\``
    );
  });

  it('throws a 404 Response for a missing page', async () => {
    await expect(getLLMText(undefined as unknown as PageParam)).rejects.toSatisfy(
      (error: unknown) => error instanceof Response && error.status === 404
    );
  });

  it('throws a 500 Response when processed text is unavailable', async () => {
    await expect(getLLMText(fakePage(null))).rejects.toSatisfy(
      (error: unknown) => error instanceof Response && error.status === 500
    );
  });
});
