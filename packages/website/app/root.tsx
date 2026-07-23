import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { LinksFunction, MetaFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import { buildRouteMeta, DEFAULT_TITLE } from '~/lib/meta';
import globalStyles from '~/styles/global.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'icon', type: 'image/png', href: '/favicon.png' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
];

// The fallback layer: a leaf route's `meta` export replaces the running meta array
// entirely rather than merging with it, so any route that doesn't define its own `meta`
// (current or future) inherits this array verbatim via `buildRouteMeta`.
export const meta: MetaFunction = ({ location }) =>
  buildRouteMeta({ title: DEFAULT_TITLE, pathname: location.pathname });

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
