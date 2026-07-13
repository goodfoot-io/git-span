import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { ComponentType } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import { source } from '~/lib/source';

// Eagerly import all MDX/MD files to get the compiled React components,
// avoiding serialization issues with useLoaderData (functions are dropped by JSON).
const DOC_FILES = import.meta.glob('../../content/docs/**/*.{mdx,md}', {
  eager: true,
  query: { collection: 'docs' }
});

// Build a map from content-docs-relative path (no extension) to MDX component
const DOC_BODIES: Record<string, ComponentType> = {};
for (const [filepath, mod] of Object.entries(DOC_FILES)) {
  const key = filepath.replace(/^\.\.\/\.\.\/content\/docs\//, '').replace(/\.(mdx|md)$/, '');
  DOC_BODIES[key] = (mod as { default: ComponentType }).default;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const urlPath = params['*'] ?? '';

  // Redirect bare /docs to the overview page
  if (urlPath === '' || urlPath === '/') {
    throw redirect('/docs/overview');
  }

  const page = source.getPage([urlPath]);
  if (!page) {
    throw new Response('Not found', { status: 404 });
  }

  return {
    path: page.path,
    title: page.data.title as string,
    description: page.data.description as string | undefined,
    toc: page.data.toc,
    tree: source.pageTree
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) return [{ title: 'Docs — git-span' }];
  return [
    { title: `${loaderData.title} — git-span docs` },
    ...(loaderData.description ? [{ name: 'description', content: loaderData.description }] : [])
  ];
};

export default function DocsRoute() {
  const { path, title, tree } = useLoaderData<typeof loader>();
  const MDXBody = DOC_BODIES[path];

  return (
    <DocsLayout tree={tree} nav={{ title: 'git-span', enabled: false }}>
      <DocsPage>
        <DocsTitle>{title}</DocsTitle>
        <DocsBody>{MDXBody ? <MDXBody /> : null}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
