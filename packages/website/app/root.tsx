import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { LinksFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import globalStyles from '~/styles/global.css?url';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'icon', type: 'image/png', href: '/favicon.png' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
];

// None of this site-wide meta is declared via the `meta` export: a leaf route's `meta`
// export replaces the root's entirely, so any route defining `meta` (as every real route
// here does, for title/description) would silently drop it. These are document-level
// invariants and are rendered unconditionally in <head> below instead.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f4f1e8" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="git-span" />
        <meta property="og:image" content="https://git-span.com/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Git tracks changes. Spans track connections." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://git-span.com/og-image.png" />
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
