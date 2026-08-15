/**
 * Stub for `virtual:react-router/server-build` under vitest.
 *
 * [worker.ts](../../worker.ts) resolves this virtual module through the lazy
 * server-build loader it passes to `createRequestHandler`, but no build emits
 * it in a test run. This stub satisfies Vite's import resolution during
 * transform; the SSR handler itself is replaced by a vitest mock on
 * `react-router` in the worker tests, so these values are never executed.
 *
 * The exports mirror the shape React Router's typegen declares for the
 * virtual module (`.react-router/types/+server-build.d.ts`).
 */
export const assets = {};
export const assetsBuildDirectory = '';
export const basename = '/';
export const entry = { module: '' };
export const future = {};
export const isSpaMode = false;
export const prerender: string[] = [];
export const publicPath = '/';
export const routeDiscovery = { mode: 'lazy' as const, manifestPath: '' };
export const routes = {};
export const ssr = true;
export const allowedActionOrigins = [] as string[];
export const unstable_getCriticalCss = undefined;
