import { RootProvider } from 'fumadocs-ui/provider/react-router';
import type { LinksFunction, MetaFunction } from 'react-router';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { Footer } from '~/components/Footer';
import { Header } from '~/components/Header';
import globalStyles from '~/styles/global.css?url';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: globalStyles }];

export const meta: MetaFunction = () => [
  { charset: 'utf-8' },
  { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  { name: 'theme-color', content: '#0d1117' },
  { property: 'og:type', content: 'website' },
  { property: 'og:site_name', content: 'git-span' }
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
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
