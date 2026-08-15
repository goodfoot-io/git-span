import { cleanup, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { PageDiscoveryLinks } from '~/root';

// React 19 hoists <link> elements into document.head, so the assertions query
// the head rather than the render container. globals: false means no automatic
// testing-library cleanup — without it, one test's head links leak into the
// next render.
afterEach(cleanup);

function renderAt(pathname: string) {
  const router = createMemoryRouter([{ path: '*', Component: () => <PageDiscoveryLinks /> }], {
    initialEntries: [pathname]
  });
  return render(<RouterProvider router={router} />);
}

function links(rel: string): HTMLLinkElement | null {
  return document.head.querySelector(`link[rel="${rel}"]`);
}

describe('PageDiscoveryLinks', () => {
  it('renders the homepage relations at /', () => {
    renderAt('/');
    expect(document.head.querySelectorAll('link').length).toBe(2);
    const alternate = links('alternate');
    expect(alternate?.getAttribute('href')).toBe('/index.md');
    expect(alternate?.getAttribute('type')).toBe('text/markdown');
    expect(links('describedby')?.getAttribute('href')).toBe('/llms.txt');
  });

  it('renders the docs relations at a docs path', () => {
    renderAt('/docs/overview');
    const alternate = links('alternate');
    expect(alternate?.getAttribute('href')).toBe('/docs/overview.md');
    expect(alternate?.getAttribute('type')).toBe('text/markdown');
    expect(links('describedby')?.getAttribute('href')).toBe('/docs/llms.txt');
  });

  it('renders nothing at a non-content path', () => {
    renderAt('/api/repos');
    expect(document.head.querySelectorAll('link').length).toBe(0);
  });

  it('renders decoded relations for a percent-encoded pathname', () => {
    renderAt('/docs/guides/reconcile%2Ddrifted-spans');
    const alternate = links('alternate');
    expect(alternate?.getAttribute('href')).toBe('/docs/guides/reconcile-drifted-spans.md');
    expect(alternate?.getAttribute('type')).toBe('text/markdown');
    expect(links('describedby')?.getAttribute('href')).toBe('/docs/llms.txt');
  });

  it('renders both relations for a %2F-encoded segment', () => {
    renderAt('/docs/guides%2Freconcile-drifted-spans');
    expect(links('alternate')?.getAttribute('href')).toBe('/docs/guides/reconcile-drifted-spans.md');
    expect(links('describedby')?.getAttribute('href')).toBe('/docs/llms.txt');
  });

  it('renders canonical relations for a case-variant docs prefix', () => {
    renderAt('/DOCS/overview');
    expect(links('alternate')?.getAttribute('href')).toBe('/docs/overview.md');
    expect(links('describedby')?.getAttribute('href')).toBe('/docs/llms.txt');
  });
});
