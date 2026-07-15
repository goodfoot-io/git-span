import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { LinksFunction, MetaFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import globalStyles from '~/styles/global.css?url';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: globalStyles }];

// charset and viewport are NOT declared here: a leaf route's `meta` export replaces the
// root's entirely, so any route defining `meta` would silently drop them. They are
// document-level invariants and are rendered unconditionally in <head> below.
export const meta: MetaFunction = () => [
  { name: 'theme-color', content: '#f2efe6' },
  { property: 'og:type', content: 'website' },
  { property: 'og:site_name', content: 'git-span' }
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
