import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PageDiscoveryLinks } from '~/root';

function renderAt(pathname: string) {
  const router = createMemoryRouter([{ path: '*', Component: () => <PageDiscoveryLinks /> }], {
    initialEntries: [pathname]
  });
  return render(<RouterProvider router={router} />);
}

function links(container: HTMLElement, rel: string): HTMLLinkElement | null {
  return container.querySelector(`link[rel="${rel}"]`);
}

describe('PageDiscoveryLinks', () => {
  it.skip('renders the homepage relations at /', () => {
    const { container } = renderAt('/');
    expect(container.querySelectorAll('link').length).toBe(2);
    const alternate = links(container, 'alternate');
    expect(alternate?.getAttribute('href')).toBe('/index.md');
    expect(alternate?.getAttribute('type')).toBe('text/markdown');
    expect(links(container, 'describedby')?.getAttribute('href')).toBe('/llms.txt');
  });

  it.skip('renders the docs relations at a docs path', () => {
    const { container } = renderAt('/docs/overview');
    const alternate = links(container, 'alternate');
    expect(alternate?.getAttribute('href')).toBe('/docs/overview.md');
    expect(alternate?.getAttribute('type')).toBe('text/markdown');
    expect(links(container, 'describedby')?.getAttribute('href')).toBe('/docs/llms.txt');
  });

  it.skip('renders nothing at a non-content path', () => {
    const { container } = renderAt('/api/repos');
    expect(container.querySelectorAll('link').length).toBe(0);
  });
});
