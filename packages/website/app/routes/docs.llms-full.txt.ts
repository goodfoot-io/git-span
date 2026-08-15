/**
 * Resource route: the full docs corpus at `/docs/llms-full.txt`, every
 * chapter's Markdown concatenated in authored reading order.
 *
 * @summary Docs-scope llms-full.txt corpus resource route
 */
import { renderDocsCorpus } from '~/lib/llms-resources';

const headers = { 'Content-Type': 'text/plain; charset=utf-8' };

export async function loader(): Promise<Response> {
  return new Response(await renderDocsCorpus(), { headers });
}
