/**
 * Resource route: the root full corpus at `/llms-full.txt` — the homepage
 * Markdown plus the same docs corpus the docs-scope route serves, composed
 * from one shared generator so the two full files cannot diverge.
 *
 * @summary Root llms-full.txt corpus resource route
 */
import { renderHomepageMarkdown } from '~/lib/homepage-markdown';
import { renderDocsCorpus } from '~/lib/llms-resources';

const headers = { 'Content-Type': 'text/plain; charset=utf-8' };

export async function loader(): Promise<Response> {
  return new Response([renderHomepageMarkdown(), await renderDocsCorpus()].join('\n\n'), { headers });
}
