import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { LoaderFunctionArgs } from 'react-router';
import { redirect, useLoaderData } from 'react-router';
import { source } from '~/lib/source';

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

  return { page, tree: source.pageTree };
}

export default function DocsRoute() {
  const { page, tree } = useLoaderData<typeof loader>();

  // page.data.body is the compiled MDX component (entry.default from fumadocs-mdx runtime)
  const Body = (page.data as { body?: React.ComponentType }).body;

  return (
    <DocsLayout tree={tree} nav={{ title: 'git-span', enabled: false }}>
      <DocsPage>
        <DocsTitle>{page.data.title as string}</DocsTitle>
        <DocsBody>{Body ? <Body /> : null}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
