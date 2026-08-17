// @vitest-environment node
/**
 * Protocol suite: `robots.txt` and `sitemap.xml`, asserted over real HTTP
 * against the booted Worker.
 *
 * @summary Crawler-discovery surface protocol assertions
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';

const { baseUrl } = readGateServerInfo();
const ROBOTS_PATH = path.join(process.cwd(), 'public/robots.txt');

describe('GET /robots.txt', () => {
  it('serves bytes identical to the committed public/robots.txt', async () => {
    const committed = readFileSync(ROBOTS_PATH);
    const response = await fetch(`${baseUrl}/robots.txt`);
    expect(response.status).toBe(200);
    const served = Buffer.from(await response.arrayBuffer());
    expect(Buffer.compare(served, committed)).toBe(0);
  });

  it('advertises every bot stanza and the canonical Sitemap line', async () => {
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

describe('GET /sitemap.xml', () => {
  it('serves application/xml; charset=utf-8', async () => {
    const response = await fetch(`${baseUrl}/sitemap.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
  });

  it('lists exactly the homepage plus every docs page as canonical https://git-span.com URLs', async () => {
    const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    const locs = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    const expected = [`${SITE_URL}/`, ...source.getPages().map((page) => `${SITE_URL}${page.url}`)].sort();
    expect([...locs].sort()).toEqual(expected);
  });

  it('never indexes the machine-readable families', async () => {
    const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    const locs = [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    for (const loc of locs) {
      expect(loc).not.toMatch(/\/llms/);
      expect(loc).not.toMatch(/\/schemas/);
      expect(loc).not.toMatch(/\/\.well-known/);
    }
  });
});
