import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { servedRobotsViolations } from './served-robots';

const sitemapUrl = 'https://git-span.com/sitemap.xml';

describe('servedRobotsViolations', () => {
  it('flags the Cloudflare managed placeholder as serving no policy', () => {
    // Captured live 2026-08-15: GET /robots.txt returned 1248 bytes of pure
    // comment lines (the Content Signals preamble) — no directive at all.
    const placeholder = readFileSync(
      path.join(process.cwd(), 'app/test/fixtures/cloudflare-robots-placeholder.txt'),
      'utf8'
    );
    expect(servedRobotsViolations(placeholder, { sitemapUrl })).toEqual([
      "missing 'User-agent: GPTBot' stanza with 'Allow: /'",
      `missing 'Sitemap: ${sitemapUrl}' line`
    ]);
  });

  it('accepts the repository robots.txt as the served policy', () => {
    const robots = readFileSync(path.join(process.cwd(), 'public/robots.txt'), 'utf8');
    expect(servedRobotsViolations(robots, { sitemapUrl })).toEqual([]);
  });

  it('reports only the missing Sitemap line when the GPTBot stanza is present', () => {
    expect(servedRobotsViolations('User-agent: GPTBot\nAllow: /\n', { sitemapUrl })).toEqual([
      `missing 'Sitemap: ${sitemapUrl}' line`
    ]);
  });

  it('reports only the missing GPTBot stanza when the Sitemap line is present', () => {
    expect(servedRobotsViolations(`Sitemap: ${sitemapUrl}\n`, { sitemapUrl })).toEqual([
      "missing 'User-agent: GPTBot' stanza with 'Allow: /'"
    ]);
  });

  it('flags a foreign sitemap URL even when the line exists', () => {
    const robots = readFileSync(path.join(process.cwd(), 'public/robots.txt'), 'utf8');
    expect(servedRobotsViolations(robots, { sitemapUrl: 'https://elsewhere.example/sitemap.xml' })).toEqual([
      "missing 'Sitemap: https://elsewhere.example/sitemap.xml' line"
    ]);
  });
});
