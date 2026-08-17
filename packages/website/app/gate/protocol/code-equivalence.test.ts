// @vitest-environment node
/**
 * Protocol suite: the card's central drift check. For every real Fumadocs
 * page (`source.getPages()` — the real generated collection, never a
 * double), fetch the page's rendered HTML and its `.md` alternate over HTTP
 * from the booted Worker, and assert `equivalentCodeSamples` sees the same
 * code shown to a human and handed to an agent.
 *
 * Equality alone is a weak signal: two empty lists compare equal, so a page
 * whose extractors both return nothing would report as a match while
 * verifying nothing. A one-sided collapse is already caught — the existing
 * count-mismatch branch names it — so the gap is strictly the mutual-zero
 * case. Such a page is reported as unverified rather than passing (a
 * prose-only doc legitimately has no samples, so it is not a failure), and a
 * sitewide floor after the per-page cases catches extraction being broken
 * everywhere at once.
 *
 * @summary HTML vs. Markdown code-sample drift, asserted over real HTTP
 */
import { describe, expect, it } from 'vitest';
import { equivalentCodeSamples, extractHtmlCodeSamples, extractMarkdownFences } from '~/gate/code-samples';
import { readGateServerInfo } from '~/gate/globalSetup';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const pages = source.getPages();

/** Per-page extracted sample counts, filled in as the equivalence cases run. */
const sampleCounts = new Map<string, { html: number; markdown: number }>();

describe('HTML/Markdown code-sample equivalence', () => {
  it('has at least one page to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  // `it.for` rather than the suite's usual `it.each`: only `for` hands the
  // test context to the case body, which is what lets a mutual-zero page
  // report as skipped instead of silently passing.
  it.for(pages.map((page) => [page.url, page] as const))('matches for %s', async ([, page], ctx) => {
    const [htmlResponse, markdownResponse] = await Promise.all([
      fetch(`${baseUrl}${page.url}`),
      fetch(`${baseUrl}${page.url}.md`)
    ]);
    expect(htmlResponse.status, `HTML fetch failed for ${page.url}`).toBe(200);
    expect(markdownResponse.status, `Markdown fetch failed for ${page.url}`).toBe(200);

    const [html, markdown] = await Promise.all([htmlResponse.text(), markdownResponse.text()]);
    const counts = { html: extractHtmlCodeSamples(html).length, markdown: extractMarkdownFences(markdown).length };
    sampleCounts.set(page.url, counts);

    if (counts.html === 0 && counts.markdown === 0) {
      ctx.skip(`${page.url}: no code samples extracted from either representation — not verified`);
    }

    const result = equivalentCodeSamples(html, markdown);
    expect(result.equivalent, `${page.url}: ${result.mismatch ?? 'unknown mismatch'}`).toBe(true);
  });

  it('verified code samples on at least one page', () => {
    const verified = [...sampleCounts].filter(([, counts]) => counts.html > 0 && counts.markdown > 0);
    expect(
      verified.length,
      `every page extracted zero code samples, so nothing was actually compared; per-page counts were ${JSON.stringify(Object.fromEntries(sampleCounts))}`
    ).toBeGreaterThan(0);
  });
});
