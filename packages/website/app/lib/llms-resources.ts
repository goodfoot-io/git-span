/**
 * Shared generators for the llms.txt v2 resources: the docs index's Markdown
 * link targets, the full corpus walk, and the corpus renderer. One module
 * holds everything the two generated resources and their tests share, so the
 * docs-scope and root-scope full files cannot diverge.
 *
 * @summary Shared generators for the generated llms.txt resources
 */
import type { Item, Node } from 'fumadocs-core/page-tree';
import { getLLMText } from '~/lib/get-llm-text';
import { source } from '~/lib/source';

/**
 * Walk page-tree nodes in authored reading order: `page` nodes as they
 * appear, a folder's `index` page before its children, separators skipped.
 *
 * @param nodes - The page-tree children to walk.
 * @returns The pages in reading order.
 */
export function collectPageNodes(nodes: Node[]): Item[] {
  const items: Item[] = [];
  for (const node of nodes) {
    if (node.type === 'page') {
      items.push(node);
    } else if (node.type === 'folder') {
      if (node.index) items.push(node.index);
      items.push(...collectPageNodes(node.children));
    }
  }
  return items;
}

/**
 * Rewrite `](/docs/X)` link targets in the docs index to `](/docs/X.md)` so
 * every entry points at that chapter's Markdown representation. Idempotent for
 * already-`.md` targets; every other link is left untouched. Safe only because
 * the input is the fully-controlled `llms(source).index()` output.
 *
 * The replacement is built from the matched span, never by re-searching the
 * captured slug inside it: a slug that is a substring of the literal
 * `](/docs/` prefix (or appears earlier in the span) would otherwise be
 * rewritten at the wrong position. A `#fragment` or `?query` suffix stays
 * after the `.md` — the chapter's Markdown URL is the slug plus `.md`, and
 * `#flags.md` points nowhere.
 *
 * @param index - The live `llms(source).index()` output.
 * @returns The index with docs link targets rewritten to `.md`.
 */
const DOCS_LINK_TARGET = /\]\(\/docs\/([^)]+)\)/g;

export function withMdLinks(index: string): string {
  return index.replace(DOCS_LINK_TARGET, (match, target) => {
    const base = target.split(/[#?]/, 1)[0];
    if (!base || base.endsWith('.md')) return match;
    return `${match.slice(0, match.length - target.length - 1)}${base}.md${target.slice(base.length)})`;
  });
}

/**
 * Render one docs chapter for the corpus, fail-closed: an unregistered page or
 * a failed render throws a `500` `Response` naming the chapter URL, so one
 * broken chapter takes the whole corpus down with an accurate status instead
 * of silently dropping out. A thrown `Response` is returned verbatim by the
 * resource-route runtime, so callers serve the status, never a partial body.
 *
 * @param node - A page-tree item walked from the live source.
 * @returns The chapter's LLM-ready Markdown.
 */
export async function renderChapter(node: Item): Promise<string> {
  const page = source.getNodePage(node);
  if (!page) {
    throw new Response(`Corpus render failed: no page registered for "${node.url}"`, { status: 500 });
  }
  try {
    return await getLLMText(page);
  } catch {
    throw new Response(`Corpus render failed: could not render "${node.url}"`, { status: 500 });
  }
}

/**
 * Render every docs chapter's full Markdown concatenated in authored reading
 * order, each chapter separated by a blank line.
 *
 * @returns The complete docs corpus.
 */
export async function renderDocsCorpus(): Promise<string> {
  const rendered = await Promise.all(collectPageNodes(source.pageTree.children).map(renderChapter));
  return rendered.join('\n\n');
}
