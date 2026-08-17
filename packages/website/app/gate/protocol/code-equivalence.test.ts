// @vitest-environment node
/**
 * Protocol suite: the card's central drift check. For every real Fumadocs
 * page (`source.getPages()` — the real generated collection, never a
 * double), fetch the page's rendered HTML and its `.md` alternate over HTTP
 * from the booted Worker, and assert `equivalentCodeSamples` sees the same
 * code shown to a human and handed to an agent.
 *
 * @summary HTML vs. Markdown code-sample drift, asserted over real HTTP
 */
import { describe, expect, it } from 'vitest';
import { equivalentCodeSamples } from '~/gate/code-samples';
import { readGateServerInfo } from '~/gate/globalSetup';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const pages = source.getPages();

describe('HTML/Markdown code-sample equivalence', () => {
  it('has at least one page to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((page) => [page.url, page] as const))('matches for %s', async (_url, page) => {
    const [htmlResponse, markdownResponse] = await Promise.all([
      fetch(`${baseUrl}${page.url}`),
      fetch(`${baseUrl}${page.url}.md`)
    ]);
    expect(htmlResponse.status, `HTML fetch failed for ${page.url}`).toBe(200);
    expect(markdownResponse.status, `Markdown fetch failed for ${page.url}`).toBe(200);

    const [html, markdown] = await Promise.all([htmlResponse.text(), markdownResponse.text()]);
    const result = equivalentCodeSamples(html, markdown);
    expect(result.equivalent, `${page.url}: ${result.mismatch ?? 'unknown mismatch'}`).toBe(true);
  });
});
