/**
 * Resource route: the scoped docs index at `/docs/llms.txt`, generated live
 * from the Fumadocs source so it cannot fall behind the content tree.
 *
 * @summary Docs-scope llms.txt index resource route
 */
import { llms } from 'fumadocs-core/source/llms';
import { withMdLinks } from '~/lib/llms-resources';
import { source } from '~/lib/source';

const headers = { 'Content-Type': 'text/plain; charset=utf-8' };

export function loader(): Response {
  return new Response(withMdLinks(llms(source).index()), { headers });
}
