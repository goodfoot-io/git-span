/**
 * Stub for the font `?url` asset imports in [root.tsx](../../root.tsx).
 *
 * The preload URLs are resolved through vite's asset pipeline at build time.
 * Under vitest's jsdom environment the asset transform then trips vite's
 * server fs.allow check, because this checkout's node_modules is a symlink
 * farm whose realpaths (the hoisted store) fall outside the allow list. The
 * URLs are only consumed by the `links` export, which no test renders, so the
 * five imports resolve here for import resolution alone (see the alias in
 * vitest.config.ts).
 */
export default '/stub/font-url.woff2';
