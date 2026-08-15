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
 * @param index - The live `llms(source).index()` output.
 * @returns The index with docs link targets rewritten to `.md`.
 */
const DOCS_LINK_TARGET = /\]\(\/docs\/([^)]+)\)/g;

export function withMdLinks(index: string): string {
  return index.replace(DOCS_LINK_TARGET, (match, target) => {
    if (target.endsWith('.md')) return match;
    return match.replace(target, `${target}.md`);
  });
}

/**
 * Render every docs chapter's full Markdown concatenated in authored reading
 * order, each chapter separated by a blank line.
 *
 * @returns The complete docs corpus.
 */
export async function renderDocsCorpus(): Promise<string> {
  const pages = collectPageNodes(source.pageTree.children);
  const rendered = await Promise.all(pages.map((node) => getLLMText(source.getNodePage(node))));
  return rendered.join('\n\n');
}
