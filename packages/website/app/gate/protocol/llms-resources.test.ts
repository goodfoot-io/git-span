// @vitest-environment node
/**
 * Protocol suite: `/llms.txt`, `/docs/llms.txt`, and the two `-full` corpus
 * variants, asserted over real HTTP against the booted Worker. The docs
 * index is checked against the real Fumadocs-generated index (`llms()` +
 * `withMdLinks`), never a double.
 *
 * @summary llms.txt family content type, structure, and resolvability
 */
import { llms } from 'fumadocs-core/source/llms';
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { withMdLinks } from '~/lib/llms-resources';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const TEXT_PLAIN = 'text/plain; charset=utf-8';

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = ['/llms.txt', '/docs/llms.txt', '/llms-full.txt', '/docs/llms-full.txt'];

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

describe('GET /llms.txt — root system map', () => {
  it('serves text/plain with the annotated system map', async () => {
    await tracked('/llms.txt', async () => {
      const response = await fetch(`${baseUrl}/llms.txt`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
      const body = await response.text();
      expect(body).toMatch(/^# git-span\n\n> .+/);
      for (const section of ['## Start here', '## Source', '## CLI', '## Agent integrations', '## Optional']) {
        expect(body).toContain(section);
      }
    });
  });

  it('resolves every same-origin link target with a 200', async () => {
    await tracked('/llms.txt', async () => {
      const body = await (await fetch(`${baseUrl}/llms.txt`)).text();
      const targets = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);
      const sameOrigin = targets.filter((url) => url.startsWith(SITE_URL));
      // The system map always advertises at least the docs index and the two
      // CLI chapters — same-origin link resolution is the load-bearing check
      // here; the one external GitHub link is out of scope for a hermetic
      // suite that must not depend on network reachability.
      expect(sameOrigin.length).toBeGreaterThan(0);
      for (const url of sameOrigin) {
        const response = await fetch(url.replace(SITE_URL, baseUrl));
        expect(response.status, url).toBe(200);
      }
    });
  });
});

describe('GET /docs/llms.txt — docs index', () => {
  it('serves text/plain', async () => {
    await tracked('/docs/llms.txt', async () => {
      const response = await fetch(`${baseUrl}/docs/llms.txt`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
    });
  });

  it('body ends with the real Fumadocs-generated index (.md link targets applied)', async () => {
    await tracked('/docs/llms.txt', async () => {
      const body = await (await fetch(`${baseUrl}/docs/llms.txt`)).text();
      expect(body.endsWith(withMdLinks(llms(source).index()))).toBe(true);
    });
  });
});

describe('llms-full.txt variants', () => {
  it.each(['/llms-full.txt', '/docs/llms-full.txt'])('serves 200 text/plain for %s', async (path) => {
    await tracked(path, async () => {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
      expect((await response.text()).length).toBeGreaterThan(0);
    });
  });

  // Printed on every run, pass or fail — see code-equivalence.test.ts for the
  // rationale. `process.stdout.write`, not `console.log`: vitest swallows
  // test-side `console` output on a passing run.
  afterAll(() => {
    const lines = [`llms.txt family: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
    for (const resource of EXPECTED_RESOURCES) {
      lines.push(`  ${resource}: ${formatOutcome(resource)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});
