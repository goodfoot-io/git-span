import type { MetaDescriptor } from 'react-router';
import { describe, expect, it } from 'vitest';
import { buildRouteMeta } from '~/lib/meta';

/**
 * Every route built through `buildRouteMeta` declares exactly one canonical
 * URL, in the slash-free extension-free form, and `og:url` never disagrees
 * with it. A route that renders a trailing-slash variant must not declare that
 * variant canonical — the docs loader redirects the variant before render, so
 * this guard is the second half of the same contract.
 */

function canonicalHref(meta: MetaDescriptor[] | undefined): string | undefined {
  for (const descriptor of meta ?? []) {
    if ('tagName' in descriptor && descriptor.tagName === 'link' && descriptor.rel === 'canonical') {
      return typeof descriptor.href === 'string' ? descriptor.href : undefined;
    }
  }
  return undefined;
}

function labels(meta: MetaDescriptor[]): string[] {
  return meta.flatMap((descriptor) => {
    if ('name' in descriptor && typeof descriptor.name === 'string') return [descriptor.name];
    if ('property' in descriptor && typeof descriptor.property === 'string') return [descriptor.property];
    return [];
  });
}

function contentByName(meta: MetaDescriptor[], name: string): string | undefined {
  for (const descriptor of meta) {
    if ('name' in descriptor && descriptor.name === name && typeof descriptor.content === 'string') {
      return descriptor.content;
    }
  }
  return undefined;
}

function contentByProperty(meta: MetaDescriptor[], property: string): string | undefined {
  for (const descriptor of meta) {
    if ('property' in descriptor && descriptor.property === property && typeof descriptor.content === 'string') {
      return descriptor.content;
    }
  }
  return undefined;
}

describe('buildRouteMeta canonical link', () => {
  it('declares exactly one canonical descriptor for a docs pathname', () => {
    const meta = buildRouteMeta({ title: 'Introduction — git-span docs', pathname: '/docs/overview' });
    const links = meta.filter((descriptor) => 'tagName' in descriptor && descriptor.tagName === 'link');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ tagName: 'link', rel: 'canonical', href: 'https://git-span.com/docs/overview' });
  });

  it('strips trailing slashes so a slash variant never declares itself canonical', () => {
    const meta = buildRouteMeta({ title: 'Introduction — git-span docs', pathname: '/docs/overview/' });
    expect(canonicalHref(meta)).toBe('https://git-span.com/docs/overview');
  });

  it('keeps the root pathname canonical as https://git-span.com/', () => {
    const meta = buildRouteMeta({ title: 'git-span', pathname: '/' });
    expect(canonicalHref(meta)).toBe('https://git-span.com/');
  });

  it('keeps og:url in lockstep with the canonical href', () => {
    for (const [pathname, expected] of [
      ['/docs/overview', 'https://git-span.com/docs/overview'],
      ['/docs/overview/', 'https://git-span.com/docs/overview'],
      ['/', 'https://git-span.com/']
    ]) {
      const meta = buildRouteMeta({ title: 't', pathname });
      expect(canonicalHref(meta)).toBe(expected);
      expect(contentByProperty(meta, 'og:url')).toBe(expected);
    }
  });
});

describe('buildRouteMeta description tags', () => {
  it('omits the description, og:description, and twitter:description tags when no description is given', () => {
    const meta = buildRouteMeta({ title: 'No description', pathname: '/docs/never' });
    expect(labels(meta)).not.toContain('description');
    expect(labels(meta)).not.toContain('og:description');
    expect(labels(meta)).not.toContain('twitter:description');
  });

  it('carries the same description on all three tags when one is given', () => {
    const meta = buildRouteMeta({ title: 't', description: 'The page description.', pathname: '/docs/x' });
    expect(contentByName(meta, 'description')).toBe('The page description.');
    expect(contentByProperty(meta, 'og:description')).toBe('The page description.');
    expect(contentByName(meta, 'twitter:description')).toBe('The page description.');
  });
});
