import browserCollections from 'collections/browser';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import { source } from '~/lib/source';

const clientLoader = browserCollections.docs.createClientLoader({
  component({ default: MDX }) {
    return <MDX />;
  }
});

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

  return (
    <DocsLayout tree={tree} nav={{ title: 'git-span', enabled: false }}>
      <DocsPage>
        <DocsTitle>{title}</DocsTitle>
        <DocsBody>{clientLoader.useContent(path)}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
