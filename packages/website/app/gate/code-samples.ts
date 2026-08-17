/**
 * Pure HTML↔Markdown code-sample equivalence contract.
 *
 * The protocol gate (Phase E) fetches a docs page's rendered HTML and its
 * `.md` alternate and asks one question: do the code samples shown to a
 * human match the code samples handed to an agent? Both extractors are
 * string-based — no DOM dependency — so the same module runs unmodified
 * under the package's jsdom-environment unit suite and the protocol suite's
 * plain-Node environment against real fetched bytes.
 *
 * @summary HTML/Markdown code-sample equivalence gate.
 */

/**
 * Extract the text content of every fumadocs pretty-code rendered code
 * sample from a page's HTML.
 *
 * Pretty-code wraps highlighted code in `pre > code`, typically with one
 * `<span data-line>` per source line (each further nested with per-token
 * spans for syntax-highlight coloring). The text content is extracted, not
 * the markup.
 *
 * @param html - A page's rendered HTML.
 * @returns One string per code sample, in document order, markup stripped.
 * @summary Extract code sample text from rendered HTML.
 */
const PRE_CODE = /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;

/** A `<span … data-line …>` opening tag — the per-line wrapper pretty-code emits. */
const DATA_LINE_OPEN = /<span\b[^>]*\bdata-line\b[^>]*>/gi;

/** Any HTML tag, opening or closing. */
const TAG = /<[^>]*>/g;

/**
 * The entities pretty-code's syntax highlighter can emit in code text —
 * named entities plus numeric (decimal and hex) character references, since
 * Shiki/rehype-pretty-code emits apostrophes inside highlighted string
 * tokens as the hex form `&#x27;`, not the named `&#39;`.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/** Strip every tag from a fragment, leaving only its text content. */
function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(TAG, ''));
}

export function extractHtmlCodeSamples(html: string): string[] {
  const samples: string[] = [];
  for (const block of html.matchAll(PRE_CODE)) {
    const inner = block[1];
    const lineOpens = [...inner.matchAll(DATA_LINE_OPEN)];
    if (lineOpens.length === 0) {
      samples.push(stripTags(inner).trim());
      continue;
    }
    const lines: string[] = [];
    for (let i = 0; i < lineOpens.length; i++) {
      const open = lineOpens[i];
      const start = (open.index ?? 0) + open[0].length;
      const end = i + 1 < lineOpens.length ? (lineOpens[i + 1].index ?? inner.length) : inner.length;
      lines.push(stripTags(inner.slice(start, end)).replace(/\s+$/, ''));
    }
    samples.push(lines.join('\n'));
  }
  return samples;
}

/**
 * Extract the body of every fenced code block from Markdown, following
 * CommonMark's fence rules: an opener is three or more backticks or tildes
 * followed by a free-form info string (`bash title="Install"`, `objective-c`);
 * a closer is a bare run of the same character, at least as long as the
 * opener, alone on its own line. A shorter run inside the fence body does not
 * close the block, so fence content containing its own (shorter) runs survives
 * verbatim.
 *
 * Mirrors the fence-tracking rules already encoded in
 * [`get-llm-text.ts`](../lib/get-llm-text.ts)'s `stripHeadingIds` and in
 * [`mod.rs`](../../../git-span/src/schemas/mod.rs)'s `mdx_prose`.
 *
 * @param markdown - Markdown source.
 * @returns One string per fence body, in document order, verbatim.
 * @summary Extract fenced code block bodies from Markdown.
 */
/** A CommonMark backtick fence opener: up to three leading spaces, a run of
 * three or more backticks, then a free-form info string. CommonMark forbids a
 * backtick anywhere in a backtick fence's info string — that restriction is
 * what keeps an inline code span from being read as a fence opener. */
const BACKTICK_FENCE_OPEN = /^ {0,3}(`{3,})[^`]*$/;

/** A CommonMark tilde fence opener: up to three leading spaces, a run of three
 * or more tildes, then an info string with no character restriction at all. */
const TILDE_FENCE_OPEN = /^ {0,3}(~{3,})/;

/** A CommonMark fence closer: up to three leading spaces, then a bare run of
 * backticks or tildes and nothing else on the line. The run's character must
 * match the opener's, and its length must be at least the opener's. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * A Markdown blockquote's per-line marker (e.g. the fence inside a
 * `<Callout>`, which the renderer emits as `> ` on every line including the
 * opener/closer). Stripped before fence matching so a fenced block nested in
 * a blockquote is recognized the same as a top-level one.
 */
const BLOCKQUOTE_PREFIX = /^> ?/;

export function extractMarkdownFences(markdown: string): string[] {
  const lines = markdown.split('\n');
  const fences: string[] = [];
  let fence: { marker: string; length: number; body: string[]; blockquote: boolean } | null = null;
  for (const rawLine of lines) {
    if (fence) {
      const line = fence.blockquote ? rawLine.replace(BLOCKQUOTE_PREFIX, '') : rawLine;
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) {
        fences.push(fence.body.join('\n'));
        fence = null;
        continue;
      }
      fence.body.push(line);
      continue;
    }
    const blockquote = BLOCKQUOTE_PREFIX.test(rawLine);
    const line = blockquote ? rawLine.replace(BLOCKQUOTE_PREFIX, '') : rawLine;
    const open = BACKTICK_FENCE_OPEN.exec(line) ?? TILDE_FENCE_OPEN.exec(line);
    if (open) {
      fence = { marker: open[1][0], length: open[1].length, body: [], blockquote };
    }
  }
  if (fence) fences.push(fence.body.join('\n'));
  return fences;
}

/**
 * Compare a page's rendered code samples against its Markdown alternate's
 * fenced code blocks: same count, same normalized content at each index.
 *
 * @param html - The page's rendered HTML.
 * @param markdown - The page's Markdown alternate.
 * @returns `{ equivalent: true }` when every sample matches; otherwise
 *   `{ equivalent: false, mismatch }` naming the first index and nature of
 *   the difference.
 * @summary Compare HTML code samples against Markdown fences for equivalence.
 */
/**
 * Normalize a code sample for comparison: trailing whitespace is trimmed
 * per line, and the whole sample ends in exactly one trailing newline. The
 * HTML side comes from syntax-highlighted `pre > code` text (which can carry
 * highlighter-injected trailing spaces); the Markdown side comes from raw
 * fence bytes (which can carry a trailing blank line before the closer).
 * Neither difference is a real drift, so both sides are normalized the same
 * way before comparing.
 */
function normalize(sample: string): string {
  return `${sample
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n*$/, '')}\n`;
}

export function equivalentCodeSamples(html: string, markdown: string): { equivalent: boolean; mismatch?: string } {
  const htmlSamples = extractHtmlCodeSamples(html).map(normalize);
  const markdownSamples = extractMarkdownFences(markdown).map(normalize);

  if (htmlSamples.length !== markdownSamples.length) {
    return {
      equivalent: false,
      mismatch: `code sample count differs: HTML has ${htmlSamples.length}, Markdown has ${markdownSamples.length}`
    };
  }

  for (let i = 0; i < htmlSamples.length; i++) {
    if (htmlSamples[i] !== markdownSamples[i]) {
      return {
        equivalent: false,
        mismatch: `code sample at index ${i} differs between HTML and Markdown`
      };
    }
  }

  return { equivalent: true };
}
