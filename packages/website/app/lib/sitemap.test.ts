import { describe, expect, it } from 'vitest';
import { renderSitemap } from '~/lib/sitemap';

const FIXTURE_ORIGIN = 'https://example.com';

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

describe('renderSitemap', () => {
  it('emits exactly the fixture locations, each absolute under the origin', () => {
    // The sitemap protocol defines no URL order, so the set — never the order
    // — is the load-bearing contract; sorted-array equality pins it.
    const out = locs(renderSitemap(['/', '/docs/overview', '/docs/guides/re-anchor-after-an-edit'], FIXTURE_ORIGIN));
    const expected = [
      'https://example.com/',
      'https://example.com/docs/overview',
      'https://example.com/docs/guides/re-anchor-after-an-edit'
    ].sort();
    expect([...out].sort()).toEqual(expected);
    for (const loc of out) expect(loc.startsWith('https://example.com/')).toBe(true);
  });

  it('dedupes repeated paths to a single <loc>', () => {
    const out = locs(renderSitemap(['/', '/docs/overview', '/', '/docs/overview'], FIXTURE_ORIGIN));
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(['https://example.com/', 'https://example.com/docs/overview']));
  });

  it('XML-escapes exactly the hazardous characters and nothing else', () => {
    // `&` survives WHATWG URL resolution and must become `&amp;`. `<`, `>`,
    // `"` are percent-encoded by the URL parser before escaping ever sees
    // them, so the emitted document carries `%3C`/`%3E`/`%22` and no raw
    // character. Apostrophes are legal in XML text; escaping them would widen
    // the entity set, so they must pass through raw.
    const out = renderSitemap(['/docs/a&b<c>d"e', "/docs/it's"], FIXTURE_ORIGIN);
    const [escaped, apostrophe] = locs(out);
    expect(out).toContain('&amp;');
    expect(escaped).toBe('https://example.com/docs/a&amp;b%3Cc%3Ed%22e');
    expect(apostrophe).toBe("https://example.com/docs/it's");
    for (const raw of ['a&b', '<c>', 'd"e', '&apos;']) expect(out).not.toContain(raw);
  });

  it('resolves relative paths against the origin and never emits a foreign host', () => {
    // new URL semantics: a leading-slash path is origin-rooted, a bare path
    // resolves against the origin root too — and no other host can enter.
    const out = locs(renderSitemap(['/docs/overview', 'docs/guides/re-anchor-after-an-edit'], FIXTURE_ORIGIN));
    expect(out).toHaveLength(2);
    for (const loc of out) expect(loc.startsWith('https://example.com/')).toBe(true);
  });
});
