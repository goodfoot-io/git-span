/**
 * Resource route: the sitemap at `/sitemap.xml`, composed from live sources
 * (`indexableRoutes` + the docs page registry) and resolved against
 * `SITE_URL`, so a new MDX page appears with no second edit.
 *
 * Machine-readable exclusion is structural, not a filter list: the path list
 * has exactly three sources — the literal homepage, `indexableRoutes` (HTML
 * marketing pages only), and the docs page registry (canonical `/docs/...`
 * MDX pages only). No code path can emit the llms.txt family, `.md`
 * alternates, or bare `/docs`.
 */
import { indexableRoutes } from '~/lib/indexable-routes';
import { SITE_URL } from '~/lib/meta';
import { renderSitemap } from '~/lib/sitemap';
import { source } from '~/lib/source';

export function loader(): Response {
  const paths = ['/', ...indexableRoutes.map(({ path }) => `/${path}`), ...source.getPages().map(({ url }) => url)];
  return new Response(renderSitemap(paths, SITE_URL), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}
