import type { StructuredData } from 'fumadocs-core/mdx-plugins/remark-structure';
import type { LoaderFunctionArgs, Location, MetaDescriptor } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meta as docsMeta, loader } from './page';
import { getLLMText } from '~/lib/get-llm-text';
import { SITE_URL } from '~/lib/meta';
import { capture } from '~/lib/regex';
import { source } from '~/lib/source';
import { meta as homeMeta } from '~/routes/_index';
import { defined } from '~/test/defined';
import { loaderArgs } from '~/test/loader-args';

/**
 * Page-identity guards for the docs tree, all running against the real
 * generated collection (never test doubles): every page carries a non-empty
 * description, the heading fragments are pinned by an enumerated inventory,
 * the description reaches the Markdown preamble with the same string the HTML
 * meta tags carry, and every indexable route declares its canonical URL.
 */

// fumadocs-core types the page field `StructuredData | (() => Awaitable<StructuredData>) | undefined`;
// the fumadocs-mdx runtime narrows it to `StructuredData`, so the guard widens
// it back to the declared contract and resolves the thunk form first — a future
// collection shape change fails loudly instead of silently pinning nothing.
type PageStructuredData = StructuredData | (() => StructuredData | Promise<StructuredData>) | undefined;

type DocsPage = ReturnType<typeof source.getPages>[number];

async function resolveStructuredData(page: DocsPage): Promise<StructuredData | undefined> {
  return resolveDeclaredStructuredData(page.data.structuredData);
}

/** Takes the field at its declared (widened) type, so the thunk branch stays reachable. */
async function resolveDeclaredStructuredData(structuredData: PageStructuredData): Promise<StructuredData | undefined> {
  return typeof structuredData === 'function' ? await structuredData() : structuredData;
}

/** The authored-order fragment inventory: page URL -> heading ids, exact order. */
const HEADING_INVENTORY: Record<string, string[]> = {
  '/docs/overview': [
    'the-problem',
    'what-a-span-does-about-it',
    'built-for-agents-usable-by-anyone',
    'where-to-go-next'
  ],
  '/docs/getting-started': [
    'install-the-cli',
    'install-the-claude-code-plugin',
    'install-the-codex-plugin',
    'install-the-opencode-plugin',
    'install-the-antigravity-plugin',
    'verify',
    'where-to-go-next'
  ],
  '/docs/agent-integration': [
    'touch-hook',
    'suppression',
    'codex-specifics',
    'opencode-specifics',
    'antigravity-specifics',
    'the-enforcement-backstop'
  ],
  '/docs/concepts': ['span', 'anchor', 'the-why', 'the-span-directory', 'drift', 'automation-lifecycle'],
  '/docs/guides/reconcile-drifted-spans': [
    'run-the-scan',
    'auto-resolve-whats-safe',
    'resolve-whats-left-by-hand',
    'commit-the-result',
    'merge-conflicts-in-span'
  ],
  '/docs/guides/re-anchor-after-an-edit': [
    'when-to-use-this',
    'find-the-new-range',
    'same-range-new-content',
    'moved-range-swap-the-anchor-identity-atomically',
    'inherit-the-why-only-while-it-remains-true',
    'commit',
    'see-also'
  ],
  '/docs/guides/mine-span-candidates': [
    'what-youre-looking-for',
    'find-files-that-change-together',
    'filter-out-couplings-that-are-already-visible',
    'confirm-the-coupling-by-reading-the-code',
    'declare-the-span'
  ],
  '/docs/commands': [
    'global-options',
    'declare-and-edit',
    'add',
    'remove',
    'replace',
    'why',
    'config',
    'delete',
    'commit-documents',
    'notes-add',
    'notes-list',
    'notes-show',
    'notes-remove',
    'inspect',
    'show',
    'list',
    'tree',
    'history',
    'context',
    'audit-and-automate',
    'drift',
    'doctor',
    'merge-driver',
    'resolve'
  ],
  '/docs/ci': [
    'ci-gate-the-enforcement-backstop',
    'wiring-into-a-validate-script',
    'local-pre-commit-hook',
    'merge-driver'
  ],
  '/docs/reference': ['span-names', 'anchors', 'the-span-directory', 'exit-codes', 'published-schemas', 'configuration']
};

