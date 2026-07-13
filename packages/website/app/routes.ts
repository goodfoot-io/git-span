import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/_index.tsx'),
  route('docs', 'routes/docs/page.tsx', { id: 'docs-index' }),
  route('docs/*', 'routes/docs/page.tsx', { id: 'docs-splat' })
] satisfies RouteConfig;
