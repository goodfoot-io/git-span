import browserCollections from 'collections/browser';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import docOgImages from '~/lib/doc-og-images.json';
import { buildRouteMeta } from '~/lib/meta';
import { RENAMED_DOC_SLUGS } from '~/lib/renamed-doc-slugs';
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

  // A trailing slash is an address variant, not a resource: strip it once up
  // front so every lookup below sees the canonical slug. The rename lookup
  // used to do this inline, but the page lookup did not — the reason a
  // trailing slash survived on renamed slugs and 404'd on current ones.
  const canonicalPath = urlPath.replace(/\/+$/, '');

  const renamedTo = RENAMED_DOC_SLUGS[canonicalPath];
  if (renamedTo) {
    throw redirect(`/docs/${renamedTo}`, 301);
  }

  const page = source.getPage(canonicalPath.split('/'));
  if (!page) {
    throw new Response('Not found', { status: 404 });
  }

  // Only settle the trailing-slash form on the canonical address once that
  // address is known to resolve — an unknown slug 404s in both forms rather
  // than redirecting to a dead end.
  if (canonicalPath !== urlPath) {
    throw redirect(`/docs/${canonicalPath}`, 301);
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
      nav={{ title: 'Documentation', enabled: false }}
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
