import browserCollections from 'collections/browser';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import docOgImages from '~/lib/doc-og-images.json';
import { buildRouteMeta } from '~/lib/meta';
import { source } from '~/lib/source';

const clientLoader = browserCollections.docs.createClientLoader({
  component({ default: MDX }) {
    return <MDX components={defaultMdxComponents} />;
  }
});

export async function loader({ params }: LoaderFunctionArgs) {
  const urlPath = params['*'] ?? '';

  // Redirect bare /docs to the overview page
  if (urlPath === '' || urlPath === '/') {
    throw redirect('/docs/overview');
  }

  const page = source.getPage(urlPath.split('/'));
  if (!page) {
    throw new Response('Not found', { status: 404 });
  }

  const slugKey = page.slugs.join('/');
  const ogImagePath = (docOgImages as Record<string, string>)[slugKey];
  const title = page.data.title as string;

  return {
    path: page.path,
    title,
    description: page.data.description as string | undefined,
    toc: page.data.toc,
    tree: source.pageTree,
    ogImage: ogImagePath ? { path: ogImagePath, alt: title } : undefined
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, location }) => {
  if (!loaderData) return buildRouteMeta({ title: 'Docs — git-span', pathname: location.pathname });
  return buildRouteMeta({
    title: `${loaderData.title} — git-span docs`,
    description: loaderData.description,
    pathname: location.pathname,
    image: loaderData.ogImage
  });
};

export default function DocsRoute() {
  const { path, title, tree } = useLoaderData<typeof loader>();

  return (
    <DocsLayout
      tree={tree}
      nav={{ title: 'git-span', enabled: false }}
      // The sidebar's built-in sun/moon toggle switches next-themes' theme, but RootProvider
      // (root.tsx) has theme.enabled: false -- this is a single-theme (light-only) site with no
      // ThemeProvider mounted, so the control is a dead no-op. Disable it rather than ship a
      // button that does nothing when clicked.
      themeSwitch={{ enabled: false }}
    >
      <DocsPage>
        <DocsTitle>{title}</DocsTitle>
        <DocsBody>{clientLoader.useContent(path)}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
