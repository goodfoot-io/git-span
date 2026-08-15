/**
 * The shared declaration of public HTML pages the sitemap advertises.
 *
 * Both consumers read this one array: `routes.ts` registers each entry as a
 * route, and the sitemap loader maps it to a `<loc>`. A future public
 * marketing page is one edit in one file — divergence between the route table
 * and the sitemap is impossible by construction.
 *
 * Declarations are relative to the origin root — no leading or trailing
 * slash. The sitemap composes `/${path}` from each entry; a leading-slash
 * declaration (`'/pricing'`) would compose to `//pricing`, which WHATWG URL
 * parsing treats as protocol-relative and resolves to `https://pricing/` — a
 * foreign host the origin does not serve. Check 12 pins the convention and
 * the loader does not normalize, so a violation surfaces at test time rather
 * than being silently masked.
 */
export interface IndexableRoute {
  path: string;
  file: string;
}

export const indexableRoutes: readonly IndexableRoute[] = [];
