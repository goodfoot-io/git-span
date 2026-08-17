// @vitest-environment node
/**
 * Protocol suite: HTTP-level assertions on Markdown negotiation and the
 * `.md` URL family, against the real booted Worker (`readGateServerInfo()`).
 * Mirrors `~/lib/content-negotiation.test.ts`'s unit expectations, but never
 * calls the negotiation functions directly — every case round-trips through
 * a real fetch.
 *
 * @summary Markdown negotiation and `.md` URL protocol assertions
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { RENAMED_DOC_SLUGS } from '~/lib/renamed-doc-slugs';

const { baseUrl } = readGateServerInfo();

// A known, always-present docs page — `/docs` redirects to it, so its
// existence is already load-bearing elsewhere in the site.
const DOCS_PAGE = '/docs/overview';

const RENAME_ENTRIES = Object.entries(RENAMED_DOC_SLUGS);

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = [
  'Accept negotiation matrix: /',
  `Vary header: /`,
  `Vary header: ${DOCS_PAGE}`,
  `.md URL family: ${DOCS_PAGE}.md`,
  ...RENAME_ENTRIES.map(([oldSlug, newSlug]) => `rename map: ${oldSlug} -> ${newSlug}`)
];

type Outcome = { total: number; failed: number; firstFailure?: string };

/** Per-resource outcome, keyed by resource label, filled in as cases run. */
const outcomes = new Map<string, Outcome>();

function outcomeFor(key: string): Outcome {
  const existing = outcomes.get(key);
  if (existing) return existing;
  const created: Outcome = { total: 0, failed: 0 };
  outcomes.set(key, created);
  return created;
}

