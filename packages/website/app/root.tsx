import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';
import plexMono600 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url';
// The latin faces' woff2 URLs, resolved through vite's asset pipeline so the
// preload fetches land on the same hashed URLs the bundled fontsource CSS
// references — a second fetch of a differently-named file would leave the
// swap race intact. See root.tsx `links` below.
import plexSansWghtItalic from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-italic.woff2?url';
import plexSansWghtNormal from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { LinkDescriptor, LinksFunction, MetaFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from 'react-router';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import { getDiscoveryLinks } from '~/lib/discovery-links';
import { buildRouteMeta, DEFAULT_DESCRIPTION, DEFAULT_TITLE } from '~/lib/meta';
import globalStyles from '~/styles/global.css?url';

// Font preloads: fontsource's `font-display: swap` paints text with a
// fallback font and reflows when the webfont lands; when that lands just
// after first paint the reflow registers as Cumulative Layout Shift — the
// regression measured on three docs pages by the agentic gate. Kicking the
// fetch off at navigation (instead of at CSSOM parse, where the bundled
// fontsource rules sit late in the stylesheet) makes the fonts win the race
// against first paint. `crossOrigin` is required for the preload cache entry
// to be reusable by the CORS-mode font fetch the CSS triggers — without it
// the preload is a wasted fetch that leaves the swap intact.
const FONT_PRELOADS = [
  { href: plexSansWghtNormal, type: 'font/woff2' },
  { href: plexSansWghtItalic, type: 'font/woff2' },
  { href: plexMono400, type: 'font/woff2' },
  { href: plexMono500, type: 'font/woff2' },
  { href: plexMono600, type: 'font/woff2' }
] as const;

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: globalStyles },
  ...FONT_PRELOADS.map(
    ({ href, type }): LinkDescriptor => ({
      rel: 'preload',
      href,
      as: 'font',
      type,
      crossOrigin: 'anonymous'
    })
  ),
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'icon', type: 'image/png', href: '/favicon.png' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
];

// The fallback layer: a leaf route's `meta` export replaces the running meta array
// entirely rather than merging with it, so any route that doesn't define its own `meta`
// (current or future) inherits this array verbatim via `buildRouteMeta`.
export const meta: MetaFunction = ({ location }) =>
  buildRouteMeta({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, pathname: location.pathname });

/**
 * The discovery relations for the active pathname as `<link>` elements —
 * the HTML-head mirror of the Worker's `Link` headers, resolved through the
 * same classifier so the two contracts cannot drift. `useLocation` keeps SSR
 * and client-side navigation on the same mapping.
 */
export function PageDiscoveryLinks() {
  const { pathname } = useLocation();
  return getDiscoveryLinks(pathname).map((descriptor) => (
    <link key={`${descriptor.rel}:${descriptor.href}`} {...descriptor} />
  ));
}

// charset/viewport/theme-color and og:type/og:site_name/twitter:card never vary per route,
// so they're rendered unconditionally here instead of going through the `meta` export --
// unlike og:title/description/url/image, which do vary and are handled by `buildRouteMeta`.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f4f1e8" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="git-span" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
        <PageDiscoveryLinks />
      </head>
      <body className="min-h-screen bg-ground text-ink-primary font-sans antialiased">
        <RootProvider search={{ enabled: false }} theme={{ enabled: false }}>
          <Header />
          <main className="pt-16">{children}</main>
          <Footer />
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
