/**
 * Shared LLM-text renderer for the docs Markdown negotiation and `.md` paths.
 *
 * Fail-closed: a missing page throws 404 and missing processed Markdown throws
 * 500, so callers never serve a silently empty body. Processed Markdown is
 * available because the docs collection sets `includeProcessedMarkdown`.
 *
 * @summary Docs page LLM Markdown helper.
 */
import type { source } from '~/lib/source';

/** A single page from the docs source loader. */
type DocsPage = ReturnType<typeof source.getPage>;

/**
 * Render the LLM-ready Markdown for a single docs page.
 *
 * The body is the processed markdown with the stringifier's frontmatter
 * preamble stripped and `<Callout>` blocks rewritten as GFM alerts, prefixed
 * with the page title and canonical URL.
 *
 * @param page - The resolved docs page, or `undefined` when none matched.
 * @returns Markdown prefixed with the page title and canonical URL.
 * @summary LLM text for one docs page.
 */
export async function getLLMText(_page: DocsPage): Promise<string> {
  throw new Error('Not Implemented');
}
