/**
 * Shared LLM-text renderer for the docs Markdown negotiation and `.md` paths.
 *
 * Fail-closed: a missing page throws 404 and missing processed Markdown throws
 * 500, so callers never serve a silently empty body. Processed Markdown is
 * available because the docs collection sets `includeProcessedMarkdown`.
 *
 * @summary Docs page LLM Markdown helper.
 */
import type { source } from '~/lib/source';

/** A single page from the docs source loader. */
type DocsPage = ReturnType<typeof source.getPage>;

/**
 * Strip the stringifier's frontmatter preamble, but only when the document
 * opens with one: `***` … a dashed rule … blank line, then the body. Later
 * horizontal rules belong to the body and are kept — the strip stops at the
 * first rule, never scans further.
 */
function stripFrontmatterPreamble(processed: string): string {
  if (!processed.startsWith('***\n')) return processed;
  const lines = processed.split('\n');
  const rule = lines.findIndex((line) => /^-{3,}$/.test(line));
  if (rule === -1) return processed;
  let bodyStart = rule + 1;
  while (bodyStart < lines.length && lines[bodyStart] === '') bodyStart++;
  return lines.slice(bodyStart).join('\n');
}

/** GFM alert label per Fumadocs Callout type — the only two used in content. */
const CALLOUT_ALERT: Readonly<Record<string, string>> = {
  info: 'NOTE',
  warn: 'WARNING'
};

const CALLOUT_OPEN = /^<Callout\s+type="(\w+)">$/;

/**
 * Rewrite raw `<Callout>` MDX (the stringifier passes it through unprocessed)
 * as GFM alerts. Every content line is blockquoted — the blank line between
 * paragraphs included, and fence lines too — so the whole block renders as one
 * alert instead of alert-plus-orphaned-body. The MDX pretty-printer's
 * two-space content indent is stripped. An unknown Callout type is kept
 * visible: quoted raw rather than silently relabeled.
 */
function rewriteCallouts(processed: string): string {
  const lines = processed.split('\n');
  const out: string[] = [];
  let inCallout = false;
  for (const line of lines) {
    if (inCallout) {
      if (line === '</Callout>') {
        inCallout = false;
        continue;
      }
      const stripped = line.startsWith('  ') ? line.slice(2) : line;
      out.push(stripped === '' ? '>' : `> ${stripped}`);
      continue;
    }
    const match = CALLOUT_OPEN.exec(line);
    if (match) {
      inCallout = true;
      const alert = CALLOUT_ALERT[match[1]];
      out.push(alert ? `> [!${alert}]` : `> ${line}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Render the LLM-ready Markdown for a single docs page.
 *
 * The body is the processed markdown with the stringifier's frontmatter
 * preamble stripped and `<Callout>` blocks rewritten as GFM alerts, prefixed
 * with the page title and canonical URL.
 *
 * @param page - The resolved docs page, or `undefined` when none matched.
 * @returns Markdown prefixed with the page title and canonical URL.
 * @summary LLM text for one docs page.
 */
export async function getLLMText(page: DocsPage): Promise<string> {
  if (!page) throw new Response('Not found', { status: 404 });
  const processed = await page.data.getText('processed');
  if (!processed) throw new Response('Processed text unavailable', { status: 500 });
  const body = rewriteCallouts(stripFrontmatterPreamble(processed));
  return `# ${page.data.title} (${page.url})\n\n${body}`;
}
