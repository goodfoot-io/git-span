/**
 * Resource route: the root full corpus at `/llms-full.txt` — the homepage
 * Markdown plus the same docs corpus the docs-scope route serves, composed
 * from one shared generator so the two full files cannot diverge.
 *
 * @summary Root llms-full.txt corpus resource route
 */
export async function loader(): Promise<Response> {
  throw new Error('Not Implemented');
}
