import { index, type RouteConfig, route } from '@react-router/dev/routes';

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
  route('llms-full.txt', 'routes/llms-full.txt.ts')
] satisfies RouteConfig;
