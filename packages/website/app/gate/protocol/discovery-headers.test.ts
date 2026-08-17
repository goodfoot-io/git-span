// @vitest-environment node
/**
 * Protocol suite: the `describedby`/`alternate` `Link` relations from
 * `~/lib/discovery-links` and the constant agent-skills relation, asserted
 * over real HTTP for a representative sample of pages in HTML, negotiated-
 * Markdown, and `.md` URL form.
 *
 * @summary Discovery `Link` header protocol assertions
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { AGENT_SKILLS_LINK } from '~/lib/agent-skills';
import { getDiscoveryLinks, serializeDiscoveryLink } from '~/lib/discovery-links';

const { baseUrl } = readGateServerInfo();

const PAGES = [
  { label: 'homepage', htmlPath: '/', mdUrlPath: '/index.md' },
  { label: 'docs page', htmlPath: '/docs/overview', mdUrlPath: '/docs/overview.md' }
];

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = PAGES.flatMap(({ label }) => [
  `${label} (HTML)`,
  `${label} (negotiated Markdown)`,
  `${label} (.md URL)`
]);

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

function expectDiscoveryLinks(linkHeader: string | null, pathname: string): void {
  expect(linkHeader).not.toBeNull();
  const header = linkHeader ?? '';
  const expectedDescriptors = getDiscoveryLinks(pathname);
  expect(expectedDescriptors.length).toBeGreaterThan(0);
  for (const descriptor of expectedDescriptors) {
    expect(header).toContain(serializeDiscoveryLink(descriptor));
  }
  expect(header).toContain(AGENT_SKILLS_LINK);
}

describe.each(PAGES)('discovery Link headers for $label', ({ label, htmlPath, mdUrlPath }) => {
  it('advertises on the HTML form', async () => {
    await tracked(`${label} (HTML)`, async () => {
      const response = await fetch(`${baseUrl}${htmlPath}`);
      expect(response.status).toBe(200);
      expectDiscoveryLinks(response.headers.get('Link'), htmlPath);
    });
  });

  it('advertises on the negotiated-Markdown form', async () => {
    await tracked(`${label} (negotiated Markdown)`, async () => {
      const response = await fetch(`${baseUrl}${htmlPath}`, { headers: { Accept: 'text/markdown' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expectDiscoveryLinks(response.headers.get('Link'), htmlPath);
    });
  });

  it('advertises on the .md URL form', async () => {
    await tracked(`${label} (.md URL)`, async () => {
      const response = await fetch(`${baseUrl}${mdUrlPath}`);
      expect(response.status).toBe(200);
      expectDiscoveryLinks(response.headers.get('Link'), mdUrlPath);
    });
  });
});

// Printed on every run, pass or fail — see code-equivalence.test.ts for the
// rationale. `process.stdout.write`, not `console.log`: vitest swallows
// test-side `console` output on a passing run.
afterAll(() => {
  const lines = [`Discovery Link headers: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
  for (const resource of EXPECTED_RESOURCES) {
    lines.push(`  ${resource}: ${formatOutcome(resource)}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});
