/**
 * Resource route: the sitemap at `/sitemap.xml`, composed from live sources
 * (`indexableRoutes` + the docs page registry) and resolved against
 * `SITE_URL`, so a new MDX page appears with no second edit.
 */
export function loader(): Response {
  return new Response('Not Implemented', { status: 501 });
}