/** Runs `fn`, recording pass/fail against `key` before rethrowing on failure. */
async function tracked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const outcome = outcomeFor(key);
  outcome.total += 1;
  try {
    return await fn();
  } catch (error) {
    outcome.failed += 1;
    outcome.firstFailure ??= error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function formatOutcome(key: string): string {
  const outcome = outcomes.get(key);
  if (!outcome) return 'NOT REACHED — case did not record an outcome';
  if (outcome.failed === 0) return `VERIFIED — ${outcome.total} check(s) passed`;
  return `FAIL — ${outcome.failed} of ${outcome.total} check(s) failed; first failure: ${outcome.firstFailure}`;
}

describe('Accept negotiation strictly outranks HTML only per the pinned table', () => {
  it.each([
    [null, false],
    ['text/html', false],
    ['*/*', false],
    ['', false],
    ['text/html, text/markdown', false],
    ['text/markdown', true],
    ['text/markdown, */*', false],
    ['TEXT/MARKDOWN; charset=utf-8', true],
    ['text/html;q=.5, text/markdown;q=0.8', true],
    ['text/html;q=0.9, text/markdown;q=0.8', false],
    ['text/markdown;q=0, */*;q=1', false],
    ['text/markdown;q=wat', false],
    ['text/markdown; q = 0', false],
    ['text/html, text/markdown; q = 0', false],
    ['text/markdown; q = 1, text/html; q = 0.5', true],
    ['text/markdown; q = 1, text/html; q = 1', false],
    ['text/markdown; q="0.5"', true],
    ['text/html; q=1, text/markdown; q = "0.5"', false],
    ['text/html; q = 0.1, text/markdown; q = 0.9', true],
    ['TEXT/MARKDOWN; Q = 0.8, text/html; q = 0.5', true],
    ['text/markdown; q = "wat"', false]
  ])('selects Markdown for Accept: %s on / only when it strictly outranks HTML', async (accept, expectMarkdown) => {
    await tracked('Accept negotiation matrix: /', async () => {
      const headers = accept === null ? undefined : { Accept: accept };
      const response = await fetch(`${baseUrl}/`, { headers });
      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type') ?? '';
      expect(contentType.startsWith('text/markdown')).toBe(expectMarkdown);
    });
  });
});

describe('Vary header merging on eligible HTML responses', () => {
  it.each(['/', DOCS_PAGE])('merges Accept into Vary for %s', async (pathname) => {
    await tracked(`Vary header: ${pathname}`, async () => {
      const response = await fetch(`${baseUrl}${pathname}`);
      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type') ?? '';
      expect(contentType.startsWith('text/markdown')).toBe(false);
      const vary = (response.headers.get('Vary') ?? '').split(',').map((token) => token.trim().toLowerCase());
      expect(vary).toContain('accept');
    });
  });
});

describe('.md URLs', () => {
  it('serve text/markdown; charset=utf-8', async () => {
    await tracked(`.md URL family: ${DOCS_PAGE}.md`, async () => {
      const response = await fetch(`${baseUrl}${DOCS_PAGE}.md`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    });
  });

  it('carry a present, stable ETag across two fetches', async () => {
    await tracked(`.md URL family: ${DOCS_PAGE}.md`, async () => {
      const first = await fetch(`${baseUrl}${DOCS_PAGE}.md`);
      const second = await fetch(`${baseUrl}${DOCS_PAGE}.md`);
      const firstEtag = first.headers.get('ETag');
      expect(firstEtag).toMatch(/^"[a-f0-9]{8}-\d+"$/);
      expect(second.headers.get('ETag')).toBe(firstEtag);
    });
  });

  it('return no body on HEAD', async () => {
    await tracked(`.md URL family: ${DOCS_PAGE}.md`, async () => {
      const response = await fetch(`${baseUrl}${DOCS_PAGE}.md`, { method: 'HEAD' });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect(await response.text()).toBe('');
    });
  });

  it('answer 304 on a matching If-None-Match', async () => {
    await tracked(`.md URL family: ${DOCS_PAGE}.md`, async () => {
      const initial = await fetch(`${baseUrl}${DOCS_PAGE}.md`);
      const etag = initial.headers.get('ETag') ?? '';
      const conditional = await fetch(`${baseUrl}${DOCS_PAGE}.md`, { headers: { 'If-None-Match': etag } });
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe('');
    });
  });

  it('404 on an unknown slug', async () => {
    const response = await fetch(`${baseUrl}/docs/not-a-real-page-xyz.md`);
    expect(response.status).toBe(404);
  });
});

describe('rename map parity', () => {
  it('has at least one entry to exercise', () => {
    expect(RENAME_ENTRIES.length).toBeGreaterThan(0);
  });

  it.each(RENAME_ENTRIES)('resolves %s at both the old-negotiated and new canonical form', async (oldSlug, newSlug) => {
    await tracked(`rename map: ${oldSlug} -> ${newSlug}`, async () => {
      // .md URL family: the old slug 301s to the new slug's .md twin.
      const oldMd = await fetch(`${baseUrl}/docs/${oldSlug}.md`, { redirect: 'manual' });
      expect(oldMd.status).toBe(301);
      expect(oldMd.headers.get('Location')).toBe(`/docs/${newSlug}.md`);

      const newMd = await fetch(`${baseUrl}/docs/${newSlug}.md`);
      expect(newMd.status).toBe(200);
      expect(newMd.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');

      // Negotiated form: the old slug's HTML address, requested with an
      // Accept that strictly prefers Markdown, still resolves — the registry
      // miss falls through to SSR, which 301s the canonical HTML redirect.
      const oldNegotiated = await fetch(`${baseUrl}/docs/${oldSlug}`, {
        headers: { Accept: 'text/markdown' },
        redirect: 'manual'
      });
      expect(oldNegotiated.status).toBe(301);
      expect(oldNegotiated.headers.get('Location')).toBe(`/docs/${newSlug}`);

      const newNegotiated = await fetch(`${baseUrl}/docs/${newSlug}`, { headers: { Accept: 'text/markdown' } });
      expect(newNegotiated.status).toBe(200);
      expect(newNegotiated.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    });
  });
});

// Printed on every run, pass or fail — see code-equivalence.test.ts for the
// rationale. `process.stdout.write`, not `console.log`: vitest swallows
// test-side `console` output on a passing run.
afterAll(() => {
  const lines = [`Markdown alternates: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
  for (const resource of EXPECTED_RESOURCES) {
    lines.push(`  ${resource}: ${formatOutcome(resource)}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});
