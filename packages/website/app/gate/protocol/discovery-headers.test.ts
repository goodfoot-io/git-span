// @vitest-environment node
/**
 * Protocol suite: the `describedby`/`alternate` `Link` relations from
 * `~/lib/discovery-links` and the constant agent-skills relation, asserted
 * over real HTTP for a representative sample of pages in HTML, negotiated-
 * Markdown, and `.md` URL form.
 *
 * @summary Discovery `Link` header protocol assertions
 */
import { describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { AGENT_SKILLS_LINK } from '~/lib/agent-skills';
import { getDiscoveryLinks, serializeDiscoveryLink } from '~/lib/discovery-links';

const { baseUrl } = readGateServerInfo();

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

describe.each([
  { label: 'homepage', htmlPath: '/', mdUrlPath: '/index.md' },
  { label: 'docs page', htmlPath: '/docs/overview', mdUrlPath: '/docs/overview.md' }
])('discovery Link headers for $label', ({ htmlPath, mdUrlPath }) => {
  it('advertises on the HTML form', async () => {
    const response = await fetch(`${baseUrl}${htmlPath}`);
    expect(response.status).toBe(200);
    expectDiscoveryLinks(response.headers.get('Link'), htmlPath);
  });

  it('advertises on the negotiated-Markdown form', async () => {
    const response = await fetch(`${baseUrl}${htmlPath}`, { headers: { Accept: 'text/markdown' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expectDiscoveryLinks(response.headers.get('Link'), htmlPath);
  });

  it('advertises on the .md URL form', async () => {
    const response = await fetch(`${baseUrl}${mdUrlPath}`);
    expect(response.status).toBe(200);
    expectDiscoveryLinks(response.headers.get('Link'), mdUrlPath);
  });
});
