import { index, type RouteConfig, route } from '@react-router/dev/routes';
// Relative, not `~/lib/indexable-routes`: react-router loads this file through
// its config loader, which runs before the vite `resolve.alias` config exists,
// so an alias import fails at typegen. The sitemap loader, loaded normally,
// imports the same array via `~` — one declaration, two import styles.
import { indexableRoutes } from './lib/indexable-routes';

export default [
  index('routes/_index.tsx'),
  route('docs', 'routes/docs/page.tsx', { id: 'docs-index' }),
  // The docs-scope resources sit above the splat as documentation of intent:
  // React Router ranks static segments above the splat regardless of table
  // order, so index position is not what keeps the splat from swallowing
  // them. The route test pins the match outcome, not the ordering.
  route('docs/llms.txt', 'routes/docs.llms.txt.ts'),
  route('docs/llms-full.txt', 'routes/docs.llms-full.txt.ts'),
  route('docs/*', 'routes/docs/page.tsx', { id: 'docs-splat' }),
  route('llms.txt', 'routes/llms.txt.ts'),
  route('llms-full.txt', 'routes/llms-full.txt.ts'),
  // Public HTML pages the sitemap advertises live in one declaration
  // (app/lib/indexable-routes.ts); the sitemap loader reads the same array,
  // so a page registered here appears there with no second edit. Empty today.
  ...indexableRoutes.map(({ path, file }) => route(path, file)),
  route('sitemap.xml', 'routes/sitemap.xml.ts')
] satisfies RouteConfig;
