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
 * opens with one: `***` … YAML frontmatter … a dashed rule … blank line, then
 * the body. The region between the opener and the first rule must carry a
 * `title:` line — the one key every docs page's frontmatter has — so a body
 * that legally opens with a `***` thematic break is never mistaken for a
 * preamble and truncated. Later horizontal rules belong to the body and are
 * kept — the strip stops at the first rule, never scans further.
 */
function stripFrontmatterPreamble(processed: string): string {
  if (!processed.startsWith('***\n')) return processed;
  const lines = processed.split('\n');
  const rule = lines.findIndex((line) => /^-{3,}$/.test(line));
  if (rule === -1) return processed;
  if (!lines.slice(1, rule).some((line) => /^title:\s/.test(line))) return processed;
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

/** A stringifier heading-id suffix token: `## Global options [#global-options]`. */
const HEADING_ID = /^(#{1,6})\s+(.+?)\s+\[#[a-z0-9_-]+\]$/;

/** A CommonMark fence line: up to three leading spaces, then a run of three
 * or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Strip the heading-id suffix tokens the stringifier appends to ATX headings.
 * The ids anchor the HTML pages' headings; the Markdown representation shows
 * the same heading text the page shows. Lines inside code fences are left
 * untouched — fence content is verbatim source, never stringifier output. The
 * fence tracker follows CommonMark: a fence opens on a run of three or more
 * of one character, only the same character closes it, the closing run must
 * be at least as long as the opener and carry nothing but trailing
 * whitespace, and a closing fence may be indented up to three spaces.
 */
function stripHeadingIds(processed: string): string {
  const lines = processed.split('\n');
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (match) {
      const char = match[1][0];
      if (fence) {
        if (
          char === fence.char &&
          match[1].length >= fence.length &&
          line.slice((match.index ?? 0) + match[0].length).trim() === ''
        ) {
          fence = null;
        }
      } else {
        fence = { char, length: match[1].length };
      }
      out.push(line);
      continue;
    }
    out.push(fence ? line : line.replace(HEADING_ID, '$1 $2'));
  }
  return out.join('\n');
}

/**
 * Render the LLM-ready Markdown for a single docs page.
 *
 * The body is the processed markdown with the stringifier's frontmatter
 * preamble stripped, `<Callout>` blocks rewritten as GFM alerts, heading-id
 * suffix tokens removed, and any leading blank lines the stringifier left
 * dropped, prefixed with the page title and canonical URL.
 *
 * @param page - The resolved docs page, or `undefined` when none matched.
 * @returns Markdown prefixed with the page title and canonical URL.
 * @summary LLM text for one docs page.
 */
export async function getLLMText(page: DocsPage): Promise<string> {
  if (!page) throw new Response('Not found', { status: 404 });
  const processed = await page.data.getText('processed');
  if (!processed) throw new Response('Processed text unavailable', { status: 500 });
  const body = stripHeadingIds(rewriteCallouts(stripFrontmatterPreamble(processed))).replace(/^\n+/, '');
  return `# ${page.data.title} (${page.url})\n\n${body}`;
}