function canonicalHref(meta: MetaDescriptor[] | undefined): string | undefined {
  for (const descriptor of meta ?? []) {
    if ('tagName' in descriptor && descriptor.tagName === 'link' && descriptor.rel === 'canonical') {
      return typeof descriptor.href === 'string' ? descriptor.href : undefined;
    }
  }
  return undefined;
}

/** A YAML double-quoted scalar: backslash and quote escaped, everything else verbatim. */
const YAML_DOUBLE_QUOTED = /^description: "((?:[^"\\]|\\.)*)"$/;

/** Invert the YAML double-quote escaping (only `\\` and `\"` are ever emitted). */
function unescapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

/** A router location at `pathname` with no search, hash, or history state. */
function locationAt(pathname: string): Location {
  return { pathname, search: '', hash: '', state: null, key: 'default' };
}

/** Loader args for a canonical docs URL — the same faithful shape page.test.ts builds. */
function docArgs(url: string): LoaderFunctionArgs {
  return loaderArgs(`https://git-span.com${url}`, { params: { '*': url.replace(/^\/docs\//, '') } });
}

describe('docs page identity', () => {
  it('gives every page a non-empty description', () => {
    for (const page of source.getPages()) {
      expect(page.data.description?.trim().length, `description for ${page.url}`).toBeGreaterThan(0);
    }
  });

  it('pins the heading fragments of every page against the live collection', async () => {
    const pages = new Map(source.getPages().map((page) => [page.url, page]));
    expect([...pages.keys()].sort()).toEqual(Object.keys(HEADING_INVENTORY).sort());
    for (const [url, ids] of Object.entries(HEADING_INVENTORY)) {
      const page = pages.get(url);
      expect(page, `no page registered for ${url}`).toBeDefined();
      if (!page) continue;
      const structuredData = await resolveStructuredData(page);
      const headingIds = structuredData?.headings.map((heading) => heading.id) ?? [];
      expect(headingIds, `fragment inventory for ${url}`).toEqual(ids);
    }
  });

  it('carries the same description in the Markdown preamble and the HTML meta tags', async () => {
    for (const page of source.getPages()) {
      const text = await getLLMText(page);
      const lines = text.split('\n');
      expect(lines[0], `preamble opener for ${page.url}`).toBe('---');
      expect(lines[2], `preamble closer for ${page.url}`).toBe('---');
      const value = YAML_DOUBLE_QUOTED.exec(defined(lines[1], `description line for ${page.url}`));
      expect(value, `description line for ${page.url}`).not.toBeNull();
      if (!value) continue;
      expect(unescapeYamlDoubleQuoted(capture(value, 1)), `preamble description for ${page.url}`).toBe(
        page.data.description
      );
      expect(lines[4], `title line for ${page.url}`).toBe(`# ${page.data.title} (${page.url})`);
    }
  });

  it('declares the canonical URL on every docs page and on the home route', async () => {
    for (const page of source.getPages()) {
      const loaderData = await loader(docArgs(page.url));
      expect(loaderData, `loader data for ${page.url}`).not.toBeInstanceOf(Response);
      if (loaderData instanceof Response) continue;
      const href = canonicalHref(
        docsMeta({
          loaderData,
          location: locationAt(page.url),
          params: {},
          matches: []
        })
      );
      expect(href, `canonical href for ${page.url}`).toBe(`${SITE_URL}${page.url}`);
    }
    const homeHref = canonicalHref(
      homeMeta({
        loaderData: undefined,
        location: locationAt('/'),
        params: {},
        matches: []
      })
    );
    expect(homeHref, 'canonical href for the home route').toBe(`${SITE_URL}/`);
  });
});
