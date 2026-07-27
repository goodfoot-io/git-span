/**
 * Detects doc-to-code couplings: a documentation page that cites code with
 * line-anchored links is asserting that its prose depends on exactly that
 * code. Ports `sig_doc_references` from the Python span-recovery prototype.
 *
 * A page's references are collected with a single extractor pass over its
 * full text, which resolves both markdown-link targets and bare in-prose
 * mentions. Markdown-link targets that are a URL scheme (`https:`,
 * `mailto:`, …) or a pure in-page `#fragment` are masked out beforehand so
 * they are never mistaken for a repository path.
 *
 * @summary Documentation-to-code reference coupling signal.
 */

import { buildPathExtractor } from '../paths.js';
import type { Candidate, DiscoverConfig, Loc, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'doc-references';
/** Matches a markdown link `[text](target)`, capturing the target. */
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
/** A URI scheme prefix (`https:`, `mailto:`, …) at the start of a link target. */
const LINK_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const MAX_ANCHORED_TARGETS = 8;
const MAX_PLAIN_TARGETS = 8;
const MAX_MD_TARGETS = 6;
const MAX_PAIRS = 200;
const MIN_PLAIN_FOR_GROUP = 2;
const ANCHORED_DOCS_SCORE = 0.68;
const ANCHORED_ELSE_SCORE = 0.62;
const PLAIN_DOCS_SCORE = 0.52;
const PLAIN_ELSE_SCORE = 0.44;
const PAIR_SCORE = 0.42;
const MD_LINK_SCORE = 0.45;

/**
 * Checks whether a repository path is a markdown documentation page.
 *
 * @param path - Repository-relative path.
 * @returns True for `.md` or `.mdx` files.
 */
function isDocPage(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.mdx');
}

/**
 * Blanks out markdown-link targets that point at a URL scheme or a pure
 * in-page fragment, so the generic path extractor never sees them. Each
 * masked span keeps its original length so every other character's offset
 * in `text` is unaffected.
 *
 * @param text - Raw page text (may span multiple lines).
 * @returns `text` with disqualified link targets replaced by spaces.
 */
function maskSkippedLinkTargets(text: string): string {
  MARKDOWN_LINK_RE.lastIndex = 0;
  let result = text;
  let match = MARKDOWN_LINK_RE.exec(text);
  while (match !== null) {
    const target = match[1] ?? '';
    const trimmed = target.trim();
    if (LINK_SCHEME_RE.test(trimmed) || trimmed.startsWith('#')) {
      const targetEnd = match.index + match[0].length - 1;
      const targetStart = targetEnd - target.length;
      result = result.slice(0, targetStart) + ' '.repeat(target.length) + result.slice(targetEnd);
    }
    match = MARKDOWN_LINK_RE.exec(text);
  }
  return result;
}

/** One distinct non-doc target resolved on a page, keyed by target path (first occurrence wins). */
interface PageTarget {
  loc: Loc;
  anchored: boolean;
}

/**
 * Coupling signal that groups a markdown page with the code paths it cites.
 */
export const docReferencesSignal: Signal = {
  name: SIGNAL_NAME,

  applies(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): boolean {
    return scan.files.some((file) => isDocPage(file) && scan.text.has(file));
  },

  run(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const extract = buildPathExtractor(scan);
    const groupCandidates: Candidate[] = [];
    const pairCandidates: Candidate[] = [];

    for (const page of scan.files) {
      if (!isDocPage(page)) continue;
      const content = scan.text.get(page);
      if (content === undefined) continue;

      const targets = new Map<string, PageTarget>();
      const mdTargets: string[] = [];
      const seenMd = new Set<string>();

      for (const ref of extract(maskSkippedLinkTargets(content), page)) {
        const targetPath = ref.loc.path;
        if (targetPath === page) continue;
        if (isDocPage(targetPath)) {
          if (!seenMd.has(targetPath)) {
            seenMd.add(targetPath);
            mdTargets.push(targetPath);
          }
          continue;
        }
        if (!targets.has(targetPath)) {
          targets.set(targetPath, { loc: ref.loc, anchored: ref.loc.start !== undefined });
        }
      }

      const inDocsDir = scan.docsDirs.some((prefix) => page.startsWith(prefix));
      const evidence = [`doc:${page}`];
      const anchoredLocs = [...targets.values()].filter((t) => t.anchored).map((t) => t.loc);
      const plainEntries = [...targets.entries()].filter(([, t]) => !t.anchored);

      if (anchoredLocs.length > 0) {
        groupCandidates.push({
          locs: [{ path: page }, ...anchoredLocs.slice(0, MAX_ANCHORED_TARGETS)],
          score: inDocsDir ? ANCHORED_DOCS_SCORE : ANCHORED_ELSE_SCORE,
          signal: SIGNAL_NAME,
          evidence
        });
      }

      if (plainEntries.length >= MIN_PLAIN_FOR_GROUP) {
        groupCandidates.push({
          locs: [{ path: page }, ...plainEntries.slice(0, MAX_PLAIN_TARGETS).map(([path]) => ({ path }))],
          score: inDocsDir ? PLAIN_DOCS_SCORE : PLAIN_ELSE_SCORE,
          signal: SIGNAL_NAME,
          evidence
        });
      }

      for (const target of targets.values()) {
        pairCandidates.push({
          locs: [{ path: page }, target.loc],
          score: PAIR_SCORE,
          signal: SIGNAL_NAME,
          evidence
        });
      }

      if (mdTargets.length >= 1) {
        groupCandidates.push({
          locs: [{ path: page }, ...mdTargets.slice(0, MAX_MD_TARGETS).map((path) => ({ path }))],
          score: MD_LINK_SCORE,
          signal: SIGNAL_NAME,
          evidence
        });
      }
    }

    return [...groupCandidates, ...pairCandidates.slice(0, MAX_PAIRS)];
  }
};
