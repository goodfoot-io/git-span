import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Header } from './Header';

// The header's first link is the logo-only route home. It must expose a name:
// a screen-reader user tabbing to it hears where it goes, and an agent
// enumerating the page's links finds the route home under a predictable name
// instead of an unnamed control it has to guess at from the URL. The shared
// [LogoMark](./Header.tsx#L8-L34) is correctly aria-hidden — the name must
// come from the link itself, not from un-hiding the mark.

describe('Header home link', () => {
  it('exposes a link named "home" that points at the site root', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink.getAttribute('href')).toBe('/');
  });
});
