import type { RouteConfigEntry } from '@react-router/dev/routes';
import { matchRoutes, type RouteObject } from 'react-router';
import routes from '~/routes';

/** A runtime route object that keeps the module file its config entry declared. */
type FileRouteObject = RouteObject & { file: string };

function toRouteObject(entry: RouteConfigEntry): FileRouteObject {
  const { id, path, caseSensitive, file, children } = entry;
  if (entry.index === true) {
    if (children !== undefined) throw new Error(`index route ${file} declares children`);
    return { index: true, id, path, caseSensitive, file };
  }
  return { id, path, caseSensitive, file, children: children?.map(toRouteObject) };
}

/**
 * The dev route config (`app/routes.ts`) converted into the runtime route
 * objects the React Router matcher takes, so tests pin match outcomes against
 * the real table rather than its declaration order.
 */
const routeTable: FileRouteObject[] = routes.map(toRouteObject);

/** The module file of the deepest route matching `pathname`, or undefined when none matches. */
export function matchedFile(pathname: string): string | undefined {
  return matchRoutes(routeTable, pathname)?.at(-1)?.route.file;
}
