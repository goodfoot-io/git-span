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
import { afterAll, describe, expect, it } from 'vitest';
import { equivalentCodeSamples, extractHtmlCodeSamples, extractMarkdownFences } from '~/gate/code-samples';
import { readGateServerInfo } from '~/gate/globalSetup';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const pages = source.getPages();

/** Per-page extracted sample counts, filled in as the equivalence cases run. */
const sampleCounts = new Map<string, { html: number; markdown: number }>();

/**
 * Per-page outcome line, keyed by URL. A green run that prints only
 * `Tests 69 passed` names no resource, so a run that verified nine pages and a
 * run that verified nothing render identically. The roster is printed
 * unconditionally after the cases run, mirroring how the agentic leg's
 * `evaluateAgenticReport` emits every audit's status before aggregating a
 * verdict.
 */
const outcomes = new Map<string, string>();

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
    outcomes.set(
      page.url,
      `FAIL — HTML fetch ${htmlResponse.status}, Markdown fetch ${markdownResponse.status}; expected 200 for both`
    );
    expect(htmlResponse.status, `HTML fetch failed for ${page.url}`).toBe(200);
    expect(markdownResponse.status, `Markdown fetch failed for ${page.url}`).toBe(200);

    const [html, markdown] = await Promise.all([htmlResponse.text(), markdownResponse.text()]);
    const counts = { html: extractHtmlCodeSamples(html).length, markdown: extractMarkdownFences(markdown).length };
    sampleCounts.set(page.url, counts);

    if (counts.html === 0 && counts.markdown === 0) {
      const reason = 'no code samples extracted from either representation — not verified';
      outcomes.set(page.url, `SKIP — ${reason}`);
      ctx.skip(`${page.url}: ${reason}`);
    }

    const result = equivalentCodeSamples(html, markdown);
    outcomes.set(
      page.url,
      result.equivalent
        ? `VERIFIED — ${counts.html} HTML sample(s), ${counts.markdown} Markdown fence(s)`
        : `FAIL — ${result.mismatch ?? 'unknown mismatch'}`
    );
    expect(result.equivalent, `${page.url}: ${result.mismatch ?? 'unknown mismatch'}`).toBe(true);
  });

  // Printed on every run, pass or fail: the roster is the only evidence that
  // distinguishes "nine pages compared" from "nothing compared, and equality
  // held vacuously".
  //
  // `process.stdout.write`, not `console.log`: vitest intercepts test-side
  // `console` and the gate's default reporter prints those records only for
  // failing files, so a `console.log` roster would be invisible on exactly the
  // passing run it exists to make auditable. Writing to the stream directly
  // bypasses the interception and reaches stdout unconditionally.
  afterAll(() => {
    const lines = [`HTML/Markdown code-sample equivalence: ${pages.length} page(s) against ${baseUrl}`];
    for (const page of pages) {
      lines.push(`  ${page.url}: ${outcomes.get(page.url) ?? 'NOT REACHED — case did not record an outcome'}`);
    }
    const verified = [...sampleCounts].filter(([, counts]) => counts.html > 0 && counts.markdown > 0).length;
    lines.push(`  ${verified} of ${pages.length} page(s) verified with at least one code sample on both sides`);
    process.stdout.write(`${lines.join('\n')}\n`);
  });

  it('verified code samples on at least one page', () => {
    const verified = [...sampleCounts].filter(([, counts]) => counts.html > 0 && counts.markdown > 0);
    expect(
      verified.length,
      `every page extracted zero code samples, so nothing was actually compared; per-page counts were ${JSON.stringify(Object.fromEntries(sampleCounts))}`
    ).toBeGreaterThan(0);
  });
});
