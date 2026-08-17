// @vitest-environment node
/**
 * Protocol suite: `robots.txt` and `sitemap.xml`, asserted over real HTTP
 * against the booted Worker.
 *
 * @summary Crawler-discovery surface protocol assertions
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const ROBOTS_PATH = path.join(process.cwd(), 'public/robots.txt');

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = ['/robots.txt', '/sitemap.xml'];

type Outcome = { total: number; failed: number; firstFailure?: string };

/** Per-resource outcome, keyed by path, filled in as cases run. */
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

describe('GET /robots.txt', () => {
  it('serves bytes identical to the committed public/robots.txt', async () => {
    await tracked('/robots.txt', async () => {
      const committed = readFileSync(ROBOTS_PATH);
      const response = await fetch(`${baseUrl}/robots.txt`);
      expect(response.status).toBe(200);
      const served = Buffer.from(await response.arrayBuffer());
      expect(Buffer.compare(served, committed)).toBe(0);
    });
  });

  it('advertises every bot stanza and the canonical Sitemap line', async () => {
    await tracked('/robots.txt', async () => {
      const body = await (await fetch(`${baseUrl}/robots.txt`)).text();
      for (const crawler of [
        'GPTBot',
        'ClaudeBot',
        'OAI-SearchBot',
        'Claude-SearchBot',
        'ChatGPT-User',
        'Claude-User',
        '*'
      ]) {
        expect(body).toContain(`User-agent: ${crawler}\nAllow: /`);
      }
      expect(body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    });
  });
});

describe('GET /sitemap.xml', () => {
  it('serves application/xml; charset=utf-8', async () => {
    await tracked('/sitemap.xml', async () => {
      const response = await fetch(`${baseUrl}/sitemap.xml`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    });
  });

  it('lists exactly the homepage plus every docs page as canonical https://git-span.com URLs', async () => {
    await tracked('/sitemap.xml', async () => {
      const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
      const locs = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
      const expected = [`${SITE_URL}/`, ...source.getPages().map((page) => `${SITE_URL}${page.url}`)].sort();
      expect([...locs].sort()).toEqual(expected);
    });
  });

  it('never indexes the machine-readable families', async () => {
    await tracked('/sitemap.xml', async () => {
      const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
      const locs = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
      for (const loc of locs) {
        expect(loc).not.toMatch(/\/llms/);
        expect(loc).not.toMatch(/\/schemas/);
        expect(loc).not.toMatch(/\/\.well-known/);
      }
    });
  });

  // Printed on every run, pass or fail — see code-equivalence.test.ts for the
  // rationale. `process.stdout.write`, not `console.log`: vitest swallows
  // test-side `console` output on a passing run.
  afterAll(() => {
    const lines = [`Crawler discovery: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
    for (const resource of EXPECTED_RESOURCES) {
      lines.push(`  ${resource}: ${formatOutcome(resource)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});
