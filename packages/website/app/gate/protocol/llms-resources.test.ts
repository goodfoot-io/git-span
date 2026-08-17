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
import { describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { withMdLinks } from '~/lib/llms-resources';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const TEXT_PLAIN = 'text/plain; charset=utf-8';

describe('GET /llms.txt — root system map', () => {
  it('serves text/plain with the annotated system map', async () => {
    const response = await fetch(`${baseUrl}/llms.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
    const body = await response.text();
    expect(body).toMatch(/^# git-span\n\n> .+/);
    for (const section of ['## Start here', '## Source', '## CLI', '## Agent integrations', '## Optional']) {
      expect(body).toContain(section);
    }
  });

  it('resolves every same-origin link target with a 200', async () => {
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

describe('GET /docs/llms.txt — docs index', () => {
  it('serves text/plain', async () => {
    const response = await fetch(`${baseUrl}/docs/llms.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
  });

  it('body ends with the real Fumadocs-generated index (.md link targets applied)', async () => {
    const body = await (await fetch(`${baseUrl}/docs/llms.txt`)).text();
    expect(body.endsWith(withMdLinks(llms(source).index()))).toBe(true);
  });
});

describe('llms-full.txt variants', () => {
  it.each(['/llms-full.txt', '/docs/llms-full.txt'])('serves 200 text/plain for %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(TEXT_PLAIN);
    expect((await response.text()).length).toBeGreaterThan(0);
  });
});
