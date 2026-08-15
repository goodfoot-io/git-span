import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/_index.tsx'),
  route('docs', 'routes/docs/page.tsx', { id: 'docs-index' }),
  route('docs/llms.txt', 'routes/docs.llms.txt.ts'),
  route('docs/llms-full.txt', 'routes/docs.llms-full.txt.ts'),
  route('docs/*', 'routes/docs/page.tsx', { id: 'docs-splat' }),
  route('llms.txt', 'routes/llms.txt.ts'),
  route('llms-full.txt', 'routes/llms-full.txt.ts')
] satisfies RouteConfig;
