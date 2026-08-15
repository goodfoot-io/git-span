import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The expected docs slug list in authored reading order, derived from the
 * same meta.json files that drive the page tree — independent of Fumadocs, so
 * the contract pins authored order rather than whatever the loader emits. The
 * `guides` entry expands to its nested meta.json's pages in place.
 *
 * Shared by the llms-resources route suite and the sitemap drift detector so
 * both pin the same page inventory.
 */
export function expectedDocsSlugs(): string[] {
  const root = JSON.parse(readFileSync(path.join(process.cwd(), 'content/docs/meta.json'), 'utf8')) as {
    pages: string[];
  };
  const guides = JSON.parse(readFileSync(path.join(process.cwd(), 'content/docs/guides/meta.json'), 'utf8')) as {
    pages: string[];
  };
  return root.pages.flatMap((slug) => (slug === 'guides' ? guides.pages.map((child) => `guides/${child}`) : [slug]));
}
